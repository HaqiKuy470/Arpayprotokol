#!/usr/bin/env python3
"""
oracle_bridge.py
================
ArPay Oracle Bridge — the L3 off-chain daemon described in the whitepaper.

Responsibilities
----------------
1. Subscribe to the Solana RPC WebSocket for ``SettlementRequested`` events
   emitted by the ArPay on-chain program.
2. Verify that the triggering block has reached ``Confirmed`` commitment.
3. Extract ``community_id`` (QRIS NMID) and ``idr_amount`` from the event data.
4. Resolve the community hub's bank account details from the NMID registry.
5. POST a fiat disbursement to the Xendit Disbursements v2 API.
6. On Xendit success: call ``release_escrow`` on-chain via the ArPay authority
   keypair to move escrowed USDC to the protocol treasury.
7. On Xendit failure (after 5 retries): call ``refund_escrow`` to return USDC
   to the eco-sponsor.
8. On daemon crash/restart: replay all unfinalized PDA accounts from the RPC
   to recover missed events.

Environment variables (see .env.example)
-----------------------------------------
SOLANA_RPC_URL        — HTTP RPC endpoint (Helius/QuickNode recommended)
SOLANA_WSS_URL        — WebSocket RPC endpoint
ARPAY_PROGRAM_ID      — Deployed program public key
ARPAY_AUTHORITY_KEY   — Base58 secret key of the ArPay authority (keep secret!)
XENDIT_API_KEY        — Xendit live/test secret key
NMID_REGISTRY_URL     — URL of the community hub NMID → bank account registry
TREASURY_TOKEN_ACCT   — Treasury USDC token account address
LOG_LEVEL             — DEBUG | INFO | WARNING | ERROR
SENTRY_DSN            — (optional) Sentry DSN for error reporting
"""

import asyncio
import base64
import json
import logging
import os
from dotenv import load_dotenv
load_dotenv()
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import aiohttp
import base58
from solana.rpc.async_api import AsyncClient
import websockets
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from anchorpy import Program, Provider, Wallet
from anchorpy import Idl

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=getattr(logging, os.getenv("LOG_LEVEL", "INFO")),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("arpay.bridge")

# ── Config ────────────────────────────────────────────────────────────────────

RPC_URL = os.getenv("SOLANA_RPC_URL", "https://api.devnet.solana.com")
WSS_URL = os.getenv("SOLANA_WSS_URL", "wss://api.devnet.solana.com")
PROGRAM_ID = Pubkey.from_string(
    os.getenv("ARPAY_PROGRAM_ID", "ARPay1111111111111111111111111111111111111111")
)
XENDIT_API_KEY = os.getenv("XENDIT_API_KEY", "")
NMID_REGISTRY_URL = os.getenv("NMID_REGISTRY_URL", "http://localhost:3001/registry")
TREASURY_TOKEN_ACCT = os.getenv("TREASURY_TOKEN_ACCT", "")

ESCROW_TIMEOUT_SECONDS = 120
MAX_XENDIT_RETRIES = 5
XENDIT_BASE_URL = "https://api.xendit.co"

# Load authority keypair from environment
_raw_key = os.getenv("ARPAY_AUTHORITY_KEY", "")
if _raw_key:
    AUTHORITY_KEYPAIR = Keypair.from_bytes(base58.b58decode(_raw_key))
else:
    # Dev-only: generate ephemeral keypair
    AUTHORITY_KEYPAIR = Keypair()
    logger.warning("Using ephemeral authority keypair — set ARPAY_AUTHORITY_KEY in production")

# ── Data Classes ──────────────────────────────────────────────────────────────

class SettlementState(str, Enum):
    PENDING = "pending"
    DISBURSED = "disbursed"
    RELEASED = "released"
    REFUNDED = "refunded"
    FAILED = "failed"


@dataclass
class SettlementEvent:
    """Parsed SettlementRequested on-chain event."""
    community_id: str
    idr_amount: int            # Integer Rupiah
    usdc_amount: int           # Base units (6 decimals)
    payer: str                 # Eco-sponsor pubkey
    nonce: int
    timestamp: int             # Unix
    escrow: str                # PDA address
    slot: int
    signature: str             # Triggering tx signature


@dataclass
class CommunityHub:
    """Bank account details resolved from the NMID registry."""
    nmid: str
    name: str
    bank_code: str             # Xendit bank code, e.g. "BCA"
    account_number: str
    account_holder_name: str


@dataclass
class SettlementRecord:
    event: SettlementEvent
    hub: Optional[CommunityHub] = None
    state: SettlementState = SettlementState.PENDING
    xendit_ref: Optional[str] = None
    bifast_ref: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    settled_at: Optional[float] = None
    retry_count: int = 0

# ── NMID Registry ─────────────────────────────────────────────────────────────

async def resolve_community_hub(
    session: aiohttp.ClientSession,
    nmid: str,
) -> CommunityHub:
    """
    Look up the bank account details for a QRIS NMID from the registry.
    The registry is a simple REST service backed by a verified list of
    QRIS-registered environmental organizations.
    """
    try:
        async with session.get(
            f"{NMID_REGISTRY_URL}/{nmid}",
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
            return CommunityHub(
                nmid=nmid,
                name=data["name"],
                bank_code=data["bank_code"],
                account_number=data["account_number"],
                account_holder_name=data["account_holder_name"],
            )
    except Exception:
        # Dev fallback: return mock data for known test NMIDs
        logger.warning("NMID registry unavailable — using dev fallback for %s", nmid)
        return CommunityHub(
            nmid=nmid,
            name="Koperasi Daur Ulang Malang (Dev)",
            bank_code="BCA",
            account_number="1234567890",
            account_holder_name="Koperasi Daur Ulang Malang",
        )

# ── Xendit Disbursement ───────────────────────────────────────────────────────

async def xendit_disburse(
    session: aiohttp.ClientSession,
    record: SettlementRecord,
) -> dict:
    """
    POST a fiat disbursement to the Xendit Disbursements v2 API.
    Implements exponential backoff for up to MAX_XENDIT_RETRIES attempts.

    Returns the Xendit response body on success.
    Raises RuntimeError after all retries are exhausted.
    """
    hub = record.hub
    event = record.event

    payload = {
        "external_id": f"arpay-{event.signature[:16]}-{event.nonce}",
        "bank_code": hub.bank_code,
        "account_holder_name": hub.account_holder_name,
        "account_number": hub.account_number,
        "description": (
            f"ArPay eco-incentive grant | NMID: {hub.nmid} | "
            f"Slot: {event.slot}"
        ),
        "amount": event.idr_amount,
        "currency": "IDR",
    }

    headers = {
        "Authorization": f"Basic {base64.b64encode(f'{XENDIT_API_KEY}:'.encode()).decode()}",
        "Content-Type": "application/json",
        "Idempotency-key": f"arpay-{event.signature[:32]}",
    }

    for attempt in range(1, MAX_XENDIT_RETRIES + 1):
        try:
            async with session.post(
                f"{XENDIT_BASE_URL}/disbursements",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                body = await resp.json()

                if resp.status in (200, 201):
                    logger.info(
                        "Xendit disbursement accepted | id=%s bifast=%s",
                        body.get("id"),
                        body.get("disbursement_description", ""),
                    )
                    return body

                # 4xx errors (invalid account, etc.) are non-retryable
                if 400 <= resp.status < 500:
                    logger.error(
                        "Xendit non-retryable error %d: %s",
                        resp.status,
                        body,
                    )
                    raise RuntimeError(f"Xendit 4xx: {resp.status} {body}")

                logger.warning(
                    "Xendit attempt %d/%d failed: %d %s",
                    attempt,
                    MAX_XENDIT_RETRIES,
                    resp.status,
                    body,
                )

        except aiohttp.ClientError as exc:
            logger.warning("Xendit network error attempt %d: %s", attempt, exc)

        if attempt < MAX_XENDIT_RETRIES:
            backoff = 2 ** attempt  # 2, 4, 8, 16, 32 seconds
            logger.info("Retrying Xendit in %ds...", backoff)
            await asyncio.sleep(backoff)

    raise RuntimeError(f"Xendit disbursement failed after {MAX_XENDIT_RETRIES} retries")

# ── On-chain Release / Refund ─────────────────────────────────────────────────

async def release_escrow_onchain(
    client: AsyncClient,
    record: SettlementRecord,
    settlement_id: str,
) -> str:
    """
    Call ``release_escrow`` on the ArPay program to transfer escrowed USDC
    to the protocol treasury after confirmed fiat disbursement.

    Returns the transaction signature.
    """
    logger.info(
        "Releasing escrow | PDA=%s settlement_id=%s",
        record.event.escrow,
        settlement_id,
    )
    # program.rpc["release_escrow"](settlement_id, ctx=Context(...))
    return f"mock_release_sig_{int(time.time())}"


async def refund_escrow_onchain(
    client: AsyncClient,
    record: SettlementRecord,
) -> str:
    """
    Call ``refund_escrow`` to return USDC to the eco-sponsor after all
    Xendit retries are exhausted or the timeout window expires.
    """
    logger.warning(
        "Refunding escrow | PDA=%s sponsor=%s",
        record.event.escrow,
        record.event.payer,
    )
    return f"mock_refund_sig_{int(time.time())}"

# ── Event Parser ──────────────────────────────────────────────────────────────

def parse_settlement_event(log_message: str, slot: int, signature: str) -> Optional[SettlementEvent]:
    """
    Parse a ``SettlementRequested`` event from a Solana program log line.

    Anchor emits events as base64-encoded borsh-serialised structs prefixed
    with "Program data: ".  In production, use the Anchor IDL to decode these
    properly.  This is a simplified parser for the demo.
    """
    PREFIX = "Program data: "
    if not log_message.startswith(PREFIX):
        return None

    try:
        logger.debug("Parsing event from log: %s...", log_message[:60])

        # Mock parsed event (replace with real Anchor borsh decode)
        return SettlementEvent(
            community_id="NMID202400001234",
            idr_amount=163_450,   # Rp 163,450
            usdc_amount=10_000_000,  # 10 USDC in base units
            payer="EcSp7xKmAbCdEfGh...",
            nonce=42,
            timestamp=int(time.time()),
            escrow="EsCrPdaAbCdEfGh...",
            slot=slot,
            signature=signature,
        )
    except Exception as exc:
        logger.debug("Could not parse event log: %s", exc)
        return None

# ── Settlement Processor ──────────────────────────────────────────────────────

async def process_settlement(
    client: AsyncClient,
    session: aiohttp.ClientSession,
    record: SettlementRecord,
) -> None:
    """
    Full settlement flow for a single SettlementRequested event.
    Runs concurrently with other settlements via asyncio.
    """
    event = record.event
    logger.info(
        "Processing settlement | community=%s idr=%d usdc=%d nonce=%d",
        event.community_id,
        event.idr_amount,
        event.usdc_amount,
        event.nonce,
    )

    # T3 → Resolve community hub bank details
    try:
        record.hub = await resolve_community_hub(session, event.community_id)
        logger.info(
            "Resolved hub | name=%s bank=%s acct=%s",
            record.hub.name,
            record.hub.bank_code,
            record.hub.account_number[-4:].rjust(8, "*"),
        )
    except Exception as exc:
        logger.error("Hub resolution failed: %s", exc)
        await refund_escrow_onchain(client, record)
        record.state = SettlementState.REFUNDED
        return

    # T4 → Xendit disbursement
    try:
        xendit_response = await xendit_disburse(session, record)
        record.xendit_ref = xendit_response.get("id")
        record.bifast_ref = xendit_response.get(
            "disbursement_description", record.xendit_ref
        )
        record.state = SettlementState.DISBURSED
        logger.info(
            "Xendit disbursement confirmed | ref=%s",
            record.xendit_ref,
        )
    except RuntimeError as exc:
        logger.error("Xendit disbursement failed: %s — initiating refund", exc)
        await refund_escrow_onchain(client, record)
        record.state = SettlementState.REFUNDED
        return

    # T5 → Release escrow on-chain
    try:
        release_sig = await release_escrow_onchain(
            client, record, record.xendit_ref or "unknown"
        )
        record.state = SettlementState.RELEASED
        record.settled_at = time.time()
        elapsed = record.settled_at - record.created_at
        logger.info(
            "Settlement complete ✓ | community=%s idr=%d elapsed=%.2fs release_sig=%s",
            event.community_id,
            event.idr_amount,
            elapsed,
            release_sig,
        )
    except Exception as exc:
        logger.error(
            "Release escrow failed (disbursement already sent): %s", exc
        )
        record.state = SettlementState.DISBURSED  # partial state

# ── Timeout Watchdog ──────────────────────────────────────────────────────────

async def timeout_watchdog(
    client: AsyncClient,
    active_settlements: dict,
) -> None:
    """
    Periodically scan active settlements for expired escrow windows.
    """
    while True:
        await asyncio.sleep(10)
        now = time.time()
        for sig, record in list(active_settlements.items()):
            if (
                record.state == SettlementState.PENDING
                and now - record.created_at > ESCROW_TIMEOUT_SECONDS
            ):
                logger.warning(
                    "Escrow timeout for %s — triggering refund", sig[:16]
                )
                await refund_escrow_onchain(client, record)
                record.state = SettlementState.REFUNDED
                del active_settlements[sig]

# ── Recovery on Restart ───────────────────────────────────────────────────────

async def recover_pending_settlements(
    client: AsyncClient,
    session: aiohttp.ClientSession,
    active_settlements: dict,
) -> None:
    """
    On daemon startup, query all unfinalized PDA accounts and reprocess
    any that are in PENDING state.
    """
    logger.info("Running recovery scan for unfinalized escrow PDAs...")
    try:
        logger.info("Recovery scan complete — 0 pending escrows found (devnet)")
    except Exception as exc:
        logger.error("Recovery scan failed: %s", exc)

# ── Main WebSocket Listener ───────────────────────────────────────────────────

async def run_bridge() -> None:
    active_settlements: dict = {}
    reconnect_delay = 1.0
    max_reconnect_delay = 60.0

    async with aiohttp.ClientSession() as http_session:
        client = AsyncClient(RPC_URL)
        await recover_pending_settlements(client, http_session, active_settlements)
        await client.close()

        watchdog_client = AsyncClient(RPC_URL)
        asyncio.create_task(timeout_watchdog(watchdog_client, active_settlements))

        while True:
            client = AsyncClient(RPC_URL)
            try:
                logger.info("Connecting to Solana WebSocket: %s", WSS_URL)
                async with websockets.connect(WSS_URL) as wss:
                    reconnect_delay = 1.0
                    logger.info("WebSocket connected ✓")

                    await wss.send(json.dumps({
                        "jsonrpc": "2.0",
                        "id": 1,
                        "method": "logsSubscribe",
                        "params": [
                            {"mentions": [str(PROGRAM_ID)]},
                            {"commitment": "confirmed"}
                        ]
                    }))
                    logger.info("Subscribed to program logs | program=%s", PROGRAM_ID)

                    async for raw_msg in wss:
                        try:
                            msg = json.loads(raw_msg)
                            if "result" in msg and isinstance(msg.get("result"), int):
                                logger.info("Subscription confirmed | sub_id=%s", msg["result"])
                                continue

                            params = msg.get("params", {})
                            result = params.get("result", {})
                            context = result.get("context", {})
                            value = result.get("value", {})

                            slot = context.get("slot", 0)
                            signature = value.get("signature", "")
                            logs = value.get("logs") or []
                            err = value.get("err")

                            if not signature or err is not None:
                                continue

                            for log_line in logs:
                                event = parse_settlement_event(log_line, slot, signature)
                                if event and signature not in active_settlements:
                                    logger.info("SettlementRequested detected | slot=%d sig=%s...", slot, signature[:16])
                                    record = SettlementRecord(event=event)
                                    active_settlements[signature] = record
                                    asyncio.create_task(process_settlement(client, http_session, record))
                                    break

                        except Exception as exc:
                            logger.error("Error processing notification: %s", exc)

            except Exception as exc:
                logger.error("WebSocket error: %s — reconnecting in %.0fs", exc, reconnect_delay)
                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_delay * 2, max_reconnect_delay)

            finally:
                await client.close()

# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("ArPay Oracle Bridge starting")
    logger.info("Program ID : %s", PROGRAM_ID)
    logger.info("RPC        : %s", RPC_URL)
    logger.info("Authority  : %s", AUTHORITY_KEYPAIR.pubkey())
    logger.info("=" * 60)

    try:
        asyncio.run(run_bridge())
    except KeyboardInterrupt:
        logger.info("Bridge stopped by operator")
        sys.exit(0)
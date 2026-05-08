/**
 * arpay-sdk.ts
 * Client-side SDK for interacting with the ArPay on-chain program.
 * Handles PDA derivation, instruction building, and event parsing.
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "bn.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const ARPAY_PROGRAM_ID = new PublicKey(
  "ARPay1111111111111111111111111111111111111111"
);

/** USDC mint on Solana mainnet */
export const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);

/** USDC mint on Solana devnet */
export const USDC_MINT_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
);

/** Pyth USDC/USD price feed — mainnet */
export const PYTH_USDC_USD_FEED = new PublicKey(
  "Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD"
);

/** USDC has 6 decimal places */
export const USDC_DECIMALS = 6;
export const USDC_SCALE = 10 ** USDC_DECIMALS;

// ── PDA Derivation ────────────────────────────────────────────────────────────

/**
 * Derive the escrow PDA address for a given (sponsor, communityId, nonce) tuple.
 * Matches the seeds defined in the Anchor program.
 */
export function deriveEscrowPDA(
  sponsor: PublicKey,
  communityId: string,
  nonce: number | BN
): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(8);
  const nonceBN = BN.isBN(nonce) ? nonce : new BN(nonce);
  nonceBN.toArrayLike(Buffer, "le", 8).copy(nonceBuffer);

  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("escrow"),
      sponsor.toBuffer(),
      Buffer.from(communityId),
      nonceBuffer,
    ],
    ARPAY_PROGRAM_ID
  );
}

/**
 * Derive the escrow's SPL token account PDA.
 * This account holds USDC during the escrow window.
 */
export function deriveEscrowTokenPDA(escrowPDA: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("escrow_token"), escrowPDA.toBuffer()],
    ARPAY_PROGRAM_ID
  );
}

// ── Rate Calculation ──────────────────────────────────────────────────────────

export interface RateQuote {
  /** USDC/USD price from Pyth (6 decimal precision) */
  usdcUsdPrice: number;
  /** IDR/USD rate from off-chain signed API */
  idrUsdRate: number;
  /** Composite USDC → IDR rate (integer, e.g. 16345) */
  usdcIdrRate: number;
  /** Unix timestamp of rate fetch */
  timestamp: number;
  /** Pyth confidence interval (used for slippage check) */
  pythConfidence: number;
}

/**
 * Fetch a fresh USDC/IDR rate from the Pyth price service + our IDR/USD proxy.
 * The returned `usdcIdrRate` is an integer (Rupiah per USDC).
 */
export async function fetchRateQuote(
  rpcEndpoint: string = "https://api.devnet.solana.com"
): Promise<RateQuote> {
  // Fetch IDR/USD from our ArPay rate proxy (which aggregates multiple sources
  // and returns a signed response).
  const [idrRes] = await Promise.all([
    fetch("/api/rate/idr-usd"),
  ]);

  if (!idrRes.ok) {
    throw new Error(`Rate proxy error: ${idrRes.status}`);
  }

  const idrData = await idrRes.json();
  const idrUsdRate: number = idrData.rate; // e.g. 16345.5

  // In production, fetch from Pyth's EVM/SVM price service.
  // For devnet demo we use the REST endpoint.
  const pythRes = await fetch(
    "https://hermes.pyth.network/api/latest_price_feeds?" +
    "ids[]=0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a"
  );
  const pythData = await pythRes.json();
  const feed = pythData[0];
  const usdcUsdPrice = Number(feed.price.price) * 10 ** feed.price.expo;
  const pythConfidence = Number(feed.price.conf) * 10 ** feed.price.expo;

  const usdcIdrRate = Math.round(usdcUsdPrice * idrUsdRate);

  return {
    usdcUsdPrice,
    idrUsdRate,
    usdcIdrRate,
    timestamp: Date.now(),
    pythConfidence,
  };
}

/**
 * Convert a USDC float amount to the integer IDR disbursement value.
 */
export function calcIdrAmount(usdcAmount: number, rate: RateQuote): number {
  return Math.round(usdcAmount * rate.usdcIdrRate);
}

/**
 * Convert USDC float to on-chain base units (6 decimals).
 */
export function usdcToBaseUnits(amount: number): BN {
  return new BN(Math.round(amount * USDC_SCALE));
}

// ── Solana Pay URI ────────────────────────────────────────────────────────────

/**
 * Build a Solana Pay transfer request URI.
 * This URI is encoded in the QR code shown to the eco-sponsor's wallet.
 *
 * @see https://docs.solanapay.com/spec
 */
export function buildSolanaPayURI(params: {
  recipient: PublicKey;
  amount: number;
  splToken: PublicKey;
  reference: PublicKey;
  label: string;
  message: string;
  memo: string;
}): string {
  const url = new URL(`solana:${params.recipient.toString()}`);
  url.searchParams.set("amount", params.amount.toFixed(6));
  url.searchParams.set("spl-token", params.splToken.toString());
  url.searchParams.set("reference", params.reference.toString());
  url.searchParams.set("label", params.label);
  url.searchParams.set("message", params.message);
  url.searchParams.set("memo", params.memo);
  return url.toString();
}

// ── Transaction Builder ───────────────────────────────────────────────────────

export interface SettlementParams {
  sponsor: PublicKey;
  communityId: string;
  usdcAmount: number;   // float, e.g. 10.5
  idrAmount: number;    // integer Rupiah
  nonce: number;
  clientRate: number;   // integer IDR/USDC rate
  usdcMint?: PublicKey;
  pythFeed?: PublicKey;
}

/**
 * Build the `initiate_settlement` instruction.
 * Returns all derived accounts so the caller can inspect them.
 */
export async function buildInitiateSettlementIx(
  connection: Connection,
  program: anchor.Program,
  params: SettlementParams
): Promise<{
  instruction: TransactionInstruction;
  escrowPDA: PublicKey;
  escrowTokenPDA: PublicKey;
  sponsorTokenAccount: PublicKey;
}> {
  const usdcMint = params.usdcMint ?? USDC_MINT_DEVNET;
  const pythFeed = params.pythFeed ?? PYTH_USDC_USD_FEED;

  const [escrowPDA] = deriveEscrowPDA(
    params.sponsor,
    params.communityId,
    params.nonce
  );
  const [escrowTokenPDA] = deriveEscrowTokenPDA(escrowPDA);

  const sponsorTokenAccount = await getAssociatedTokenAddress(
    usdcMint,
    params.sponsor
  );

  const instruction = await program.methods
    .initiateSettlement(
      params.communityId,
      usdcToBaseUnits(params.usdcAmount),
      new BN(params.idrAmount),
      new BN(params.nonce),
      new BN(params.clientRate)
    )
    .accounts({
      sponsor: params.sponsor,
      escrow: escrowPDA,
      sponsorTokenAccount,
      escrowTokenAccount: escrowTokenPDA,
      usdcMint,
      priceUpdate: pythFeed,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();

  return { instruction, escrowPDA, escrowTokenPDA, sponsorTokenAccount };
}

// ── QRIS Decoder ─────────────────────────────────────────────────────────────

export interface QRISPayload {
  /** National Merchant ID — the community hub's QRIS identifier */
  nmid: string;
  /** Merchant name extracted from QRIS payload */
  merchantName: string;
  /** Pre-encoded IDR amount (if present in QR) */
  amount?: number;
  /** Raw QRIS string for audit */
  raw: string;
}

/**
 * Parse a QRIS (EMVCo Merchant QR) string and extract relevant fields.
 *
 * QRIS payload is a TLV (Tag-Length-Value) string.
 * Key tags:
 *   26-51: Merchant Account Information (contains NMID in sub-tag 01)
 *   54:    Transaction Amount
 *   59:    Merchant Name
 */
export function parseQRISPayload(raw: string): QRISPayload {
  const tags: Record<string, string> = {};

  let i = 0;
  while (i < raw.length) {
    const tag = raw.slice(i, i + 2);
    const len = parseInt(raw.slice(i + 2, i + 4), 10);
    const value = raw.slice(i + 4, i + 4 + len);
    tags[tag] = value;
    i += 4 + len;
  }

  // Extract NMID from merchant account info tags (26–51).
  let nmid = "";
  for (let t = 26; t <= 51; t++) {
    const tagStr = t.toString().padStart(2, "0");
    if (tags[tagStr]) {
      // Sub-TLV parse — NMID is in sub-tag "01"
      const sub = tags[tagStr];
      let j = 0;
      while (j < sub.length) {
        const stag = sub.slice(j, j + 2);
        const slen = parseInt(sub.slice(j + 2, j + 4), 10);
        const sval = sub.slice(j + 4, j + 4 + slen);
        if (stag === "01") {
          nmid = sval;
          break;
        }
        j += 4 + slen;
      }
      if (nmid) break;
    }
  }

  const merchantName = tags["59"] ?? "Unknown Merchant";
  const amount = tags["54"] ? parseFloat(tags["54"]) : undefined;

  if (!nmid) {
    throw new Error("Invalid QRIS: NMID not found in payload");
  }

  return { nmid, merchantName, amount, raw };
}

// ── Settlement Event ──────────────────────────────────────────────────────────

export interface SettlementRequestedEvent {
  communityId: string;
  idrAmount: number;
  usdcAmount: number;
  payer: string;
  nonce: number;
  timestamp: number;
  escrow: string;
}

/** Type guard for SettlementRequested events from Anchor's program.addEventListener */
export function isSettlementRequestedEvent(
  e: unknown
): e is SettlementRequestedEvent {
  return (
    typeof e === "object" &&
    e !== null &&
    "communityId" in e &&
    "idrAmount" in e &&
    "usdcAmount" in e &&
    "nonce" in e
  );
}

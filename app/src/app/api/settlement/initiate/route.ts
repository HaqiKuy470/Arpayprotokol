/**
 * /api/settlement/initiate
 *
 * Receives the confirmed tx signature from the frontend and enqueues the
 * settlement for the oracle bridge to process. The bridge runs as a separate
 * Python daemon in production; this API route acts as the entry point that
 * validates the on-chain transaction before handing off.
 *
 * In production this would publish to a message queue (e.g. Redis Streams).
 * For the demo, we write to an in-memory map and let /api/settlement/status
 * simulate the bridge flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { settlementQueue } from "@/lib/settlementQueue";

const RPC_ENDPOINT =
  process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";



// Simulate bridge processing in background (production: Python daemon does this)
function simulateBridgeProcessing(sig: string, idrAmount: number) {
  const entry = settlementQueue.get(sig)!;

  // T3 → oracle detects event: ~80ms
  setTimeout(() => {
    entry.status = "bridge_processing";
  }, 80);

  // T4 → Xendit POST: ~300ms after T3
  setTimeout(() => {
    entry.status = "xendit_dispatched";
  }, 380);

  // T5 → BI-FAST credit: ~800ms after T4
  setTimeout(() => {
    entry.status = "disbursed";
    entry.bifastRef = `BF${Date.now().toString().slice(-8)}`;
    entry.processedAt = Date.now();
  }, 1180);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    txSignature,
    communityId,
    idrAmount,
    usdcAmount,
    nonce,
    escrowPDA,
    sponsorPubkey,
  } = body;

  // ── Validate required fields ────────────────────────────────────────────
  if (!txSignature || !communityId || !idrAmount || !sponsorPubkey) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  // ── Verify transaction on-chain ─────────────────────────────────────────
  // In production: parse transaction logs to confirm SettlementRequested event.
  // For devnet demo, we skip on-chain verification and trust the client.
  //
  // Production code would look like:
  //   const connection = new Connection(RPC_ENDPOINT);
  //   const tx = await connection.getTransaction(txSignature, {
  //     commitment: "confirmed",
  //     maxSupportedTransactionVersion: 0,
  //   });
  //   if (!tx) return NextResponse.json({ error: "Tx not found" }, { status: 404 });
  //   // Parse logs for SettlementRequested event...

  // ── Enqueue settlement ──────────────────────────────────────────────────
  settlementQueue.set(txSignature, {
    status: "pending",
    communityId,
    idrAmount,
    usdcAmount,
    nonce,
    escrowPDA,
    sponsorPubkey,
    createdAt: Date.now(),
  });

  // Kick off simulated bridge processing
  simulateBridgeProcessing(txSignature, idrAmount);

  return NextResponse.json({
    success: true,
    message: "Settlement enqueued",
    txSignature,
    estimatedSettlementMs: 1200,
  });
}


/**
 * /api/settlement/status
 *
 * Polled by the frontend every 500ms to check settlement progress.
 * In production, this queries the database record written by the Python
 * oracle bridge after it processes the on-chain event and calls Xendit.
 */

import { NextRequest, NextResponse } from "next/server";
import { settlementQueue } from "@/lib/settlementQueue";

export async function GET(req: NextRequest) {
  const sig = req.nextUrl.searchParams.get("sig");

  if (!sig) {
    return NextResponse.json({ error: "Missing sig param" }, { status: 400 });
  }

  const entry = settlementQueue.get(sig);

  if (!entry) {
    return NextResponse.json({ error: "Settlement not found" }, { status: 404 });
  }

  return NextResponse.json({
    txSignature: sig,
    status: entry.status,
    communityId: entry.communityId,
    idrAmount: entry.idrAmount,
    usdcAmount: entry.usdcAmount,
    bifastRef: entry.bifastRef ?? null,
    createdAt: entry.createdAt,
    processedAt: entry.processedAt ?? null,
    elapsedMs: entry.processedAt
      ? entry.processedAt - entry.createdAt
      : Date.now() - entry.createdAt,
  });
}

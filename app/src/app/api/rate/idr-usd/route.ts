/**
 * /api/rate/idr-usd
 *
 * Proxies the IDR/USD exchange rate from multiple sources, caches for 5s,
 * and returns a composite rate used by the client to compute the USDC→IDR
 * conversion. In production, this response would be signed (HMAC) so the
 * on-chain program can verify it hasn't been tampered with.
 */

import { NextResponse } from "next/server";

let cachedRate: { rate: number; cachedAt: number } | null = null;
const CACHE_TTL_MS = 5_000;

// Simulated composite rate (production: aggregate from BI API + market feeds)
async function fetchCompositeIDRRate(): Promise<number> {
  // In production, fetch from:
  //   1. Bank Indonesia JISDOR (reference rate)
  //   2. Bloomberg / Reuters FX feed
  //   3. Aggregate and take weighted average
  //
  // For demo, return a simulated rate with realistic ±0.5% variance.
  const BASE_RATE = 16_350;
  const variance = (Math.random() - 0.5) * BASE_RATE * 0.01; // ±1%
  return Math.round(BASE_RATE + variance);
}

export async function GET() {
  const now = Date.now();

  // Return cached rate if still fresh
  if (cachedRate && now - cachedRate.cachedAt < CACHE_TTL_MS) {
    return NextResponse.json({
      rate: cachedRate.rate,
      source: "cache",
      age: now - cachedRate.cachedAt,
      currency: "IDR",
      base: "USD",
    });
  }

  const rate = await fetchCompositeIDRRate();
  cachedRate = { rate, cachedAt: now };

  return NextResponse.json({
    rate,
    source: "live",
    age: 0,
    currency: "IDR",
    base: "USD",
    timestamp: new Date(now).toISOString(),
  });
}

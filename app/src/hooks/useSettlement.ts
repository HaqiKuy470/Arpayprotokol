/**
 * useSettlement.ts
 * Core settlement hook — orchestrates the full ArPay disbursement lifecycle.
 *
 * T0 → T5 as defined in the whitepaper:
 *   T0: QRIS scanned, rate fetched
 *   T1: Wallet signed & tx submitted
 *   T2: Block confirmed, PDA funded, event emitted
 *   T3: Oracle bridge detected event (via WebSocket poll in browser)
 *   T4: Xendit disbursement POST (server-side, confirmed via API poll)
 *   T5: BI-FAST credit confirmed, escrow released
 */

"use client";

import { useCallback, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import toast from "react-hot-toast";

import { useArPayStore } from "../lib/store";
import {
  fetchRateQuote,
  buildInitiateSettlementIx,
  calcIdrAmount,
  parseQRISPayload,
  ARPAY_PROGRAM_ID,
  USDC_MINT_DEVNET,
} from "../lib/arpay-sdk";

// IDL would be imported from the Anchor build output in a real project.
// import idl from "../idl/arpay.json";

export function useSettlement() {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const store = useArPayStore();
  const nonceRef = useRef<number>(Date.now() % 1_000_000);

  // ── T0: Process scanned QRIS ────────────────────────────────────────────

  const handleQRScan = useCallback(
    async (rawQRString: string) => {
      if (!publicKey) {
        toast.error("Connect your wallet first");
        return;
      }

      store.setStatus("scanning");
      store.markTimestamp("t0");

      try {
        const payload = parseQRISPayload(rawQRString);
        store.setQRPayload(payload);

        store.setStatus("rate_fetching");
        const rate = await fetchRateQuote();
        store.setRateQuote(rate);

        const idrAmount = calcIdrAmount(store.usdcAmount, rate);
        store.setIdrAmount(idrAmount);

        store.setStatus("reviewing");
      } catch (err) {
        store.setError(
          err instanceof Error ? err.message : "QRIS parse failed"
        );
        toast.error("Could not read QRIS code");
      }
    },
    [publicKey, store]
  );

  // ── T1 → T2: Sign, submit, confirm ─────────────────────────────────────

  const submitGrant = useCallback(async () => {
    if (!publicKey || !signTransaction || !sendTransaction) {
      toast.error("Wallet not connected");
      return;
    }
    if (!store.qrPayload || !store.rateQuote) {
      toast.error("Scan a QRIS code first");
      return;
    }

    const nonce = nonceRef.current++;
    store.setNonce(nonce);
    store.setStatus("signing");

    try {
      // Build the program client (in production, pass the real IDL)
      const provider = new anchor.AnchorProvider(
        connection,
        { publicKey, signTransaction, sendTransaction } as anchor.Wallet,
        { commitment: "confirmed" }
      );
      // const program = new anchor.Program(idl as anchor.Idl, ARPAY_PROGRAM_ID, provider);

      // For demo/devnet, we build a mock instruction.
      // In production, replace with:
      // const { instruction, escrowPDA } = await buildInitiateSettlementIx(...)
      const escrowPDA = `EsCr${Math.random().toString(36).slice(2, 10)}...`;
      store.setEscrowPDA(escrowPDA);

      // T1: Wallet signed
      store.markTimestamp("t1");
      toast.loading("Waiting for wallet signature...", { id: "sign" });

      // Simulate tx submission latency (devnet ~400ms)
      await new Promise((r) => setTimeout(r, 400));

      const mockSig = Array.from({ length: 87 }, () =>
        "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[
          Math.floor(Math.random() * 58)
        ]
      ).join("");

      store.setTxSignature(mockSig);
      toast.dismiss("sign");

      // T2: Block confirmed
      store.setStatus("confirming");
      store.markTimestamp("t2");
      toast.success("Block confirmed ✓", { duration: 2000 });

      // ── Notify our backend to start the bridge flow ───────────────────
      const response = await fetch("/api/settlement/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txSignature: mockSig,
          communityId: store.qrPayload.nmid,
          idrAmount: store.idrAmount,
          usdcAmount: store.usdcAmount,
          nonce,
          escrowPDA,
          sponsorPubkey: publicKey.toString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Settlement API error: ${response.status}`);
      }

      store.setStatus("bridge_pending");
      store.markTimestamp("t3");

      // Poll for T4/T5 completion
      await pollSettlementStatus(mockSig);
    } catch (err) {
      store.setError(
        err instanceof Error ? err.message : "Transaction failed"
      );
      toast.error("Transaction failed — funds will be refunded");
    }
  }, [publicKey, signTransaction, sendTransaction, connection, store]);

  // ── Poll for oracle bridge + BI-FAST completion ─────────────────────────

  const pollSettlementStatus = useCallback(
    async (txSignature: string) => {
      const maxAttempts = 30;
      const pollIntervalMs = 500;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));

        try {
          const res = await fetch(
            `/api/settlement/status?sig=${txSignature}`
          );
          const data = await res.json();

          if (data.status === "disbursed") {
            store.setStatus("disbursing");
            store.markTimestamp("t4");

            // Brief delay to show T4 state
            await new Promise((r) => setTimeout(r, 300));

            store.markTimestamp("t5");
            store.setStatus("complete");

            store.addHistoryRecord({
              id: txSignature,
              hubName: store.qrPayload?.merchantName ?? "Unknown Hub",
              hubNmid: store.qrPayload?.nmid ?? "",
              usdcAmount: store.usdcAmount,
              idrAmount: store.idrAmount,
              rate: store.rateQuote?.usdcIdrRate ?? 0,
              txSignature,
              escrowPDA: store.escrowPDA ?? "",
              nonce: store.nonce ?? 0,
              bifastRef: data.bifastRef,
              elapsedMs:
                (store.t5Ms ?? 0) - (store.settlementStartMs ?? 0),
              createdAt: Date.now(),
              status: "complete",
            });

            toast.success(
              `Rp ${store.idrAmount.toLocaleString("id-ID")} sent via BI-FAST ✓`
            );
            return;
          }

          if (data.status === "refunded") {
            store.setStatus("refunded");
            toast("USDC refunded to sponsor wallet", { icon: "↩" });
            return;
          }

          // Update intermediate status labels
          if (data.status === "bridge_processing") {
            store.setStatus("bridge_pending");
          } else if (data.status === "xendit_dispatched") {
            store.setStatus("disbursing");
            store.markTimestamp("t4");
          }
        } catch {
          // Network error during poll — continue
          console.warn(`Poll attempt ${attempt} failed, retrying...`);
        }
      }

      store.setError("Settlement timed out — please check transaction history");
    },
    [store]
  );

  // ── Refresh rate quote ──────────────────────────────────────────────────

  const refreshRate = useCallback(async () => {
    try {
      const rate = await fetchRateQuote();
      store.setRateQuote(rate);
      const idrAmount = calcIdrAmount(store.usdcAmount, rate);
      store.setIdrAmount(idrAmount);
    } catch {
      toast.error("Could not refresh rate");
    }
  }, [store]);

  return {
    handleQRScan,
    submitGrant,
    refreshRate,
    isWalletConnected: !!publicKey,
  };
}

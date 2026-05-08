"use client";

/**
 * SettlementTimeline.tsx
 * Renders the animated T0→T5 lifecycle from the ArPay whitepaper (Section 4).
 * Reads from the Zustand store and auto-updates as each milestone is marked.
 */

import { useArPayStore } from "../lib/store";
import styles from "./SettlementTimeline.module.css";

const STEPS = [
  {
    key: "t0",
    label: "T₀ — QRIS Scanned",
    sub: "PWA decode NMID · Fetch USDC/IDR rate (Pyth Network)",
    layer: "L1",
  },
  {
    key: "t1",
    label: "T₁ — Wallet Signed",
    sub: "Eco-sponsor sign tx · Submit ke Solana RPC",
    layer: "L1",
  },
  {
    key: "t2",
    label: "T₂ — Block Confirmed",
    sub: "USDC → PDA escrow · SettlementRequested event emitted",
    layer: "L2",
  },
  {
    key: "t3",
    label: "T₃ — Oracle Detected",
    sub: "Python daemon WSS · Verify block ≥ Confirmed",
    layer: "L3",
  },
  {
    key: "t4",
    label: "T₄ — Xendit POST",
    sub: "POST /v2/disbursements · bank_code + account_number",
    layer: "L3",
  },
  {
    key: "t5",
    label: "T₅ — BI-FAST Credit",
    sub: "Community hub bank account credited · IDR diterima",
    layer: "L3",
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const LAYER_COLORS: Record<string, string> = {
  L1: "#97C459",
  L2: "#5DCAA5",
  L3: "#5B9BE8",
};

export function SettlementTimeline() {
  const store = useArPayStore();

  const getMs = (key: StepKey): number | null => {
    const map: Record<StepKey, number | null> = {
      t0: store.t0Ms,
      t1: store.t1Ms,
      t2: store.t2Ms,
      t3: store.t3Ms,
      t4: store.t4Ms,
      t5: store.t5Ms,
    };
    return map[key];
  };

  const getStatus = (key: StepKey, idx: number) => {
    const ms = getMs(key);
    if (ms !== null) return "done";
    // Active = the step right after the last completed one
    const prevKey = STEPS[idx - 1]?.key as StepKey | undefined;
    if (idx === 0 && store.status !== "idle") return "active";
    if (prevKey && getMs(prevKey) !== null) return "active";
    return "waiting";
  };

  // Progress percentage
  const doneCount = STEPS.filter((s) => getMs(s.key) !== null).length;
  const progress = (doneCount / STEPS.length) * 100;

  return (
    <div className={styles.wrapper}>
      {/* Progress bar */}
      <div className={styles.progressBar}>
        <div
          className={styles.progressFill}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Layer legend */}
      <div className={styles.legend}>
        {Object.entries(LAYER_COLORS).map(([layer, color]) => (
          <span key={layer} className={styles.legendItem}>
            <span
              className={styles.legendDot}
              style={{ background: color }}
            />
            {layer === "L1"
              ? "Client (Next.js)"
              : layer === "L2"
              ? "On-chain (Solana)"
              : "Oracle Bridge"}
          </span>
        ))}
      </div>

      {/* Timeline steps */}
      <div className={styles.timeline}>
        <div className={styles.line} />
        {STEPS.map((step, idx) => {
          const ms = getMs(step.key);
          const status = getStatus(step.key, idx);
          const color = LAYER_COLORS[step.layer];

          return (
            <div key={step.key} className={styles.item}>
              <div
                className={`${styles.dot} ${styles[status]}`}
                style={
                  status === "done"
                    ? { background: color, borderColor: color }
                    : status === "active"
                    ? { borderColor: color }
                    : {}
                }
              >
                {status === "done" && (
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                    <path d="M1.5 4l2 2 3-3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {status === "active" && (
                  <span
                    className={styles.activePulse}
                    style={{ borderColor: color }}
                  />
                )}
              </div>

              <div className={styles.content}>
                <div className={styles.header}>
                  <span
                    className={styles.stepLabel}
                    style={status === "done" ? { color } : {}}
                  >
                    {step.label}
                  </span>
                  <span
                    className={styles.layerTag}
                    style={{ color, borderColor: `${color}33` }}
                  >
                    {step.layer}
                  </span>
                  {ms !== null && (
                    <span className={styles.elapsed}>+{(ms / 1000).toFixed(2)}s</span>
                  )}
                  {status === "active" && (
                    <span className={styles.activeBadge}>processing...</span>
                  )}
                </div>
                <div className={styles.sub}>{step.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* On-chain data panel (visible after T2) */}
      {store.txSignature && (
        <div className={styles.onChainPanel}>
          <p className={styles.onChainTitle}>On-chain data</p>
          <div className={styles.onChainRow}>
            <span className={styles.onChainLabel}>Tx signature</span>
            <a
              className={styles.onChainVal}
              href={`https://solscan.io/tx/${store.txSignature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              {store.txSignature.slice(0, 20)}...
            </a>
          </div>
          {store.escrowPDA && (
            <div className={styles.onChainRow}>
              <span className={styles.onChainLabel}>PDA escrow</span>
              <span className={styles.onChainVal}>{store.escrowPDA.slice(0, 20)}...</span>
            </div>
          )}
          <div className={styles.onChainRow}>
            <span className={styles.onChainLabel}>Nonce</span>
            <span className={styles.onChainVal}>{store.nonce}</span>
          </div>
          <div className={styles.onChainRow}>
            <span className={styles.onChainLabel}>Escrow status</span>
            <span className={styles.onChainVal}>
              {store.status === "complete"
                ? "RELEASED ✓"
                : store.status === "refunded"
                ? "REFUNDED ↩"
                : "LOCKED 🔒"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * page.tsx — ArPay main application page.
 *
 * Orchestrates the 4-step settlement flow:
 *   Step 0: Scan QRIS (QRScanner)
 *   Step 1: Review grant (GrantReview)
 *   Step 2: Settlement in progress (SettlementTimeline)
 *   Step 3: Confirmation receipt (SettlementReceipt)
 */

import { useState, useCallback } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { QRScanner } from "../components/QRScanner";
import { GrantReview } from "../components/GrantReview";
import { SettlementTimeline } from "../components/SettlementTimeline";
import { SettlementReceipt } from "../components/SettlementReceipt";
import { useSettlement } from "../hooks/useSettlement";
import { useArPayStore } from "../lib/store";
import styles from "./page.module.css";

type Step = 0 | 1 | 2 | 3;

const STEP_LABELS = ["Scan QRIS", "Review Grant", "Settlement", "Confirmation"];

export default function Home() {
  const [step, setStep] = useState<Step>(0);
  const store = useArPayStore();
  const { handleQRScan, submitGrant } = useSettlement();

  const isSubmitting = ["signing", "confirming", "bridge_pending", "disbursing"].includes(
    store.status
  );

  // ── Step transitions ──────────────────────────────────────────────────────

  const onQRScan = useCallback(
    async (raw: string) => {
      await handleQRScan(raw);
      setStep(1);
    },
    [handleQRScan]
  );

  const onSubmitGrant = useCallback(async () => {
    setStep(2);
    await submitGrant();
    if (store.status === "complete" || store.status === "refunded") {
      setStep(3);
    }
  }, [submitGrant, store.status]);

  // Watch for completion in the store (async update after polling)
  if (step === 2 && (store.status === "complete" || store.status === "refunded") && store.history.length > 0) {
    setTimeout(() => setStep(3), 500);
  }

  const onNewGrant = useCallback(() => {
    store.reset();
    setStep(0);
  }, [store]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.page}>
      {/* Top nav */}
      <nav className={styles.nav}>
        <div className={styles.navLogo}>
          <span className={styles.navDot} />
          ArPay
          <span className={styles.navTag}>Devnet</span>
        </div>
        <WalletMultiButton />
      </nav>

      <main className={styles.main}>
        {/* Step indicator */}
        <div className={styles.steps}>
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={`${styles.stepItem} ${
                i === step
                  ? styles.stepActive
                  : i < step
                  ? styles.stepDone
                  : styles.stepWaiting
              }`}
            >
              <span className={styles.stepNum}>
                {i < step ? "✓" : i + 1}
              </span>
              <span className={styles.stepLabel}>{label}</span>
            </div>
          ))}
        </div>

        {/* Panel */}
        <div className={styles.panel}>
          {step === 0 && (
            <section>
              <h1 className={styles.panelTitle}>Scan QRIS Community Hub</h1>
              <p className={styles.panelSub}>
                Scan the QRIS code from a recycling cooperative, composting hub, or DePIN node operator.
              </p>
              <QRScanner onScan={onQRScan} active={step === 0} />
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 className={styles.panelTitle}>Review Eco-Incentive Grant</h1>
              <p className={styles.panelSub}>
                Verify the community hub details and grant amount before signing the transaction.
              </p>
              <GrantReview
                onSubmit={onSubmitGrant}
                onBack={() => { store.reset(); setStep(0); }}
                isSubmitting={isSubmitting}
              />
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className={styles.panelTitle}>Settlement In Progress</h1>
              <p className={styles.panelSub}>
                Tri-layer execution: Solana → Oracle Bridge → Xendit → BI-FAST
              </p>
              <div className={styles.metricsRow}>
                <div className={styles.metric}>
                  <ElapsedCounter startMs={store.settlementStartMs} />
                  <span>elapsed</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricVal + " " + styles.mono}>
                    {store.status.replace("_", " ").toUpperCase()}
                  </span>
                  <span>status</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricVal + " " + styles.mono}>
                    {store.usdcAmount.toFixed(2)}
                  </span>
                  <span>USDC</span>
                </div>
              </div>
              <SettlementTimeline />
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className={styles.panelTitle}>Grant Successful ✓</h1>
              <SettlementReceipt onNewGrant={onNewGrant} />
            </section>
          )}
        </div>

        {/* Footer */}
        <footer className={styles.footer}>
          <span>ArPay · Eco-Incentive Settlement Protocol</span>
          <span className={styles.mono}>arpay.my.id · Malang, Indonesia</span>
        </footer>
      </main>
    </div>
  );
}

/** Live elapsed timer for step 2 */
function ElapsedCounter({ startMs }: { startMs: number | null }) {
  const [elapsed, setElapsed] = useState("0.0");

  if (startMs) {
    setTimeout(() => {
      setElapsed(((Date.now() - startMs) / 1000).toFixed(1));
    }, 100);
  }

  return (
    <span className={styles.metricVal + " " + styles.mono}>{elapsed}s</span>
  );
}

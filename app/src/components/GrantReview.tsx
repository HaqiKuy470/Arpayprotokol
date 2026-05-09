"use client";

/**
 * GrantReview.tsx
 * Displays the rate quote, IDR conversion, and settlement parameters
 * before the eco-sponsor signs the transaction.
 */

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useArPayStore } from "../lib/store";
import { calcIdrAmount } from "../lib/arpay-sdk";
import styles from "./GrantReview.module.css";

interface GrantReviewProps {
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export function GrantReview({ onSubmit, onBack, isSubmitting }: GrantReviewProps) {
  const { publicKey } = useWallet();
  const store = useArPayStore();
  const [rateAge, setRateAge] = useState(0);

  // Track rate freshness
  useEffect(() => {
    if (!store.rateQuote) return;
    const interval = setInterval(() => {
      setRateAge(Math.floor((Date.now() - store.rateQuote!.timestamp) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [store.rateQuote]);

  const handleUsdcChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = parseFloat(e.target.value) || 0;
      store.setUsdcAmount(val);
      if (store.rateQuote) {
        store.setIdrAmount(calcIdrAmount(val, store.rateQuote));
      }
    },
    [store]
  );

  if (!store.qrPayload || !store.rateQuote) return null;

  const { qrPayload: hub, rateQuote: rate } = store;
  const slippageOk = rate.pythConfidence / rate.usdcUsdPrice < 0.005;

  return (
    <div className={styles.wrapper}>
      {/* Community Hub Info */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.dot} />
          Community Hub
        </h2>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <span className={styles.fieldVal}>{hub.merchantName}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>NMID</span>
            <span className={`${styles.fieldVal} ${styles.mono}`}>{hub.nmid}</span>
          </div>
        </div>
        <div className={styles.grid2}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Network</span>
            <span className={styles.fieldVal}>QRIS · BI-FAST</span>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Status</span>
            <span className={`${styles.fieldVal} ${styles.verified}`}>
              ✓ BI Verified
            </span>
          </div>
        </div>
      </section>

      {/* Rate + Amount */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.dot} />
          Grant Amount
        </h2>

        <div className={styles.inputGroup}>
          <label className={styles.inputLabel}>USDC Amount</label>
          <div className={styles.inputRow}>
            <input
              className={styles.input}
              type="number"
              min={0.01}
              max={100000}
              step={0.01}
              value={store.usdcAmount}
              onChange={handleUsdcChange}
              disabled={isSubmitting}
            />
            <span className={styles.inputSuffix}>USDC</span>
          </div>
        </div>

        {/* Rate display */}
        <div className={styles.rateCard}>
          <div className={styles.rateFrom}>
            <div className={styles.rateAmt}>
              {store.usdcAmount.toFixed(2)}
            </div>
            <div className={styles.rateSub}>USDC (Circle)</div>
          </div>
          <div className={styles.rateArrow}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5 12h14M14 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div className={styles.rateTo}>
            <div className={styles.rateAmt}>
              {store.idrAmount.toLocaleString("id-ID")}
            </div>
            <div className={styles.rateSub}>IDR (BI-FAST)</div>
          </div>
        </div>

        <div className={styles.rateMetaRow}>
          <span className={styles.rateMeta}>
            1 USDC = Rp {rate.usdcIdrRate.toLocaleString("id-ID")}
          </span>
          <span className={styles.rateFreshness}>
            {slippageOk ? (
              <span className={styles.pill + " " + styles.pillGreen}>
                Pyth ✓ {rateAge}s
              </span>
            ) : (
              <span className={styles.pill + " " + styles.pillAmber}>
                High Slippage
              </span>
            )}
          </span>
        </div>
      </section>

      {/* Settlement summary */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <span className={styles.dot} />
          Settlement Summary
        </h2>
        <div className={styles.summaryRows}>
          {[
            { label: "Grant amount", val: `${store.usdcAmount.toFixed(6)} USDC` },
            { label: "Protocol fee", val: "0.00 USDC (0%)" },
            { label: "Solana tx fee", val: "≈ 0.000005 SOL" },
            { label: "Escrow timeout", val: "120 seconds" },
            { label: "Settlement layer", val: "Solana → Xendit → BI-FAST" },
          ].map(({ label, val }) => (
            <div key={label} className={styles.summaryRow}>
              <span className={styles.summaryLabel}>{label}</span>
              <span className={styles.summaryVal}>{val}</span>
            </div>
          ))}
          <div className={styles.summaryRow + " " + styles.summaryRowLast}>
            <span className={styles.summaryLabel}>Community hub receives</span>
            <span className={`${styles.summaryVal} ${styles.summaryGreen}`}>
              Rp {store.idrAmount.toLocaleString("id-ID")}
            </span>
          </div>
        </div>
      </section>

      {/* CTA */}
      {publicKey ? (
        <button
          className={styles.submitBtn}
          onClick={onSubmit}
          disabled={isSubmitting || store.usdcAmount <= 0 || !slippageOk}
        >
          {isSubmitting ? (
            <>
              <span className={styles.spinner} />
              Waiting for wallet signature...
            </>
          ) : (
            <>
              <WalletIcon />
              Sign & Submit via Wallet
            </>
          )}
        </button>
      ) : (
        <div className={styles.walletBtnWrapper}>
          <WalletMultiButton />
          <p className={styles.walletHint}>
            Connect your Solana wallet (Phantom / Solflare) to continue
          </p>
        </div>
      )}

      <button className={styles.backBtn} onClick={onBack} disabled={isSubmitting}>
        ← Back to scanner
      </button>
    </div>
  );
}

function WalletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="2" y="6" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M2 10h20" stroke="currentColor" strokeWidth="1.5"/>
      <circle cx="17" cy="15" r="1.5" fill="currentColor"/>
    </svg>
  );
}

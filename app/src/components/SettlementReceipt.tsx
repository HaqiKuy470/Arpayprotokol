"use client";

/**
 * SettlementReceipt.tsx
 * Final confirmation screen shown after T5 (BI-FAST credit confirmed).
 * Displays the full atomic settlement receipt and regulatory status.
 */

import { useArPayStore } from "../lib/store";
import styles from "./SettlementReceipt.module.css";

interface SettlementReceiptProps {
  onNewGrant: () => void;
}

export function SettlementReceipt({ onNewGrant }: SettlementReceiptProps) {
  const store = useArPayStore();
  const latest = store.history[0];

  if (!latest) return null;

  const elapsedSec = (latest.elapsedMs / 1000).toFixed(2);

  return (
    <div className={styles.wrapper}>
      {/* Success banner */}
      <div className={styles.banner}>
        <div className={styles.bannerIcon}>✓</div>
        <div className={styles.bannerText}>
          <strong>Grant successfully disbursed</strong>
          <span>
            {latest.hubName} received{" "}
            <span className={styles.idrAmt}>
              Rp {latest.idrAmount.toLocaleString("id-ID")}
            </span>{" "}
            via BI-FAST in {elapsedSec}s
          </span>
        </div>
      </div>

      {/* Settlement receipt */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <ReceiptIcon /> Settlement Receipt
        </h2>
        <div className={styles.rows}>
          {[
            { label: "Eco-sponsor",         val: "EcSp...7xKm",                   mono: true },
            { label: "Community hub",        val: latest.hubName,                  mono: false },
            { label: "NMID",                 val: latest.hubNmid,                  mono: true },
            { label: "USDC deducted",        val: `${latest.usdcAmount.toFixed(6)} USDC`, mono: true },
            { label: "Rate",                 val: `1 USDC = Rp ${latest.rate.toLocaleString("id-ID")}`, mono: true },
            { label: "IDR disbursed",        val: `Rp ${latest.idrAmount.toLocaleString("id-ID")}`, mono: true, green: true },
            { label: "Total elapsed",        val: `${elapsedSec}s`,               mono: true, green: true },
            { label: "Solana tx",            val: `${latest.txSignature.slice(0, 22)}...`, mono: true, link: `https://solscan.io/tx/${latest.txSignature}?cluster=devnet` },
            { label: "BI-FAST ref",          val: latest.bifastRef ?? "—",         mono: true },
            { label: "Escrow PDA",           val: `${latest.escrowPDA.slice(0, 22)}...`, mono: true },
            { label: "Nonce",                val: latest.nonce.toString(),         mono: true },
            { label: "Atomic guarantee",     val: "P(F∪R | T) = 1 ✓",            mono: false, green: true },
          ].map(({ label, val, mono, green, link }) => (
            <div key={label} className={styles.row}>
              <span className={styles.rowLabel}>{label}</span>
              {link ? (
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className={`${styles.rowVal} ${styles.mono} ${styles.link}`}
                >
                  {val}
                </a>
              ) : (
                <span
                  className={`${styles.rowVal} ${mono ? styles.mono : ""} ${green ? styles.green : ""}`}
                >
                  {val}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Regulatory status */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>
          <ShieldIcon /> OJK/BI Regulatory Status
        </h2>
        <div className={styles.regGrid}>
          <div className={styles.regItem}>
            <span className={styles.regCheck}>✓</span>
            <span>Community hub is <strong>not a VASP</strong> — zero on-chain presence</span>
          </div>
          <div className={styles.regItem}>
            <span className={styles.regCheck}>✓</span>
            <span>Disbursement via Xendit (OJK-licensed) → BI-FAST</span>
          </div>
          <div className={styles.regItem}>
            <span className={styles.regCheck}>✓</span>
            <span>Eco-sponsor uses self-custody wallet — not a custodian</span>
          </div>
          <div className={styles.regItem}>
            <span className={styles.regCheck}>✓</span>
            <span>ArPay operator operates under standard Xendit KYB</span>
          </div>
        </div>
      </section>

      {/* Actions */}
      <button className={styles.newBtn} onClick={onNewGrant}>
        <PlusIcon /> Send New Grant
      </button>
    </div>
  );
}

function ReceiptIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M4 4h16v16H4zM9 9h6M9 12h6M9 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 3L4 7v5c0 4.4 3.4 8.5 8 9.5 4.6-1 8-5.1 8-9.5V7L12 3z" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

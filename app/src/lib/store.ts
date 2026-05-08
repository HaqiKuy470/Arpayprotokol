/**
 * store.ts
 * Zustand global state for the ArPay PWA.
 * Tracks settlement flow state across all components.
 */

import { create } from "zustand";
import { QRISPayload, RateQuote } from "./arpay-sdk";

export type SettlementStatus =
  | "idle"
  | "scanning"
  | "rate_fetching"
  | "reviewing"
  | "signing"
  | "confirming"     // tx submitted, waiting for block confirmation
  | "bridge_pending" // oracle bridge processing
  | "disbursing"     // Xendit API called
  | "complete"
  | "refunded"
  | "error";

export interface SettlementRecord {
  id: string;
  hubName: string;
  hubNmid: string;
  usdcAmount: number;
  idrAmount: number;
  rate: number;
  txSignature: string;
  escrowPDA: string;
  nonce: number;
  bifastRef?: string;
  elapsedMs: number;
  createdAt: number;
  status: "complete" | "refunded";
}

interface ArPayStore {
  // ── Current settlement flow ─────────────────────────────────────────────
  status: SettlementStatus;
  qrPayload: QRISPayload | null;
  rateQuote: RateQuote | null;
  usdcAmount: number;
  idrAmount: number;
  txSignature: string | null;
  escrowPDA: string | null;
  nonce: number | null;
  errorMessage: string | null;
  settlementStartMs: number | null;

  // Timeline timestamps (ms elapsed from start)
  t0Ms: number | null;
  t1Ms: number | null;
  t2Ms: number | null;
  t3Ms: number | null;
  t4Ms: number | null;
  t5Ms: number | null;

  // ── History ─────────────────────────────────────────────────────────────
  history: SettlementRecord[];

  // ── Actions ─────────────────────────────────────────────────────────────
  setStatus: (s: SettlementStatus) => void;
  setQRPayload: (p: QRISPayload) => void;
  setRateQuote: (r: RateQuote) => void;
  setUsdcAmount: (a: number) => void;
  setIdrAmount: (a: number) => void;
  setTxSignature: (sig: string) => void;
  setEscrowPDA: (pda: string) => void;
  setNonce: (n: number) => void;
  setError: (msg: string) => void;
  markTimestamp: (step: "t0"|"t1"|"t2"|"t3"|"t4"|"t5") => void;
  addHistoryRecord: (r: SettlementRecord) => void;
  reset: () => void;
}

const initialState = {
  status: "idle" as SettlementStatus,
  qrPayload: null,
  rateQuote: null,
  usdcAmount: 10,
  idrAmount: 0,
  txSignature: null,
  escrowPDA: null,
  nonce: null,
  errorMessage: null,
  settlementStartMs: null,
  t0Ms: null,
  t1Ms: null,
  t2Ms: null,
  t3Ms: null,
  t4Ms: null,
  t5Ms: null,
  history: [],
};

export const useArPayStore = create<ArPayStore>((set, get) => ({
  ...initialState,

  setStatus: (status) => set({ status }),
  setQRPayload: (qrPayload) => set({ qrPayload }),
  setRateQuote: (rateQuote) => set({ rateQuote }),
  setUsdcAmount: (usdcAmount) => set({ usdcAmount }),
  setIdrAmount: (idrAmount) => set({ idrAmount }),
  setTxSignature: (txSignature) => set({ txSignature }),
  setEscrowPDA: (escrowPDA) => set({ escrowPDA }),
  setNonce: (nonce) => set({ nonce }),
  setError: (errorMessage) => set({ status: "error", errorMessage }),

  markTimestamp: (step) => {
    const now = Date.now();
    const start = get().settlementStartMs ?? now;
    const elapsed = now - start;
    const key = `${step}Ms` as keyof ArPayStore;

    if (step === "t0") {
      set({ settlementStartMs: now, t0Ms: 0 });
    } else {
      set({ [key]: elapsed } as Partial<ArPayStore>);
    }
  },

  addHistoryRecord: (record) =>
    set((state) => ({ history: [record, ...state.history].slice(0, 50) })),

  reset: () => set({ ...initialState, history: get().history }),
}));

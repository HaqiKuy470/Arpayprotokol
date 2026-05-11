# ArPay — Eco-Incentive Settlement Protocol

> Distribute USDC green incentive grants to Indonesian community hubs via QRIS  
> and BI-FAST in **under 5 seconds** — with zero on-chain exposure for receivers.

---

## About The Project

ArPay is an innovative eco-incentive settlement protocol designed to bridge the gap between global Web3 capital and local environmental initiatives in Indonesia. It enables eco-sponsors to instantly distribute green incentive grants (in USDC on the Solana blockchain) directly to grassroots community hubs—such as recycling cooperatives, composting centers, and DePIN node operators.

**The Problem:** Traditional cross-border funding for local green projects is slow, incurs high fees, and requires local hubs to navigate complex crypto exchanges, wallets, or regulatory hurdles.

**The Solution:** ArPay leverages the speed of Solana, Pyth oracle price feeds, and a Python-based Oracle Bridge connected to Xendit's disbursement API. This allows sponsors to send USDC while the receiving community hub gets Indonesian Rupiah (IDR) directly into their standard bank account via BI-FAST and QRIS in under 5 seconds. The local hub needs *zero* crypto knowledge and holds *no* crypto assets, ensuring full regulatory compliance while benefiting from Web3 efficiency.

---

## Architecture

```
┌────────────────────────┐
│  L1 — CLIENT (Next.js) │  eco-sponsor scans QRIS, signs tx via Phantom/Solflare
└──────────┬─────────────┘
           │ USDC tx + SettlementRequested event
           ▼
┌────────────────────────┐
│  L2 — ON-CHAIN (Solana)│  Anchor program: PDA escrow, Pyth price check
└──────────┬─────────────┘
           │ WebSocket event (WSS)
           ▼
┌────────────────────────┐
│  L3 — ORACLE BRIDGE    │  Python asyncio daemon
│        + Xendit API    │  → POST /v2/disbursements → BI-FAST → bank credit
└────────────────────────┘
```

---

## Repository Structure

```
arpay/
├── programs/arpay/src/lib.rs     # Anchor on-chain program (Rust)
├── tests/arpay.test.ts           # Anchor integration tests
├── Anchor.toml                   # Anchor workspace config
├── .env.example                  # All required environment variables
│
├── app/                          # Next.js 14 PWA (eco-sponsor UI)
│   └── src/
│       ├── app/
│       │   ├── layout.tsx        # Root layout + wallet providers
│       │   ├── page.tsx          # Main 4-step settlement flow
│       │   └── api/
│       │       ├── settlement/
│       │       │   ├── initiate/ # POST — enqueue settlement
│       │       │   └── status/   # GET  — poll bridge status
│       │       └── rate/
│       │           └── idr-usd/  # GET  — IDR/USD rate proxy
│       ├── components/
│       │   ├── QRScanner.tsx           # jsQR camera scanner + hub picker
│       │   ├── GrantReview.tsx         # Rate display + sign CTA
│       │   ├── SettlementTimeline.tsx  # Animated T0→T5 lifecycle
│       │   └── SettlementReceipt.tsx   # Final confirmation + receipt
│       ├── hooks/
│       │   └── useSettlement.ts  # Core settlement orchestration hook
│       └── lib/
│           ├── arpay-sdk.ts      # PDA derivation, tx builder, QRIS parser
│           └── store.ts          # Zustand global state
│
└── oracle/
    ├── oracle_bridge.py          # Python asyncio oracle daemon
    └── requirements.txt          # Python dependencies
```

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Rust | 1.75+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Solana CLI | 1.18+ | `sh -c "$(curl -sSfL https://release.solana.com/stable/install)"` |
| Anchor | 0.29.0 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked` |
| Node.js | 20+ | Via nvm recommended |
| Python | 3.11+ | For the oracle bridge |
| Yarn | 1.22+ | `npm i -g yarn` |

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/arshaka/arpay
cd arpay
cp .env.example .env
# Edit .env with your keys
```

### 2. Build and deploy the Anchor program (devnet)

```bash
# Configure Solana CLI for devnet
solana config set --url devnet

# Create a new keypair if needed
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 2

# Build the program
anchor build

# Deploy to devnet
anchor deploy

# Update NEXT_PUBLIC_ARPAY_PROGRAM_ID in .env with the output program ID
```

### 3. Run the Next.js frontend

```bash
cd app
yarn install
yarn dev
# → http://localhost:3000
```

### 4. Run the Python oracle bridge

```bash
cd oracle
python3 -m venv venv
source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Copy and fill in the oracle-specific .env
export SOLANA_RPC_URL=https://api.devnet.solana.com
export SOLANA_WSS_URL=wss://api.devnet.solana.com
export ARPAY_PROGRAM_ID=<your_deployed_program_id>
export ARPAY_AUTHORITY_KEY=<base58_authority_secret_key>
export XENDIT_API_KEY=xnd_development_<your_key>

python oracle_bridge.py
```

### 5. Run integration tests

```bash
cd arpay/
anchor test
```

---

## Devnet Testing Flow

1. Open `http://localhost:3000` in browser
2. Connect Phantom or Solflare wallet (set to **Devnet**)
3. Get devnet USDC: `spl-token transfer 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU 10 <your_address> --url devnet --allow-unfunded-recipient --fund-recipient`
4. Click **Scan QRIS** → select a demo community hub
5. Enter USDC amount → click **Sign & Submit**
6. Watch T0→T5 settlement timeline animate in real time

---

## Xendit Test Mode

Use Xendit's sandbox to test disbursements without real transfers:

```bash
XENDIT_API_KEY=xnd_development_YOUR_TEST_KEY
```

Xendit sandbox bank codes for testing:
- `BCA` — Bank Central Asia
- `BNI` — Bank Negara Indonesia  
- `MANDIRI` — Bank Mandiri
- `BRI` — Bank Rakyat Indonesia

---

## Security Considerations

| Risk | Mitigation |
|------|-----------|
| Oracle manipulation | Pyth slippage tolerance 0.5% enforced on-chain |
| Double spend | PDA nonce + `AccountAlreadyInitialized` constraint |
| Bridge failure | 120s timeout → permissionless refund path |
| Daemon crash | Restart recovery via `getProgramAccounts` scan |
| Authority key compromise | Use hardware wallet or AWS KMS for production |

---

## Production Deployment

### Oracle bridge: systemd service

```ini
# /etc/systemd/system/arpay-bridge.service
[Unit]
Description=ArPay Oracle Bridge
After=network.target

[Service]
User=arpay
WorkingDirectory=/opt/arpay/oracle
EnvironmentFile=/opt/arpay/.env
ExecStart=/opt/arpay/oracle/venv/bin/python oracle_bridge.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable arpay-bridge
sudo systemctl start arpay-bridge
sudo journalctl -u arpay-bridge -f
```

### Frontend: Vercel

```bash
cd app
vercel deploy --prod
```

### RPC: Use premium provider for production

```bash
# Helius (recommended for WebSocket reliability)
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
SOLANA_WSS_URL=wss://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

---

## References

- [Solana Pay Spec](https://docs.solanapay.com/spec)
- [Pyth Network Price Feeds](https://pyth.network/developers/price-feed-ids)
- [Xendit Disbursements API](https://developers.xendit.co/api-reference/#disbursements)
- [Bank Indonesia QRIS Standard](https://www.bi.go.id/id/sistem-pembayaran/standar-nasional/qris.aspx)
- [About Arpay](https://hello.arpay.my.id/)
- [ArPay Whitepaper](https://hello.arpay.my.id/docs/ArPay_Protocol.pdf)
---

*Built by Moh Dhiyaulhaq Ulumuddin · arshaka@zohomail.com · Malang, Indonesia*

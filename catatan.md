# ArPay Hackathon Submission - Colosseum (Solana)

### 1. WHAT ARE YOU BUILDING, AND WHO IS IT FOR?
ArPay is a tri-layer, non-custodial settlement infrastructure that bridges Solana's high-speed ecosystem with Southeast Asia's traditional fiat payment networks (QRIS). It acts as an invisible off-ramp layer, allowing Web3 liquidity to flow into the real economy without the friction of centralized exchanges.

Target Audience:
1. DePIN Networks & Web3 Projects: Automated off-ramp infrastructure to distribute rewards that users can spend instantly at any local merchant.
2. Web3 Natives & Freelancers: Spend stablecoins (USDC) directly for daily needs (coffee, groceries, bills) without waiting days for CEX withdrawals.
3. Local Merchants (30M+ in Indonesia): Accept Web3 liquidity seamlessly via their existing QRIS codes. They receive 100% local fiat (IDR) directly to their bank accounts, bypassing crypto volatility and wallet management friction.

---

### 2. WHY DID YOU DECIDE TO BUILD THIS, AND WHY BUILD IT NOW?
Real-world crypto adoption is structurally broken at the merchant boundary. Merchants operate in strict fiat economies and refuse to adopt crypto terminals due to high volatility, regulatory restrictions, and complex UX. Meanwhile, Web3 users have programmable money but nowhere to spend it locally.

Why now?
1. Solana’s Performance: Sub-second finality and negligible fees finally make point-of-sale blockchain transactions viable, matching the speed of traditional fiat rails.
2. DePIN Explosion: The surge of DePIN projects on Solana demands an instant off-ramp. Users earning tokens from hardware shouldn't navigate complex KYC/CEX hurdles just to buy a meal.
3. Atomic Guarantees: By utilizing Anchor PDAs for atomic escrows, we unlock trustless settlements where funds are only moved when the bridge confirms the fiat delivery.

---

### 3. WHAT TECHNOLOGIES ARE YOU USING OR INTEGRATING WITH?
Solana (Rust/Anchor), Pyth Network (Price Oracles), Next.js 14 PWA (Solana Pay), Python (Oracle Bridge), Xendit API (BI-FAST Fiat Rails), Cursor & Copilot.

---

### 4. PROJECT WEBSITE (PUBLIC)
https://arpay.my.id

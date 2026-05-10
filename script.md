# ArPay Presentation Script: Bridging Solana to the Real World

**Duration:** ~3-5 Minutes
**Format:** Demo Video / Pitch Presentation

---

### [00:00 - 00:45] INTRODUCTION: The Merchant Gap
**Visual:** Shot of local street food stall or a small cafe in Indonesia.
**Speaker:**
"Meet Budi. Budi runs a small cafe in Malang, Indonesia. He’s heard of crypto, but he won't accept it. Why? Because it’s volatile, hard to convert to cash, and the taxes/regulations are a nightmare for a small business owner.

At the same time, millions of users are earning rewards on DePIN networks or holding USDC on Solana. They have digital wealth, but they can't even buy a cup of coffee at Budi's cafe.

This is the 'Merchant Boundary'—the place where crypto adoption goes to die. Until today."

---

### [00:45 - 01:30] THE SOLUTION: Introducing ArPay
**Visual:** ArPay Logo and the "Tri-Layer Settlement" diagram.
**Speaker:**
"Introducing ArPay. We are building a tri-layer settlement infrastructure that turns Solana into an invisible payment layer for Southeast Asia. 

ArPay connects Solana’s high-speed blockchain with the existing QRIS and BI-FAST infrastructure in Indonesia. 

The beauty of ArPay? Budi doesn't need a wallet. He doesn't need to know what a private key is. He just uses the same QRIS code he already has on his counter. ArPay handles the conversion, the escrow, and the instant bank transfer in the background."

---

### [01:30 - 02:45] THE DEMO: From Scan to Bank Account
**Visual:** Screen recording of the ArPay PWA.
**Speaker:**
"Let’s look at how it works in 4 simple steps.

**Step 1: The Scan.**
The user opens ArPay and scans any standard QRIS code. Our system instantly parses the merchant ID and fetches the real-time conversion rate. We use **Pyth Network** oracles to ensure the USDC/IDR rate is accurate and manipulation-resistant.

**Step 2: The Review.**
The user sees the exact IDR amount the merchant will receive. No hidden fees, no slippage surprises. 

**Step 3: Atomic Escrow.**
When the user hits 'Sign', ArPay utilizes an **Anchor-based Smart Contract**. The USDC is moved into an atomic escrow PDA. The funds are locked on-chain, creating a trustless guarantee for the settlement.

**Step 4: Real-time Settlement.**
Our Oracle Bridge detects the on-chain event and triggers an instant disbursement via **Xendit and BI-FAST**. In less than 10 seconds, the merchant receives local currency (Rupiah) directly into their bank account.

The transaction is complete. The escrow is released. Web3 has just met the real world."

---

### [02:45 - 03:30] UNDER THE HOOD: Why Solana?
**Visual:** Technical stack icons (Solana, Pyth, Rust, BI-FAST).
**Speaker:**
"We chose Solana because settlement speed matters. At a cashier, you can't wait 10 minutes for a block confirmation. With Solana's sub-second finality, ArPay matches the speed of traditional credit card rails.

By combining:
1. **Solana's Atomic Escrows**,
2. **Pyth's decentralized price feeds**, and
3. **Indonesia's BI-FAST rails**,

We’ve created a compliant, non-custodial off-ramp that works everywhere QRIS is accepted—which is over 30 million merchants in Indonesia alone."

---

### [03:30 - END] THE IMPACT: Unlocking Liquidity
**Visual:** Map of SE Asia with ArPay nodes lighting up.
**Speaker:**
"ArPay isn't just a payment app; it's the missing infrastructure for the DePIN and RWA revolution. We are unlocking billions in Web3 liquidity for local economies, one QR code at a time.

ArPay: Spend Web3. Receive Fiat. No Friction. 

Thank you."

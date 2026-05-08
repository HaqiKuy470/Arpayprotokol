/**
 * layout.tsx
 * Root layout — wraps the entire app with Solana wallet adapter context.
 */

import type { Metadata, Viewport } from "next";
import { WalletProviders } from "../components/WalletProviders";
import { Toaster } from "react-hot-toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "ArPay — Eco-Incentive Settlement Protocol",
  description:
    "Distribute USDC green incentive grants to Indonesian community hubs via QRIS and BI-FAST in under 5 seconds.",
  manifest: "/manifest.json",
  icons: { apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#1a2e1a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <WalletProviders>
          {children}
          <Toaster
            position="bottom-center"
            toastOptions={{
              style: {
                background: "#1e2d1e",
                color: "#c8e6c9",
                border: "1px solid #2e4a2e",
                fontSize: "13px",
              },
            }}
          />
        </WalletProviders>
      </body>
    </html>
  );
}

import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GalaSwap Arb Scanner",
  description: "Real-time GalaSwap arbitrage opportunities — bridge-aware, no false positives",
  openGraph: {
    title: "GalaSwap Arb Scanner",
    description: "Find real arbitrage opportunities on GalaSwap DEX",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}

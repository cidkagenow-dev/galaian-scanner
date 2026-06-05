# GalaSwap Arb Scanner

Real-time arbitrage opportunity scanner for GalaSwap DEX. Bridge-aware, no false positives.

## Features

- 🔍 **GalaSwap vs CoinGecko** — Price discrepancy detection
- ↔️ **Bidirectional Spread** — Buy/sell price divergence
- ⚠️ **Stablecoin Depeg** — USDT/USDC off-peg detection
- 🌉 **Bridge-Aware** — Filters out tokens with no bridge (GWXRP, GWTRX)
- ✅ **Confidence Scoring** — High/Medium/Low based on volume & spread
- 💰 **Net Profit** — After 0.3% DEX fee + price impact
- 🔄 **Auto-Refresh** — 30-second polling

## vs arb.gala.com

| Feature | arb.gala.com | This Scanner |
|---------|-------------|-------------|
| False positive filter | ❌ | ✅ |
| Wrapped token detection | ❌ | ✅ |
| Bidirectional spread | ❌ | ✅ |
| Net profit after fees | ❌ | ✅ |
| Confidence scoring | ❌ | ✅ |
| Bridge info per token | ❌ | ✅ |
| Auto-refresh | ❌ | ✅ |
| Sortable/filterable | ❌ | ✅ |

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import Project
3. Select this repo
4. Deploy (no env vars needed)

## Local Development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Vercel Serverless Functions
- arb.gala.com API + CoinGecko

## API

```
GET /api/scan → Full scan results (JSON)
```

Cached for 30s via Vercel CDN.

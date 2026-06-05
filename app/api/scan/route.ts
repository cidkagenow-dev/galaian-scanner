import { NextResponse } from "next/server";

// ─── Config ───────────────────────────────────────────────────────────
const ARB_API = "https://arb.gala.com";
const CG_API = "https://api.coingecko.com/api/v3";

// ─── Types ───────────────────────────────────────────────────────────

interface BridgeInfo {
  chain: string;
  native: string;
  bridge: string;
  cgId: string;
  isStablecoin: boolean;
}

const BRIDGEABLE: Record<string, BridgeInfo> = {
  GALA:    { chain: "ethereum", native: "GALA",    bridge: "GalaConnect", cgId: "gala", isStablecoin: false },
  GWBTC:   { chain: "ethereum", native: "WBTC",   bridge: "GalaConnect", cgId: "bitcoin", isStablecoin: false },
  GWETH:   { chain: "ethereum", native: "ETH",    bridge: "GalaConnect", cgId: "ethereum", isStablecoin: false },
  GWBNB:   { chain: "ethereum", native: "BNB",    bridge: "GalaConnect", cgId: "binancecoin", isStablecoin: false },
  GWXRP:   { chain: "ethereum", native: "XRP",    bridge: "GalaConnect", cgId: "ripple", isStablecoin: false },
  GWTRX:   { chain: "ethereum", native: "TRX",    bridge: "GalaConnect", cgId: "tron", isStablecoin: false },
  GUSDT:   { chain: "ethereum", native: "USDT",   bridge: "GalaConnect", cgId: "tether", isStablecoin: true },
  GUSDC:   { chain: "ethereum", native: "USDC",   bridge: "GalaConnect", cgId: "usd-coin", isStablecoin: true },
  GUNI:    { chain: "ethereum", native: "UNI",    bridge: "GalaConnect", cgId: "uniswap", isStablecoin: false },
  GPEPE:   { chain: "ethereum", native: "PEPE",   bridge: "GalaConnect", cgId: "pepe", isStablecoin: false },
  GFLOKI:  { chain: "ethereum", native: "FLOKI",  bridge: "GalaConnect", cgId: "floki", isStablecoin: false },
  GAAVE:   { chain: "ethereum", native: "AAVE",   bridge: "GalaConnect", cgId: "aave", isStablecoin: false },
  GARB:    { chain: "ethereum", native: "ARB",    bridge: "GalaConnect", cgId: "arbitrum", isStablecoin: false },
  GCRV:    { chain: "ethereum", native: "CRV",    bridge: "GalaConnect", cgId: "curve-dao-token", isStablecoin: false },
  GENA:    { chain: "ethereum", native: "ENA",    bridge: "GalaConnect", cgId: "ethena", isStablecoin: false },
  GAPE:    { chain: "ethereum", native: "APE",    bridge: "GalaConnect", cgId: "apecoin", isStablecoin: false },
  GDOGS:   { chain: "ethereum", native: "DOGS",   bridge: "GalaConnect", cgId: "dogs", isStablecoin: false },
  GSOL:    { chain: "solana", native: "SOL",      bridge: "GalaConnect", cgId: "solana", isStablecoin: false },
  GTRUMP:  { chain: "solana", native: "TRUMP",    bridge: "GalaConnect", cgId: "official-trump", isStablecoin: false },
  GMEW:    { chain: "solana", native: "MEW",      bridge: "GalaConnect", cgId: "cat-in-a-dogs-world", isStablecoin: false },
  GUFD:    { chain: "solana", native: "UFD",      bridge: "GalaConnect", cgId: "unicorn-fart-dust", isStablecoin: false },
  GFIGHT:  { chain: "solana", native: "FIGHT",    bridge: "GalaConnect", cgId: "fight-2", isStablecoin: false },
  GPONKE:  { chain: "solana", native: "PONKE",    bridge: "GalaConnect", cgId: "ponke", isStablecoin: false },
  GSHRAP:  { chain: "solana", native: "SHRAP",    bridge: "GalaConnect", cgId: "shrapnel-2", isStablecoin: false },
  GBIGTIME:{ chain: "solana", native: "BIGTIME",  bridge: "GalaConnect", cgId: "big-time", isStablecoin: false },
  GPENGU:  { chain: "solana", native: "PENGU",    bridge: "GalaConnect", cgId: "pudgy-penguins", isStablecoin: false },
  GFARTCOIN:{ chain: "solana", native: "FARTCOIN", bridge: "GalaConnect", cgId: "fartcoin", isStablecoin: false },
  GTON:    { chain: "ton", native: "TON",         bridge: "GalaConnect", cgId: "the-open-network", isStablecoin: false },
  GBLUM:   { chain: "ton", native: "BLUM",        bridge: "GalaConnect", cgId: "blum", isStablecoin: false },
};

const BRIDGEABLE_BACK = new Set(Object.keys(BRIDGEABLE));

// CG price cache
const cgPriceCache = new Map<string, number>();
let GALA_USD = 0.0026;

// ─── Fetch helpers ───────────────────────────────────────────────────

async function fetchJSON<T>(url: string, timeout = 15000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function fetchCGPrice(cgId: string): Promise<number> {
  if (cgPriceCache.has(cgId)) return cgPriceCache.get(cgId)!;
  try {
    const r = await fetch(`${CG_API}/simple/price?ids=${cgId}&vs_currencies=usd`);
    if (!r.ok) return 0;
    const data = await r.json();
    const price = data[cgId]?.usd ?? 0;
    cgPriceCache.set(cgId, price);
    return price;
  } catch { return 0; }
}

async function getQuote(from: string, to: string, amount: string): Promise<{
  amountOut: number; priceImpact: number; fee: number;
} | null> {
  try {
    const r = await fetch(`${ARB_API}/api/swap/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromToken: from,
        toToken: to,
        amount,
        userAddress: "0x0000000000000000000000000000000000000000",
      }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const q = data.quote;
    return {
      amountOut: parseFloat(q.amountOut) / 1e18,
      priceImpact: parseFloat(q.priceImpact || "0"),
      fee: parseFloat(q.fee || "0"),
    };
  } catch { return null; }
}

// ─── Main scanner ────────────────────────────────────────────────────

export const revalidate = 30;
export const maxDuration = 30;

export async function GET() {
  try {
    const startTime = Date.now();
    cgPriceCache.clear();

    // Fetch pools
    const rawPools = await fetchJSON<any[]>(`${ARB_API}/api/pools`);
    if (!rawPools) throw new Error("Failed to fetch pools");

    // Fetch GALA price
    GALA_USD = await fetchCGPrice("gala") || 0.0026;

    const opportunities: any[] = [];

    // Process each pool
    for (const pool of rawPools) {
      const tokenA = pool.tokenInSymbol;
      const tokenB = pool.tokenOutSymbol;
      if (!tokenA || !tokenB) continue;

      // Find which token is bridgeable
      const bridgeA = BRIDGEABLE[tokenA];
      const bridgeB = BRIDGEABLE[tokenB];
      if (!bridgeA && !bridgeB) continue;

      // Determine arb direction
      const token = bridgeA ? tokenA : tokenB;
      const bridge = bridgeA ? bridgeA : bridgeB!;
      const exitAsset = bridgeA ? tokenB : tokenA;
      const exitBridgeable = BRIDGEABLE_BACK.has(exitAsset);
      const exitBridgeInfo = BRIDGEABLE[exitAsset];

      const poolId = pool.id?.toString() || `${tokenA}-${tokenB}`;
      const pairName = `${tokenA}/${tokenB}`;

      // Get CoinGecko price
      // Skip if no CoinGecko ID
      if (!bridge.cgId) continue;
      const cgPrice = await fetchCGPrice(bridge.cgId);
      if (!cgPrice) continue;

      // Get quote for 1 unit
      const quote = await getQuote(token, exitAsset, "1e18");
      if (!quote) continue;

      const poolFee = quote.fee;
      const priceImpact = quote.priceImpact;

      // Calculate GalaSwap price in USD
      let galaDexPriceUsd = 0;
      if (exitBridgeInfo?.isStablecoin) {
        galaDexPriceUsd = quote.amountOut;
      } else if (exitAsset === "GALA") {
        galaDexPriceUsd = quote.amountOut * GALA_USD;
      } else {
        const exitCgId = exitBridgeInfo?.cgId;
        if (exitCgId) {
          const exitPrice = await fetchCGPrice(exitCgId);
          galaDexPriceUsd = quote.amountOut * exitPrice;
        }
      }

      if (!galaDexPriceUsd || galaDexPriceUsd <= 0) continue;

      // Spread calculation
      const spreadPct = ((galaDexPriceUsd - cgPrice) / cgPrice) * 100;
      if (spreadPct < 0.5) continue;

      // Net spread (buy external free, bridge free, sell on GalaSwap = fee + impact)
      const netSpreadPct = spreadPct - poolFee - priceImpact;

      // Trade sizing (simplified)
      const baseTrade = 1000;
      const breakevenTrade = spreadPct > (poolFee + priceImpact) 
        ? baseTrade * (spreadPct / (poolFee + priceImpact)) 
        : 0;
      const profitableTrade = breakevenTrade * 0.7;
      const impactAtBreakeven = priceImpact * (breakevenTrade / baseTrade);
      const impactAtProfitable = priceImpact * (profitableTrade / baseTrade);
      const netProfitAtProfitable = spreadPct - poolFee - impactAtProfitable;

      // Confidence
      let confidence = "low";
      if (spreadPct > 5 && netSpreadPct > 2) confidence = "high";
      else if (spreadPct > 3 && netSpreadPct > 1) confidence = "medium";

      // Notes
      const notes: string[] = [];
      if (!exitBridgeable) notes.push(`⚠️ ${exitAsset} not bridgeable back`);
      if (breakevenTrade < 100) notes.push(`Low liquidity`);

      opportunities.push({
        id: `${poolId}-${token}`,
        poolId,
        tokenA,
        tokenB,
        pairName,
        poolFee: Math.round(poolFee * 100) / 100,
        poolTvl: 0,
        poolVol1d: 0,
        token,
        tokenImage: bridgeA ? pool.tokenInImage : pool.tokenOutImage,
        galaDexPrice: quote.amountOut,
        galaDexPriceUsd: Math.round(galaDexPriceUsd * 1000000) / 1000000,
        cgPrice,
        spreadPct: Math.round(spreadPct * 100) / 100,
        netSpreadPct: Math.round(netSpreadPct * 100) / 100,
        buyOn: `${bridge.chain} (external)`,
        sellOn: `GalaSwap ${pairName}`,
        exitAsset,
        exitAssetBridgeable: exitBridgeable,
        exitAssetBridgeChain: exitBridgeInfo?.chain || "unknown",
        breakevenTrade: Math.round(breakevenTrade),
        profitableTrade: Math.round(profitableTrade),
        impactAtBreakeven: Math.round(impactAtBreakeven * 100) / 100,
        impactAtProfitable: Math.round(impactAtProfitable * 100) / 100,
        netProfitAtProfitable: Math.round(netProfitAtProfitable * 100) / 100,
        confidence,
        notes: notes.join(" | "),
        bridgeInfo: `${bridge.bridge} (${bridge.chain}↔GalaChain)`,
        bridgeFee: 0,
      });
    }

    // Sort by net spread
    opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      elapsed,
      poolCount: rawPools.length,
      tokenCount: new Set(opportunities.map(o => o.token)).size,
      opportunities,
      stats: {
        total: opportunities.length,
        highConf: opportunities.filter(o => o.confidence === "high").length,
        medConf: opportunities.filter(o => o.confidence === "medium").length,
        bestSpread: opportunities[0]?.spreadPct || 0,
        bestNet: opportunities[0]?.netSpreadPct || 0,
      },
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

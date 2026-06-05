import { NextResponse } from "next/server";

// ─── Config ───────────────────────────────────────────────────────────
const ARB_API = "https://arb.gala.com";
const CG_API = "https://api.coingecko.com/api/v3";

// ─── Bridge Map ──────────────────────────────────────────────────────

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

async function fetchCGPrices(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const url = `${CG_API}/simple/price?ids=${ids.join(",")}&vs_currencies=usd`;
  const data = await fetchJSON<any>(url);
  const prices = new Map<string, number>();
  if (data) {
    for (const [id, val] of Object.entries(data)) {
      prices.set(id, (val as any)?.usd || 0);
    }
  }
  return prices;
}

// ─── Main scanner ────────────────────────────────────────────────────

export const revalidate = 30;
export const maxDuration = 30;

export async function GET() {
  try {
    const startTime = Date.now();

    // Fetch pools and tokens from arb.gala.com
    const [rawPools, arbTokens] = await Promise.all([
      fetchJSON<any[]>(`${ARB_API}/api/pools`),
      fetchJSON<any[]>(`${ARB_API}/api/tokens`),
    ]);

    if (!rawPools || !arbTokens) throw new Error("Failed to fetch data");

    // Build token price lookup: symbol -> { galaPrice, coinGeckoPrice, coinGeckoId }
    const tokenData = new Map<string, any>();
    for (const tok of arbTokens) {
      tokenData.set(tok.symbol, tok);
    }

    // Get CoinGecko IDs for bridgeable tokens
    const cgIds = [...new Set(Object.values(BRIDGEABLE).map(b => b.cgId).filter(Boolean))];
    const cgPrices = await fetchCGPrices(cgIds);

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

      // Get GalaSwap price from arb.gala.com token data
      const tokData = tokenData.get(token);
      if (!tokData || !tokData.galaPrice || tokData.galaPrice === 0) continue;

      const galaDexPriceUsd = tokData.galaPrice;

      // Get CoinGecko price
      const cgPrice = cgPrices.get(bridge.cgId) || 0;
      if (!cgPrice) continue;

      // Spread calculation
      const spreadPct = ((galaDexPriceUsd - cgPrice) / cgPrice) * 100;
      if (Math.abs(spreadPct) < 0.5) continue;

      // Pool fee (default 1% for most GalaSwap pools)
      const poolFee = 1.0;

      // Net spread (buy external free, bridge free, sell on GalaSwap = fee)
      const netSpreadPct = spreadPct - poolFee;

      // Trade sizing (simplified)
      const baseTrade = 1000;
      const breakevenTrade = spreadPct > poolFee 
        ? baseTrade * (spreadPct / poolFee) 
        : 0;
      const profitableTrade = breakevenTrade * 0.7;
      const impactAtBreakeven = 0; // Will estimate with TVL later
      const impactAtProfitable = 0;
      const netProfitAtProfitable = netSpreadPct;

      // Confidence
      let confidence: "high" | "medium" | "low" = "low";
      if (spreadPct > 5 && netSpreadPct > 2) confidence = "high";
      else if (spreadPct > 3 && netSpreadPct > 1) confidence = "medium";

      // Direction
      const buyOn = spreadPct > 0 ? `${bridge.chain} (external)` : "GalaSwap DEX";
      const sellOn = spreadPct > 0 ? `GalaSwap DEX` : `${bridge.chain} (external)`;

      // Notes
      const notes: string[] = [];
      if (!exitBridgeable) notes.push(`⚠️ ${exitAsset} not bridgeable back`);

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
        tokenImage: tokData.image || "",
        galaDexPrice: galaDexPriceUsd,
        galaDexPriceUsd: Math.round(galaDexPriceUsd * 1000000) / 1000000,
        cgPrice,
        spreadPct: Math.round(spreadPct * 100) / 100,
        netSpreadPct: Math.round(netSpreadPct * 100) / 100,
        buyOn,
        sellOn,
        exitAsset,
        exitAssetBridgeable: exitBridgeable,
        exitAssetBridgeChain: exitBridgeInfo?.chain || "unknown",
        breakevenTrade: Math.round(breakevenTrade),
        profitableTrade: Math.round(profitableTrade),
        impactAtBreakeven,
        impactAtProfitable,
        netProfitAtProfitable: Math.round(netProfitAtProfitable * 100) / 100,
        confidence,
        notes: notes.join(" | "),
        bridgeInfo: `${bridge.bridge} (${bridge.chain}↔GalaChain)`,
        bridgeFee: 0,
      });
    }

    // Sort by net spread descending
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

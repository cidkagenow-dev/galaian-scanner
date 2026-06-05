import { NextResponse } from "next/server";

// ─── Config ───────────────────────────────────────────────────────────
const ARB_API = "https://arb.gala.com";
const DEX_BACKEND = "https://dex-backend-prod1.defi.gala.com";
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

// Fetch all pools from DEX backend (has TVL, volume)
async function fetchAllPools(): Promise<any[]> {
  const pools: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${DEX_BACKEND}/explore/pools?limit=20&page=${page}`;
    const data = await fetchJSON<any>(url);
    if (!data?.data?.pools?.length) break;
    pools.push(...data.data.pools);
    if (pools.length >= (data.data.count || 0)) break;
  }
  return pools;
}

// ─── Main scanner ────────────────────────────────────────────────────

export const revalidate = 30;
export const maxDuration = 30;

export async function GET() {
  try {
    const startTime = Date.now();

    // Fetch from both sources in parallel
    const [rawPools, arbTokens, dexPools] = await Promise.all([
      fetchJSON<any[]>(`${ARB_API}/api/pools`),
      fetchJSON<any[]>(`${ARB_API}/api/tokens`),
      fetchAllPools(),
    ]);

    if (!rawPools || !arbTokens) throw new Error("Failed to fetch data");

    // Build token price lookup: symbol -> { galaPrice, coinGeckoPrice, coinGeckoId, image, volume24h }
    const tokenData = new Map<string, any>();
    for (const tok of arbTokens) {
      tokenData.set(tok.symbol, tok);
    }

    // Build DEX pool lookup: "token0/token1" -> { tvl, volume1d, fee }
    const dexPoolData = new Map<string, any>();
    for (const pool of dexPools) {
      const key = pool.poolName || `${pool.token0}/${pool.token1}`;
      dexPoolData.set(key, pool);
    }

    // Build pool lookup: token symbol -> pools it appears in
    const tokenPools = new Map<string, any[]>();
    for (const pool of rawPools) {
      const tA = pool.tokenInSymbol;
      const tB = pool.tokenOutSymbol;
      if (!tA || !tB) continue;
      
      if (!tokenPools.has(tA)) tokenPools.set(tA, []);
      tokenPools.get(tA)!.push(pool);
      
      if (!tokenPools.has(tB)) tokenPools.set(tB, []);
      tokenPools.get(tB)!.push(pool);
    }

    // Get CoinGecko prices for bridgeable tokens
    const cgIds = [...new Set(Object.values(BRIDGEABLE).map(b => b.cgId).filter(Boolean))];
    const cgPrices = await fetchCGPrices(cgIds);

    const opportunities: any[] = [];
    const processedTokens = new Set<string>();

    // Process each bridgeable token
    for (const [sym, bridge] of Object.entries(BRIDGEABLE)) {
      if (processedTokens.has(sym)) continue;
      processedTokens.add(sym);

      // Get GalaSwap price from arb.gala.com
      const tokData = tokenData.get(sym);
      if (!tokData || !tokData.galaPrice || tokData.galaPrice === 0) continue;

      const galaDexPriceUsd = tokData.galaPrice;

      // Get CoinGecko price
      const cgPrice = cgPrices.get(bridge.cgId) || 0;
      if (!cgPrice) continue;

      // Spread calculation
      const spreadPct = ((galaDexPriceUsd - cgPrice) / cgPrice) * 100;
      if (Math.abs(spreadPct) < 0.5) continue;

      // Find best pool for this token
      const pools = tokenPools.get(sym) || [];
      let bestPool = null;
      let bestExitAsset = "";
      let bestDexPool = null;
      
      for (const pool of pools) {
        const exitA = pool.tokenInSymbol === sym ? pool.tokenOutSymbol : pool.tokenInSymbol;
        const exitBridge = BRIDGEABLE[exitA];
        
        // Try to find matching DEX pool for TVL/volume
        const pairName1 = `${sym}/${exitA}`;
        const pairName2 = `${exitA}/${sym}`;
        const dexPool = dexPoolData.get(pairName1) || dexPoolData.get(pairName2);
        
        // Prefer stablecoins as exit asset
        if (exitBridge?.isStablecoin) {
          bestPool = pool;
          bestExitAsset = exitA;
          bestDexPool = dexPool;
          break;
        }
        // Then prefer GALA
        if (exitA === "GALA") {
          bestPool = pool;
          bestExitAsset = exitA;
          bestDexPool = dexPool;
        }
        // Otherwise use first pool
        if (!bestPool) {
          bestPool = pool;
          bestExitAsset = exitA;
          bestDexPool = dexPool;
        }
      }

      if (!bestPool) continue;

      const exitAsset = bestExitAsset;
      const exitBridgeable = BRIDGEABLE_BACK.has(exitAsset);
      const exitBridgeInfo = BRIDGEABLE[exitAsset];
      const poolId = bestPool.id?.toString() || `${sym}-${exitAsset}`;
      const pairName = `${sym}/${exitAsset}`;

      // Pool data from DEX backend
      const poolTvl = bestDexPool?.tvl || 0;
      const poolVol1d = bestDexPool?.volume1d || 0;
      const poolFee = bestDexPool?.fee ? parseFloat(bestDexPool.fee) : 1.0;

      // Net spread (buy external free, bridge free, sell on GalaSwap = fee)
      const netSpreadPct = spreadPct - poolFee;


      // Direction-aware depth: use correct side liquidity
      // token0 = first token in DEX pool, token1 = second token
      const dexToken0 = bestDexPool?.token0;
      const isToken0 = dexToken0 === sym;
      
      // If selling bridgeable token (spread > 0): use bridgeable token side
      // If buying bridgeable token (spread < 0): use exit asset side
      const sellSideTvl = isToken0 
        ? (bestDexPool?.token0TvlUsd || 0)
        : (bestDexPool?.token1TvlUsd || 0);
      const buySideTvl = isToken0
        ? (bestDexPool?.token1TvlUsd || 0)
        : (bestDexPool?.token0TvlUsd || 0);
      
      // For CLMM pools, effective liquidity is ~15% of side TVL
      const effectiveLiq = spreadPct > 0 
        ? sellSideTvl * 0.15   // Selling into pool: use sell side
        : buySideTvl * 0.15;   // Buying from pool: use buy side
      
      const breakevenTrade = Math.abs(spreadPct) > poolFee && effectiveLiq > 0
        ? (Math.abs(spreadPct) - poolFee) / 100 * 2 * effectiveLiq
        : 0;
      const profitableTrade = breakevenTrade * 0.7;
      
      // Impact at trade sizes
      const impactAtBreakeven = breakevenTrade > 0 ? (breakevenTrade / (2 * effectiveLiq)) * 100 : 0;
      const impactAtProfitable = profitableTrade > 0 ? (profitableTrade / (2 * effectiveLiq)) * 100 : 0;
      const netProfitAtProfitable = Math.abs(spreadPct) - poolFee - impactAtProfitable;










      // Confidence
      let confidence: "high" | "medium" | "low" = "low";
      if (poolTvl > 10000 && poolVol1d > 1000 && spreadPct > 3 && netProfitAtProfitable > 1) confidence = "high";
      else if (poolTvl > 1000 && spreadPct > 2 && netProfitAtProfitable > 0.5) confidence = "medium";

      // Direction
      const buyOn = spreadPct > 0 ? `${bridge.chain} (external)` : "GalaSwap DEX";
      const sellOn = spreadPct > 0 ? `GalaSwap DEX` : `${bridge.chain} (external)`;

      // Notes
      const notes: string[] = [];
      if (!exitBridgeable) notes.push(`⚠️ ${exitAsset} not bridgeable back`);
      if (poolTvl < 1000) notes.push(`⚠️ Very low TVL ($${poolTvl.toFixed(0)})`);
      if (poolTvl < 100) notes.push(`🚫 Pool nearly empty`);
      if (breakevenTrade < 100 && poolTvl > 0) notes.push(`Breakeven ~$${breakevenTrade.toFixed(0)}`);

      opportunities.push({
        id: `${poolId}-${sym}`,
        poolId,
        tokenA: sym,
        tokenB: exitAsset,
        pairName,
        poolFee: Math.round(poolFee * 100) / 100,
        poolTvl: Math.round(poolTvl),
        poolVol1d: Math.round(poolVol1d),
        token: sym,
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
        impactAtBreakeven: Math.round(impactAtBreakeven * 100) / 100,
        impactAtProfitable: Math.round(impactAtProfitable * 100) / 100,
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

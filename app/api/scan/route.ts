import { NextResponse } from "next/server";

const ARB_API = "https://arb.gala.com";
const DEX_BACKEND = "https://dex-backend-prod1.defi.gala.com";
const CG_API = "https://api.coingecko.com/api/v3";

interface BridgeInfo {
  chain: string; native: string; bridge: string; cgId: string; isStablecoin: boolean;
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

// Pool imbalance threshold - skip if one side > 85% of total
const IMBALANCE_THRESHOLD = 0.85;

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

async function fetchAllPools(): Promise<any[]> {
  const pools: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const data = await fetchJSON<any>(`${DEX_BACKEND}/explore/pools?limit=20&page=${page}`);
    if (!data?.data?.pools?.length) break;
    pools.push(...data.data.pools);
    if (pools.length >= (data.data.count || 0)) break;
  }
  return pools;
}

export const revalidate = 30;
export const maxDuration = 30;

export async function GET() {
  try {
    const startTime = Date.now();

    const [arbPools, arbTokens, dexPools] = await Promise.all([
      fetchJSON<any[]>(`${ARB_API}/api/pools`),
      fetchJSON<any[]>(`${ARB_API}/api/tokens`),
      fetchAllPools(),
    ]);

    if (!arbPools || !arbTokens) throw new Error("Failed to fetch data");

    const tokenData = new Map<string, any>();
    for (const tok of arbTokens) tokenData.set(tok.symbol, tok);

    const dexPoolData = new Map<string, any>();
    for (const pool of dexPools) {
      const key = pool.poolName || `${pool.token0}/${pool.token1}`;
      dexPoolData.set(key, pool);
    }

    const allCgIds = [...new Set(arbTokens.map((t: any) => t.coinGeckoId).filter(Boolean))];
    const cgPrices = await fetchCGPrices(allCgIds);

    const opportunities: any[] = [];

    for (const pool of arbPools) {
      const tokenA = pool.tokenInSymbol;
      const tokenB = pool.tokenOutSymbol;
      if (!tokenA || !tokenB) continue;

      const tokAData = tokenData.get(tokenA);
      const tokBData = tokenData.get(tokenB);
      if (!tokAData?.galaPrice && !tokBData?.galaPrice) continue;

      for (const [sym, symData] of [[tokenA, tokAData], [tokenB, tokBData]] as [string, any][]) {
        if (!symData?.galaPrice || symData.galaPrice === 0) continue;
        if (!symData?.coinGeckoId) continue;

        const galaDexPriceUsd = symData.galaPrice;
        const cgPrice = cgPrices.get(symData.coinGeckoId) || symData.coinGeckoPrice || 0;
        if (!cgPrice) continue;
        
        // Skip if galaPrice is wildly different from CG price (data error)
        const priceRatio = galaDexPriceUsd / cgPrice;
        if (priceRatio > 100 || priceRatio < 0.01) continue;

        
        // Skip if no DEX pool data available
        if (!bestDexPool) continue;
        // Find matching DEX pool
        const pairName1 = `${tokenA}/${tokenB}`;
        const pairName2 = `${tokenB}/${tokenA}`;
        const bestDexPool = dexPoolData.get(pairName1) || dexPoolData.get(pairName2);

        // Pool data
        const poolTvl = bestDexPool?.tvl || 0;
        const poolVol1d = bestDexPool?.volume1d || 0;
        const poolFee = bestDexPool?.fee ? parseFloat(bestDexPool.fee) : 1.0;
        const token0TvlUsd = bestDexPool?.token0TvlUsd || 0;
        const token1TvlUsd = bestDexPool?.token1TvlUsd || 0;
        const totalSideTvl = token0TvlUsd + token1TvlUsd;
        const maxSideRatio = totalSideTvl > 0 ? Math.max(token0TvlUsd, token1TvlUsd) / totalSideTvl : 0;

        // Skip heavily imbalanced pools
        if (maxSideRatio > IMBALANCE_THRESHOLD && totalSideTvl > 100) continue;

        // Direction-aware spread
        // rawSpread > 0: GalaSwap more expensive (sell on GalaSwap)
        // rawSpread < 0: GalaSwap cheaper (buy on GalaSwap)
        const rawSpread = ((galaDexPriceUsd - cgPrice) / cgPrice) * 100;
        
        // Profit is always from buy low -> sell high
        const profitPct = rawSpread >= 0
          ? rawSpread  // Buy external at cgPrice, sell GalaSwap at galaPrice
          : ((cgPrice - galaDexPriceUsd) / galaDexPriceUsd) * 100; // Buy GalaSwap at galaPrice, sell external at cgPrice

        if (profitPct < 0.5) continue;

        // Direction-aware depth
        const dexToken0 = bestDexPool?.token0;
        const isToken0 = dexToken0 === sym;
        const sellSideTvl = isToken0 ? token0TvlUsd : token1TvlUsd;
        const buySideTvl = isToken0 ? token1TvlUsd : token0TvlUsd;
        
        const effectiveLiq = rawSpread >= 0 
          ? sellSideTvl * 0.15
          : buySideTvl * 0.15;
        
        const breakevenTrade = profitPct > poolFee && effectiveLiq > 0
          ? (profitPct - poolFee) / 100 * 2 * effectiveLiq
          : 0;
        const profitableTrade = breakevenTrade * 0.7;
        const impactAtBreakeven = breakevenTrade > 0 ? (breakevenTrade / (2 * effectiveLiq)) * 100 : 0;
        const impactAtProfitable = profitableTrade > 0 ? (profitableTrade / (2 * effectiveLiq)) * 100 : 0;
        const netProfitAtProfitable = profitPct - poolFee - impactAtProfitable;

        // Confidence
        let confidence: "high" | "medium" | "low" = "low";
        if (poolTvl > 10000 && poolVol1d > 1000 && profitPct > 3 && netProfitAtProfitable > 1) confidence = "high";
        else if (poolTvl > 1000 && profitPct > 2 && netProfitAtProfitable > 0.5) confidence = "medium";

        // Direction
        const symBridge = BRIDGEABLE[sym];
        const exitAsset = sym === tokenA ? tokenB : tokenA;
        const exitBridge = BRIDGEABLE[exitAsset];
        const exitBridgeable = BRIDGEABLE_BACK.has(exitAsset);

        const buyOn = rawSpread >= 0 
          ? (symBridge ? `${symBridge.chain} (external)` : "External")
          : "GalaSwap DEX";
        const sellOn = rawSpread >= 0 
          ? "GalaSwap DEX" 
          : (symBridge ? `${symBridge.chain} (external)` : "External");

        const bridgeInfo = symBridge 
          ? `${symBridge.bridge} (${symBridge.chain}↔GalaChain)`
          : "Not bridgeable";

        const notes: string[] = [];
        if (!symBridge) notes.push(`⚠️ ${sym} not bridgeable`);
        if (!exitBridgeable) notes.push(`⚠️ ${exitAsset} not bridgeable back`);
        if (poolTvl < 1000) notes.push(`⚠️ Low TVL ($${poolTvl.toFixed(0)})`);
        if (maxSideRatio > 0.70) notes.push(`⚠️ Imbalanced pool (${(maxSideRatio*100).toFixed(0)}/${((1-maxSideRatio)*100).toFixed(0)})`);

        const poolId = pool.id?.toString() || `${tokenA}-${tokenB}`;

        opportunities.push({
          id: `${poolId}-${sym}`,
          poolId,
          tokenA,
          tokenB,
          pairName: `${tokenA}/${tokenB}`,
          poolFee: Math.round(poolFee * 100) / 100,
          poolTvl: Math.round(poolTvl),
          poolVol1d: Math.round(poolVol1d),
          token: sym,
          tokenImage: symData.image || "",
          galaDexPriceUsd: Math.round(galaDexPriceUsd * 1000000) / 1000000,
          cgPrice,
          spreadPct: Math.round(profitPct * 100) / 100,
          netSpreadPct: Math.round((profitPct - poolFee) * 100) / 100,
          buyOn,
          sellOn,
          exitAsset,
          exitAssetBridgeable: exitBridgeable,
          exitAssetBridgeChain: exitBridge?.chain || "unknown",
          bridgeable: !!symBridge,
          poolBalance: `${Math.round(maxSideRatio*100)}/${Math.round((1-maxSideRatio)*100)}`,
          breakevenTrade: Math.round(breakevenTrade),
          profitableTrade: Math.round(profitableTrade),
          impactAtBreakeven: Math.round(impactAtBreakeven * 100) / 100,
          impactAtProfitable: Math.round(impactAtProfitable * 100) / 100,
          netProfitAtProfitable: Math.round(netProfitAtProfitable * 100) / 100,
          confidence,
          notes: notes.join(" | "),
          bridgeInfo,
          bridgeFee: 0,
        });
      }
    }

    // Deduplicate
    const seen = new Map<string, any>();
    for (const opp of opportunities) {
      const key = `${opp.poolId}-${opp.token}`;
      const existing = seen.get(key);
      if (!existing || Math.abs(opp.spreadPct) > Math.abs(existing.spreadPct)) {
        seen.set(key, opp);
      }
    }
    const uniqueOpps = [...seen.values()];
    uniqueOpps.sort((a, b) => b.spreadPct - a.spreadPct);

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      elapsed: Date.now() - startTime,
      poolCount: arbPools.length,
      tokenCount: new Set(uniqueOpps.map(o => o.token)).size,
      opportunities: uniqueOpps,
      stats: {
        total: uniqueOpps.length,
        highConf: uniqueOpps.filter(o => o.confidence === "high").length,
        medConf: uniqueOpps.filter(o => o.confidence === "medium").length,
        bestSpread: uniqueOpps[0]?.spreadPct || 0,
        bestNet: uniqueOpps[0]?.netSpreadPct || 0,
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

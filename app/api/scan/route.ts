import { NextResponse } from "next/server";

const ARB_API = "https://arb.gala.com";
const DEX_BACKEND = "https://dex-backend-prod1.defi.gala.com";
const CG_API = "https://api.coingecko.com/api/v3";

const IMBALANCE_THRESHOLD = 0.98; // Allow imbalanced pools, just flag them
const MIN_SPREAD = 0.01; // Show even tiny spreads

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
  GSUSDT:  { chain: "ethereum", native: "USDT",   bridge: "GalaConnect", cgId: "tether", isStablecoin: true },
  GSUSDC:  { chain: "ethereum", native: "USDC",   bridge: "GalaConnect", cgId: "usd-coin", isStablecoin: true },
};

const BRIDGEABLE_BACK = new Set(Object.keys(BRIDGEABLE));

// Extra CG ID mapping for tokens not in arb API
const EXTRA_CG_IDS: Record<string, string> = {
  GSUSDT: "tether",
  GSUSDC: "usd-coin",
  GFIGHT: "fight-2",
  GPONKE: "ponke",
  GSHRAP: "shrapnel-2",
  MOON: "moon",
  BENE: "bene",
  DKP: "dkp",
  RBIT: "rbit",
};

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
  // Batch in chunks of 25 to avoid URL length issues
  const prices = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 25) {
    const chunk = ids.slice(i, i + 25);
    const url = `${CG_API}/simple/price?ids=${chunk.join(",")}&vs_currencies=usd`;
    const data = await fetchJSON<any>(url);
    if (data) {
      for (const [id, val] of Object.entries(data)) {
        prices.set(id, (val as any)?.usd || 0);
      }
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

    const [arbTokens, dexPools] = await Promise.all([
      fetchJSON<any[]>(`${ARB_API}/api/tokens`),
      fetchAllPools(),
    ]);

    if (!arbTokens) throw new Error("Failed to fetch arb tokens");

    // Build token data map from arb API
    const tokenData = new Map<string, any>();
    for (const tok of arbTokens) tokenData.set(tok.symbol, tok);

    // Build CG ID map: merge arb API + BRIDGEABLE + EXTRA_CG_IDS
    const cgIdMap = new Map<string, string>(); // symbol -> coingecko id
    for (const tok of arbTokens) {
      if (tok.coinGeckoId) cgIdMap.set(tok.symbol, tok.coinGeckoId);
    }
    for (const [sym, info] of Object.entries(BRIDGEABLE)) {
      if (!cgIdMap.has(sym)) cgIdMap.set(sym, info.cgId);
    }
    for (const [sym, cgId] of Object.entries(EXTRA_CG_IDS)) {
      if (!cgIdMap.has(sym)) cgIdMap.set(sym, cgId);
    }

    // Fetch CG prices for all known IDs
    const allCgIds = [...new Set([...cgIdMap.values(), ...Array.from(tokenData.values()).map((t: any) => t.coinGeckoId).filter(Boolean)])];
    const cgPrices = await fetchCGPrices(allCgIds);

    // Build galaPrice map from arb API
    const galaPriceMap = new Map<string, number>(); // symbol -> USD price on GalaSwap
    for (const tok of arbTokens) {
      if (tok.galaPrice && tok.galaPrice > 0) {
        galaPriceMap.set(tok.symbol, tok.galaPrice);
      }
    }

    // Build DEX pool map
    const dexPoolMap = new Map<string, any>();
    for (const pool of dexPools) {
      const key = pool.poolName || `${pool.token0}/${pool.token1}`;
      dexPoolMap.set(key, pool);
    }

    // Phase 1: Derive prices for tokens without galaPrice using pool ratios
    // Iteratively propagate prices through pool graph
    for (let round = 0; round < 3; round++) {
      for (const pool of dexPools) {
        const t0 = pool.token0;
        const t1 = pool.token1;
        const p0 = pool.token0Price ? parseFloat(pool.token0Price) : 0;
        const p1 = pool.token1Price ? parseFloat(pool.token1Price) : 0;
        
        if (p0 > 0 && p1 > 0) {
          const has0 = galaPriceMap.has(t0);
          const has1 = galaPriceMap.has(t1);
          
          if (has0 && !has1) {
            // t0 price known, derive t1: t1_price = t0_price * (p0/p1)
            // Actually: if 1 t0 = (p0/p1) t1 in value, then t1_usd = t0_usd * p1/p0
            // Wait - token0Price and token1Price are the prices in the other token
            // If token0Price = 0.0025 means 1 token0 = 0.0025 token1
            // So value of 1 token1 = value of token0 / 0.0025
            const t0Usd = galaPriceMap.get(t0)!;
            const t1Usd = t0Usd / p0 * p1; // Hmm, need to think about this
            // Actually: p0 = how many token1 per token0. So 1 t0 = p0 * t1
            // If t0 is worth $X, then 1 t1 = $X / p0
            // Wait no. If token0Price = "0.00252722" for GALA in GALA/GWBTC pool
            // And token1Price = "60836.05" for GWBTC
            // GALA price = $0.0025, GWBTC price = $60836
            // 1 GALA = 0.00252722 GWBTC → $0.0025 * (1/0.00252722) = ... no
            // Actually the prices ARE in USD from the DEX backend
            // p0 = USD price of token0, p1 = USD price of token1
            // Let me verify: GALA token0Price = 0.00252722 (matches galaPrice $0.0025)
            // GWBTC token1Price = 60836.05 (matches galaPrice $60582)
            // Yes! token0Price and token1Price are USD prices
            galaPriceMap.set(t1, p1);
          } else if (!has0 && has1) {
            galaPriceMap.set(t0, p0);
          }
        }
      }
    }

    // Phase 2: Scan ALL DEX pools
    const opportunities: any[] = [];

    for (const pool of dexPools) {
      const t0 = pool.token0;
      const t1 = pool.token1;
      const poolTvl = pool.tvl || 0;
      const poolVol1d = pool.volume1d || 0;
      const poolFee = pool.fee ? parseFloat(pool.fee) : 1.0;
      const token0TvlUsd = pool.token0TvlUsd || 0;
      const token1TvlUsd = pool.token1TvlUsd || 0;
      const totalSideTvl = token0TvlUsd + token1TvlUsd;
      const maxSideRatio = totalSideTvl > 0 ? Math.max(token0TvlUsd, token1TvlUsd) / totalSideTvl : 0;

      // Note: imbalance is flagged as warning, not filtered

      // Check both tokens
      for (const sym of [t0, t1]) {
        const galaPrice = galaPriceMap.get(sym);
        if (!galaPrice || galaPrice === 0) continue;

        const cgId = cgIdMap.get(sym);
        if (!cgId) continue;

        let cgPrice = cgPrices.get(cgId) || 0;
        // Fallback: try arb API coinGeckoPrice
        if (!cgPrice) {
          const arbTok = tokenData.get(sym);
          cgPrice = arbTok?.coinGeckoPrice || 0;
        }
        if (!cgPrice) continue;

        // Skip if wildly different (data error)
        const priceRatio = galaPrice / cgPrice;
        if (priceRatio > 100 || priceRatio < 0.01) continue;

        // Calculate spread
        const rawSpread = ((galaPrice - cgPrice) / cgPrice) * 100;
        const profitPct = rawSpread >= 0
          ? rawSpread
          : ((cgPrice - galaPrice) / galaPrice) * 100;

        if (profitPct < MIN_SPREAD) continue;

        // Direction-aware depth
        const isToken0 = t0 === sym;
        const sellSideTvl = isToken0 ? token0TvlUsd : token1TvlUsd;
        const buySideTvl = isToken0 ? token1TvlUsd : token0TvlUsd;

        const effectiveLiq = rawSpread >= 0 ? sellSideTvl * 0.15 : buySideTvl * 0.15;
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

        // Bridge info
        const exitAsset = sym === t0 ? t1 : t0;
        const symBridge = BRIDGEABLE[sym];
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

        const poolKey = pool.poolName || `${t0}/${t1}`;
        opportunities.push({
          id: `${poolKey}-${sym}`,
          poolId: poolKey,
          tokenA: t0,
          tokenB: t1,
          pairName: `${t0}/${t1}`,
          poolFee: Math.round(poolFee * 100) / 100,
          poolTvl: Math.round(poolTvl),
          poolVol1d: Math.round(poolVol1d),
          token: sym,
          tokenImage: "",
          galaDexPriceUsd: Math.round(galaPrice * 1000000) / 1000000,
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

    // Deduplicate (normalized pair name + token)
    const seen = new Map<string, any>();
    for (const opp of opportunities) {
      // Include fee tier in key so 0.3% and 1% pools are separate
      const key = `${opp.pairName}-${opp.poolFee}-${opp.token}`;
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
      poolCount: dexPools.length,
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

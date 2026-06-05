import { NextResponse } from "next/server";

// ─── Config ───────────────────────────────────────────────────────────
const DEX_BACKEND = "https://dex-backend-prod1.defi.gala.com";
const ARB_API = "https://arb.gala.com";
const CG_API = "https://api.coingecko.com/api/v3";

// Token key format: SYMBOL$Unit$none$none
const tokenKey = (sym: string) => `${sym}$Unit$none$none`;

// Bridgeable tokens
const BRIDGEABLE: Record<string, { chain: string; native: string; bridge: string; cgId: string }> = {
  GBLUM: { chain: "ton", native: "BLUM", bridge: "GalaConnect", cgId: "blum" },
  GTON: { chain: "ton", native: "TON", bridge: "GalaConnect", cgId: "the-open-network" },
  GALA: { chain: "ethereum", native: "GALA", bridge: "GalaConnect", cgId: "gala" },
  GWETH: { chain: "ethereum", native: "ETH", bridge: "GalaConnect", cgId: "ethereum" },
  GWBTC: { chain: "ethereum", native: "BTC", bridge: "GalaConnect", cgId: "bitcoin" },
  GUSDT: { chain: "ethereum", native: "USDT", bridge: "GalaConnect", cgId: "tether" },
  GUSDC: { chain: "ethereum", native: "USDC", bridge: "GalaConnect", cgId: "usd-coin" },
  GSOL: { chain: "solana", native: "SOL", bridge: "GalaConnect", cgId: "solana" },
  GTRUMP: { chain: "solana", native: "TRUMP", bridge: "GalaConnect", cgId: "official-trump" },
  GMEW: { chain: "solana", native: "MEW", bridge: "GalaConnect", cgId: "cat-in-a-dogs-world" },
  GUFD: { chain: "solana", native: "UFD", bridge: "GalaConnect", cgId: "unicorn-fart-dust" },
};

const SKIP = new Set(["GWXRP", "GWTRX", "GSUSDT", "GSUSDC", "TestToken1", "TestToken3", "Token",
  "GFIGHT", "GSWAP", "ETIME", "SILK", "GFINANCE"]);
const STABLES = new Set(["GUSDT", "GUSDC"]);
const DEX_FEE = 0.3;

// ─── Types ───────────────────────────────────────────────────────────
interface PoolData {
  poolPair: string;
  poolHash: string;
  token0: string;
  token1: string;
  token0Price: number;
  token1Price: number;
  fee: number;
  token0Tvl: number;
  token1Tvl: number;
  token0TvlUsd: number;
  token1TvlUsd: number;
  tvl: number;
  volume1d: number;
  volume30d: number;
  apr1d: number;
}

interface Opportunity {
  id: string;
  category: string;
  token: string;
  spreadPct: number;
  netSpreadPct: number;
  buyPrice: number;
  sellPrice: number;
  buyOn: string;
  sellOn: string;
  profitPer1k: number;
  confidence: string;
  bridgeInfo: string;
  poolTvl: number;
  poolVol1d: number;
  poolFee: number;
  breakevenTrade: number;
  profitableTrade: number;
  impactAtBreakeven: number;
  impactAtProfitable: number;
  netProfitAtProfitable: number;
  galaDexPrice: number;
  cgPrice: number;
  notes: string;
}

// ─── Fetch helpers ───────────────────────────────────────────────────
async function fetchJSON<T>(url: string, timeout = 10000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function postJSON<T>(url: string, body: any, timeout = 10000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

// ─── Pool TVL fetch ──────────────────────────────────────────────────
async function fetchAllPools(): Promise<PoolData[]> {
  const pools: PoolData[] = [];
  for (let page = 1; page <= 20; page++) {
    const url = `${DEX_BACKEND}/explore/pools?limit=20&page=${page}`;
    const data = await fetchJSON<any>(url);
    if (!data?.data?.pools?.length) break;
    pools.push(...data.data.pools);
    if (pools.length >= (data.data.count || 0)) break;
  }
  return pools;
}

// ─── On-chain DEX prices ─────────────────────────────────────────────
async function fetchDexPrices(symbols: string[]): Promise<Map<string, number>> {
  const keys = symbols.map(tokenKey);
  const data = await postJSON<any>(`${DEX_BACKEND}/v1/trade/price-multiple`, { tokens: keys });
  const prices = new Map<string, number>();
  if (data?.data) {
    symbols.forEach((sym, i) => {
      const p = parseFloat(data.data[i]);
      if (p > 0) prices.set(sym, p);
    });
  }
  return prices;
}

// ─── CoinGecko prices ────────────────────────────────────────────────
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

// ─── Spread depth simulation ─────────────────────────────────────────
function simulateSpreadDepth(
  poolTvlUsd: number,
  currentPrice: number,
  feePercent: number,
  spreadPercent: number
): { 
  breakevenTrade: number;     // Max trade where profit = $0
  profitableTrade: number;    // Trade where you keep 30% of spread as profit
  impactAtBreakeven: number;
  impactAtProfitable: number;
  netProfitAtProfitable: number;
} {
  if (poolTvlUsd < 1 || spreadPercent <= 0) {
    return { breakevenTrade: 0, profitableTrade: 0, impactAtBreakeven: 0, impactAtProfitable: 0, netProfitAtProfitable: 0 };
  }

  // For concentrated liquidity (Uniswap V3), effective liquidity is ~25-40% of TVL
  // within the active tick range. Use 30% as conservative middle ground.
  const effectiveLiquidity = poolTvlUsd * 0.30;

  // Fee cost = buy fee + sell fee (both sides)
  const totalFeeCost = feePercent * 2; // e.g., 1% pool = 2% round-trip

  // Spread available after fees
  const spreadAfterFees = spreadPercent - totalFeeCost;

  // If spread < fees, no profitable trade possible
  if (spreadAfterFees <= 0) {
    return { breakevenTrade: 0, profitableTrade: 0, impactAtBreakeven: 0, impactAtProfitable: 0, netProfitAtProfitable: 0 };
  }

  // BREAKEVEN: spread% = impact% + fee%
  // impact = trade / (2 × effective_liq) × 100
  // So: spreadAfterFees = trade / (2 × eff_liq) × 100
  // trade = spreadAfterFees / 100 × 2 × eff_liq
  const breakevenTrade = (spreadAfterFees / 100) * 2 * effectiveLiquidity;
  const impactAtBreakeven = spreadAfterFees; // At breakeven, impact = spreadAfterFees by definition

  // PROFITABLE TRADE: keep at least 30% of the spread as profit
  // impact = 70% of spreadAfterFees
  const targetImpact = spreadAfterFees * 0.70; // 70% consumed by impact, 30% = profit
  const profitableTrade = (targetImpact / 100) * 2 * effectiveLiquidity;
  const impactAtProfitable = targetImpact;
  const netProfitAtProfitable = spreadPercent - totalFeeCost - targetImpact; // Should be ~30% of spreadAfterFees

  return {
    breakevenTrade: Math.max(0, Math.round(breakevenTrade * 100) / 100),
    profitableTrade: Math.max(0, Math.round(profitableTrade * 100) / 100),
    impactAtBreakeven: Math.round(impactAtBreakeven * 100) / 100,
    impactAtProfitable: Math.round(impactAtProfitable * 100) / 100,
    netProfitAtProfitable: Math.round(netProfitAtProfitable * 100) / 100,
  };
}

// ─── Main scanner ────────────────────────────────────────────────────
export const revalidate = 30;
export const maxDuration = 30;

export async function GET() {
  try {
    const startTime = Date.now();

    // Fetch all data in parallel
    const [pools, arbTokens] = await Promise.all([
      fetchAllPools(),
      fetchJSON<any>(`${ARB_API}/api/tokens`),
    ]);

    // Get unique token symbols for price fetching
    const symbols = [...new Set(pools.flatMap(p => [p.token0, p.token1]))]
      .filter(s => !SKIP.has(s));

    // Fetch on-chain DEX prices
    const dexPrices = await fetchDexPrices(symbols);

    // Fetch CoinGecko prices for bridgeable tokens
    const cgIds = [...new Set(Object.values(BRIDGEABLE).map(b => b.cgId).filter(Boolean))];
    const cgPrices = await fetchCGPrices(cgIds);

    // Build pool lookup: symbol -> best pool (highest TVL)
    const bestPools = new Map<string, PoolData>();
    for (const pool of pools) {
      const t0 = pool.token0;
      const t1 = pool.token1;
      // Store the highest TVL pool for each token pair
      const key0 = `${t0}`;
      const existing0 = bestPools.get(key0);
      if (!existing0 || pool.tvl > existing0.tvl) {
        bestPools.set(key0, pool);
      }
    }

    // Scan for opportunities
    const opportunities: Opportunity[] = [];

    for (const [sym, bridge] of Object.entries(BRIDGEABLE)) {
      if (SKIP.has(sym) || STABLES.has(sym)) continue;

      const dexPrice = dexPrices.get(sym);
      const cgPrice = cgPrices.get(bridge.cgId);
      if (!dexPrice || !cgPrice || cgPrice === 0) continue;

      // Find the GALA/X pool for TVL data
      const pool = pools.find(p =>
        (p.token0 === "GALA" && p.token1 === sym) ||
        (p.token1 === "GALA" && p.token0 === sym)
      );

      const poolTvl = pool?.tvl || 0;
      const poolVol1d = pool?.volume1d || 0;
      const poolFee = pool?.fee || 1;

      // Calculate spread
      const diff = dexPrice - cgPrice;
      const spread = (Math.abs(diff) / cgPrice) * 100;
      if (spread < 0.5) continue;

      // Simulate spread depth
      const depth = simulateSpreadDepth(poolTvl, dexPrice, poolFee, spread);

      // Net spread after fees (not including impact — impact depends on trade size)
      const netSpreadAfterFees = spread - (poolFee * 2);

      // Confidence
      let conf = "low";
      if (poolTvl > 10000 && poolVol1d > 1000 && spread > 3 && depth.profitableTrade > 500) conf = "high";
      else if (poolTvl > 1000 && spread > 2 && depth.profitableTrade > 100) conf = "medium";

      // Direction
      const buyOn = diff > 0 ? `${bridge.chain} (external)` : "GalaSwap DEX";
      const sellOn = diff > 0 ? "GalaSwap DEX" : `${bridge.chain} (external)`;

      // Notes
      const notes: string[] = [];
      if (poolTvl < 1000) notes.push(`⚠️ Very low TVL ($${poolTvl.toFixed(0)})`);
      if (poolTvl < 100) notes.push(`🚫 Pool nearly empty`);
      if (depth.breakevenTrade < 100) notes.push(`Breakeven ~$${depth.breakevenTrade}`);
      if (depth.profitableTrade < 50) notes.push(`Profitable only < $${depth.profitableTrade}`);

      opportunities.push({
        id: `gvc-${sym}`,
        category: STABLES.has(sym) ? "depeg" : "galavscg",
        token: sym,
        spreadPct: Math.round(spread * 100) / 100,
        netSpreadPct: Math.round(netSpreadAfterFees * 100) / 100,
        buyPrice: diff > 0 ? cgPrice : dexPrice,
        sellPrice: diff > 0 ? dexPrice : cgPrice,
        buyOn,
        sellOn,
        profitPer1k: Math.round(Math.max(0, (depth.netProfitAtProfitable / 100) * 1000) * 100) / 100,
        confidence: conf,
        bridgeInfo: `${bridge.bridge} (${bridge.chain}↔GalaChain)`,
        poolTvl: Math.round(poolTvl * 100) / 100,
        poolVol1d: Math.round(poolVol1d * 100) / 100,
        poolFee,
        breakevenTrade: Math.round(depth.breakevenTrade),
        profitableTrade: Math.round(depth.profitableTrade),
        impactAtBreakeven: depth.impactAtBreakeven,
        impactAtProfitable: depth.impactAtProfitable,
        netProfitAtProfitable: depth.netProfitAtProfitable,
        galaDexPrice: dexPrice,
        cgPrice,
        notes: notes.join(" | "),
      });
    }

    // Sort by net spread
    opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      elapsed,
      poolCount: pools.length,
      tokenCount: symbols.length,
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

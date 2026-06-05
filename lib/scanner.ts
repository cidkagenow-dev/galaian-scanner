// GalaSwap Arb Scanner — Pool-Level Spread v4
// Shows spread per pool, exit asset, bridgeable status, real profit

const BASE_URL = "https://arb.gala.com";
const CG_API = "https://api.coingecko.com/api/v3";

// ─── Types ───────────────────────────────────────────────────────────

export interface PoolOpportunity {
  id: string;
  // Pool info
  poolId: string;
  tokenA: string;
  tokenB: string;
  pairName: string; // e.g., "GWBTC/GALA"
  poolFee: number; // e.g., 0.3, 1.0
  poolTvl: number;
  poolVol1d: number;
  
  // Token being arbed
  token: string; // The bridgeable token (e.g., GWBTC)
  tokenImage: string;
  
  // Prices
  galaDexPrice: number; // Price on GalaSwap (in GALA terms)
  galaDexPriceUsd: number; // Price on GalaSwap (in USD)
  cgPrice: number; // CoinGecko price
  
  // Spread
  spreadPct: number; // Raw spread %
  netSpreadPct: number; // After swap fees
  
  // Direction
  buyOn: string; // Where to buy (external chain)
  sellOn: string; // Where to sell (GalaSwap pool)
  exitAsset: string; // What you get after selling (GALA, USDC, etc.)
  exitAssetBridgeable: boolean; // Can exit asset be bridged back?
  exitAssetBridgeChain: string; // Which chain to bridge to
  
  // Trade sizing
  breakevenTrade: number; // Max trade where profit = $0
  profitableTrade: number; // Trade keeping 30% of spread
  impactAtBreakeven: number;
  impactAtProfitable: number;
  netProfitAtProfitable: number; // % profit at safe trade
  
  // Confidence
  confidence: "high" | "medium" | "low";
  notes: string;
  
  // Bridge info
  bridgeInfo: string;
  bridgeFee: number; // Assumed $0 based on user research
}

export interface ScanResult {
  timestamp: string;
  elapsed: number;
  poolCount: number;
  tokenCount: number;
  opportunities: PoolOpportunity[];
  stats: {
    total: number;
    highConf: number;
    medConf: number;
    bestSpread: number;
    bestNet: number;
  };
}

// ─── Bridge Map (expanded with exit asset info) ──────────────────────

interface BridgeInfo {
  chain: string;
  native: string;
  bridge: string;
  cgId: string;
  isStablecoin: boolean;
}

const BRIDGEABLE: Record<string, BridgeInfo> = {
  // Ethereum bridge
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
  // Solana bridge
  GSOL:      { chain: "solana", native: "SOL",      bridge: "GalaConnect", cgId: "solana", isStablecoin: false },
  GTRUMP:    { chain: "solana", native: "TRUMP",    bridge: "GalaConnect", cgId: "official-trump", isStablecoin: false },
  GMEW:      { chain: "solana", native: "MEW",      bridge: "GalaConnect", cgId: "cat-in-a-dogs-world", isStablecoin: false },
  GUFD:      { chain: "solana", native: "UFD",      bridge: "GalaConnect", cgId: "unicorn-fart-dust", isStablecoin: false },
  GFIGHT:    { chain: "solana", native: "FIGHT",    bridge: "GalaConnect", cgId: "fight-2", isStablecoin: false },
  GPONKE:    { chain: "solana", native: "PONKE",    bridge: "GalaConnect", cgId: "ponke", isStablecoin: false },
  GSHRAP:    { chain: "solana", native: "SHRAP",    bridge: "GalaConnect", cgId: "shrapnel-2", isStablecoin: false },
  GBIGTIME:  { chain: "solana", native: "BIGTIME",  bridge: "GalaConnect", cgId: "big-time", isStablecoin: false },
  GPENGU:    { chain: "solana", native: "PENGU",    bridge: "GalaConnect", cgId: "pudgy-penguins", isStablecoin: false },
  GFARTCOIN: { chain: "solana", native: "FARTCOIN", bridge: "GalaConnect", cgId: "fartcoin", isStablecoin: false },
  // TON bridge
  GTON:  { chain: "ton", native: "TON",  bridge: "GalaConnect", cgId: "the-open-network", isStablecoin: false },
  GBLUM: { chain: "ton", native: "BLUM", bridge: "GalaConnect", cgId: "blum", isStablecoin: false },
};

// Tokens that can be bridged back (same as BRIDGEABLE keys)
const BRIDGEABLE_BACK = new Set(Object.keys(BRIDGEABLE));

// GALA price in USD (cached per scan)
let GALA_USD = 0.0026; // Default fallback

// ─── API Helpers ─────────────────────────────────────────────────────

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    headers: { "User-Agent": "GalaSwapArbWeb/4.0" },
  });
  if (!r.ok) throw new Error(`API ${r.status}: ${url}`);
  return r.json();
}

async function fetchCGPrice(cgId: string): Promise<number> {
  try {
    const r = await fetch(`${CG_API}/simple/price?ids=${cgId}&vs_currencies=usd`, {
      headers: { "User-Agent": "GalaSwapArbWeb/4.0" },
    });
    if (!r.ok) return 0;
    const data = await r.json();
    return data[cgId]?.usd ?? 0;
  } catch {
    return 0;
  }
}

async function getQuote(
  from: string,
  to: string,
  amount: string
): Promise<{ amountOut: number; priceImpact: number; fee: number } | null> {
  try {
    const r = await fetch(`${BASE_URL}/api/swap/quote`, {
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
  } catch {
    return null;
  }
}

// ─── Scanner ─────────────────────────────────────────────────────────

export async function scanForOpportunities(): Promise<ScanResult> {
  const startTime = Date.now();

  // Fetch pools from GalaSwap
  const rawPools = await fetchJSON<any[]>(`${BASE_URL}/api/pools`);
  
  // Fetch GALA price
  GALA_USD = await fetchCGPrice("gala") || 0.0026;

  const opportunities: PoolOpportunity[] = [];
  const processedTokens = new Set<string>();

  // Process each pool
  for (const pool of rawPools) {
    const tokenA = pool.token0?.symbol;
    const tokenB = pool.token1?.symbol;
    
    if (!tokenA || !tokenB) continue;
    
    // Find which token is bridgeable
    const bridgeA = BRIDGEABLE[tokenA];
    const bridgeB = BRIDGEABLE[tokenB];
    
    // Skip if neither token is bridgeable
    if (!bridgeA && !bridgeB) continue;
    
    // Determine which token to arb
    const token = bridgeA ? tokenA : tokenB;
    const bridge = bridgeA ? bridgeA : bridgeB!;
    const exitAsset = bridgeA ? tokenB : tokenA;
    const exitBridgeable = BRIDGEABLE_BACK.has(exitAsset);
    const exitBridgeInfo = BRIDGEABLE[exitAsset];
    
    // Skip if we already processed this token (keep best pool)
    // We'll process all pools for now to show pool-level data
    const poolId = pool.poolId || `${tokenA}-${tokenB}-${pool.fee}`;
    const pairName = `${tokenA}/${tokenB}`;
    const poolFee = pool.fee ? parseFloat(pool.fee) * 100 : 0.3; // Convert to %
    const poolTvl = pool.tvl ? parseFloat(pool.tvl) : 0;
    const poolVol1d = pool.volume24h ? parseFloat(pool.volume24h) : 0;
    
    // Get CoinGecko price for the bridgeable token
    const cgPrice = await fetchCGPrice(bridge.cgId);
    if (!cgPrice) continue;
    
    // Get quote: sell 1 unit of bridgeable token → exit asset
    const quote = await getQuote(token, exitAsset, "1");
    if (!quote) continue;
    
    // Calculate GalaSwap price in USD
    let galaDexPriceUsd = 0;
    if (exitBridgeInfo?.isStablecoin) {
      // Exit asset is stablecoin, amountOut is already in USD
      galaDexPriceUsd = quote.amountOut;
    } else if (exitAsset === "GALA" || exitAsset === "GALA") {
      // Exit asset is GALA, convert to USD
      galaDexPriceUsd = quote.amountOut * GALA_USD;
    } else {
      // Exit asset is another token, need to get its price
      const exitCgId = exitBridgeInfo?.cgId;
      if (exitCgId) {
        const exitPrice = await fetchCGPrice(exitCgId);
        galaDexPriceUsd = quote.amountOut * exitPrice;
      }
    }
    
    if (!galaDexPriceUsd) continue;
    
    // Calculate spread
    const spreadPct = ((galaDexPriceUsd - cgPrice) / cgPrice) * 100;
    
    // Skip if spread is too small (negative = buy on GalaSwap, sell external)
    // We want positive spread = buy external, sell on GalaSwap
    if (spreadPct < 0.5) continue;
    
    // Net spread after swap fees (round-trip: buy on external has no fee, sell on GalaSwap has fee)
    // Actually: buy external (no fee) → bridge (free) → sell on GalaSwap (fee)
    // So net = spread - swap fee - price impact
    const netSpreadPct = spreadPct - poolFee - quote.priceImpact;
    
    // Trade sizing (simplified - assume 30% effective liquidity)
    const effectiveLiq = poolTvl * 0.30;
    const breakevenTrade = effectiveLiq * (spreadPct / 100) / (poolFee / 100 + quote.priceImpact / 100);
    const profitableTrade = breakevenTrade * 0.7; // 70% of breakeven keeps 30% of spread
    const impactAtBreakeven = quote.priceImpact * (breakevenTrade / effectiveLiq);
    const impactAtProfitable = quote.priceImpact * (profitableTrade / effectiveLiq);
    const netProfitAtProfitable = spreadPct - poolFee - impactAtProfitable;
    
    // Confidence
    let confidence: "high" | "medium" | "low" = "low";
    if (poolVol1d > 100000 && spreadPct > 5 && netSpreadPct > 2) confidence = "high";
    else if (poolVol1d > 10000 && spreadPct > 3 && netSpreadPct > 1) confidence = "medium";
    
    opportunities.push({
      id: `${poolId}-${token}`,
      poolId,
      tokenA,
      tokenB,
      pairName,
      poolFee,
      poolTvl,
      poolVol1d,
      token,
      tokenImage: "",
      galaDexPrice: quote.amountOut,
      galaDexPriceUsd,
      cgPrice,
      spreadPct: round2(spreadPct),
      netSpreadPct: round2(netSpreadPct),
      buyOn: `${bridge.chain} (external)`,
      sellOn: `GalaSwap ${pairName}`,
      exitAsset,
      exitAssetBridgeable: exitBridgeable,
      exitAssetBridgeChain: exitBridgeInfo?.chain || "unknown",
      breakevenTrade: round2(breakevenTrade),
      profitableTrade: round2(profitableTrade),
      impactAtBreakeven: round2(impactAtBreakeven),
      impactAtProfitable: round2(impactAtProfitable),
      netProfitAtProfitable: round2(netProfitAtProfitable),
      confidence,
      notes: exitBridgeable ? "" : `⚠️ ${exitAsset} not bridgeable back`,
      bridgeInfo: `${bridge.bridge} (${bridge.chain}↔GalaChain)`,
      bridgeFee: 0,
    });
  }

  // Sort by net spread descending
  opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);

  const high = opportunities.filter((o) => o.confidence === "high").length;
  const med = opportunities.filter((o) => o.confidence === "medium").length;

  return {
    timestamp: new Date().toISOString(),
    elapsed: Date.now() - startTime,
    poolCount: rawPools.length,
    tokenCount: new Set(opportunities.map(o => o.token)).size,
    opportunities,
    stats: {
      total: opportunities.length,
      highConf: high,
      medConf: med,
      bestSpread: opportunities[0]?.spreadPct ?? 0,
      bestNet: opportunities[0]?.netSpreadPct ?? 0,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

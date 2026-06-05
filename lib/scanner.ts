// GalaSwap Arb Scanner — Core Logic
// Reverse-engineered from arb.gala.com

const BASE_URL = "https://arb.gala.com";

// ─── Types ───────────────────────────────────────────────────────────

export interface TokenData {
  symbol: string;
  galaPrice: number;
  cgPrice: number;
  cgId: string;
  volume24h: number;
  spreadPct: number;
  image: string;
}

export interface PoolData {
  pair: string;
  tokenIn: string;
  tokenOut: string;
  isActive: boolean;
}

export interface QuoteResult {
  amountIn: number;
  amountOut: number;
  rate: number;
  priceImpact: number;
  fee: number;
  isDirect: boolean;
  route: string[];
}

export interface Opportunity {
  id: string;
  category: "galavscg" | "bidirectional" | "depeg" | "triangular";
  token: string;
  tokenImage: string;
  spreadPct: number;
  netSpreadPct: number;
  buyPrice: number;
  sellPrice: number;
  buyOn: string;
  sellOn: string;
  profitAtProfitable: number;
  confidence: "high" | "medium" | "low";
  bridgeInfo: string;
  cgId: string;
  volume24h: number;
  galaPrice: number;
  cgPrice: number;
  priceImpact: number;
  notes: string;
  timestamp: number;
}

export interface ScanResult {
  timestamp: string;
  tokensScanned: number;
  poolsScanned: number;
  opportunities: Opportunity[];
  stats: {
    total: number;
    highConf: number;
    mediumConf: number;
    lowConf: number;
    bestSpread: number;
  };
}

// ─── Bridge Map ──────────────────────────────────────────────────────

const BRIDGEABLE: Record<string, { chain: string; native: string; bridge: string }> = {
  GBLUM: { chain: "ton", native: "BLUM", bridge: "GalaConnect" },
  GTON: { chain: "ton", native: "TON", bridge: "GalaConnect" },
  GALA: { chain: "ethereum", native: "GALA", bridge: "GalaConnect" },
  GWETH: { chain: "ethereum", native: "ETH", bridge: "GalaConnect" },
  GWBTC: { chain: "ethereum", native: "BTC", bridge: "GalaConnect" },
  GUSDT: { chain: "ethereum", native: "USDT", bridge: "GalaConnect" },
  GUSDC: { chain: "ethereum", native: "USDC", bridge: "GalaConnect" },
  GSOL: { chain: "solana", native: "SOL", bridge: "GalaConnect" },
  GTRUMP: { chain: "solana", native: "TRUMP", bridge: "GalaConnect" },
  GMEW: { chain: "solana", native: "MEW", bridge: "GalaConnect" },
  GUFD: { chain: "solana", native: "UFD", bridge: "GalaConnect" },
};

const SKIP_TOKENS = new Set([
  "GWXRP", "GWTRX", // No bridge
  "GSUSDT", "GSUSDC", // Internal stablecoin variants
  "TestToken1", "TestToken3", "Token", // Test tokens
  "GFIGHT", "GSWAP", "ETIME", "SILK", "GFINANCE", // No CG price
]);

const STABLECOINS = new Set(["GUSDT", "GUSDC"]);
const DEX_FEE = 0.3; // % per swap

// ─── API Helpers ─────────────────────────────────────────────────────

async function fetchJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, {
    headers: { "User-Agent": "GalaSwapArbWeb/1.0" },
    // @ts-ignore - Next.js fetch extension
    next: { revalidate: 30 },
  } as any);
  if (!r.ok) throw new Error(`API ${r.status}: ${url}`);
  return r.json();
}

async function getQuote(
  from: string,
  to: string,
  amount: string
): Promise<QuoteResult | null> {
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
      // @ts-ignore - Next.js fetch extension
      next: { revalidate: 15 },
    } as any);
    if (!r.ok) return null;
    const data = await r.json();
    const q = data.quote;
    const ain = parseFloat(q.amountIn);
    const aout = parseFloat(q.amountOut);
    if (!ain) return null;
    return {
      amountIn: ain,
      amountOut: aout,
      rate: aout / ain,
      priceImpact: parseFloat(q.priceImpact || "0"),
      fee: parseFloat(q.fee || "0"),
      isDirect: q.isDirectSwap ?? true,
      route: q.route || [],
    };
  } catch {
    return null;
  }
}

// ─── Scanner ─────────────────────────────────────────────────────────

export async function scanForOpportunities(): Promise<ScanResult> {
  const startTime = Date.now();

  // Fetch tokens and pools in parallel
  const [rawTokens, rawPools] = await Promise.all([
    fetchJSON<any[]>(`${BASE_URL}/api/tokens`),
    fetchJSON<any[]>(`${BASE_URL}/api/pools`),
  ]);

  const opportunities: Opportunity[] = [];

  // ── 1. GalaSwap vs CoinGecko ──
  for (const tok of rawTokens) {
    const sym: string = tok.symbol;
    if (SKIP_TOKENS.has(sym)) continue;

    const gala = tok.galaPrice as number;
    const cg = tok.coinGeckoPrice as number;
    const vol = tok.volume24h as number;
    const cgId = tok.coinGeckoId as string;

    if (!gala || !cg) continue;

    const bridge = BRIDGEABLE[sym];
    if (!bridge) continue;

    const diff = gala - cg;
    const spread = (Math.abs(diff) / cg) * 100;

    if (spread < 0.5) continue;

    const netSpread = spread - DEX_FEE * 2;

    let conf: "high" | "medium" | "low" = "low";
    if (vol > 100000 && spread > 5) conf = "high";
    else if (vol > 1000 && spread > 3) conf = "medium";

    const isStable = STABLECOINS.has(sym);
    const category = isStable ? "depeg" : "galavscg";

    opportunities.push({
      id: `gvc-${sym}`,
      category,
      token: sym,
      tokenImage: tok.image || "",
      spreadPct: round2(spread),
      netSpreadPct: round2(netSpread),
      buyPrice: diff > 0 ? cg : gala,
      sellPrice: diff > 0 ? gala : cg,
      buyOn: diff > 0 ? `${bridge.chain} (external)` : "GalaSwap DEX",
      sellOn: diff > 0 ? "GalaSwap DEX" : `${bridge.chain} (external)`,
      profitAtProfitable: round2(Math.max(0, (netSpread / 100) * 1000)),
      confidence: conf,
      bridgeInfo: `${bridge.bridge} (${bridge.chain}↔GalaChain)`,
      cgId,
      volume24h: vol,
      galaPrice: gala,
      cgPrice: cg,
      priceImpact: 2.0, // Default from API
      notes: isStable ? `$${gala.toFixed(6)} vs $${cg.toFixed(6)}` : "",
      timestamp: Date.now(),
    });
  }

  // ── 2. Bidirectional spread (sample key tokens) ──
  const bidirTargets = ["GBLUM", "GTON", "GTRUMP", "GMEW", "GUFD"];
  const bidirResults = await Promise.allSettled(
    bidirTargets.map(async (target) => {
      if (SKIP_TOKENS.has(target) || !BRIDGEABLE[target]) return null;

      const qBuy = await getQuote("GALA", target, "10000");
      if (!qBuy) return null;

      const sellAmt = qBuy.amountOut / 1e18;
      if (sellAmt <= 0) return null;

      const qSell = await getQuote(target, "GALA", sellAmt.toFixed(6));
      if (!qSell) return null;

      const galaBack = qSell.amountOut / 1e18;
      const rtPnl = ((galaBack - 10000) / 10000) * 100;

      return { target, rtPnl, qBuy, qSell };
    })
  );

  for (const result of bidirResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    const { target, rtPnl, qBuy, qSell } = result.value;

    const expectedMinLoss = -(DEX_FEE * 2 + qBuy.priceImpact + qSell.priceImpact);
    if (rtPnl > expectedMinLoss && Math.abs(rtPnl) > 0.3) {
      opportunities.push({
        id: `bid-${target}`,
        category: "bidirectional",
        token: target,
        tokenImage: "",
        spreadPct: round2(Math.abs(rtPnl)),
        netSpreadPct: round2(rtPnl - DEX_FEE * 2),
        buyPrice: qBuy.rate,
        sellPrice: qSell.rate > 0 ? 1 / qSell.rate : 0,
        buyOn: `GALA→${target}`,
        sellOn: `${target}→GALA`,
        profitAtProfitable: round2(Math.max(0, (rtPnl / 100) * 1000)),
        confidence: rtPnl > 0 ? "high" : "medium",
        bridgeInfo: `Round-trip: ${rtPnl >= 0 ? "+" : ""}${rtPnl.toFixed(2)}%`,
        cgId: "",
        volume24h: 0,
        galaPrice: 0,
        cgPrice: 0,
        priceImpact: qBuy.priceImpact + qSell.priceImpact,
        notes: `Buy impact: ${qBuy.priceImpact}% | Sell impact: ${qSell.priceImpact}%`,
        timestamp: Date.now(),
      });
    }
  }

  // Sort by net spread descending
  opportunities.sort((a, b) => b.netSpreadPct - a.netSpreadPct);

  const high = opportunities.filter((o) => o.confidence === "high").length;
  const med = opportunities.filter((o) => o.confidence === "medium").length;
  const low = opportunities.filter((o) => o.confidence === "low").length;

  return {
    timestamp: new Date().toISOString(),
    tokensScanned: rawTokens.length,
    poolsScanned: rawPools.length,
    opportunities,
    stats: {
      total: opportunities.length,
      highConf: high,
      mediumConf: med,
      lowConf: low,
      bestSpread: opportunities[0]?.spreadPct ?? 0,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

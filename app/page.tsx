"use client";

import { useState, useEffect, useCallback } from "react";

interface PoolOpportunity {
  id: string;
  poolId: string;
  tokenA: string;
  tokenB: string;
  pairName: string;
  poolFee: number;
  poolTvl: number;
  poolVol1d: number;
  token: string;
  tokenImage: string;
  galaDexPrice: number;
  galaDexPriceUsd: number;
  cgPrice: number;
  spreadPct: number;
  netSpreadPct: number;
  buyOn: string;
  sellOn: string;
  exitAsset: string;
  exitAssetBridgeable: boolean;
  exitAssetBridgeChain: string;
  breakevenTrade: number;
  profitableTrade: number;
  impactAtBreakeven: number;
  impactAtProfitable: number;
  netProfitAtProfitable: number;
  confidence: string;
  notes: string;
  bridgeInfo: string;
  bridgeFee: number;
}

interface ScanResult {
  timestamp: string;
  elapsed: number;
  poolCount: number;
  tokenCount: number;
  opportunities: PoolOpportunity[];
  stats: { total: number; highConf: number; medConf: number; bestSpread: number; bestNet: number };
}

type SortKey = "spreadPct" | "netSpreadPct" | "poolTvl" | "breakevenTrade" | "profitableTrade" | "token" | "pairName";
type SortDir = "asc" | "desc";

const fmtVol = (v: number) => {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtPrice = (p: number) => {
  if (!p) return "—";
  if (p < 0.0001) return `$${p.toFixed(8)}`;
  if (p < 0.01) return `$${p.toFixed(6)}`;
  if (p < 1) return `$${p.toFixed(4)}`;
  if (p < 1000) return `$${p.toFixed(2)}`;
  return `$${p.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
};

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";

export default function Home() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("netSpreadPct");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(30);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [minTvl, setMinTvl] = useState<number>(0);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch("/api/scan");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setCountdown(30);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const iv = setInterval(() => setCountdown(c => { if (c <= 1) { fetchData(); return 30; } return c - 1; }), 1000);
    return () => clearInterval(iv);
  }, [autoRefresh, fetchData]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  let opps = data?.opportunities ?? [];
  if (search) { const q = search.toLowerCase(); opps = opps.filter(o => o.token.toLowerCase().includes(q) || o.pairName.toLowerCase().includes(q)); }
  if (minTvl > 0) { opps = opps.filter(o => o.poolTvl >= minTvl); }
  opps = [...opps].sort((a, b) => {
    const va = (a as any)[sortKey] ?? 0;
    const vb = (b as any)[sortKey] ?? 0;
    if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === "asc" ? va - vb : vb - va;
  });

  const stats = data?.stats;
  const SA = ({ col }: { col: SortKey }) => sortKey === col ? <span className="sa">{sortDir === "asc" ? "↑" : "↓"}</span> : null;

  return (
    <div className="container">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <h1>GalaSwap Arb Scanner</h1>
            <span className="badge">v4.0</span>
            <span className="badge badge-new">Pool-Level</span>
          </div>
          <div className="header-right">
            {data && <div className="last-updated"><div className={`status-dot ${loading ? "loading" : error ? "error" : ""}`} /><span>{fmtTime(data.timestamp)}</span>{autoRefresh && <span className="countdown">({countdown}s)</span>}</div>}
            <button className="refresh-btn" onClick={() => setAutoRefresh(!autoRefresh)}>{autoRefresh ? "⏸" : "▶"} Auto</button>
            <button className="refresh-btn" onClick={fetchData} disabled={loading}>{loading ? "⏳" : "🔄"}</button>
          </div>
        </div>
      </header>

      {data && (
        <div className="stats-row">
          <div className="stat-card"><div className="label">Opportunities</div><div className="value purple">{stats?.total ?? 0}</div></div>
          <div className="stat-card"><div className="label">High Conf</div><div className="value green">{stats?.highConf ?? 0}</div></div>
          <div className="stat-card"><div className="label">Best Spread</div><div className="value yellow">{stats?.bestSpread?.toFixed(1)}%</div></div>
          <div className="stat-card"><div className="label">Best Net</div><div className="value green">{stats?.bestNet?.toFixed(2)}%</div></div>
          <div className="stat-card"><div className="label">Pools</div><div className="value blue">{data.poolCount}</div></div>
        </div>
      )}

      <div className="filter-bar">
        <input className="search-input" placeholder="🔍 Search token or pair..." value={search} onChange={e => setSearch(e.target.value)} />
        <div className="tvl-filter"><label>Min TVL $</label><input type="number" className="tvl-input" value={minTvl} onChange={e => setMinTvl(Number(e.target.value) || 0)} placeholder="0" min={0} step={100} /></div>
        <div className="legend">
          <span className="legend-item"><span className="dot green" />Breakeven = max trade where profit=$0</span>
          <span className="legend-item"><span className="dot yellow" />Profitable = trade keeping 30% of spread</span>
        </div>
      </div>

      {error && <div className="empty-state"><div className="icon">❌</div><h3>Scan Failed</h3><p>{error}</p></div>}

      {loading && !data && <div className="table-wrap"><table><tbody>{Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j}><div className="skeleton" style={{ height: 20, width: 80 }} /></td>)}</tr>)}</tbody></table></div>}

      {data && opps.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th onClick={() => handleSort("pairName")}>Pair <SA col="pairName" /></th>
              <th onClick={() => handleSort("spreadPct")}>Spread <SA col="spreadPct" /></th>
              <th>Pool Fee</th>
              <th onClick={() => handleSort("poolTvl")}>Pool TVL <SA col="poolTvl" /></th>
              <th>Exit Asset</th>
              <th className="col-highlight" onClick={() => handleSort("breakevenTrade")}>🔴 Breakeven <SA col="breakevenTrade" /></th>
              <th className="col-highlight" onClick={() => handleSort("profitableTrade")}>🟢 Profitable <SA col="profitableTrade" /></th>
              <th>Profit</th>
              <th>Conf</th>
            </tr></thead>
            <tbody>
              {opps.map(opp => {
                const isExp = expanded === opp.id;
                return (
                  <>
                    <tr key={opp.id} onClick={() => setExpanded(isExp ? null : opp.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <div className="token-cell">
                          <div className="token-icon">{opp.token[0]}</div>
                          <div>
                            <div className="symbol">{opp.pairName}</div>
                            <div className="cg-id">{opp.bridgeInfo.split("(")[0]}</div>
                          </div>
                        </div>
                      </td>
                      <td><span className={`spread-cell ${opp.spreadPct >= 0 ? "positive" : "negative"}`}>{opp.spreadPct >= 0 ? "+" : ""}{opp.spreadPct.toFixed(1)}%</span><div className="sub">net {opp.netSpreadPct >= 0 ? "+" : ""}{opp.netSpreadPct.toFixed(2)}%</div></td>
                      <td><span className="fee-cell">{opp.poolFee}%</span></td>
                      <td><span className={`tvl-cell ${opp.poolTvl > 10000 ? "green" : opp.poolTvl > 1000 ? "yellow" : "red"}`}>{fmtVol(opp.poolTvl)}</span><div className="sub">vol {fmtVol(opp.poolVol1d)}</div></td>
                      <td>
                        <div className="exit-asset">
                          <span className={`badge ${opp.exitAssetBridgeable ? "green" : "yellow"}`}>{opp.exitAsset}</span>
                          {!opp.exitAssetBridgeable && <div className="sub" style={{color:"var(--yellow)"}}>⚠️ Not bridgeable</div>}
                        </div>
                      </td>
                      <td className="col-highlight">
                        <div className="trade-cell">
                          <span className="breakeven-val">{fmtVol(opp.breakevenTrade)}</span>
                          <div className="sub">impact {opp.impactAtBreakeven.toFixed(1)}%</div>
                        </div>
                      </td>
                      <td className="col-highlight">
                        <div className="trade-cell">
                          <span className="profitable-val">{fmtVol(opp.profitableTrade)}</span>
                          <div className="sub">impact {opp.impactAtProfitable.toFixed(1)}%</div>
                        </div>
                      </td>
                      <td>
                        <div className="profit-detail">
                          <span className="profit-val">{opp.netProfitAtProfitable.toFixed(2)}%</span>
                          <div className="sub">{fmtVol(opp.profitableTrade)}→${Math.round(opp.profitableTrade * (1 + opp.netProfitAtProfitable / 100))}</div>
                        </div>
                      </td>
                      <td><span className={`badge ${opp.confidence}`}>{opp.confidence === "high" ? "🟢" : opp.confidence === "medium" ? "🟡" : "🔴"} {opp.confidence}</span></td>
                    </tr>
                    {isExp && (
                      <tr className="expanded-row" key={`${opp.id}-exp`}>
                        <td colSpan={9}>
                          <div className="expanded-content">
                            <div className="detail-group"><label>Pair</label><div className="val">{opp.pairName}</div></div>
                            <div className="detail-group"><label>GalaSwap Price</label><div className="val">{fmtPrice(opp.galaDexPriceUsd)}</div></div>
                            <div className="detail-group"><label>CoinGecko Price</label><div className="val">{fmtPrice(opp.cgPrice)}</div></div>
                            <div className="detail-group"><label>Spread</label><div className="val" style={{color:"var(--green)"}}>{opp.spreadPct.toFixed(2)}%</div></div>
                            <div className="detail-group"><label>Pool Fee</label><div className="val">{opp.poolFee}%</div></div>
                            <div className="detail-group"><label>🟢 Buy On</label><div className="val">{opp.buyOn}</div></div>
                            <div className="detail-group"><label>🔴 Sell On</label><div className="val">{opp.sellOn}</div></div>
                            <div className="detail-group"><label>Exit Asset</label><div className="val" style={{color: opp.exitAssetBridgeable ? "var(--green)" : "var(--yellow)"}}>{opp.exitAsset} {opp.exitAssetBridgeable ? "✅ Bridgeable" : "⚠️ Not bridgeable"}</div></div>
                            <div className="detail-group"><label>Bridge</label><div className="val" style={{color:"var(--cyan)"}}>{opp.bridgeInfo}</div></div>
                            <div className="detail-group"><label>Profit @ Safe</label><div className="val" style={{color:opp.netProfitAtProfitable>0?"var(--green)":"var(--red)"}}>{opp.netProfitAtProfitable>0?`$${opp.netProfitAtProfitable}`:"—"}</div></div>
                            <div className="detail-group" style={{gridColumn:"1/-1"}}>
                              <label>📐 Spread Breakdown</label>
                              <div className="depth-bar">
                                <div className="depth-fees" style={{width:`${Math.min(100, (opp.poolFee/opp.spreadPct)*100)}%`}}>
                                  Fee {opp.poolFee}%
                                </div>
                                <div className="depth-impact" style={{width:`${Math.min(100, (opp.impactAtProfitable/opp.spreadPct)*100)}%`}}>
                                  Impact {opp.impactAtProfitable.toFixed(1)}%
                                </div>
                                <div className="depth-profit" style={{width:`${Math.min(100, Math.max(0, opp.netProfitAtProfitable/opp.spreadPct)*100)}%`}}>
                                  Profit {opp.netProfitAtProfitable.toFixed(1)}%
                                </div>
                              </div>
                              <div className="depth-labels">
                                <span>Total spread: {opp.spreadPct.toFixed(1)}%</span>
                                <span>Breakeven: {fmtVol(opp.breakevenTrade)}</span>
                                <span>Safe trade: {fmtVol(opp.profitableTrade)}</span>
                              </div>
                            </div>
                            {opp.notes && <div className="detail-group" style={{gridColumn:"1/-1"}}><label>⚠️ Notes</label><div className="val" style={{color:"var(--yellow)"}}>{opp.notes}</div></div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && opps.length === 0 && !loading && <div className="empty-state"><div className="icon">✅</div><h3>No Opportunities</h3><p>All spreads consumed by fees + impact.</p></div>}

      <footer className="footer">
        <p><strong>GalaSwap Arb Scanner v4.0</strong> — Pool-level spread + Exit asset + Bridge status</p>
        <p style={{marginTop:"0.5rem"}}>Data: <a href="https://dex-backend-prod1.defi.gala.com" target="_blank">GalaSwap DEX</a> + <a href="https://www.coingecko.com" target="_blank">CoinGecko</a> | Auto-refresh 30s</p>
        <p style={{marginTop:"0.5rem",color:"var(--text-muted)"}}>📐 Breakeven = max trade where profit=$0. Profitable = trade keeping 30% of spread. Bridge fee = $0 (GalaConnect free).</p>
      </footer>
    </div>
  );
}
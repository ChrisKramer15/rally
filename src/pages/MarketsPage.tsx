import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, RefreshCw, Search, Wifi } from 'lucide-react';
import { SYMBOLS } from '../data/mockMarket';
import { getLiveBatchQuotes, subscribeToLivePrice } from '../services/marketData';
import type { Quote, AssetClass } from '../types';
import Badge from '../components/Badge';
import DataSourceBanner from '../components/DataSourceBanner';

const TABS: AssetClass[] = ['stock', 'etf', 'crypto', 'futures', 'forex'];

const BADGE_COLORS: Record<AssetClass, 'blue' | 'purple' | 'yellow' | 'indigo' | 'green'> = {
  stock: 'blue', etf: 'purple', crypto: 'yellow', futures: 'indigo', forex: 'green',
};

export default function MarketsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<AssetClass>('stock');
  const [quotes, setQuotes] = useState<(Quote | null)[]>([]);
  const [search, setSearch] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const wsUnsubs = useRef<(() => void)[]>([]);

  const loadQuotes = useCallback(async () => {
    setLoading(true);
    const symbols = SYMBOLS[tab];
    try {
      const q = await getLiveBatchQuotes(symbols.map((s) => ({ ...s, assetClass: tab })));
      setQuotes(q);
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [tab]);

  // Initial load + REST polling fallback every 15s
  useEffect(() => {
    loadQuotes();
    const t = setInterval(loadQuotes, 15_000);
    return () => clearInterval(t);
  }, [loadQuotes]);

  // WebSocket live price updates — only apply to non-null (live) quotes
  useEffect(() => {
    // Clean up previous tab's subscriptions
    wsUnsubs.current.forEach((fn) => fn());
    wsUnsubs.current = [];

    const symbols = SYMBOLS[tab];

    symbols.forEach((s) => {
      const unsub = subscribeToLivePrice(s.symbol, tab, 0, (price, change, changePercent) => {
        setQuotes((prev) =>
          prev.map((q) =>
            q && q.symbol === s.symbol
              ? {
                  ...q,
                  price,
                  change: parseFloat(change.toFixed(price < 10 ? 5 : 2)),
                  changePercent: parseFloat(changePercent.toFixed(2)),
                  timestamp: Date.now(),
                }
              : q
          )
        );
      });
      wsUnsubs.current.push(unsub);
    });

    return () => {
      wsUnsubs.current.forEach((fn) => fn());
      wsUnsubs.current = [];
    };
  }, [tab]);

  // Build a merged list of all symbols for the current tab, pairing with live quote or null
  const allTabSymbols = SYMBOLS[tab];
  const quoteMap = new Map(quotes.filter(Boolean).map((q) => [q!.symbol, q!]));

  const filtered = allTabSymbols.filter((s) => {
    const q = quoteMap.get(s.symbol);
    const name = q?.name ?? s.name;
    return (
      s.symbol.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Markets</h1>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
            <Wifi size={10} /> Last updated: {lastUpdated.toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={loadQuotes}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <DataSourceBanner />

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-slate-800 p-1 rounded-xl w-fit">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {t === 'crypto' ? '⚡ crypto' : t}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-xs">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by symbol or name"
          className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Table */}
      {loading && quotes.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="animate-spin text-indigo-400" size={28} />
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Symbol</th>
                  <th className="text-right px-4 py-3">Price</th>
                  <th className="text-right px-4 py-3">Change</th>
                  <th className="text-right px-4 py-3">Change %</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Open</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">High</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Low</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Volume</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Bid</th>
                  <th className="text-right px-4 py-3 hidden lg:table-cell">Ask</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const q = quoteMap.get(s.symbol) ?? null;

                  // ── Coming Soon row (futures with no data) ──
                  if (!q) {
                    return (
                      <tr key={s.symbol} className="border-b border-slate-700/50">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-400">{s.symbol}</div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <Badge label="futures" variant="indigo" />
                            <span className="text-slate-500 text-xs">{s.name}</span>
                          </div>
                        </td>
                        <td colSpan={9} className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-slate-700/50 border border-slate-600/50 px-3 py-1 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" />
                            Coming Soon
                          </span>
                        </td>
                        <td className="px-4 py-3" />
                      </tr>
                    );
                  }

                  // ── Live data row ──
                  const isUp = q.change >= 0;
                  const p = (v: number) => v.toFixed(v < 10 ? 4 : 2);
                  return (
                    <tr
                      key={q.symbol}
                      className="border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/valuation/${encodeURIComponent(q.symbol).replace('%2F', '--')}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white">{q.symbol}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Badge label={q.assetClass} variant={BADGE_COLORS[q.assetClass]} />
                          <span className="text-slate-500 text-xs truncate max-w-[120px]">{q.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-white">${p(q.price)}</td>
                      <td className={`px-4 py-3 text-right font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isUp ? '+' : ''}{p(q.change)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                        <div className="flex items-center justify-end gap-1">
                          {isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {isUp ? '+' : ''}{q.changePercent.toFixed(2)}%
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400 hidden md:table-cell">${p(q.open)}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-500 hidden md:table-cell">${p(q.high)}</td>
                      <td className="px-4 py-3 text-right font-mono text-red-500 hidden md:table-cell">${p(q.low)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400 hidden lg:table-cell">
                        {q.volume > 0 ? q.volume.toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400 hidden lg:table-cell">${p(q.bid)}</td>
                      <td className="px-4 py-3 text-right font-mono text-slate-400 hidden lg:table-cell">${p(q.ask)}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-indigo-400 hover:underline">Analyze →</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, TrendingUp, TrendingDown, RefreshCw,
  Target, AlertTriangle, Activity, Zap, Clock
} from 'lucide-react';
import { getAllSymbols } from '../data/mockMarket';
import { getLiveQuote, getLiveCandles, subscribeToLivePrice } from '../services/marketData';
import { computeValuation } from '../data/valuation';
import type { Quote, Valuation, TradeRecommendation, OHLCV } from '../types';
import PriceChart from '../components/PriceChart';
import Badge from '../components/Badge';
import StatCard from '../components/StatCard';
import DataSourceBanner from '../components/DataSourceBanner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function confidenceColor(c: number): string {
  if (c >= 70) return 'text-emerald-400';
  if (c >= 45) return 'text-yellow-400';
  return 'text-red-400';
}

function tradeStyleIcon(style: string) {
  switch (style) {
    case 'scalp':    return <Zap size={13} className="text-yellow-400" />;
    case 'day':      return <Clock size={13} className="text-blue-400" />;
    case 'swing':    return <Activity size={13} className="text-purple-400" />;
    case 'position': return <Target size={13} className="text-emerald-400" />;
    default:         return null;
  }
}

function tradeStyleBadge(style: string): 'yellow' | 'blue' | 'purple' | 'green' {
  switch (style) {
    case 'scalp':  return 'yellow';
    case 'day':    return 'blue';
    case 'swing':  return 'purple';
    default:       return 'green';
  }
}

function tradeStyleDesc(style: string): string {
  switch (style) {
    case 'scalp':    return 'Scalp trade — minutes to hours, very tight stops, high-frequency entries';
    case 'day':      return 'Day trade — intraday, position closed before market session ends';
    case 'swing':    return 'Swing trade — hold days to weeks, riding short-term momentum moves';
    case 'position': return 'Position trade — hold weeks to months, macro trend or fundamental play';
    default:         return '';
  }
}

// ─── Zone Panel ───────────────────────────────────────────────────────────────

function ZonePanel({ valuation }: { valuation: Valuation }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="bg-slate-800 border border-red-900/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-1.5">
          <TrendingDown size={14} /> Supply Zones (Resistance)
        </h3>
        {valuation.supplyZones.length === 0 ? (
          <p className="text-xs text-slate-500">No nearby supply zones detected.</p>
        ) : (
          <div className="space-y-3">
            {valuation.supplyZones.map((z) => (
              <div key={z.id} className="bg-red-900/20 border border-red-800/40 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-red-300">
                    ${z.priceLow.toFixed(4)} – ${z.priceHigh.toFixed(4)}
                  </span>
                  <Badge
                    label={z.strength}
                    variant={z.strength === 'strong' ? 'red' : z.strength === 'moderate' ? 'yellow' : 'slate'}
                  />
                </div>
                <p className="text-xs text-slate-400">{z.description}</p>
                {z.tested > 0 && (
                  <p className="text-xs text-slate-500 mt-1">Tested {z.tested}× — weakens with each touch</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-800 border border-emerald-900/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-1.5">
          <TrendingUp size={14} /> Demand Zones (Support)
        </h3>
        {valuation.demandZones.length === 0 ? (
          <p className="text-xs text-slate-500">No nearby demand zones detected.</p>
        ) : (
          <div className="space-y-3">
            {valuation.demandZones.map((z) => (
              <div key={z.id} className="bg-emerald-900/20 border border-emerald-800/40 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono text-emerald-300">
                    ${z.priceLow.toFixed(4)} – ${z.priceHigh.toFixed(4)}
                  </span>
                  <Badge
                    label={z.strength}
                    variant={z.strength === 'strong' ? 'green' : z.strength === 'moderate' ? 'yellow' : 'slate'}
                  />
                </div>
                <p className="text-xs text-slate-400">{z.description}</p>
                {z.tested > 0 && (
                  <p className="text-xs text-slate-500 mt-1">Tested {z.tested}× — weakens with each touch</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Recommendation Card ──────────────────────────────────────────────────────

function RecommendationCard({ rec }: { rec: TradeRecommendation }) {
  const isBuy = rec.direction === 'buy';
  const borderColor = isBuy ? 'border-emerald-800/60' : 'border-red-800/60';
  const bgColor = isBuy ? 'bg-emerald-900/15' : 'bg-red-900/15';
  const labelColor = isBuy ? 'text-emerald-400' : 'text-red-400';
  const pf = (v: number) => `$${v.toFixed(v < 10 ? 4 : 2)}`;

  return (
    <div className={`border rounded-xl p-5 ${borderColor} ${bgColor}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {isBuy ? <TrendingUp className="text-emerald-400" size={18} /> : <TrendingDown className="text-red-400" size={18} />}
          <span className={`text-base font-bold uppercase ${labelColor}`}>{rec.direction}</span>
          <div className="flex items-center gap-1">
            {tradeStyleIcon(rec.style)}
            <Badge label={rec.style} variant={tradeStyleBadge(rec.style)} />
          </div>
        </div>
        <div className="text-right">
          <div className={`text-lg font-bold ${confidenceColor(rec.confidence)}`}>{rec.confidence}%</div>
          <div className="text-xs text-slate-500">confidence</div>
        </div>
      </div>

      <div className="h-1.5 bg-slate-700 rounded-full mb-4 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${rec.confidence >= 70 ? 'bg-emerald-500' : rec.confidence >= 45 ? 'bg-yellow-500' : 'bg-red-500'}`}
          style={{ width: `${rec.confidence}%` }}
        />
      </div>

      <p className="text-sm text-slate-300 mb-4">{rec.rationale}</p>

      <div className="bg-slate-700/40 rounded-lg px-3 py-2 mb-4 flex items-start gap-2">
        <AlertTriangle size={13} className="text-yellow-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-slate-400">{tradeStyleDesc(rec.style)}</p>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Bracket Order</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { label: 'Entry',    value: pf(rec.bracket.entry),    cls: 'bg-slate-700/60 text-white' },
            { label: 'Stop Loss',value: pf(rec.bracket.stopLoss), cls: 'bg-red-900/30 text-red-300' },
            { label: 'Target 1', value: pf(rec.bracket.target1),  cls: 'bg-emerald-900/30 text-emerald-300' },
            { label: 'Target 2', value: pf(rec.bracket.target2),  cls: 'bg-emerald-900/20 text-emerald-300' },
            { label: 'Target 3', value: pf(rec.bracket.target3),  cls: 'bg-emerald-900/10 text-emerald-300' },
            { label: 'R:R Ratio',value: `1:${rec.bracket.riskRewardRatio}`, cls: 'bg-indigo-900/30 text-indigo-300' },
          ].map((item) => (
            <div key={item.label} className={`rounded-lg p-2 text-center ${item.cls.split(' ')[0]}`}>
              <div className="text-xs text-slate-400 mb-0.5">{item.label}</div>
              <div className={`font-mono font-semibold text-sm ${item.cls.split(' ')[1]}`}>{item.value}</div>
            </div>
          ))}
        </div>
        {rec.zone && (
          <p className="text-xs text-slate-500 mt-2">
            Based on {rec.zone.type} zone ${rec.zone.priceLow.toFixed(4)}–${rec.zone.priceHigh.toFixed(4)}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ValuationPage() {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const decoded = decodeURIComponent(symbol ?? '').replace('--', '/');

  // Stabilise meta — useMemo so the object reference doesn't change every render
  const allSymbols = useMemo(() => getAllSymbols(), []);
  const meta = useMemo(() => allSymbols.find((s) => s.symbol === decoded) ?? null, [allSymbols, decoded]);

  // Pull primitives out so useCallback deps are stable strings, not the meta object
  const metaSymbol     = meta?.symbol ?? '';
  const metaName       = meta?.name ?? '';
  const metaAssetClass = meta?.assetClass;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [valuation, setValuation] = useState<Valuation | null>(null);
  const [candles, setCandles] = useState<OHLCV[]>([]);
  const [loading, setLoading] = useState(true);
  const [comingSoon, setComingSoon] = useState(false);
  const [refreshingVal, setRefreshingVal] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  // Track the open price separately so the WebSocket dep stays stable
  const openPriceRef = useRef<number>(0);
  const wsUnsub = useRef<(() => void) | null>(null);

  // Full load: quote + candles + valuation
  const loadAll = useCallback(async () => {
    if (!metaSymbol || !metaAssetClass) return;
    setLoading(true);
    setComingSoon(false);
    try {
      const [q, c] = await Promise.all([
        getLiveQuote(metaSymbol, metaName, metaAssetClass),
        getLiveCandles(metaSymbol, metaAssetClass, 90),
      ]);
      if (q === null) {
        setComingSoon(true);
        return;
      }
      openPriceRef.current = q.open;
      setQuote(q);
      setCandles(c);
      setValuation(computeValuation(metaSymbol, q.price));
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [metaSymbol, metaName, metaAssetClass]);

  // Refresh valuation analysis only (without reloading candles)
  const refreshValuation = useCallback(async () => {
    if (!metaSymbol || !metaAssetClass) return;
    setRefreshingVal(true);
    try {
      const q = await getLiveQuote(metaSymbol, metaName, metaAssetClass);
      if (q === null) return;
      // Preserve existing open so WS dep doesn't change
      setQuote((prev) => ({ ...q, open: prev?.open ?? q.open }));
      setValuation(computeValuation(metaSymbol, q.price));
      setLastUpdated(new Date());
    } finally {
      setRefreshingVal(false);
    }
  }, [metaSymbol, metaName, metaAssetClass]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // WebSocket subscription — deps are stable primitives, not quote object
  useEffect(() => {
    if (!metaSymbol || !metaAssetClass || !quote) return;
    wsUnsub.current?.();

    wsUnsub.current = subscribeToLivePrice(
      metaSymbol,
      metaAssetClass,
      openPriceRef.current,
      (price, change, changePercent) => {
        setQuote((prev) =>
          prev
            ? {
                ...prev,
                price,
                change: parseFloat(change.toFixed(price < 10 ? 5 : 2)),
                changePercent: parseFloat(changePercent.toFixed(2)),
                high: Math.max(prev.high, price),
                low: Math.min(prev.low, price),
                timestamp: Date.now(),
              }
            : prev
        );
        setLastUpdated(new Date());
      }
    );

    return () => {
      wsUnsub.current?.();
      wsUnsub.current = null;
    };
  // quote is only here to gate the effect until initial load completes;
  // we intentionally don't re-run on every quote update
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaSymbol, metaAssetClass, quote !== null]);

  // REST polling fallback every 15s — preserve open price to keep WS dep stable
  useEffect(() => {
    if (!metaSymbol || !metaAssetClass) return;
    const t = setInterval(async () => {
      if (comingSoon) return;
      try {
        const q = await getLiveQuote(metaSymbol, metaName, metaAssetClass);
        if (q === null) return;
        // Preserve the original open so WS subscription isn't recreated
        setQuote((prev) => prev ? { ...q, open: prev.open } : q);
        setLastUpdated(new Date());
      } catch {
        // silently ignore
      }
    }, 15_000);
    return () => clearInterval(t);
  }, [metaSymbol, metaName, metaAssetClass, comingSoon]);

  if (!meta) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p>Symbol "{decoded}" not found.</p>
        <button onClick={() => navigate('/markets')} className="mt-3 text-indigo-400 hover:underline text-sm">
          ← Back to Markets
        </button>
      </div>
    );
  }

  if (loading || (!comingSoon && (!quote || !valuation))) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="animate-spin text-indigo-400" size={28} />
      </div>
    );
  }

  // ── Coming Soon page for futures with no live data ──
  if (comingSoon) {
    return (
      <div className="space-y-6">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-white">{meta.symbol}</h1>
              <Badge label="futures" variant="indigo" />
            </div>
            <p className="text-slate-400 text-sm">{meta.name}</p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-indigo-900/40 border border-indigo-700/50 flex items-center justify-center mb-5">
            <Clock size={28} className="text-indigo-400" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Coming Soon</h2>
          <p className="text-slate-400 text-sm max-w-md mb-2">
            Live futures data for <span className="font-semibold text-indigo-300">{meta.symbol}</span> ({meta.name}) is not yet available.
          </p>
          <p className="text-slate-500 text-xs max-w-sm">
            CME futures require a licensed real-time data feed. Support for futures is in development.
          </p>
          <button
            onClick={() => navigate('/markets')}
            className="mt-6 flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-lg text-sm transition-colors"
          >
            <ArrowLeft size={14} /> Back to Markets
          </button>
        </div>
      </div>
    );
  }

  const isUp = quote!.change >= 0;
  const pf = (v: number) => v.toFixed(v < 10 ? 4 : 2);
  const assetBadgeColor = { stock: 'blue', etf: 'purple', crypto: 'yellow', futures: 'indigo', forex: 'green' }[meta.assetClass] as 'blue' | 'purple' | 'yellow' | 'indigo' | 'green';
  // Safe to assert non-null here — comingSoon guard and loading guard above cover null cases
  const q = quote!;
  const val = valuation!;

  return (
    <div className="space-y-6">
      {/* Back */}
      <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors">
        <ArrowLeft size={15} /> Back
      </button>

      <DataSourceBanner />

      {/* Hero header */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-3xl font-bold text-white">{meta.symbol}</h1>
              <Badge label={meta.assetClass} variant={assetBadgeColor} />
            </div>
            <p className="text-slate-400">{meta.name}</p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              {meta.assetClass === 'crypto' ? '⚡ Binance live' : 'Finnhub live'} · {lastUpdated.toLocaleTimeString()}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-white font-mono">${pf(q.price)}</div>
            <div className={`flex items-center justify-end gap-1 text-base font-semibold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {isUp ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              {isUp ? '+' : ''}{pf(q.change)} ({isUp ? '+' : ''}{q.changePercent.toFixed(2)}%)
            </div>
            <div className="flex gap-3 text-xs text-slate-500 justify-end mt-1">
              <span>Bid: ${pf(q.bid)}</span>
              <span>Ask: ${pf(q.ask)}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mt-4 pt-4 border-t border-slate-700">
          {[
            { label: 'Open', value: `$${pf(q.open)}`, color: '' },
            { label: 'High', value: `$${pf(q.high)}`, color: 'text-emerald-400' },
            { label: 'Low',  value: `$${pf(q.low)}`,  color: 'text-red-400' },
            { label: 'Volume', value: q.volume > 0 ? q.volume.toLocaleString() : '—', color: '' },
          ].map((item) => (
            <div key={item.label} className="text-center">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className={`text-sm font-mono font-semibold ${item.color || 'text-white'}`}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      <PriceChart candles={candles} supplyZones={val.supplyZones} demandZones={val.demandZones} />

      {/* Valuation & Technicals */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">Valuation & Technicals</h2>
          <button
            onClick={refreshValuation}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw size={12} className={refreshingVal ? 'animate-spin' : ''} />
            Refresh analysis
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {val.intrinsicValue !== null && (
            <StatCard
              label="Intrinsic Value"
              value={`$${val.intrinsicValue.toFixed(2)}`}
              sub={val.fairValueMethod}
            />
          )}
          <StatCard
            label="Value Gap"
            value={`${val.valueGapPercent >= 0 ? '+' : ''}${val.valueGapPercent}%`}
            sub={val.valueGapPercent >= 0 ? 'Undervalued' : 'Overvalued'}
            color={val.intrinsicValue !== null ? (val.valueGapPercent >= 5 ? 'green' : val.valueGapPercent <= -5 ? 'red' : 'default') : 'default'}
          />
          <StatCard
            label="RSI (14)"
            value={String(val.rsi)}
            sub={val.rsi > 70 ? 'Overbought' : val.rsi < 30 ? 'Oversold' : 'Neutral'}
            color={val.rsi > 70 ? 'red' : val.rsi < 30 ? 'green' : 'default'}
          />
          <StatCard
            label="MACD"
            value={String(val.macd.value)}
            sub={`Signal: ${val.macd.signal}`}
            color={val.macd.histogram > 0 ? 'green' : 'red'}
          />
          <StatCard label="ATR" value={String(val.atr)} sub="Avg True Range" />
          <StatCard
            label="Trend"
            value={val.trend.charAt(0).toUpperCase() + val.trend.slice(1)}
            color={val.trend === 'uptrend' ? 'green' : val.trend === 'downtrend' ? 'red' : 'yellow'}
          />
        </div>
      </div>

      {/* Supply & Demand Zones */}
      <div>
        <h2 className="text-base font-semibold text-white mb-2">Supply & Demand Zones</h2>
        <p className="text-xs text-slate-500 mb-3">
          Identified from swing highs/lows in the past 60 sessions using real price data.
          Strong zones (large-bodied candles) carry more weight. Each test weakens the zone.
        </p>
        <ZonePanel valuation={val} />
      </div>

      {/* Trade Recommendations */}
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Trade Recommendations</h2>
        <p className="text-xs text-slate-500 mb-3">
          Based on supply/demand zones, RSI, MACD, and trend from live market data.
          Includes a bracket order with stop-loss and 3 profit targets.
        </p>
        {val.recommendations.length === 0 ? (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 text-center text-slate-500">
            No trade setups detected at this time.
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {val.recommendations.map((rec, i) => (
              <RecommendationCard key={i} rec={rec} />
            ))}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="bg-yellow-900/20 border border-yellow-800/50 rounded-xl p-4 flex gap-3">
        <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-yellow-200/70">
          Trade recommendations are algorithmic suggestions based on technical analysis of live market data.
          This is not financial advice. Past performance does not guarantee future results.
          Always conduct your own research and manage your risk.
        </p>
      </div>
    </div>
  );
}

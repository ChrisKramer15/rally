import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Lightbulb, TrendingUp, TrendingDown, RefreshCw, X,
  Zap, Clock, Activity, Target, AlertTriangle, ChevronRight,
} from 'lucide-react';
import { getAllSymbols } from '../data/mockMarket';
import { getLiveQuote } from '../services/marketData';
import { computeValuation } from '../data/valuation';
import { usePortfolioStore } from '../store/portfolioStore';
import type { TradeRecommendation, AssetClass } from '../types';
import Badge from '../components/Badge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TradeIdea {
  id: string;           // unique per card so dismiss works cleanly
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  rec: TradeRecommendation;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BADGE_COLORS: Record<AssetClass, 'blue' | 'purple' | 'yellow' | 'indigo' | 'green'> = {
  stock: 'blue', etf: 'purple', crypto: 'yellow', futures: 'indigo', forex: 'green',
};

function confidenceColor(c: number) {
  if (c >= 70) return 'text-emerald-400';
  if (c >= 45) return 'text-yellow-400';
  return 'text-red-400';
}

function confidenceBg(c: number) {
  if (c >= 70) return 'bg-emerald-500';
  if (c >= 45) return 'bg-yellow-500';
  return 'bg-red-500';
}

function styleIcon(style: string) {
  switch (style) {
    case 'scalp':    return <Zap size={12} className="text-yellow-400" />;
    case 'day':      return <Clock size={12} className="text-blue-400" />;
    case 'swing':    return <Activity size={12} className="text-purple-400" />;
    case 'position': return <Target size={12} className="text-emerald-400" />;
    default:         return null;
  }
}

function styleVariant(style: string): 'yellow' | 'blue' | 'purple' | 'green' {
  switch (style) {
    case 'scalp':  return 'yellow';
    case 'day':    return 'blue';
    case 'swing':  return 'purple';
    default:       return 'green';
  }
}

const pf = (v: number) => v.toFixed(v < 10 ? 4 : 2);

// ─── Build a pool of ideas from all symbols ───────────────────────────────────

async function buildIdeaPool(): Promise<TradeIdea[]> {
  const allSymbols = getAllSymbols();
  const ideas: TradeIdea[] = [];

  // Fetch quotes concurrently in chunks of 6 to avoid hammering APIs
  const chunkSize = 6;
  for (let i = 0; i < allSymbols.length; i += chunkSize) {
    const chunk = allSymbols.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map((s) => getLiveQuote(s.symbol, s.name, s.assetClass))
    );
    results.forEach((r, idx) => {
      const s = chunk[idx];
      if (r.status !== 'fulfilled' || r.value === null) return;
      const q = r.value;
      try {
        const val = computeValuation(s.symbol, q.price);
        val.recommendations.forEach((rec, recIdx) => {
          ideas.push({
            id: `${s.symbol}-${recIdx}-${Date.now()}`,
            symbol: s.symbol,
            name: s.name,
            assetClass: s.assetClass,
            price: q.price,
            rec,
          });
        });
      } catch {
        // skip symbols that fail valuation
      }
    });
  }

  // Sort by confidence descending
  return ideas.sort((a, b) => b.rec.confidence - a.rec.confidence);
}

// ─── Idea Card ────────────────────────────────────────────────────────────────

function IdeaCard({
  idea,
  onDismiss,
}: {
  idea: TradeIdea;
  onDismiss: (id: string) => void;
}) {
  const navigate = useNavigate();
  const { portfolios, addInvestment } = usePortfolioStore();
  const [added, setAdded] = useState(false);
  const isBuy = idea.rec.direction === 'buy';
  const borderColor = isBuy ? 'border-emerald-800/50' : 'border-red-800/50';
  const bgColor = isBuy ? 'bg-emerald-900/10' : 'bg-red-900/10';
  const labelColor = isBuy ? 'text-emerald-400' : 'text-red-400';

  const handleAddToPortfolio = () => {
    if (added) return;
    const targetPortfolio = portfolios[0];
    if (!targetPortfolio) return;

    addInvestment(targetPortfolio.id, {
      symbol: idea.symbol,
      name: idea.name,
      assetClass: idea.assetClass,
      quantity: 1,
      avgCost: idea.rec.bracket.entry,
      bracketOrder: idea.rec.bracket,
    });
    setAdded(true);
  };

  return (
    <div className={`relative border rounded-xl p-4 flex flex-col gap-3 ${borderColor} ${bgColor} bg-slate-800`}>
      {/* Dismiss button */}
      <button
        onClick={() => onDismiss(idea.id)}
        className="absolute top-3 right-3 text-slate-600 hover:text-slate-300 transition-colors"
        aria-label="Dismiss idea"
      >
        <X size={14} />
      </button>

      {/* Header row */}
      <div className="flex items-start gap-3 pr-5">
        <div
          className="flex-1 cursor-pointer"
          onClick={() => navigate(`/valuation/${encodeURIComponent(idea.symbol).replace('%2F', '--')}`)}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-bold text-white text-base">{idea.symbol}</span>
            <Badge label={idea.assetClass} variant={BADGE_COLORS[idea.assetClass]} />
            <div className="flex items-center gap-1">
              {isBuy
                ? <TrendingUp size={13} className="text-emerald-400" />
                : <TrendingDown size={13} className="text-red-400" />}
              <span className={`text-xs font-bold uppercase ${labelColor}`}>{idea.rec.direction}</span>
            </div>
            <div className="flex items-center gap-1">
              {styleIcon(idea.rec.style)}
              <Badge label={idea.rec.style} variant={styleVariant(idea.rec.style)} />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{idea.name}</p>
        </div>

        {/* Confidence */}
        <div className="text-right flex-shrink-0">
          <div className={`text-xl font-bold ${confidenceColor(idea.rec.confidence)}`}>
            {idea.rec.confidence}%
          </div>
          <div className="text-xs text-slate-500">confidence</div>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${confidenceBg(idea.rec.confidence)}`}
          style={{ width: `${idea.rec.confidence}%` }}
        />
      </div>

      {/* Price + bracket summary */}
      <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
        <div className="bg-slate-700/50 rounded-lg p-1.5">
          <div className="text-slate-500 mb-0.5">Price</div>
          <div className="font-mono text-white font-semibold">${pf(idea.price)}</div>
        </div>
        <div className="bg-slate-700/50 rounded-lg p-1.5">
          <div className="text-slate-500 mb-0.5">Entry</div>
          <div className="font-mono text-white font-semibold">${pf(idea.rec.bracket.entry)}</div>
        </div>
        <div className="bg-red-900/30 rounded-lg p-1.5">
          <div className="text-slate-500 mb-0.5">Stop</div>
          <div className="font-mono text-red-300 font-semibold">${pf(idea.rec.bracket.stopLoss)}</div>
        </div>
        <div className="bg-emerald-900/30 rounded-lg p-1.5">
          <div className="text-slate-500 mb-0.5">T1</div>
          <div className="font-mono text-emerald-300 font-semibold">${pf(idea.rec.bracket.target1)}</div>
        </div>
      </div>

      {/* Rationale */}
      <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{idea.rec.rationale}</p>

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-700/50">
        <span className="text-xs text-slate-500">R:R 1:{idea.rec.bracket.riskRewardRatio}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleAddToPortfolio}
            disabled={added}
            className="rounded-lg border border-indigo-600/50 bg-indigo-600/15 px-2.5 py-1.5 text-[11px] font-medium text-indigo-300 transition-colors hover:bg-indigo-600/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {added ? 'Added' : 'Add to portfolio'}
          </button>
          <button
            onClick={() => navigate(`/valuation/${encodeURIComponent(idea.symbol).replace('%2F', '--')}`)}
            className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Full analysis <ChevronRight size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const VISIBLE_COUNT = 12; // cards shown at once

export default function TradeIdeasPage() {
  const [pool, setPool] = useState<TradeIdea[]>([]);
  const [visible, setVisible] = useState<TradeIdea[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const poolRef = useRef<TradeIdea[]>([]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const ideas = await buildIdeaPool();
      poolRef.current = ideas;
      setPool(ideas);
      setVisible(ideas.slice(0, VISIBLE_COUNT));
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Dismiss a card and replace it with the next unused idea from the pool
  const handleDismiss = useCallback((id: string) => {
    setVisible((prev) => {
      const dismissedIdx = prev.findIndex((c) => c.id === id);
      if (dismissedIdx === -1) return prev;

      // Find next idea from pool not currently visible
      const visibleIds = new Set(prev.map((c) => c.id));
      const next = poolRef.current.find((p) => !visibleIds.has(p.id));

      const updated = [...prev];
      if (next) {
        updated.splice(dismissedIdx, 1, next);
      } else {
        updated.splice(dismissedIdx, 1);
      }
      return updated;
    });
  }, []);

  // Filter controls
  const [dirFilter, setDirFilter] = useState<'all' | 'buy' | 'short'>('all');
  const [styleFilter, setStyleFilter] = useState<'all' | 'scalp' | 'day' | 'swing' | 'position'>('all');
  const [assetFilter, setAssetFilter] = useState<'all' | AssetClass>('all');

  const displayed = visible.filter((idea) => {
    if (dirFilter !== 'all' && idea.rec.direction !== dirFilter) return false;
    if (styleFilter !== 'all' && idea.rec.style !== styleFilter) return false;
    if (assetFilter !== 'all' && idea.assetClass !== assetFilter) return false;
    return true;
  });

  const FilterBtn = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
        active ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Lightbulb className="text-yellow-400" size={20} />
            <h1 className="text-2xl font-bold text-white">Trade Ideas</h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {loading ? 'Scanning all markets…' : `${pool.length} setups found across all assets · ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={loading || refreshing}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-40"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 bg-yellow-900/15 border border-yellow-800/40 rounded-xl px-4 py-2.5 mb-4">
        <AlertTriangle size={13} className="text-yellow-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-yellow-200/60">
          Algorithmic setups based on technical analysis. Not financial advice — always do your own research and manage risk.
        </p>
      </div>

      {/* Filters */}
      {!loading && (
        <div className="flex flex-wrap gap-2 mb-5">
          {/* Direction */}
          <div className="flex gap-1">
            {(['all', 'buy', 'short'] as const).map((d) => (
              <FilterBtn key={d} active={dirFilter === d} onClick={() => setDirFilter(d)}>
                {d === 'all' ? 'All directions' : d === 'buy' ? '↑ Long' : '↓ Short'}
              </FilterBtn>
            ))}
          </div>
          <div className="w-px bg-slate-700" />
          {/* Style */}
          <div className="flex gap-1">
            {(['all', 'scalp', 'day', 'swing', 'position'] as const).map((s) => (
              <FilterBtn key={s} active={styleFilter === s} onClick={() => setStyleFilter(s)}>
                {s === 'all' ? 'All styles' : s}
              </FilterBtn>
            ))}
          </div>
          <div className="w-px bg-slate-700" />
          {/* Asset class */}
          <div className="flex gap-1 flex-wrap">
            {(['all', 'stock', 'etf', 'crypto', 'forex'] as const).map((a) => (
              <FilterBtn key={a} active={assetFilter === a} onClick={() => setAssetFilter(a as typeof assetFilter)}>
                {a === 'all' ? 'All assets' : a}
              </FilterBtn>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <RefreshCw className="animate-spin text-indigo-400" size={28} />
          <p className="text-sm text-slate-500">Scanning all symbols and computing valuations…</p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-20 text-slate-500">
          <Lightbulb size={36} className="mx-auto mb-3 opacity-30" />
          <p>No matching setups. Try adjusting the filters.</p>
        </div>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {displayed.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} onDismiss={handleDismiss} />
            ))}
          </div>
          <p className="text-center text-xs text-slate-600 mt-6">
            Showing {displayed.length} of {pool.length} setups — dismiss any card to surface the next one
          </p>
        </>
      )}
    </div>
  );
}

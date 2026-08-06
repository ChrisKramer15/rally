import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  PlusCircle,
  Trash2,
  TrendingUp,
  TrendingDown,
  Search,
} from "lucide-react";
import { usePortfolioStore } from "../store/portfolioStore";
import { getLiveQuote } from "../services/marketData";
import { getAllSymbols } from "../data/mockMarket";
import type { Quote, AssetClass } from "../types";
import Badge from "../components/Badge";

const ASSET_CLASS_COLORS: Record<
  AssetClass,
  "blue" | "purple" | "yellow" | "green" | "indigo"
> = {
  stock: "blue",
  etf: "purple",
  crypto: "yellow",
  futures: "indigo",
  forex: "green",
};

export default function PortfolioPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { portfolios, addInvestment, removeInvestment } = usePortfolioStore();
  const portfolio = portfolios.find((p) => p.id === id);

  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [toRemove, setToRemove] = useState<string | null>(null);

  // Live price fetching
  useEffect(() => {
    if (!portfolio) return;
    let cancelled = false;

    const refresh = async () => {
      const updated: Record<string, Quote> = {};
      // Fetch all investments concurrently
      await Promise.all(
        portfolio.investments.map(async (inv) => {
          try {
            const q = await getLiveQuote(inv.symbol, inv.name, inv.assetClass);
            if (!cancelled && q !== null) updated[inv.symbol] = q;
          } catch {
            // keep previous quote if fetch fails
          }
        }),
      );
      if (!cancelled) setQuotes((prev) => ({ ...prev, ...updated }));
    };

    refresh();
    const t = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [portfolio]);

  if (!portfolio) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p className="text-lg">Portfolio not found.</p>
        <button
          onClick={() => navigate("/")}
          className="mt-3 text-indigo-400 hover:underline text-sm"
        >
          ← Back to portfolios
        </button>
      </div>
    );
  }

  // Summary calculations
  const totalCost = portfolio.investments.reduce(
    (sum, inv) => sum + inv.avgCost * inv.quantity,
    0,
  );
  const liveValueEntries = portfolio.investments.filter((inv) =>
    Boolean(quotes[inv.symbol]),
  );
  const totalValue = liveValueEntries.reduce((sum, inv) => {
    const q = quotes[inv.symbol];
    return sum + (q ? q.price * inv.quantity : 0);
  }, 0);
  const hasLivePrices = liveValueEntries.length > 0;
  const totalPnL = hasLivePrices ? totalValue - totalCost : 0;
  const totalPnLPct =
    hasLivePrices && totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  // Symbol search for add form
  const allSymbols = getAllSymbols();
  const filtered =
    searchQuery.length > 0
      ? allSymbols
          .filter(
            (s) =>
              s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
              s.name.toLowerCase().includes(searchQuery.toLowerCase()),
          )
          .slice(0, 8)
      : [];

  const handleSelectSymbol = (s: (typeof allSymbols)[0]) => {
    setSelectedSymbol(s.symbol);
    setSearchQuery(s.symbol);
  };

  const handleAdd = () => {
    const sym = allSymbols.find((s) => s.symbol === selectedSymbol);
    if (!sym || !quantity || !avgCost) return;
    addInvestment(portfolio.id, {
      symbol: sym.symbol,
      name: sym.name,
      assetClass: sym.assetClass,
      quantity: parseFloat(quantity),
      avgCost: parseFloat(avgCost),
    });
    setShowAddForm(false);
    setSearchQuery("");
    setSelectedSymbol("");
    setQuantity("");
    setAvgCost("");
  };

  return (
    <div>
      {/* Back */}
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1 text-sm text-slate-400 hover:text-white mb-5 transition-colors"
      >
        <ArrowLeft size={15} /> Portfolios
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{portfolio.name}</h1>
          {portfolio.description && (
            <p className="text-sm text-slate-400 mt-0.5">
              {portfolio.description}
            </p>
          )}
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <PlusCircle size={15} /> Add Investment
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          {
            label: "Total Cost Basis",
            value: `$${totalCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
          },
          {
            label: "Market Value",
            value: hasLivePrices
              ? `$${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : "Live data pending",
          },
          {
            label: "Total P&L",
            value: hasLivePrices
              ? `${totalPnL >= 0 ? "+" : ""}$${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
              : "—",
            color:
              hasLivePrices && totalPnL >= 0
                ? "text-emerald-400"
                : hasLivePrices
                  ? "text-red-400"
                  : "text-slate-400",
          },
          {
            label: "Return",
            value: hasLivePrices
              ? `${totalPnLPct >= 0 ? "+" : ""}${totalPnLPct.toFixed(2)}%`
              : "—",
            color:
              hasLivePrices && totalPnLPct >= 0
                ? "text-emerald-400"
                : hasLivePrices
                  ? "text-red-400"
                  : "text-slate-400",
          },
        ].map((card) => (
          <div
            key={card.label}
            className="bg-slate-800 border border-slate-700 rounded-xl p-4"
          >
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              {card.label}
            </p>
            <p
              className={`text-lg font-bold ${(card as { color?: string }).color ?? "text-white"}`}
            >
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* Add investment form */}
      {showAddForm && (
        <div className="bg-slate-800 border border-slate-600 rounded-xl p-5 mb-6">
          <h2 className="text-base font-semibold text-white mb-4">
            Add Investment
          </h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="relative">
              <label className="block text-xs text-slate-400 mb-1">
                Symbol *
              </label>
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                />
                <input
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedSymbol("");
                  }}
                  placeholder="Search symbol or name"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {filtered.length > 0 && !selectedSymbol && (
                <div className="absolute z-10 top-full mt-1 w-full bg-slate-700 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
                  {filtered.map((s) => (
                    <button
                      key={s.symbol}
                      onClick={() => handleSelectSymbol(s)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-slate-600 text-white"
                    >
                      <span className="font-medium">{s.symbol}</span>
                      <span className="text-slate-400 text-xs truncate ml-2">
                        {s.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Quantity *
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="e.g. 10"
                min="0"
                step="any"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Avg Cost *
              </label>
              <input
                type="number"
                value={avgCost}
                onChange={(e) => setAvgCost(e.target.value)}
                placeholder="e.g. 150.00"
                min="0"
                step="any"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAdd}
              disabled={!selectedSymbol || !quantity || !avgCost}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setSearchQuery("");
                setSelectedSymbol("");
              }}
              className="bg-slate-700 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 mb-4">
        Entry price is what you paid; current price is the latest market quote.
        When a live quote is unavailable, the table shows it as pending instead
        of using your entry cost.
      </p>

      {/* Investments table */}
      {portfolio.investments.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <TrendingUp size={40} className="mx-auto mb-3 opacity-30" />
          <p>No investments yet. Add one above.</p>
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Symbol</th>
                  <th className="text-right px-4 py-3">Current Price</th>
                  <th className="text-right px-4 py-3">Change</th>
                  <th className="text-right px-4 py-3">Qty</th>
                  <th className="text-right px-4 py-3">Entry</th>
                  <th className="text-right px-4 py-3">Market Value</th>
                  <th className="text-right px-4 py-3">P&L</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {portfolio.investments.map((inv) => {
                  const q = quotes[inv.symbol];
                  const price = q?.price ?? null;
                  const marketValue =
                    price !== null ? price * inv.quantity : null;
                  const costBasis = inv.avgCost * inv.quantity;
                  const pnl =
                    marketValue !== null ? marketValue - costBasis : null;
                  const pnlPct =
                    pnl !== null && costBasis > 0
                      ? (pnl / costBasis) * 100
                      : null;
                  const isUp = pnl !== null ? pnl >= 0 : null;

                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to={`/valuation/${encodeURIComponent(inv.symbol).replace("%2F", "--")}`}
                          className="hover:text-indigo-300 transition-colors"
                        >
                          <span className="font-semibold text-white">
                            {inv.symbol}
                          </span>
                        </Link>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Badge
                            label={inv.assetClass}
                            variant={ASSET_CLASS_COLORS[inv.assetClass]}
                          />
                          <span className="text-slate-500 text-xs">
                            {inv.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">
                        {price !== null ? (
                          <div className="flex flex-col items-end">
                            <span>${price.toFixed(price < 10 ? 4 : 2)}</span>
                            <span
                              className={`text-[11px] ${q?.source === "mock" ? "text-amber-400" : "text-slate-500"}`}
                            >
                              {q?.source === "mock"
                                ? "Estimated"
                                : q
                                  ? "Live"
                                  : "Pending"}
                            </span>
                          </div>
                        ) : (
                          <div className="flex flex-col items-end text-slate-500">
                            <span>—</span>
                            <span className="text-[11px]">Pending</span>
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${isUp === null ? "text-slate-400" : isUp ? "text-emerald-400" : "text-red-400"}`}
                      >
                        <div className="flex items-center justify-end gap-0.5">
                          {isUp === null ? null : isUp ? (
                            <TrendingUp size={12} />
                          ) : (
                            <TrendingDown size={12} />
                          )}
                          {q
                            ? `${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}%`
                            : "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300 font-mono">
                        {inv.quantity}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-400 font-mono">
                        ${inv.avgCost.toFixed(inv.avgCost < 10 ? 4 : 2)}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">
                        {marketValue !== null
                          ? `$${marketValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                          : "—"}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-mono ${isUp === null ? "text-slate-400" : isUp ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {pnl !== null && pnlPct !== null ? (
                          <>
                            <div>
                              {isUp ? "+" : ""}
                              {pnl.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                                minimumFractionDigits: 2,
                              })}
                            </div>
                            <div className="text-xs opacity-75">
                              {isUp ? "+" : ""}
                              {pnlPct.toFixed(2)}%
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setToRemove(inv.id)}
                          className="text-slate-600 hover:text-red-400 transition-colors p-1"
                          aria-label={`Remove ${inv.symbol}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Remove confirm modal */}
      {toRemove && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-600 rounded-xl p-6 max-w-sm w-full">
            <h3 className="text-base font-semibold text-white mb-2">
              Remove Investment?
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              This will remove the investment from your portfolio.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  removeInvestment(portfolio.id, toRemove);
                  setToRemove(null);
                }}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg text-sm font-medium transition-colors"
              >
                Remove
              </button>
              <button
                onClick={() => setToRemove(null)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 rounded-lg text-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

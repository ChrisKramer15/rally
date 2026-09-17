import { useMemo, useState, type ReactNode } from 'react'
import { changePct, formatCurrency, type Stock } from '../data/stocks'
import { Sparkline } from './Sparkline'

/** Minimal shape of a named list the filter dropdown needs. */
export interface WatchlistFilterOption {
  id: string
  name: string
  symbols: string[]
}

interface WatchlistProps {
  stocks: Stock[]
  flash: Record<string, 'up' | 'down'>
  /** Optional action rendered in the panel header, e.g. the paste-tickers button. */
  action?: ReactNode
  /** Called when the user clicks a ticker row to open the detail modal. */
  onSelectSymbol?: (symbol: string) => void
  /** Named lists to offer in the filter (in addition to "All"). */
  lists?: WatchlistFilterOption[]
}

const PAGE_SIZE = 10

type SortKey = 'change' | 'price' | 'alpha'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'change', label: '% Change' },
  { key: 'price', label: 'Price' },
  { key: 'alpha', label: 'A–Z' },
]

export function Watchlist({ stocks, flash, action, onSelectSymbol, lists = [] }: WatchlistProps) {
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('change')
  // Which list to show: 'all' (the full union) or a specific list id.
  const [listFilter, setListFilter] = useState<string>('all')

  // If the selected list disappears (deleted/renamed away), fall back to "All".
  const activeFilterId =
    listFilter === 'all' || lists.some((l) => l.id === listFilter) ? listFilter : 'all'

  // Restrict the visible stocks to the chosen list's symbols (or all of them).
  const filtered = useMemo(() => {
    if (activeFilterId === 'all') return stocks
    const list = lists.find((l) => l.id === activeFilterId)
    if (!list) return stocks
    const inList = new Set(list.symbols)
    return stocks.filter((s) => inList.has(s.symbol))
  }, [stocks, lists, activeFilterId])

  // Sort by the selected key. Change/price are high-to-low; alpha is A→Z.
  const sorted = useMemo(() => {
    const copy = [...filtered]
    switch (sortKey) {
      case 'alpha':
        return copy.sort((a, b) => a.symbol.localeCompare(b.symbol))
      case 'price':
        return copy.sort((a, b) => b.price - a.price)
      case 'change':
      default:
        return copy.sort(
          (a, b) => changePct(b.price, b.prevClose) - changePct(a.price, a.prevClose),
        )
    }
  }, [filtered, sortKey])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))

  // Clamp during render instead of syncing via an effect: if the list shrinks
  // below the current page, fall back to the last valid page without an extra
  // render pass. `page` state stays as-is and self-corrects on the next change.
  const safePage = Math.min(page, pageCount - 1)

  const start = safePage * PAGE_SIZE
  const visible = sorted.slice(start, start + PAGE_SIZE)
  const rangeEnd = Math.min(start + PAGE_SIZE, sorted.length)

  return (
    <div className="panel watchlist">
      <div className="panel-head">
        <h2>Watchlist</h2>
        <div className="panel-head-actions">
          {lists.length > 0 && (
            <label className="watch-filter">
              <span className="visually-hidden">Filter by list</span>
              <select
                value={activeFilterId}
                onChange={(e) => {
                  setListFilter(e.target.value)
                  setPage(0)
                }}
                aria-label="Filter watchlist by list"
              >
                <option value="all">All lists</option>
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span className="panel-sub">{sorted.length} symbols</span>
          <div className="watch-sort" role="group" aria-label="Sort watchlist">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                className={`sort-btn ${sortKey === opt.key ? 'active' : ''}`}
                onClick={() => {
                  setSortKey(opt.key)
                  setPage(0)
                }}
                aria-pressed={sortKey === opt.key}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {action}
        </div>
      </div>
      <p className="watch-daily-note">
        Prices are prior-session daily closes (not real-time).
      </p>
      <div className="watch-row watch-head">
        <span>Symbol</span>
        <span className="col-chart">Trend</span>
        <span className="watch-quote-head">
          <span className="col-num">Price</span>
          <span className="col-num">Change</span>
        </span>
      </div>
      {sorted.length === 0 && (
        <div className="watch-empty">
          No symbols yet. Use “Paste tickers” to add your scanner results.
        </div>
      )}
      <ul className="watch-list">
        {visible.map((s) => {
          const pct = changePct(s.price, s.prevClose)
          const positive = pct >= 0
          return (
            <li
              key={s.symbol}
              className={`watch-row watch-row-clickable ${flash[s.symbol] ? `flash-${flash[s.symbol]}` : ''}`}
              onClick={() => onSelectSymbol?.(s.symbol)}
              role={onSelectSymbol ? 'button' : undefined}
              tabIndex={onSelectSymbol ? 0 : undefined}
              onKeyDown={onSelectSymbol ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectSymbol(s.symbol) } } : undefined}
              aria-label={onSelectSymbol ? `View details for ${s.symbol}` : undefined}
            >
              <span className="watch-sym">
                <span className="sym">{s.symbol}</span>
                {s.name && s.name !== s.symbol && (
                  <span className="name">{s.name}</span>
                )}
              </span>
              <span className="col-chart">
                <Sparkline data={s.history} positive={positive} width={110} height={32} />
              </span>
              <span className="watch-quote">
                <span className="col-num price">${formatCurrency(s.price)}</span>
                <span className={`col-num change ${positive ? 'up' : 'down'}`}>
                  {positive ? '+' : ''}
                  {pct.toFixed(2)}%
                </span>
              </span>
            </li>
          )
        })}
      </ul>
      {sorted.length > PAGE_SIZE && (
        <div className="watch-pager">
          <button
            className="wl-btn ghost"
            onClick={() => setPage(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
          >
            Prev
          </button>
          <span className="watch-pager-info">
            {start + 1}–{rangeEnd} of {sorted.length}
          </span>
          <button
            className="wl-btn ghost"
            onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

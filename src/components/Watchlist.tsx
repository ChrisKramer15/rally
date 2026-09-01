import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { changePct, formatCurrency, type Stock } from '../data/stocks'
import { Sparkline } from './Sparkline'

interface WatchlistProps {
  stocks: Stock[]
  flash: Record<string, 'up' | 'down'>
  /** Optional action rendered in the panel header, e.g. the paste-tickers button. */
  action?: ReactNode
  /** Called when the user clicks a ticker row to open the detail modal. */
  onSelectSymbol?: (symbol: string) => void
}

const PAGE_SIZE = 10

type SortKey = 'change' | 'price' | 'alpha'

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'change', label: '% Change' },
  { key: 'price', label: 'Price' },
  { key: 'alpha', label: 'A–Z' },
]

export function Watchlist({ stocks, flash, action, onSelectSymbol }: WatchlistProps) {
  const [page, setPage] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('change')

  // Sort by the selected key. Change/price are high-to-low; alpha is A→Z.
  const sorted = useMemo(() => {
    const copy = [...stocks]
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
  }, [stocks, sortKey])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))

  // Keep the current page in range if the list shrinks.
  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1)
  }, [page, pageCount])

  const start = page * PAGE_SIZE
  const visible = sorted.slice(start, start + PAGE_SIZE)
  const rangeEnd = Math.min(start + PAGE_SIZE, sorted.length)

  return (
    <div className="panel watchlist">
      <div className="panel-head">
        <h2>Watchlist</h2>
        <div className="panel-head-actions">
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
      <div className="watch-row watch-head">
        <span>Symbol</span>
        <span className="col-chart">Trend</span>
        <span className="col-num">Price</span>
        <span className="col-num">Change</span>
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
                <span className="name">{s.name}</span>
              </span>
              <span className="col-chart">
                <Sparkline data={s.history} positive={positive} width={110} height={32} />
              </span>
              <span className="col-num price">${formatCurrency(s.price)}</span>
              <span className={`col-num change ${positive ? 'up' : 'down'}`}>
                {positive ? '+' : ''}
                {pct.toFixed(2)}%
              </span>
            </li>
          )
        })}
      </ul>
      {sorted.length > PAGE_SIZE && (
        <div className="watch-pager">
          <button
            className="wl-btn ghost"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Prev
          </button>
          <span className="watch-pager-info">
            {start + 1}–{rangeEnd} of {sorted.length}
          </span>
          <button
            className="wl-btn ghost"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={page >= pageCount - 1}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}

import type { ReactNode } from 'react'
import { changePct, formatCurrency, type Stock } from '../data/stocks'
import { Sparkline } from './Sparkline'

interface WatchlistProps {
  stocks: Stock[]
  flash: Record<string, 'up' | 'down'>
  /** Optional action rendered in the panel header, e.g. the paste-tickers button. */
  action?: ReactNode
}

export function Watchlist({ stocks, flash, action }: WatchlistProps) {
  return (
    <div className="panel watchlist">
      <div className="panel-head">
        <h2>Watchlist</h2>
        <div className="panel-head-actions">
          <span className="panel-sub">{stocks.length} symbols</span>
          {action}
        </div>
      </div>
      <div className="watch-row watch-head">
        <span>Symbol</span>
        <span className="col-chart">Trend</span>
        <span className="col-num">Price</span>
        <span className="col-num">Change</span>
      </div>
      {stocks.length === 0 && (
        <div className="watch-empty">
          No symbols yet. Use “Paste tickers” to add your scanner results.
        </div>
      )}
      <ul className="watch-list">
        {stocks.map((s) => {
          const pct = changePct(s.price, s.prevClose)
          const positive = pct >= 0
          return (
            <li key={s.symbol} className={`watch-row ${flash[s.symbol] ? `flash-${flash[s.symbol]}` : ''}`}>
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
    </div>
  )
}

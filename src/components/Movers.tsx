import { changePct, formatCurrency, type Stock } from '../data/stocks'

interface MoversProps {
  stocks: Stock[]
}

export function Movers({ stocks }: MoversProps) {
  const ranked = [...stocks].sort(
    (a, b) => changePct(b.price, b.prevClose) - changePct(a.price, a.prevClose),
  )
  const gainers = ranked.slice(0, 3)
  const losers = ranked.slice(-3).reverse()

  const renderList = (items: Stock[]) => (
    <ul className="mover-list">
      {items.map((s) => {
        const pct = changePct(s.price, s.prevClose)
        const positive = pct >= 0
        return (
          <li key={s.symbol}>
            <span className="mover-sym">{s.symbol}</span>
            <span className="mover-price">${formatCurrency(s.price)}</span>
            <span className={`mover-pct ${positive ? 'up' : 'down'}`}>
              {positive ? '+' : ''}
              {pct.toFixed(2)}%
            </span>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="panel movers">
      <div className="panel-head">
        <h2>Top Movers</h2>
      </div>
      <div className="mover-group">
        <h3 className="up">Gainers</h3>
        {renderList(gainers)}
      </div>
      <div className="mover-group">
        <h3 className="down">Losers</h3>
        {renderList(losers)}
      </div>
    </div>
  )
}

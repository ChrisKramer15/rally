import { changePct, formatCurrency, type IndexQuote } from '../data/stocks'
import { Sparkline } from './Sparkline'

interface IndexCardProps {
  quote: IndexQuote
}

export function IndexCard({ quote }: IndexCardProps) {
  const pct = changePct(quote.value, quote.prevClose)
  const positive = pct >= 0

  return (
    <article className={`index-card ${positive ? 'is-up' : 'is-down'}`}>
      <header>
        <span className="index-symbol">{quote.symbol}</span>
        <span className="index-name">{quote.name}</span>
      </header>
      <div className="index-value">{formatCurrency(quote.value)}</div>
      <div className={`index-change ${positive ? 'up' : 'down'}`}>
        <span className="arrow">{positive ? '▲' : '▼'}</span>
        {positive ? '+' : ''}
        {pct.toFixed(2)}%
      </div>
      <Sparkline data={quote.history} positive={positive} width={220} height={44} />
    </article>
  )
}

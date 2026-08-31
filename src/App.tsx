import { changePct } from './data/stocks'
import { useLiveMarket } from './hooks/useLiveMarket'
import { useWatchlist } from './hooks/useWatchlist'
import { useWatchlistMarket } from './hooks/useWatchlistMarket'
import { IndexCard } from './components/IndexCard'
import { Watchlist } from './components/Watchlist'
import { WatchlistEditor } from './components/WatchlistEditor'
import { Movers } from './components/Movers'
import './App.css'

function App() {
  // Indices keep the existing simulated feed for now.
  const { indices } = useLiveMarket(60000)

  // Watchlist symbols are user-defined (pasted from a scanner) and persisted.
  const { symbols, setSymbols } = useWatchlist()

  // Live watchlist data from Finnhub (60s cadence), simulated when no key is set.
  const { stocks, flash, lastUpdated, status, error } = useWatchlistMarket(symbols, 60000)

  const updatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour12: false })
    : '—'

  return (
    <div className="dashboard">
      {/* Ticker tape */}
      <div className="ticker-tape">
        <div className="ticker-track">
          {[...stocks, ...stocks].map((s, i) => {
            const pct = changePct(s.price, s.prevClose)
            const positive = pct >= 0
            return (
              <span className="ticker-item" key={`${s.symbol}-${i}`}>
                <span className="t-sym">{s.symbol}</span>
                <span className="t-price">${s.price.toFixed(2)}</span>
                <span className={positive ? 'up' : 'down'}>
                  {positive ? '+' : ''}
                  {pct.toFixed(2)}%
                </span>
              </span>
            )
          })}
        </div>
      </div>

      <header className="app-header">
        <div className="brand">
          <span className="logo-dot" />
          <h1>
            Rally<span className="accent">.</span>
          </h1>
          <span className="tag">Market Dashboard</span>
        </div>
        <div className="status">
          <span className="live-dot" />
          <span>{status === 'simulated' ? 'DEMO' : 'LIVE'}</span>
          {status === 'simulated' && <span className="feed-status simulated">simulated</span>}
          {status === 'error' && <span className="feed-status error">feed error</span>}
          <span className="sep">·</span>
          <span className="muted">Updated {updatedLabel}</span>
        </div>
      </header>

      {error && <div className="feed-error-banner">{error}</div>}

      <section className="index-grid">
        {indices.map((q) => (
          <IndexCard key={q.symbol} quote={q} />
        ))}
      </section>

      <section className="main-grid">
        <Watchlist
          stocks={stocks}
          flash={flash}
          action={<WatchlistEditor symbols={symbols} onSave={setSymbols} />}
        />
        <Movers stocks={stocks} />
      </section>

      <footer className="app-footer">
        <span>
          Watchlist quotes via Finnhub. Curate symbols from your scanner. Not financial advice.
        </span>
      </footer>
    </div>
  )
}

export default App

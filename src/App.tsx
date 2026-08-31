import { changePct } from './data/stocks'
import { useLiveMarket } from './hooks/useLiveMarket'
import { IndexCard } from './components/IndexCard'
import { Watchlist } from './components/Watchlist'
import { Movers } from './components/Movers'
import './App.css'

function App() {
  const { stocks, indices, flash, lastUpdated } = useLiveMarket(60000)

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
          <span>LIVE</span>
          <span className="sep">·</span>
          <span className="muted">
            Updated {lastUpdated.toLocaleTimeString('en-US', { hour12: false })}
          </span>
        </div>
      </header>

      <section className="index-grid">
        {indices.map((q) => (
          <IndexCard key={q.symbol} quote={q} />
        ))}
      </section>

      <section className="main-grid">
        <Watchlist stocks={stocks} flash={flash} />
        <Movers stocks={stocks} />
      </section>

      <footer className="app-footer">
        <span>Simulated market data for demonstration. Not financial advice.</span>
      </footer>
    </div>
  )
}

export default App

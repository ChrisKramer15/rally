import { useState } from 'react'
import { changePct } from './data/stocks'
import { useIndexMarket } from './hooks/useIndexMarket'
import { useWatchlist } from './hooks/useWatchlist'
import { useWatchlistMarket } from './hooks/useWatchlistMarket'
import { IndexCard } from './components/IndexCard'
import { Watchlist } from './components/Watchlist'
import { WatchlistEditor } from './components/WatchlistEditor'
import { TickerDetailModal } from './components/TickerDetailModal'
import { Movers } from './components/Movers'
import { DataPipeline } from './components/DataPipeline'
import { ExplosiveMoves } from './components/ExplosiveMoves'
import './App.css'

type View = 'dashboard' | 'signals' | 'pipeline'

function App() {
  const [view, setView] = useState<View>('dashboard')

  // Index cards: real daily data via ETF proxies (SPY/QQQ/DIA) from Supabase.
  const { indices } = useIndexMarket()

  // Watchlist symbols are user-defined (pasted from a scanner) and persisted.
  const { symbols, setSymbols } = useWatchlist()

  // Daily watchlist data from Tiingo, cached per trading day; simulated when no key is set.
  const { stocks, flash, lastUpdated, status, error, usage } = useWatchlistMarket(symbols)

  // Ticker detail modal — null means closed.
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const selectedStock = selectedSymbol ? stocks.find((s) => s.symbol === selectedSymbol) ?? null : null

  // Ticker tape is always sorted alphabetically, regardless of the watchlist's
  // own sort control.
  const tickerStocks = [...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol))

  const updatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour12: false })
    : '—'

  return (
    <div className="dashboard">
      {/* Ticker tape — always alphabetized, independent of watchlist sort. */}
      <div className="ticker-tape">
        <div className="ticker-track">
          {[...tickerStocks, ...tickerStocks].map((s, i) => {
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
        <nav className="app-nav">
          <button
            type="button"
            className={`nav-tab ${view === 'dashboard' ? 'active' : ''}`}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={`nav-tab ${view === 'signals' ? 'active' : ''}`}
            onClick={() => setView('signals')}
          >
            Signals
          </button>
          <button
            type="button"
            className={`nav-tab ${view === 'pipeline' ? 'active' : ''}`}
            onClick={() => setView('pipeline')}
          >
            Data Pipeline
          </button>
        </nav>
        <div className="status">
          <span className="live-dot" />
          <span>{status === 'simulated' ? 'DEMO' : 'LIVE'}</span>
          {status === 'simulated' && <span className="feed-status simulated">simulated</span>}
          {status === 'error' && <span className="feed-status error">feed error</span>}
          <span className="sep">·</span>
          <span className="muted">Updated {updatedLabel}</span>
          <span className="sep">·</span>
          <span className="muted" title="Distinct symbols this app has cached this month (informational)">
            {usage.uniqueSymbolCount} symbols cached
          </span>
        </div>
      </header>

      {view === 'dashboard' && error && <div className="feed-error-banner">{error}</div>}

      {view === 'dashboard' ? (
        <>
          <section className="index-grid">
            {indices.map((q) => (
              <IndexCard key={q.symbol} quote={q} />
            ))}
          </section>

          <section className="main-grid">
            <Watchlist
              stocks={stocks}
              flash={flash}
              onSelectSymbol={setSelectedSymbol}
              action={<WatchlistEditor symbols={symbols} onSave={setSymbols} />}
            />
            <Movers stocks={stocks} />
          </section>
        </>
      ) : view === 'signals' ? (
        <ExplosiveMoves stocks={stocks} status={status} />
      ) : (
        <DataPipeline />
      )}

      <footer className="app-footer">
        <span>
          Daily bars via Supabase (collected from Tiingo; US stocks &amp; ETFs). Curate symbols from your scanner. Not financial advice.
        </span>
      </footer>

      {selectedStock && (
        <TickerDetailModal
          stock={selectedStock}
          onClose={() => setSelectedSymbol(null)}
        />
      )}
    </div>
  )
}

export default App

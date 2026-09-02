import { useEffect, useMemo, useState } from 'react'
import { changePct } from './data/stocks'
import { loadCached } from './data/dailyCache'
import { detectBasesForBars } from './hooks/useBasingZones'
import { useIndexMarket } from './hooks/useIndexMarket'
import { useWatchlist } from './hooks/useWatchlist'
import { useWatchlistMarket } from './hooks/useWatchlistMarket'
import { IndexCard } from './components/IndexCard'
import { Watchlist } from './components/Watchlist'
import { WatchlistEditor } from './components/WatchlistEditor'
import { TickerDetailModal } from './components/TickerDetailModal'
import { TradeTicketModal, type TradeTicket } from './components/TradeTicketModal'
import { Movers } from './components/Movers'
import { DataPipeline } from './components/DataPipeline'
import { ExplosiveMoves } from './components/ExplosiveMoves'
import { Backtest } from './components/Backtest'
import { useBacktestPortfolio, type ZoneKind } from './hooks/useBacktestPortfolio'
import './App.css'

type View = 'dashboard' | 'signals' | 'backtest' | 'pipeline'

function App() {
  const [view, setView] = useState<View>('dashboard')

  // Index cards: real daily data via ETF proxies (SPY/QQQ/DIA) from Supabase.
  const { indices } = useIndexMarket()

  // Watchlist symbols are user-defined (pasted from a scanner) and persisted.
  const { symbols, setSymbols } = useWatchlist()

  // Daily watchlist data from Tiingo, cached per trading day; simulated when no key is set.
  const { stocks, flash, lastUpdated, status, error, usage } = useWatchlistMarket(symbols)

  // Paper-trading portfolio for the Backtest page (persisted to localStorage).
  const portfolio = useBacktestPortfolio()

  // Ticker detail modal — null means closed.
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const selectedStock = selectedSymbol ? stocks.find((s) => s.symbol === selectedSymbol) ?? null : null

  // Trade ticket — the symbol the user is placing an order for (null = closed).
  const [tradeSymbol, setTradeSymbol] = useState<string | null>(null)
  const tradeStock = tradeSymbol ? stocks.find((s) => s.symbol === tradeSymbol) ?? null : null

  // Trade action: open the order ticket. Closes any detail modal first.
  const handleTrade = (symbol: string) => {
    setSelectedSymbol(null)
    setTradeSymbol(symbol)
  }

  // The proximal line + zone side for the symbol being traded, from its most
  // recent basing zone. Used to seed the limit-order price. Computed from the
  // local daily-bar cache (same source the zones hook uses).
  const tradeZone = useMemo<{ proximal: number; kind: ZoneKind } | null>(() => {
    if (!tradeSymbol) return null
    const cached = loadCached([tradeSymbol])[tradeSymbol]
    if (!cached || cached.bars.length === 0) return null
    const zones = detectBasesForBars(cached.bars, tradeSymbol)
    const latest = zones[zones.length - 1]
    return latest ? { proximal: latest.proximal, kind: latest.kind } : null
  }, [tradeSymbol])

  // Place the order from the ticket, then jump to the Backtest page.
  const handleSubmitTicket = (ticket: TradeTicket) => {
    if (!tradeStock) return
    portfolio.openTrade({
      symbol: tradeStock.symbol,
      name: tradeStock.name,
      price: tradeStock.price,
      shares: ticket.shares,
      orderType: ticket.orderType,
      limitPrice: ticket.limitPrice,
      zoneKind: ticket.zoneKind,
    })
    setTradeSymbol(null)
    setView('backtest')
  }

  // Pending-order watcher: whenever live prices update, try to fill any resting
  // limit orders whose proximal line has been touched.
  // Pending-order watcher: on each feed refresh, test each resting limit order
  // against its symbol's latest daily bar low/high, so a fill triggers when the
  // session traded *through* the proximal line (intraday touch), not only when
  // the close crossed it. The latest bar comes from the local daily-bar cache;
  // if a symbol isn't cached we fall back to its live price as a flat range.
  const { fillPending } = portfolio
  const pendingSymbols = useMemo(
    () => portfolio.positions.filter((p) => p.status === 'pending').map((p) => p.symbol),
    [portfolio.positions],
  )
  useEffect(() => {
    if (pendingSymbols.length === 0) return
    const cached = loadCached(pendingSymbols)
    const rangeBySymbol = new Map<string, { low: number; high: number }>()
    for (const sym of pendingSymbols) {
      const bars = cached[sym]?.bars
      const latest = bars && bars.length > 0 ? bars[bars.length - 1] : undefined
      if (latest) {
        rangeBySymbol.set(sym, { low: latest.low, high: latest.high })
      } else {
        // No cached bars — fall back to the live price as a zero-width range.
        const live = stocks.find((s) => s.symbol === sym)?.price
        if (live !== undefined) rangeBySymbol.set(sym, { low: live, high: live })
      }
    }
    fillPending(rangeBySymbol)
  }, [stocks, pendingSymbols, fillPending])

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
            className={`nav-tab ${view === 'backtest' ? 'active' : ''}`}
            onClick={() => setView('backtest')}
          >
            Backtesting
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
        <ExplosiveMoves stocks={stocks} status={status} onTrade={handleTrade} />
      ) : view === 'backtest' ? (
        <Backtest stocks={stocks} portfolio={portfolio} />
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
          key={selectedStock.symbol}
          stock={selectedStock}
          onClose={() => setSelectedSymbol(null)}
          onTrade={handleTrade}
        />
      )}

      {tradeStock && (
        <TradeTicketModal
          key={tradeStock.symbol}
          symbol={tradeStock.symbol}
          name={tradeStock.name}
          price={tradeStock.price}
          budget={portfolio.budget}
          proximal={tradeZone?.proximal ?? null}
          zoneKind={tradeZone?.kind ?? null}
          onSubmit={handleSubmitTicket}
          onClose={() => setTradeSymbol(null)}
        />
      )}
    </div>
  )
}

export default App

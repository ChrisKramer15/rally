import { useMemo, useState } from 'react'
import { changePct, LIVE_QUOTE_CAP } from './data/stocks'
import { loadCached } from './data/dailyCache'
import { useLiveQuotes } from './hooks/useLiveQuotes'
import { overlayLiveQuotes } from './data/liveQuoteOverlay'
import { formatEasternTime } from './data/marketCalendar'
import { detectBasesForBars, selectSignalZone, type ZoneGrade, type ZoneKind } from './hooks/useBasingZones'
import { gradeExplosiveAt, type ExplosiveGrade } from './hooks/useExplosiveMoves'
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
import { useBacktestPortfolio, type TradeSide } from './hooks/useBacktestPortfolio'
import { friendlyWriteError } from './data/supabaseTradesStore'
import { atrFromBars, computePortfolioSummary } from './data/tradeMath'
import './App.css'

type View = 'dashboard' | 'signals' | 'backtest' | 'pipeline'

function App() {
  const [view, setView] = useState<View>('dashboard')

  // Index cards: real daily data via ETF proxies (SPY/QQQ/DIA) from Supabase.
  const { indices } = useIndexMarket()

  // Named watchlists (up to 10), user-defined and persisted. The feed/Signals/
  // Backtest all operate on the de-duplicated UNION across every list; the
  // editor edits one list at a time.
  const {
    lists,
    activeList,
    activeId,
    unionSymbols,
    canAddList,
    selectList,
    saveActiveSymbols,
    addList,
    renameList,
    removeList,
  } = useWatchlist()

  // Daily watchlist data from Tiingo, cached per trading day; simulated when no key is set.
  const { stocks, flash, lastUpdated, status, error, budget } = useWatchlistMarket(unionSymbols)

  // Paper-trading portfolio for the Backtest page (persisted to localStorage).
  const portfolio = useBacktestPortfolio()

  // ── Near-real-time (Finnhub) live quotes ────────────────────────────────
  // Tiingo daily closes remain the source of truth for the homepage, watchlist,
  // movers, index cards, and ALL signal generation. Finnhub is layered in ONLY
  // for tickers you've actually COMMITTED to — open positions and pending limit
  // orders — plus the one you're actively pricing in the trade ticket. That's
  // the deliberate scope: we only spend real-time quota on tickers worth a limit
  // order to you, never on the broad signal list.

  // Ticker detail modal — null means closed.
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null)
  const selectedStock = selectedSymbol ? stocks.find((s) => s.symbol === selectedSymbol) ?? null : null

  // Trade ticket — the symbol the user is placing an order for (null = closed).
  const [tradeSymbol, setTradeSymbol] = useState<string | null>(null)

  // Trade action: open the order ticket. Closes any detail modal first.
  const handleTrade = (symbol: string) => {
    setSelectedSymbol(null)
    setTradeSymbol(symbol)
  }

  // Assemble the capped live-quote symbol set: every open/pending position,
  // plus the symbol currently open in the trade ticket — deduped and limited to
  // LIVE_QUOTE_CAP as a hard safety ceiling (you'll rarely approach it).
  const liveSymbols = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const add = (sym?: string | null) => {
      if (!sym) return
      const s = sym.toUpperCase()
      if (seen.has(s) || out.length >= LIVE_QUOTE_CAP) return
      seen.add(s)
      out.push(s)
    }
    for (const p of portfolio.positions) add(p.symbol)
    return out
  }, [portfolio.positions])

  // Subscribe to live quotes for that set (shared, budget-paced scheduler).
  const { quotes: liveQuotes } = useLiveQuotes(liveSymbols)

  // Daily-close feed with live prices overlaid — for VALUATION/DISPLAY of
  // EXISTING positions on the Backtest surface only. The plain `stocks` (daily
  // close) still feeds the homepage, watchlist, movers, index cards, the Signals
  // table, AND the trade ticket (you commit at the daily-close-informed price;
  // live data only tracks the order once it's resting/open).
  const liveStocks = useMemo(() => overlayLiveQuotes(stocks, liveQuotes), [stocks, liveQuotes])

  // The trade ticket prices off the TIINGO daily close (not live) — the order is
  // placed against yesterday's close; Finnhub tracks it after it's pending/open.
  const tradeStock = tradeSymbol ? stocks.find((s) => s.symbol === tradeSymbol) ?? null : null

  // Zone context for the symbol being traded, from its most recent basing zone:
  //   • proximal → seeds the limit-order price (the entry line)
  //   • distal   → anchors the stop just beyond the zone's far edge
  //   • atr      → sizes the stop buffer beyond the distal line
  //   • swingTarget → top of the last trend leg; seeds the cash-out target
  // Computed from the local daily-bar cache (same source the zones hook uses).
  //   • kind     → the signal's direction: a demand zone (explosive up move)
  //                defaults the ticket to Long; a supply zone (down move) to
  //                Short. The user can still override in the ticket.
  // Signal provenance carried through to the placed trade (shown on Backtest):
  //   • kind + grade (base quality) + strength (explosive-candle grade, graded
  //     by the zone's explosive date) + the proximal line + explosive date.
  const tradeZone = useMemo<{
    proximal: number
    distal: number
    atr?: number
    side: TradeSide
    swingTarget?: number
    kind: ZoneKind
    grade: ZoneGrade
    strength?: ExplosiveGrade
    signalDate: string
  } | null>(() => {
    if (!tradeSymbol) return null
    const cached = loadCached([tradeSymbol])[tradeSymbol]
    if (!cached || cached.bars.length === 0) return null
    const zones = detectBasesForBars(cached.bars, tradeSymbol)
    // Seed the ticket from the SAME zone the Signals row represents: the best
    // fresh (unmitigated) zone nearest to current price, not blindly the newest
    // one. Uses the shared selectSignalZone helper so the row and ticket agree.
    const latest = selectSignalZone(zones, tradeStock?.price)
    if (!latest) return null
    return {
      proximal: latest.proximal,
      distal: latest.distal,
      atr: atrFromBars(cached.bars),
      side: latest.kind === 'supply' ? 'short' : 'long',
      swingTarget: latest.swingTarget ?? undefined,
      kind: latest.kind,
      grade: latest.grade,
      strength: gradeExplosiveAt(cached.bars, latest.explosiveDate) ?? undefined,
      signalDate: latest.explosiveDate,
    }
  }, [tradeSymbol, tradeStock?.price])

  // Place the order from the ticket, then jump to the Backtest page.
  const handleSubmitTicket = (ticket: TradeTicket) => {
    if (!tradeStock) return
    portfolio.openTrade({
      symbol: tradeStock.symbol,
      name: tradeStock.name,
      price: tradeStock.price,
      side: ticket.side,
      shares: ticket.shares,
      orderType: ticket.orderType,
      limitPrice: ticket.limitPrice,
      distal: tradeZone?.distal,
      atr: tradeZone?.atr,
      swingTarget: tradeZone?.swingTarget,
      zoneKind: tradeZone?.kind,
      zoneGrade: tradeZone?.grade,
      signalStrength: tradeZone?.strength,
      proximal: tradeZone?.proximal,
      signalDate: tradeZone?.signalDate,
    })
    setTradeSymbol(null)
    setView('backtest')
  }

  // Fills + exits are handled SERVER-SIDE now (the settle-positions Edge
  // Function on a cron, using live Finnhub quotes). The browser no longer walks
  // daily bars to fill/settle — it just reads the results (hydrate + Realtime).

  // Total account value (cash + market value of open positions) — the base the
  // trade ticket sizes its 1%-risk default against, so a stop-out costs ≤1% of
  // the whole portfolio, not just the starting budget.
  const portfolioSummary = useMemo(
    () => computePortfolioSummary(portfolio.budget, portfolio.positions, liveStocks, portfolio.closed),
    [portfolio.budget, portfolio.positions, liveStocks, portfolio.closed],
  )

  // Ticker tape is always sorted alphabetically, regardless of the watchlist's
  // own sort control.
  const tickerStocks = [...stocks].sort((a, b) => a.symbol.localeCompare(b.symbol))

  const updatedLabel = lastUpdated
    ? `${formatEasternTime(lastUpdated)} ET`
    : '—'

  // Scroll the ticker at a constant visual speed regardless of how many symbols
  // are in the union: scale the marquee duration with the item count (~2s per
  // ticker) rather than a fixed duration, which would speed up as the list grows.
  const tickerDuration = Math.max(45, tickerStocks.length * 3)

  return (
    <div className="dashboard">
      {/* Persistence-failure banner: a trade did NOT save to Supabase. This
          replaces the old silent console.warn so the user (and we) can see the
          exact reason a trade vanishes on refresh — the `code` pinpoints it. */}
      {portfolio.writeError && (() => {
        // Friendly copy per error code. An INTENTIONAL rejection (position cap,
        // duplicate ticker) reads as a normal "declined" notice — nothing was
        // lost — while a genuine save failure keeps the alarming "will disappear
        // on refresh" warning. The raw code stays visible for support/debugging.
        const friendly = friendlyWriteError(portfolio.writeError)
        return (
          <div className="trade-persist-error" role="alert">
            <div className="trade-persist-error__body">
              <strong>{friendly.title}</strong> {friendly.detail}
              {!friendly.rejected && ' This change did not persist and will disappear on refresh.'}
              {portfolio.writeError.code && (
                <span className="trade-persist-error__detail">
                  {portfolio.writeError.op} · code {portfolio.writeError.code}
                </span>
              )}
            </div>
            <button
              type="button"
              className="trade-persist-error__dismiss"
              onClick={portfolio.clearWriteError}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )
      })()}
      {/* Ticker tape — always alphabetized, independent of watchlist sort. */}
      <div className="ticker-tape">
        <div
          className="ticker-track"
          style={{ animationDuration: `${tickerDuration}s` }}
        >
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
          <span
            className="muted"
            title="Active tracked symbols across all watchlists, against Tiingo's free-tier monthly unique-symbol budget (500/month)."
          >
            {budget.tracked}/{budget.cap} symbols tracked
          </span>
        </div>
      </header>

      {view === 'dashboard' && error && <div className="feed-error-banner">{error}</div>}

      {view === 'dashboard' ? (
        <>
          <section className="index-section">
            <div className="index-section-head">
              <h2>Indices</h2>
              <span className="index-section-note">Prior-session daily close · not real-time</span>
            </div>
            <div className="index-grid">
              {indices.map((q) => (
                <IndexCard key={q.symbol} quote={q} />
              ))}
            </div>
          </section>

          <section className="main-grid">
            <Watchlist
              stocks={stocks}
              flash={flash}
              onSelectSymbol={setSelectedSymbol}
              lists={lists}
              action={
                <WatchlistEditor
                  lists={lists}
                  activeList={activeList}
                  activeId={activeId}
                  canAddList={canAddList}
                  onSelectList={selectList}
                  onSaveSymbols={saveActiveSymbols}
                  onAddList={addList}
                  onRenameList={renameList}
                  onRemoveList={removeList}
                />
              }
            />
            <Movers stocks={stocks} />
          </section>
        </>
      ) : view === 'signals' ? (
        <ExplosiveMoves stocks={stocks} status={status} portfolio={portfolio} onTrade={handleTrade} />
      ) : view === 'backtest' ? (
        <Backtest stocks={liveStocks} portfolio={portfolio} />
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
          portfolioValue={portfolioSummary.totalValue}
          proximal={tradeZone?.proximal ?? null}
          distal={tradeZone?.distal ?? null}
          atr={tradeZone?.atr ?? null}
          swingTarget={tradeZone?.swingTarget ?? null}
          defaultSide={tradeZone?.side ?? 'long'}
          /* Block new orders once at the position ceiling — but not when this
             symbol is already a position (re-opening its ticket is fine). */
          atCapacity={
            portfolio.atPositionLimit &&
            !portfolio.positions.some((p) => p.symbol === tradeStock.symbol)
          }
          maxPositions={portfolio.maxPositions}
          onSubmit={handleSubmitTicket}
          onClose={() => setTradeSymbol(null)}
        />
      )}
    </div>
  )
}

export default App

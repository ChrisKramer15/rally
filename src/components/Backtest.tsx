import { useMemo, useState } from 'react'
import { formatCurrency, type Stock } from '../data/stocks'
import {
  DEFAULT_BUDGET,
  type BacktestPosition,
  type ClosedTrade,
  type useBacktestPortfolio,
} from '../hooks/useBacktestPortfolio'
import { computePortfolioSummary } from '../data/tradeMath'
import { formatEasternDateTime } from '../data/marketCalendar'
import { TradeDetailModal } from './TradeDetailModal'

/** The placement moment in ET (falls back to the plain date for legacy rows). */
function placedLabel(position: BacktestPosition): string {
  if (position.placedAt) {
    const d = new Date(position.placedAt)
    if (!Number.isNaN(d.getTime())) return formatEasternDateTime(d)
  }
  return position.placedDate
}

type Portfolio = ReturnType<typeof useBacktestPortfolio>

interface BacktestProps {
  /** Live watchlist data, used to mark open positions to market. */
  stocks: Stock[]
  portfolio: Portfolio
}

/** Resolve the current market price for a symbol from the live watchlist. */
function currentPriceFor(symbol: string, stocks: Stock[]): number | null {
  const s = stocks.find((x) => x.symbol === symbol)
  return s ? s.price : null
}

/**
 * The trade's actual reward-to-risk, derived from its managed levels rather
 * than a preset: reward = |cash-out − entry|, risk = |entry − stop|. Uses the
 * limit price as the entry reference while a limit order is still pending.
 * Returns null when risk is zero or the reference price is unavailable.
 */
function realizedRR(position: BacktestPosition): number | null {
  const ref = position.entryPrice ?? position.limitPrice
  if (ref == null || !Number.isFinite(ref)) return null
  const risk = Math.abs(ref - position.stopLossPrice)
  const reward = Math.abs(position.cashOutPrice - ref)
  return risk > 0 ? reward / risk : null
}

/** Format an R:R ratio for display, e.g. "2.4:1", or a dash when unknown. */
function formatRR(position: BacktestPosition): string {
  const rr = realizedRR(position)
  return rr != null ? `${rr.toFixed(1)}:1` : '—'
}

/**
 * Badges describing the signal a trade was placed from — its zone direction
 * (demand/supply), the base-quality grade, and the explosive-move strength.
 * Renders nothing when the trade carries no captured signal context (e.g. a
 * position placed before this data was tracked, or with no detected zone).
 */
function SignalBadges({
  zoneKind,
  zoneGrade,
  signalStrength,
}: {
  zoneKind?: BacktestPosition['zoneKind']
  zoneGrade?: BacktestPosition['zoneGrade']
  signalStrength?: BacktestPosition['signalStrength']
}) {
  if (!zoneKind && !zoneGrade && !signalStrength) return null
  return (
    <span className="bt-signal">
      {zoneKind && (
        <span className={`bt-zone-badge bt-zone-${zoneKind}`}>
          {zoneKind === 'supply' ? 'Supply' : 'Demand'}
        </span>
      )}
      {zoneGrade && (
        <span className="bt-signal-tag" title="Basing-zone quality grade">
          base {zoneGrade}
        </span>
      )}
      {signalStrength && (
        <span className="bt-signal-tag" title="Explosive-move (signal) strength">
          {signalStrength}
        </span>
      )}
    </span>
  )
}

function OpenPositionRow({
  position,
  stocks,
  onClose,
  onSelect,
}: {
  position: BacktestPosition
  stocks: Stock[]
  onClose: (id: string, exitPrice?: number) => void
  onSelect: (position: BacktestPosition) => void
}) {
  const isShort = position.side === 'short'
  const entryPrice = position.entryPrice ?? 0
  const livePrice = currentPriceFor(position.symbol, stocks)
  const tradeCost = entryPrice * position.shares
  // Fall back to entry price when we have no live quote (mark-to-cost).
  const markPrice = livePrice ?? entryPrice
  const currentCost = markPrice * position.shares
  // P/L direction flips for shorts: profit when price falls below entry.
  const pnl = isShort ? (entryPrice - markPrice) * position.shares : currentCost - tradeCost
  const pnlPct = tradeCost > 0 ? (pnl / tradeCost) * 100 : 0
  const up = pnl >= 0

  // Flag when price has crossed a managed level. For a short the stop is above
  // and the target below entry, so the comparisons invert.
  const hitStop = livePrice !== null && (isShort ? livePrice >= position.stopLossPrice : livePrice <= position.stopLossPrice)
  const hitTarget = livePrice !== null && (isShort ? livePrice <= position.cashOutPrice : livePrice >= position.cashOutPrice)

  return (
    <li
      className="bt-row bt-row-clickable"
      onClick={() => onSelect(position)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(position) } }}
      title={`View ${position.symbol} chart with trade levels`}
    >
      <div className="bt-col-date">{position.openedDate ?? '—'}</div>

      <div className="bt-col-sym">
        <span className="bt-sym">
          {position.symbol}
          <span className={`bt-side-badge ${isShort ? 'bt-side-short' : 'bt-side-long'}`}>
            {isShort ? 'SHORT' : 'LONG'}
          </span>
        </span>
        {position.name && position.name !== position.symbol && (
          <span className="bt-name">{position.name}</span>
        )}
        <span className="bt-shares">{position.shares} sh · {position.orderType} · {formatRR(position)}</span>
        <SignalBadges
          zoneKind={position.zoneKind}
          zoneGrade={position.zoneGrade}
          signalStrength={position.signalStrength}
        />
      </div>

      <div className="bt-col-num" data-label="Trade cost">
        <span className="bt-cost">${formatCurrency(tradeCost)}</span>
        <span className="bt-sub">@ ${formatCurrency(entryPrice)}</span>
      </div>

      <div className="bt-col-num" data-label="Current cost">
        <span className={`bt-cost ${up ? 'up' : 'down'}`}>${formatCurrency(currentCost)}</span>
        <span className={`bt-sub ${up ? 'up' : 'down'}`}>
          {up ? '+' : ''}{pnlPct.toFixed(2)}%
        </span>
      </div>

      <div className="bt-col-num" data-label="Stop-loss">
        <span className={`bt-stop ${hitStop ? 'bt-hit' : ''}`}>
          ${formatCurrency(position.stopLossPrice)}
        </span>
      </div>

      <div className="bt-col-num" data-label="Cash-out">
        <span className={`bt-target ${hitTarget ? 'bt-hit' : ''}`}>
          ${formatCurrency(position.cashOutPrice)}
        </span>
      </div>

      <div className="bt-col-action">
        <button
          className="bt-close-btn"
          onClick={(e) => { e.stopPropagation(); onClose(position.id, markPrice) }}
          aria-label={`Close ${position.symbol} position`}
          title="Close position at market — banks realized P/L"
        >
          ×
        </button>
      </div>
    </li>
  )
}

function PendingOrderRow({
  position,
  stocks,
  onCancel,
  onSelect,
}: {
  position: BacktestPosition
  stocks: Stock[]
  onCancel: (id: string) => void
  onSelect: (position: BacktestPosition) => void
}) {
  const isShort = position.side === 'short'
  const limit = position.limitPrice ?? 0
  const livePrice = currentPriceFor(position.symbol, stocks)
  const reserved = limit * position.shares
  // Distance the live price still has to travel to trigger the fill.
  const distancePct = livePrice && limit > 0 ? ((livePrice - limit) / limit) * 100 : null
  const dir = isShort ? 'rises to' : 'drops to'

  return (
    <li
      className="bt-row bt-row-pending bt-row-clickable"
      onClick={() => onSelect(position)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(position) } }}
      title={`View ${position.symbol} chart with trade levels`}
    >
      <div className="bt-col-date" title={`Placed ${placedLabel(position)}`}>
        {position.placedDate}
        <span className="bt-placed-time">{placedLabel(position)}</span>
      </div>

      <div className="bt-col-sym">
        <span className="bt-sym">
          {position.symbol}
          <span className={`bt-side-badge ${isShort ? 'bt-side-short' : 'bt-side-long'}`}>
            {isShort ? 'SHORT' : 'LONG'}
          </span>
        </span>
        {position.name && position.name !== position.symbol && (
          <span className="bt-name">{position.name}</span>
        )}
        <span className="bt-shares">{position.shares} sh · limit · {formatRR(position)}</span>
        <SignalBadges
          zoneKind={position.zoneKind}
          zoneGrade={position.zoneGrade}
          signalStrength={position.signalStrength}
        />
      </div>

      <div className="bt-col-num" data-label="Reserved">
        <span className="bt-cost">${formatCurrency(reserved)}</span>
        <span className="bt-sub">@ ${formatCurrency(limit)}</span>
      </div>

      <div className="bt-col-num bt-col-wide" data-label="Trigger">
        <span className="bt-pending-tag">Pending</span>
        <span className="bt-sub">
          fills when {dir} ${formatCurrency(limit)}
          {distancePct !== null && ` (${distancePct >= 0 ? '+' : ''}${distancePct.toFixed(1)}% away)`}
        </span>
      </div>

      <div className="bt-col-num" data-label="Stop-loss">
        <span className="bt-stop">${formatCurrency(position.stopLossPrice)}</span>
      </div>

      <div className="bt-col-num" data-label="Cash-out">
        <span className="bt-target">${formatCurrency(position.cashOutPrice)}</span>
      </div>

      <div className="bt-col-action">
        <button
          className="bt-close-btn"
          onClick={(e) => { e.stopPropagation(); onCancel(position.id) }}
          aria-label={`Cancel ${position.symbol} pending order`}
          title="Cancel pending order"
        >
          ×
        </button>
      </div>
    </li>
  )
}

/** A single banked closed-trade row (reused flat and inside grouped sections). */
function ClosedTradeRow({ trade }: { trade: ClosedTrade }) {
  const up = trade.realizedPnl >= 0
  const cost = trade.entryPrice * trade.shares
  const pct = cost > 0 ? (trade.realizedPnl / cost) * 100 : 0
  return (
    <li className="bt-closed-row">
      <div className="bt-col-date">{trade.closedDate}</div>
      <div className="bt-col-sym">
        <span className="bt-sym">
          {trade.symbol}
          <span className={`bt-side-badge ${trade.side === 'short' ? 'bt-side-short' : 'bt-side-long'}`}>
            {trade.side === 'short' ? 'SHORT' : 'LONG'}
          </span>
        </span>
        <span className="bt-shares">{trade.shares} sh</span>
        <SignalBadges
          zoneKind={trade.zoneKind}
          zoneGrade={trade.zoneGrade}
          signalStrength={trade.signalStrength}
        />
      </div>
      <div className="bt-col-num" data-label="Entry">
        <span className="bt-sub">${formatCurrency(trade.entryPrice)}</span>
      </div>
      <div className="bt-col-num" data-label="Exit">
        <span className="bt-sub">${formatCurrency(trade.exitPrice)}</span>
      </div>
      <div className="bt-col-num" data-label="Realized">
        <span className={`bt-cost ${up ? 'up' : 'down'}`}>
          {up ? '+' : ''}${formatCurrency(trade.realizedPnl)}
        </span>
        <span className={`bt-sub ${up ? 'up' : 'down'}`}>
          {up ? '+' : ''}{pct.toFixed(2)}%
        </span>
      </div>
    </li>
  )
}

/** How the closed-trades list is grouped, for reviewing signal correlation. */
type ClosedGroupBy = 'none' | 'zoneKind' | 'zoneGrade' | 'signalStrength'

const CLOSED_GROUP_OPTIONS: { value: ClosedGroupBy; label: string }[] = [
  { value: 'none', label: 'Recent' },
  { value: 'zoneKind', label: 'Zone' },
  { value: 'zoneGrade', label: 'Base grade' },
  { value: 'signalStrength', label: 'Signal' },
]

/** A bucket of closed trades sharing a group key, with review stats. */
interface ClosedGroup {
  key: string
  label: string
  trades: ClosedTrade[]
  /** Trades with realized P/L > 0. */
  wins: number
  /** Net realized P/L across the group. */
  netPnl: number
}

/** The label for a trade's value of the chosen group dimension. */
function groupValue(trade: ClosedTrade, by: ClosedGroupBy): string {
  switch (by) {
    case 'zoneKind':
      return trade.zoneKind ? (trade.zoneKind === 'supply' ? 'Supply' : 'Demand') : 'No signal'
    case 'zoneGrade':
      return trade.zoneGrade ? `Base ${trade.zoneGrade}` : 'No signal'
    case 'signalStrength':
      return trade.signalStrength ? `Signal ${trade.signalStrength}` : 'No signal'
    case 'none':
    default:
      return ''
  }
}

/**
 * Bucket closed trades by the chosen dimension and compute per-group review
 * stats (win count + net realized P/L). Groups are ordered by net P/L desc so
 * the most/least profitable signal buckets surface first — the fastest read on
 * which signal quality actually correlates with winning trades.
 */
function groupClosed(trades: ClosedTrade[], by: ClosedGroupBy): ClosedGroup[] {
  const map = new Map<string, ClosedGroup>()
  for (const t of trades) {
    const label = groupValue(t, by)
    let g = map.get(label)
    if (!g) {
      g = { key: label, label, trades: [], wins: 0, netPnl: 0 }
      map.set(label, g)
    }
    g.trades.push(t)
    if (t.realizedPnl > 0) g.wins++
    g.netPnl += t.realizedPnl
  }
  return [...map.values()].sort((a, b) => b.netPnl - a.netPnl)
}

/** Which bucket of trades the Backtest table is showing. */
type TradeView = 'pending' | 'active' | 'closed'

export function Backtest({ stocks, portfolio }: BacktestProps) {
  const { budget, positions, closed, setBudget, closePosition, resetPortfolio } = portfolio
  const [budgetDraft, setBudgetDraft] = useState<string>(String(budget))
  // Id of the position whose chart/level detail modal is open (null = closed).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Which trade bucket the table shows. Defaults to active (filled positions).
  const [view, setView] = useState<TradeView>('active')
  // How the closed-trades list is grouped, for reviewing signal correlation.
  const [closedGroupBy, setClosedGroupBy] = useState<ClosedGroupBy>('none')

  // Resolve the live selected position from the current positions list so it
  // stays in sync if the underlying data changes (e.g. a pending order fills).
  const selectedPosition = useMemo(
    () => (selectedId ? positions.find((p) => p.id === selectedId) ?? null : null),
    [selectedId, positions],
  )

  const commitBudget = () => {
    const parsed = Number(budgetDraft.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(parsed) && parsed >= 0) setBudget(parsed)
    else setBudgetDraft(String(budget))
  }

  const openPositions = useMemo(() => positions.filter((p) => p.status === 'open'), [positions])
  const pendingOrders = useMemo(() => positions.filter((p) => p.status === 'pending'), [positions])
  // Closed trades bucketed by the chosen signal dimension (empty when 'none').
  const closedGroups = useMemo(
    () => (closedGroupBy === 'none' ? [] : groupClosed(closed, closedGroupBy)),
    [closed, closedGroupBy],
  )

  // Shared with the Signals page summary so both views always agree.
  const { cash, invested, marketValue, openPnl, reserved, realizedPnl, totalPnl } = useMemo(
    () => computePortfolioSummary(budget, positions, stocks, closed),
    [budget, positions, stocks, closed],
  )
  const pnlUp = openPnl >= 0
  const realizedUp = realizedPnl >= 0
  const totalUp = totalPnl >= 0

  return (
    <div className="bt-page">
      {/* ── Header / portfolio summary ── */}
      <div className="bt-header panel">
        <div className="bt-header-left">
          <h2>Backtesting</h2>
          <p className="bt-subtitle">
            Paper-trade your signals. Click <strong>Trade</strong> on any ticker to place a market
            or limit order. Limit orders rest as <strong>pending</strong> until price reaches the
            proximal line, then fill automatically.
          </p>
        </div>

        <div className="bt-budget">
          <label className="bt-budget-label" htmlFor="bt-budget-input">Portfolio budget</label>
          <div className="bt-budget-input-wrap">
            <span className="bt-budget-dollar">$</span>
            <input
              id="bt-budget-input"
              className="bt-budget-input"
              type="text"
              inputMode="decimal"
              value={budgetDraft}
              onChange={(e) => setBudgetDraft(e.target.value)}
              onBlur={commitBudget}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              aria-label="Portfolio budget in dollars"
            />
          </div>
        </div>

        <div className="bt-metrics">
          <div className="bt-metric">
            <span className="bt-metric-label">Cash</span>
            <span className="bt-metric-val">${formatCurrency(cash)}</span>
          </div>
          <div className="bt-metric">
            <span className="bt-metric-label">Invested</span>
            <span className="bt-metric-val">${formatCurrency(invested)}</span>
          </div>
          <div className="bt-metric">
            <span className="bt-metric-label">Market value</span>
            <span className="bt-metric-val">${formatCurrency(marketValue)}</span>
          </div>
          <div className="bt-metric">
            <span className="bt-metric-label">Open P/L</span>
            <span className={`bt-metric-val ${pnlUp ? 'up' : 'down'}`}>
              {pnlUp ? '+' : ''}${formatCurrency(openPnl)}
            </span>
          </div>
          <div className="bt-metric">
            <span className="bt-metric-label">Realized P/L</span>
            <span className={`bt-metric-val ${realizedUp ? 'up' : 'down'}`}>
              {realizedUp ? '+' : ''}${formatCurrency(realizedPnl)}
            </span>
          </div>
          <div className="bt-metric">
            <span className="bt-metric-label">Total P/L</span>
            <span className={`bt-metric-val ${totalUp ? 'up' : 'down'}`}>
              {totalUp ? '+' : ''}${formatCurrency(totalPnl)}
            </span>
          </div>
        </div>
      </div>

      {/* ── View toggle: pending / active / closed ── */}
      <div className="bt-view-bar panel">
        <div className="tt-seg bt-view-seg" role="tablist" aria-label="Trade view">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'pending'}
            className={`tt-seg-btn ${view === 'pending' ? 'active' : ''}`}
            onClick={() => setView('pending')}
          >
            Pending <span className="bt-view-count">{pendingOrders.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'active'}
            className={`tt-seg-btn ${view === 'active' ? 'active' : ''}`}
            onClick={() => setView('active')}
          >
            Active <span className="bt-view-count">{openPositions.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'closed'}
            className={`tt-seg-btn ${view === 'closed' ? 'active' : ''}`}
            onClick={() => setView('closed')}
          >
            Closed <span className="bt-view-count">{closed.length}</span>
          </button>
        </div>
        {positions.length > 0 && (
          <button className="bt-reset-btn" onClick={resetPortfolio} title="Clear all positions and reset budget">
            Reset portfolio
          </button>
        )}
      </div>

      {/* ── Pending orders (limit) ── */}
      {view === 'pending' && (
        <div className="panel bt-table-panel">
          <div className="bt-table-head-row">
            <h3 className="bt-section-title">Pending Orders ({pendingOrders.length})</h3>
            <span className="bt-reserved">${formatCurrency(reserved)} reserved</span>
          </div>

          {pendingOrders.length === 0 ? (
            <div className="bt-empty">
              <span className="bt-empty-icon">⏳</span>
              <span>
                No pending orders. Place a <strong>limit</strong> order from the Trade ticket and it
                rests here until price reaches the proximal line.
              </span>
            </div>
          ) : (
            <>
              <div className="bt-row bt-row-head">
                <div className="bt-col-date">Placed</div>
                <div className="bt-col-sym">Ticker</div>
                <div className="bt-col-num">Order</div>
                <div className="bt-col-num bt-col-wide">Trigger</div>
                <div className="bt-col-num">Stop-loss</div>
                <div className="bt-col-num">Cash-out</div>
                <div className="bt-col-action"></div>
              </div>

              <ul className="bt-list" aria-label="Pending orders">
                {pendingOrders.map((p) => (
                  <PendingOrderRow
                    key={p.id}
                    position={p}
                    stocks={stocks}
                    onCancel={closePosition}
                    onSelect={(pos) => setSelectedId(pos.id)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* ── Active (open) positions ── */}
      {view === 'active' && (
        <div className="panel bt-table-panel">
          <div className="bt-table-head-row">
            <h3 className="bt-section-title">Active Positions ({openPositions.length})</h3>
          </div>

          <div className="bt-row bt-row-head">
            <div className="bt-col-date">Date opened</div>
            <div className="bt-col-sym">Ticker</div>
            <div className="bt-col-num">Trade cost</div>
            <div className="bt-col-num">Current cost</div>
            <div className="bt-col-num">Stop-loss</div>
            <div className="bt-col-num">Cash-out</div>
            <div className="bt-col-action"></div>
          </div>

          {openPositions.length === 0 ? (
            <div className="bt-empty">
              <span className="bt-empty-icon">📈</span>
              <span>
                No active positions yet. Open a ticker from Signals or your watchlist and hit
                <strong> Trade</strong> to add one here.
              </span>
            </div>
          ) : (
            <ul className="bt-list" aria-label="Active positions">
              {openPositions.map((p) => (
                <OpenPositionRow
                  key={p.id}
                  position={p}
                  stocks={stocks}
                  onClose={closePosition}
                  onSelect={(pos) => setSelectedId(pos.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Closed trades (realized P/L history) ── */}
      {view === 'closed' && (
        <div className="panel bt-table-panel">
          <div className="bt-table-head-row">
            <h3 className="bt-section-title">Closed Trades ({closed.length})</h3>
            {closed.length > 0 && (
              <span className={`bt-reserved ${realizedUp ? 'up' : 'down'}`}>
                {realizedUp ? '+' : ''}${formatCurrency(realizedPnl)} realized
              </span>
            )}
          </div>

          {closed.length === 0 ? (
            <div className="bt-empty">
              <span className="bt-empty-icon">🧾</span>
              <span>
                No closed trades yet. Positions land here once they hit their cash-out or stop-loss,
                or when you close them early.
              </span>
            </div>
          ) : (
            <>
              {/* Group-by control: bucket closed trades by signal dimension so
                  win-rate + net P/L per bucket reveal what correlates with wins. */}
              <div className="bt-groupby">
                <span className="bt-groupby-label">Group by</span>
                <div className="tt-seg bt-groupby-seg" role="tablist" aria-label="Group closed trades">
                  {CLOSED_GROUP_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="tab"
                      aria-selected={closedGroupBy === opt.value}
                      className={`tt-seg-btn ${closedGroupBy === opt.value ? 'active' : ''}`}
                      onClick={() => setClosedGroupBy(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bt-closed-row bt-row-head">
                <div className="bt-col-date">Closed</div>
                <div className="bt-col-sym">Ticker</div>
                <div className="bt-col-num">Entry</div>
                <div className="bt-col-num">Exit</div>
                <div className="bt-col-num">Realized</div>
              </div>

              {closedGroupBy === 'none' ? (
                <ul className="bt-list" aria-label="Closed trades">
                  {closed.map((t) => (
                    <ClosedTradeRow key={t.id} trade={t} />
                  ))}
                </ul>
              ) : (
                closedGroups.map((g) => {
                  const winRate = g.trades.length > 0 ? (g.wins / g.trades.length) * 100 : 0
                  const netUp = g.netPnl >= 0
                  return (
                    <div key={g.key} className="bt-group">
                      <div className="bt-group-head">
                        <span className="bt-group-label">{g.label}</span>
                        <span className="bt-group-stats">
                          <span className="bt-group-winrate">
                            {g.wins}/{g.trades.length} won ({winRate.toFixed(0)}%)
                          </span>
                          <span className={`bt-group-net ${netUp ? 'up' : 'down'}`}>
                            {netUp ? '+' : ''}${formatCurrency(g.netPnl)}
                          </span>
                        </span>
                      </div>
                      <ul className="bt-list" aria-label={`Closed trades — ${g.label}`}>
                        {g.trades.map((t) => (
                          <ClosedTradeRow key={t.id} trade={t} />
                        ))}
                      </ul>
                    </div>
                  )
                })
              )}
            </>
          )}
        </div>
      )}

      <div className="bt-footnote">
        Starting budget defaults to ${formatCurrency(DEFAULT_BUDGET)}. Positions auto-close at their
        cash-out target or stop-loss when a session trades through that level — booking realized P/L
        at the level, like a resting order — and realized P/L compounds into your budget. The × button
        closes early at the current market price. Simulation only — not financial advice.
      </div>

      {selectedPosition && (
        <TradeDetailModal
          key={selectedPosition.id}
          position={selectedPosition}
          livePrice={currentPriceFor(selectedPosition.symbol, stocks)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}

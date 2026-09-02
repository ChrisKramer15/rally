import { useMemo, useState } from 'react'
import { formatCurrency, type Stock } from '../data/stocks'
import {
  DEFAULT_BUDGET,
  type BacktestPosition,
  type useBacktestPortfolio,
} from '../hooks/useBacktestPortfolio'

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

function OpenPositionRow({
  position,
  stocks,
  onClose,
}: {
  position: BacktestPosition
  stocks: Stock[]
  onClose: (id: string) => void
}) {
  const entryPrice = position.entryPrice ?? 0
  const livePrice = currentPriceFor(position.symbol, stocks)
  const tradeCost = entryPrice * position.shares
  // Fall back to entry price when we have no live quote (mark-to-cost).
  const markPrice = livePrice ?? entryPrice
  const currentCost = markPrice * position.shares
  const pnl = currentCost - tradeCost
  const pnlPct = tradeCost > 0 ? (pnl / tradeCost) * 100 : 0
  const up = pnl >= 0

  // Flag when price has crossed a managed level.
  const hitStop = livePrice !== null && livePrice <= position.stopLossPrice
  const hitTarget = livePrice !== null && livePrice >= position.cashOutPrice

  return (
    <li className="bt-row">
      <div className="bt-col-date">{position.openedDate ?? '—'}</div>

      <div className="bt-col-sym">
        <span className="bt-sym">{position.symbol}</span>
        {position.name && position.name !== position.symbol && (
          <span className="bt-name">{position.name}</span>
        )}
        <span className="bt-shares">{position.shares} sh · {position.orderType}</span>
      </div>

      <div className="bt-col-num">
        <span className="bt-cost">${formatCurrency(tradeCost)}</span>
        <span className="bt-sub">@ ${formatCurrency(entryPrice)}</span>
      </div>

      <div className="bt-col-num">
        <span className={`bt-cost ${up ? 'up' : 'down'}`}>${formatCurrency(currentCost)}</span>
        <span className={`bt-sub ${up ? 'up' : 'down'}`}>
          {up ? '+' : ''}{pnlPct.toFixed(2)}%
        </span>
      </div>

      <div className="bt-col-num">
        <span className={`bt-stop ${hitStop ? 'bt-hit' : ''}`}>
          ${formatCurrency(position.stopLossPrice)}
        </span>
      </div>

      <div className="bt-col-num">
        <span className={`bt-target ${hitTarget ? 'bt-hit' : ''}`}>
          ${formatCurrency(position.cashOutPrice)}
        </span>
      </div>

      <div className="bt-col-action">
        <button
          className="bt-close-btn"
          onClick={() => onClose(position.id)}
          aria-label={`Close ${position.symbol} position`}
          title="Close position"
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
}: {
  position: BacktestPosition
  stocks: Stock[]
  onCancel: (id: string) => void
}) {
  const limit = position.limitPrice ?? 0
  const livePrice = currentPriceFor(position.symbol, stocks)
  const reserved = limit * position.shares
  // Distance the live price still has to travel to trigger the fill.
  const distancePct = livePrice && limit > 0 ? ((livePrice - limit) / limit) * 100 : null
  const dir = position.zoneKind === 'supply' ? 'rises to' : 'drops to'

  return (
    <li className="bt-row bt-row-pending">
      <div className="bt-col-date">{position.placedDate}</div>

      <div className="bt-col-sym">
        <span className="bt-sym">{position.symbol}</span>
        {position.name && position.name !== position.symbol && (
          <span className="bt-name">{position.name}</span>
        )}
        <span className="bt-shares">{position.shares} sh · limit</span>
      </div>

      <div className="bt-col-num">
        <span className="bt-cost">${formatCurrency(reserved)}</span>
        <span className="bt-sub">@ ${formatCurrency(limit)}</span>
      </div>

      <div className="bt-col-num bt-col-wide">
        <span className="bt-pending-tag">Pending</span>
        <span className="bt-sub">
          fills when {dir} ${formatCurrency(limit)}
          {distancePct !== null && ` (${distancePct >= 0 ? '+' : ''}${distancePct.toFixed(1)}% away)`}
        </span>
      </div>

      <div className="bt-col-num">
        <span className="bt-stop">${formatCurrency(position.stopLossPrice)}</span>
      </div>

      <div className="bt-col-num">
        <span className="bt-target">${formatCurrency(position.cashOutPrice)}</span>
      </div>

      <div className="bt-col-action">
        <button
          className="bt-close-btn"
          onClick={() => onCancel(position.id)}
          aria-label={`Cancel ${position.symbol} pending order`}
          title="Cancel pending order"
        >
          ×
        </button>
      </div>
    </li>
  )
}

export function Backtest({ stocks, portfolio }: BacktestProps) {
  const { budget, positions, setBudget, closePosition, resetPortfolio } = portfolio
  const [budgetDraft, setBudgetDraft] = useState<string>(String(budget))

  const commitBudget = () => {
    const parsed = Number(budgetDraft.replace(/[^0-9.]/g, ''))
    if (Number.isFinite(parsed) && parsed >= 0) setBudget(parsed)
    else setBudgetDraft(String(budget))
  }

  const openPositions = useMemo(() => positions.filter((p) => p.status === 'open'), [positions])
  const pendingOrders = useMemo(() => positions.filter((p) => p.status === 'pending'), [positions])

  const { invested, marketValue, openPnl, reserved } = useMemo(() => {
    let invested = 0
    let marketValue = 0
    let reserved = 0
    for (const p of positions) {
      if (p.status === 'pending') {
        reserved += (p.limitPrice ?? 0) * p.shares
        continue
      }
      const entry = p.entryPrice ?? 0
      const tradeCost = entry * p.shares
      const mark = currentPriceFor(p.symbol, stocks) ?? entry
      invested += tradeCost
      marketValue += mark * p.shares
    }
    return { invested, marketValue, openPnl: marketValue - invested, reserved }
  }, [positions, stocks])

  const cash = budget - invested
  const pnlUp = openPnl >= 0

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
        </div>
      </div>

      {/* ── Pending orders (limit) ── */}
      {pendingOrders.length > 0 && (
        <div className="panel bt-table-panel">
          <div className="bt-table-head-row">
            <h3 className="bt-section-title">Pending Orders ({pendingOrders.length})</h3>
            <span className="bt-reserved">${formatCurrency(reserved)} reserved</span>
          </div>

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
              <PendingOrderRow key={p.id} position={p} stocks={stocks} onCancel={closePosition} />
            ))}
          </ul>
        </div>
      )}

      {/* ── Open positions ── */}
      <div className="panel bt-table-panel">
        <div className="bt-table-head-row">
          <h3 className="bt-section-title">Open Positions ({openPositions.length})</h3>
          {positions.length > 0 && (
            <button className="bt-reset-btn" onClick={resetPortfolio} title="Clear all positions and reset budget">
              Reset portfolio
            </button>
          )}
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
              No open positions yet. Open a ticker from Signals or your watchlist and hit
              <strong> Trade</strong> to add one here.
            </span>
          </div>
        ) : (
          <ul className="bt-list" aria-label="Open positions">
            {openPositions.map((p) => (
              <OpenPositionRow key={p.id} position={p} stocks={stocks} onClose={closePosition} />
            ))}
          </ul>
        )}
      </div>

      <div className="bt-footnote">
        Starting budget defaults to ${formatCurrency(DEFAULT_BUDGET)}. Stop-loss is set 8% below the
        fill price and the cash-out target at 2× that risk. Simulation only — not financial advice.
      </div>
    </div>
  )
}

/**
 * tradeMath: shared trade/portfolio calculations used by more than one view.
 *
 * Keeping these in one module means the Signals page, the Trade ticket, and the
 * Backtest page all agree on the numbers — the reward:risk a signal advertises
 * is exactly what the ticket will price, and the portfolio summary reconciles
 * across pages.
 */

import type { BasingZone } from '../hooks/useBasingZones'
import type { BacktestPosition, ClosedTrade } from '../hooks/useBacktestPortfolio'
import { DEFAULT_RISK_REWARD } from '../hooks/useBacktestPortfolio'
import type { Stock } from './stocks'
import type { DailyBar } from './tiingo'

/** Buffer beyond the distal line for the stop, in ATR units (mirrors the ticket). */
const STOP_BUFFER_ATR = 0.1
/** Stop-loss fallback distance from entry when no distal line applies (8%). */
const FALLBACK_STOP_PCT = 0.08

/**
 * Wilder-style ATR over the last `period` bars. Sizes the small stop buffer
 * beyond the distal line. Returns undefined without enough history.
 */
export function atrFromBars(bars: DailyBar[], period = 14): number | undefined {
  if (bars.length < period + 1) return undefined
  const recent = bars.slice(-(period + 1))
  let sum = 0
  for (let i = 1; i < recent.length; i++) {
    const b = recent[i]
    const prev = recent[i - 1]
    const tr = Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close))
    sum += tr
  }
  return sum / period
}

/**
 * The reward:risk a signal's zone would produce if traded at the proximal line.
 * Mirrors the Trade ticket preview / managedLevels so the ratio shown on the
 * Signals page matches what the order would actually get:
 *   • entry  = proximal line (the limit entry)
 *   • stop   = just beyond the distal line (± ATR buffer), else a flat % fallback
 *   • target = the zone's swingTarget when it sits on the profit side of entry,
 *              else the risk-multiple fallback (DEFAULT_RISK_REWARD)
 * Returns null when risk can't be measured (zero/degenerate levels).
 */
export function signalRewardRisk(zone: BasingZone, atr?: number): number | null {
  const entry = zone.proximal
  if (!Number.isFinite(entry) || entry <= 0) return null

  const isLong = zone.kind === 'demand'
  const buffer = atr && atr > 0 ? atr * STOP_BUFFER_ATR : 0
  const swing = zone.swingTarget

  let stop: number
  let target: number
  if (isLong) {
    stop = zone.distal < entry ? zone.distal - buffer : entry * (1 - FALLBACK_STOP_PCT)
    stop = Math.max(0, stop)
    const risk = entry - stop
    if (risk <= 0) return null
    target = swing != null && swing > entry ? swing : entry + risk * DEFAULT_RISK_REWARD
    return (target - entry) / risk
  }

  // Short (supply zone): stop above entry, target below.
  stop = zone.distal > entry ? zone.distal + buffer : entry * (1 + FALLBACK_STOP_PCT)
  const risk = stop - entry
  if (risk <= 0) return null
  target = swing != null && swing < entry && swing > 0 ? swing : Math.max(0, entry - risk * DEFAULT_RISK_REWARD)
  return (entry - target) / risk
}

/** Format an R:R ratio, e.g. "2.4:1", or a dash when unknown. */
export function formatRatio(rr: number | null): string {
  return rr != null ? `${rr.toFixed(1)}:1` : '—'
}

export interface PortfolioSummary {
  /** Uninvested cash (budget − invested). */
  cash: number
  /** Cost basis of open positions (entry × shares). */
  invested: number
  /** Mark-to-market value of open positions. */
  marketValue: number
  /** Unrealized P/L on open positions (side-adjusted). */
  openPnl: number
  /** Cash earmarked by resting limit orders (limitPrice × shares). */
  reserved: number
  /** Total account value = cash + market value of open positions. */
  totalValue: number
  /** Cash actually free to deploy = budget − invested − reserved. */
  available: number
  /** Banked gain/loss from closed trades (sum of realizedPnl). */
  realizedPnl: number
  /** Open P/L + realized P/L — lifetime performance. */
  totalPnl: number
  /** Number of open positions. */
  openCount: number
  /** Number of resting (pending) limit orders. */
  pendingCount: number
  /** Number of closed trades banked. */
  closedCount: number
}

/** Current market price for a symbol from the live feed, or null. */
function priceFor(symbol: string, stocks: Stock[]): number | null {
  const s = stocks.find((x) => x.symbol === symbol)
  return s ? s.price : null
}

/**
 * Roll positions + budget + live prices into the portfolio summary. Single
 * source of truth so the Signals summary and the Backtest header agree.
 */
export function computePortfolioSummary(
  budget: number,
  positions: BacktestPosition[],
  stocks: Stock[],
  closed: ClosedTrade[] = [],
): PortfolioSummary {
  let invested = 0
  let marketValue = 0
  let openPnl = 0
  let reserved = 0
  let openCount = 0
  let pendingCount = 0

  for (const p of positions) {
    if (p.status === 'pending') {
      reserved += (p.limitPrice ?? 0) * p.shares
      pendingCount++
      continue
    }
    const entry = p.entryPrice ?? 0
    const mark = priceFor(p.symbol, stocks) ?? entry
    invested += entry * p.shares
    marketValue += mark * p.shares
    // Short P/L is inverted: profit when the mark falls below entry.
    openPnl += p.side === 'short' ? (entry - mark) * p.shares : (mark - entry) * p.shares
    openCount++
  }

  const realizedPnl = closed.reduce((sum, t) => sum + t.realizedPnl, 0)
  const cash = budget - invested
  return {
    cash,
    invested,
    marketValue,
    openPnl,
    reserved,
    totalValue: cash + marketValue,
    available: budget - invested - reserved,
    realizedPnl,
    totalPnl: openPnl + realizedPnl,
    openCount,
    pendingCount,
    closedCount: closed.length,
  }
}

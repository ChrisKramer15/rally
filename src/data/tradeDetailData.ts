// Pure data-mapping helpers for the Backtest "Details" panel. Kept out of the
// TradeDetails component file so that module can export only components (React
// Fast Refresh requires component-only modules).

import { formatEasternDateTime } from './marketCalendar'
import type { BacktestPosition, ClosedTrade, TradeSide } from '../hooks/useBacktestPortfolio'

/**
 * A normalized view of a trade for the details panel + chart. Both a live
 * BacktestPosition and a banked ClosedTrade map into this shape so the panel
 * renders identically for pending / active / closed.
 */
export interface TradeDetailData {
  symbol: string
  side: TradeSide
  status: 'pending' | 'open' | 'closed'
  shares: number
  orderType?: 'market' | 'limit'
  /** Explosive-move (signal) origin date. */
  signalDate?: string
  proximalPrice?: number
  distalPrice?: number
  stopLossPrice?: number
  cashOutPrice?: number
  /** The resting limit price when the order was placed (limit orders). */
  limitPrice?: number
  /** The actual fill price. Null while pending. */
  entryPrice?: number | null
  /** The actual exit price (closed trades only). */
  exitPrice?: number
  placedDate?: string
  placedAt?: string
  openedDate?: string | null
  closedDate?: string
}

/** Map a live position (pending or active) into the normalized detail shape. */
export function positionToDetail(p: BacktestPosition): TradeDetailData {
  return {
    symbol: p.symbol,
    side: p.side,
    status: p.status,
    shares: p.shares,
    orderType: p.orderType,
    signalDate: p.signalDate,
    proximalPrice: p.proximalPrice,
    distalPrice: p.distalPrice,
    stopLossPrice: p.stopLossPrice,
    cashOutPrice: p.cashOutPrice,
    limitPrice: p.limitPrice,
    entryPrice: p.entryPrice,
    placedDate: p.placedDate,
    placedAt: p.placedAt,
    openedDate: p.openedDate,
  }
}

/** Map a banked closed trade into the normalized detail shape. */
export function closedToDetail(t: ClosedTrade): TradeDetailData {
  return {
    symbol: t.symbol,
    side: t.side,
    status: 'closed',
    shares: t.shares,
    orderType: t.orderType,
    signalDate: t.signalDate,
    proximalPrice: t.proximalPrice,
    distalPrice: t.distalPrice,
    stopLossPrice: t.stopLossPrice,
    cashOutPrice: t.cashOutPrice,
    limitPrice: t.limitPrice,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    placedDate: t.placedDate,
    placedAt: t.placedAt,
    openedDate: t.openedDate,
    closedDate: t.closedDate,
  }
}

/** Reward-to-risk from a detail's levels against the entry reference. */
export function detailRR(d: TradeDetailData): number | null {
  const ref = d.entryPrice ?? d.limitPrice ?? d.proximalPrice
  if (ref == null || !Number.isFinite(ref)) return null
  if (d.stopLossPrice == null || d.cashOutPrice == null) return null
  const risk = Math.abs(ref - d.stopLossPrice)
  const reward = Math.abs(d.cashOutPrice - ref)
  return risk > 0 ? reward / risk : null
}

export function formatDetailRR(d: TradeDetailData): string {
  const rr = detailRR(d)
  return rr != null ? `${rr.toFixed(1)}:1` : '—'
}

/** The placement moment in ET, falling back to the plain date for legacy rows. */
export function placedMoment(d: TradeDetailData): string {
  if (d.placedAt) {
    const dt = new Date(d.placedAt)
    if (!Number.isNaN(dt.getTime())) return formatEasternDateTime(dt)
  }
  return d.placedDate ?? '—'
}

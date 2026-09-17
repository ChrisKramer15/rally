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
  /** UTC ISO instant the pending limit filled to open (live engine). */
  filledAt?: string
  /** UTC ISO instant the position was filled/opened (closed trades). */
  openedAt?: string
  /** UTC ISO instant the position was exited/closed (closed trades). */
  closedAt?: string
  /** Why a closed trade ended: 'stop' | 'target' | 'invalidated'. */
  exitReason?: 'stop' | 'target' | 'invalidated'
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
    filledAt: p.filledAt,
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
    openedAt: t.openedAt,
    closedAt: t.closedAt,
    exitReason: t.exitReason,
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

/** Format a UTC ISO instant in ET, or null when absent/invalid. */
function instantEt(iso?: string | null): string | null {
  if (!iso) return null
  const dt = new Date(iso)
  return Number.isNaN(dt.getTime()) ? null : formatEasternDateTime(dt)
}

/** One event in a trade's lifecycle, in chronological order. */
export interface TradeLifecycleEvent {
  /** Milestone name, e.g. "Signal", "Limit placed", "Filled", "Closed". */
  label: string
  /** When it happened (date+time in ET when known, else the plain date). */
  when: string
  /** The relevant price at that milestone, or null when not applicable. */
  price: number | null
  /** A short clarifying note (e.g. the exit reason, the entry edge). */
  note?: string
  /** Whether this milestone actually happened yet (false = future/not reached). */
  reached: boolean
}

/**
 * Build the ordered transaction history for a trade: signal → limit placed →
 * filled → closed, each with its timestamp AND the price at that point, plus the
 * zone's proximal/distal edges as context. Pending/active trades show the
 * milestones reached so far; a closed trade shows the full lifecycle.
 *
 * Prices per milestone:
 *   • Signal   → the zone's proximal (entry edge) line — the signal's key level.
 *   • Placed   → the resting limit price (for a limit order).
 *   • Filled   → the actual entry (fill) price.
 *   • Closed   → the actual exit price.
 */
export function tradeLifecycle(d: TradeDetailData): TradeLifecycleEvent[] {
  const events: TradeLifecycleEvent[] = []

  // 1) Signal created (date only — signals are a daily concept).
  if (d.signalDate) {
    events.push({
      label: 'Signal',
      when: d.signalDate,
      price: d.proximalPrice ?? null,
      note: 'explosive move · proximal entry edge',
      reached: true,
    })
  }

  // 2) Limit order placed.
  const placedWhen = instantEt(d.placedAt) ?? d.placedDate ?? null
  if (placedWhen) {
    events.push({
      label: d.orderType === 'market' ? 'Market order placed' : 'Limit placed',
      when: placedWhen,
      price: d.orderType === 'market' ? (d.entryPrice ?? null) : (d.limitPrice ?? null),
      note: d.orderType === 'limit' ? 'resting at the limit price' : undefined,
      reached: true,
    })
  }

  // Invalidated: the pending limit would have filled on its first settler
  // evaluation (price had already traded through the zone), so it never opened.
  // Show a single terminal "Invalidated" milestone instead of Filled → Closed.
  if (d.exitReason === 'invalidated') {
    const invalidWhen = instantEt(d.closedAt) ?? d.closedDate ?? null
    events.push({
      label: 'Filled',
      when: '—',
      price: null,
      note: 'never filled — invalidated',
      reached: false,
    })
    events.push({
      label: 'Invalidated',
      when: invalidWhen ?? '—',
      price: d.limitPrice ?? d.proximalPrice ?? null,
      note: 'price had already traded through the zone on first evaluation',
      reached: true,
    })
    return events
  }

  // 3) Filled (pending → open). filledAt on a live position, openedAt on a
  //    closed one; fall back to the entry date when only the date is known.
  const filledWhen = instantEt(d.filledAt) ?? instantEt(d.openedAt) ?? d.openedDate ?? null
  const isFilled = d.status !== 'pending' && (d.entryPrice != null || filledWhen != null)
  events.push({
    label: 'Filled',
    when: filledWhen ?? '—',
    price: d.entryPrice ?? null,
    note: isFilled ? 'entered at fill price' : 'waiting for the limit',
    reached: isFilled,
  })

  // 4) Closed (exit at stop/target or manual close).
  if (d.status === 'closed') {
    const closedWhen = instantEt(d.closedAt) ?? d.closedDate ?? null
    events.push({
      label: 'Closed',
      when: closedWhen ?? '—',
      price: d.exitPrice ?? null,
      note: d.exitReason === 'stop' ? 'exited at stop' : d.exitReason === 'target' ? 'exited at target' : 'exited at stop / target',
      reached: true,
    })
  } else {
    events.push({
      label: 'Closed',
      when: '—',
      price: null,
      note: 'stop / target not yet hit',
      reached: false,
    })
  }

  return events
}

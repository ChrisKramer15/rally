import { useCallback, useEffect, useRef, useState } from 'react'
import type { ZoneGrade, ZoneKind } from './useBasingZones'
import type { ExplosiveGrade } from './useExplosiveMoves'
import {
  deleteTrade as deleteTradeRemote,
  deleteTrades as deleteTradesRemote,
  fetchPortfolio,
  insertClosedTrade as insertClosedTradeRemote,
  insertClosedTrades as insertClosedTradesRemote,
  insertTrade as insertTradeRemote,
  resetRemotePortfolio,
  saveBudget as saveBudgetRemote,
  upsertTrades as upsertTradesRemote,
} from '../data/supabaseTradesStore'

/**
 * useBacktestPortfolio
 *
 * A lightweight paper-trading portfolio used by the Backtest page. There's no
 * network/broker here — it's a simulation the user drives from the Trade button.
 *
 * Persistence: Supabase is the source of truth (durable + cross-device via the
 * `portfolio` / `trades` / `closed_trades` tables). localStorage remains a fast
 * initial-render cache and offline fallback — the same idiom useWatchlist uses.
 * Previously the whole portfolio lived in one localStorage key; once the daily-
 * bar cache filled the origin quota, new positions silently failed to persist
 * and vanished on refresh. Supabase removes that ceiling.
 *
 * Sides:
 *   • long  — profit when price rises. Stop below entry, target above.
 *   • short — profit when price falls. Stop above entry, target below.
 *
 * Order types:
 *   • market — fills immediately at the current price (status 'open').
 *   • limit  — a resting order at a target price (status 'pending'). It fills
 *              when the session trades through the limit: a long fills when the
 *              day's LOW ≤ limit (buying the dip into demand); a short fills
 *              when the day's HIGH ≥ limit (selling the rally into supply). On
 *              fill the position flips to 'open' at the limit price and its
 *              managed levels are (re)derived from that fill.
 *
 * Managed levels (supply/demand convention):
 *   • stop-loss — anchored just beyond the DISTAL line (the zone's far edge):
 *                 long  → distal − 0.1×ATR   (below the demand base low)
 *                 short → distal + 0.1×ATR   (above the supply base high)
 *                 When no zone/distal is available, falls back to a flat % of
 *                 entry (DEFAULT_STOP_LOSS_PCT).
 *   • cash-out  — the top of the prior trend leg the breakout produced (the
 *                 swing high for a long, the swing low for a short). This is
 *                 the "prior structure" profit target. When no swing level is
 *                 available or it sits on the wrong side of entry (e.g. the
 *                 user flipped the side), it falls back to a risk-multiple
 *                 target: risk = |entry − stop|; target = entry ± risk ×
 *                 riskReward (default DEFAULT_RISK_REWARD).
 */

const STORAGE_KEY = 'rally.backtest.v1'

/** Default starting portfolio budget. */
export const DEFAULT_BUDGET = 25_000

/** Stop-loss fallback distance from entry when no distal line is known (8%). */
const DEFAULT_STOP_LOSS_PCT = 0.08
/** Default reward-to-risk multiple when the caller doesn't specify one (2:1). */
export const DEFAULT_RISK_REWARD = 2
/** Buffer beyond the distal line for the stop, in ATR units. */
const DISTAL_STOP_ATR_BUFFER = 0.1

export type OrderType = 'market' | 'limit'
export type PositionStatus = 'open' | 'pending'
export type TradeSide = 'long' | 'short'

export interface BacktestPosition {
  /** Stable id for React keys / removal. */
  id: string
  /** Ticker symbol. */
  symbol: string
  /** Company name, if known. */
  name?: string
  /** Long (buy) or short (sell). Drives stop/target direction + fill trigger. */
  side: TradeSide
  /** 'open' = filled and live; 'pending' = a resting limit order not yet hit. */
  status: PositionStatus
  /** How the order was placed. */
  orderType: OrderType
  /** ISO date (YYYY-MM-DD) the order was placed. */
  placedDate: string
  /** ISO date the position was filled/opened. Null while pending. */
  openedDate: string | null
  /** Fill price per share. Null while pending (not yet filled). */
  entryPrice: number | null
  /**
   * Limit (target) price for a limit order — the proximal line the trade waits
   * for. Undefined for market orders.
   */
  limitPrice?: number
  /**
   * The zone's distal line, captured at order time. Used to anchor the stop
   * just beyond it. Undefined when the symbol had no detected zone.
   */
  distalPrice?: number
  /** ATR at order time, for sizing the stop buffer beyond the distal line. */
  atr?: number
  /**
   * ── Signal provenance ──────────────────────────────────────────────────
   * The basing zone this trade was placed from, captured at order time so the
   * Backtest screen can show which signal it came from. All nullable/optional:
   * a trade placed with no detected zone (or one migrated from an older save)
   * simply has none of these.
   */
  /**
   * Zone direction / signal type: 'demand' (explosive up move → long bias) or
   * 'supply' (down move → short bias). Stored independently of `side` so the
   * original signal direction survives even if the user flipped the side in
   * the ticket.
   */
  zoneKind?: ZoneKind
  /** Zone quality grade at order time ('A+' | 'good' | 'weak'). */
  zoneGrade?: ZoneGrade
  /**
   * Signal strength — the explosive-candle grade ('A+' | 'strong') of the move
   * that anchored the zone, captured at order time. This is the same "signal
   * strength" the Signals scan shows. Distinct from `zoneGrade` (base quality).
   */
  signalStrength?: ExplosiveGrade
  /**
   * The zone's proximal line (the entry edge) captured at order time. Unlike
   * `limitPrice` this is recorded for market orders too, so the signal's entry
   * line is always available for display. Undefined when no zone was detected.
   */
  proximalPrice?: number
  /** The zone's explosive move-away date (YYYY-MM-DD) — the signal's origin. */
  signalDate?: string
  /**
   * Top of the prior trend leg (swing high for a long, swing low for a short),
   * captured at order time. Anchors the cash-out target. Undefined when the
   * symbol had no measurable leg after its zone.
   */
  swingTarget?: number
  /**
   * Reward-to-risk multiple used only for the fallback target when no swing
   * level applies. Retained for backward compatibility with saved positions.
   */
  riskReward: number
  /** Number of shares. */
  shares: number
  /** Stop-loss price (risk floor/ceiling). Derived on fill. */
  stopLossPrice: number
  /** Cash-out / target price (profit take). Derived on fill. */
  cashOutPrice: number
}

/**
 * A position that has been closed out. Banked so realized P/L survives beyond
 * the life of the open position (which is removed from `positions` on close).
 */
export interface ClosedTrade {
  id: string
  symbol: string
  name?: string
  side: TradeSide
  shares: number
  /** Fill price the position was entered at. */
  entryPrice: number
  /** Price the position was closed at (market price at close time). */
  exitPrice: number
  /** Realized gain/loss in dollars, side-adjusted. */
  realizedPnl: number
  openedDate: string | null
  closedDate: string
  /**
   * ── Signal provenance (carried over from the position at close) ──────────
   * Mirrors the same fields on BacktestPosition so a reviewer can correlate
   * outcomes with the signal a trade came from. All nullable: trades closed
   * before this was tracked (or placed with no detected zone) have none.
   */
  /** Zone direction / signal type: 'demand' (long bias) | 'supply' (short). */
  zoneKind?: ZoneKind
  /** Basing-zone quality grade at order time ('A+' | 'good' | 'weak'). */
  zoneGrade?: ZoneGrade
  /** Explosive-move (signal) strength ('A+' | 'strong'). */
  signalStrength?: ExplosiveGrade
  /** The zone's proximal (entry) line captured at order time. */
  proximalPrice?: number
  /** The zone's explosive move-away date (YYYY-MM-DD). */
  signalDate?: string
}

interface PersistShape {
  budget: number
  positions: BacktestPosition[]
  /** Banked closed trades — the source of realized P/L. */
  closed: ClosedTrade[]
}

function loadState(): PersistShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistShape>
      const budget = typeof parsed.budget === 'number' && parsed.budget >= 0 ? parsed.budget : DEFAULT_BUDGET
      const positions = Array.isArray(parsed.positions)
        ? (parsed.positions as BacktestPosition[]).map(migratePosition)
        : []
      // `closed` was added later; default to empty for states saved before it.
      const closed = Array.isArray(parsed.closed) ? (parsed.closed as ClosedTrade[]) : []
      return { budget, positions, closed }
    }
  } catch {
    // Corrupt/unavailable storage falls back to defaults.
  }
  return { budget: DEFAULT_BUDGET, positions: [], closed: [] }
}

/**
 * Backfill fields for positions saved by earlier versions (no side/status/
 * orderType/riskReward). Treats them as filled long market orders.
 */
function migratePosition(
  p: BacktestPosition & { openedDate?: string | null; zoneKind?: string },
): BacktestPosition {
  const migrated: BacktestPosition = { ...p }
  if (!migrated.side) migrated.side = 'long'
  if (!migrated.riskReward) migrated.riskReward = DEFAULT_RISK_REWARD
  if (!migrated.status || !migrated.orderType) {
    const legacyOpened = typeof p.openedDate === 'string' ? p.openedDate : todayISO()
    migrated.status = 'open'
    migrated.orderType = 'market'
    migrated.placedDate = legacyOpened
    migrated.openedDate = legacyOpened
    migrated.entryPrice = p.entryPrice ?? 0
  }
  return migrated
}

function persist(state: PersistShape): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Best-effort; in-memory state still updates.
  }
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Derive stop-loss + cash-out from a fill price, honoring side, the distal line,
 * ATR, and the chosen reward-to-risk ratio.
 *
 * Stop: anchored just beyond the distal line when we have one that sits on the
 * correct (protective) side of entry — below entry for a long, above for a
 * short. Otherwise falls back to a flat % of entry. Target: entry moved by the
 * risk distance × riskReward in the profit direction.
 */
function managedLevels(
  side: TradeSide,
  entry: number,
  opts: { distal?: number; atr?: number; swingTarget?: number; riskReward: number },
): { stopLossPrice: number; cashOutPrice: number } {
  const { distal, atr, swingTarget, riskReward } = opts
  const buffer = atr && atr > 0 ? atr * DISTAL_STOP_ATR_BUFFER : 0

  let stopLossPrice: number
  if (side === 'long') {
    // Stop wants to be below entry. Use the distal line if it's below entry.
    if (distal !== undefined && distal < entry) {
      stopLossPrice = distal - buffer
    } else {
      stopLossPrice = entry * (1 - DEFAULT_STOP_LOSS_PCT)
    }
    stopLossPrice = Math.max(0, stopLossPrice)
    const risk = entry - stopLossPrice
    // Target the top of the prior rally leg when it sits above entry; otherwise
    // fall back to the risk-multiple target (handles side overrides / no zone).
    const cashOutPrice =
      swingTarget !== undefined && swingTarget > entry
        ? swingTarget
        : entry + risk * riskReward
    return { stopLossPrice, cashOutPrice }
  }

  // Short: stop wants to be above entry. Use the distal line if it's above entry.
  if (distal !== undefined && distal > entry) {
    stopLossPrice = distal + buffer
  } else {
    stopLossPrice = entry * (1 + DEFAULT_STOP_LOSS_PCT)
  }
  const risk = stopLossPrice - entry
  // Target the bottom of the prior drop leg when it sits below entry; otherwise
  // fall back to the risk-multiple target.
  const cashOutPrice =
    swingTarget !== undefined && swingTarget < entry && swingTarget > 0
      ? swingTarget
      : Math.max(0, entry - risk * riskReward)
  return { stopLossPrice, cashOutPrice }
}

export interface OpenTradeInput {
  symbol: string
  name?: string
  /** Current market price. Used as the entry for market orders. */
  price: number
  /** Number of shares to trade. */
  shares: number
  /** Long (buy) or short (sell). */
  side: TradeSide
  /** 'market' fills now; 'limit' rests until price hits limitPrice. */
  orderType: OrderType
  /** Required for limit orders: the price the order waits for (proximal line). */
  limitPrice?: number
  /** The zone's distal line, for anchoring the stop just beyond it. */
  distal?: number
  /** ATR at order time, for the distal-stop buffer. */
  atr?: number
  /** Top of the prior trend leg — anchors the cash-out target. */
  swingTarget?: number
  /** Optional fallback reward-to-risk multiple (defaults to DEFAULT_RISK_REWARD). */
  riskReward?: number
  /** Signal provenance — the basing zone this trade was placed from. */
  zoneKind?: ZoneKind
  /** Zone quality grade at order time. */
  zoneGrade?: ZoneGrade
  /** Signal strength — explosive-candle grade ('A+' | 'strong'). */
  signalStrength?: ExplosiveGrade
  /** The zone's proximal (entry) line, recorded for market orders too. */
  proximal?: number
  /** The zone's explosive move-away date (YYYY-MM-DD). */
  signalDate?: string
}

export function useBacktestPortfolio() {
  const [{ budget, positions, closed }, setState] = useState<PersistShape>(loadState)

  // Guards the initial Supabase hydrate from clobbering a fresh local edit the
  // user made before the async read returned (mirrors useWatchlist).
  const editedRef = useRef(false)

  // Mirror every state change into the localStorage cache (fast next-render).
  useEffect(() => {
    persist({ budget, positions, closed })
  }, [budget, positions, closed])

  // Hydrate from Supabase once on mount. Supabase is the source of truth; the
  // local cache just seeds the first paint. Skip if the user already edited.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const remote = await fetchPortfolio()
      if (cancelled || editedRef.current) return
      // Nothing to adopt when Supabase is off/empty — keep the local state.
      if (remote.budget === null && remote.positions.length === 0 && remote.closed.length === 0) {
        return
      }
      setState((prev) => {
        const next: PersistShape = {
          budget: remote.budget ?? prev.budget,
          positions: remote.positions,
          closed: remote.closed,
        }
        persist(next)
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const setBudget = useCallback((next: number) => {
    if (!(Number.isFinite(next) && next >= 0)) return
    editedRef.current = true
    setState((s) => ({ ...s, budget: next }))
    void saveBudgetRemote(next)
  }, [])

  /**
   * Place a trade for a symbol. A market order opens immediately at the current
   * price; a limit order is stored as 'pending' until fillPending executes it.
   * Returns the id of the created (or existing) position; if a position for the
   * symbol already exists it's left untouched and its id returned.
   */
  const openTrade = useCallback((input: OpenTradeInput): string => {
    let resultId = ''
    // The position actually created this call (null when a dup/invalid no-op),
    // captured so we can persist just that new row to Supabase after setState.
    let created: BacktestPosition | null = null
    setState((s) => {
      const existing = s.positions.find((p) => p.symbol === input.symbol)
      if (existing) {
        resultId = existing.id
        return s
      }
      editedRef.current = true
      const shares = Math.max(1, Math.floor(input.shares))
      const riskReward = input.riskReward ?? DEFAULT_RISK_REWARD
      const today = todayISO()

      if (input.orderType === 'limit') {
        const limitPrice = input.limitPrice
        if (!Number.isFinite(limitPrice) || (limitPrice as number) <= 0) return s
        const levels = managedLevels(input.side, limitPrice as number, {
          distal: input.distal,
          atr: input.atr,
          swingTarget: input.swingTarget,
          riskReward,
        })
        const position: BacktestPosition = {
          id: makeId(),
          symbol: input.symbol,
          name: input.name,
          side: input.side,
          status: 'pending',
          orderType: 'limit',
          placedDate: today,
          openedDate: null,
          entryPrice: null,
          limitPrice: limitPrice as number,
          distalPrice: input.distal,
          atr: input.atr,
          swingTarget: input.swingTarget,
          zoneKind: input.zoneKind,
          zoneGrade: input.zoneGrade,
          signalStrength: input.signalStrength,
          proximalPrice: input.proximal,
          signalDate: input.signalDate,
          riskReward,
          shares,
          ...levels,
        }
        resultId = position.id
        created = position
        return { ...s, positions: [position, ...s.positions] }
      }

      // Market order — fill now at the current price.
      const price = input.price
      if (!Number.isFinite(price) || price <= 0) return s
      const levels = managedLevels(input.side, price, {
        distal: input.distal,
        atr: input.atr,
        swingTarget: input.swingTarget,
        riskReward,
      })
      const position: BacktestPosition = {
        id: makeId(),
        symbol: input.symbol,
        name: input.name,
        side: input.side,
        status: 'open',
        orderType: 'market',
        placedDate: today,
        openedDate: today,
        entryPrice: price,
        distalPrice: input.distal,
        atr: input.atr,
        swingTarget: input.swingTarget,
        zoneKind: input.zoneKind,
        zoneGrade: input.zoneGrade,
        signalStrength: input.signalStrength,
        proximalPrice: input.proximal,
        signalDate: input.signalDate,
        riskReward,
        shares,
        ...levels,
      }
      resultId = position.id
      created = position
      return { ...s, positions: [position, ...s.positions] }
    })
    // Persist the new position to Supabase (fire-and-forget). Only when one was
    // actually created — a dup symbol or invalid input is a no-op.
    if (created) void insertTradeRemote(created)
    return resultId
  }, [])

  /**
   * Fill any pending limit orders whose trigger price has been reached, using a
   * map of symbol → the latest daily bar's low/high range. The fill tests the
   * intraday extreme (not just the close), so an order fills the moment price
   * *traded through* the limit during the session:
   *   • long  — fills when the day's LOW ≤ limit (price dipped to the line)
   *   • short — fills when the day's HIGH ≥ limit (price rose to the line)
   * Filled orders flip to 'open' at the limit price with freshly derived
   * stop-loss / cash-out levels (anchored to the stored distal line + ATR).
   *
   * Called by the app as live data updates. It's a no-op (returns the same
   * state reference) when nothing fills, so it won't cause needless re-renders.
   */
  const fillPending = useCallback((rangeBySymbol: Map<string, { low: number; high: number }>) => {
    // Positions that flipped pending -> open this call, to upsert to Supabase.
    const filled: BacktestPosition[] = []
    setState((s) => {
      let changed = false
      const next = s.positions.map((p) => {
        if (p.status !== 'pending' || p.limitPrice === undefined) return p
        const range = rangeBySymbol.get(p.symbol)
        if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high)) return p
        const triggered = p.side === 'short'
          ? range.high >= p.limitPrice
          : range.low <= p.limitPrice
        if (!triggered) return p
        changed = true
        const levels = managedLevels(p.side, p.limitPrice, {
          distal: p.distalPrice,
          atr: p.atr,
          swingTarget: p.swingTarget,
          riskReward: p.riskReward,
        })
        const opened: BacktestPosition = {
          ...p,
          status: 'open' as const,
          openedDate: todayISO(),
          entryPrice: p.limitPrice,
          ...levels,
        }
        filled.push(opened)
        return opened
      })
      return changed ? { ...s, positions: next } : s
    })
    // A fill is a data change even though the user didn't type anything: guard
    // the hydrate from overwriting it, and push the updated rows to Supabase.
    if (filled.length > 0) {
      editedRef.current = true
      void upsertTradesRemote(filled)
    }
  }, [])

  /**
   * Settle OPEN positions against their resting exit orders, the way a real
   * broker would: a long fills its cash-out when the day's HIGH reaches the
   * target and its stop when the day's LOW reaches the stop (inverted for a
   * short). The exit is booked at the LEVEL that was hit (cash-out price or
   * stop price), not the current market price — mirroring an auto-set
   * limit/stop order. Realized P/L is banked and compounded into budget.
   *
   * If both the target and the stop fall inside the same day's range we can't
   * know the intraday order from a daily bar, so we conservatively assume the
   * STOP hit first (worst case) — never book the optimistic outcome.
   *
   * No-op (same state reference) when nothing settles, so it won't churn.
   */
  const settleOpen = useCallback((rangeBySymbol: Map<string, { low: number; high: number }>) => {
    // Captured for the Supabase sync after setState: the banked trades to
    // insert, their now-removed position ids to delete, and the new budget.
    let bankedOut: ClosedTrade[] = []
    let newBudget: number | null = null
    setState((s) => {
      let budget = s.budget
      const banked: ClosedTrade[] = []
      const remaining: BacktestPosition[] = []

      for (const p of s.positions) {
        if (p.status !== 'open' || p.entryPrice == null) {
          remaining.push(p)
          continue
        }
        const range = rangeBySymbol.get(p.symbol)
        if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high)) {
          remaining.push(p)
          continue
        }

        const isShort = p.side === 'short'
        const hitTarget = isShort ? range.low <= p.cashOutPrice : range.high >= p.cashOutPrice
        const hitStop = isShort ? range.high >= p.stopLossPrice : range.low <= p.stopLossPrice

        if (!hitTarget && !hitStop) {
          remaining.push(p)
          continue
        }

        // Both in-range on a daily bar: assume the stop filled first (worst case).
        const exitPrice = hitStop ? p.stopLossPrice : p.cashOutPrice
        const entry = p.entryPrice
        const realizedPnl = isShort
          ? (entry - exitPrice) * p.shares
          : (exitPrice - entry) * p.shares

        budget += realizedPnl
        banked.push({
          id: p.id,
          symbol: p.symbol,
          name: p.name,
          side: p.side,
          shares: p.shares,
          entryPrice: entry,
          exitPrice,
          realizedPnl,
          openedDate: p.openedDate,
          closedDate: todayISO(),
          zoneKind: p.zoneKind,
          zoneGrade: p.zoneGrade,
          signalStrength: p.signalStrength,
          proximalPrice: p.proximalPrice,
          signalDate: p.signalDate,
        })
      }

      if (banked.length === 0) return s
      bankedOut = banked
      newBudget = budget
      return { ...s, budget, positions: remaining, closed: [...banked, ...s.closed] }
    })
    // Sync the settlement to Supabase: bank the closed rows, remove the settled
    // position rows, and persist the compounded budget. Guard the hydrate too.
    if (bankedOut.length > 0) {
      editedRef.current = true
      void insertClosedTradesRemote(bankedOut)
      void deleteTradesRemote(bankedOut.map((t) => t.id))
      if (newBudget !== null) void saveBudgetRemote(newBudget)
    }
  }, [])

  /**
   * Close a position. If it was OPEN (filled), bank a ClosedTrade with realized
   * P/L computed against `exitPrice` (the current market price, passed in by the
   * caller since the hook has no live feed). Closing a still-PENDING order is a
   * cancellation — it's simply removed, with no realized P/L.
   */
  const closePosition = useCallback((id: string, exitPrice?: number) => {
    // Captured for the Supabase sync after setState.
    let removedId: string | null = null
    let bankedTrade: ClosedTrade | null = null
    let newBudget: number | null = null
    setState((s) => {
      const pos = s.positions.find((p) => p.id === id)
      if (!pos) return s

      editedRef.current = true
      removedId = id
      const positions = s.positions.filter((p) => p.id !== id)

      // Pending (unfilled) order, or no usable exit price -> cancel, don't bank.
      const entry = pos.entryPrice
      if (pos.status !== 'open' || entry == null || exitPrice == null || !Number.isFinite(exitPrice)) {
        return { ...s, positions }
      }

      const realizedPnl =
        pos.side === 'short'
          ? (entry - exitPrice) * pos.shares
          : (exitPrice - entry) * pos.shares

      const trade: ClosedTrade = {
        id: pos.id,
        symbol: pos.symbol,
        name: pos.name,
        side: pos.side,
        shares: pos.shares,
        entryPrice: entry,
        exitPrice,
        realizedPnl,
        openedDate: pos.openedDate,
        closedDate: todayISO(),
        zoneKind: pos.zoneKind,
        zoneGrade: pos.zoneGrade,
        signalStrength: pos.signalStrength,
        proximalPrice: pos.proximalPrice,
        signalDate: pos.signalDate,
      }
      // Realized P/L compounds into the cash base (true-portfolio behavior):
      // a banked gain grows what you can deploy next, a loss shrinks it.
      bankedTrade = trade
      newBudget = s.budget + realizedPnl
      return { ...s, budget: newBudget, positions, closed: [trade, ...s.closed] }
    })
    // Sync to Supabase. Always remove the position row; if it was an open
    // position we also bank the closed trade and persist the new budget.
    if (removedId) {
      void deleteTradeRemote(removedId)
      if (bankedTrade) {
        void insertClosedTradeRemote(bankedTrade)
        if (newBudget !== null) void saveBudgetRemote(newBudget)
      }
    }
  }, [])

  const resetPortfolio = useCallback(() => {
    editedRef.current = true
    setState({ budget: DEFAULT_BUDGET, positions: [], closed: [] })
    void resetRemotePortfolio(DEFAULT_BUDGET)
  }, [])

  return { budget, positions, closed, setBudget, openTrade, fillPending, settleOpen, closePosition, resetPortfolio }
}

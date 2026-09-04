import { useCallback, useEffect, useState } from 'react'

/**
 * useBacktestPortfolio
 *
 * A lightweight, client-only paper-trading portfolio used by the Backtest page.
 * State is persisted to localStorage so positions survive reloads. There's no
 * network/broker here — it's a simulation the user drives from the Trade button.
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

interface PersistShape {
  budget: number
  positions: BacktestPosition[]
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
      return { budget, positions }
    }
  } catch {
    // Corrupt/unavailable storage falls back to defaults.
  }
  return { budget: DEFAULT_BUDGET, positions: [] }
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
}

export function useBacktestPortfolio() {
  const [{ budget, positions }, setState] = useState<PersistShape>(loadState)

  useEffect(() => {
    persist({ budget, positions })
  }, [budget, positions])

  const setBudget = useCallback((next: number) => {
    setState((s) => ({ ...s, budget: Number.isFinite(next) && next >= 0 ? next : s.budget }))
  }, [])

  /**
   * Place a trade for a symbol. A market order opens immediately at the current
   * price; a limit order is stored as 'pending' until fillPending executes it.
   * Returns the id of the created (or existing) position; if a position for the
   * symbol already exists it's left untouched and its id returned.
   */
  const openTrade = useCallback((input: OpenTradeInput): string => {
    let resultId = ''
    setState((s) => {
      const existing = s.positions.find((p) => p.symbol === input.symbol)
      if (existing) {
        resultId = existing.id
        return s
      }
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
          riskReward,
          shares,
          ...levels,
        }
        resultId = position.id
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
        riskReward,
        shares,
        ...levels,
      }
      resultId = position.id
      return { ...s, positions: [position, ...s.positions] }
    })
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
        return {
          ...p,
          status: 'open' as const,
          openedDate: todayISO(),
          entryPrice: p.limitPrice,
          ...levels,
        }
      })
      return changed ? { ...s, positions: next } : s
    })
  }, [])

  const closePosition = useCallback((id: string) => {
    setState((s) => ({ ...s, positions: s.positions.filter((p) => p.id !== id) }))
  }, [])

  const resetPortfolio = useCallback(() => {
    setState({ budget: DEFAULT_BUDGET, positions: [] })
  }, [])

  return { budget, positions, setBudget, openTrade, fillPending, closePosition, resetPortfolio }
}

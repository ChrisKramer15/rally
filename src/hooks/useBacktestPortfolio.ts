import { useCallback, useEffect, useState } from 'react'

/**
 * useBacktestPortfolio
 *
 * A lightweight, client-only paper-trading portfolio used by the Backtest page.
 * State is persisted to localStorage so positions survive reloads. There's no
 * network/broker here — it's a simulation the user drives from the Trade button.
 *
 * Order types:
 *   • market — fills immediately at the current price (status 'open').
 *   • limit  — a resting order at a target price (status 'pending'). It fills
 *              when the live price reaches the limit; for a demand zone that's
 *              price dipping to/below the limit, for a supply zone price rising
 *              to/above it. On fill the position flips to 'open' at the limit
 *              price and its managed levels are (re)derived from that fill.
 *
 * From the entry (fill) price we derive two managed levels:
 *   • stop-loss   — entry × (1 − stopLossPct)      (risk floor)
 *   • cash-out    — entry × (1 + stopLossPct × RR) (profit target)
 *
 * "Trade cost"    = entry price × shares       (what the position cost to open)
 * "Current cost"  = live price × shares        (what it's worth right now)
 */

const STORAGE_KEY = 'rally.backtest.v1'

/** Default starting portfolio budget. */
export const DEFAULT_BUDGET = 25_000

/** Default stop-loss distance below entry (8%). */
const DEFAULT_STOP_LOSS_PCT = 0.08
/** Default reward-to-risk multiple used to derive the cash-out target (2R). */
const DEFAULT_RISK_REWARD = 2

export type OrderType = 'market' | 'limit'
export type PositionStatus = 'open' | 'pending'
/** Which side of the market a resting limit order waits on. */
export type ZoneKind = 'demand' | 'supply'

export interface BacktestPosition {
  /** Stable id for React keys / removal. */
  id: string
  /** Ticker symbol. */
  symbol: string
  /** Company name, if known. */
  name?: string
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
   * For a pending limit order: the side of the zone, which decides the trigger
   * direction. 'demand' fills when price ≤ limit; 'supply' when price ≥ limit.
   */
  zoneKind?: ZoneKind
  /** Number of shares. */
  shares: number
  /** Stop-loss price (risk floor). Derived on fill. */
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
 * Backfill fields for positions saved by earlier versions (which had no status,
 * orderType, placedDate, or nullable entry/openedDate). Treats them as filled
 * market orders.
 */
function migratePosition(p: BacktestPosition & { openedDate?: string | null }): BacktestPosition {
  if (p.status && p.orderType) return p
  const legacyOpened = typeof p.openedDate === 'string' ? p.openedDate : todayISO()
  return {
    ...p,
    status: 'open',
    orderType: 'market',
    placedDate: legacyOpened,
    openedDate: legacyOpened,
    entryPrice: p.entryPrice ?? 0,
  }
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

/** Derive stop-loss + cash-out levels from a fill price. */
function managedLevels(entry: number, stopLossPct: number, riskReward: number) {
  return {
    stopLossPrice: entry * (1 - stopLossPct),
    cashOutPrice: entry * (1 + stopLossPct * riskReward),
  }
}

export interface OpenTradeInput {
  symbol: string
  name?: string
  /** Current market price. Used as the entry for market orders. */
  price: number
  /** Number of shares to trade. */
  shares: number
  /** 'market' fills now; 'limit' rests until price hits limitPrice. */
  orderType: OrderType
  /** Required for limit orders: the price the order waits for (proximal line). */
  limitPrice?: number
  /** For limit orders: which side of the zone drives the trigger direction. */
  zoneKind?: ZoneKind
  /** Optional stop-loss distance below entry (fraction, e.g. 0.08 = 8%). */
  stopLossPct?: number
  /** Optional reward-to-risk multiple for the cash-out target. */
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
      const stopLossPct = input.stopLossPct ?? DEFAULT_STOP_LOSS_PCT
      const riskReward = input.riskReward ?? DEFAULT_RISK_REWARD
      const today = todayISO()

      if (input.orderType === 'limit') {
        const limitPrice = input.limitPrice
        if (!Number.isFinite(limitPrice) || (limitPrice as number) <= 0) return s
        const levels = managedLevels(limitPrice as number, stopLossPct, riskReward)
        const position: BacktestPosition = {
          id: makeId(),
          symbol: input.symbol,
          name: input.name,
          status: 'pending',
          orderType: 'limit',
          placedDate: today,
          openedDate: null,
          entryPrice: null,
          limitPrice: limitPrice as number,
          zoneKind: input.zoneKind ?? 'demand',
          shares,
          ...levels,
        }
        resultId = position.id
        return { ...s, positions: [position, ...s.positions] }
      }

      // Market order — fill now at the current price.
      const price = input.price
      if (!Number.isFinite(price) || price <= 0) return s
      const levels = managedLevels(price, stopLossPct, riskReward)
      const position: BacktestPosition = {
        id: makeId(),
        symbol: input.symbol,
        name: input.name,
        status: 'open',
        orderType: 'market',
        placedDate: today,
        openedDate: today,
        entryPrice: price,
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
   *   • demand — fills when the day's LOW ≤ limit (price dipped to the line)
   *   • supply — fills when the day's HIGH ≥ limit (price rose to the line)
   * Filled orders flip to 'open' at the limit price with freshly derived
   * stop-loss / cash-out levels.
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
        const triggered = p.zoneKind === 'supply'
          ? range.high >= p.limitPrice
          : range.low <= p.limitPrice
        if (!triggered) return p
        changed = true
        const levels = managedLevels(p.limitPrice, DEFAULT_STOP_LOSS_PCT, DEFAULT_RISK_REWARD)
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

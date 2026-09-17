import { useCallback, useEffect, useRef, useState } from 'react'
import { type ZoneGrade, type ZoneKind } from './useBasingZones'
import type { AnyExplosiveGrade } from './useExplosiveMoves'
import { todayEasternISO } from '../data/marketCalendar'
import {
  deleteTrade as deleteTradeRemote,
  fetchPortfolio,
  insertClosedTrade as insertClosedTradeRemote,
  insertTrade as insertTradeRemote,
  onTradeWriteError,
  resetRemotePortfolio,
  saveBudget as saveBudgetRemote,
  subscribeToTradeUpdates,
  type TradeWriteError,
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

/**
 * Maximum number of concurrent positions (open + pending COMBINED). Capped to
 * match the Finnhub live-quote ceiling: we can only pull real-time data for
 * this many tickers, and every open/pending position wants a live mark, so
 * allowing more positions than we can quote would leave some marked to a stale
 * daily close. Placing a new order while at the cap is refused.
 */
export const MAX_POSITIONS = 25

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
  /** ISO date (YYYY-MM-DD, ET) the order was placed. */
  placedDate: string
  /**
   * Moment-in-time anchor: the exact instant the order was placed, as a UTC ISO
   * timestamp (displayed in ET). This is the "line in the sand" that prevents a
   * limit from instantly activating — a resting order can only fill on a session
   * STRICTLY AFTER this instant's ET calendar date, never on an already-complete
   * bar. Optional for backward compatibility with pre-existing saved rows.
   */
  placedAt?: string
  /** ISO date the position was filled/opened. Null while pending. */
  openedDate: string | null
  /**
   * UTC ISO instant the pending limit filled to open (live engine). Displayed
   * in ET. Null while pending, and null for legacy fills done under the old
   * daily-bar simulation (which had no intraday time).
   */
  filledAt?: string
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
   * Signal strength — the explosive-candle grade (A/B/C/D, or a legacy
   * 'A+'/'strong' on pre-migration trades) of the move that anchored the zone,
   * captured at order time. This is the same "signal strength" the Signals scan
   * shows. Distinct from `zoneGrade` (base quality).
   */
  signalStrength?: AnyExplosiveGrade
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
  /** UTC ISO instant the position was filled/opened. Null for legacy trades. */
  openedAt?: string
  /** UTC ISO instant the position was exited/closed. Null for legacy trades. */
  closedAt?: string
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
  /** Explosive-move (signal) strength (A/B/C/D, or legacy 'A+'/'strong'). */
  signalStrength?: AnyExplosiveGrade
  /** The zone's proximal (entry) line captured at order time. */
  proximalPrice?: number
  /** The zone's explosive move-away date (YYYY-MM-DD). */
  signalDate?: string
  /**
   * ── Trade-level detail (carried from the position at close) ──────────────
   * These let the Backtest "Details" panel show the full lifecycle for a closed
   * trade — the levels it was managed against and its placement timeline — the
   * same way it does for an open/pending position. All nullable for trades
   * banked before this was tracked.
   */
  /** How the order was placed ('market' | 'limit'). */
  orderType?: OrderType
  /** The resting limit (proximal) price at placement, for limit orders. */
  limitPrice?: number
  /** The zone's distal line captured at order time (anchors the stop). */
  distalPrice?: number
  /** The managed stop-loss level the trade was exited against. */
  stopLossPrice?: number
  /** The managed cash-out (target) level the trade was exited against. */
  cashOutPrice?: number
  /** ISO date (ET) the order was placed. */
  placedDate?: string
  /** Moment-in-time anchor (UTC ISO) — placement instant, displayed in ET. */
  placedAt?: string
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

/** Await a fixed delay — used to back off between hydrate retries. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The trade's calendar date as the user sees it — EASTERN time, not UTC. A
// UTC date would roll to "tomorrow" for any trade placed after ~8pm ET.
function todayISO(): string {
  return todayEasternISO()
}

/**
 * The trade-level detail fields carried from a live position onto its banked
 * ClosedTrade, so the Backtest "Details" panel can show a closed trade's full
 * lifecycle (levels + placement timeline) the same as an open/pending one.
 */
function carriedDetail(p: BacktestPosition): Pick<
  ClosedTrade,
  'orderType' | 'limitPrice' | 'distalPrice' | 'stopLossPrice' | 'cashOutPrice' | 'placedDate' | 'placedAt'
> {
  return {
    orderType: p.orderType,
    limitPrice: p.limitPrice,
    distalPrice: p.distalPrice,
    stopLossPrice: p.stopLossPrice,
    cashOutPrice: p.cashOutPrice,
    placedDate: p.placedDate,
    placedAt: p.placedAt,
  }
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
  /** Signal strength — explosive-candle grade (A/B/C/D, or legacy 'A+'/'strong'). */
  signalStrength?: AnyExplosiveGrade
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

  // True once the Supabase hydrate has finished (successfully or not). Until
  // then we must NOT overwrite the localStorage cache with the empty initial
  // state — on mobile, where localStorage is often evicted between sessions,
  // that empty write would destroy the only local copy before the durable rows
  // from Supabase have had a chance to load, so a slow/failed fetch left the
  // user with no trades on screen AND an emptied cache.
  const hydratedRef = useRef(false)

  // Ids of positions the user just deleted/cancelled locally, whose durable
  // DELETE may not have committed yet. This is a tombstone set: any remote
  // adoption (mount hydrate OR realtime re-read) filters these ids out, so a
  // just-deleted row can't be resurrected by a read that raced ahead of its own
  // DELETE commit (or replica lag). An id is cleared once a remote read comes
  // back WITHOUT it — proof the delete has definitively landed — after which
  // legitimate future writes to that id (or settlement updates) flow normally.
  // Unlike editedRef (a one-shot latch that's never reset), this self-heals, so
  // it can't permanently block the realtime settlement updates the subscription
  // exists to deliver.
  const pendingDeletesRef = useRef<Set<string>>(new Set())

  // Drop tombstoned (locally-deleted, not-yet-confirmed) positions from a remote
  // snapshot, and clear any tombstone the remote no longer contains (delete
  // confirmed). Returns the filtered positions to adopt.
  const reconcilePendingDeletes = useCallback((remotePositions: BacktestPosition[]): BacktestPosition[] => {
    const tombstones = pendingDeletesRef.current
    if (tombstones.size === 0) return remotePositions
    const remoteIds = new Set(remotePositions.map((p) => p.id))
    for (const id of tombstones) {
      if (!remoteIds.has(id)) tombstones.delete(id) // delete has landed; stop suppressing
    }
    return tombstones.size === 0
      ? remotePositions
      : remotePositions.filter((p) => !tombstones.has(p.id))
  }, [])

  // The most recent durable-write failure, surfaced so the UI can warn the user
  // that a trade did NOT persist (instead of the old silent console.warn). Null
  // when the last write succeeded / none has failed yet.
  const [writeError, setWriteError] = useState<TradeWriteError | null>(null)

  // Subscribe to store-level write failures for the lifetime of the hook.
  useEffect(() => onTradeWriteError(setWriteError), [])

  /** Dismiss the persistence-error banner. */
  const clearWriteError = useCallback(() => setWriteError(null), [])

  // Mirror every state change into the localStorage cache (fast next-render),
  // but only after the first hydrate. This keeps the initial empty state from
  // clobbering a cache that a slower Supabase read is about to repopulate.
  useEffect(() => {
    if (!hydratedRef.current) return
    persist({ budget, positions, closed })
  }, [budget, positions, closed])

  // Hydrate from Supabase on mount. Supabase is the source of truth; the local
  // cache just seeds the first paint. A failed read (unconfigured, or a network
  // flake/timeout — common on mobile) is retried a few times with backoff and
  // NEVER adopted as an empty portfolio: keep whatever local state we have so a
  // transient mobile fetch failure can't wipe durable trades on refresh.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      // A handful of attempts covers the flaky-mobile-network case without
      // hammering; each backs off a little longer than the last.
      const delays = [0, 800, 2000, 4000]
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt] > 0) await sleep(delays[attempt])
        if (cancelled || editedRef.current) return

        const remote = await fetchPortfolio()
        if (cancelled || editedRef.current) return

        // Read didn't reach Supabase (off or errored). Don't touch local state;
        // retry (unless this was the last attempt), and leave the cache intact.
        if (!remote.ok) {
          if (attempt === delays.length - 1) hydratedRef.current = true
          continue
        }

        // Successful read — adopt it as the source of truth, even when it's
        // genuinely empty (a real reset should clear the local cache too).
        setState((prev) => {
          const next: PersistShape = {
            budget: remote.budget ?? prev.budget,
            positions: reconcilePendingDeletes(remote.positions),
            closed: remote.closed,
          }
          persist(next)
          return next
        })
        hydratedRef.current = true
        return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reconcilePendingDeletes])

  // Realtime: the server-side settle-positions Edge Function fills/settles
  // positions on a cron. When it writes to `trades` / `closed_trades`, re-read
  // the portfolio so an open browser reflects the fill/exit live. A server
  // settlement is an authoritative external change, so we adopt it wholesale
  // (this is why fills/exits appear without a manual refresh). The one thing we
  // must NOT re-adopt is a row the user just deleted whose DELETE hasn't
  // committed yet — reconcilePendingDeletes filters those out until the delete
  // lands, so a self-triggered event can't resurrect a cancelled order.
  useEffect(() => {
    const unsubscribe = subscribeToTradeUpdates(() => {
      void (async () => {
        const remote = await fetchPortfolio()
        if (!remote.ok) return
        setState((prev) => {
          const next: PersistShape = {
            budget: remote.budget ?? prev.budget,
            // Filter out rows the user just deleted whose DELETE may not have
            // committed yet. Our own DELETE fires a postgres_changes event that
            // re-runs this read; without this guard a read racing ahead of the
            // commit re-adopts the just-removed row and it reappears on the next
            // paint / refresh. The tombstone self-clears once the delete lands.
            positions: reconcilePendingDeletes(remote.positions),
            closed: remote.closed,
          }
          persist(next)
          return next
        })
      })()
    })
    return unsubscribe
  }, [reconcilePendingDeletes])

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
    // Build the candidate position up front, OUTSIDE setState. The setState
    // updater must be pure: React invokes it twice under StrictMode/dev, and if
    // the "did I create a row?" decision lives inside the updater, the second
    // run sees the row the first run just appended and mis-classifies the trade
    // as a duplicate — so `insertTradeRemote` was never called and the trade
    // never reached Supabase (the empty-table bug). Deciding dup-ness and
    // constructing the row here keeps the updater a plain, idempotent append.
    const shares = Math.max(1, Math.floor(input.shares))
    const riskReward = input.riskReward ?? DEFAULT_RISK_REWARD
    const today = todayISO()
    // Moment-in-time anchor: the exact submit instant (UTC). For a limit order
    // this is the "line in the sand" that keeps it from filling on the bar it
    // was placed on — fills are only eligible on sessions strictly after this.
    const placedAt = new Date().toISOString()

    let candidate: BacktestPosition | null = null
    if (input.orderType === 'limit') {
      const limitPrice = input.limitPrice
      if (Number.isFinite(limitPrice) && (limitPrice as number) > 0) {
        const levels = managedLevels(input.side, limitPrice as number, {
          distal: input.distal,
          atr: input.atr,
          swingTarget: input.swingTarget,
          riskReward,
        })
        candidate = {
          id: makeId(),
          symbol: input.symbol,
          name: input.name,
          side: input.side,
          status: 'pending',
          orderType: 'limit',
          placedDate: today,
          placedAt,
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
      }
    } else {
      // Market order — fill now at the current price.
      const price = input.price
      if (Number.isFinite(price) && price > 0) {
        const levels = managedLevels(input.side, price, {
          distal: input.distal,
          atr: input.atr,
          swingTarget: input.swingTarget,
          riskReward,
        })
        candidate = {
          id: makeId(),
          symbol: input.symbol,
          name: input.name,
          side: input.side,
          status: 'open',
          orderType: 'market',
          placedDate: today,
          placedAt,
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
      }
    }

    // Invalid input (bad price/limit) — nothing to place.
    if (!candidate) return ''

    // Decide dup-ness against the CURRENT positions once, before setState, so
    // the answer can't be corrupted by a double-invoked updater. `created` is
    // what we actually appended (null when a same-symbol position already
    // exists), captured for the Supabase insert below.
    let resultId = candidate.id
    let created: BacktestPosition | null = candidate
    setState((s) => {
      const existing = s.positions.find((p) => p.symbol === input.symbol)
      if (existing) {
        // A position for this symbol already exists — leave it untouched.
        resultId = existing.id
        created = null
        return s
      }
      // Enforce the concurrent-position ceiling (open + pending combined). At
      // the cap, refuse to add — the UI disables submit + explains why, so this
      // is a defensive backstop rather than the primary gate.
      if (s.positions.length >= MAX_POSITIONS) {
        resultId = ''
        created = null
        return s
      }
      editedRef.current = true
      // Pure append: same input state → same output, safe to run twice.
      return { ...s, positions: [candidate as BacktestPosition, ...s.positions] }
    })

    // Persist the new position to Supabase. Only when one was actually appended
    // — a dup symbol is a no-op. This is NOT fire-and-forget: if the durable
    // insert fails (network flake, schema-cache mismatch, RLS rejection), the
    // row only ever lived in local state, so the next successful hydrate — which
    // adopts the server's rows wholesale — would silently drop it. That's the
    // "placed a pending trade, then it disappeared" bug. On failure we roll the
    // un-persisted position back out of local state so the UI matches reality
    // (the write-error banner already surfaces WHY it didn't save), rather than
    // showing a phantom order that vanishes on refresh.
    if (created) {
      const placed = created
      void insertTradeRemote(placed).then((ok) => {
        if (ok) return
        setState((s) => {
          if (!s.positions.some((p) => p.id === placed.id)) return s
          return { ...s, positions: s.positions.filter((p) => p.id !== placed.id) }
        })
      })
    }
    return resultId
  }, [])

  // ── Fills + exits are now SERVER-SIDE ──────────────────────────────────────
  // The old browser-side fillPending / settleOpen (which walked daily bars and
  // required a session strictly after placement) have been removed. A live
  // engine now does this: the `settle-positions` Edge Function runs on a cron
  // every minute during market hours, fills pending limits at the limit price
  // when live Finnhub price crosses it, and settles open positions at their
  // stop/target level — writing entry/exit prices and real timestamps to
  // Supabase whether or not any browser is open. The client just reads those
  // results (via hydrate + Realtime). Manual early close (the × button) stays
  // client-side below, since it's a direct user action.

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
        ...carriedDetail(pos),
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
      // Tombstone the id so any remote read that races the DELETE commit (our
      // own delete triggers a realtime event that re-reads) can't resurrect the
      // just-removed row. Cleared automatically once a remote read no longer
      // contains it — see reconcilePendingDeletes.
      pendingDeletesRef.current.add(removedId)
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

  return {
    budget,
    positions,
    closed,
    setBudget,
    openTrade,
    closePosition,
    resetPortfolio,
    /** Max concurrent positions (open + pending). */
    maxPositions: MAX_POSITIONS,
    /** True when at the concurrent-position ceiling — block new orders. */
    atPositionLimit: positions.length >= MAX_POSITIONS,
    /** Last durable-write failure (null if the last write persisted OK). */
    writeError,
    /** Dismiss the write-error banner. */
    clearWriteError,
  }
}

/**
 * SupabaseTradesStore: read/write the paper-trading portfolio from the browser.
 *
 * The Backtest portfolio used to live entirely in one localStorage key. Once
 * the daily-bar cache filled the origin quota, new positions silently failed to
 * persist and vanished on refresh. This module makes Supabase the source of
 * truth (durable + cross-device); the hook keeps localStorage only as a fast
 * initial-render cache / offline fallback.
 *
 * Single-user app: the browser uses the anon key and RLS (migration 0011)
 * grants anon full CRUD on `portfolio`, `trades`, and `closed_trades`.
 *
 * Everything here is best-effort and non-blocking, mirroring supabaseDailyStore:
 * when Supabase is unconfigured or a call fails, functions no-op / return a safe
 * default and log a warning, so the in-memory + localStorage path still works.
 */

import { getSupabase } from './supabaseClient'
import type { BacktestPosition, ClosedTrade } from '../hooks/useBacktestPortfolio'

// ── Row shapes (snake_case columns as stored in Postgres) ───────────────────

interface TradeRow {
  id: string
  symbol: string
  name: string | null
  side: 'long' | 'short'
  status: 'pending' | 'open'
  order_type: 'market' | 'limit'
  placed_date: string
  placed_at: string | null
  opened_date: string | null
  entry_price: number | string | null
  limit_price: number | string | null
  distal_price: number | string | null
  atr: number | string | null
  swing_target: number | string | null
  zone_kind: 'demand' | 'supply' | null
  zone_grade: 'A+' | 'good' | 'weak' | null
  signal_strength: 'A+' | 'strong' | null
  proximal_price: number | string | null
  signal_date: string | null
  risk_reward: number | string
  shares: number
  stop_loss_price: number | string
  cash_out_price: number | string
}

interface ClosedTradeRow {
  id: string
  symbol: string
  name: string | null
  side: 'long' | 'short'
  shares: number
  entry_price: number | string
  exit_price: number | string
  realized_pnl: number | string
  opened_date: string | null
  closed_date: string
  zone_kind: 'demand' | 'supply' | null
  zone_grade: 'A+' | 'good' | 'weak' | null
  signal_strength: 'A+' | 'strong' | null
  proximal_price: number | string | null
  signal_date: string | null
  order_type: 'market' | 'limit' | null
  limit_price: number | string | null
  distal_price: number | string | null
  stop_loss_price: number | string | null
  cash_out_price: number | string | null
  placed_date: string | null
  placed_at: string | null
}

/** Numeric columns come back as strings from PG numeric; coerce defensively. */
function num(v: number | string | null | undefined): number | undefined {
  if (v === null || v === undefined) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

// ── Row → model mappers ─────────────────────────────────────────────────────

function rowToPosition(r: TradeRow): BacktestPosition {
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name ?? undefined,
    side: r.side,
    status: r.status,
    orderType: r.order_type,
    placedDate: r.placed_date,
    placedAt: r.placed_at ?? undefined,
    openedDate: r.opened_date,
    entryPrice: num(r.entry_price) ?? null,
    limitPrice: num(r.limit_price),
    distalPrice: num(r.distal_price),
    atr: num(r.atr),
    swingTarget: num(r.swing_target),
    zoneKind: r.zone_kind ?? undefined,
    zoneGrade: r.zone_grade ?? undefined,
    signalStrength: r.signal_strength ?? undefined,
    proximalPrice: num(r.proximal_price),
    signalDate: r.signal_date ?? undefined,
    riskReward: num(r.risk_reward) ?? 2,
    shares: r.shares,
    stopLossPrice: num(r.stop_loss_price) ?? 0,
    cashOutPrice: num(r.cash_out_price) ?? 0,
  }
}

function rowToClosed(r: ClosedTradeRow): ClosedTrade {
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name ?? undefined,
    side: r.side,
    shares: r.shares,
    entryPrice: num(r.entry_price) ?? 0,
    exitPrice: num(r.exit_price) ?? 0,
    realizedPnl: num(r.realized_pnl) ?? 0,
    openedDate: r.opened_date,
    closedDate: r.closed_date,
    zoneKind: r.zone_kind ?? undefined,
    zoneGrade: r.zone_grade ?? undefined,
    signalStrength: r.signal_strength ?? undefined,
    proximalPrice: num(r.proximal_price),
    signalDate: r.signal_date ?? undefined,
    orderType: r.order_type ?? undefined,
    limitPrice: num(r.limit_price),
    distalPrice: num(r.distal_price),
    stopLossPrice: num(r.stop_loss_price),
    cashOutPrice: num(r.cash_out_price),
    placedDate: r.placed_date ?? undefined,
    placedAt: r.placed_at ?? undefined,
  }
}

// ── Model → row mappers (for insert/update) ─────────────────────────────────

function positionToRow(p: BacktestPosition): TradeRow {
  return {
    id: p.id,
    symbol: p.symbol,
    name: p.name ?? null,
    side: p.side,
    status: p.status,
    order_type: p.orderType,
    placed_date: p.placedDate,
    placed_at: p.placedAt ?? null,
    opened_date: p.openedDate,
    entry_price: p.entryPrice,
    limit_price: p.limitPrice ?? null,
    distal_price: p.distalPrice ?? null,
    atr: p.atr ?? null,
    swing_target: p.swingTarget ?? null,
    zone_kind: p.zoneKind ?? null,
    zone_grade: p.zoneGrade ?? null,
    signal_strength: p.signalStrength ?? null,
    proximal_price: p.proximalPrice ?? null,
    signal_date: p.signalDate ?? null,
    risk_reward: p.riskReward,
    shares: p.shares,
    stop_loss_price: p.stopLossPrice,
    cash_out_price: p.cashOutPrice,
  }
}

function closedToRow(t: ClosedTrade): ClosedTradeRow {
  return {
    id: t.id,
    symbol: t.symbol,
    name: t.name ?? null,
    side: t.side,
    shares: t.shares,
    entry_price: t.entryPrice,
    exit_price: t.exitPrice,
    realized_pnl: t.realizedPnl,
    opened_date: t.openedDate,
    closed_date: t.closedDate,
    zone_kind: t.zoneKind ?? null,
    zone_grade: t.zoneGrade ?? null,
    signal_strength: t.signalStrength ?? null,
    proximal_price: t.proximalPrice ?? null,
    signal_date: t.signalDate ?? null,
    order_type: t.orderType ?? null,
    limit_price: t.limitPrice ?? null,
    distal_price: t.distalPrice ?? null,
    stop_loss_price: t.stopLossPrice ?? null,
    cash_out_price: t.cashOutPrice ?? null,
    placed_date: t.placedDate ?? null,
    placed_at: t.placedAt ?? null,
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface RemotePortfolio {
  budget: number | null
  positions: BacktestPosition[]
  closed: ClosedTrade[]
  /**
   * Whether the read actually reached Supabase and returned data. False when
   * Supabase is unconfigured OR any query errored (network flake, timeout —
   * common on mobile). The caller MUST NOT treat an unsuccessful read as an
   * empty portfolio: doing so is what wiped trades on refresh, because a failed
   * mobile fetch looks identical to a genuinely empty account. When false, keep
   * the local state and try again rather than adopting empties.
   */
  ok: boolean
}

/**
 * Hydrate the whole portfolio in one pass: budget + open/pending trades +
 * closed history.
 *
 * Returns `ok: false` when Supabase is off OR any of the three reads errored,
 * so the caller can tell a real "empty account" (`ok: true`, no rows) apart
 * from a "read failed" (`ok: false`). Treating the latter as empty is what
 * cleared trades on mobile refreshes, where a flaky/slow network makes the
 * fetch fail while the durable rows are still sitting in Postgres.
 */
export async function fetchPortfolio(): Promise<RemotePortfolio> {
  const supabase = getSupabase()
  if (!supabase) return { budget: null, positions: [], closed: [], ok: false }

  let ok = true
  const [portfolioRes, tradesRes, closedRes] = await Promise.all([
    supabase.from('portfolio').select('budget').eq('id', 'default').maybeSingle(),
    supabase.from('trades').select('*').order('created_at', { ascending: false }),
    supabase.from('closed_trades').select('*').order('closed_date', { ascending: false }),
  ])

  let budget: number | null = null
  if (portfolioRes.error) {
    ok = false
    console.warn(`Portfolio budget read failed: ${portfolioRes.error.message}`)
  } else {
    budget = num((portfolioRes.data as { budget: number | string } | null)?.budget) ?? null
  }

  let positions: BacktestPosition[] = []
  if (tradesRes.error) {
    ok = false
    console.warn(`Trades read failed: ${tradesRes.error.message}`)
  } else {
    positions = ((tradesRes.data ?? []) as TradeRow[]).map(rowToPosition)
  }

  let closed: ClosedTrade[] = []
  if (closedRes.error) {
    ok = false
    console.warn(`Closed trades read failed: ${closedRes.error.message}`)
  } else {
    closed = ((closedRes.data ?? []) as ClosedTradeRow[]).map(rowToClosed)
  }

  return { budget, positions, closed, ok }
}

// ── Writes (all best-effort, fire-and-forget from the hook) ─────────────────

/** Update the single-row budget. */
export async function saveBudget(budget: number): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase
    .from('portfolio')
    .update({ budget, updated_at: new Date().toISOString() })
    .eq('id', 'default')
  if (error) console.warn(`Save budget failed: ${error.message}`)
}

/** Insert a newly-placed position (pending or open). */
export async function insertTrade(position: BacktestPosition): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase.from('trades').insert(positionToRow(position))
  if (error) console.warn(`Insert trade ${position.symbol} failed: ${error.message}`)
}

/**
 * Persist a mutated position (e.g. a pending limit filling → open with fresh
 * levels). Upsert on the client-generated id so it works whether or not the row
 * already exists.
 */
export async function upsertTrade(position: BacktestPosition): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const row = { ...positionToRow(position), updated_at: new Date().toISOString() }
  const { error } = await supabase.from('trades').upsert(row, { onConflict: 'id' })
  if (error) console.warn(`Upsert trade ${position.symbol} failed: ${error.message}`)
}

/** Bulk-upsert positions (used when a fill/settle changes several at once). */
export async function upsertTrades(positions: BacktestPosition[]): Promise<void> {
  if (positions.length === 0) return
  const supabase = getSupabase()
  if (!supabase) return
  const now = new Date().toISOString()
  const rows = positions.map((p) => ({ ...positionToRow(p), updated_at: now }))
  const { error } = await supabase.from('trades').upsert(rows, { onConflict: 'id' })
  if (error) console.warn(`Upsert trades failed: ${error.message}`)
}

/** Remove a position row by id (cancel a pending order, or move to closed). */
export async function deleteTrade(id: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase.from('trades').delete().eq('id', id)
  if (error) console.warn(`Delete trade ${id} failed: ${error.message}`)
}

/** Remove several position rows by id (used when settling multiple opens). */
export async function deleteTrades(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase.from('trades').delete().in('id', ids)
  if (error) console.warn(`Delete trades failed: ${error.message}`)
}

/** Bank a closed trade into `closed_trades`. */
export async function insertClosedTrade(trade: ClosedTrade): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase.from('closed_trades').insert(closedToRow(trade))
  if (error) console.warn(`Insert closed trade ${trade.symbol} failed: ${error.message}`)
}

/** Bulk-insert banked closed trades (settleOpen can close several at once). */
export async function insertClosedTrades(trades: ClosedTrade[]): Promise<void> {
  if (trades.length === 0) return
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase.from('closed_trades').insert(trades.map(closedToRow))
  if (error) console.warn(`Insert closed trades failed: ${error.message}`)
}

/**
 * Wipe every trade + closed trade and reset the budget to `defaultBudget`.
 * Used by resetPortfolio. `neq('id','')` matches all rows (a delete needs a
 * filter). Best-effort.
 */
export async function resetRemotePortfolio(defaultBudget: number): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const results = await Promise.all([
    supabase.from('trades').delete().neq('id', ''),
    supabase.from('closed_trades').delete().neq('id', ''),
    supabase
      .from('portfolio')
      .update({ budget: defaultBudget, updated_at: new Date().toISOString() })
      .eq('id', 'default'),
  ])
  for (const r of results) {
    if (r.error) console.warn(`Reset portfolio step failed: ${r.error.message}`)
  }
}

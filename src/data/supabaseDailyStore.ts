/**
 * SupabaseDailyStore: reads adjusted daily bars from the Supabase `prices` table.
 *
 * This is the browser-facing READ path. It replaces the direct Tiingo call
 * (which the browser can't make — Tiingo isn't CORS-enabled). The server-side
 * Edge Function collector is what populates `prices`; the browser only reads.
 *
 * Returns the same `DailyBar[]` shape the rest of the app consumes, so the
 * dailyCache freshness layer and `barsToStock` mapping work unchanged.
 */

import { getSupabase, type PriceRow } from './supabaseClient'
import type { DailyBar } from './tiingo'

/** Max bars to read per symbol (matches the cache's retention target). */
const READ_LIMIT = 260

function rowToBar(r: PriceRow): DailyBar {
  return {
    date: r.date,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }
}

/**
 * Fetch daily bars for one symbol from Supabase, oldest -> newest.
 * Returns [] when Supabase is unconfigured or the symbol has no rows.
 */
export async function fetchDailyBarsFromSupabase(symbol: string): Promise<DailyBar[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  // Pull the most recent READ_LIMIT rows (desc), then flip to ascending so the
  // series reads oldest -> newest like the Tiingo client returns.
  const { data, error } = await supabase
    .from('prices')
    .select('symbol,date,open,high,low,close,volume')
    .eq('symbol', symbol)
    .order('date', { ascending: false })
    .limit(READ_LIMIT)

  if (error) {
    throw new Error(`Supabase read for ${symbol} failed: ${error.message}`)
  }
  if (!data || data.length === 0) return []

  const bars = (data as PriceRow[]).map(rowToBar)
  bars.reverse()
  return bars
}

/** A watchlist symbol entry as stored in Supabase (browser-visible columns). */
export interface WatchlistEntry {
  symbol: string
  name?: string
}

/** A named watchlist (the parent list). */
export interface WatchlistMeta {
  id: string
  name: string
  /** 1..10 — drives the staggered nightly collection time. */
  slot: number
}

/** A named list plus its active symbols, as hydrated for the client. */
export interface WatchlistWithSymbols extends WatchlistMeta {
  symbols: string[]
}

/**
 * Read all watchlist metadata rows (id, name, slot), ordered by slot so the UI
 * shows lists in a stable order. Returns [] when unconfigured or on error.
 */
export async function fetchWatchlists(): Promise<WatchlistMeta[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('watchlists')
    .select('id,name,slot')
    .eq('active', true)
    .order('slot', { ascending: true })

  if (error) {
    console.warn(`Watchlists read skipped: ${error.message}`)
    return []
  }
  return (data ?? []).map((r) => {
    const row = r as { id: string; name: string; slot: number }
    return { id: row.id, name: row.name, slot: row.slot }
  })
}

/**
 * Read every list WITH its active symbols in one pass. Symbols are grouped by
 * `watchlist_id`; because a symbol belongs to exactly one list, no symbol
 * appears in two lists. Ordered oldest-added-first within each list so order is
 * stable across devices. Returns [] when unconfigured.
 */
export async function fetchWatchlistsWithSymbols(): Promise<WatchlistWithSymbols[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const lists = await fetchWatchlists()
  if (lists.length === 0) return []

  const { data, error } = await supabase
    .from('watchlist')
    .select('symbol,watchlist_id')
    .eq('active', true)
    .order('added_at', { ascending: true })

  if (error) {
    console.warn(`Watchlist symbols read skipped: ${error.message}`)
    return lists.map((l) => ({ ...l, symbols: [] }))
  }

  const byList = new Map<string, string[]>()
  for (const r of data ?? []) {
    const row = r as { symbol: string; watchlist_id: string | null }
    if (!row.watchlist_id) continue
    const arr = byList.get(row.watchlist_id) ?? []
    arr.push(row.symbol)
    byList.set(row.watchlist_id, arr)
  }

  return lists.map((l) => ({ ...l, symbols: byList.get(l.id) ?? [] }))
}

/**
 * Create a new named list in the first free slot (1..10). Returns the created
 * list, or null if all slots are taken / Supabase is off. The DB trigger also
 * (re)schedules this list's cron jobs.
 */
export async function createWatchlist(name: string): Promise<WatchlistMeta | null> {
  const supabase = getSupabase()
  if (!supabase) return null

  const existing = await fetchWatchlists()
  const used = new Set(existing.map((l) => l.slot))
  let slot = 0
  for (let s = 1; s <= 10; s++) {
    if (!used.has(s)) {
      slot = s
      break
    }
  }
  if (slot === 0) {
    console.warn('Cannot create watchlist: all 10 slots are in use.')
    return null
  }

  const { data, error } = await supabase
    .from('watchlists')
    .insert({ name, slot })
    .select('id,name,slot')
    .maybeSingle()
  if (error || !data) {
    console.warn(`Create watchlist failed: ${error?.message ?? 'no row returned'}`)
    return null
  }
  const row = data as { id: string; name: string; slot: number }
  return { id: row.id, name: row.name, slot: row.slot }
}

/** Rename a list. Best-effort; no-op when Supabase is off. */
export async function renameWatchlist(id: string, name: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase.from('watchlists').update({ name }).eq('id', id)
  if (error) console.warn(`Rename watchlist failed: ${error.message}`)
}

/**
 * Delete a list. The `watchlist` FK is ON DELETE CASCADE, so the list's symbol
 * rows go with it, and the DB trigger reschedules cron. Best-effort.
 */
export async function deleteWatchlist(id: string): Promise<void> {
  const supabase = getSupabase()
  if (!supabase) return
  const { error } = await supabase.from('watchlists').delete().eq('id', id)
  if (error) console.warn(`Delete watchlist failed: ${error.message}`)
}

/**
 * Reconcile ONE list's symbols so the collector pulls exactly the current set
 * for that list. Scoped strictly to `listId`:
 *   1. Upsert every current symbol with active=true + watchlist_id=listId.
 *      A symbol belongs to exactly one list, so re-adding a symbol that lived
 *      in another list simply moves it here (onConflict on symbol updates the
 *      owning list).
 *   2. Deactivate rows that are active AND owned by THIS list but no longer in
 *      the current set. Other lists' symbols are never touched.
 *
 * Best-effort and non-blocking. Returns the symbols that were upserted, or []
 * when nothing changed / Supabase is off.
 */
export async function syncWatchlistList(listId: string, symbols: string[]): Promise<string[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const wanted = new Set(symbols)

  // 1) Upsert current symbols as active + owned by this list.
  let upserted: string[] = []
  if (symbols.length > 0) {
    const rows = symbols.map((symbol) => ({ symbol, active: true, watchlist_id: listId }))
    const { data, error } = await supabase
      .from('watchlist')
      .upsert(rows, { onConflict: 'symbol' })
      .select('symbol')
    if (error) {
      console.warn(`Watchlist sync (activate) skipped: ${error.message}`)
    } else {
      upserted = (data ?? []).map((r) => (r as { symbol: string }).symbol)
    }
  }

  // 2) Deactivate anything active in THIS list but no longer wanted.
  const { data: activeRows, error: readErr } = await supabase
    .from('watchlist')
    .select('symbol')
    .eq('active', true)
    .eq('watchlist_id', listId)
  if (readErr) {
    console.warn(`Watchlist sync (read active) skipped: ${readErr.message}`)
    return upserted
  }
  const toDeactivate = (activeRows ?? [])
    .map((r) => (r as { symbol: string }).symbol)
    .filter((sym) => !wanted.has(sym))

  if (toDeactivate.length > 0) {
    const { error: deErr } = await supabase
      .from('watchlist')
      .update({ active: false })
      .in('symbol', toDeactivate)
      .eq('watchlist_id', listId)
    if (deErr) {
      console.warn(`Watchlist sync (deactivate) skipped: ${deErr.message}`)
    }
  }

  return upserted
}

/**
 * Read the display name for a symbol from the watchlist table, if present.
 * Best-effort: returns undefined when unconfigured or not found.
 */
export async function fetchNameFromSupabase(symbol: string): Promise<string | undefined> {
  const supabase = getSupabase()
  if (!supabase) return undefined

  const { data, error } = await supabase
    .from('watchlist')
    .select('name')
    .eq('symbol', symbol)
    .maybeSingle()

  if (error || !data) return undefined
  return (data as { name: string | null }).name ?? undefined
}

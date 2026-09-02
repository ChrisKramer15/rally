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

/** A watchlist entry as stored in Supabase (browser-visible columns). */
export interface WatchlistEntry {
  symbol: string
  name?: string
}

/**
 * Read the ACTIVE watchlist from Supabase — the shared source of truth every
 * device converges on. Returns entries oldest-added first so the list order is
 * stable across devices. Returns [] when unconfigured or on error (callers fall
 * back to their local list).
 */
export async function fetchWatchlist(): Promise<WatchlistEntry[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const { data, error } = await supabase
    .from('watchlist')
    .select('symbol,name')
    .eq('active', true)
    .order('added_at', { ascending: true })

  if (error) {
    console.warn(`Watchlist read skipped: ${error.message}`)
    return []
  }
  return (data ?? []).map((r) => {
    const row = r as { symbol: string; name: string | null }
    return { symbol: row.symbol, name: row.name ?? undefined }
  })
}

/**
 * Reconcile the shared watchlist so the collector only pulls symbols that are
 * CURRENTLY on the user's list.
 *
 * Two-way sync against `public.watchlist`:
 *   1. Upsert every current symbol with active=true — inserts new tickers and
 *      REACTIVATES any that were previously removed (a returning symbol keeps
 *      its row, added_at, and price history).
 *   2. Deactivate (active=false) any rows that are active in the table but no
 *      longer in the current list — a soft delete that stops the collector from
 *      pulling them without discarding their history.
 *
 * Best-effort and non-blocking: a failure here must never break the local
 * watchlist save. No-op when Supabase is unconfigured.
 *
 * Returns the symbols that were newly inserted (useful for kicking an immediate
 * collect), or [] when nothing was added / Supabase is off.
 */
export async function syncWatchlist(symbols: string[]): Promise<string[]> {
  const supabase = getSupabase()
  if (!supabase) return []

  const wanted = new Set(symbols)

  // 1) Upsert current symbols as active. onConflict updates the active flag so a
  //    previously-removed symbol is reactivated; new symbols are inserted.
  let inserted: string[] = []
  if (symbols.length > 0) {
    const rows = symbols.map((symbol) => ({ symbol, active: true }))
    const { data, error } = await supabase
      .from('watchlist')
      .upsert(rows, { onConflict: 'symbol' })
      .select('symbol')
    if (error) {
      // Advisory only — surface in console but don't throw into the save path.
      console.warn(`Watchlist sync (activate) skipped: ${error.message}`)
    } else {
      inserted = (data ?? []).map((r) => (r as { symbol: string }).symbol)
    }
  }

  // 2) Deactivate anything still active in the table but no longer wanted.
  const { data: activeRows, error: readErr } = await supabase
    .from('watchlist')
    .select('symbol')
    .eq('active', true)
  if (readErr) {
    console.warn(`Watchlist sync (read active) skipped: ${readErr.message}`)
    return inserted
  }
  const toDeactivate = (activeRows ?? [])
    .map((r) => (r as { symbol: string }).symbol)
    .filter((sym) => !wanted.has(sym))

  if (toDeactivate.length > 0) {
    const { error: deErr } = await supabase
      .from('watchlist')
      .update({ active: false })
      .in('symbol', toDeactivate)
    if (deErr) {
      console.warn(`Watchlist sync (deactivate) skipped: ${deErr.message}`)
    }
  }

  return inserted
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

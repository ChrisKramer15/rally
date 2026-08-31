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

/**
 * Sync watchlist symbols up to Supabase so the daily collector tracks them.
 *
 * Inserts any new symbols into `public.watchlist` (existing ones are ignored via
 * onConflict). Best-effort and non-blocking: a failure here must never break the
 * local watchlist save. No-op when Supabase is unconfigured.
 *
 * Returns the symbols that were newly inserted (useful for kicking an immediate
 * collect), or [] when nothing was added / Supabase is off.
 */
export async function syncWatchlist(symbols: string[]): Promise<string[]> {
  const supabase = getSupabase()
  if (!supabase || symbols.length === 0) return []

  const rows = symbols.map((symbol) => ({ symbol }))
  // ignoreDuplicates: don't touch existing rows (preserve added_at/name/active).
  const { data, error } = await supabase
    .from('watchlist')
    .upsert(rows, { onConflict: 'symbol', ignoreDuplicates: true })
    .select('symbol')

  if (error) {
    // Advisory only — surface in console but don't throw into the save path.
    console.warn(`Watchlist sync skipped: ${error.message}`)
    return []
  }
  return (data ?? []).map((r) => (r as { symbol: string }).symbol)
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

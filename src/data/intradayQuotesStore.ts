/**
 * IntradayQuotesStore: reads near-real-time quotes from the Supabase
 * `intraday_quotes` table.
 *
 * This is the browser-facing READ path for live prices. It replaces the direct
 * Finnhub `/quote` calls the browser used to make (via liveQuoteScheduler). The
 * settle-positions Edge Function pulls Finnhub quotes for every pending/open
 * position each minute and writes them here; the browser only reads.
 *
 * Because the server already spends the Finnhub free-tier budget to fetch these
 * quotes, reading from the DB frees the entire budget for the settler (no more
 * browser/server 429 collisions) and gives every device the same prices.
 *
 * Coverage note: only symbols with a pending/open trade get written, so a live
 * quote exists only for symbols you actively hold. Symbols without a row simply
 * have no live price and callers fall back to the Tiingo daily close — the same
 * behavior as when Finnhub returned nothing.
 *
 * Returns the same `LiveQuote` shape the app already consumes, so downstream
 * code (overlayLiveQuotes, useLiveQuotes consumers) is unchanged.
 */

import { getSupabase } from './supabaseClient'
import type { LiveQuote } from './finnhub'

/** Debounce window for coalescing a burst of intraday_quotes writes into one notify. */
const REALTIME_DEBOUNCE_MS = 1_500

/** Row shape of public.intraday_quotes (browser-visible columns). */
interface IntradayQuoteRow {
  symbol: string
  quoted_at: string
  price: number | string
  prev_close: number | string | null
  provider_ts: string | null
}

/** Coerce a PG numeric (which arrives as a string) to a finite number, or null. */
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Map a DB row to the app's LiveQuote. Returns null when the price is unusable. */
function rowToQuote(r: IntradayQuoteRow): LiveQuote | null {
  const price = num(r.price)
  if (price === null || price <= 0) return null
  const prevClose = num(r.prev_close)
  return {
    symbol: r.symbol.toUpperCase(),
    price,
    prevClose: prevClose !== null && prevClose > 0 ? prevClose : price,
    // The intraday table doesn't store open/high/low (the settler doesn't need
    // them); the overlay only reads price + prevClose, so 0 is a safe filler.
    open: 0,
    high: 0,
    low: 0,
    // Freshness is measured off when the settler captured the quote.
    fetchedAt: new Date(r.quoted_at).getTime(),
  }
}

/**
 * Fetch the latest quote for each of `symbols` from `intraday_quotes`.
 *
 * Returns a map keyed by UPPERCASE symbol. Symbols with no stored quote are
 * simply absent from the map (caller falls back to the daily close). Returns an
 * empty map when Supabase is unconfigured or `symbols` is empty.
 *
 * Implementation: we pull recent rows for the requested symbols ordered newest-
 * first and keep the first (latest) row seen per symbol. A short lookback window
 * bounds the scan; anything older than that is treated as "no live price"
 * (stale), which is the correct behavior outside/at the edges of market hours.
 */
export async function fetchLatestQuotes(
  symbols: string[],
  lookbackMinutes = 30,
): Promise<Map<string, LiveQuote>> {
  const out = new Map<string, LiveQuote>()
  const supabase = getSupabase()
  if (!supabase || symbols.length === 0) return out

  const upper = symbols.map((s) => s.toUpperCase())
  const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString()

  const { data, error } = await supabase
    .from('intraday_quotes')
    .select('symbol,quoted_at,price,prev_close,provider_ts')
    .in('symbol', upper)
    .gte('quoted_at', since)
    .order('quoted_at', { ascending: false })

  if (error) {
    console.warn(`intraday_quotes read failed: ${error.message}`)
    return out
  }

  for (const row of (data as IntradayQuoteRow[] | null) ?? []) {
    const key = row.symbol.toUpperCase()
    if (out.has(key)) continue // newest-first, so the first row per symbol wins
    const q = rowToQuote(row)
    if (q) out.set(key, q)
  }
  return out
}

/**
 * Subscribe to new rows in `intraday_quotes` (Supabase Realtime).
 *
 * When the settler writes a fresh batch each minute, Postgres streams the
 * inserts to subscribed browsers. We coalesce the burst (one settle run inserts
 * many rows at once) and, after a short debounce, invoke `onChange` so the
 * caller can re-read the latest quotes.
 *
 * Requires `intraday_quotes` to be in the `supabase_realtime` publication. No-op
 * (returns a noop unsubscribe) when Supabase is off.
 *
 * @returns an unsubscribe function to tear the channel + timer down.
 */
export function subscribeToQuoteUpdates(onChange: () => void): () => void {
  const supabase = getSupabase()
  if (!supabase) return () => {}

  let timer: ReturnType<typeof setTimeout> | null = null
  const fire = () => {
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      onChange()
    }, REALTIME_DEBOUNCE_MS)
  }

  const channel = supabase
    .channel('intraday-quotes-changes')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'intraday_quotes' }, fire)
    .subscribe()

  return () => {
    if (timer !== null) clearTimeout(timer)
    void supabase.removeChannel(channel)
  }
}

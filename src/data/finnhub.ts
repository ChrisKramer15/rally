/**
 * Finnhub real-time quote client (browser-direct).
 *
 * ROLE IN THE APP
 * ---------------
 * Tiingo (server-side, via the Supabase collector) remains the single source of
 * truth for DAILY bars and all signal generation. Finnhub is a SECOND, separate
 * provider used ONLY for near-real-time last prices from the trade screen
 * onward (trade ticket, backtest mark-to-market, portfolio valuation) and for a
 * pipeline health indicator. It never feeds signals and never replaces Tiingo.
 *
 * WHY BROWSER-DIRECT
 * ------------------
 * Finnhub's REST `/quote` endpoint is CORS-enabled and takes the token as a
 * query param, so a static frontend can call it directly — no Edge Function
 * needed (unlike Tiingo, which isn't CORS-enabled). The tradeoff is that the
 * token ships in the client bundle. For a FREE, personal-use key that's an
 * accepted risk: the worst case is someone burning the free quota. Do NOT put a
 * paid key here.
 *
 * TOKEN
 * -----
 * Read from `VITE_FINNHUB_TOKEN`. When unset, `hasFinnhub()` is false and
 * `fetchQuote` returns null, so the whole live-quote layer no-ops and every
 * screen falls back to the Tiingo daily close it already uses.
 *
 * RATE LIMIT
 * ----------
 * Finnhub free tier is ~60 requests/minute and `/quote` is ONE symbol per
 * request. This module does NOT pace requests itself — the shared
 * liveQuoteScheduler owns the app-wide budget and paces calls. Keep it that way
 * so two screens asking for the same symbol don't double-spend.
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1'

/** The browser-exposed free token. Empty string when unconfigured. */
const TOKEN = (import.meta.env.VITE_FINNHUB_TOKEN as string | undefined)?.trim() ?? ''

/** True when a Finnhub token is configured (live quotes are possible). */
export function hasFinnhub(): boolean {
  return TOKEN.length > 0
}

/** A single real-time-ish quote for one symbol. */
export interface LiveQuote {
  symbol: string
  /** Current/last price. */
  price: number
  /** Prior session close (for % change vs the prior day). */
  prevClose: number
  /** Today's open. */
  open: number
  /** Today's high. */
  high: number
  /** Today's low. */
  low: number
  /** When this quote was fetched (client clock, ms epoch). */
  fetchedAt: number
}

/**
 * Finnhub `/quote` response shape (the fields we use):
 *   c = current price, d = change, dp = percent change,
 *   h = high, l = low, o = open, pc = previous close, t = quote unix time (s).
 * A symbol with no data comes back with c === 0 and t === 0.
 */
interface FinnhubQuoteResponse {
  c: number
  d: number | null
  dp: number | null
  h: number
  l: number
  o: number
  pc: number
  t: number
}

/**
 * Fetch a single real-time quote for `symbol`. Returns null when:
 *   • no token is configured,
 *   • the request fails (network / non-2xx / rate limit), or
 *   • Finnhub returns an empty quote (c === 0 && t === 0 — unknown symbol).
 *
 * Never throws — callers treat null as "no live price, fall back to daily
 * close". The scheduler decides WHEN to call this; this function is a dumb,
 * one-shot fetch.
 */
export async function fetchQuote(symbol: string, signal?: AbortSignal): Promise<LiveQuote | null> {
  if (!hasFinnhub()) return null
  const url = `${FINNHUB_BASE}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(TOKEN)}`
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const data = (await res.json()) as FinnhubQuoteResponse
    // Empty quote: unknown/unsupported symbol on the free tier.
    if (!data || (data.c === 0 && data.t === 0)) return null
    if (!Number.isFinite(data.c) || data.c <= 0) return null
    return {
      symbol,
      price: data.c,
      prevClose: Number.isFinite(data.pc) && data.pc > 0 ? data.pc : data.c,
      open: data.o,
      high: data.h,
      low: data.l,
      fetchedAt: Date.now(),
    }
  } catch {
    // Aborted or network error — treat as "no quote".
    return null
  }
}

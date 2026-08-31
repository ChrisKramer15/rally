import type { Stock } from './stocks'

/**
 * Minimal Finnhub REST client.
 *
 * Only the endpoints we need for the watchlist are implemented:
 *   - /quote        current price + previous close for a symbol
 *   - /stock/profile2  company name (best-effort, cached)
 *
 * The free tier allows 60 requests/minute, which comfortably covers a
 * 45-symbol watchlist refreshed once every 60 seconds.
 *
 * Docs: https://finnhub.io/docs/api/quote
 */

const BASE_URL = 'https://finnhub.io/api/v1'

export const FINNHUB_KEY: string | undefined = import.meta.env.VITE_FINNHUB_KEY

/** True when an API key is configured. When false, callers fall back to the simulated feed. */
export function hasFinnhubKey(): boolean {
  return typeof FINNHUB_KEY === 'string' && FINNHUB_KEY.length > 0
}

/** Raw shape returned by Finnhub's /quote endpoint. */
interface FinnhubQuote {
  c: number // current price
  d: number | null // change
  dp: number | null // percent change
  h: number // high of the day
  l: number // low of the day
  o: number // open price of the day
  pc: number // previous close
  t: number // unix timestamp
}



interface FinnhubProfile {
  name?: string
  ticker?: string
}

// Company names rarely change; cache them for the session to save API calls.
const nameCache = new Map<string, string>()

async function finnhubGet<T>(path: string, params: Record<string, string>): Promise<T> {
  if (!FINNHUB_KEY) {
    throw new Error('Finnhub API key is not configured (set VITE_FINNHUB_KEY).')
  }
  const query = new URLSearchParams({ ...params, token: FINNHUB_KEY }).toString()
  const res = await fetch(`${BASE_URL}${path}?${query}`)
  if (res.status === 429) {
    throw new Error('Finnhub rate limit reached (60 req/min on the free tier).')
  }
  if (!res.ok) {
    throw new Error(`Finnhub request failed: ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

/** Fetch the display name for a symbol, cached for the session. Falls back to the symbol itself. */
async function fetchName(symbol: string): Promise<string> {
  const cached = nameCache.get(symbol)
  if (cached) return cached
  try {
    const profile = await finnhubGet<FinnhubProfile>('/stock/profile2', { symbol })
    const name = profile.name?.trim() || symbol
    nameCache.set(symbol, name)
    return name
  } catch {
    // Profile lookups are best-effort; a missing name should never break quotes.
    return symbol
  }
}

/**
 * Fetch a single quote and map it into the app's Stock shape.
 * `prevHistory` lets the caller preserve the rolling sparkline series across polls.
 * Returns null when the symbol has no usable data (e.g. invalid ticker).
 */
export async function fetchQuote(
  symbol: string,
  opts: { prevHistory?: number[]; name?: string } = {},
): Promise<Stock | null> {
  const quote = await finnhubGet<FinnhubQuote>('/quote', { symbol })

  // Finnhub returns zeros for unknown symbols rather than an error.
  if (!quote || quote.c === 0) {
    return null
  }

  const name = opts.name ?? (await fetchName(symbol))
  const price = Number(quote.c.toFixed(2))
  const prevClose = Number((quote.pc || quote.c).toFixed(2))
  // Real points only: append the latest price to any prior (persisted) history.
  // On the very first fetch this is a single point; the sparkline fills in as
  // subsequent polls accumulate genuine data.
  const history = [...(opts.prevHistory ?? []), price]

  return {
    symbol,
    name,
    price,
    prevClose,
    history,
  }
}

/**
 * Fetch quotes for many symbols. The free tier is per-symbol (no batch endpoint),
 * so we issue calls with a small concurrency limit to stay well under 60/min.
 * Symbols that fail or return no data are skipped.
 */
export async function fetchQuotes(
  symbols: string[],
  prev: Record<string, { history: number[]; name: string }> = {},
): Promise<Stock[]> {
  const results: Stock[] = []
  const concurrency = 5

  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency)
    const settled = await Promise.allSettled(
      batch.map((sym) =>
        fetchQuote(sym, {
          prevHistory: prev[sym]?.history,
          name: prev[sym]?.name,
        }),
      ),
    )
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value)
      }
    }
  }

  return results
}

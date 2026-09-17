/**
 * Tier 2: local daily-bar cache with trading-day freshness + an informational meter.
 *
 * Purpose (the "don't re-pull what I already pulled today" rule):
 *   Daily bars don't change intraday, so once a symbol's latest FINAL bar is
 *   cached it stays fresh until one minute after the next close (see
 *   marketCalendar). Repeated page loads/visits therefore cost ~0 reads —
 *   only STALE symbols are re-read.
 *
 * Where bars come from:
 *   The browser reads bars from Supabase (the `prices` table), which is
 *   CORS-safe. The server-side Edge Function collector is what pulls Tiingo and
 *   populates that table. So the client has no external rate limit to manage;
 *   the cache is purely a freshness/perf optimization over Supabase reads.
 *
 * NOTE: this module used to keep a local "symbols seen this month" meter, but it
 * measured browser-local trivia, not the real Tiingo budget. The monthly
 * unique-symbol budget (500/month) is consumed SERVER-SIDE by the collector and
 * is now surfaced from the actual tracked-symbol count (see
 * fetchActiveSymbolCount in supabaseDailyStore).
 */

import { effectiveTradingDay, isFresh, type TradingDay } from './marketCalendar'
import type { DailyBar } from './tiingo'

/** Max daily bars retained per symbol. ~1 trading year covers sparklines + 20/50-day indicators. */
export const MAX_BARS = 260

// v2: bumped when the freshness-stamping rule changed (stamp the MIN of the
// clock day and the newest bar's real date). v1 entries could be stamped "fresh
// for today" while holding the prior session's last bar; discarding them forces
// a clean re-read under the corrected rule.
const CACHE_KEY = 'rally.dailyCache.v2'

/** Per-symbol cache entry: the bars plus the trading day they were confirmed for. */
export interface CachedSymbol {
  bars: DailyBar[]
  /** The effectiveTradingDay this symbol was last fetched for. Drives freshness. */
  lastFetchedTradingDay: TradingDay
  /** Display name, cached alongside bars to avoid extra metadata calls. */
  name: string
}

type CacheShape = Record<string, CachedSymbol>

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    return null
  }
}

// ---- Cache read/write -----------------------------------------------------

function readCache(): CacheShape {
  return safeParse<CacheShape>(localStorage.getItem(CACHE_KEY)) ?? {}
}

function writeCache(cache: CacheShape): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    // Quota/private-mode errors shouldn't break the feed; cache is best-effort.
  }
}

/** Load cached entries for the requested symbols (missing symbols are omitted). */
export function loadCached(symbols: string[]): Record<string, CachedSymbol> {
  const cache = readCache()
  const out: Record<string, CachedSymbol> = {}
  for (const sym of symbols) {
    if (cache[sym]) out[sym] = cache[sym]
  }
  return out
}

/**
 * Split symbols into those still fresh (skip) and those needing a fetch (stale),
 * given the current effective trading day.
 */
export function partitionByFreshness(
  symbols: string[],
  now: Date = new Date(),
): { fresh: string[]; stale: string[] } {
  const cache = readCache()
  const fresh: string[] = []
  const stale: string[] = []
  for (const sym of symbols) {
    const entry = cache[sym]
    if (entry && entry.bars.length > 0 && isFresh(entry.lastFetchedTradingDay, now)) {
      fresh.push(sym)
    } else {
      stale.push(sym)
    }
  }
  return { fresh, stale }
}

/**
 * Persist freshly fetched bars for a symbol, stamping the effective trading day
 * and recording the symbol against this month's unique-symbol usage.
 */
export function saveSymbol(
  symbol: string,
  bars: DailyBar[],
  name: string,
  now: Date = new Date(),
): void {
  const cache = readCache()
  const trimmed = bars.slice(-MAX_BARS)
  // Freshness must reflect the bars we ACTUALLY hold, not just the clock. If the
  // server-side collector hasn't written today's final bar yet, a read can come
  // back ending on the PRIOR session even though effectiveTradingDay() has
  // already rolled to today. Stamping "today" then would poison the cache: the
  // symbol would be treated as fresh (skipped) for the rest of the day while
  // holding a stale last bar — which is exactly the bug where the Signals price
  // (from this cache) lagged the chart (a direct Supabase read). So stamp the
  // MIN of the clock's effective day and the newest bar's real date: if today's
  // bar is missing, the symbol stays stale and gets re-read next cycle (and the
  // realtime subscription re-reads the moment the collector writes it).
  const clockDay = effectiveTradingDay(now)
  const newestBarDate = trimmed.length > 0 ? trimmed[trimmed.length - 1].date : undefined
  const stampedDay =
    newestBarDate && newestBarDate < clockDay ? newestBarDate : clockDay
  cache[symbol] = {
    bars: trimmed,
    lastFetchedTradingDay: stampedDay,
    name,
  }
  writeCache(cache)
}

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
 * Usage meter:
 *   Informational only — records which symbols were seen this ET month. The
 *   real Tiingo free-tier unique-symbol budget (500/month) is now consumed by
 *   the SERVER-SIDE collector, not the browser. The meter is a rough proxy the
 *   UI can surface, not a hard client cap.
 */

import { currentMonthKey, effectiveTradingDay, isFresh, type TradingDay } from './marketCalendar'
import type { DailyBar } from './tiingo'

/** Reference value for the informational meter (mirrors Tiingo's free unique-symbol/month figure). */
export const MONTHLY_UNIQUE_SYMBOL_CAP = 500

/** Max daily bars retained per symbol. ~1 trading year covers sparklines + 20/50-day indicators. */
export const MAX_BARS = 260

const CACHE_KEY = 'rally.dailyCache.v1'
const USAGE_KEY = 'rally.usage.v1'

/** Per-symbol cache entry: the bars plus the trading day they were confirmed for. */
export interface CachedSymbol {
  bars: DailyBar[]
  /** The effectiveTradingDay this symbol was last fetched for. Drives freshness. */
  lastFetchedTradingDay: TradingDay
  /** Display name, cached alongside bars to avoid extra metadata calls. */
  name: string
}

type CacheShape = Record<string, CachedSymbol>

/** Monthly usage record: which symbols were fetched this ET month + a request counter. */
interface UsageMonth {
  month: string // YYYY-MM (ET)
  uniqueSymbols: string[]
  requests: number
}

export interface UsageSnapshot {
  month: string
  uniqueSymbolCount: number
  requests: number
  cap: number
  /** Unique-symbol budget remaining before hitting the monthly cap. */
  remaining: number
}

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
  cache[symbol] = {
    bars: bars.slice(-MAX_BARS),
    lastFetchedTradingDay: effectiveTradingDay(now),
    name,
  }
  writeCache(cache)
  recordUsage(symbol, now)
}

// ---- Usage meter ----------------------------------------------------------

function readUsage(now: Date): UsageMonth {
  const month = currentMonthKey(now)
  const stored = safeParse<UsageMonth>(localStorage.getItem(USAGE_KEY))
  // Reset automatically when the ET month rolls over.
  if (!stored || stored.month !== month) {
    return { month, uniqueSymbols: [], requests: 0 }
  }
  return stored
}

function writeUsage(usage: UsageMonth): void {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage))
  } catch {
    // Best-effort; the meter is advisory.
  }
}

/** Record one fetch of `symbol` against the current month's usage. */
export function recordUsage(symbol: string, now: Date = new Date()): void {
  const usage = readUsage(now)
  usage.requests += 1
  if (!usage.uniqueSymbols.includes(symbol)) {
    usage.uniqueSymbols.push(symbol)
  }
  writeUsage(usage)
}

/** Current month's usage snapshot for surfacing the remaining budget in the UI. */
export function usageSnapshot(now: Date = new Date()): UsageSnapshot {
  const usage = readUsage(now)
  const uniqueSymbolCount = usage.uniqueSymbols.length
  return {
    month: usage.month,
    uniqueSymbolCount,
    requests: usage.requests,
    cap: MONTHLY_UNIQUE_SYMBOL_CAP,
    remaining: Math.max(0, MONTHLY_UNIQUE_SYMBOL_CAP - uniqueSymbolCount),
  }
}

// NOTE: the browser reads bars from Supabase (our own DB), not Tiingo, so there
// is no client-side per-request budget to gate anymore. The Tiingo free-tier
// unique-symbol budget is now consumed SERVER-SIDE by the Edge Function
// collector. The usage snapshot below is retained as an informational
// "symbols seen this month" meter, not a hard client cap.

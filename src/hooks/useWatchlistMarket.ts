import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadCached,
  partitionByFreshness,
  saveSymbol,
  usageSnapshot,
  type UsageSnapshot,
} from '../data/dailyCache'
import { effectiveTradingDay } from '../data/marketCalendar'
import type { DailyBar } from '../data/tiingo'
import { hasSupabase } from '../data/supabaseClient'
import {
  fetchDailyBarsFromSupabase,
  fetchNameFromSupabase,
} from '../data/supabaseDailyStore'
import { HISTORY_LEN } from '../data/historyStore'
import { INITIAL_STOCKS, MAX_WATCHLIST, type Stock } from '../data/stocks'

export type FeedStatus = 'live' | 'simulated' | 'loading' | 'error'

interface UseWatchlistMarketResult {
  stocks: Stock[]
  flash: Record<string, 'up' | 'down'>
  lastUpdated: Date | null
  status: FeedStatus
  error: string | null
  /** Current month's unique-symbol budget usage (advisory). */
  usage: UsageSnapshot
  /** Force a refresh: re-checks freshness and reads any stale symbols. */
  refresh: () => void
}

/**
 * Derive the app's Stock shape from a symbol's daily bars.
 *
 * Components consume { price, prevClose, history: number[] }, so we map:
 *   - price     = latest session close
 *   - prevClose = prior session close (for the % change column)
 *   - history   = trailing closes (sparkline series), capped to HISTORY_LEN
 */
function barsToStock(symbol: string, name: string, bars: DailyBar[]): Stock {
  const closes = bars.map((b) => b.close)
  const price = closes.at(-1) ?? 0
  const prevClose = closes.at(-2) ?? price
  return {
    symbol,
    name,
    price,
    prevClose,
    history: closes.slice(-HISTORY_LEN),
  }
}

/** Simulated fallback: a stable random-walk when Supabase isn't configured. */
function simulate(symbol: string, prev?: Stock): Stock {
  const seed = INITIAL_STOCKS.find((s) => s.symbol === symbol)
  const prevPrice = prev?.price && prev.price > 0 ? prev.price : undefined
  const base = prevPrice ?? seed?.price ?? 100
  const drift = (Math.random() - 0.5) * base * 0.007
  const price = Number(Math.max(base * 0.5, base + drift).toFixed(2))
  const prevClose = prev?.prevClose && prev.prevClose > 0 ? prev.prevClose : seed?.prevClose ?? base
  const priorHistory = prev?.history ?? []
  const history = [...priorHistory.slice(-(HISTORY_LEN - 1)), price]
  return {
    symbol,
    name: prev?.name ?? seed?.name ?? symbol,
    price,
    prevClose,
    history,
  }
}

/** How often to re-check freshness so the post-close rollover is picked up without a reload. */
const FRESHNESS_CHECK_MS = 60_000

/**
 * Daily market data for a user-defined watchlist of US stocks & ETFs.
 *
 * Data model is DAILY bars (swing trading). The browser reads bars from
 * SUPABASE (the `prices` table), which is CORS-safe — the server-side Edge
 * Function collector is what pulls Tiingo and populates that table. The browser
 * never calls Tiingo directly (Tiingo isn't CORS-enabled).
 *
 * The Tier 2 cache (dailyCache) still sits on top:
 *   - cached bars render instantly on load,
 *   - only STALE symbols (not yet holding the latest final bar) are re-read,
 *   - repeated visits within a trading day cost ~0 reads.
 *
 * When Supabase isn't configured it falls back to a simulated feed so the
 * dashboard still works in development. The symbol list is capped at
 * MAX_WATCHLIST (Tier 1: the primary list, read first).
 */
export function useWatchlistMarket(symbols: string[]): UseWatchlistMarketResult {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [status, setStatus] = useState<FeedStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageSnapshot>(() => usageSnapshot())

  const stocksRef = useRef<Stock[]>([])
  useEffect(() => {
    stocksRef.current = stocks
  }, [stocks])

  const capped = symbols.slice(0, MAX_WATCHLIST)
  const symbolsKey = capped.join(',')

  // Merge a batch of freshly built stocks into state, computing up/down flashes.
  const applyStocks = useCallback((incoming: Stock[]) => {
    setStocks((prev) => {
      const bySym = new Map(prev.map((s) => [s.symbol, s]))
      const nextFlash: Record<string, 'up' | 'down'> = {}
      for (const s of incoming) {
        const before = bySym.get(s.symbol)
        if (before) nextFlash[s.symbol] = s.price >= before.price ? 'up' : 'down'
        bySym.set(s.symbol, s)
      }
      setFlash(nextFlash)
      // Preserve the requested symbol order.
      const order = symbolsKey ? symbolsKey.split(',') : []
      return order.map((sym) => bySym.get(sym)).filter((s): s is Stock => Boolean(s))
    })
    setLastUpdated(new Date())
  }, [symbolsKey])

  const refresh = useCallback(async () => {
    const syms = symbolsKey ? symbolsKey.split(',') : []

    if (syms.length === 0) {
      setStocks([])
      setFlash({})
      setStatus(hasSupabase() ? 'live' : 'simulated')
      return
    }

    // 1) Render cached bars immediately (fresh or not) so the UI isn't empty.
    const cached = loadCached(syms)
    const cachedStocks = syms
      .filter((sym) => cached[sym]?.bars.length)
      .map((sym) => barsToStock(sym, cached[sym].name, cached[sym].bars))
    if (cachedStocks.length) applyStocks(cachedStocks)

    // 2) Supabase not configured -> simulated feed for anything without cache.
    if (!hasSupabase()) {
      const prevBySym = new Map(stocksRef.current.map((s) => [s.symbol, s]))
      const simulated = syms.map((sym) => simulate(sym, prevBySym.get(sym)))
      applyStocks(simulated)
      setStatus('simulated')
      return
    }

    // 3) Only re-read STALE symbols (Tier 2 dedup). Fresh ones already rendered.
    const { stale } = partitionByFreshness(syms)
    if (stale.length === 0) {
      setStatus('live')
      setError(null)
      setUsage(usageSnapshot())
      return
    }

    setStatus('loading')
    let hitError: string | null = null

    // Watchlist order = read priority (Tier 1 first). Reads hit Supabase (our
    // own DB, CORS-safe, no external rate limit), so concurrency can be higher.
    const concurrency = 6
    for (let i = 0; i < stale.length; i += concurrency) {
      const batch = stale.slice(i, i + concurrency)
      const built: Stock[] = []
      await Promise.all(
        batch.map(async (sym) => {
          try {
            const [bars, name] = await Promise.all([
              fetchDailyBarsFromSupabase(sym),
              resolveName(sym, cached[sym]?.name),
            ])
            if (bars.length === 0) return // no rows yet (collector hasn't run): skip
            saveSymbol(sym, bars, name)
            built.push(barsToStock(sym, name, bars))
          } catch (e) {
            hitError = e instanceof Error ? e.message : 'Failed to read daily bars.'
          }
        }),
      )
      if (built.length) applyStocks(built)
      setUsage(usageSnapshot())
    }

    if (hitError) {
      setStatus('error')
      setError(hitError)
    } else {
      setStatus('live')
      setError(null)
    }
  }, [symbolsKey, applyStocks])

  // Initial load + refresh whenever the symbol set changes.
  useEffect(() => {
    let cancelled = false
    const kickoff = window.setTimeout(() => {
      if (!cancelled) void refresh()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(kickoff)
    }
  }, [refresh])

  // Lightweight periodic freshness re-check: when the effective trading day
  // rolls over (1 min after close), stale symbols get re-read without a reload.
  useEffect(() => {
    let lastDay = effectiveTradingDay()
    const id = window.setInterval(() => {
      const day = effectiveTradingDay()
      if (day !== lastDay) {
        lastDay = day
        void refresh()
      }
    }, FRESHNESS_CHECK_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  return { stocks, flash, lastUpdated, status, error, usage, refresh }
}

/** Resolve a display name: prefer cached, else look it up in Supabase (best-effort). */
async function resolveName(symbol: string, cachedName?: string): Promise<string> {
  if (cachedName && cachedName !== symbol) return cachedName
  const name = await fetchNameFromSupabase(symbol)
  return name ?? symbol
}

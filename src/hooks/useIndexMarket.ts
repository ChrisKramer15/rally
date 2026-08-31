import { useCallback, useEffect, useState } from 'react'
import {
  loadCached,
  partitionByFreshness,
  saveSymbol,
} from '../data/dailyCache'
import { effectiveTradingDay } from '../data/marketCalendar'
import type { DailyBar } from '../data/tiingo'
import { hasSupabase } from '../data/supabaseClient'
import { fetchDailyBarsFromSupabase } from '../data/supabaseDailyStore'
import { HISTORY_LEN } from '../data/historyStore'
import { INDEX_PROXIES, INITIAL_INDICES, type IndexQuote } from '../data/stocks'

type FeedStatus = 'live' | 'simulated' | 'loading' | 'error'

interface UseIndexMarketResult {
  indices: IndexQuote[]
  status: FeedStatus
}

/** Map a proxy ETF's daily bars to the IndexQuote shape the card consumes. */
function barsToIndex(symbol: string, label: string, bars: DailyBar[]): IndexQuote {
  const closes = bars.map((b) => b.close)
  const value = closes.at(-1) ?? 0
  const prevClose = closes.at(-2) ?? value
  return {
    symbol,
    name: label,
    value,
    prevClose,
    history: closes.slice(-HISTORY_LEN),
  }
}

/** Simulated fallback quote for a proxy when Supabase isn't configured. */
function simulatedIndex(symbol: string, label: string): IndexQuote {
  // Reuse the old seed rows for a plausible-looking demo value if present.
  const seed = INITIAL_INDICES.find((i) => i.name === label)
  const base = seed?.value ?? 100
  return {
    symbol,
    name: label,
    value: base,
    prevClose: seed?.prevClose ?? base,
    history: seed?.history ?? [base],
  }
}

const FRESHNESS_CHECK_MS = 60_000

// Module-level (INDEX_PROXIES is constant), so no per-render allocation.
const LABEL_BY_SYMBOL = new Map(INDEX_PROXIES.map((p) => [p.symbol, p.label]))
const labelFor = (symbol: string): string => LABEL_BY_SYMBOL.get(symbol) ?? symbol

/**
 * Daily data for the broad-market index cards, via ETF proxies (SPY/QQQ/DIA)
 * read from Supabase through the same pipeline + trading-day cache as the
 * watchlist. Falls back to a simulated snapshot when Supabase is unconfigured.
 */
export function useIndexMarket(): UseIndexMarketResult {
  const [indices, setIndices] = useState<IndexQuote[]>([])
  const [status, setStatus] = useState<FeedStatus>('loading')

  // Stable key so the effect doesn't re-fire on every render. INDEX_PROXIES is a
  // module constant, so this is effectively constant.
  const symbolsKey = INDEX_PROXIES.map((p) => p.symbol).join(',')

  // Preserve the configured proxy order regardless of fetch completion order.
  const orderIndices = useCallback(
    (list: IndexQuote[]) => {
      const bySym = new Map(list.map((q) => [q.symbol, q]))
      return symbolsKey
        .split(',')
        .map((sym) => bySym.get(sym))
        .filter((q): q is IndexQuote => Boolean(q))
    },
    [symbolsKey],
  )

  const refresh = useCallback(async () => {
    const syms = symbolsKey.split(',')

    // 1) Render cached proxy bars immediately.
    const cached = loadCached(syms)
    const cachedQuotes = syms
      .filter((sym) => cached[sym]?.bars.length)
      .map((sym) => barsToIndex(sym, labelFor(sym), cached[sym].bars))
    if (cachedQuotes.length) setIndices((prev) => orderIndices([...prev, ...cachedQuotes]))

    // 2) No Supabase -> simulated snapshot.
    if (!hasSupabase()) {
      setIndices(orderIndices(syms.map((sym) => simulatedIndex(sym, labelFor(sym)))))
      setStatus('simulated')
      return
    }

    // 3) Read only stale proxies.
    const { stale } = partitionByFreshness(syms)
    if (stale.length === 0) {
      setStatus('live')
      return
    }

    setStatus('loading')
    let hitError = false
    const built: IndexQuote[] = []
    await Promise.all(
      stale.map(async (sym) => {
        try {
          const bars = await fetchDailyBarsFromSupabase(sym)
          if (bars.length === 0) return
          const label = labelFor(sym)
          saveSymbol(sym, bars, label)
          built.push(barsToIndex(sym, label, bars))
        } catch {
          hitError = true
        }
      }),
    )
    if (built.length) setIndices((prev) => orderIndices([...prev, ...built]))
    setStatus(hitError ? 'error' : 'live')
  }, [symbolsKey, orderIndices])

  // Initial load.
  useEffect(() => {
    let cancelled = false
    const id = window.setTimeout(() => {
      if (!cancelled) void refresh()
    }, 0)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [refresh])

  // Pick up the post-close trading-day rollover without a reload.
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

  return { indices, status }
}

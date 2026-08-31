import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchQuotes, hasFinnhubKey } from '../data/finnhub'
import { HISTORY_LEN, historyStore, type SymbolHistory } from '../data/historyStore'
import { INITIAL_STOCKS, MAX_WATCHLIST, type Stock } from '../data/stocks'

export type FeedStatus = 'live' | 'simulated' | 'loading' | 'error'

interface UseWatchlistMarketResult {
  stocks: Stock[]
  flash: Record<string, 'up' | 'down'>
  lastUpdated: Date | null
  status: FeedStatus
  error: string | null
  /** Force an immediate refresh outside the 60s cycle. */
  refresh: () => void
}

/** Simulated fallback: nudges a seed price when no API key is configured. */
function simulate(symbol: string, prev?: Stock): Stock {
  const seed = INITIAL_STOCKS.find((s) => s.symbol === symbol)
  // Treat a non-positive prev price as "no price" (e.g. a history-only placeholder).
  const prevPrice = prev?.price && prev.price > 0 ? prev.price : undefined
  const base = prevPrice ?? seed?.price ?? 100
  const drift = (Math.random() - 0.5) * base * 0.007
  const price = Number(Math.max(base * 0.5, base + drift).toFixed(2))
  const prevClose =
    prev?.prevClose && prev.prevClose > 0 ? prev.prevClose : seed?.prevClose ?? base
  // Real points only: append to prior history (empty on first tick).
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

/**
 * Live market data for a user-defined watchlist.
 *
 * Polls Finnhub every `intervalMs` (default 60s) for the given symbols. When no
 * Finnhub key is configured, it transparently falls back to a simulated feed so
 * the dashboard still works in development.
 *
 * The symbol list is capped at MAX_WATCHLIST to stay within the free-tier rate limit.
 */
export function useWatchlistMarket(
  symbols: string[],
  intervalMs = 60_000,
): UseWatchlistMarketResult {
  const [stocks, setStocks] = useState<Stock[]>([])
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [status, setStatus] = useState<FeedStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  // Keep the latest stocks in a ref so the poller can read history without
  // being re-created on every data change (which would reset the interval).
  const stocksRef = useRef<Stock[]>([])
  useEffect(() => {
    stocksRef.current = stocks
  }, [stocks])

  // Persisted history, hydrated from the store. The poller reads this so the
  // first fetch after load continues the saved series instead of starting blank.
  const hydratedRef = useRef<SymbolHistory>({})

  const capped = symbols.slice(0, MAX_WATCHLIST)
  // Stable key so the effect only re-runs when the actual symbol set changes.
  const symbolsKey = capped.join(',')

  // Rehydrate persisted history whenever the symbol set changes.
  useEffect(() => {
    let cancelled = false
    const syms = symbolsKey ? symbolsKey.split(',') : []
    void historyStore.load(syms).then((h) => {
      if (!cancelled) hydratedRef.current = h
    })
    return () => {
      cancelled = true
    }
  }, [symbolsKey])

  const applyResults = useCallback((next: Stock[], prev: Stock[]) => {
    const prevBySym = new Map(prev.map((s) => [s.symbol, s]))
    const nextFlash: Record<string, 'up' | 'down'> = {}
    for (const s of next) {
      const before = prevBySym.get(s.symbol)
      if (before) {
        nextFlash[s.symbol] = s.price >= before.price ? 'up' : 'down'
      }
    }
    setStocks(next)
    setFlash(nextFlash)
    setLastUpdated(new Date())

    // Persist the freshly accumulated history (store applies the rolling cap).
    const toSave: SymbolHistory = {}
    for (const s of next) toSave[s.symbol] = s.history
    // Keep the in-memory hydration cache in sync for the next poll.
    hydratedRef.current = { ...hydratedRef.current, ...toSave }
    void historyStore.save(toSave)
  }, [])

  // Resolve the prior history for a symbol: prefer the live in-memory series,
  // else fall back to persisted history hydrated from the store.
  const priorHistoryFor = useCallback((symbol: string, live?: number[]): number[] => {
    if (live && live.length > 0) return live
    return hydratedRef.current[symbol] ?? []
  }, [])

  const poll = useCallback(async () => {
    const syms = symbolsKey ? symbolsKey.split(',') : []
    const prev = stocksRef.current

    if (syms.length === 0) {
      setStocks([])
      setFlash({})
      setStatus(hasFinnhubKey() ? 'live' : 'simulated')
      return
    }

    if (!hasFinnhubKey()) {
      const prevBySym = new Map(prev.map((s) => [s.symbol, s]))
      const next = syms.map((sym) => {
        const before = prevBySym.get(sym)
        // Ensure the simulated stock carries forward persisted history too.
        const withHistory = before
          ? { ...before, history: priorHistoryFor(sym, before.history) }
          : { symbol: sym, name: sym, price: 0, prevClose: 0, history: priorHistoryFor(sym) }
        return simulate(sym, withHistory)
      })
      applyResults(next, prev)
      setStatus('simulated')
      return
    }

    try {
      const prevBySym = Object.fromEntries(
        prev.map((s) => [s.symbol, s]),
      )
      const priorForFetch = Object.fromEntries(
        syms.map((sym) => [
          sym,
          {
            history: priorHistoryFor(sym, prevBySym[sym]?.history),
            name: prevBySym[sym]?.name ?? sym,
          },
        ]),
      )
      const next = await fetchQuotes(syms, priorForFetch)
      applyResults(next, prev)
      setStatus('live')
      setError(null)
    } catch (e) {
      setStatus('error')
      setError(e instanceof Error ? e.message : 'Failed to fetch quotes.')
    }
  }, [symbolsKey, applyResults, priorHistoryFor])

  useEffect(() => {
    let cancelled = false
    // Immediate first fetch (deferred so state updates land after render),
    // then repeat on the interval.
    const kickoff = window.setTimeout(() => {
      if (!cancelled) void poll()
    }, 0)
    const id = window.setInterval(() => {
      if (!cancelled) void poll()
    }, intervalMs)
    return () => {
      cancelled = true
      window.clearTimeout(kickoff)
      window.clearInterval(id)
    }
  }, [poll, intervalMs])

  return { stocks, flash, lastUpdated, status, error, refresh: poll }
}

import { useEffect, useRef, useState } from 'react'
import { subscribeQuotes, type QuoteSnapshot, type SchedulerStatus } from '../data/liveQuoteScheduler'
import type { LiveQuote } from '../data/finnhub'

export interface UseLiveQuotesResult {
  /** Latest live quote per symbol (UPPERCASE keys). Empty when disabled/idle. */
  quotes: Map<string, LiveQuote>
  /** Scheduler state: disabled (no token) / idle / polling / closed (market shut). */
  status: SchedulerStatus
  /** Last successful full refresh cycle (ms epoch), or null. */
  lastCycleAt: number | null
  /** Convenience: live price for a symbol, or null when we have none. */
  priceFor: (symbol: string) => number | null
}

/**
 * Subscribe to near-real-time Finnhub quotes for a set of symbols via the shared
 * app-wide scheduler (which owns the rate-limit budget). Re-subscribes the
 * symbol set whenever it changes; the scheduler de-dupes across all consumers so
 * two hooks asking for the same symbol cost one request.
 *
 * Returns null prices (empty map) when no token is configured or the market is
 * closed — callers fall back to the Tiingo daily close they already use.
 *
 * @param symbols the symbols to watch. Caller is responsible for capping the
 *   count (e.g. the top-N signals cap); the scheduler enforces a hard backstop.
 */
export function useLiveQuotes(symbols: string[]): UseLiveQuotesResult {
  const [snap, setSnap] = useState<QuoteSnapshot>({
    quotes: new Map(),
    status: 'idle',
    lastCycleAt: null,
    lastError: null,
  })

  // Stable join key so the effect only re-runs when the SET of symbols changes,
  // not on every render that produces an equal array.
  const key = symbols.map((s) => s.toUpperCase()).sort().join(',')

  // Hold the live subscription handle across renders.
  const handleRef = useRef<ReturnType<typeof subscribeQuotes> | null>(null)

  useEffect(() => {
    const syms = key ? key.split(',') : []
    if (!handleRef.current) {
      handleRef.current = subscribeQuotes(syms, setSnap)
    } else {
      handleRef.current.update(syms)
    }
  }, [key])

  // Tear the subscription down on unmount (separate effect so it doesn't run on
  // every symbol change — the update() path above handles those).
  useEffect(() => {
    return () => {
      handleRef.current?.unsubscribe()
      handleRef.current = null
    }
  }, [])

  return {
    quotes: snap.quotes,
    status: snap.status,
    lastCycleAt: snap.lastCycleAt,
    priceFor: (symbol: string) => snap.quotes.get(symbol.toUpperCase())?.price ?? null,
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchLatestQuotes, subscribeToQuoteUpdates } from '../data/intradayQuotesStore'
import { hasSupabase } from '../data/supabaseClient'
import { isRegularSessionOpen } from '../data/marketCalendar'
import type { LiveQuote } from '../data/finnhub'

/** Scheduler state, kept from the previous Finnhub-scheduler API for consumers. */
export type SchedulerStatus = 'disabled' | 'idle' | 'polling' | 'closed'

export interface UseLiveQuotesResult {
  /** Latest live quote per symbol (UPPERCASE keys). Empty when disabled/idle. */
  quotes: Map<string, LiveQuote>
  /** Feed state: disabled (no Supabase) / idle (no symbols) / polling / closed (market shut). */
  status: SchedulerStatus
  /** Last successful refresh (ms epoch), or null. */
  lastCycleAt: number | null
  /** Convenience: live price for a symbol, or null when we have none. */
  priceFor: (symbol: string) => number | null
}

/**
 * How often to re-read the latest quotes from the DB while the market is open.
 * The settler writes once a minute, so ~30s polling keeps the UI within a
 * minute of the freshest row without hammering PostgREST. A Realtime insert
 * event also triggers an immediate re-read, so this interval is just a backstop.
 */
const POLL_INTERVAL_MS = 30_000

/**
 * Subscribe to near-real-time quotes for a set of symbols by READING the
 * Supabase `intraday_quotes` table — the quotes the settle-positions Edge
 * Function captures every minute. The browser no longer calls Finnhub directly;
 * this removes the browser/server rate-limit collision entirely.
 *
 * The public shape matches the previous Finnhub-scheduler-backed hook, so
 * consumers (App.tsx's overlay) need no changes. Returns an empty map (and a
 * disabled/idle/closed status) when Supabase is unconfigured, no symbols are
 * requested, or the market is closed — callers fall back to the Tiingo daily
 * close they already use.
 *
 * @param symbols the symbols to watch (typically open/pending positions).
 */
export function useLiveQuotes(symbols: string[]): UseLiveQuotesResult {
  const [quotes, setQuotes] = useState<Map<string, LiveQuote>>(new Map())
  const [lastCycleAt, setLastCycleAt] = useState<number | null>(null)

  // Stable join key so effects only re-run when the SET of symbols changes,
  // and a memoized array derived from it (no ref mutation during render).
  const key = symbols.map((s) => s.toUpperCase()).sort().join(',')
  const symbolList = useMemo(() => (key ? key.split(',') : []), [key])

  // Mirror the latest list into a ref inside an effect so the poll/realtime
  // callbacks read the current set without re-subscribing on every change.
  const symbolsRef = useRef<string[]>(symbolList)
  useEffect(() => {
    symbolsRef.current = symbolList
  }, [symbolList])

  const refresh = useCallback(async () => {
    const syms = symbolsRef.current
    if (!hasSupabase() || syms.length === 0 || !isRegularSessionOpen()) {
      // Nothing to fetch — leave the last known quotes in place rather than
      // clearing them, so a brief close/empty window doesn't blank the UI.
      return
    }
    const map = await fetchLatestQuotes(syms)
    setQuotes(map)
    setLastCycleAt(Date.now())
  }, [])

  // Re-read on symbol-set change + on a slow poll while mounted.
  useEffect(() => {
    // Defer the initial read a tick so we don't setState synchronously in the
    // effect body (mirrors the pattern in usePipelineRuns).
    const kick = window.setTimeout(() => void refresh(), 0)
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => {
      window.clearTimeout(kick)
      window.clearInterval(id)
    }
  }, [key, refresh])

  // Re-read immediately when the settler writes a fresh batch (Realtime).
  useEffect(() => {
    if (!hasSupabase()) return
    const unsubscribe = subscribeToQuoteUpdates(() => void refresh())
    return unsubscribe
  }, [refresh])

  const status: SchedulerStatus = !hasSupabase()
    ? 'disabled'
    : !isRegularSessionOpen()
      ? 'closed'
      : symbolList.length === 0
        ? 'idle'
        : 'polling'

  return {
    quotes,
    status,
    lastCycleAt,
    priceFor: (symbol: string) => quotes.get(symbol.toUpperCase())?.price ?? null,
  }
}

import { useEffect, useState } from 'react'
import { subscribeQuotes } from '../data/liveQuoteScheduler'
import { hasFinnhub, type LiveQuote } from '../data/finnhub'
import { isRegularSessionOpen } from '../data/marketCalendar'

/** A single probe symbol to prove the Finnhub feed is alive (liquid, always priced). */
const PROBE_SYMBOL = 'SPY'
/** A quote older than this (ms) while the market is open means the feed is stale. */
const STALE_AFTER_MS = 90_000

export type FinnhubHealthStatus =
  | 'unconfigured' // no token set
  | 'closed' // market shut — nothing to poll, not an error
  | 'ok' // recent quote received
  | 'stale' // configured + open but no fresh quote (rate-limited / degraded)
  | 'error' // last cycle reported an error

export interface FinnhubHealth {
  status: FinnhubHealthStatus
  /** Last probe price, if any. */
  price: number | null
  /** When the last probe quote was fetched (ms epoch), or null. */
  lastCheck: number | null
}

/**
 * Health indicator for the Finnhub real-time feed, for the Data Pipeline page.
 *
 * This is ADDITIVE — it sits alongside the existing Tiingo collector health and
 * replaces nothing. It subscribes ONE probe symbol (SPY) through the same shared
 * scheduler, so it costs at most one extra request per cycle and is paced by the
 * same budget as everything else.
 *
 * Status reflects the real state: unconfigured (no token), closed (market shut,
 * expected), ok (fresh quote), stale (open but no fresh quote — likely rate-
 * limited or degraded), or error.
 */
export function useFinnhubHealth(): FinnhubHealth {
  const [probe, setProbe] = useState<LiveQuote | null>(null)
  const [hadError, setHadError] = useState(false)
  // Current wall-clock, refreshed on each probe and on a slow timer, so 'ok' can
  // decay to 'stale' from the passage of time. Kept in state (not read via
  // Date.now() during render) so the render stays pure.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!hasFinnhub()) return
    const handle = subscribeQuotes([PROBE_SYMBOL], (snap) => {
      const q = snap.quotes.get(PROBE_SYMBOL)
      if (q) setProbe(q)
      setHadError(Boolean(snap.lastError) && snap.status === 'polling')
      setNow(Date.now())
    })
    return () => handle.unsubscribe()
  }, [])

  // Re-evaluate staleness on a slow timer while configured.
  useEffect(() => {
    if (!hasFinnhub()) return
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  let status: FinnhubHealthStatus
  if (!hasFinnhub()) {
    status = 'unconfigured'
  } else if (!isRegularSessionOpen(new Date(now))) {
    status = 'closed'
  } else if (probe && now - probe.fetchedAt <= STALE_AFTER_MS) {
    status = 'ok'
  } else if (hadError) {
    status = 'error'
  } else {
    status = 'stale'
  }

  return {
    status,
    price: probe?.price ?? null,
    lastCheck: probe?.fetchedAt ?? null,
  }
}

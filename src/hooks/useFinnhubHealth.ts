import { useCallback, useEffect, useState } from 'react'
import { getSupabase, hasSupabase } from '../data/supabaseClient'
import { isRegularSessionOpen } from '../data/marketCalendar'

/** A quote older than this (ms) while the market is open means the feed is stale. */
const STALE_AFTER_MS = 180_000
/** How often to re-check feed freshness while the market is open. */
const POLL_INTERVAL_MS = 30_000

export type FinnhubHealthStatus =
  | 'unconfigured' // no Supabase configured — can't read the quote feed
  | 'closed' // market shut — nothing being written, not an error
  | 'ok' // a recent quote row exists
  | 'stale' // configured + open but the newest quote is old (settler degraded)
  | 'error' // the freshness read itself failed

export interface FinnhubHealth {
  status: FinnhubHealthStatus
  /** Newest quote price seen, if any. */
  price: number | null
  /** The symbol that newest quote belongs to, if any. */
  symbol: string | null
  /** When that newest quote was captured (ms epoch), or null. */
  lastCheck: number | null
}

/**
 * Health indicator for the near-real-time quote feed, for the Data Pipeline
 * page.
 *
 * The browser no longer probes Finnhub directly. Instead the settle-positions
 * Edge Function captures quotes every minute into `intraday_quotes`; this hook
 * reads the single freshest row from that table to judge whether the feed is
 * alive. So "Live" here means "the server settler is writing fresh quotes,"
 * which is the thing that actually matters now.
 *
 * Status: unconfigured (no Supabase), closed (market shut, expected), ok (a
 * quote within the freshness window), stale (open but newest quote is old —
 * settler likely degraded or no active positions), or error (read failed).
 *
 * Note: with no open/pending positions there are no fresh rows, so the feed
 * will read 'stale' during market hours. That's accurate — nothing is being
 * quoted because nothing needs settling.
 */
export function useFinnhubHealth(): FinnhubHealth {
  const [price, setPrice] = useState<number | null>(null)
  const [symbol, setSymbol] = useState<string | null>(null)
  const [lastCheck, setLastCheck] = useState<number | null>(null)
  const [hadError, setHadError] = useState(false)
  // Current wall-clock, refreshed on each read and on a slow timer, so 'ok' can
  // decay to 'stale' from the passage of time. Kept in state so render stays pure.
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) return
    const { data, error } = await supabase
      .from('intraday_quotes')
      .select('symbol,price,quoted_at')
      .order('quoted_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setNow(Date.now())
    if (error) {
      setHadError(true)
      return
    }
    setHadError(false)
    const row = data as { symbol: string; price: number | string; quoted_at: string } | null
    if (row) {
      const p = typeof row.price === 'number' ? row.price : Number(row.price)
      setPrice(Number.isFinite(p) ? p : null)
      setSymbol(row.symbol?.toUpperCase() ?? null)
      setLastCheck(new Date(row.quoted_at).getTime())
    }
  }, [])

  useEffect(() => {
    if (!hasSupabase()) return
    // Defer the initial read a tick so we don't setState synchronously in the
    // effect body (mirrors the pattern in usePipelineRuns).
    const kick = window.setTimeout(() => void refresh(), 0)
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    return () => {
      window.clearTimeout(kick)
      window.clearInterval(id)
    }
  }, [refresh])

  // Re-evaluate staleness on a slow timer while configured (so time passing can
  // flip 'ok' → 'stale' even without a new read).
  useEffect(() => {
    if (!hasSupabase()) return
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  let status: FinnhubHealthStatus
  if (!hasSupabase()) {
    status = 'unconfigured'
  } else if (!isRegularSessionOpen(new Date(now))) {
    status = 'closed'
  } else if (lastCheck != null && now - lastCheck <= STALE_AFTER_MS) {
    status = 'ok'
  } else if (hadError) {
    status = 'error'
  } else {
    status = 'stale'
  }

  return { status, price, symbol, lastCheck }
}

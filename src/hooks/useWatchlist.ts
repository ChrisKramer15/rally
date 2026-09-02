import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_SYMBOLS, MAX_WATCHLIST, parseTickers } from '../data/stocks'
import { fetchWatchlist, syncWatchlist } from '../data/supabaseDailyStore'

const STORAGE_KEY = 'rally.watchlist'

function loadSymbols(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SYMBOLS
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
      // Re-run through parseTickers to enforce format + cap on stored data.
      const clean = parseTickers(parsed.join(','))
      return clean.length > 0 ? clean : DEFAULT_SYMBOLS
    }
  } catch {
    // Corrupt/unavailable storage falls back to defaults.
  }
  return DEFAULT_SYMBOLS
}

function persistLocal(symbols: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols))
  } catch {
    // Persistence is best-effort; in-memory state still updates.
  }
}

/**
 * Watchlist symbol state.
 *
 * Source of truth is the shared Supabase `watchlist` table so every device
 * (web + mobile) converges on the same list. localStorage is kept as a fast
 * initial-render cache and offline fallback:
 *
 *   1. On mount we render the local list immediately (no network wait), then
 *      hydrate from Supabase and adopt that list when it differs.
 *   2. On save we update local state + localStorage right away and reconcile the
 *      shared table (activate current symbols, deactivate removed ones) so the
 *      collector only pulls symbols currently on the list.
 *
 * Capped at MAX_WATCHLIST. This is the single source both the live feed and the
 * editor read.
 */
export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(loadSymbols)

  // Guards a race: if the user edits before the initial Supabase hydrate lands,
  // don't let the remote list clobber their fresh local edit.
  const editedRef = useRef(false)

  const save = useCallback((next: string[]) => {
    editedRef.current = true
    const capped = next.slice(0, MAX_WATCHLIST)
    setSymbols(capped)
    persistLocal(capped)
    // Reconcile with Supabase so the daily collector tracks exactly this list.
    // Fire and forget: the local save must never wait on (or fail because of)
    // the network.
    void syncWatchlist(capped)
  }, [])

  // Hydrate from the shared table once on mount. If it returns a list and the
  // user hasn't edited in the meantime, adopt it as the source of truth.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const remote = await fetchWatchlist()
      if (cancelled || editedRef.current || remote.length === 0) return
      const remoteSymbols = parseTickers(remote.map((r) => r.symbol).join(','))
      if (remoteSymbols.length === 0) return
      setSymbols((prev) => {
        // Only replace when the remote list actually differs, to avoid a
        // needless re-render/refetch when both sides already agree.
        const same =
          prev.length === remoteSymbols.length &&
          prev.every((s, i) => s === remoteSymbols[i])
        if (same) return prev
        persistLocal(remoteSymbols)
        return remoteSymbols
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return { symbols, setSymbols: save }
}

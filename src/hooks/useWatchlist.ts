import { useCallback, useState } from 'react'
import { DEFAULT_SYMBOLS, MAX_WATCHLIST, parseTickers } from '../data/stocks'

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

/**
 * Watchlist symbol state, persisted to localStorage and capped at MAX_WATCHLIST.
 * This is the single source of truth that both the live feed and the editor read.
 */
export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(loadSymbols)

  const save = useCallback((next: string[]) => {
    const capped = next.slice(0, MAX_WATCHLIST)
    setSymbols(capped)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(capped))
    } catch {
      // Persistence is best-effort; in-memory state still updates.
    }
  }, [])

  return { symbols, setSymbols: save }
}

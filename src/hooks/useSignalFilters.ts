import { useCallback, useEffect, useState } from 'react'

/**
 * User-controlled filters for the Signals (Explosive Moves) page.
 *
 * These are separate from the *actionability* rules (freshness + tradeable
 * zone) that the page always enforces. They narrow the visible signals to what
 * the user wants to see and persist across reloads/app restarts via
 * localStorage — matching the persistence idiom used by useBacktestPortfolio /
 * useWatchlist (lazy `useState` init + `useEffect` save).
 */

/** Grade filter: any, or only A+ / only strong. */
export type GradeFilter = 'all' | 'A+' | 'strong'

/** Direction filter derived from the sign of the move's change %. */
export type DirectionFilter = 'all' | 'up' | 'down'

export interface SignalFilters {
  /** Show only this grade (or all). */
  grade: GradeFilter
  /** Show only up / down moves (or all). */
  direction: DirectionFilter
  /** Minimum move size in ATR multiples. 0 = no floor. */
  minAtr: number
  /** Minimum relative volume. 0 = no floor. */
  minRelVolume: number
}

export const DEFAULT_FILTERS: SignalFilters = {
  grade: 'all',
  direction: 'all',
  minAtr: 0,
  minRelVolume: 0,
}

const STORAGE_KEY = 'rally.signalFilters.v1'

function loadFilters(): SignalFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SignalFilters>
      return {
        grade:
          parsed.grade === 'A+' || parsed.grade === 'strong' ? parsed.grade : 'all',
        direction:
          parsed.direction === 'up' || parsed.direction === 'down'
            ? parsed.direction
            : 'all',
        minAtr:
          typeof parsed.minAtr === 'number' && Number.isFinite(parsed.minAtr) && parsed.minAtr >= 0
            ? parsed.minAtr
            : 0,
        minRelVolume:
          typeof parsed.minRelVolume === 'number' &&
          Number.isFinite(parsed.minRelVolume) &&
          parsed.minRelVolume >= 0
            ? parsed.minRelVolume
            : 0,
      }
    }
  } catch {
    // Corrupt/unavailable storage falls back to defaults.
  }
  return { ...DEFAULT_FILTERS }
}

function persist(filters: SignalFilters): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // Best-effort; in-memory state still updates.
  }
}

export interface UseSignalFiltersResult {
  filters: SignalFilters
  setGrade: (grade: GradeFilter) => void
  setDirection: (direction: DirectionFilter) => void
  setMinAtr: (minAtr: number) => void
  setMinRelVolume: (minRelVolume: number) => void
  clearFilters: () => void
  /** True when any filter differs from the defaults (something is being hidden). */
  isActive: boolean
}

/**
 * Persistent Signals-page filter state. The chosen filters stay put until the
 * user changes them or hits "Clear filters", surviving app restarts.
 */
export function useSignalFilters(): UseSignalFiltersResult {
  const [filters, setFilters] = useState<SignalFilters>(loadFilters)

  useEffect(() => {
    persist(filters)
  }, [filters])

  const setGrade = useCallback((grade: GradeFilter) => {
    setFilters((f) => ({ ...f, grade }))
  }, [])

  const setDirection = useCallback((direction: DirectionFilter) => {
    setFilters((f) => ({ ...f, direction }))
  }, [])

  const setMinAtr = useCallback((minAtr: number) => {
    setFilters((f) => ({
      ...f,
      minAtr: Number.isFinite(minAtr) && minAtr >= 0 ? minAtr : 0,
    }))
  }, [])

  const setMinRelVolume = useCallback((minRelVolume: number) => {
    setFilters((f) => ({
      ...f,
      minRelVolume: Number.isFinite(minRelVolume) && minRelVolume >= 0 ? minRelVolume : 0,
    }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS })
  }, [])

  const isActive =
    filters.grade !== DEFAULT_FILTERS.grade ||
    filters.direction !== DEFAULT_FILTERS.direction ||
    filters.minAtr !== DEFAULT_FILTERS.minAtr ||
    filters.minRelVolume !== DEFAULT_FILTERS.minRelVolume

  return {
    filters,
    setGrade,
    setDirection,
    setMinAtr,
    setMinRelVolume,
    clearFilters,
    isActive,
  }
}

/** Apply the user filters to a single signal. Returns true when it should show. */
export function matchesFilters(
  filters: SignalFilters,
  candle: { grade: 'A+' | 'strong'; changePct: number; atrMultiple: number; relVolume: number },
): boolean {
  if (filters.grade !== 'all' && candle.grade !== filters.grade) return false
  if (filters.direction === 'up' && candle.changePct < 0) return false
  if (filters.direction === 'down' && candle.changePct >= 0) return false
  if (filters.minAtr > 0 && candle.atrMultiple < filters.minAtr) return false
  if (filters.minRelVolume > 0 && candle.relVolume < filters.minRelVolume) return false
  return true
}

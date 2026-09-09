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

/** Zone-quality filter: any, or only A+ / good / weak supply-demand zones. */
export type ZoneGradeFilter = 'all' | 'A+' | 'good' | 'weak'

export interface SignalFilters {
  /** Show only this grade (or all). */
  grade: GradeFilter
  /** Show only up / down moves (or all). */
  direction: DirectionFilter
  /** Minimum move size in ATR multiples. 0 = no floor. */
  minAtr: number
  /** Minimum relative volume. 0 = no floor. */
  minRelVolume: number
  /** Minimum reward:risk at the zone's proximal entry. 0 = no floor. */
  minRr: number
  /** Show only signals whose supply/demand zone is this quality (or all). */
  zoneGrade: ZoneGradeFilter
}

export const DEFAULT_FILTERS: SignalFilters = {
  grade: 'all',
  direction: 'all',
  minAtr: 0,
  minRelVolume: 0,
  minRr: 0,
  zoneGrade: 'all',
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
        minRr:
          typeof parsed.minRr === 'number' && Number.isFinite(parsed.minRr) && parsed.minRr >= 0
            ? parsed.minRr
            : 0,
        zoneGrade:
          parsed.zoneGrade === 'A+' ||
          parsed.zoneGrade === 'good' ||
          parsed.zoneGrade === 'weak'
            ? parsed.zoneGrade
            : 'all',
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
  setMinRr: (minRr: number) => void
  setZoneGrade: (zoneGrade: ZoneGradeFilter) => void
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

  const setMinRr = useCallback((minRr: number) => {
    setFilters((f) => ({
      ...f,
      minRr: Number.isFinite(minRr) && minRr >= 0 ? minRr : 0,
    }))
  }, [])

  const setZoneGrade = useCallback((zoneGrade: ZoneGradeFilter) => {
    setFilters((f) => ({ ...f, zoneGrade }))
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({ ...DEFAULT_FILTERS })
  }, [])

  const isActive =
    filters.grade !== DEFAULT_FILTERS.grade ||
    filters.direction !== DEFAULT_FILTERS.direction ||
    filters.minAtr !== DEFAULT_FILTERS.minAtr ||
    filters.minRelVolume !== DEFAULT_FILTERS.minRelVolume ||
    filters.minRr !== DEFAULT_FILTERS.minRr ||
    filters.zoneGrade !== DEFAULT_FILTERS.zoneGrade

  return {
    filters,
    setGrade,
    setDirection,
    setMinAtr,
    setMinRelVolume,
    setMinRr,
    setZoneGrade,
    clearFilters,
    isActive,
  }
}

/** Zone-quality + reward:risk context for a signal, resolved by the caller. */
export interface SignalZoneContext {
  /** Quality of the signal's supply/demand zone, if any. */
  zoneGrade?: 'A+' | 'good' | 'weak' | null
  /** Reward:risk at the zone's proximal entry, or null when not computable. */
  rr?: number | null
}

/** Apply the user filters to a single signal. Returns true when it should show. */
export function matchesFilters(
  filters: SignalFilters,
  candle: { grade: 'A+' | 'strong'; changePct: number; atrMultiple: number; relVolume: number },
  zone: SignalZoneContext = {},
): boolean {
  if (filters.grade !== 'all' && candle.grade !== filters.grade) return false
  if (filters.direction === 'up' && candle.changePct < 0) return false
  if (filters.direction === 'down' && candle.changePct >= 0) return false
  if (filters.minAtr > 0 && candle.atrMultiple < filters.minAtr) return false
  if (filters.minRelVolume > 0 && candle.relVolume < filters.minRelVolume) return false

  // Zone quality: when a specific grade is required, a signal with no zone or a
  // different grade is hidden.
  if (filters.zoneGrade !== 'all' && zone.zoneGrade !== filters.zoneGrade) return false

  // Min R:R: a signal with no computable R:R is hidden once a floor is set,
  // since we can't confirm it clears the bar.
  if (filters.minRr > 0 && (zone.rr == null || zone.rr < filters.minRr)) return false

  return true
}

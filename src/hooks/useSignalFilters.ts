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

/** Grade filter: any, or exactly one letter tier (A / B / C / D). */
export type GradeFilter = 'all' | 'A' | 'B' | 'C' | 'D'

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
  /**
   * Freshness window in calendar days: how recent a symbol's latest explosive
   * move must be to qualify as a signal. Unlike the other fields this isn't a
   * "hide" filter but a remembered threshold — it persists across refreshes and
   * is intentionally NOT reset by "Clear filters".
   */
  freshnessDays: number
  /**
   * Minimum move size in ATR multiples that defines an "explosive" candle — the
   * core scan threshold. Like `freshnessDays` this is a remembered threshold,
   * not a "hide" filter: it persists across refreshes and is NOT reset by
   * "Clear filters".
   */
  moveMultiple: number
}

/** Bounds for the freshness window, shared by the input and the loader clamp. */
export const FRESHNESS_MIN = 1
export const FRESHNESS_MAX = 120
export const FRESHNESS_DEFAULT = 10

/** Bounds for the Min Move (ATR multiple) threshold, shared by input + loader. */
export const MOVE_MULTIPLE_MIN = 0.5
export const MOVE_MULTIPLE_MAX = 10
export const MOVE_MULTIPLE_DEFAULT = 2

export const DEFAULT_FILTERS: SignalFilters = {
  grade: 'all',
  direction: 'all',
  minAtr: 0,
  minRelVolume: 0,
  minRr: 0,
  zoneGrade: 'all',
  freshnessDays: FRESHNESS_DEFAULT,
  moveMultiple: MOVE_MULTIPLE_DEFAULT,
}

const STORAGE_KEY = 'rally.signalFilters.v1'
/** Separate key for Signals-page UI prefs (panel open/closed), so it can evolve
 *  independently of the filter values. */
const UI_STORAGE_KEY = 'rally.signalsUi.v1'

function loadFilters(): SignalFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SignalFilters>
      return {
        grade:
          parsed.grade === 'A' ||
          parsed.grade === 'B' ||
          parsed.grade === 'C' ||
          parsed.grade === 'D'
            ? parsed.grade
            : 'all',
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
        freshnessDays:
          typeof parsed.freshnessDays === 'number' && Number.isFinite(parsed.freshnessDays)
            ? Math.min(FRESHNESS_MAX, Math.max(FRESHNESS_MIN, Math.round(parsed.freshnessDays)))
            : FRESHNESS_DEFAULT,
        moveMultiple:
          typeof parsed.moveMultiple === 'number' && Number.isFinite(parsed.moveMultiple)
            ? Math.min(MOVE_MULTIPLE_MAX, Math.max(MOVE_MULTIPLE_MIN, parsed.moveMultiple))
            : MOVE_MULTIPLE_DEFAULT,
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
  /** Set the freshness window (clamped to [FRESHNESS_MIN, FRESHNESS_MAX]). */
  setFreshnessDays: (freshnessDays: number) => void
  /** Set the Min Move threshold (clamped to [MOVE_MULTIPLE_MIN, MOVE_MULTIPLE_MAX]). */
  setMoveMultiple: (moveMultiple: number) => void
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

  const setFreshnessDays = useCallback((freshnessDays: number) => {
    setFilters((f) => ({
      ...f,
      freshnessDays: Number.isFinite(freshnessDays)
        ? Math.min(FRESHNESS_MAX, Math.max(FRESHNESS_MIN, Math.round(freshnessDays)))
        : f.freshnessDays,
    }))
  }, [])

  const setMoveMultiple = useCallback((moveMultiple: number) => {
    setFilters((f) => ({
      ...f,
      moveMultiple: Number.isFinite(moveMultiple)
        ? Math.min(MOVE_MULTIPLE_MAX, Math.max(MOVE_MULTIPLE_MIN, moveMultiple))
        : f.moveMultiple,
    }))
  }, [])

  const clearFilters = useCallback(() => {
    // Freshness + Min Move are remembered thresholds, not "hide" filters —
    // preserve them so clearing the display filters doesn't reset the user's
    // chosen scan window/sensitivity.
    setFilters((f) => ({
      ...DEFAULT_FILTERS,
      freshnessDays: f.freshnessDays,
      moveMultiple: f.moveMultiple,
    }))
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
    setFreshnessDays,
    setMoveMultiple,
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
  candle: { grade: 'A' | 'B' | 'C' | 'D'; changePct: number; atrMultiple: number; relVolume: number },
  zone: SignalZoneContext = {},
): boolean {
  // Exact-tier match: the "B" filter shows only B, not "B and better".
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

/**
 * Persisted Signals-page UI preference: whether the filter controls panel is
 * expanded. Collapsed by default so the signals table is reachable without
 * scrolling past the (usually untouched) filter controls. Remembers the user's
 * choice across refreshes, matching the filter-persistence idiom above.
 */
export function useSignalsFilterPanel(): {
  open: boolean
  toggle: () => void
  setOpen: (open: boolean) => void
} {
  const [open, setOpenState] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(UI_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { filtersOpen?: boolean }
        if (typeof parsed.filtersOpen === 'boolean') return parsed.filtersOpen
      }
    } catch {
      // fall through to default
    }
    return false // collapsed by default
  })

  useEffect(() => {
    try {
      localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ filtersOpen: open }))
    } catch {
      // best-effort
    }
  }, [open])

  const toggle = useCallback(() => setOpenState((v) => !v), [])
  const setOpen = useCallback((next: boolean) => setOpenState(next), [])

  return { open, toggle, setOpen }
}

/**
 * Shared / live-state test for `useSignalFilters`.
 *
 * The Signals filters are backed by a single module-level store exposed through
 * React's `useSyncExternalStore`, so every `useSignalFilters()` consumer shares
 * one in-memory state and re-renders together when it changes. In the app the
 * two consumers are the Signals page (ExplosiveMoves.tsx) and the trade-ticket
 * zone selection (App.tsx); here we simulate them with two independent
 * `renderHook` instances and assert a change in one is reflected in the other
 * immediately (in-session, no reload).
 *
 * Store-reset approach: the store lives at module scope and therefore persists
 * ACROSS tests in this file. To stay deterministic regardless of test order we
 * (1) clear localStorage and (2) drive the store back to a known baseline via
 * the public setters in `beforeEach` — we never rely on cross-test isolation.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

import {
  useSignalFilters,
  FRESHNESS_DEFAULT,
  DEFAULT_FILTERS,
} from '../useSignalFilters'

const STORAGE_KEY = 'rally.signalFilters.v1'

beforeEach(() => {
  localStorage.clear()
  // Drive the shared module-level store back to a known baseline. Because the
  // store is shared across tests, we cannot depend on it being fresh — reset it
  // explicitly through the public API.
  const { result } = renderHook(() => useSignalFilters())
  act(() => {
    result.current.clearFilters()
    result.current.setFreshnessDays(FRESHNESS_DEFAULT)
    result.current.setGrade('all')
  })
  cleanup()
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('useSignalFilters — shared live state across consumers', () => {
  it('reflects a freshnessDays change from one consumer in the other immediately', () => {
    // Two independent consumers (App.tsx + ExplosiveMoves.tsx).
    const { result: resultA } = renderHook(() => useSignalFilters())
    const { result: resultB } = renderHook(() => useSignalFilters())

    expect(resultA.current.filters.freshnessDays).toBe(FRESHNESS_DEFAULT)
    expect(resultB.current.filters.freshnessDays).toBe(FRESHNESS_DEFAULT)

    act(() => {
      resultA.current.setFreshnessDays(30)
    })

    // The whole point: the live change propagates to BOTH instances.
    expect(resultA.current.filters.freshnessDays).toBe(30)
    expect(resultB.current.filters.freshnessDays).toBe(30)

    // ...and it persists to the same localStorage key/shape.
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).freshnessDays).toBe(30)
  })

  it('shares other fields too (setGrade reflects in both instances)', () => {
    const { result: resultA } = renderHook(() => useSignalFilters())
    const { result: resultB } = renderHook(() => useSignalFilters())

    expect(resultA.current.filters.grade).toBe(DEFAULT_FILTERS.grade)
    expect(resultB.current.filters.grade).toBe(DEFAULT_FILTERS.grade)

    act(() => {
      resultB.current.setGrade('A')
    })

    // Change made via B is visible on A — proves sharing is general, not
    // freshness-specific.
    expect(resultA.current.filters.grade).toBe('A')
    expect(resultB.current.filters.grade).toBe('A')
    expect(resultA.current.isActive).toBe(true)

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string).grade).toBe('A')
  })
})

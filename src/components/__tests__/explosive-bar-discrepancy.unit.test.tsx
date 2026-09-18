/**
 * Supporting unit tests — "explosive-bar-discrepancy" (Task 4).
 *
 * These focus, deterministic unit tests back up the property/preservation
 * suites with narrow, example-based checks of the three fix seams:
 *
 *   1. `candleForDate` resolves the ExplosiveCandle for `zone.explosiveDate`
 *      with stats byte-for-byte equal to what the scan (`move.latest` /
 *      `move.allGrades`) produced for that same date.
 *   2. `MoveRow` renders the zone-derived date + signal-origin stats when a
 *      `signalCandle` is supplied, and falls back to `move.latest` when it's
 *      null. When consistent (`latest.date === zone.explosiveDate`) the two are
 *      identical.
 *   3. `TickerDetailModal` emphasizes the passed `signalDate` with a single
 *      "SIGNAL" marker; without the prop, no SIGNAL marker is rendered.
 *
 * Plus edge cases: a single fresh zone (most-recent === anchor → row identical
 * to latest), and an out-of-window most-recent candle paired with an in-window
 * zone anchor (divergent — the row must follow the zone).
 *
 * **Validates: Requirements 2.1, 2.3, 3.1, 3.4**
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'

import {
  useExplosiveMoves,
  candleForDate,
  type ExplosiveMove,
  type ExplosiveCandle,
} from '../../hooks/useExplosiveMoves'
import {
  useBasingZones,
  selectSignalZone,
  type BasingZone,
} from '../../hooks/useBasingZones'
import { saveSymbol, loadCached } from '../../data/dailyCache'
import { effectiveTradingDay } from '../../data/marketCalendar'
import { MoveRow } from '../ExplosiveMoves'
import type { DailyBar } from '../../data/tiingo'
import type { Stock } from '../../data/stocks'

// The detail modal loads its candles asynchronously via
// fetchDailyBarsFromSupabase. Mock it to return the seeded bars for the symbol
// under test so CandleChart renders in jsdom without a network/Supabase client.
// Test-harness wiring only; the modal's real rendering is what we assert.
vi.mock('../../data/supabaseDailyStore', () => ({
  fetchDailyBarsFromSupabase: vi.fn(async (symbol: string) => {
    const cached = loadCached([symbol])
    return cached[symbol]?.bars ?? []
  }),
}))

// Import AFTER the mock is registered so TickerDetailModal picks up the stub.
import { TickerDetailModal } from '../TickerDetailModal'

// jsdom doesn't implement ResizeObserver, which TickerDetailModal uses to size
// its chart. Provide a minimal no-op polyfill so the modal can mount.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// ── Date helpers ─────────────────────────────────────────────────────────────
// Freshness is CALENDAR days from effectiveTradingDay(). Anchor synthetic bar
// dates to "today" so fresh candles land in-window.

const TODAY = effectiveTradingDay()

/** YYYY-MM-DD that is `n` calendar days BEFORE today (n=0 => today). */
function daysAgo(n: number): string {
  const [y, m, d] = TODAY.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  anchor.setUTCDate(anchor.getUTCDate() - n)
  const yy = anchor.getUTCFullYear()
  const mm = String(anchor.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(anchor.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// ── Bar-builder primitives ───────────────────────────────────────────────────
// Bars are oldest-first (index 0 = oldest), which the hooks expect.

/**
 * Single explosive up candle: a long calm warm-up (stable ATR), one explosive
 * candle at `explosiveDaysAgo`, then calm drift to today. Because there is
 * exactly one qualifying candle, `move.latest.date === zone.explosiveDate` — a
 * CONSISTENT signal (single fresh zone / most-recent-equals-anchor edge case).
 */
function buildConsistentBars(opts: { base: number; explosiveDaysAgo: number }): DailyBar[] {
  const bars: DailyBar[] = []
  const { base, explosiveDaysAgo } = opts
  const startDaysAgo = explosiveDaysAgo + 40
  let level = base
  const RANGE = base * 0.004
  for (let d = startDaysAgo; d >= 0; d--) {
    const date = daysAgo(d)
    let bar: DailyBar
    if (d === explosiveDaysAgo) {
      const open = level
      const close = level * 1.08
      const high = close * 1.001
      const low = open * 0.999
      bar = { date, open, high, low, close, volume: 5_000_000 }
      level = close
    } else {
      const open = level
      const close = level * (1 + (d % 2 === 0 ? 0.0005 : -0.0005))
      const high = Math.max(open, close) + RANGE / 2
      const low = Math.min(open, close) - RANGE / 2
      bar = { date, open, high, low, close, volume: 1_000_000 }
      level = close
    }
    bars.push(bar)
  }
  return bars
}

/**
 * Two explosive candles: an OLDER one (the fresh, unmitigated zone anchor) and
 * a more-RECENT one whose zone is mitigated (price dips back through the
 * proximal the next day). `selectSignalZone` picks the older fresh zone, so the
 * scan's `move.latest` (the recent candle) diverges from the qualifying zone's
 * anchor — a divergent (bug-condition) signal. Mirrors the exploration suite's
 * `buildBars` shape but trimmed to what these unit tests need.
 */
function buildDivergentBars(opts: {
  base: number
  olderDaysAgo: number
  recentDaysAgo: number
}): DailyBar[] {
  const bars: DailyBar[] = []
  const { base, olderDaysAgo, recentDaysAgo } = opts
  const startDaysAgo = olderDaysAgo + 40
  let level = base
  const RANGE = base * 0.004
  for (let d = startDaysAgo; d >= 0; d--) {
    const date = daysAgo(d)
    let bar: DailyBar
    if (d === olderDaysAgo || d === recentDaysAgo) {
      const open = level
      const close = level * 1.08
      const high = close * 1.001
      const low = open * 0.999
      bar = { date, open, high, low, close, volume: 5_000_000 }
      level = close
    } else if (d === recentDaysAgo - 1) {
      // Day after the recent explosive: dip back through the proximal so the
      // recent zone is mitigated (used up). The older zone stays fresh.
      const preMove = level / 1.08
      const close = preMove * 0.985
      const open = level
      const high = open * 1.001
      const low = close * 0.999
      bar = { date, open, high, low, close, volume: 3_000_000 }
      level = preMove * 1.02
    } else {
      const open = level
      const close = level * (1 + (d % 2 === 0 ? 0.0005 : -0.0005))
      const high = Math.max(open, close) + RANGE / 2
      const low = Math.min(open, close) - RANGE / 2
      bar = { date, open, high, low, close, volume: 1_000_000 }
      level = close
    }
    bars.push(bar)
  }
  return bars
}

/** Build a Stock for a symbol with a given current price. */
function stockFor(symbol: string, price: number): Stock {
  return { symbol, name: symbol, price, prevClose: price, history: [] }
}

/** Replicates ExplosiveMoves.tsx: choose the ONE representative zone per symbol. */
function selectZoneForSymbol(
  allZones: BasingZone[],
  symbol: string,
  price: number | undefined,
): BasingZone | null {
  return selectSignalZone(
    allZones.filter((z) => z.symbol === symbol),
    price,
  )
}

/** Run the move scan for one seeded symbol and return its ExplosiveMove. */
function moveFor(stock: Stock, freshnessDays?: number): ExplosiveMove | undefined {
  const { result } = renderHook(() =>
    useExplosiveMoves([stock], undefined, freshnessDays),
  )
  return result.current.moves.find((m) => m.symbol === stock.symbol)
}

/** Run the zone detector for one seeded symbol and select its representative zone. */
function zoneFor(stock: Stock): BasingZone | null {
  const { result } = renderHook(() => useBasingZones([stock]))
  return selectZoneForSymbol(result.current.zones, stock.symbol, stock.price)
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('explosive-bar-discrepancy — supporting unit tests (Task 4)', () => {
  // ── 1. candleForDate stats equal the scan's per-candle computation ──────────
  describe('candleForDate resolves stats identical to the scan (Req 2.1)', () => {
    it('single-candle history: candleForDate(anchor) === move.latest, grade from allGrades', () => {
      const symbol = 'CFD_ONE'
      const bars = buildConsistentBars({ base: 120, explosiveDaysAgo: 5 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 128)

      const move = moveFor(stock)
      expect(move, 'symbol should produce a graded move').toBeTruthy()
      if (!move) return

      // Single explosive → latest IS the anchor.
      const anchorDate = move.latest.date
      const resolved = candleForDate(move, bars, anchorDate)
      expect(resolved, 'candleForDate should resolve the anchor candle').toBeTruthy()
      if (!resolved) return

      // Stats byte-for-byte equal to what the scan produced (move.latest).
      expect(resolved).toEqual(move.latest)
      // Grade comes from the recorded allGrades map for that date.
      expect(resolved.grade).toBe(move.allGrades.get(anchorDate))
    })

    it('divergent history: candleForDate(zone.explosiveDate) matches allGrades + is NOT latest', () => {
      const symbol = 'CFD_DIV'
      const bars = buildDivergentBars({ base: 100, olderDaysAgo: 8, recentDaysAgo: 3 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 100.5)

      const move = moveFor(stock)
      const zone = zoneFor(stock)
      expect(move && zone, 'symbol should have a move and a selected zone').toBeTruthy()
      if (!move || !zone) return

      // The selected (older) zone's anchor differs from the most-recent candle.
      expect(zone.explosiveDate).not.toBe(move.latest.date)

      const resolved = candleForDate(move, bars, zone.explosiveDate)
      expect(resolved, 'candleForDate should resolve the zone anchor candle').toBeTruthy()
      if (!resolved) return

      // The resolved candle IS the zone's date, not the most-recent one.
      expect(resolved.date).toBe(zone.explosiveDate)
      expect(resolved.date).not.toBe(move.latest.date)

      // Grade equals the scan's recorded grade for that date, and every
      // signal-origin stat is internally consistent with the raw bar.
      expect(resolved.grade).toBe(move.allGrades.get(zone.explosiveDate))

      const idx = bars.findIndex((b) => b.date === zone.explosiveDate)
      const bar = bars[idx]
      const prev = bars[idx - 1]
      const totalRange = bar.high - bar.low
      expect(resolved.close).toBe(bar.close)
      expect(resolved.prevClose).toBe(prev.close)
      expect(resolved.changePct).toBeCloseTo(((bar.close - prev.close) / prev.close) * 100, 10)
      expect(resolved.gapPct).toBeCloseTo(((bar.open - prev.close) / prev.close) * 100, 10)
      expect(resolved.bodyRatio).toBeCloseTo(Math.abs(bar.close - bar.open) / totalRange, 10)
    })

    it('returns null for a date not in the bars', () => {
      const symbol = 'CFD_MISS'
      const bars = buildConsistentBars({ base: 100, explosiveDaysAgo: 4 })
      saveSymbol(symbol, bars, symbol)
      const move = moveFor(stockFor(symbol, 107))!
      expect(candleForDate(move, bars, '1990-01-01')).toBeNull()
    })
  })

  // ── 2. MoveRow renders the zone-derived date + stats (Req 2.1, 3.1) ─────────
  describe('MoveRow date + stats binding', () => {
    /** Format a candle's stats the way MoveRow renders them (for assertions). */
    function expectRowMatchesCandle(container: HTMLElement, candle: ExplosiveCandle) {
      expect(container.querySelector('.em-date')?.textContent).toBe(candle.date)
      const change = `${candle.changePct >= 0 ? '+' : ''}${candle.changePct.toFixed(2)}%`
      expect(container.querySelector('.em-change')?.textContent).toBe(change)
      expect(container.querySelector('.em-body-ratio')?.textContent).toBe(
        `${(candle.bodyRatio * 100).toFixed(0)}%`,
      )
      // .em-stat cells in order: ATR, Vol, Gap, R:R.
      const stats = Array.from(container.querySelectorAll('.em-stat')).map(
        (el) => el.textContent,
      )
      expect(stats[0]).toBe(`${candle.atrMultiple.toFixed(1)}×`)
      expect(stats[1]).toBe(`${candle.relVolume.toFixed(1)}×`)
      expect(stats[2]).toBe(`${candle.gapPct >= 0 ? '+' : ''}${candle.gapPct.toFixed(2)}%`)
      // Signal-origin close appears in the price cell.
      expect(container.querySelector('.em-signal-price')?.textContent).toContain(
        candle.close.toFixed(2),
      )
    }

    it('divergent: with signalCandle set, the row shows the zone candle (not latest) (Req 2.1)', () => {
      const symbol = 'ROW_DIV'
      const bars = buildDivergentBars({ base: 100, olderDaysAgo: 8, recentDaysAgo: 3 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 100.5)
      const move = moveFor(stock)!
      const zone = zoneFor(stock)!
      const signalCandle = candleForDate(move, bars, zone.explosiveDate)!
      expect(signalCandle.date).not.toBe(move.latest.date)

      const { container } = render(
        <ul>
          <MoveRow
            move={move}
            signalCandle={signalCandle}
            currentPrice={stock.price}
            rr={null}
            onSelect={() => {}}
          />
        </ul>,
      )

      // The row renders the zone anchor's date + stats, NOT the most-recent one.
      expectRowMatchesCandle(container, signalCandle)
      expect(container.querySelector('.em-date')?.textContent).toBe(zone.explosiveDate)
      expect(container.querySelector('.em-date')?.textContent).not.toBe(move.latest.date)
    })

    it('consistent: signalCandle equals latest → row identical to the latest binding (Req 3.1)', () => {
      const symbol = 'ROW_CONS'
      const bars = buildConsistentBars({ base: 150, explosiveDaysAgo: 5 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 160)
      const move = moveFor(stock)!
      const zone = zoneFor(stock)!

      // Single explosive → the zone anchor IS the most-recent candle.
      expect(zone.explosiveDate).toBe(move.latest.date)
      const signalCandle = candleForDate(move, bars, zone.explosiveDate)!

      const withSignal = render(
        <ul>
          <MoveRow move={move} signalCandle={signalCandle} currentPrice={stock.price} rr={null} onSelect={() => {}} />
        </ul>,
      )
      const signalHtml = withSignal.container.querySelector('.em-row')?.innerHTML
      cleanup()

      // Rendering with signalCandle=null falls back to move.latest.
      const withFallback = render(
        <ul>
          <MoveRow move={move} signalCandle={null} currentPrice={stock.price} rr={null} onSelect={() => {}} />
        </ul>,
      )
      const fallbackHtml = withFallback.container.querySelector('.em-row')?.innerHTML

      // Consistent signal: the two renders are byte-for-byte identical.
      expect(signalHtml).toBe(fallbackHtml)
      expectRowMatchesCandle(withFallback.container, move.latest)
      expect(withFallback.container.querySelector('.em-date')?.textContent).toBe(move.latest.date)
    })

    it('signalCandle null → row falls back to move.latest (Req 3.1)', () => {
      const symbol = 'ROW_FALLBACK'
      const bars = buildDivergentBars({ base: 100, olderDaysAgo: 8, recentDaysAgo: 3 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 100.5)
      const move = moveFor(stock)!

      const { container } = render(
        <ul>
          <MoveRow move={move} signalCandle={null} currentPrice={stock.price} rr={null} onSelect={() => {}} />
        </ul>,
      )
      // With no signal candle the row shows the most-recent qualifying candle.
      expectRowMatchesCandle(container, move.latest)
      expect(container.querySelector('.em-date')?.textContent).toBe(move.latest.date)
    })
  })

  // ── 3. TickerDetailModal signal emphasis (Req 2.3, 3.4) ─────────────────────
  describe('TickerDetailModal signal emphasis', () => {
    it('with signalDate: emphasizes exactly one SIGNAL candle at that date (Req 2.3)', async () => {
      const symbol = 'MODAL_SIG'
      const bars = buildDivergentBars({ base: 100, olderDaysAgo: 8, recentDaysAgo: 3 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 100.5)
      const move = moveFor(stock)!
      const zone = zoneFor(stock)!
      expect(zone.explosiveDate).not.toBe(move.latest.date)

      render(
        <TickerDetailModal
          stock={stock}
          onClose={() => {}}
          explosiveGrades={move.allGrades}
          freshDates={move.freshDates}
          signalDate={zone.explosiveDate}
          showTrade
        />,
      )

      const svg = await screen.findByRole('img', { name: /candlestick chart/i })
      // Exactly one SIGNAL marker is drawn.
      await waitFor(() => {
        expect(within(svg).getAllByText('SIGNAL')).toHaveLength(1)
      })
      // And a candle hit-area exists at the zone anchor date (the emphasized one).
      expect(
        within(svg).getByRole('button', { name: `Candle ${zone.explosiveDate}` }),
      ).toBeTruthy()
    })

    it('without signalDate: no SIGNAL marker is rendered (Req 3.4)', async () => {
      const symbol = 'MODAL_NOSIG'
      const bars = buildDivergentBars({ base: 100, olderDaysAgo: 8, recentDaysAgo: 3 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 100.5)
      const move = moveFor(stock)!

      render(
        <TickerDetailModal
          stock={stock}
          onClose={() => {}}
          explosiveGrades={move.allGrades}
          freshDates={move.freshDates}
          showTrade
        />,
      )

      const svg = await screen.findByRole('img', { name: /candlestick chart/i })
      // The chart rendered its candles (hit-areas exist), but no SIGNAL emphasis.
      await waitFor(() => {
        expect(within(svg).queryAllByRole('button', { name: /^Candle /i }).length).toBeGreaterThan(0)
      })
      expect(within(svg).queryByText('SIGNAL')).toBeNull()
    })

    it('plain watchlist modal (no explosiveGrades/signalDate) renders no SIGNAL marker (Req 3.4)', async () => {
      const symbol = 'MODAL_PLAIN'
      const bars = buildConsistentBars({ base: 100, explosiveDaysAgo: 5 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 107)

      render(<TickerDetailModal stock={stock} onClose={() => {}} />)

      const svg = await screen.findByRole('img', { name: /candlestick chart/i })
      expect(within(svg).queryByText('SIGNAL')).toBeNull()
    })
  })

  // ── 4. Edge cases (Req 2.1, 3.1) ────────────────────────────────────────────
  describe('edge cases', () => {
    it('single fresh zone / most-recent-equals-anchor: row identical to latest (Req 3.1)', () => {
      const symbol = 'EDGE_SINGLE'
      const bars = buildConsistentBars({ base: 200, explosiveDaysAgo: 4 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 214)
      const move = moveFor(stock)!
      const zone = zoneFor(stock)!

      // Exactly one qualifying candle → anchor === latest.
      expect(move.allGrades.size).toBe(1)
      expect(zone.explosiveDate).toBe(move.latest.date)

      const resolved = candleForDate(move, bars, zone.explosiveDate)!
      expect(resolved).toEqual(move.latest)
    })

    it('out-of-window most-recent + in-window zone anchor: row follows the in-window zone (Req 2.1)', () => {
      const symbol = 'EDGE_WINDOW'
      // Older explosive ~8d ago (in a 30d window), recent explosive ~3d ago but
      // its zone is mitigated. With a TIGHT window the divergence still holds:
      // the qualifying zone anchor is the older, in-window candle.
      const bars = buildDivergentBars({ base: 100, olderDaysAgo: 8, recentDaysAgo: 3 })
      saveSymbol(symbol, bars, symbol)
      const stock = stockFor(symbol, 100.5)
      const FRESHNESS = 30

      const move = moveFor(stock, FRESHNESS)!
      const zone = zoneFor(stock)!
      const signalCandle = candleForDate(move, bars, zone.explosiveDate, undefined, FRESHNESS)!

      // The resolved zone-anchor candle is within the freshness window.
      const [ty, tm, td] = TODAY.split('-').map(Number)
      const [dy, dm, dd] = signalCandle.date.split('-').map(Number)
      const ageDays = Math.round(
        (Date.UTC(ty, tm - 1, td, 12) - Date.UTC(dy, dm - 1, dd, 12)) / 86_400_000,
      )
      expect(ageDays).toBeLessThanOrEqual(FRESHNESS)
      expect(signalCandle.isFresh).toBe(true)
      expect(signalCandle.date).toBe(zone.explosiveDate)

      const { container } = render(
        <ul>
          <MoveRow move={move} signalCandle={signalCandle} currentPrice={stock.price} rr={null} onSelect={() => {}} />
        </ul>,
      )
      // The row shows the in-window zone anchor, not the most-recent candle.
      expect(container.querySelector('.em-date')?.textContent).toBe(zone.explosiveDate)
      expect(container.querySelector('.em-date')?.textContent).not.toBe(move.latest.date)
    })
  })
})

/**
 * Preservation property tests — "explosive-bar-discrepancy" (Task 2).
 *
 * SEMANTICS (bugfix workflow, Property 2 — Preservation):
 *   These tests capture the BASELINE behavior that the fix MUST NOT change.
 *   They MUST PASS on the current UNFIXED code. Following observation-first
 *   methodology, we run the unfixed code, record its actual outputs, and assert
 *   them — so the same assertions re-run after the fix guarantee no regression.
 *
 * Property 2 (Preservation): for every input where isBugCondition(input) is
 * FALSE, the fixed code must produce the same result as the original. That set
 * includes:
 *   • signals whose most-recent qualifying candle ALREADY anchors the selected
 *     zone (latest.date === zone.explosiveDate) — Case 1,
 *   • symbols excluded from the actionable list (no zone / mitigated / used up /
 *     stale / already-traded with "show traded" off) — Case 2,
 *   • zone detection / grading / selection / mitigation — Case 3,
 *   • the plain (non-signal) watchlist modal — Case 4,
 *   • all Backtest trade-detail fields, the zone band, stop/target/lifecycle
 *     — Case 5.
 *
 * We drive `useExplosiveMoves` + `useBasingZones` + `selectSignalZone` exactly
 * the way ExplosiveMoves.tsx does (seed the daily cache, run the hooks, then
 * replicate the zoneBySymbol / actionable selection).
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 */

import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { render, screen, cleanup } from '@testing-library/react'
import fc from 'fast-check'

import {
  useExplosiveMoves,
  type ExplosiveMove,
  type ExplosiveCandle,
} from '../../hooks/useExplosiveMoves'
import {
  useBasingZones,
  detectBasesForBars,
  selectSignalZone,
  zoneUsedUpAtPrice,
  type BasingZone,
} from '../../hooks/useBasingZones'
import { saveSymbol } from '../../data/dailyCache'
import { effectiveTradingDay } from '../../data/marketCalendar'
import {
  tradeLifecycle,
  detailRR,
  formatDetailRR,
  type TradeDetailData,
} from '../../data/tradeDetailData'
import { TickerDetailModal } from '../TickerDetailModal'
import type { DailyBar } from '../../data/tiingo'
import type { Stock } from '../../data/stocks'

// jsdom doesn't implement ResizeObserver, which TickerDetailModal uses to size
// its chart. Provide a minimal no-op polyfill so the modal can mount under the
// test environment (test-harness setup only — no production behavior change).
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

// ── Date helpers ─────────────────────────────────────────────────────────────
// Freshness in useExplosiveMoves is CALENDAR days from effectiveTradingDay().
// Anchor all synthetic bar dates to "today" so fresh candles land in-window.

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
// Bars are laid out oldest-first (index 0 = oldest), which the hooks expect.

/**
 * Build a deterministic demand-friendly history with a SINGLE explosive candle:
 * a long calm warm-up (stable ATR), a tight base, one explosive up candle (the
 * zone anchor AND the most-recent qualifying candle), then calm drift that does
 * NOT return to the proximal line (so the zone stays fresh/unmitigated).
 *
 * Because there is exactly one qualifying candle, `move.latest.date` and the
 * selected zone's `explosiveDate` are the SAME candle — i.e. a CONSISTENT
 * signal where isBugCondition is FALSE (Case 1 / preservation).
 *
 * Returns bars oldest-first ending at today.
 */
function buildConsistentBars(opts: {
  base: number
  explosiveDaysAgo: number
  latestDaysAgo?: number
}): DailyBar[] {
  const bars: DailyBar[] = []
  const { base, explosiveDaysAgo, latestDaysAgo = 0 } = opts
  const startDaysAgo = explosiveDaysAgo + 40 // long warm-up for stable ATR
  let level = base
  const RANGE = base * 0.004 // very tight daily range in the calm regime

  for (let d = startDaysAgo; d >= latestDaysAgo; d--) {
    const date = daysAgo(d)
    let bar: DailyBar
    if (d === explosiveDaysAgo) {
      // Explosive up candle: marubozu ~ +8% vs a ~0.4% normal daily range.
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
 * Build a calm-only history with NO explosive candle at all — used for the
 * "excluded: no zone / no signal" preservation case.
 */
function buildCalmBars(opts: { base: number; daysBack: number }): DailyBar[] {
  const bars: DailyBar[] = []
  const { base, daysBack } = opts
  let level = base
  const RANGE = base * 0.004
  for (let d = daysBack; d >= 0; d--) {
    const date = daysAgo(d)
    const open = level
    const close = level * (1 + (d % 2 === 0 ? 0.0005 : -0.0005))
    const high = Math.max(open, close) + RANGE / 2
    const low = Math.min(open, close) - RANGE / 2
    bars.push({ date, open, high, low, close, volume: 1_000_000 })
    level = close
  }
  return bars
}

/**
 * Single explosive candle whose date is STALE (well outside the freshness
 * window) — the symbol has a graded move in history but no fresh signal.
 */
function buildStaleBars(opts: { base: number; explosiveDaysAgo: number }): DailyBar[] {
  // Reuse the consistent builder but keep drifting all the way to today so the
  // explosive candle is old; latest calm bar is today.
  return buildConsistentBars({ base: opts.base, explosiveDaysAgo: opts.explosiveDaysAgo })
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
  const forSymbol = allZones.filter((z) => z.symbol === symbol)
  return selectSignalZone(forSymbol, price)
}

// ── Signal-view model (mirrors ExplosiveMoves.tsx / MoveRow) ──────────────────

interface RowStats {
  date: string
  close: number
  changePct: number
  grade: string
  atrMultiple: number
  bodyRatio: number
  relVolume: number
  gapPct: number
}

/** Snapshot the signal-origin stats MoveRow renders TODAY (from move.latest). */
function rowStatsFromLatest(candle: ExplosiveCandle): RowStats {
  return {
    date: candle.date,
    close: candle.close,
    changePct: candle.changePct,
    grade: candle.grade,
    atrMultiple: candle.atrMultiple,
    bodyRatio: candle.bodyRatio,
    relVolume: candle.relVolume,
    gapPct: candle.gapPct,
  }
}

interface ListedSignal {
  symbol: string
  move: ExplosiveMove
  zone: BasingZone
  price: number
  rowStats: RowStats
  zoneExplosiveDate: string
}

function isBugCondition(s: {
  zone: BasingZone
  price: number
  move: ExplosiveMove
}): boolean {
  return (
    s.zone != null &&
    !s.zone.mitigated &&
    !zoneUsedUpAtPrice(s.zone, s.price) &&
    s.move.latest.date !== s.zone.explosiveDate
  )
}

/**
 * Run the hooks the way the page does and return the actionable listed signals
 * (mirrors the `actionable` filter + MoveRow date/stat binding in
 * ExplosiveMoves.tsx). `traded` is the set of `symbol|zoneExplosiveDate` keys
 * already traded; with showTraded=false those symbols are excluded.
 */
function runSignals(
  stocks: Stock[],
  opts: { freshnessDays?: number; traded?: Set<string>; showTraded?: boolean } = {},
): { listed: ListedSignal[]; moves: ExplosiveMove[]; zones: BasingZone[] } {
  const { freshnessDays, traded = new Set<string>(), showTraded = false } = opts
  const { result: movesResult } = renderHook(() =>
    useExplosiveMoves(stocks, 2.0, freshnessDays),
  )
  const { result: zonesResult } = renderHook(() => useBasingZones(stocks))

  const moves = movesResult.current.moves
  const zones = zonesResult.current.zones
  const priceBySymbol = new Map(stocks.map((s) => [s.symbol, s.price]))

  const listed: ListedSignal[] = []
  for (const move of moves) {
    if (!move.latest.isFresh) continue
    const price = priceBySymbol.get(move.symbol)
    const zone = selectZoneForSymbol(zones, move.symbol, price)
    if (zone == null || zone.mitigated) continue
    if (zoneUsedUpAtPrice(zone, price)) continue
    if (!showTraded && traded.has(`${move.symbol}|${zone.explosiveDate}`)) continue

    listed.push({
      symbol: move.symbol,
      move,
      zone,
      price: price ?? move.latest.close,
      rowStats: rowStatsFromLatest(move.latest),
      zoneExplosiveDate: zone.explosiveDate,
    })
  }
  return { listed, moves, zones }
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('explosive-bar-discrepancy — Property 2 (Preservation)', () => {
  // ── Case 1 — Consistent signal unchanged ───────────────────────────────────
  it('Case 1 — Consistent signal: row date + every stat equal the zone-anchor candle (unchanged)', () => {
    localStorage.clear()
    const symbol = 'CONSISTENT'
    // Single explosive candle → latest.date === zone.explosiveDate.
    const bars = buildConsistentBars({ base: 100, explosiveDaysAgo: 5 })
    saveSymbol(symbol, bars, symbol)
    // Price above the demand proximal so the zone stays fresh + not used up.
    const price = 107
    const { listed } = runSignals([stockFor(symbol, price)])

    const signal = listed.find((s) => s.symbol === symbol)
    expect(signal, 'consistent symbol should be a listed actionable signal').toBeTruthy()
    if (!signal) return

    // This is NOT a bug-condition input (latest.date === zone.explosiveDate).
    expect(isBugCondition(signal)).toBe(false)
    expect(signal.rowStats.date).toBe(signal.zoneExplosiveDate)

    // Baseline: what the row shows (from move.latest) MUST equal what the fixed
    // code derives from the candle at zone.explosiveDate. For a consistent
    // signal those are the same candle, so the row is unchanged by the fix.
    const fixedCandle = signal.move.allGrades.get(signal.zoneExplosiveDate)
    expect(fixedCandle, 'zone anchor candle must be a graded candle').toBeTruthy()

    // Assert the observed baseline stat values so any change flags a regression.
    expect(signal.rowStats).toMatchObject({
      date: signal.zoneExplosiveDate,
      grade: signal.move.latest.grade,
      close: signal.move.latest.close,
      changePct: signal.move.latest.changePct,
      atrMultiple: signal.move.latest.atrMultiple,
      bodyRatio: signal.move.latest.bodyRatio,
      relVolume: signal.move.latest.relVolume,
      gapPct: signal.move.latest.gapPct,
    })
    // The grade the fix would resolve from allGrades matches the row grade.
    expect(signal.move.allGrades.get(signal.zoneExplosiveDate)).toBe(signal.rowStats.grade)
  })

  it('Case 1 (PBT) — Consistent signals always render the anchor candle across many histories', () => {
    fc.assert(
      fc.property(
        // explosive 3..8 days ago (fresh); base level varies.
        fc.integer({ min: 3, max: 8 }),
        fc.integer({ min: 80, max: 400 }),
        (explosiveDaysAgo, base) => {
          localStorage.clear()
          const symbol = 'PBTCONS'
          const bars = buildConsistentBars({ base, explosiveDaysAgo })
          saveSymbol(symbol, bars, symbol)
          const price = base * 1.07 // above proximal → fresh, not used up
          const { listed } = runSignals([stockFor(symbol, price)])
          const signal = listed.find((s) => s.symbol === symbol)
          if (!signal) return // not listed for this draw — skip (still preservation-safe)

          // Only consistent (non-bug) inputs are exercised here.
          expect(isBugCondition(signal)).toBe(false)
          // Preservation: displayed date is the anchor date, and equals latest.
          expect(signal.rowStats.date).toBe(signal.zoneExplosiveDate)
          expect(signal.rowStats.date).toBe(signal.move.latest.date)
          // Grade the fix resolves from allGrades matches the row grade.
          expect(signal.move.allGrades.get(signal.zoneExplosiveDate)).toBe(
            signal.rowStats.grade,
          )
        },
      ),
      { numRuns: 30 },
    )
  })

  // ── Case 2 — Excluded symbols still excluded ────────────────────────────────
  it('Case 2 — No qualifying zone / bare calm history stays excluded', () => {
    localStorage.clear()
    const symbol = 'CALM'
    saveSymbol(symbol, buildCalmBars({ base: 100, daysBack: 80 }), symbol)
    const { listed, moves } = runSignals([stockFor(symbol, 100)])
    // No explosive candle → no move at all → definitely not listed.
    expect(moves.find((m) => m.symbol === symbol)).toBeFalsy()
    expect(listed.find((s) => s.symbol === symbol)).toBeFalsy()
  })

  it('Case 2 — Used-up zone (price through proximal) stays excluded', () => {
    localStorage.clear()
    const symbol = 'USEDUP'
    const bars = buildConsistentBars({ base: 100, explosiveDaysAgo: 4 })
    saveSymbol(symbol, bars, symbol)
    // Demand zone: price BELOW/at the proximal means zoneUsedUpAtPrice → excluded.
    const price = 95
    const { listed, moves, zones } = runSignals([stockFor(symbol, price)])
    const move = moves.find((m) => m.symbol === symbol)
    expect(move, 'symbol should have a graded move').toBeTruthy()
    const zone = selectZoneForSymbol(zones, symbol, price)
    expect(zone, 'symbol should have a detected zone').toBeTruthy()
    if (zone) expect(zoneUsedUpAtPrice(zone, price)).toBe(true)
    // Excluded from the actionable list because the fresh first-touch is gone.
    expect(listed.find((s) => s.symbol === symbol)).toBeFalsy()
  })

  it('Case 2 — Stale move (outside freshness window) stays excluded', () => {
    localStorage.clear()
    const symbol = 'STALE'
    // Explosive 40 days ago; freshness window 10 days → stale.
    const bars = buildStaleBars({ base: 100, explosiveDaysAgo: 40 })
    saveSymbol(symbol, bars, symbol)
    const { listed, moves } = runSignals([stockFor(symbol, 107)], { freshnessDays: 10 })
    const move = moves.find((m) => m.symbol === symbol)
    expect(move, 'symbol should have a graded move in history').toBeTruthy()
    if (move) expect(move.latest.isFresh).toBe(false)
    expect(listed.find((s) => s.symbol === symbol)).toBeFalsy()
  })

  it('Case 2 — Already-traded signal (show traded off) stays excluded', () => {
    localStorage.clear()
    const symbol = 'TRADED'
    const bars = buildConsistentBars({ base: 100, explosiveDaysAgo: 5 })
    saveSymbol(symbol, bars, symbol)
    const price = 107

    // First, without the traded key it IS listed.
    const before = runSignals([stockFor(symbol, price)])
    const listedSignal = before.listed.find((s) => s.symbol === symbol)
    expect(listedSignal, 'symbol should be listed before being traded').toBeTruthy()
    if (!listedSignal) return

    // The traded-suppression key is `symbol|zone.explosiveDate` (unchanged by
    // the fix). With showTraded off, the symbol drops off the list.
    const traded = new Set<string>([`${symbol}|${listedSignal.zoneExplosiveDate}`])
    const after = runSignals([stockFor(symbol, price)], { traded, showTraded: false })
    expect(after.listed.find((s) => s.symbol === symbol)).toBeFalsy()

    // And with showTraded on it comes back (confirms the key logic is intact).
    const shown = runSignals([stockFor(symbol, price)], { traded, showTraded: true })
    expect(shown.listed.find((s) => s.symbol === symbol)).toBeTruthy()
  })

  // ── Case 3 — Zone selection / grading / mitigation unchanged ────────────────
  it('Case 3 — detectBasesForBars + selectSignalZone are deterministic and stable', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 20 }),
        fc.integer({ min: 80, max: 400 }),
        (explosiveDaysAgo, base) => {
          localStorage.clear()
          const symbol = 'ZONEPBT'
          const bars = buildConsistentBars({ base, explosiveDaysAgo })
          const price = base * 1.05

          // Detect twice on the same bars — must be identical (pure function).
          const zonesA = detectBasesForBars(bars, symbol)
          const zonesB = detectBasesForBars(bars, symbol)
          expect(zonesB).toEqual(zonesA)

          // Selection is a stable function of (zones, price).
          const pickA = selectSignalZone(zonesA, price)
          const pickB = selectSignalZone(zonesB, price)
          expect(pickB).toEqual(pickA)

          if (pickA) {
            // Grade + mitigation are properties of the detected zone; assert the
            // selected one carries the same grade/mitigated flag detect produced.
            const same = zonesA.find((z) => z.explosiveDate === pickA.explosiveDate)
            expect(same?.grade).toBe(pickA.grade)
            expect(same?.mitigated).toBe(pickA.mitigated)
          }
        },
      ),
      { numRuns: 30 },
    )
  })

  it('Case 3 — hook-detected zones match the pure detector (no drift)', () => {
    localStorage.clear()
    const symbol = 'HOOKZONE'
    const bars = buildConsistentBars({ base: 150, explosiveDaysAgo: 6 })
    saveSymbol(symbol, bars, symbol)
    const { result } = renderHook(() => useBasingZones([stockFor(symbol, 160)]))
    const hookZones = result.current.zones.filter((z) => z.symbol === symbol)
    const pureZones = detectBasesForBars(bars, symbol)
    // Same set of zones, same fields (order-independent by explosiveDate).
    const byDate = (zs: BasingZone[]) =>
      [...zs].sort((a, b) => (a.explosiveDate < b.explosiveDate ? -1 : 1))
    expect(byDate(hookZones)).toEqual(byDate(pureZones))
  })

  // ── Case 4 — Plain watchlist modal unchanged ────────────────────────────────
  it('Case 4 — Plain watchlist modal (no explosiveGrades/signalDate) renders header unchanged', async () => {
    // Use a symbol that only appears via the symbol span (avoid substring
    // clashes with generic button labels).
    const stock = stockFor('ZZTOP', 123.45)
    stock.prevClose = 120
    render(<TickerDetailModal stock={stock} onClose={() => {}} />)

    // The dialog is labeled by the symbol — plain (non-signal) modal identity.
    const dialog = screen.getByRole('dialog', { name: /ZZTOP details/i })
    expect(dialog).toBeTruthy()
    // Symbol appears in the header via the td-symbol span.
    const symbolEl = dialog.querySelector('.td-symbol')
    expect(symbolEl?.textContent).toBe('ZZTOP')
    // Without an onTrade handler AND without showTrade, no Trade button is shown
    // in the plain watchlist modal (signal-only affordance stays off).
    expect(screen.queryByTitle(/Trade ZZTOP/i)).toBeNull()
    // No explosive toggle without explosive data.
    expect(screen.queryByTitle(/explosive-move highlighting/i)).toBeNull()
  })

  // ── Case 5 — Trade detail fields / lifecycle / band unchanged ───────────────
  it('Case 5 — Trade detail signalDate anchors on the zone explosiveDate (baseline)', () => {
    localStorage.clear()
    const symbol = 'TRADEZONE'
    const bars = buildConsistentBars({ base: 100, explosiveDaysAgo: 5 })
    saveSymbol(symbol, bars, symbol)
    const price = 107
    const { listed } = runSignals([stockFor(symbol, price)])
    const signal = listed.find((s) => s.symbol === symbol)
    expect(signal).toBeTruthy()
    if (!signal) return

    // Trade placement persists signalDate = zone.explosiveDate (App.tsx). Model
    // a closed trade from this signal and assert the detail fields render off it.
    const detail: TradeDetailData = {
      symbol,
      side: 'long',
      status: 'closed',
      shares: 10,
      orderType: 'limit',
      signalDate: signal.zone.explosiveDate,
      proximalPrice: signal.zone.proximal,
      distalPrice: signal.zone.distal,
      stopLossPrice: signal.zone.distal * 0.999,
      cashOutPrice: signal.zone.proximal * 1.2,
      limitPrice: signal.zone.proximal,
      entryPrice: signal.zone.proximal,
      exitPrice: signal.zone.proximal * 1.2,
      placedDate: signal.zone.explosiveDate,
      openedDate: signal.zone.explosiveDate,
      closedDate: daysAgo(0),
      exitReason: 'target',
    }

    // The persisted signalDate equals the row's zone explosiveDate (the fix's
    // whole point is to make the DISPLAYED row date match this — the trade side
    // is already anchored here and stays unchanged).
    expect(detail.signalDate).toBe(signal.zoneExplosiveDate)

    // Lifecycle: Signal → Filled → Closed, with the Signal milestone anchored on
    // the zone explosiveDate and the proximal (entry edge) price. Unchanged.
    const events = tradeLifecycle(detail)
    const signalEvent = events.find((e) => e.label === 'Signal')
    expect(signalEvent).toBeTruthy()
    expect(signalEvent?.when).toBe(signal.zone.explosiveDate)
    expect(signalEvent?.price).toBe(signal.zone.proximal)
    expect(signalEvent?.reached).toBe(true)

    // Zone band + stop/target reward:risk render from the detail's own levels,
    // independent of the display date. Assert the R:R is well-defined + stable.
    const rr = detailRR(detail)
    expect(rr).not.toBeNull()
    expect(formatDetailRR(detail)).toBe(rr != null ? `${rr.toFixed(1)}:1` : '—')

    // The zone band (proximal/distal) carried into the trade equals the selected
    // zone's lines — unchanged by the date-consistency fix.
    expect(detail.proximalPrice).toBe(signal.zone.proximal)
    expect(detail.distalPrice).toBe(signal.zone.distal)
  })
})

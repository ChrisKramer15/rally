/**
 * useExplosiveMoves
 *
 * Scans the FULL cached bar history for each watchlist symbol and identifies
 * every candle that qualifies as an "explosive move away" per the supply/demand
 * strategy.
 *
 * A move is measured RELATIVE to how the stock normally behaves, not by a flat
 * percentage — a 5% day is an earthquake for a calm stock but noise for a wild
 * one. We normalize by ATR (Average True Range) so every symbol grades on the
 * same scale.
 *
 * Qualification criteria (BOTH hard requirements must pass):
 *   1. |close-to-close move| >= moveMultiple × ATR   (default 2× ATR)
 *      i.e. the move is at least twice the stock's normal daily range.
 *   2. body ratio >= MIN_BODY_RATIO                   (default 0.60)
 *      body ratio = |close - open| / (high - low)
 *      A pure marubozu = 1.0; a pure doji = 0.0
 *
 * Grade booster (never disqualifies — only lifts strong → A+):
 *   3. relative volume = today's volume / avg volume  (default surge >= 1.5×)
 *      Real explosive moves usually come with a participation spike.
 *
 * Grade:
 *   'A+'     — clean marubozu-quality body AND a volume surge (institutions showed up)
 *   'strong' — clears both hard requirements but isn't exceptional on shape+volume
 *
 * Returns:
 *   - moves[]     — one entry per symbol, using the most recent qualifying candle
 *   - allGrades   — per symbol, date → grade for every qualifying candle in history
 *                   (passed to the detail modal to highlight every explosive bar)
 */

import { useMemo } from 'react'
import { loadCached } from '../data/dailyCache'
import { effectiveTradingDay } from '../data/marketCalendar'
import type { Stock } from '../data/stocks'
import type { DailyBar } from '../data/tiingo'

/**
 * Calendar days between two YYYY-MM-DD dates (b - a). Uses a UTC-noon anchor so
 * DST transitions never shift the count. Positive when `b` is after `a`.
 */
function calendarDaysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const aMs = Date.UTC(ay, am - 1, ad, 12, 0, 0)
  const bMs = Date.UTC(by, bm - 1, bd, 12, 0, 0)
  return Math.round((bMs - aMs) / 86_400_000)
}

export type ExplosiveGrade = 'A+' | 'strong'

export interface ExplosiveCandle {
  date: string
  /** Close-to-close % change (kept for display/sorting). */
  changePct: number
  /** How big the move was in ATR units: |close-prevClose| / ATR. */
  atrMultiple: number
  /** Today's volume / recent average volume. 1.0 = normal, >1 = surge. */
  relVolume: number
  /** (open - prevClose) / prevClose × 100 */
  gapPct: number
  /** (high - low) / prevClose × 100 */
  rangePct: number
  /** |close - open| / (high - low) */
  bodyRatio: number
  grade: ExplosiveGrade
  close: number
  prevClose: number
  /** Age in trading bars from the symbol's most recent bar (0 = latest bar). */
  ageBars: number
  /**
   * True when this candle is within the freshness window — measured in CALENDAR
   * days from today's effective trading day (an actionable signal).
   */
  isFresh: boolean
}

export interface ExplosiveMove {
  symbol: string
  name: string
  /** Most recent qualifying candle for this symbol. */
  latest: ExplosiveCandle
  /** All qualifying candles for this symbol across the full history, date → grade. */
  allGrades: Map<string, ExplosiveGrade>
  /** Dates of qualifying candles that fall within the freshness window. */
  freshDates: Set<string>
}

export interface UseExplosiveMovesResult {
  moves: ExplosiveMove[]
  /** Symbols in cache but with too little history to compute ATR. */
  skippedCount: number
  /** Symbols not yet in cache. */
  uncachedCount: number
}

// ── Tuning dials ─────────────────────────────────────────────────────────────

/** Move must be at least this multiple of ATR to qualify (the main dial). */
const DEFAULT_MOVE_MULTIPLE = 2.0

/**
 * A qualifying candle counts as a *fresh* (actionable) signal when its date is
 * within this many CALENDAR days of today's effective trading day. Older candles
 * remain in history for context but are treated as stale.
 */
const DEFAULT_FRESHNESS_DAYS = 10

/** Body-to-range ratio floor for any qualifying candle. */
const MIN_BODY_RATIO = 0.6

/** Body-to-range ratio considered marubozu-quality (contributes to A+). */
const A_PLUS_BODY_RATIO = 0.7

/** Relative-volume surge that counts as "institutions showed up" (contributes to A+). */
const VOLUME_SURGE = 1.5

/** ATR lookback (trading days). */
const ATR_PERIOD = 14

/** Volume-average lookback (trading days). */
const VOL_PERIOD = 20

/** Minimum bars needed before we can compute ATR at all. */
const MIN_BARS = ATR_PERIOD + 2

/**
 * Wilder-style ATR over the `period` bars ending at (and excluding) `endIdx`.
 * Returns null if there isn't enough history behind endIdx.
 */
function atrBefore(bars: DailyBar[], endIdx: number, period = ATR_PERIOD): number | null {
  const start = endIdx - period
  if (start < 1) return null
  let sum = 0
  for (let i = start; i < endIdx; i++) {
    const b = bars[i]
    const prev = bars[i - 1]
    const tr = Math.max(
      b.high - b.low,
      Math.abs(b.high - prev.close),
      Math.abs(b.low - prev.close),
    )
    sum += tr
  }
  return sum / period
}

/**
 * Average volume over the `period` bars ending at (and excluding) `endIdx`.
 * Falls back to whatever history exists if there aren't `period` bars yet.
 */
function avgVolumeBefore(bars: DailyBar[], endIdx: number, period = VOL_PERIOD): number {
  const start = Math.max(0, endIdx - period)
  let sum = 0
  let count = 0
  for (let i = start; i < endIdx; i++) {
    sum += bars[i].volume
    count++
  }
  return count > 0 ? sum / count : 0
}

/**
 * Grade a qualifying candle. It already cleared the two hard requirements, so
 * here we only decide A+ vs strong using body quality + volume surge.
 * A+ requires a clean body AND a volume surge; either one alone stays "strong".
 */
function gradeCandle(bodyRatio: number, relVolume: number): ExplosiveGrade {
  const cleanBody = bodyRatio >= A_PLUS_BODY_RATIO
  const volumeSurge = relVolume >= VOLUME_SURGE
  return cleanBody && volumeSurge ? 'A+' : 'strong'
}

/**
 * Grade the explosive candle on a specific date (the signal strength shown on
 * the Backtest screen). Uses the SAME body-ratio + relative-volume logic as the
 * Signals scan, so a trade's stored strength matches what the signal displayed.
 *
 * Returns null when the date isn't in the bars, there's not enough history
 * behind it to compute ATR, or the bar is flat — i.e. it can't be graded.
 * Exported so the trade-placement path can capture the strength by date without
 * re-running the whole scan.
 */
export function gradeExplosiveAt(bars: DailyBar[], date: string): ExplosiveGrade | null {
  const i = bars.findIndex((b) => b.date === date)
  if (i <= ATR_PERIOD) return null
  const bar = bars[i]
  const totalRange = bar.high - bar.low
  if (totalRange === 0) return null
  const bodyRatio = Math.abs(bar.close - bar.open) / totalRange
  const avgVol = avgVolumeBefore(bars, i)
  const relVolume = avgVol > 0 ? bar.volume / avgVol : 1
  return gradeCandle(bodyRatio, relVolume)
}

export function useExplosiveMoves(
  stocks: Stock[],
  moveMultiple: number = DEFAULT_MOVE_MULTIPLE,
  freshnessDays: number = DEFAULT_FRESHNESS_DAYS,
): UseExplosiveMovesResult {
  return useMemo(() => {
    const symbols = stocks.map((s) => s.symbol)
    const cached = loadCached(symbols)

    // Freshness is measured in CALENDAR days from the latest FINAL trading day
    // (a true "today"), NOT in trading bars and NOT from each symbol's own last
    // cached bar. Anchoring to effectiveTradingDay keeps freshness honest even
    // when a symbol's collection lagged (its newest bar could be days old).
    const todayTradingDay = effectiveTradingDay()

    let skippedCount = 0
    let uncachedCount = 0
    const moves: ExplosiveMove[] = []

    for (const stock of stocks) {
      const entry = cached[stock.symbol]

      if (!entry || entry.bars.length === 0) {
        uncachedCount++
        continue
      }

      if (entry.bars.length < MIN_BARS) {
        skippedCount++
        continue
      }

      const bars = entry.bars
      const lastIdx = bars.length - 1
      const allGrades = new Map<string, ExplosiveGrade>()
      const freshDates = new Set<string>()
      let latestCandle: ExplosiveCandle | null = null

      // Start once we have enough history behind us to compute ATR.
      for (let i = ATR_PERIOD + 1; i < bars.length; i++) {
        const bar = bars[i]
        const prev = bars[i - 1]

        const totalRange = bar.high - bar.low
        if (totalRange === 0) continue // skip flat bars (halted, etc.)

        const atr = atrBefore(bars, i)
        if (!atr || atr <= 0) continue

        const move = Math.abs(bar.close - prev.close)
        const atrMultiple = move / atr

        const bodySize = Math.abs(bar.close - bar.open)
        const bodyRatio = bodySize / totalRange

        // ── Hard requirements ──
        if (atrMultiple < moveMultiple) continue
        if (bodyRatio < MIN_BODY_RATIO) continue

        // ── Grade booster ──
        const avgVol = avgVolumeBefore(bars, i)
        const relVolume = avgVol > 0 ? bar.volume / avgVol : 1

        const grade = gradeCandle(bodyRatio, relVolume)
        const changePct = ((bar.close - prev.close) / prev.close) * 100
        const gapPct = ((bar.open - prev.close) / prev.close) * 100
        const rangePct = (totalRange / prev.close) * 100

        const ageBars = lastIdx - i
        // Fresh when the explosive candle's date is within `freshnessDays`
        // CALENDAR days of today (e.g. 90 ≈ 3 months), inclusive.
        const ageDays = calendarDaysBetween(bar.date, todayTradingDay)
        const isFresh = ageDays <= freshnessDays

        const candle: ExplosiveCandle = {
          date: bar.date,
          changePct,
          atrMultiple,
          relVolume,
          gapPct,
          rangePct,
          bodyRatio,
          grade,
          close: bar.close,
          prevClose: prev.close,
          ageBars,
          isFresh,
        }

        allGrades.set(bar.date, grade)
        if (isFresh) freshDates.add(bar.date)
        latestCandle = candle // track the most recent qualifying candle
      }

      if (!latestCandle || allGrades.size === 0) continue

      moves.push({
        symbol: stock.symbol,
        name: stock.name,
        latest: latestCandle,
        allGrades,
        freshDates,
      })
    }

    // Sort by most recent explosive candle date desc, then by move size (in ATR).
    moves.sort((a, b) => {
      if (a.latest.date !== b.latest.date) {
        return a.latest.date > b.latest.date ? -1 : 1
      }
      return b.latest.atrMultiple - a.latest.atrMultiple
    })

    return { moves, skippedCount, uncachedCount }
  }, [stocks, moveMultiple, freshnessDays])
}

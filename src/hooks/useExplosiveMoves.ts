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
 * Qualification criteria (BOTH hard requirements must pass to be graded AT ALL):
 *   1. |close-to-close move| >= moveMultiple × ATR   (default 2× ATR)
 *      i.e. the move is at least twice the stock's normal daily range.
 *   2. body ratio >= MIN_BODY_RATIO                   (default 0.60)
 *      body ratio = |close - open| / (high - low)
 *      A pure marubozu = 1.0; a pure doji = 0.0
 *
 * Grading (A / B / C / D) — every candle that clears the gate is still an
 * explosive move; the grade only ranks HOW strong. We score three independent
 * qualities on a 0–100 scale, then blend them into one weighted strength score
 * and bin that into a letter tier:
 *
 *   • Magnitude    — how far it moved vs. normal (ATR multiple), 40% weight.
 *   • Conviction   — how much of the candle was body vs. wick, 40% weight.
 *   • Participation — today's volume vs. its 20-day average, 20% weight.
 *
 * Each sub-score maps its metric from the qualifying floor (0 pts) up to an
 * "excellent" cap (100 pts), clamped so one runaway metric can't hijack the
 * grade:
 *   magnitude:    2× ATR → 0 … 5× ATR (or more) → 100
 *   conviction:   0.60 body → 0 … 1.00 body → 100
 *   participation: 1.0× vol → 0 … 3.0× vol (or more) → 100
 *
 * total = 0.40·magnitude + 0.40·conviction + 0.20·participation   (0–100)
 * bins:  A ≥ 75 · B ≥ 55 · C ≥ 35 · else D
 *
 * Volume at 20% acts as a booster, not a gate: a great move on merely average
 * volume can still grade well, it just can't top out at A on its own.
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

/**
 * Explosive-candle strength tier. New signals always use A/B/C/D.
 *
 * `LegacyExplosiveGrade` ('A+' | 'strong') is the OLD two-tier scheme. It's
 * retained only so trades placed before the A/B/C/D migration (persisted in
 * localStorage and Supabase) still render their stored strength. Nothing new is
 * ever produced with a legacy value.
 */
export type ExplosiveGrade = 'A' | 'B' | 'C' | 'D'
export type LegacyExplosiveGrade = 'A+' | 'strong'
/** Any grade string we might encounter — freshly computed OR persisted legacy. */
export type AnyExplosiveGrade = ExplosiveGrade | LegacyExplosiveGrade

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
  /** Blended 0–100 strength score the grade was binned from (for display/sorting). */
  score: number
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

/** Body-to-range ratio floor for any qualifying candle (the conviction gate). */
const MIN_BODY_RATIO = 0.6

// ── Grading model: sub-score caps + weights + tier cutoffs ───────────────────
// Each metric is mapped from its qualifying floor (0 pts) to an "excellent" cap
// (100 pts) and clamped, so an extreme reading on one axis can't dominate.

/** Magnitude cap: a move of this ATR multiple (or more) scores a full 100. */
const MAGNITUDE_CAP_ATR = 5.0
/** Conviction cap: a body-to-range this tight (or more) scores a full 100. */
const CONVICTION_CAP_BODY = 1.0
/** Participation floor/cap: 1.0× (normal) → 0 pts, this multiple (or more) → 100. */
const PARTICIPATION_CAP_VOL = 3.0

/** Blend weights (must sum to 1). Magnitude + conviction lead; volume supports. */
const WEIGHT_MAGNITUDE = 0.4
const WEIGHT_CONVICTION = 0.4
const WEIGHT_PARTICIPATION = 0.2

/** Score cutoffs for the letter tiers. A ≥ 75 · B ≥ 55 · C ≥ 35 · else D. */
const GRADE_A_MIN = 75
const GRADE_B_MIN = 55
const GRADE_C_MIN = 35

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

/** Linear-map `value` from [floor, cap] onto [0, 100], clamped to that range. */
function subScore(value: number, floor: number, cap: number): number {
  if (cap <= floor) return 0
  const t = (value - floor) / (cap - floor)
  return Math.max(0, Math.min(100, t * 100))
}

/**
 * Blend the three qualities into one 0–100 strength score.
 *   • magnitude    (ATR multiple): floor = the qualifying moveMultiple, cap 5×
 *   • conviction   (body ratio):   floor = MIN_BODY_RATIO, cap 1.0
 *   • participation (rel volume):  floor 1.0× (normal), cap 3.0×
 * Weighted 40 / 40 / 20. `moveFloor` is passed in so the magnitude sub-score is
 * measured from whatever qualifying threshold this scan used.
 */
function scoreCandle(
  atrMultiple: number,
  bodyRatio: number,
  relVolume: number,
  moveFloor: number,
): number {
  const magnitude = subScore(atrMultiple, moveFloor, MAGNITUDE_CAP_ATR)
  const conviction = subScore(bodyRatio, MIN_BODY_RATIO, CONVICTION_CAP_BODY)
  const participation = subScore(relVolume, 1.0, PARTICIPATION_CAP_VOL)
  return (
    WEIGHT_MAGNITUDE * magnitude +
    WEIGHT_CONVICTION * conviction +
    WEIGHT_PARTICIPATION * participation
  )
}

/** Bin a 0–100 strength score into a letter tier. */
function scoreToGrade(score: number): ExplosiveGrade {
  if (score >= GRADE_A_MIN) return 'A'
  if (score >= GRADE_B_MIN) return 'B'
  if (score >= GRADE_C_MIN) return 'C'
  return 'D'
}

/**
 * Grade a qualifying candle. It already cleared the two hard requirements, so
 * here we blend magnitude + conviction + participation into a strength score
 * and bin it into A/B/C/D. Returns both so callers can display the raw score.
 */
function gradeCandle(
  atrMultiple: number,
  bodyRatio: number,
  relVolume: number,
  moveFloor: number,
): { grade: ExplosiveGrade; score: number } {
  const score = scoreCandle(atrMultiple, bodyRatio, relVolume, moveFloor)
  return { grade: scoreToGrade(score), score }
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
  const prev = bars[i - 1]
  const totalRange = bar.high - bar.low
  if (totalRange === 0) return null

  const atr = atrBefore(bars, i)
  if (!atr || atr <= 0) return null
  const atrMultiple = Math.abs(bar.close - prev.close) / atr

  const bodyRatio = Math.abs(bar.close - bar.open) / totalRange
  const avgVol = avgVolumeBefore(bars, i)
  const relVolume = avgVol > 0 ? bar.volume / avgVol : 1
  // Use the default qualifying floor as the magnitude baseline so a trade's
  // stored strength matches what the Signals scan showed for that candle.
  return gradeCandle(atrMultiple, bodyRatio, relVolume, DEFAULT_MOVE_MULTIPLE).grade
}

/**
 * Resolve the `ExplosiveCandle` for a specific date, computed IDENTICALLY to
 * how the scan loop (and `gradeExplosiveAt`) would have produced it for that
 * candle. This lets a caller present the candle that anchors a chosen zone
 * (`zone.explosiveDate`) without re-running the whole per-symbol scan, while
 * guaranteeing the stats byte-for-byte match the scan's output.
 *
 * The per-date grade is taken from `move.allGrades` when available (the exact
 * grade the scan recorded); otherwise it falls back to the same `gradeCandle`
 * math the scan uses. `freshnessDays` controls the `isFresh` flag exactly as in
 * the hook (calendar-day window from today's effective trading day).
 *
 * Returns null when the date isn't in `bars`, there's not enough history behind
 * it to compute ATR, or the bar is flat (halted) — i.e. it can't be graded,
 * mirroring the scan's `continue` conditions.
 */
export function candleForDate(
  move: ExplosiveMove,
  bars: DailyBar[],
  date: string,
  moveFloor: number = DEFAULT_MOVE_MULTIPLE,
  freshnessDays: number = DEFAULT_FRESHNESS_DAYS,
): ExplosiveCandle | null {
  const i = bars.findIndex((b) => b.date === date)
  // The scan starts once there's enough history behind the bar to compute ATR
  // (i > ATR_PERIOD). Reject anything before that, matching the scan gate.
  if (i <= ATR_PERIOD) return null

  const bar = bars[i]
  const prev = bars[i - 1]

  const totalRange = bar.high - bar.low
  if (totalRange === 0) return null // flat bar — scan skips these

  const atr = atrBefore(bars, i)
  if (!atr || atr <= 0) return null

  const atrMultiple = Math.abs(bar.close - prev.close) / atr
  const bodyRatio = Math.abs(bar.close - bar.open) / totalRange

  const avgVol = avgVolumeBefore(bars, i)
  const relVolume = avgVol > 0 ? bar.volume / avgVol : 1

  const computed = gradeCandle(atrMultiple, bodyRatio, relVolume, moveFloor)
  // Prefer the grade the scan already recorded for this date so a resolved
  // candle matches the map exactly; fall back to the freshly computed grade.
  const grade = move.allGrades.get(date) ?? computed.grade

  const changePct = ((bar.close - prev.close) / prev.close) * 100
  const gapPct = ((bar.open - prev.close) / prev.close) * 100
  const rangePct = (totalRange / prev.close) * 100

  const lastIdx = bars.length - 1
  const ageBars = lastIdx - i
  const ageDays = calendarDaysBetween(bar.date, effectiveTradingDay())
  const isFresh = ageDays <= freshnessDays

  return {
    date: bar.date,
    changePct,
    atrMultiple,
    relVolume,
    gapPct,
    rangePct,
    bodyRatio,
    grade,
    score: computed.score,
    close: bar.close,
    prevClose: prev.close,
    ageBars,
    isFresh,
  }
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

        // ── Participation (volume) feeds the blended score ──
        const avgVol = avgVolumeBefore(bars, i)
        const relVolume = avgVol > 0 ? bar.volume / avgVol : 1

        const { grade, score } = gradeCandle(atrMultiple, bodyRatio, relVolume, moveMultiple)
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
          score,
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

// ── Shared grade presentation ────────────────────────────────────────────────
// One place that maps ANY grade string — the new A/B/C/D tiers or a legacy
// 'A+'/'strong' value persisted on an old trade — to a consistent visual family
// (label, glyph, CSS suffix, and the neon palette used across the list, badges,
// and the candle chart). Keeping this centralized means the list, the summary
// pills, and the modal all render a given grade identically.

export interface GradeVisual {
  /** Text shown on badges/tags, e.g. 'A' or (legacy) 'A+'. */
  label: string
  /** Small glyph paired with the label. */
  glyph: string
  /** CSS class suffix: `em-grade-${key}` / `td-stats-${key}`. */
  key: 'a' | 'b' | 'c' | 'd' | 'aplus' | 'strong'
  /** Primary neon color (CSS var) for outlines/accents. */
  color: string
  /** rgba triplet (no alpha) for building tinted fills/glows in SVG. */
  rgb: string
}

const GRADE_VISUALS: Record<AnyExplosiveGrade, GradeVisual> = {
  // New four-tier scheme.
  A: { label: 'A', glyph: '⚡', key: 'a', color: 'var(--neon-orange)', rgb: '255,140,0' },
  B: { label: 'B', glyph: '◆', key: 'b', color: 'var(--neon-pink)', rgb: '255,61,242' },
  C: { label: 'C', glyph: '◇', key: 'c', color: 'var(--neon-cyan)', rgb: '34,227,255' },
  D: { label: 'D', glyph: '·', key: 'd', color: 'var(--muted)', rgb: '150,150,170' },
  // Legacy values (render-only, for trades placed before the A/B/C/D migration).
  'A+': { label: 'A+', glyph: '⚡', key: 'aplus', color: 'var(--neon-orange)', rgb: '255,140,0' },
  strong: { label: 'Strong', glyph: '◆', key: 'strong', color: 'var(--neon-pink)', rgb: '255,61,242' },
}

/** Resolve a grade (new or legacy) to its visual family. */
export function gradeVisual(grade: AnyExplosiveGrade): GradeVisual {
  return GRADE_VISUALS[grade] ?? GRADE_VISUALS.D
}

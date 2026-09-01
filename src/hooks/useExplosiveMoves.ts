/**
 * useExplosiveMoves
 *
 * Scans the FULL cached bar history for each watchlist symbol and identifies
 * every candle that qualifies as an "explosive move away" per the supply/demand
 * strategy.
 *
 * Qualification criteria (both must pass):
 *   1. |close-to-close %| >= minChangePct  (default 5%)
 *   2. body ratio >= minBodyRatio           (default 0.60)
 *      body ratio = |close - open| / (high - low)
 *      A pure marubozu = 1.0; a pure doji = 0.0
 *
 * Grade:
 *   'A+' — body ratio >= A_PLUS_BODY_RATIO (0.70) — explosive marubozu, little/no wick
 *   'strong' — qualifies but body ratio < 0.70 — still a meaningful move, smaller wick
 *
 * The A+ definition comes directly from the supply/demand cheatsheet:
 *   "Move away = most important. Want A+: explosive, large body, little/no wick (marubozu)."
 *
 * Returns:
 *   - moves[]       — one entry per symbol, using the most recent qualifying candle
 *                     (for the Signals page table)
 *   - gradesBySym   — Map<symbol, Map<date, grade>> covering all qualifying candles
 *                     in history (passed to the detail modal to highlight every
 *                     explosive bar on the chart, not just the latest one)
 */

import { useMemo } from 'react'
import { loadCached } from '../data/dailyCache'
import type { Stock } from '../data/stocks'

export type ExplosiveGrade = 'A+' | 'strong'

export interface ExplosiveCandle {
  date: string
  /** Close-to-close % change. */
  changePct: number
  /** (open - prevClose) / prevClose × 100 */
  gapPct: number
  /** (high - low) / prevClose × 100 */
  rangePct: number
  /** |close - open| / (high - low) */
  bodyRatio: number
  grade: ExplosiveGrade
  close: number
  prevClose: number
}

export interface ExplosiveMove {
  symbol: string
  name: string
  /** Most recent qualifying candle for this symbol. */
  latest: ExplosiveCandle
  /** All qualifying candles for this symbol across the full history, date → grade. */
  allGrades: Map<string, ExplosiveGrade>
}

export interface UseExplosiveMovesResult {
  moves: ExplosiveMove[]
  /** Symbols in cache but with < 2 bars (can't compute a move). */
  skippedCount: number
  /** Symbols not yet in cache. */
  uncachedCount: number
}

/** Minimum absolute % move to qualify. */
const DEFAULT_MIN_CHANGE_PCT = 5

/** Body-to-range ratio floor for any qualifying candle. */
const MIN_BODY_RATIO = 0.60

/** Body-to-range ratio threshold for A+ grade (marubozu-quality). */
const A_PLUS_BODY_RATIO = 0.70

function gradeCandle(bodyRatio: number): ExplosiveGrade {
  return bodyRatio >= A_PLUS_BODY_RATIO ? 'A+' : 'strong'
}

export function useExplosiveMoves(
  stocks: Stock[],
  minChangePct: number = DEFAULT_MIN_CHANGE_PCT,
): UseExplosiveMovesResult {
  return useMemo(() => {
    const symbols = stocks.map((s) => s.symbol)
    const cached = loadCached(symbols)

    let skippedCount = 0
    let uncachedCount = 0
    const moves: ExplosiveMove[] = []

    for (const stock of stocks) {
      const entry = cached[stock.symbol]

      if (!entry || entry.bars.length === 0) {
        uncachedCount++
        continue
      }

      if (entry.bars.length < 2) {
        skippedCount++
        continue
      }

      const bars = entry.bars
      const allGrades = new Map<string, ExplosiveGrade>()
      let latestCandle: ExplosiveCandle | null = null

      // Walk every bar (starting at index 1 so we have a prev bar for close-to-close).
      for (let i = 1; i < bars.length; i++) {
        const bar  = bars[i]
        const prev = bars[i - 1]

        const totalRange = bar.high - bar.low
        if (totalRange === 0) continue // skip flat bars (halted, etc.)

        const bodySize  = Math.abs(bar.close - bar.open)
        const bodyRatio = bodySize / totalRange

        const changePct = ((bar.close - prev.close) / prev.close) * 100

        if (Math.abs(changePct) < minChangePct) continue
        if (bodyRatio < MIN_BODY_RATIO) continue

        const grade   = gradeCandle(bodyRatio)
        const gapPct  = ((bar.open  - prev.close) / prev.close) * 100
        const rangePct = totalRange / prev.close * 100

        const candle: ExplosiveCandle = {
          date:      bar.date,
          changePct,
          gapPct,
          rangePct,
          bodyRatio,
          grade,
          close:     bar.close,
          prevClose: prev.close,
        }

        allGrades.set(bar.date, grade)

        // Track the most recent qualifying candle.
        latestCandle = candle
      }

      if (!latestCandle || allGrades.size === 0) continue

      moves.push({
        symbol:    stock.symbol,
        name:      stock.name,
        latest:    latestCandle,
        allGrades,
      })
    }

    // Sort by most recent explosive candle date desc, then by absolute move size.
    moves.sort((a, b) => {
      if (a.latest.date !== b.latest.date) {
        return a.latest.date > b.latest.date ? -1 : 1
      }
      return Math.abs(b.latest.changePct) - Math.abs(a.latest.changePct)
    })

    return { moves, skippedCount, uncachedCount }
  }, [stocks, minChangePct])
}

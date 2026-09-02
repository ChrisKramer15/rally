/**
 * useBasingZones
 *
 * Finds supply/demand *basing zones* — the tight consolidation that precedes an
 * explosive move away. It reuses the same explosive-candle criteria as
 * useExplosiveMoves, then walks BACKWARD from each explosive candle to isolate
 * the base, quantify how tight/clean it was, and derive the two zone lines
 * (proximal / distal) the strategy trades against.
 *
 * Per the supply/demand docs, a valid zone = BASING + STRONG MOVE AWAY:
 *   - Demand: Drop-Base-Rally (reversal) / Rally-Base-Rally (continuation)
 *   - Supply: Rally-Base-Drop (reversal) / Drop-Base-Drop (continuation)
 *   - Basing is best when tight and 1–4 candles; longer runs = weak imbalance
 *     (capped at 7 candles).
 * Anchor candles use the SAME ATR-based explosive test as the Signals page, and
 * each zone is checked for mitigation (whether price has since returned to it).
 *
 * All tightness/size measures are normalized by ATR so a $24 stock and a $1600
 * stock grade on the same scale without per-symbol tuning.
 */

import { useMemo } from 'react'
import { loadCached } from '../data/dailyCache'
import type { Stock } from '../data/stocks'
import type { DailyBar } from '../data/tiingo'

export type ZoneGrade = 'A+' | 'good' | 'weak'
export type ZoneKind = 'demand' | 'supply'

export interface BasingZone {
  symbol: string
  kind: ZoneKind
  /** Line closest to current price. */
  proximal: number
  /** Line furthest from current price. */
  distal: number
  /** Zone height as % of the distal price. */
  baseHeightPct: number
  /** Number of basing candles (1 = single-candle base). */
  candleCount: number
  /** First basing candle date (YYYY-MM-DD). */
  startDate: string
  /** Last basing candle date — the day before the explosion. */
  endDate: string
  /** The explosive move-away candle date. */
  explosiveDate: string
  /** Base height / ATR. Lower is tighter. */
  tightness: number
  /** explosiveBody / avgBaseBody. Higher = cleaner imbalance. */
  bodyContrast: number
  /** avgBaseVolume / priorVolume. < 1 means volume dried up in the base (good). */
  volumeDrop: number
  grade: ZoneGrade
  /**
   * True once price has returned to the proximal line after the explosion.
   * A mitigated zone is considered "used up" — the fresh first-touch entry is
   * gone — so it's de-emphasized visually.
   */
  mitigated: boolean
  /** Date price first returned to the proximal line, or null if still fresh. */
  mitigatedDate: string | null
}

export interface UseBasingZonesResult {
  /** One entry per symbol: the most recent detected zone. */
  zones: BasingZone[]
  skippedCount: number
  uncachedCount: number
}

// ── Explosive-candle criteria (kept in sync with useExplosiveMoves) ──────────
/**
 * Anchor candles use the SAME test as the Signals page: a move of at least
 * this multiple of ATR, with a body that fills at least MIN_BODY_RATIO of the
 * candle's range. This keeps zone anchors consistent with explosive moves.
 */
const DEFAULT_MOVE_MULTIPLE = 2.0
const MIN_BODY_RATIO = 0.6

// ── Base-detection tuning ────────────────────────────────────────────────────
/** ATR lookback used to normalize base size. */
const ATR_PERIOD = 14
/** Hard cap on basing candles; a run longer than this is not a clean base. */
const MAX_BASE_CANDLES = 7
/** A candle whose range exceeds this × ATR ends the base (it's a prior move). */
const PRIOR_MOVE_RANGE_MULT = 2.0
/** Running base height must stay within this × ATR to keep extending the base. */
const TIGHT_LIMIT_MULT = 1.5
/** Number of bars before the base used for the "volume dried up" comparison. */
const PRIOR_VOL_WINDOW = 10

/**
 * Wilder-style ATR over the `period` bars ending at (and excluding) `endIdx`.
 * Returns null if there isn't enough history.
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

function gradeZone(z: {
  tightness: number
  candleCount: number
  bodyContrast: number
  volumeDrop: number
}): ZoneGrade {
  // Weighted 0–1 score across the four footprints of a clean base.
  const tightnessScore = clamp01(1 - z.tightness / TIGHT_LIMIT_MULT) // tighter → 1
  // 1–4 candles is the ideal tight base; 5–7 is acceptable. (Cap is 7.)
  const lengthScore = z.candleCount <= 4 ? 1 : 0.5
  const contrastScore = clamp01((z.bodyContrast - 1) / 3) // 4×+ body → ~1
  const volumeScore = clamp01(1 - z.volumeDrop) // volume drying up → higher

  const score =
    0.35 * tightnessScore +
    0.25 * lengthScore +
    0.25 * contrastScore +
    0.15 * volumeScore

  if (score >= 0.7) return 'A+'
  if (score >= 0.45) return 'good'
  return 'weak'
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/**
 * Detect a single basing zone anchored on the explosive candle at `explosiveIdx`.
 * Returns null if no valid base precedes it.
 */
function detectBase(
  bars: DailyBar[],
  explosiveIdx: number,
  symbol: string,
): BasingZone | null {
  const atr = atrBefore(bars, explosiveIdx)
  if (!atr || atr <= 0) return null

  const explosive = bars[explosiveIdx]
  const kind: ZoneKind = explosive.close >= explosive.open ? 'demand' : 'supply'

  let hi = -Infinity
  let lo = Infinity
  let startIdx = explosiveIdx // exclusive of the explosive candle until we add one

  for (
    let j = explosiveIdx - 1;
    j >= 0 && explosiveIdx - j <= MAX_BASE_CANDLES;
    j--
  ) {
    const b = bars[j]
    // A candle that is itself a big move is the boundary of the base, not part of it.
    if (b.high - b.low > PRIOR_MOVE_RANGE_MULT * atr) break
    const nextHi = Math.max(hi, b.high)
    const nextLo = Math.min(lo, b.low)
    // Stop once including this candle would break the tightness envelope.
    if (nextHi - nextLo > TIGHT_LIMIT_MULT * atr) break
    hi = nextHi
    lo = nextLo
    startIdx = j
  }

  const candleCount = explosiveIdx - startIdx
  if (candleCount < 1) return null // no base = support/resistance, not a zone

  // Zone lines. Proximal = the edge the move departed from (closest to price
  // after the move); distal = the far edge.
  const proximal = kind === 'demand' ? hi : lo
  const distal = kind === 'demand' ? lo : hi
  const baseHeight = hi - lo
  const baseHeightPct = distal !== 0 ? (baseHeight / Math.abs(distal)) * 100 : 0

  // Body contrast: explosive body vs average basing body.
  let baseBodySum = 0
  let baseVolSum = 0
  for (let k = startIdx; k < explosiveIdx; k++) {
    baseBodySum += Math.abs(bars[k].close - bars[k].open)
    baseVolSum += bars[k].volume
  }
  const avgBaseBody = baseBodySum / candleCount
  const explosiveBody = Math.abs(explosive.close - explosive.open)
  const bodyContrast = avgBaseBody > 0 ? explosiveBody / avgBaseBody : Infinity

  // Volume drop: base volume vs the window before the base.
  const avgBaseVol = baseVolSum / candleCount
  const priorStart = Math.max(0, startIdx - PRIOR_VOL_WINDOW)
  let priorVolSum = 0
  let priorVolCount = 0
  for (let k = priorStart; k < startIdx; k++) {
    priorVolSum += bars[k].volume
    priorVolCount++
  }
  const avgPriorVol = priorVolCount > 0 ? priorVolSum / priorVolCount : avgBaseVol
  const volumeDrop = avgPriorVol > 0 ? avgBaseVol / avgPriorVol : 1

  const tightness = baseHeight / atr
  const grade = gradeZone({ tightness, candleCount, bodyContrast, volumeDrop })

  // Mitigation: has price returned to the proximal (entry) line since the
  // explosion? For demand, that's a later candle dipping to/below proximal;
  // for supply, a later candle rising to/above proximal. The first such touch
  // "uses up" the zone's fresh entry.
  let mitigated = false
  let mitigatedDate: string | null = null
  for (let k = explosiveIdx + 1; k < bars.length; k++) {
    const b = bars[k]
    const touched = kind === 'demand' ? b.low <= proximal : b.high >= proximal
    if (touched) {
      mitigated = true
      mitigatedDate = b.date
      break
    }
  }

  return {
    symbol,
    kind,
    proximal,
    distal,
    baseHeightPct,
    candleCount,
    startDate: bars[startIdx].date,
    endDate: bars[explosiveIdx - 1].date,
    explosiveDate: explosive.date,
    tightness,
    bodyContrast: Number.isFinite(bodyContrast) ? bodyContrast : 999,
    volumeDrop,
    grade,
    mitigated,
    mitigatedDate,
  }
}

/**
 * Detect every basing zone across a single symbol's bar history.
 * Exported so the detail modal can compute zones for the chart it already loads.
 */
export function detectBasesForBars(
  bars: DailyBar[],
  symbol: string,
  moveMultiple: number = DEFAULT_MOVE_MULTIPLE,
): BasingZone[] {
  if (bars.length < ATR_PERIOD + 2) return []

  const zones: BasingZone[] = []
  // Start once there's enough history behind us to compute ATR at the anchor.
  for (let i = ATR_PERIOD + 1; i < bars.length; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]
    const range = bar.high - bar.low
    if (range === 0) continue

    // Same anchor test as the Signals page: ATR-relative move + tight body.
    const atr = atrBefore(bars, i)
    if (!atr || atr <= 0) continue
    const atrMultiple = Math.abs(bar.close - prev.close) / atr
    const bodyRatio = Math.abs(bar.close - bar.open) / range
    if (atrMultiple < moveMultiple) continue
    if (bodyRatio < MIN_BODY_RATIO) continue

    const zone = detectBase(bars, i, symbol)
    if (zone) zones.push(zone)
  }
  return zones
}

export function useBasingZones(
  stocks: Stock[],
  moveMultiple: number = DEFAULT_MOVE_MULTIPLE,
): UseBasingZonesResult {
  return useMemo(() => {
    const symbols = stocks.map((s) => s.symbol)
    const cached = loadCached(symbols)

    let skippedCount = 0
    let uncachedCount = 0
    const zones: BasingZone[] = []

    for (const stock of stocks) {
      const entry = cached[stock.symbol]
      if (!entry || entry.bars.length === 0) {
        uncachedCount++
        continue
      }
      if (entry.bars.length < ATR_PERIOD + 2) {
        skippedCount++
        continue
      }

      const symbolZones = detectBasesForBars(entry.bars, stock.symbol, moveMultiple)
      if (symbolZones.length === 0) continue

      // Keep the most recent zone per symbol for the summary list.
      zones.push(symbolZones[symbolZones.length - 1])
    }

    zones.sort((a, b) => (a.explosiveDate > b.explosiveDate ? -1 : 1))

    return { zones, skippedCount, uncachedCount }
  }, [stocks, moveMultiple])
}

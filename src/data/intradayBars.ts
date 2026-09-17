/**
 * intradayBars: build APPROXIMATE intraday OHLC candles from the minute-price
 * stream stored in `intraday_quotes`.
 *
 * Why approximate: the settler stores a single last price per symbol per minute
 * (not true tick data and not per-minute OHLC). We synthesize candles by
 * bucketing those minute samples into fixed windows:
 *   open  = first sampled price in the bucket
 *   high  = max sampled price
 *   low   = min sampled price
 *   close = last sampled price
 * An intra-minute spike that happened and reverted between two samples is
 * invisible, so wicks are undersampled. For hourly/4H review of a paper trade
 * that's fine; it's not tick-accurate. Volume isn't stored, so bars carry none.
 *
 * Bars use a real epoch-ms timestamp (unlike DailyBar, whose axis is a
 * YYYY-MM-DD date string that can't represent an intraday time).
 */

/** One sampled intraday price point (from intraday_quotes). */
export interface IntradayPoint {
  /** Capture time, epoch milliseconds. */
  t: number
  /** Sampled price at `t`. */
  price: number
}

/** One synthesized intraday OHLC candle. */
export interface IntradayBar {
  /** Bucket start time, epoch milliseconds (the candle's timestamp). */
  t: number
  open: number
  high: number
  low: number
  close: number
}

/** Supported intraday intervals, in minutes. */
export type IntradayInterval = 60 | 240

/**
 * Bucket a time-ordered price series into fixed-interval OHLC candles.
 *
 * Buckets are aligned to absolute epoch boundaries (floor(t / interval)), so a
 * given wall-clock hour always maps to the same bucket regardless of where the
 * data happens to start. Empty buckets are simply absent (no gap-filling) —
 * outside market hours there are no samples, and drawing a flat bar across an
 * overnight gap would be misleading.
 *
 * @param points   time-ordered (or unordered) sampled prices
 * @param interval bucket size in minutes (60 = hourly, 240 = 4H)
 * @returns candles ordered oldest -> newest
 */
export function bucketIntoBars(points: IntradayPoint[], interval: IntradayInterval): IntradayBar[] {
  if (points.length === 0) return []

  const bucketMs = interval * 60_000
  // Sort defensively so open/close are the true first/last of each bucket even
  // if the caller passed points out of order.
  const sorted = [...points].sort((a, b) => a.t - b.t)

  const byBucket = new Map<number, IntradayBar>()
  const order: number[] = []

  for (const p of sorted) {
    if (!Number.isFinite(p.price) || p.price <= 0) continue
    const bucketStart = Math.floor(p.t / bucketMs) * bucketMs
    const existing = byBucket.get(bucketStart)
    if (!existing) {
      order.push(bucketStart)
      byBucket.set(bucketStart, {
        t: bucketStart,
        open: p.price,
        high: p.price,
        low: p.price,
        close: p.price,
      })
    } else {
      if (p.price > existing.high) existing.high = p.price
      if (p.price < existing.low) existing.low = p.price
      existing.close = p.price
    }
  }

  return order.map((k) => byBucket.get(k)!)
}

/**
 * Trading-day helpers for a daily (swing-trading) data model.
 *
 * The app scopes to US stocks & ETFs, so "freshness" is tied to the US regular
 * session close. A given trading day's daily bar is not considered FINAL until
 * one minute after the close (4:01 PM ET). Before that cutoff we reuse the last
 * confirmed session's bar; after it, that session's bar becomes fetchable and
 * cached symbols go stale so the next visit pulls it exactly once.
 *
 * Everything is computed in America/New_York regardless of the user's local
 * timezone, using Intl date parts (no external tz library).
 *
 * Scope note: this deliberately models only the regular Mon–Fri session and a
 * post-close cutoff. It does NOT account for market holidays or half-days — on a
 * holiday the "effective trading day" will point at that date until the next
 * session's data exists. That's acceptable for a cache-freshness heuristic (a
 * missing/empty provider response for a holiday simply means no new bar), and
 * keeping it dependency-free avoids shipping/maintaining a holiday calendar.
 * Crypto/forex (24/7) are intentionally out of scope.
 */

/** Minute after the 16:00 ET close at which a session's daily bar is treated as final. */
export const CLOSE_CUTOFF_MINUTES = 16 * 60 + 1 // 16:01 ET

/** A calendar date in the exchange timezone, expressed as YYYY-MM-DD. */
export type TradingDay = string

interface EtParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  /** 0 = Sunday ... 6 = Saturday, in ET. */
  weekday: number
}

const ET_TIME_ZONE = 'America/New_York'

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

// Reusable formatter: extract wall-clock parts in the exchange timezone.
const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  weekday: 'short',
})

/** Break a Date into its America/New_York wall-clock parts. */
function etPartsOf(date: Date): EtParts {
  const parts = etFormatter.formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  // Intl can emit "24" for midnight under hour12:false; normalize to 0.
  const rawHour = Number(get('hour'))
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  }
}

function toIsoDay(year: number, month: number, day: number): TradingDay {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

/** True for Saturday/Sunday in ET. */
function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6
}

/** Step an ISO day back by one calendar day (UTC-noon anchor avoids DST edge cases). */
function previousIsoDay(day: TradingDay): TradingDay {
  const [y, m, d] = day.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  anchor.setUTCDate(anchor.getUTCDate() - 1)
  return toIsoDay(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, anchor.getUTCDate())
}

/** Walk backwards to the most recent Mon–Fri (returns the input if already a weekday). */
function lastWeekday(day: TradingDay): TradingDay {
  let cursor = day
  // Reconstruct weekday from the ISO day via a UTC-noon anchor.
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = cursor.split('-').map(Number)
    const wd = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
    if (!isWeekend(wd)) return cursor
    cursor = previousIsoDay(cursor)
  }
  return cursor
}

/**
 * The most recent trading day whose daily bar should be considered FINAL as of
 * `now`. This is the value cached alongside each symbol; if a symbol's stored
 * `lastFetchedTradingDay` equals this, it's fresh and can be skipped.
 *
 * Rules (regular session only):
 *  - On a weekday at/after 16:01 ET -> today.
 *  - On a weekday before 16:01 ET   -> the previous weekday (today's bar isn't final yet).
 *  - On a weekend                   -> the previous weekday (Friday).
 */
export function effectiveTradingDay(now: Date = new Date()): TradingDay {
  const et = etPartsOf(now)
  const today = toIsoDay(et.year, et.month, et.day)

  if (isWeekend(et.weekday)) {
    return lastWeekday(previousIsoDay(today))
  }

  const minutesSinceMidnight = et.hour * 60 + et.minute
  if (minutesSinceMidnight >= CLOSE_CUTOFF_MINUTES) {
    // Weekday, after the close cutoff: today's session is final.
    return today
  }

  // Weekday, before the cutoff: the latest final bar is the prior weekday.
  return lastWeekday(previousIsoDay(today))
}

/**
 * Whether a symbol whose data was last fetched for `lastFetchedTradingDay` is
 * still fresh as of `now`. Fresh means: we already hold the latest FINAL bar,
 * so no request is needed.
 */
export function isFresh(
  lastFetchedTradingDay: TradingDay | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastFetchedTradingDay) return false
  return lastFetchedTradingDay >= effectiveTradingDay(now)
}

/** Calendar-month key (YYYY-MM) in ET, used to bucket the unique-symbol usage meter. */
export function currentMonthKey(now: Date = new Date()): string {
  const et = etPartsOf(now)
  return `${et.year}-${String(et.month).padStart(2, '0')}`
}

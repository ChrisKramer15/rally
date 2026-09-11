// Trading-day / freshness helpers for the collect-daily-bars Edge Function.
//
// Extracted into its own module so the pure date logic is unit-testable without
// importing index.ts (which starts a server via Deno.serve on import). This
// mirrors the client's src/data/marketCalendar.ts; keep the two in sync.

/** Minute after the 16:00 ET close at which a session's daily bar is final. */
export const CLOSE_CUTOFF_MINUTES = 16 * 60 + 1 // 16:01 ET

/**
 * Minutes after midnight ET before which a just-closed session's daily bar is
 * NOT yet reliably published by Tiingo. Catch-up runs that fire inside the
 * (close, publish) window must not treat "today" as their freshness target, or
 * they'll see "no symbol has today's bar" and re-pull an unpublished session.
 * Tiingo's finalized EOD adjusted bar is typically available ~5:30 PM ET, so we
 * use a conservative 18:00 ET (2h post-close) publish threshold.
 */
export const EOD_PUBLISH_CUTOFF_MINUTES = 18 * 60 // 18:00 ET

const ET_WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

export interface EtParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: number
}

/** Break a Date into its America/New_York wall-clock parts. */
export function etParts(date: Date): EtParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const rawHour = Number(get('hour'))
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: rawHour === 24 ? 0 : rawHour, // Intl can emit "24" at midnight
    minute: Number(get('minute')),
    weekday: ET_WEEKDAY_INDEX[get('weekday')] ?? 0,
  }
}

export function toIsoDay(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Step an ISO day back one calendar day (UTC-noon anchor avoids DST edges). */
export function previousIsoDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  anchor.setUTCDate(anchor.getUTCDate() - 1)
  return toIsoDay(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, anchor.getUTCDate())
}

/** Walk back to the most recent Mon-Fri (returns input if already a weekday). */
export function lastWeekday(day: string): string {
  let cursor = day
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = cursor.split('-').map(Number)
    const wd = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
    if (wd !== 0 && wd !== 6) return cursor
    cursor = previousIsoDay(cursor)
  }
  return cursor
}

/**
 * The most recent trading day whose daily bar should be considered FINAL as of
 * `now` (YYYY-MM-DD, ET). This is the date the freshest stored bar can possibly
 * carry.
 *
 * Mirrors the client's marketCalendar.effectiveTradingDay:
 *   - weekday at/after 16:01 ET -> today
 *   - weekday before 16:01 ET   -> previous weekday
 *   - weekend                   -> previous weekday (Friday)
 * Holidays are intentionally not modeled (a missing bar just means no skip).
 */
export function effectiveTradingDay(now: Date = new Date()): string {
  const et = etParts(now)
  const today = toIsoDay(et.year, et.month, et.day)
  if (et.weekday === 0 || et.weekday === 6) {
    return lastWeekday(previousIsoDay(today))
  }
  const minutesSinceMidnight = et.hour * 60 + et.minute
  if (minutesSinceMidnight >= CLOSE_CUTOFF_MINUTES) return today
  return lastWeekday(previousIsoDay(today))
}

/**
 * The freshness target for a SMART catch-up run.
 *
 * Catch-up exists to backfill the PRIOR completed session that the overnight
 * primary may have missed — never to chase a session that closed minutes ago.
 * So we start from effectiveTradingDay() but, if we're on a weekday between the
 * close (16:01 ET) and Tiingo's publish threshold (18:00 ET), step back one more
 * weekday. That way a catch-up firing right around the close validates the last
 * SAFELY PUBLISHED session instead of one whose bar doesn't exist yet.
 *
 * This makes catch-up correctness independent of exact cron timing (the 0014
 * schedule shift is the defense-in-depth pair, not the sole guarantee).
 */
export function effectiveCatchupDay(now: Date = new Date()): string {
  const base = effectiveTradingDay(now)
  const et = etParts(now)
  if (et.weekday === 0 || et.weekday === 6) return base // weekend: already prior weekday
  const minutesSinceMidnight = et.hour * 60 + et.minute
  if (
    minutesSinceMidnight >= CLOSE_CUTOFF_MINUTES &&
    minutesSinceMidnight < EOD_PUBLISH_CUTOFF_MINUTES
  ) {
    // Just-closed session isn't reliably published yet: target the prior weekday.
    return lastWeekday(previousIsoDay(base))
  }
  return base
}

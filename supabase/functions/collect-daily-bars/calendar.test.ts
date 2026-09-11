// Unit tests for the trading-day / freshness helpers used by the smart catch-up.
//
// Run with:  deno test supabase/functions/collect-daily-bars/calendar.test.ts
//
// These prove the boundary behaviour that motivated 0014 + effectiveCatchupDay:
// a catch-up firing in the (close, publish) window must NOT target the session
// that just closed (its bar isn't published yet), but one firing after the
// publish threshold may.
//
// All fixed instants below are chosen so their America/New_York wall-clock time
// is unambiguous. We use EST dates (January) to keep UTC->ET offsets fixed at
// -5, so the comments' ET times are exact.

import { assertEquals } from 'jsr:@std/assert@1'
import { effectiveTradingDay, effectiveCatchupDay } from './calendar.ts'

// Helper: build a UTC instant. During EST (UTC-5), ET = UTC - 5h.
// 2026-01 is a normal winter month with no DST transition.
function utc(y: number, mo: number, d: number, h: number, mi: number): Date {
  return new Date(Date.UTC(y, mo - 1, d, h, mi, 0))
}

// --- effectiveTradingDay (baseline, unchanged behaviour) -------------------

Deno.test('effectiveTradingDay: weekday morning targets previous session', () => {
  // Wed 2026-01-14 09:00 ET  = 14:00 UTC (EST). Before the 16:01 close cutoff.
  // => latest FINAL bar is Tue 2026-01-13.
  assertEquals(effectiveTradingDay(utc(2026, 1, 14, 14, 0)), '2026-01-13')
})

Deno.test('effectiveTradingDay: weekday after close targets today', () => {
  // Wed 2026-01-14 16:30 ET = 21:30 UTC (EST). After the 16:01 cutoff.
  // => today's session (Wed) is now final.
  assertEquals(effectiveTradingDay(utc(2026, 1, 14, 21, 30)), '2026-01-14')
})

Deno.test('effectiveTradingDay: weekend rolls back to Friday', () => {
  // Sat 2026-01-17 12:00 ET = 17:00 UTC (EST). => previous weekday = Fri 01-16.
  assertEquals(effectiveTradingDay(utc(2026, 1, 17, 17, 0)), '2026-01-16')
})

// --- effectiveCatchupDay (the new clamp) -----------------------------------

Deno.test('catchup morning matches effectiveTradingDay (prior session)', () => {
  // Wed 09:00 ET: well before close. Clamp is a no-op here.
  const t = utc(2026, 1, 14, 14, 0)
  assertEquals(effectiveCatchupDay(t), effectiveTradingDay(t))
  assertEquals(effectiveCatchupDay(t), '2026-01-13')
})

Deno.test('catchup in the (close, publish) window clamps back a weekday', () => {
  // Wed 2026-01-14 16:30 ET = 21:30 UTC. Session just closed but Tiingo has not
  // published the finalized bar yet (< 18:00 ET). effectiveTradingDay would say
  // "2026-01-14" (today); the catch-up clamp must step back to Tue 2026-01-13.
  const t = utc(2026, 1, 14, 21, 30)
  assertEquals(effectiveTradingDay(t), '2026-01-14') // proves the hazard exists
  assertEquals(effectiveCatchupDay(t), '2026-01-13') // clamp fixes it
})

Deno.test('catchup exactly at 16:01 ET (cutoff) clamps back', () => {
  // Wed 2026-01-14 16:01 ET = 21:01 UTC. First minute inside the window.
  const t = utc(2026, 1, 14, 21, 1)
  assertEquals(effectiveCatchupDay(t), '2026-01-13')
})

Deno.test('catchup at/after publish threshold (18:00 ET) trusts today', () => {
  // Wed 2026-01-14 18:00 ET = 23:00 UTC. Tiingo has published; today is safe.
  const t = utc(2026, 1, 14, 23, 0)
  assertEquals(effectiveCatchupDay(t), '2026-01-14')
})

Deno.test('catchup just before close (15:59 ET) targets prior session', () => {
  // Wed 2026-01-14 15:59 ET = 20:59 UTC. Before close: prior session, no clamp
  // needed (effectiveTradingDay already returns the prior weekday).
  const t = utc(2026, 1, 14, 20, 59)
  assertEquals(effectiveCatchupDay(t), '2026-01-13')
})

Deno.test('catchup on Monday morning rolls back over the weekend', () => {
  // Mon 2026-01-12 09:00 ET = 14:00 UTC. Prior session is Fri 2026-01-09.
  const t = utc(2026, 1, 12, 14, 0)
  assertEquals(effectiveCatchupDay(t), '2026-01-09')
})

Deno.test('catchup on Friday in-window clamps to Thursday', () => {
  // Fri 2026-01-16 16:30 ET = 21:30 UTC. In the (close, publish) window.
  // Clamp steps back one weekday => Thu 2026-01-15.
  const t = utc(2026, 1, 16, 21, 30)
  assertEquals(effectiveCatchupDay(t), '2026-01-15')
})

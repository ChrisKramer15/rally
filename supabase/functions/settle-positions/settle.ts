// Pure fill/settle decision logic for the settle-positions Edge Function.
//
// Kept side-effect-free (no DB, no fetch, no Deno.serve) so it's unit-testable
// in isolation — mirrors the calendar.ts / retry.ts split in collect-daily-bars.
//
// SEMANTICS (confirmed with the product owner):
//   • Fill a pending LIMIT when live price CROSSES the limit:
//       long  → live <= limit   (price dipped to the demand entry)
//       short → live >= limit   (price rose to the supply entry)
//     Entry is recorded at the LIMIT price (idealized limit fill), not the live
//     tick — a limit is supposed to fill at your price. A gap THROUGH the limit
//     still triggers (we test "crossed", not "exactly touched").
//   • Settle an OPEN position when live price crosses a managed level:
//       long  → live <= stop (loss)   OR live >= target (gain)
//       short → live >= stop (loss)   OR live <= target (gain)
//     Exit is recorded at the LEVEL that was crossed (stop or target), not the
//     live tick — consistent with the limit-fill convention (you exit at your
//     level). If both a stop and a target were crossed in the same gap, the
//     STOP wins (conservative: assume the adverse level hit first).

export type Side = 'long' | 'short'

/** A pending limit order's fill decision inputs. */
export interface FillInput {
  side: Side
  limitPrice: number
  livePrice: number
}

/** Whether a pending limit order fills at the given live price. */
export function shouldFill({ side, limitPrice, livePrice }: FillInput): boolean {
  if (!(limitPrice > 0) || !(livePrice > 0)) return false
  return side === 'long' ? livePrice <= limitPrice : livePrice >= limitPrice
}

/** An open position's exit decision inputs. */
export interface SettleInput {
  side: Side
  stopLossPrice: number
  cashOutPrice: number
  livePrice: number
}

export type ExitReason = 'stop' | 'target'

export interface SettleResult {
  /** The level the position exits at (stop or target price). */
  exitPrice: number
  reason: ExitReason
}

/**
 * Decide whether an open position settles at the given live price, and at which
 * level. Returns null when neither level is crossed. When a gap crosses BOTH,
 * the stop is taken (conservative worst-case for the trader).
 */
export function settleAt({ side, stopLossPrice, cashOutPrice, livePrice }: SettleInput): SettleResult | null {
  if (!(livePrice > 0)) return null

  if (side === 'long') {
    const hitStop = stopLossPrice > 0 && livePrice <= stopLossPrice
    const hitTarget = cashOutPrice > 0 && livePrice >= cashOutPrice
    if (hitStop) return { exitPrice: stopLossPrice, reason: 'stop' }
    if (hitTarget) return { exitPrice: cashOutPrice, reason: 'target' }
    return null
  }

  // short
  const hitStop = stopLossPrice > 0 && livePrice >= stopLossPrice
  const hitTarget = cashOutPrice > 0 && livePrice <= cashOutPrice
  if (hitStop) return { exitPrice: stopLossPrice, reason: 'stop' }
  if (hitTarget) return { exitPrice: cashOutPrice, reason: 'target' }
  return null
}

/**
 * Side-adjusted realized P/L in dollars for a closed position.
 *   long  → (exit − entry) × shares
 *   short → (entry − exit) × shares
 */
export function realizedPnl(side: Side, entry: number, exit: number, shares: number): number {
  const per = side === 'short' ? entry - exit : exit - entry
  return round2(per * shares)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Whether the US regular session (09:30–16:00 ET, Mon–Fri) is open at `now`.
 * Holiday-agnostic (same simplification as the app's marketCalendar): on a
 * holiday it may report open, but Finnhub just returns the last quote and no
 * level is crossed, so nothing settles incorrectly.
 */
export function isRegularSessionOpen(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekday = get('weekday')
  if (weekday === 'Sat' || weekday === 'Sun') return false
  let hour = Number(get('hour'))
  if (hour === 24) hour = 0
  const minutes = hour * 60 + Number(get('minute'))
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60
}

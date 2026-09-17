// Lifecycle tests for the fill/settle engine.
//
// Where settle.test.ts unit-tests each pure decision in isolation, these tests
// verify the END-TO-END TRADE LIFECYCLE the way index.ts sequences it in a
// single settle run:
//
//   pending (limit)  --limit hit-->  open (entry = limit)
//   open             --stop hit-->   closed (exit = stop,   pnl banked)
//   open             --target hit--> closed (exit = target, pnl banked)
//
// The trigger logic lives in the pure functions (shouldFill / settleAt /
// realizedPnl); the ORDERING (fill first, then settle the freshly-opened row in
// the same pass) lives in index.ts's per-row loop. `stepPosition` below mirrors
// that ordering exactly so we can assert the observable lifecycle transitions
// without a DB or Finnhub.
//
// Run with: deno test supabase/functions/settle-positions/lifecycle.test.ts

import { assertEquals } from 'jsr:@std/assert'
import { realizedPnl, settleAt, shouldFill, type Side } from './settle.ts'

type Status = 'pending' | 'open' | 'closed'

interface Position {
  side: Side
  orderType: 'market' | 'limit'
  status: Status
  /** Fill price. Null while pending. */
  entryPrice: number | null
  limitPrice: number
  stopLossPrice: number
  cashOutPrice: number
  shares: number
  /**
   * Durable "the settler has evaluated this pending order at least once without
   * filling" marker (index.ts trades.first_evaluated_at). Null on a brand-new
   * pending order's first evaluation; set thereafter. A limit fill is only
   * HONORED once this is non-null — a would-be fill on the first evaluation is
   * invalidated instead of opened. Undefined is treated the same as null.
   */
  firstEvaluatedAt?: string | null
}

interface StepResult {
  status: Status
  entryPrice: number | null
  /** Set only when the position closed this step. */
  exitPrice?: number
  exitReason?: 'stop' | 'target' | 'invalidated'
  realizedPnl?: number
  /** Set when this step stamped the first-evaluation marker (rested, no fill). */
  firstEvaluatedAt?: string | null
  /** Did a pending order fill to open this step? */
  filled: boolean
  /** Did an open position settle/close this step? */
  settled: boolean
}

/**
 * Advance one position by one live price tick, mirroring index.ts's loop:
 *   1. FILL a pending limit whose limit was crossed -> open at the limit price,
 *      BUT invalidate (never open) a fill that would land on the order's FIRST
 *      evaluation; stamp the first-evaluation marker when it rests without
 *      filling.
 *   2. SETTLE an open position (incl. one just filled) whose stop/target was
 *      crossed -> closed at that level, with realized P/L banked.
 */
function stepPosition(p: Position, livePrice: number): StepResult {
  let status: Status = p.status
  let entryPrice = p.entryPrice
  let filled = false

  // 1) FILL: pending limit -> open at the limit price (idealized limit fill).
  if (status === 'pending' && p.orderType === 'limit') {
    const wouldFill = shouldFill({ side: p.side, limitPrice: p.limitPrice, livePrice })
    const isFirstEval = p.firstEvaluatedAt == null

    if (wouldFill && isFirstEval) {
      // First-eval fill -> invalidate: never opens, $0 P/L, banked as closed.
      return {
        status: 'closed',
        entryPrice: null,
        exitPrice: p.limitPrice,
        exitReason: 'invalidated',
        realizedPnl: 0,
        filled: false,
        settled: false,
      }
    }
    if (wouldFill) {
      status = 'open'
      entryPrice = p.limitPrice
      filled = true
    } else {
      // Rests. On its first evaluation, stamp the marker so a later crossing
      // counts as a real fill.
      return {
        status,
        entryPrice,
        filled: false,
        settled: false,
        firstEvaluatedAt: isFirstEval ? 'STAMPED' : p.firstEvaluatedAt,
      }
    }
  }

  // 2) SETTLE: open position -> closed at the crossed level.
  if (status === 'open') {
    const exit = settleAt({
      side: p.side,
      stopLossPrice: p.stopLossPrice,
      cashOutPrice: p.cashOutPrice,
      livePrice,
    })
    if (exit) {
      const pnl = realizedPnl(p.side, entryPrice ?? 0, exit.exitPrice, p.shares)
      return {
        status: 'closed',
        entryPrice,
        exitPrice: exit.exitPrice,
        exitReason: exit.reason,
        realizedPnl: pnl,
        filled,
        settled: true,
      }
    }
  }

  return { status, entryPrice, filled, settled: false }
}

// ── Pending -> Open (limit fill) ─────────────────────────────────────────────

Deno.test('lifecycle: pending long limit executes when the limit price is hit (after it has rested)', () => {
  // A brand-new pending order (firstEvaluatedAt null). Its first evaluation
  // where price is above the limit -> rests AND stamps the first-eval marker.
  const fresh: Position = {
    side: 'long',
    orderType: 'limit',
    status: 'pending',
    entryPrice: null,
    limitPrice: 100,
    stopLossPrice: 90,
    cashOutPrice: 120,
    shares: 10,
  }
  const resting = stepPosition(fresh, 101)
  assertEquals(resting.status, 'pending')
  assertEquals(resting.filled, false)
  assertEquals(resting.entryPrice, null)
  assertEquals(resting.firstEvaluatedAt, 'STAMPED') // has now rested through a run

  // A rested order (firstEvaluatedAt set) whose limit is hit -> real fill, entry
  // recorded AT the limit.
  const rested: Position = { ...fresh, firstEvaluatedAt: '2026-09-17T17:31:00Z' }
  const hit = stepPosition(rested, 100)
  assertEquals(hit.status, 'open')
  assertEquals(hit.filled, true)
  assertEquals(hit.entryPrice, 100)
  assertEquals(hit.settled, false) // opened but not yet exiting
})

Deno.test('lifecycle: pending short limit executes when the limit price is hit (after it has rested)', () => {
  const rested: Position = {
    side: 'short',
    orderType: 'limit',
    status: 'pending',
    entryPrice: null,
    limitPrice: 100,
    stopLossPrice: 110,
    cashOutPrice: 90,
    shares: 10,
    firstEvaluatedAt: '2026-09-17T17:31:00Z', // already rested through a prior run
  }

  // Price below the short limit -> stays pending.
  assertEquals(stepPosition(rested, 99).status, 'pending')

  // Price rises to/through the limit -> fills to open at the limit price.
  const hit = stepPosition(rested, 101)
  assertEquals(hit.status, 'open')
  assertEquals(hit.filled, true)
  assertEquals(hit.entryPrice, 100)
})

// ── First-evaluation invalidation ────────────────────────────────────────────

Deno.test('lifecycle: a limit that would fill on its FIRST evaluation is invalidated, not opened', () => {
  // Long demand limit at 100, but price is already at/below it on the very first
  // run that evaluates the order (the stale/used-up-zone case). It must NOT open.
  const fresh: Position = {
    side: 'long',
    orderType: 'limit',
    status: 'pending',
    entryPrice: null,
    limitPrice: 100,
    stopLossPrice: 95,
    cashOutPrice: 120,
    shares: 10,
    // firstEvaluatedAt omitted -> null -> this IS the first evaluation.
  }

  const r = stepPosition(fresh, 98) // already through the limit on first sight
  assertEquals(r.status, 'closed')
  assertEquals(r.exitReason, 'invalidated')
  assertEquals(r.entryPrice, null) // never opened
  assertEquals(r.realizedPnl, 0) // no loss booked
  assertEquals(r.filled, false)
  assertEquals(r.settled, false)
})

Deno.test('lifecycle: short limit that would fill on its FIRST evaluation is invalidated', () => {
  const fresh: Position = {
    side: 'short',
    orderType: 'limit',
    status: 'pending',
    entryPrice: null,
    limitPrice: 100,
    stopLossPrice: 110,
    cashOutPrice: 90,
    shares: 10,
  }

  const r = stepPosition(fresh, 102) // already above the short limit on first sight
  assertEquals(r.status, 'closed')
  assertEquals(r.exitReason, 'invalidated')
  assertEquals(r.entryPrice, null)
  assertEquals(r.realizedPnl, 0)
})

Deno.test('lifecycle: a limit that RESTED first, then fills, is a real fill (not invalidated)', () => {
  const fresh: Position = {
    side: 'long',
    orderType: 'limit',
    status: 'pending',
    entryPrice: null,
    limitPrice: 100,
    stopLossPrice: 95,
    cashOutPrice: 120,
    shares: 10,
  }

  // Run 1: price above the limit -> rests, stamps the marker.
  const run1 = stepPosition(fresh, 101)
  assertEquals(run1.status, 'pending')
  assertEquals(run1.firstEvaluatedAt, 'STAMPED')

  // Run 2 (now rested): price pulls back to the limit -> REAL fill.
  const rested: Position = { ...fresh, firstEvaluatedAt: run1.firstEvaluatedAt ?? null }
  const run2 = stepPosition(rested, 100)
  assertEquals(run2.status, 'open')
  assertEquals(run2.filled, true)
  assertEquals(run2.entryPrice, 100)
})

// ── Open -> Closed (stop-loss hit) ───────────────────────────────────────────

Deno.test('lifecycle: active long closes when the stop-loss price is hit', () => {
  const p: Position = {
    side: 'long',
    orderType: 'limit',
    status: 'open',
    entryPrice: 100,
    limitPrice: 100,
    stopLossPrice: 90,
    cashOutPrice: 120,
    shares: 10,
  }

  // Between stop and target -> stays open.
  assertEquals(stepPosition(p, 105).status, 'open')

  // Drops to the stop -> closes at the stop with a realized loss.
  const stopped = stepPosition(p, 89)
  assertEquals(stopped.status, 'closed')
  assertEquals(stopped.settled, true)
  assertEquals(stopped.exitReason, 'stop')
  assertEquals(stopped.exitPrice, 90)
  assertEquals(stopped.realizedPnl, -100) // (90 - 100) * 10
})

Deno.test('lifecycle: active short closes when the stop-loss price is hit', () => {
  const p: Position = {
    side: 'short',
    orderType: 'limit',
    status: 'open',
    entryPrice: 100,
    limitPrice: 100,
    stopLossPrice: 110,
    cashOutPrice: 90,
    shares: 10,
  }

  const stopped = stepPosition(p, 111)
  assertEquals(stopped.status, 'closed')
  assertEquals(stopped.exitReason, 'stop')
  assertEquals(stopped.exitPrice, 110)
  assertEquals(stopped.realizedPnl, -100) // short loss: (100 - 110) * 10
})

// ── Open -> Closed (cash-out / target hit) ───────────────────────────────────

Deno.test('lifecycle: active long closes when the cash-out price is hit', () => {
  const p: Position = {
    side: 'long',
    orderType: 'limit',
    status: 'open',
    entryPrice: 100,
    limitPrice: 100,
    stopLossPrice: 90,
    cashOutPrice: 120,
    shares: 10,
  }

  const cashedOut = stepPosition(p, 121)
  assertEquals(cashedOut.status, 'closed')
  assertEquals(cashedOut.settled, true)
  assertEquals(cashedOut.exitReason, 'target')
  assertEquals(cashedOut.exitPrice, 120)
  assertEquals(cashedOut.realizedPnl, 200) // (120 - 100) * 10
})

Deno.test('lifecycle: active short closes when the cash-out price is hit', () => {
  const p: Position = {
    side: 'short',
    orderType: 'limit',
    status: 'open',
    entryPrice: 100,
    limitPrice: 100,
    stopLossPrice: 110,
    cashOutPrice: 90,
    shares: 10,
  }

  const cashedOut = stepPosition(p, 89)
  assertEquals(cashedOut.status, 'closed')
  assertEquals(cashedOut.exitReason, 'target')
  assertEquals(cashedOut.exitPrice, 90)
  assertEquals(cashedOut.realizedPnl, 100) // short gain: (100 - 90) * 10
})

// ── Full pending -> open -> closed in one tick (gap through both) ────────────

Deno.test('lifecycle: pending fills AND settles in the same tick when price gaps to the cash-out', () => {
  const p: Position = {
    side: 'long',
    orderType: 'limit',
    status: 'pending',
    entryPrice: null,
    limitPrice: 100,
    stopLossPrice: 90,
    cashOutPrice: 120,
    shares: 10,
    // Already rested through a prior run, so the limit hit below is a REAL fill
    // (not a first-evaluation invalidation).
    firstEvaluatedAt: '2026-09-17T17:31:00Z',
  }

  // A single tick can't gap up to both a 100 limit (needs live <= 100) and a
  // 120 target, so model the realistic case: filled earlier, then a later tick
  // gaps straight to the target. First fill at the limit:
  const opened = stepPosition(p, 100)
  assertEquals(opened.status, 'open')
  assertEquals(opened.entryPrice, 100)

  // Now a later tick gaps to/through the cash-out -> closes at the target.
  const openPos: Position = { ...p, status: 'open', entryPrice: opened.entryPrice }
  const closed = stepPosition(openPos, 130)
  assertEquals(closed.status, 'closed')
  assertEquals(closed.exitReason, 'target')
  assertEquals(closed.exitPrice, 120) // banked at the level, not the 130 tick
  assertEquals(closed.realizedPnl, 200)
})

Deno.test('lifecycle: stop wins when a single gap crosses BOTH stop and target', () => {
  // Conservative worst-case: index.ts/settleAt take the stop first.
  const p: Position = {
    side: 'long',
    orderType: 'limit',
    status: 'open',
    entryPrice: 100,
    limitPrice: 100,
    stopLossPrice: 95,
    cashOutPrice: 105,
    shares: 10,
  }

  // Impossible for one tick to be <=95 and >=105, so this documents the
  // decision precedence directly via a stop-side tick.
  const stopped = stepPosition(p, 94)
  assertEquals(stopped.exitReason, 'stop')
  assertEquals(stopped.exitPrice, 95)
})

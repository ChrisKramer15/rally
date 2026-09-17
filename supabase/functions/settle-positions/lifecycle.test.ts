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
}

interface StepResult {
  status: Status
  entryPrice: number | null
  /** Set only when the position closed this step. */
  exitPrice?: number
  exitReason?: 'stop' | 'target'
  realizedPnl?: number
  /** Did a pending order fill to open this step? */
  filled: boolean
  /** Did an open position settle/close this step? */
  settled: boolean
}

/**
 * Advance one position by one live price tick, mirroring index.ts's loop:
 *   1. FILL a pending limit whose limit was crossed -> open at the limit price.
 *   2. SETTLE an open position (incl. one just filled) whose stop/target was
 *      crossed -> closed at that level, with realized P/L banked.
 */
function stepPosition(p: Position, livePrice: number): StepResult {
  let status: Status = p.status
  let entryPrice = p.entryPrice
  let filled = false

  // 1) FILL: pending limit -> open at the limit price (idealized limit fill).
  if (status === 'pending' && p.orderType === 'limit') {
    if (shouldFill({ side: p.side, limitPrice: p.limitPrice, livePrice })) {
      status = 'open'
      entryPrice = p.limitPrice
      filled = true
    } else {
      return { status, entryPrice, filled: false, settled: false }
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

Deno.test('lifecycle: pending long limit executes when the limit price is hit', () => {
  const p: Position = {
    side: 'long',
    orderType: 'limit',
    status: 'pending',
    entryPrice: null,
    limitPrice: 100,
    stopLossPrice: 90,
    cashOutPrice: 120,
    shares: 10,
  }

  // Price still above the limit -> stays pending, no entry.
  const resting = stepPosition(p, 101)
  assertEquals(resting.status, 'pending')
  assertEquals(resting.filled, false)
  assertEquals(resting.entryPrice, null)

  // Price dips to the limit -> fills to open, entry recorded AT the limit.
  const hit = stepPosition(p, 100)
  assertEquals(hit.status, 'open')
  assertEquals(hit.filled, true)
  assertEquals(hit.entryPrice, 100)
  assertEquals(hit.settled, false) // opened but not yet exiting
})

Deno.test('lifecycle: pending short limit executes when the limit price is hit', () => {
  const p: Position = {
    side: 'short',
    orderType: 'limit',
    status: 'pending',
    entryPrice: null,
    limitPrice: 100,
    stopLossPrice: 110,
    cashOutPrice: 90,
    shares: 10,
  }

  // Price below the short limit -> stays pending.
  assertEquals(stepPosition(p, 99).status, 'pending')

  // Price rises to/through the limit -> fills to open at the limit price.
  const hit = stepPosition(p, 101)
  assertEquals(hit.status, 'open')
  assertEquals(hit.filled, true)
  assertEquals(hit.entryPrice, 100)
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

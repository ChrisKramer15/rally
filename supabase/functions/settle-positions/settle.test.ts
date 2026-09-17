// Unit tests for the pure fill/settle decision logic.
// Run with: deno test supabase/functions/settle-positions/settle.test.ts

import { assertEquals } from 'jsr:@std/assert'
import { realizedPnl, settleAt, shouldFill } from './settle.ts'

Deno.test('shouldFill: long fills when live dips to/below limit', () => {
  assertEquals(shouldFill({ side: 'long', limitPrice: 100, livePrice: 100 }), true)
  assertEquals(shouldFill({ side: 'long', limitPrice: 100, livePrice: 99.5 }), true) // gap through
  assertEquals(shouldFill({ side: 'long', limitPrice: 100, livePrice: 100.5 }), false)
})

Deno.test('shouldFill: short fills when live rises to/above limit', () => {
  assertEquals(shouldFill({ side: 'short', limitPrice: 100, livePrice: 100 }), true)
  assertEquals(shouldFill({ side: 'short', limitPrice: 100, livePrice: 101 }), true)
  assertEquals(shouldFill({ side: 'short', limitPrice: 100, livePrice: 99 }), false)
})

Deno.test('shouldFill: guards invalid prices', () => {
  assertEquals(shouldFill({ side: 'long', limitPrice: 0, livePrice: 100 }), false)
  assertEquals(shouldFill({ side: 'long', limitPrice: 100, livePrice: 0 }), false)
})

Deno.test('settleAt: long stop then target; stop wins on double-cross', () => {
  // target hit
  assertEquals(settleAt({ side: 'long', stopLossPrice: 90, cashOutPrice: 110, livePrice: 111 }), {
    exitPrice: 110,
    reason: 'target',
  })
  // stop hit
  assertEquals(settleAt({ side: 'long', stopLossPrice: 90, cashOutPrice: 110, livePrice: 89 }), {
    exitPrice: 90,
    reason: 'stop',
  })
  // between → no exit
  assertEquals(settleAt({ side: 'long', stopLossPrice: 90, cashOutPrice: 110, livePrice: 100 }), null)
})

Deno.test('settleAt: short inverts', () => {
  // short target is BELOW entry → live <= target
  assertEquals(settleAt({ side: 'short', stopLossPrice: 110, cashOutPrice: 90, livePrice: 89 }), {
    exitPrice: 90,
    reason: 'target',
  })
  // short stop is ABOVE entry → live >= stop
  assertEquals(settleAt({ side: 'short', stopLossPrice: 110, cashOutPrice: 90, livePrice: 111 }), {
    exitPrice: 110,
    reason: 'stop',
  })
})

Deno.test('realizedPnl: side-adjusted', () => {
  assertEquals(realizedPnl('long', 100, 110, 10), 100)
  assertEquals(realizedPnl('short', 100, 90, 10), 100)
  assertEquals(realizedPnl('long', 100, 90, 10), -100)
})

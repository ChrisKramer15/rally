// Unit tests for the retry-with-backoff helper.
//
// Run with:  deno test supabase/functions/collect-daily-bars/retry.test.ts
//
// The critical guarantees under test are the RATE-LIMIT-SAFETY ones:
//   * a 429 is NOT retried (fails after exactly 1 attempt)
//   * other 4xx are NOT retried
//   * 5xx / network errors ARE retried, up to the attempt budget
// so retries can never inflate Tiingo request volume during a rate limit.

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  isRetryable,
  isRetryableHttpStatus,
  nonRetryableError,
  retryableError,
  withRetry,
} from './retry.ts'

// A sleep that doesn't actually wait, so tests run instantly.
const noSleep = (_ms: number) => Promise.resolve()

// --- HTTP status classification --------------------------------------------

Deno.test('isRetryableHttpStatus: 429 is NOT retryable', () => {
  assertEquals(isRetryableHttpStatus(429), false)
})

Deno.test('isRetryableHttpStatus: 4xx are NOT retryable', () => {
  for (const s of [400, 401, 403, 404, 422]) {
    assertEquals(isRetryableHttpStatus(s), false, `status ${s}`)
  }
})

Deno.test('isRetryableHttpStatus: 5xx ARE retryable (incl. 504)', () => {
  for (const s of [500, 502, 503, 504]) {
    assertEquals(isRetryableHttpStatus(s), true, `status ${s}`)
  }
})

// --- error classification ---------------------------------------------------

Deno.test('isRetryable: honours ClassifiedError flag', () => {
  assertEquals(isRetryable(retryableError('x')), true)
  assertEquals(isRetryable(nonRetryableError('x')), false)
})

Deno.test('isRetryable: unknown/network errors default to retryable', () => {
  assert(isRetryable(new Error('connection reset')))
  assert(isRetryable(new TypeError('error sending request')))
})

// --- withRetry behaviour ----------------------------------------------------

Deno.test('withRetry: returns immediately on success (1 call)', async () => {
  let calls = 0
  const result = await withRetry(() => {
    calls++
    return Promise.resolve('ok')
  }, { sleep: noSleep })
  assertEquals(result, 'ok')
  assertEquals(calls, 1)
})

Deno.test('withRetry: retries transient error then succeeds', async () => {
  let calls = 0
  const result = await withRetry(() => {
    calls++
    if (calls < 3) return Promise.reject(retryableError('504 Gateway Timeout'))
    return Promise.resolve('recovered')
  }, { sleep: noSleep })
  assertEquals(result, 'recovered')
  assertEquals(calls, 3) // failed twice, succeeded on the 3rd
})

Deno.test('withRetry: does NOT retry a 429 — fails after exactly 1 attempt', async () => {
  let calls = 0
  await assertRejects(
    () =>
      withRetry(() => {
        calls++
        return Promise.reject(nonRetryableError('Tiingo AAPL failed: 429 Too Many Requests'))
      }, { sleep: noSleep }),
    Error,
    '429',
  )
  // The whole point: a rate-limit response must not be retried.
  assertEquals(calls, 1)
})

Deno.test('withRetry: does NOT retry a non-retryable 4xx', async () => {
  let calls = 0
  await assertRejects(
    () =>
      withRetry(() => {
        calls++
        return Promise.reject(nonRetryableError('400 Bad Request'))
      }, { sleep: noSleep }),
  )
  assertEquals(calls, 1)
})

Deno.test('withRetry: stops at maxAttempts for persistent transient errors', async () => {
  let calls = 0
  await assertRejects(
    () =>
      withRetry(() => {
        calls++
        return Promise.reject(retryableError('504 Gateway Timeout'))
      }, { sleep: noSleep, maxAttempts: 3 }),
    Error,
    '504',
  )
  // 1 initial + 2 retries = 3 total. NEVER more — this bounds request volume.
  assertEquals(calls, 3)
})

Deno.test('withRetry: uses exponential backoff delays', async () => {
  const delays: number[] = []
  let calls = 0
  await assertRejects(() =>
    withRetry(() => {
      calls++
      return Promise.reject(retryableError('504'))
    }, {
      maxAttempts: 3,
      baseDelayMs: 500,
      sleep: (ms) => {
        delays.push(ms)
        return Promise.resolve()
      },
    })
  )
  // Backoff before retry 1 and retry 2: 500, 1000. (No wait after final attempt.)
  assertEquals(delays, [500, 1000])
})

Deno.test('withRetry: onRetry hook fires once per retry (not on final failure)', async () => {
  let retryEvents = 0
  await assertRejects(() =>
    withRetry(() => Promise.reject(retryableError('504')), {
      maxAttempts: 3,
      sleep: noSleep,
      onRetry: () => {
        retryEvents++
      },
    })
  )
  assertEquals(retryEvents, 2) // fires before each of the 2 backoff waits
})

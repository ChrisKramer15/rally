// Retry-with-backoff for the collect-daily-bars Edge Function.
//
// WHY: observed run failures were all transient "Gateway Timeout" (504) errors —
// some from Supabase PostgREST (resolve-stage table reads), some from Tiingo
// (a single symbol). None had a second chance, so one blip failed/degraded a
// whole run. This adds a narrow, rate-limit-safe retry.
//
// RATE-LIMIT SAFETY (Tiingo free tier = ~50 req/hour):
//   * Retries ONLY fire for TRANSIENT errors (network error, timeout, HTTP 5xx).
//   * A 429 (rate limited) or any 4xx is treated as NON-retryable and fails
//     immediately — retrying those would waste budget and extend a lockout.
//   * Retries therefore add requests only in proportion to the (rare) transient
//     failure rate. A normal night with 0-1 blips adds 0-1 extra requests, far
//     under the cap. The 3x worst case only occurs during a total outage, which
//     is a availability problem, not a rate problem.

/** Default attempt budget (1 initial try + up to 2 retries). */
export const DEFAULT_MAX_ATTEMPTS = 3

/** Base backoff in ms; delay for retry N (1-indexed) is BASE * 2^(N-1). */
export const DEFAULT_BASE_DELAY_MS = 500

/**
 * A retryable error carries an explicit `retryable` flag so withRetry doesn't
 * have to guess. Throw this (via retryableError / nonRetryableError) from any
 * operation you want to control precisely.
 */
export class ClassifiedError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'ClassifiedError'
    this.retryable = retryable
  }
}

export function retryableError(message: string): ClassifiedError {
  return new ClassifiedError(message, true)
}

export function nonRetryableError(message: string): ClassifiedError {
  return new ClassifiedError(message, false)
}

/**
 * Classify an HTTP status for retry purposes.
 *   - 429 (rate limited): NOT retryable (retrying burns quota / extends lockout).
 *   - other 4xx: NOT retryable (client error — a bad ticker won't fix itself).
 *   - 5xx (incl. 504 Gateway Timeout): retryable (transient upstream).
 *   - anything else: NOT retryable.
 */
export function isRetryableHttpStatus(status: number): boolean {
  if (status === 429) return false
  if (status >= 500 && status <= 599) return true
  return false
}

/**
 * Decide whether a thrown error is worth retrying.
 *   - ClassifiedError: honour its explicit flag.
 *   - Otherwise (network error, fetch abort, DNS, connection reset, etc.):
 *     treat as transient/retryable. These are exactly the "couldn't reach the
 *     upstream" failures we want to absorb; they never reached a rate counter.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof ClassifiedError) return err.retryable
  return true
}

/** Sleep helper (overridable in tests via the sleep option). */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  /** Injectable sleep so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>
  /** Optional hook for observability (called before each backoff wait). */
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void
}

/**
 * Run `op`, retrying transient failures with exponential backoff.
 *
 * Stops early (rethrows) as soon as a NON-retryable error is seen, so a 429 or
 * a 4xx fails immediately without consuming the remaining attempts. On the
 * final attempt the last error is rethrown regardless.
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const sleep = options.sleep ?? defaultSleep

  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await op()
    } catch (err) {
      lastErr = err
      const canRetry = attempt < maxAttempts && isRetryable(err)
      if (!canRetry) throw err
      const delayMs = baseDelayMs * 2 ** (attempt - 1)
      options.onRetry?.(attempt, err, delayMs)
      await sleep(delayMs)
    }
  }
  // Unreachable in practice (loop either returns or throws), but satisfies TS.
  throw lastErr
}

// Retry-with-backoff for the settle-positions Edge Function.
//
// Same narrow, rate-limit-safe policy as the collect-daily-bars collector:
// retry ONLY transient failures (network error / 5xx incl. 504). A 429 or any
// other 4xx is non-retryable and fails fast, so we never burn Finnhub quota
// chasing a rate limit or a bad ticker.

export const DEFAULT_MAX_ATTEMPTS = 3
export const DEFAULT_BASE_DELAY_MS = 400

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

/** 429 & other 4xx → non-retryable; 5xx → retryable; else non-retryable. */
export function isRetryableHttpStatus(status: number): boolean {
  if (status === 429) return false
  if (status >= 500 && status <= 599) return true
  return false
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof ClassifiedError) return err.retryable
  return true
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  onRetry?: (attempt: number, err: unknown, delayMs: number) => void
}

export async function withRetry<T>(op: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
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
  throw lastErr
}

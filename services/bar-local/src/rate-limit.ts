import { BarLocalError } from '@tsa-bonno/bar-contracts'

export interface RateLimiterOptions {
  windowMs: number
  max: number
  now?: () => number
}

export interface RateLimiter {
  check(key: string): void
  reset(): void
}

interface Bucket {
  count: number
  resetAt: number
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { windowMs, max, now = Date.now } = options
  if (!Number.isInteger(windowMs) || windowMs < 1000) throw new Error('Rate-limit window is too small.')
  if (!Number.isInteger(max) || max < 1) throw new Error('Rate-limit maximum must be positive.')
  const buckets = new Map<string, Bucket>()

  function check(key: string): void {
    const timestamp = now()
    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= timestamp) {
      bucket = { count: 0, resetAt: timestamp + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000))
      throw new BarLocalError('RATE_LIMITED', 'Too many attempts. Wait before trying again.', {
        httpStatus: 429,
        details: { retry_after_seconds: retryAfter }
      })
    }
    if (buckets.size > 1000) {
      for (const [candidate, value] of buckets) {
        if (value.resetAt <= timestamp) buckets.delete(candidate)
      }
    }
  }

  return { check, reset: () => buckets.clear() }
}

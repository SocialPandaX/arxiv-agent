/**
 * 延迟指定毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface RetryAttempt {
  attempt: number
  status?: number
  message: string
  retryAfterMs?: number
}

export interface RetryEvent extends RetryAttempt {
  delayMs: number
}

export interface RetryOptions {
  maxRetries?: number
  baseDelay?: number
  maxDelay?: number
  minDelay?: number
  retryOnStatus?: number[]
  retryOnError?: (error: unknown) => boolean
  label?: string
  deadlineAt?: number
  beforeAttempt?: (attempt: number) => void | Promise<void>
  onRetry?: (event: RetryEvent) => void
  now?: () => number
  random?: () => number
  sleepFn?: (ms: number) => Promise<void>
}

export interface RetryError extends Error {
  status?: number
  statusCode?: number
  response?: { status?: number }
  retryAfterMs?: number
  retryAttempts?: RetryAttempt[]
  retrySkippedReason?: string
}

function toRetryError(error: unknown): RetryError {
  if (error instanceof Error) return error as RetryError
  const wrapped = new Error(String(error)) as RetryError
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    if (typeof value.status === 'number') wrapped.status = value.status
    if (typeof value.statusCode === 'number') wrapped.statusCode = value.statusCode
    if (typeof value.retryAfterMs === 'number') wrapped.retryAfterMs = value.retryAfterMs
  }
  return wrapped
}

/**
 * 把重试历史附加到最终错误上，便于调用方记录首个和最终状态。
 */
function attachRetryContext(
  error: RetryError,
  attempts: RetryAttempt[],
  retrySkippedReason?: string
): never {
  error.retryAttempts = attempts
  if (retrySkippedReason) error.retrySkippedReason = retrySkippedReason
  throw error
}

/**
 * 带指数退避的重试包装器。
 * Retry-After 是服务端要求的最短等待时间，不受本地 maxDelay 截断；
 * 若完整等待会超过 deadlineAt，则本次调用直接失败，不提前重试。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 2000,
    maxDelay = 30000,
    minDelay = 0,
    retryOnStatus = [429, 500, 502, 503],
    retryOnError,
    label = 'API call',
    deadlineAt,
    beforeAttempt,
    onRetry,
    now = Date.now,
    random = Math.random,
    sleepFn = sleep,
  } = options

  const attempts: RetryAttempt[] = []
  let lastError: RetryError | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await beforeAttempt?.(attempt + 1)
      return await fn()
    } catch (caught: unknown) {
      const error = toRetryError(caught)
      lastError = error

      const status = error.status || error.statusCode || error.response?.status
      const detail: RetryAttempt = {
        attempt: attempt + 1,
        status,
        message: error?.message || String(error),
        retryAfterMs:
          typeof error?.retryAfterMs === 'number' ? error.retryAfterMs : undefined,
      }
      attempts.push(detail)

      const isRetryable = status
        ? retryOnStatus.includes(status)
        : retryOnError?.(error) === true

      if (!isRetryable || attempt === maxRetries) {
        attachRetryContext(error, attempts)
      }

      let delay: number
      if (typeof error?.retryAfterMs === 'number' && error.retryAfterMs >= 0) {
        delay = Math.max(error.retryAfterMs, minDelay)
      } else {
        const exponentialDelay = baseDelay * Math.pow(2, attempt)
        const jitter = random() * 1000
        delay = Math.max(minDelay, Math.min(exponentialDelay + jitter, maxDelay))
      }

      if (deadlineAt !== undefined && now() + delay >= deadlineAt) {
        attachRetryContext(
          error,
          attempts,
          `retry delay ${Math.round(delay)}ms exceeds remaining request budget`
        )
      }

      const event: RetryEvent = { ...detail, delayMs: delay }
      onRetry?.(event)

      console.warn(
        `[${label}] 第 ${attempt + 1} 次失败 (status=${status ?? 'network'})，${Math.round(delay)}ms 后重试...`
      )

      await sleepFn(delay)
    }
  }

  attachRetryContext(lastError || new Error('Retry exhausted'), attempts)
}

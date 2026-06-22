/**
 * 延迟指定毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 带指数退避的重试包装器
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number
    baseDelay?: number
    maxDelay?: number
    retryOnStatus?: number[]
    label?: string
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 2000,
    maxDelay = 30000,
    retryOnStatus = [429, 500, 502, 503],
    label = 'API call',
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error

      const status = error?.status || error?.statusCode || error?.response?.status
      const isRetryable = status ? retryOnStatus.includes(status) : false

      if (!isRetryable || attempt === maxRetries) {
        throw error
      }

      const exponentialDelay = baseDelay * Math.pow(2, attempt)
      const jitter = Math.random() * 1000
      const delay = Math.min(exponentialDelay + jitter, maxDelay)

      console.warn(
        `[${label}] 第 ${attempt + 1} 次失败 (status=${status})，${Math.round(delay)}ms 后重试...`
      )

      await sleep(delay)
    }
  }

  throw lastError || new Error('Retry exhausted')
}

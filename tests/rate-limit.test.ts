import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  withRetry,
  type RetryAttempt,
  type RetryError,
  type RetryEvent,
} from '../lib/rate-limit'

function httpError(status: number, retryAfterMs?: number): RetryError {
  const error = new Error(`HTTP ${status}`) as RetryError
  error.status = status
  error.retryAfterMs = retryAfterMs
  return error
}

test('treats Retry-After as a lower bound instead of clipping it', async () => {
  const sleeps: number[] = []
  let calls = 0
  const result = await withRetry(
    async () => {
      calls++
      if (calls === 1) throw httpError(429, 120000)
      return 'ok'
    },
    {
      maxRetries: 1,
      maxDelay: 60000,
      minDelay: 3000,
      sleepFn: async (ms) => { sleeps.push(ms) },
    }
  )

  assert.equal(result, 'ok')
  assert.deepEqual(sleeps, [120000])
  assert.equal(calls, 2)
})

test('enforces a minimum delay for a short Retry-After', async () => {
  const events: RetryEvent[] = []
  let calls = 0
  await withRetry(
    async () => {
      calls++
      if (calls === 1) throw httpError(503, 1000)
      return undefined
    },
    {
      maxRetries: 1,
      minDelay: 3000,
      onRetry: (event) => events.push(event),
      sleepFn: async () => {},
    }
  )

  assert.equal(events[0].delayMs, 3000)
})

test('does not retry early when the required delay exceeds the deadline', async () => {
  let calls = 0
  let slept = false
  const error = await withRetry(
    async () => {
      calls++
      throw httpError(429, 120000)
    },
    {
      maxRetries: 3,
      deadlineAt: 60000,
      now: () => 0,
      sleepFn: async () => { slept = true },
    }
  ).catch((caught) => caught as RetryError)

  assert.equal(calls, 1)
  assert.equal(slept, false)
  assert.match(error.retrySkippedReason || '', /exceeds remaining request budget/)
  assert.equal(error.retryAttempts?.length, 1)
})

test('preserves first and final statuses across retries', async () => {
  const statuses = [503, 429]
  const error = await withRetry(
    async () => {
      throw httpError(statuses.shift() || 429)
    },
    {
      maxRetries: 1,
      baseDelay: 1,
      maxDelay: 1,
      random: () => 0,
      sleepFn: async () => {},
    }
  ).catch((caught) => caught as RetryError)

  assert.deepEqual(
    error.retryAttempts?.map((attempt: RetryAttempt) => attempt.status),
    [503, 429]
  )
})

test('does not retry a non-retryable status', async () => {
  let calls = 0
  const error = await withRetry(
    async () => {
      calls++
      throw httpError(400)
    },
    { sleepFn: async () => {} }
  ).catch((caught) => caught as RetryError)

  assert.equal(calls, 1)
  assert.equal(error.retryAttempts?.length, 1)
})

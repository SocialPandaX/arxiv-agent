import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import {
  fetchArxivPapers,
  fetchArxivFeed,
  type ArxivFetchOptions,
  type ArxivFeedSnapshot,
  type ArxivPaper,
} from '@/lib/arxiv'
import {
  buildArxivFetchPlan,
  canUseRssWithoutReconciliation,
  arxivCheckpointKey,
  parseArxivCheckpoint,
  serializeArxivCheckpoint,
  isFeedFresh,
  selectPapers,
  type ArxivTaskPlan,
} from '@/lib/arxiv-plan'
import { summarizeAbstract, generateDailySummary } from '@/lib/llm'
import { sendDailyEmail } from '@/lib/email'
import {
  sleep,
  type RetryError,
  type RetryEvent,
} from '@/lib/rate-limit'
import type { Paper } from '@/types'

export const maxDuration = 300 // 5 分钟

const LOCK_KEY = 'daily_check_lock'
const LOCK_STALE_MS = 10 * 60 * 1000 // 锁超过 10 分钟视为残留（上次异常退出）
const ARXIV_ACQUISITION_MS = 180 * 1000
const ARXIV_MIN_INTERVAL_MS = 3000
const RSS_GRACE_AGE_MS = 60 * 60 * 60 * 1000

interface TaskResult {
  taskId: string
  taskName: string
  created: number
  emailed: boolean
  fetchStatus: 'success' | 'failure'
  fetchSource?: 'rss' | 'search' | 'rss+search'
  fetchCompletedAt?: string
  error?: string
}

interface RequestDiagnostic {
  key: string
  kind: 'feed' | 'search'
  attempts: number
  retries: number
  retryWaitMs: number
  firstStatus?: number
  finalStatus?: number
  retryAfter?: string
  retryAfterMs?: number
  retrySkippedReason?: string
  error?: string
}

interface AppError extends RetryError {
  code?: string
  retryAfter?: string
}

type FetchOutcome<T> =
  | { ok: true; value: T; diagnostic: RequestDiagnostic }
  | { ok: false; error: AppError; diagnostic: RequestDiagnostic }

interface TaskFetchSuccess {
  ok: true
  papers: ArxivPaper[]
  source: 'rss' | 'search' | 'rss+search'
}

interface TaskFetchFailure {
  ok: false
  error: AppError
}

type TaskFetchOutcome = TaskFetchSuccess | TaskFetchFailure

async function getConfig(key: string, defaultValue: string): Promise<string> {
  const config = await prisma.config.findUnique({ where: { key } })
  return config?.value || defaultValue
}

/**
 * 尝试获取运行锁，防止两次 cron（定时 + 手动测试）并发跑导致唯一约束冲突
 */
async function acquireLock(): Promise<boolean> {
  const existing = await prisma.config.findUnique({ where: { key: LOCK_KEY } })
  if (existing && Date.now() - existing.updatedAt.getTime() < LOCK_STALE_MS) {
    return false
  }
  try {
    if (existing) {
      // 残留锁已过期，直接接管
      await prisma.config.update({
        where: { key: LOCK_KEY },
        data: { value: new Date().toISOString() },
      })
    } else {
      // create 依赖唯一约束保证原子性：并发请求只有一个能成功
      await prisma.config.create({
        data: { key: LOCK_KEY, value: new Date().toISOString() },
      })
    }
    return true
  } catch {
    return false
  }
}

async function releaseLock(): Promise<void> {
  await prisma.config.deleteMany({ where: { key: LOCK_KEY } }).catch(() => {})
}

function asAppError(error: unknown): AppError {
  return error instanceof Error
    ? error as AppError
    : new Error(String(error)) as AppError
}

function errorStatus(error: unknown): number | undefined {
  const value = asAppError(error)
  return value.status || value.statusCode || value.response?.status
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('CRON_SECRET is not configured')
    return NextResponse.json(
      { error: 'Cron authentication is not configured' },
      { status: 503 }
    )
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!(await acquireLock())) {
    return NextResponse.json(
      { success: false, skipped: true, message: 'Another daily-check run is in progress' },
      { status: 409 }
    )
  }

  const startedAt = Date.now()
  const arxivDeadlineAt = startedAt + ARXIV_ACQUISITION_MS
  const runNow = new Date(startedAt)
  const windowFrom = new Date(startedAt - 48 * 60 * 60 * 1000)

  try {
    const summaryModel = await getConfig('summary_model', 'gpt-4o-mini')

    const tasks = await prisma.task.findMany({
      where: { enabled: true },
    })

    if (tasks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No enabled tasks',
        fetched: 0,
        created: 0,
      })
    }

    const plan = buildArxivFetchPlan(tasks)
    const planByTaskId = new Map(plan.tasks.map((taskPlan) => [taskPlan.taskId, taskPlan]))

    const checkpointConfigs = await prisma.config.findMany({
      where: { key: { in: tasks.map((task) => arxivCheckpointKey(task.id)) } },
    })
    const checkpoints = new Map(
      checkpointConfigs.flatMap((config) => {
        const checkpoint = parseArxivCheckpoint(config.value)
        if (!checkpoint) return []
        const taskId = config.key.slice(config.key.indexOf(':') + 1)
        return [[taskId, checkpoint] as const]
      })
    )

    let totalFetched = 0
    let totalCreated = 0
    let failedTasks = 0
    let failedSummaries = 0
    let actualArxivAttempts = 0
    let cacheHits = 0
    let totalRetryWaitMs = 0
    let logicalFeedRequests = 0
    let logicalSearchRequests = 0
    let lastAttemptStartedAt = 0
    let circuitError: AppError | null = null
    const taskResults: TaskResult[] = []
    const requestDiagnostics: RequestDiagnostic[] = []
    const requestCache = new Map<string, Promise<FetchOutcome<unknown>>>()

    const beforeArxivAttempt = async () => {
      if (circuitError) throw circuitError

      const waitMs = Math.max(
        0,
        ARXIV_MIN_INTERVAL_MS - (Date.now() - lastAttemptStartedAt)
      )
      if (Date.now() + waitMs >= arxivDeadlineAt) {
        const error = new Error('arXiv acquisition budget exhausted') as AppError
        error.code = 'ARXIV_BUDGET_EXHAUSTED'
        throw error
      }
      if (waitMs > 0) await sleep(waitMs)
      if (Date.now() >= arxivDeadlineAt) {
        const error = new Error('arXiv acquisition budget exhausted') as AppError
        error.code = 'ARXIV_BUDGET_EXHAUSTED'
        throw error
      }

      lastAttemptStartedAt = Date.now()
      actualArxivAttempts++
    }

    const runArxivRequest = async <T,>(
      key: string,
      kind: 'feed' | 'search',
      fetcher: (options: ArxivFetchOptions) => Promise<T>
    ): Promise<FetchOutcome<T>> => {
      const cached = requestCache.get(key)
      if (cached) {
        cacheHits++
        return cached as Promise<FetchOutcome<T>>
      }

      if (kind === 'feed') logicalFeedRequests++
      else logicalSearchRequests++

      const diagnostic: RequestDiagnostic = {
        key,
        kind,
        attempts: 0,
        retries: 0,
        retryWaitMs: 0,
      }
      requestDiagnostics.push(diagnostic)

      const promise = (async (): Promise<FetchOutcome<T>> => {
        if (circuitError) {
          diagnostic.error = circuitError.message
          diagnostic.finalStatus = errorStatus(circuitError)
          return { ok: false, error: circuitError, diagnostic }
        }

        const attemptsBefore = actualArxivAttempts
        const onRetry = (event: RetryEvent) => {
          diagnostic.retries++
          diagnostic.retryWaitMs += event.delayMs
          totalRetryWaitMs += event.delayMs
          diagnostic.firstStatus ??= event.status
          diagnostic.retryAfterMs ??= event.retryAfterMs
        }

        try {
          const value = await fetcher({
            deadlineAt: arxivDeadlineAt,
            beforeAttempt: beforeArxivAttempt,
            onRetry,
          })
          diagnostic.attempts = actualArxivAttempts - attemptsBefore
          diagnostic.finalStatus = 200
          return { ok: true, value, diagnostic }
        } catch (caught: unknown) {
          const error = asAppError(caught)
          diagnostic.attempts = actualArxivAttempts - attemptsBefore
          const attempts = Array.isArray(error.retryAttempts)
            ? error.retryAttempts
            : []
          diagnostic.firstStatus ??= attempts[0]?.status || errorStatus(error)
          diagnostic.finalStatus =
            attempts[attempts.length - 1]?.status || errorStatus(error)
          diagnostic.retryAfter = error?.retryAfter
          diagnostic.retryAfterMs ??= error?.retryAfterMs
          diagnostic.retrySkippedReason = error?.retrySkippedReason
          diagnostic.error = error?.message || String(error)

          if (diagnostic.finalStatus === 429) circuitError = error
          return { ok: false, error, diagnostic }
        }
      })()

      requestCache.set(key, promise as Promise<FetchOutcome<unknown>>)
      return promise
    }

    // ===== 抓取阶段：严格分类 OR 查询走 RSS；其他查询只按相同表达式去重 =====
    const feedOutcomes = new Map<string, FetchOutcome<ArxivFeedSnapshot>>()
    for (const category of plan.categories) {
      const outcome = await runArxivRequest(
        `feed:${category.toLowerCase()}`,
        'feed',
        (options) => fetchArxivFeed(category, options)
      )
      feedOutcomes.set(category.toLowerCase(), outcome)
    }

    const searchOutcomes = new Map<string, FetchOutcome<ArxivPaper[]>>()
    for (const group of plan.searchGroups) {
      const outcome = await runArxivRequest(
        group.key,
        'search',
        (options) =>
          fetchArxivPapers(
            group.query,
            group.maxResults,
            windowFrom,
            runNow,
            options
          )
      )
      searchOutcomes.set(group.key, outcome)
    }

    const categoryMaxResults = new Map<string, number>()
    for (const taskPlan of plan.tasks) {
      if (taskPlan.kind !== 'category') continue
      categoryMaxResults.set(
        taskPlan.key,
        Math.max(categoryMaxResults.get(taskPlan.key) || 0, taskPlan.maxResults)
      )
    }

    const taskFetchOutcomes = new Map<string, TaskFetchOutcome>()
    for (const taskPlan of plan.tasks) {
      if (taskPlan.kind === 'search') {
        const outcome = searchOutcomes.get(taskPlan.key)
        if (!outcome || !outcome.ok) {
          taskFetchOutcomes.set(taskPlan.taskId, {
            ok: false,
            error: outcome && !outcome.ok
              ? outcome.error
              : new Error('Missing arXiv search result'),
          })
          continue
        }
        taskFetchOutcomes.set(taskPlan.taskId, {
          ok: true,
          papers: selectPapers(
            [outcome.value],
            taskPlan.maxResults,
            windowFrom,
            runNow
          ),
          source: 'search',
        })
        continue
      }

      const feedSources: ArxivPaper[][] = []
      let feedsComplete = true
      let feedsCurrent = true
      let feedsWithinGrace = true
      for (const category of taskPlan.categories) {
        const outcome = feedOutcomes.get(category.toLowerCase())
        if (!outcome || !outcome.ok) {
          feedsComplete = false
          feedsCurrent = false
          feedsWithinGrace = false
          continue
        }
        feedSources.push(outcome.value.papers)
        if (!isFeedFresh(outcome.value, runNow)) feedsCurrent = false
        if (!isFeedFresh(outcome.value, runNow, RSS_GRACE_AGE_MS)) {
          feedsWithinGrace = false
        }
      }

      const checkpoint = checkpoints.get(taskPlan.taskId)
      const matchingCheckpoint = checkpoint?.queryKey === taskPlan.key
        ? checkpoint.completedAt
        : undefined
      const useRssOnly = canUseRssWithoutReconciliation(
        feedsComplete,
        feedsCurrent,
        feedsWithinGrace,
        matchingCheckpoint,
        runNow
      )

      // 新任务可以直接使用当前 RSS；已有任务若超过 36 小时未成功则强制补齐。
      // 周末/节假日 feed 不更新时，只要上次任务刚成功过，就不浪费 Search API 配额。
      if (useRssOnly) {
        taskFetchOutcomes.set(taskPlan.taskId, {
          ok: true,
          papers: selectPapers(
            feedSources,
            taskPlan.maxResults,
            windowFrom,
            runNow
          ),
          source: 'rss',
        })
        continue
      }

      // 漏跑、RSS 请求失败或过期时，用正确格式的 Search API 补齐 48 小时窗口。
      const searchKey = `search:${taskPlan.query}`
      const reconciliation = await runArxivRequest(
        searchKey,
        'search',
        (options) =>
          fetchArxivPapers(
            taskPlan.query,
            categoryMaxResults.get(taskPlan.key) || taskPlan.maxResults,
            windowFrom,
            runNow,
            options
          )
      )
      if (!reconciliation.ok) {
        taskFetchOutcomes.set(taskPlan.taskId, {
          ok: false,
          error: reconciliation.error,
        })
        continue
      }

      taskFetchOutcomes.set(taskPlan.taskId, {
        ok: true,
        papers: selectPapers(
          [...feedSources, reconciliation.value],
          taskPlan.maxResults,
          windowFrom,
          runNow
        ),
        source: feedSources.length > 0 ? 'rss+search' : 'search',
      })
    }

    // ===== 处理阶段：逐任务总结、入库、发邮件 =====
    for (const task of tasks) {
      const taskPlan: ArxivTaskPlan | undefined = planByTaskId.get(task.id)
      const fetchOutcome = taskFetchOutcomes.get(task.id)
      if (!taskPlan || !fetchOutcome || !fetchOutcome.ok) {
        const error = fetchOutcome && !fetchOutcome.ok
          ? fetchOutcome.error
          : new Error('Missing task fetch plan')
        failedTasks++
        taskResults.push({
          taskId: task.id,
          taskName: task.name,
          created: 0,
          emailed: false,
          fetchStatus: 'failure',
          error: error?.message || String(error),
        })
        continue
      }

      const papers = fetchOutcome.papers
      const existingPapers: Array<{ arxivId: string }> = papers.length > 0
        ? await prisma.paper.findMany({
            where: { arxivId: { in: papers.map((paper) => paper.arxivId) } },
            select: { arxivId: true },
          })
        : []
      const existingIds = new Set(existingPapers.map((paper) => paper.arxivId))
      const newPapers = papers.filter((paper) => !existingIds.has(paper.arxivId))
      const createdPapers: Paper[] = []

      for (let paperIndex = 0; paperIndex < newPapers.length; paperIndex++) {
        const paper = newPapers[paperIndex]

        if (paperIndex > 0) await sleep(1000)

        // 单篇总结失败不中断抓取：论文降级为 pending，后续可手动重新分析。
        let summaryZh: string | null = null
        let status = 'summarized'
        try {
          summaryZh = await summarizeAbstract(
            paper.title,
            paper.authors,
            paper.summary,
            summaryModel
          )
        } catch (caught: unknown) {
          const error = asAppError(caught)
          console.error(`summarize failed for ${paper.arxivId}:`, error.message)
          status = 'pending'
          failedSummaries++
        }

        let created: Paper
        try {
          created = (await prisma.paper.create({
            data: {
              arxivId: paper.arxivId,
              title: paper.title,
              authors: paper.authors,
              summary: paper.summary,
              pdfUrl: paper.pdfUrl,
              publishedAt: paper.publishedAt,
              categories: paper.categories,
              status,
              summaryZh,
              taskId: task.id,
            },
          })) as Paper
        } catch (caught: unknown) {
          const error = asAppError(caught)
          if (error.code === 'P2002') {
            console.warn(`Paper ${paper.arxivId} already exists, skipping`)
            continue
          }
          throw error
        }
        createdPapers.push(created)
      }

      totalFetched += papers.length
      totalCreated += createdPapers.length

      let emailed = false
      if (task.emailTo && createdPapers.length > 0) {
        let dailySummary = ''
        try {
          await sleep(1000)
          dailySummary = await generateDailySummary(
            createdPapers.map((paper) => ({
              title: paper.title,
              summaryZh: paper.summaryZh || '',
            })),
            summaryModel
          )
        } catch (caught: unknown) {
          const error = asAppError(caught)
          console.error(`Failed to generate daily summary for task ${task.name}:`, error.message)
        }

        try {
          await sendDailyEmail(
            task.emailTo,
            createdPapers.map((paper) => ({
              arxivId: paper.arxivId,
              title: paper.title,
              authors: paper.authors,
              summaryZh: paper.summaryZh || '',
              pdfUrl: paper.pdfUrl,
            })),
            dailySummary,
            task.name
          )
          emailed = true

          await prisma.paper.updateMany({
            where: { id: { in: createdPapers.map((paper) => paper.id) } },
            data: { status: 'notified' },
          })
        } catch (caught: unknown) {
          const error = asAppError(caught)
          console.error(`Failed to send email for task ${task.name}:`, error.message)
        }
      }

      const fetchCompletedAt = new Date().toISOString()
      const checkpointValue = serializeArxivCheckpoint(
        taskPlan.key,
        new Date(fetchCompletedAt)
      )
      await prisma.config
        .upsert({
          where: { key: arxivCheckpointKey(task.id) },
          update: { value: checkpointValue },
          create: {
            key: arxivCheckpointKey(task.id),
            value: checkpointValue,
          },
        })
        .catch((error) => {
          console.error(`Failed to save checkpoint for task ${task.id}:`, error.message)
        })

      taskResults.push({
        taskId: task.id,
        taskName: task.name,
        created: createdPapers.length,
        emailed,
        fetchStatus: 'success',
        fetchSource: fetchOutcome.source,
        fetchCompletedAt,
      })
    }

    const allFailed = failedTasks === tasks.length
    const firstError = taskResults.find((result) => result.error)?.error

    await prisma.taskLog.create({
      data: {
        taskType: 'daily-check',
        status: allFailed ? 'failure' : 'success',
        message: allFailed
          ? `All ${tasks.length} tasks failed: ${firstError || 'unknown'}`
          : `Tasks: ${tasks.length} (${failedTasks} failed), fetched ${totalFetched}, created ${totalCreated}, summary failed ${failedSummaries}`,
        meta: toJsonValue({
          runNow: runNow.toISOString(),
          windowFrom: windowFrom.toISOString(),
          tasksRun: tasks.length,
          failedTasks,
          failedSummaries,
          logicalFeedRequests,
          logicalSearchRequests,
          actualArxivAttempts,
          cacheHits,
          totalRetryWaitMs,
          circuitOpened: Boolean(circuitError),
          requestDiagnostics,
          fetched: totalFetched,
          created: totalCreated,
          taskResults,
        }),
      },
    })

    return NextResponse.json(
      {
        success: !allFailed,
        tasksRun: tasks.length,
        failedTasks,
        failedSummaries,
        fetched: totalFetched,
        created: totalCreated,
        taskResults,
      },
      { status: allFailed ? 500 : 200 }
    )
  } catch (caught: unknown) {
    const error = asAppError(caught)
    await prisma.taskLog.create({
      data: {
        taskType: 'daily-check',
        status: 'failure',
        message: error.message,
      },
    })

    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    )
  } finally {
    await releaseLock()
  }
}

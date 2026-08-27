import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import {
  fetchArxivPapers,
  fetchArxivFeed,
  isCategoryOnlyQuery,
  extractCategories,
  matchesQuery,
  type ArxivPaper,
} from '@/lib/arxiv'
import { summarizeAbstract, generateDailySummary } from '@/lib/llm'
import { sendDailyEmail } from '@/lib/email'
import { sleep } from '@/lib/rate-limit'
import type { Paper } from '@/types'

export const maxDuration = 300 // 5 分钟

const LOCK_KEY = 'daily_check_lock'
const LOCK_STALE_MS = 10 * 60 * 1000 // 锁超过 10 分钟视为残留（上次异常退出）

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

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!(await acquireLock())) {
    return NextResponse.json(
      { success: false, skipped: true, message: 'Another daily-check run is in progress' },
      { status: 409 }
    )
  }

  const now = new Date()
  const yesterday = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  try {
    const summaryModel = await getConfig('summary_model', 'gpt-4o-mini')

    // 获取所有启用的任务
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

    let totalFetched = 0
    let totalCreated = 0
    let failedTasks = 0
    let failedSummaries = 0
    const taskResults: Array<{ taskId: string; taskName: string; created: number; emailed: boolean; error?: string }> = []

    // ===== 抓取阶段：减少 arXiv 请求次数，降低 429 概率 =====
    // 纯分类任务走官方每日 feed（每分类一次请求，跨任务共享），复杂查询合并为一次 search 请求
    const feedTasks = tasks.filter((t) => isCategoryOnlyQuery(t.query))
    const searchTasks = tasks.filter((t) => !isCategoryOnlyQuery(t.query))

    const categoryPapers = new Map<string, ArxivPaper[]>()
    const feedErrors = new Map<string, string>()
    const categories = [...new Set(feedTasks.flatMap((t) => extractCategories(t.query)))]
    let arxivRequests = 0

    for (let i = 0; i < categories.length; i++) {
      // arXiv 官方要求：请求间隔至少 3 秒
      if (arxivRequests > 0) await sleep(3000)
      arxivRequests++
      try {
        let papers = await fetchArxivFeed(categories[i])
        // feed 只含最近一次公告；周末/节假日无公告时会为空，回退到 search API 按时间窗口查询，
        // 避免周六跑漏掉周五的论文、或周一补不到周末前的论文
        if (papers.length === 0) {
          console.warn(`feed empty for ${categories[i]}, falling back to search API`)
          await sleep(3000)
          arxivRequests++
          papers = await fetchArxivPapers(`cat:${categories[i]}`, 200, yesterday, now)
        }
        categoryPapers.set(categories[i], papers)
      } catch (e: any) {
        console.error(`feed fetch failed for ${categories[i]}:`, e.message)
        feedErrors.set(categories[i], e.message)
      }
    }

    // 复杂查询合并成一次 search 请求，拿回后本地分发
    let mergedPapers: ArxivPaper[] = []
    let mergedError: string | null = null
    if (searchTasks.length > 0) {
      if (arxivRequests > 0) await sleep(3000)
      arxivRequests++
      const mergedQuery = searchTasks.map((t) => `(${t.query})`).join(' OR ')
      const mergedMax = Math.min(
        searchTasks.reduce((sum, t) => sum + t.maxResults, 0),
        2000
      )
      try {
        mergedPapers = await fetchArxivPapers(mergedQuery, mergedMax, yesterday, now)
      } catch (e: any) {
        console.error('merged arXiv search failed:', e.message)
        mergedError = e.message
      }
    }

    // ===== 处理阶段：逐任务分发结果、总结、入库、发邮件 =====
    for (const task of tasks) {
      let papers: ArxivPaper[]
      if (isCategoryOnlyQuery(task.query)) {
        const cats = extractCategories(task.query)
        if (cats.every((c) => feedErrors.has(c))) {
          failedTasks++
          taskResults.push({
            taskId: task.id,
            taskName: task.name,
            created: 0,
            emailed: false,
            error: feedErrors.get(cats[0]),
          })
          continue
        }
        // 多分类取并集，按 arxivId 去重；按任务配置的 maxResults 截断，控制总结成本
        const seen = new Set<string>()
        papers = []
        for (const c of cats) {
          for (const p of categoryPapers.get(c) || []) {
            if (!seen.has(p.arxivId)) {
              seen.add(p.arxivId)
              papers.push(p)
            }
          }
        }
        papers = papers.slice(0, task.maxResults)
      } else {
        if (mergedError) {
          failedTasks++
          taskResults.push({
            taskId: task.id,
            taskName: task.name,
            created: 0,
            emailed: false,
            error: mergedError,
          })
          continue
        }
        // 本地匹配分发；无法解析的查询保守处理（全部归属），避免丢论文；同样按 maxResults 截断
        papers = mergedPapers
          .filter((p) => {
            const matched = matchesQuery(p, task.query)
            if (matched === null) {
              console.warn(`Cannot parse query locally, keeping all papers: ${task.query}`)
              return true
            }
            return matched
          })
          .slice(0, task.maxResults)
      }

      const existingPapers: Array<{ arxivId: string }> = await prisma.paper.findMany({
        where: { arxivId: { in: papers.map((p: ArxivPaper) => p.arxivId) } },
        select: { arxivId: true },
      })
      const existingIds = new Set(existingPapers.map((p) => p.arxivId))

      const newPapers = papers.filter((p: ArxivPaper) => !existingIds.has(p.arxivId))
      const createdPapers: Paper[] = []

      for (let paperIndex = 0; paperIndex < newPapers.length; paperIndex++) {
        const paper = newPapers[paperIndex]

        // LLM 请求之间延迟 1 秒，防止 429
        if (paperIndex > 0) {
          await sleep(1000)
        }

        // 单篇总结失败（如 LLM 404/限流）不中断流程：论文降级为 pending 入库，后续可手动重新分析
        let summaryZh: string | null = null
        let status = 'summarized'
        try {
          summaryZh = await summarizeAbstract(
            paper.title,
            paper.authors,
            paper.summary,
            summaryModel
          )
        } catch (e: any) {
          console.error(`summarize failed for ${paper.arxivId}:`, e.message)
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
        } catch (e: any) {
          // 并发运行时可能已被另一次执行入库（arxivId 唯一约束冲突 P2002），跳过即可
          if (e?.code === 'P2002') {
            console.warn(`Paper ${paper.arxivId} already exists, skipping`)
            continue
          }
          throw e
        }
        createdPapers.push(created)
      }

      totalFetched += papers.length
      totalCreated += createdPapers.length

      // 给这个任务单独发邮件
      let emailed = false
      if (task.emailTo && createdPapers.length > 0) {
        // 生成今日综述
        let dailySummary = ''
        try {
          await sleep(1000)
          dailySummary = await generateDailySummary(
            createdPapers.map((p: Paper) => ({
              title: p.title,
              summaryZh: p.summaryZh || '',
            })),
            summaryModel
          )
        } catch (e: any) {
          console.error(`Failed to generate daily summary for task ${task.name}:`, e.message)
        }

        try {
          await sendDailyEmail(
            task.emailTo,
            createdPapers.map((p: Paper) => ({
              arxivId: p.arxivId,
              title: p.title,
              authors: p.authors,
              summaryZh: p.summaryZh || '',
              pdfUrl: p.pdfUrl,
            })),
            dailySummary,
            task.name
          )
          emailed = true

          await prisma.paper.updateMany({
            where: { id: { in: createdPapers.map((p: Paper) => p.id) } },
            data: { status: 'notified' },
          })
        } catch (e: any) {
          console.error(`Failed to send email for task ${task.name}:`, e.message)
        }
      }

      taskResults.push({
        taskId: task.id,
        taskName: task.name,
        created: createdPapers.length,
        emailed,
      })
    }

    // 全部任务都失败才算整体失败（通常是 arXiv 持续 429）
    const allFailed = failedTasks === tasks.length

    await prisma.taskLog.create({
      data: {
        taskType: 'daily-check',
        status: allFailed ? 'failure' : 'success',
        message: allFailed
          ? `All ${tasks.length} tasks failed: ${taskResults.map((r) => r.error).filter(Boolean)[0] || 'unknown'}`
          : `Tasks: ${tasks.length} (${failedTasks} failed), fetched ${totalFetched}, created ${totalCreated}, summary failed ${failedSummaries}`,
        meta: {
          tasksRun: tasks.length,
          failedTasks,
          failedSummaries,
          arxivRequests,
          feedCategories: categories.length,
          mergedSearch: searchTasks.length,
          fetched: totalFetched,
          created: totalCreated,
          taskResults,
        },
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
  } catch (error: any) {
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

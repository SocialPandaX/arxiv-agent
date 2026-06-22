import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { fetchArxivPapers, type ArxivPaper } from '@/lib/arxiv'
import { summarizeAbstract, generateDailySummary } from '@/lib/llm'
import { sendDailyEmail } from '@/lib/email'
import { sleep } from '@/lib/rate-limit'
import type { Paper } from '@/types'

export const maxDuration = 300 // 5 分钟

async function getConfig(key: string, defaultValue: string): Promise<string> {
  const config = await prisma.config.findUnique({ where: { key } })
  return config?.value || defaultValue
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    const taskResults: Array<{ taskId: string; taskName: string; created: number; emailed: boolean }> = []

    // 遍历每个任务
    for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
      const task = tasks[taskIndex]

      // arXiv 官方要求：请求间隔至少 3 秒
      if (taskIndex > 0) {
        await sleep(3000)
      }

      const papers = await fetchArxivPapers(task.query, task.maxResults, yesterday, now)

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

        const summaryZh = await summarizeAbstract(
          paper.title,
          paper.authors,
          paper.summary,
          summaryModel
        )

        const created = await prisma.paper.create({
          data: {
            arxivId: paper.arxivId,
            title: paper.title,
            authors: paper.authors,
            summary: paper.summary,
            pdfUrl: paper.pdfUrl,
            publishedAt: paper.publishedAt,
            categories: paper.categories,
            status: 'summarized',
            summaryZh,
            taskId: task.id,
          },
        })
        createdPapers.push(created as Paper)
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

    await prisma.taskLog.create({
      data: {
        taskType: 'daily-check',
        status: 'success',
        message: `Tasks: ${tasks.length}, fetched ${totalFetched}, created ${totalCreated}`,
        meta: {
          tasksRun: tasks.length,
          fetched: totalFetched,
          created: totalCreated,
          taskResults,
        },
      },
    })

    return NextResponse.json({
      success: true,
      tasksRun: tasks.length,
      fetched: totalFetched,
      created: totalCreated,
      taskResults,
    })
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
  }
}

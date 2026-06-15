import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { fetchArxivPapers, type ArxivPaper } from '@/lib/arxiv'
import { summarizeAbstract, generateDailySummary } from '@/lib/llm'
import { sendDailyEmail } from '@/lib/email'
import type { Paper } from '@/types'

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
    const emailTo = await getConfig('email_to', '')

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
    const allCreatedPapers: Paper[] = []

    // 遍历每个任务
    for (const task of tasks) {
      const papers = await fetchArxivPapers(task.query, task.maxResults, yesterday, now)

      const existingPapers: Array<{ arxivId: string }> = await prisma.paper.findMany({
        where: { arxivId: { in: papers.map((p: ArxivPaper) => p.arxivId) } },
        select: { arxivId: true },
      })
      const existingIds = new Set(existingPapers.map((p) => p.arxivId))

      const newPapers = papers.filter((p: ArxivPaper) => !existingIds.has(p.arxivId))

      for (const paper of newPapers) {
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
        allCreatedPapers.push(created as Paper)
      }

      totalFetched += papers.length
      totalCreated += newPapers.length
    }

    // 发送邮件
    let emailResult = null
    let emailSkippedReason = null
    if (!emailTo) {
      emailSkippedReason = 'No email_to configured'
    } else if (allCreatedPapers.length === 0) {
      emailSkippedReason = 'No new papers to send'
    } else {
      // 生成今日综述
      let dailySummary = ''
      try {
        dailySummary = await generateDailySummary(
          allCreatedPapers.map((p: Paper) => ({
            title: p.title,
            summaryZh: p.summaryZh || '',
          })),
          summaryModel
        )
      } catch (e: any) {
        console.error('Failed to generate daily summary:', e.message)
      }

      emailResult = await sendDailyEmail(
        emailTo,
        allCreatedPapers.map((p: Paper) => ({
          arxivId: p.arxivId,
          title: p.title,
          authors: p.authors,
          summaryZh: p.summaryZh || '',
          pdfUrl: p.pdfUrl,
        })),
        dailySummary
      )

      await prisma.paper.updateMany({
        where: { id: { in: allCreatedPapers.map((p: Paper) => p.id) } },
        data: { status: 'notified' },
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
          arxivIds: allCreatedPapers.map((p: Paper) => p.arxivId),
        },
      },
    })

    return NextResponse.json({
      success: true,
      tasksRun: tasks.length,
      fetched: totalFetched,
      created: totalCreated,
      emailSent: !!emailResult,
      emailSkippedReason,
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

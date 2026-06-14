import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { fetchArxivPapers } from '@/lib/arxiv'
import { summarizeAbstract } from '@/lib/llm'
import { sendDailyEmail } from '@/lib/email'

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
    const query = await getConfig('arxiv_query', 'cat:cs.AI')
    const maxResults = parseInt(await getConfig('arxiv_max_results', '50'), 10)
    const summaryModel = await getConfig('summary_model', 'gpt-4o-mini')
    const emailTo = await getConfig('email_to', '')

    const papers = await fetchArxivPapers(query, maxResults, yesterday, now)

    const existingIds = new Set(
      (
        await prisma.paper.findMany({
          where: { arxivId: { in: papers.map((p) => p.arxivId) } },
          select: { arxivId: true },
        })
      ).map((p) => p.arxivId)
    )

    const newPapers = papers.filter((p) => !existingIds.has(p.arxivId))
    const createdPapers = []

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
        },
      })
      createdPapers.push(created)
    }

    let emailResult = null
    if (emailTo && createdPapers.length > 0) {
      emailResult = await sendDailyEmail(
        emailTo,
        createdPapers.map((p) => ({
          arxivId: p.arxivId,
          title: p.title,
          authors: p.authors,
          summaryZh: p.summaryZh || '',
          pdfUrl: p.pdfUrl,
        }))
      )

      await prisma.paper.updateMany({
        where: { id: { in: createdPapers.map((p) => p.id) } },
        data: { status: 'notified' },
      })
    }

    await prisma.taskLog.create({
      data: {
        taskType: 'daily-check',
        status: 'success',
        message: `Fetched ${papers.length}, created ${createdPapers.length}`,
        meta: {
          fetched: papers.length,
          created: createdPapers.length,
          arxivIds: createdPapers.map((p) => p.arxivId),
        },
      },
    })

    return NextResponse.json({
      success: true,
      fetched: papers.length,
      created: createdPapers.length,
      emailSent: !!emailResult,
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

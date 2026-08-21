import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { downloadAndExtractPdf } from '@/lib/pdf'
import { analyzeFullPaper, summarizeAbstract } from '@/lib/llm'
import type { Paper } from '@/types'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  let paper: Paper | null = null

  try {
    paper = await prisma.paper.findUnique({ where: { arxivId: id } })
    if (!paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    await prisma.paper.update({
      where: { id: paper.id },
      data: { status: 'analyzing' },
    })

    // pending 论文（入库时总结失败）在分析前先补上摘要总结
    if (paper.status === 'pending' && !paper.summaryZh) {
      const summaryConfig = await prisma.config.findUnique({ where: { key: 'summary_model' } })
      const summaryModel = summaryConfig?.value || 'gpt-4o-mini'
      const summaryZh = await summarizeAbstract(paper.title, paper.authors, paper.summary, summaryModel)
      await prisma.paper.update({
        where: { id: paper.id },
        data: { summaryZh, status: 'summarized' },
      })
    }

    const text = await downloadAndExtractPdf(paper.pdfUrl)
    const config = await prisma.config.findUnique({ where: { key: 'analysis_model' } })
    const analysisModel = config?.value || 'gpt-4o'

    const fullAnalysis = await analyzeFullPaper(paper.title, text, analysisModel)

    const updated = await prisma.paper.update({
      where: { id: paper.id },
      data: {
        fullAnalysis,
        status: 'analyzed',
      },
    })

    await prisma.taskLog.create({
      data: {
        taskType: 'analyze-pdf',
        status: 'success',
        message: `Analyzed ${paper.arxivId}`,
        meta: { arxivId: paper.arxivId },
      },
    })

    return NextResponse.json({ success: true, paper: updated })
  } catch (error: any) {
    await prisma.paper.updateMany({
      where: { arxivId: id, status: 'analyzing' },
      // 恢复分析前的状态，避免 pending/summarized 论文被误改为 notified
      data: { status: paper?.status && paper.status !== 'analyzing' ? paper.status : 'summarized' },
    })

    await prisma.taskLog.create({
      data: {
        taskType: 'analyze-pdf',
        status: 'failure',
        message: error.message,
        meta: { arxivId: id },
      },
    })

    return NextResponse.json(
      { error: error.message || 'Unknown error' },
      { status: 500 }
    )
  }
}

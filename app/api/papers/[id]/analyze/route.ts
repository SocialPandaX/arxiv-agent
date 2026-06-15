import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { downloadAndExtractPdf } from '@/lib/pdf'
import { analyzeFullPaper } from '@/lib/llm'
import type { Paper } from '@/types'

export const maxDuration = 60

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const paper: Paper | null = await prisma.paper.findUnique({ where: { arxivId: id } })
    if (!paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    await prisma.paper.update({
      where: { id: paper.id },
      data: { status: 'analyzing' },
    })

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
    console.error('Analyze PDF error:', error)

    try {
      await prisma.paper.update({
        where: { arxivId: id },
        data: { status: 'notified' },
      })
    } catch (updateError) {
      console.error('Failed to reset paper status:', updateError)
    }

    await prisma.taskLog.create({
      data: {
        taskType: 'analyze-pdf',
        status: 'failure',
        message: error?.message || String(error),
        meta: { arxivId: id, stack: error?.stack },
      },
    })

    return NextResponse.json(
      { error: error?.message || 'Unknown error' },
      { status: 500 }
    )
  }
}

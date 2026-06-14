import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'
import type { Paper } from '@/types'
import { notFound } from 'next/navigation'
import AnalyzeButton from './AnalyzeButton'
import Link from 'next/link'

export default async function PaperDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAuth()
  const { id } = await params

  const paper: Paper | null = await prisma.paper.findUnique({ where: { arxivId: id } })
  if (!paper) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link href="/papers" className="text-sm text-slate-600 hover:text-slate-900">
          ← 返回论文列表
        </Link>
        <h1 className="text-2xl font-bold mt-2">{paper.title}</h1>
        <p className="text-gray-500 mt-1">{paper.authors}</p>
      </div>

      <div className="flex gap-3">
        <a
          href={`https://arxiv.org/abs/${paper.arxivId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm hover:bg-gray-50"
        >
          查看 arXiv
        </a>
        <a
          href={paper.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm hover:bg-gray-50"
        >
          下载 PDF
        </a>
        <AnalyzeButton arxivId={paper.arxivId} status={paper.status} />
      </div>

      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-3">中文摘要总结</h2>
        <p className="text-gray-700 leading-relaxed whitespace-pre-line">
          {paper.summaryZh || '暂无总结'}
        </p>
      </section>

      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-3">原始摘要</h2>
        <p className="text-gray-700 leading-relaxed whitespace-pre-line">
          {paper.summary}
        </p>
      </section>

      {paper.fullAnalysis && (
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-3">完整论文分析</h2>
          <p className="text-gray-700 leading-relaxed whitespace-pre-line">
            {paper.fullAnalysis}
          </p>
        </section>
      )}
    </div>
  )
}

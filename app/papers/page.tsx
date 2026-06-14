import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'
import type { Paper } from '@/types'
import Link from 'next/link'

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireAuth()
  const { status } = await searchParams

  const where = status ? { status } : {}
  const papers: Paper[] = await prisma.paper.findMany({
    where,
    orderBy: { publishedAt: 'desc' },
    take: 100,
  })

  const statusOptions = [
    { value: '', label: '全部' },
    { value: 'new', label: '新论文' },
    { value: 'summarized', label: '已总结' },
    { value: 'notified', label: '已通知' },
    { value: 'analyzed', label: '已分析' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">论文列表</h1>
        <p className="text-gray-500">查看已抓取和总结的论文</p>
      </div>

      <div className="flex gap-2">
        {statusOptions.map((option) => (
          <Link
            key={option.value}
            href={option.value ? `/papers?status=${option.value}` : '/papers'}
            className={`px-3 py-1 rounded-full text-sm ${
              (status || '') === option.value
                ? 'bg-slate-900 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">标题</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">作者</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">发布日期</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">状态</th>
            </tr>
          </thead>
          <tbody>
            {papers.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  暂无论文
                </td>
              </tr>
            )}
            {papers.map((paper) => (
              <tr key={paper.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/paper/${paper.arxivId}`}
                    className="font-medium text-slate-900 hover:text-slate-600 line-clamp-1"
                  >
                    {paper.title}
                  </Link>
                </td>
                <td className="px-4 py-3 text-gray-500 line-clamp-1 max-w-xs">
                  {paper.authors}
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {paper.publishedAt.toLocaleDateString('zh-CN')}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={paper.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: 'bg-gray-100 text-gray-700',
    summarized: 'bg-blue-100 text-blue-700',
    notified: 'bg-green-100 text-green-700',
    analyzing: 'bg-yellow-100 text-yellow-700',
    analyzed: 'bg-purple-100 text-purple-700',
  }

  const labels: Record<string, string> = {
    new: '新论文',
    summarized: '已总结',
    notified: '已通知',
    analyzing: '分析中',
    analyzed: '已分析',
  }

  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${styles[status] || styles.new}`}>
      {labels[status] || status}
    </span>
  )
}

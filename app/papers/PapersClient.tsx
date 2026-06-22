'use client'

import { useState } from 'react'
import BatchActions from './BatchActions'
import DeleteButton from './DeleteButton'

type Paper = {
  id: string
  arxivId: string
  title: string
  authors: string
  publishedAt: Date
  status: string
}

export default function PapersClient({ papers, status }: { papers: Paper[]; status?: string }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const allIds = papers.map((p) => p.arxivId)
  const isAllSelected = papers.length > 0 && selectedIds.size === papers.length

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelectedIds(next)
  }

  function toggleSelectAll() {
    if (isAllSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(allIds))
    }
  }

  const statusOptions = [
    { value: '', label: '全部' },
    { value: 'summarized', label: '已总结' },
    { value: 'notified', label: '已通知' },
    { value: 'analyzed', label: '已分析' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {statusOptions.map((option) => (
          <a
            key={option.value}
            href={option.value ? `/papers?status=${option.value}` : '/papers'}
            className={`px-3 py-1 rounded-full text-sm ${
              (status || '') === option.value
                ? 'bg-slate-900 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            {option.label}
          </a>
        ))}
      </div>

      <BatchActions selectedIds={Array.from(selectedIds)} onDone={() => window.location.reload()} />

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 min-w-0">标题</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 whitespace-nowrap max-w-xs">作者</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 whitespace-nowrap">发布日期</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 whitespace-nowrap">状态</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 whitespace-nowrap">操作</th>
              </tr>
            </thead>
            <tbody>
              {papers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    暂无论文
                  </td>
                </tr>
              )}
              {papers.map((paper) => (
                <tr key={paper.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(paper.arxivId)}
                      onChange={() => toggleSelect(paper.arxivId)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3 min-w-0">
                    <a
                      href={`/paper/${paper.arxivId}`}
                      className="font-medium text-slate-900 hover:text-slate-600 line-clamp-1 block"
                    >
                      {paper.title}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap max-w-xs truncate">
                    {paper.authors}
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {paper.publishedAt.toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <StatusBadge status={paper.status} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <DeleteButton arxivId={paper.arxivId} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${styles[status] || styles.new}`}>
      {labels[status] || status}
    </span>
  )
}

'use client'

import { useState } from 'react'

export default function BatchActions({ selectedIds, onDone }: { selectedIds: string[]; onDone: () => void }) {
  const [loading, setLoading] = useState<string | null>(null)

  async function handleBatchDelete() {
    if (!confirm(`确定要删除选中的 ${selectedIds.length} 篇论文吗？此操作不可恢复。`)) return

    setLoading('delete')
    try {
      const res = await fetch('/api/papers/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arxivIds: selectedIds }),
      })

      if (res.ok) {
        onDone()
      } else {
        alert('批量删除失败')
      }
    } catch {
      alert('批量删除失败')
    } finally {
      setLoading(null)
    }
  }

  async function handleBatchAnalyze() {
    if (!confirm(`确定要分析选中的 ${selectedIds.length} 篇论文吗？分析可能需要较长时间。`)) return

    setLoading('analyze')
    try {
      const res = await fetch('/api/papers/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arxivIds: selectedIds }),
      })

      if (res.ok) {
        alert(`已提交 ${selectedIds.length} 篇论文的分析任务`)
        onDone()
      } else {
        alert('批量分析失败')
      }
    } catch {
      alert('批量分析失败')
    } finally {
      setLoading(null)
    }
  }

  if (selectedIds.length === 0) return null

  return (
    <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
      <span className="text-sm text-blue-700 font-medium">
        已选择 {selectedIds.length} 篇
      </span>
      <button
        onClick={handleBatchDelete}
        disabled={loading !== null}
        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
      >
        {loading === 'delete' ? '删除中...' : '批量删除'}
      </button>
      <button
        onClick={handleBatchAnalyze}
        disabled={loading !== null}
        className="px-3 py-1.5 text-sm bg-slate-900 text-white rounded hover:bg-slate-700 disabled:opacity-50"
      >
        {loading === 'analyze' ? '提交中...' : '批量分析'}
      </button>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AnalyzeButton({
  arxivId,
  status,
}: {
  arxivId: string
  status: string
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleAnalyze() {
    if (!confirm('深入分析完整论文会消耗较多 LLM token，是否继续？')) return

    setLoading(true)
    try {
      const res = await fetch(`/api/papers/${arxivId}/analyze`, { method: 'POST' })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json()
        alert(data.error || '分析失败')
      }
    } catch (error: any) {
      alert(error.message || '分析失败')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'analyzed') {
    return (
      <span className="px-4 py-2 bg-green-100 text-green-700 rounded-md text-sm">
        已分析
      </span>
    )
  }

  if (status === 'analyzing') {
    return (
      <span className="px-4 py-2 bg-yellow-100 text-yellow-700 rounded-md text-sm">
        分析中...
      </span>
    )
  }

  return (
    <button
      onClick={handleAnalyze}
      disabled={loading}
      className="px-4 py-2 bg-slate-900 text-white rounded-md text-sm hover:bg-slate-800 disabled:opacity-50"
    >
      {loading ? '分析中...' : '深入分析完整论文'}
    </button>
  )
}

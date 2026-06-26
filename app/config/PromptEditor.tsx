'use client'

import { useEffect, useState } from 'react'

type Prompt = {
  name: string
  content: string
}

const PROMPT_LABELS: Record<string, string> = {
  'summarize-abstract': '摘要总结提示词',
  'daily-summary': '今日综述提示词',
  'analyze-paper': '深度分析提示词',
}

export default function PromptEditor() {
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/prompts')
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data.prompts)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  function updateContent(name: string, content: string) {
    setPrompts((prev) => prev.map((p) => (p.name === name ? { ...p, content } : p)))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompts }),
      })

      if (res.ok) {
        alert('提示词已保存')
      } else {
        alert('保存失败')
      }
    } catch {
      alert('保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-gray-400">加载中...</p>

  return (
    <div className="space-y-6">
      {prompts.map((prompt) => (
        <div key={prompt.name} className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">
            {PROMPT_LABELS[prompt.name] || prompt.name}
          </label>
          <textarea
            value={prompt.content}
            onChange={(e) => updateContent(prompt.name, e.target.value)}
            rows={8}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-slate-500 focus:border-transparent"
          />
        </div>
      ))}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-50"
      >
        {saving ? '保存中...' : '保存提示词'}
      </button>
    </div>
  )
}

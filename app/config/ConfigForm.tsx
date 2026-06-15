'use client'

import { useEffect, useState } from 'react'

interface Config {
  summary_model: string
  analysis_model: string
  email_to: string
  email_subject_template: string
}

const defaultConfig: Config = {
  summary_model: 'gpt-4o-mini',
  analysis_model: 'gpt-4o',
  email_to: '',
  email_subject_template: '[arXiv 日报] {{date}} 发现 {{count}} 篇新论文',
}

export default function ConfigForm() {
  const [config, setConfig] = useState<Config>(defaultConfig)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        setConfig({ ...defaultConfig, ...data })
        setLoading(false)
      })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    })

    setSaving(false)
    if (res.ok) {
      setMessage('保存成功')
    } else {
      setMessage('保存失败')
    }
  }

  if (loading) return <div className="text-gray-500">加载中...</div>

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-6 max-w-2xl">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          摘要总结模型
        </label>
        <input
          type="text"
          value={config.summary_model}
          onChange={(e) => setConfig({ ...config, summary_model: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
          placeholder="gpt-4o-mini"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          完整论文分析模型
        </label>
        <input
          type="text"
          value={config.analysis_model}
          onChange={(e) => setConfig({ ...config, analysis_model: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
          placeholder="gpt-4o"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          接收邮件地址
        </label>
        <input
          type="email"
          value={config.email_to}
          onChange={(e) => setConfig({ ...config, email_to: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
          placeholder="your@email.com"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          邮件标题模板
        </label>
        <input
          type="text"
          value={config.email_subject_template}
          onChange={(e) => setConfig({ ...config, email_subject_template: e.target.value })}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
        />
      </div>

      {message && (
        <div
          className={`text-sm ${message.includes('成功') ? 'text-green-600' : 'text-red-600'}`}
        >
          {message}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
      >
        {saving ? '保存中...' : '保存配置'}
      </button>
    </form>
  )
}

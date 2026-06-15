'use client'

import { useEffect, useState } from 'react'

interface Task {
  id: string
  name: string
  query: string
  maxResults: number
  enabled: boolean
  createdAt: string
}

interface TaskFormData {
  name: string
  query: string
  maxResults: string
  enabled: boolean
}

const emptyForm: TaskFormData = {
  name: '',
  query: '',
  maxResults: '50',
  enabled: true,
}

export default function TaskManager() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TaskFormData>(emptyForm)
  const [saving, setSaving] = useState(false)

  async function fetchTasks() {
    const res = await fetch('/api/tasks/config')
    const data = await res.json()
    setTasks(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchTasks()
  }, [])

  function startEdit(task: Task) {
    setEditingId(task.id)
    setForm({
      name: task.name,
      query: task.query,
      maxResults: String(task.maxResults),
      enabled: task.enabled,
    })
    setShowForm(true)
  }

  function startCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)

    const url = editingId
      ? `/api/tasks/config/${editingId}`
      : '/api/tasks/config'
    const method = editingId ? 'PUT' : 'POST'

    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name,
        query: form.query,
        maxResults: form.maxResults,
        enabled: form.enabled,
      }),
    })

    setSaving(false)
    setShowForm(false)
    setForm(emptyForm)
    setEditingId(null)
    fetchTasks()
  }

  async function handleDelete(id: string) {
    if (!confirm('确定要删除这个任务吗？')) return
    await fetch(`/api/tasks/config/${id}`, { method: 'DELETE' })
    fetchTasks()
  }

  async function handleToggle(task: Task) {
    await fetch(`/api/tasks/config/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: task.name,
        query: task.query,
        maxResults: task.maxResults,
        enabled: !task.enabled,
      }),
    })
    fetchTasks()
  }

  if (loading) return <div className="text-gray-500">加载中...</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">论文追踪任务</h2>
        <button
          onClick={startCreate}
          className="px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 text-sm"
        >
          + 新建任务
        </button>
      </div>

      {tasks.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          还没有创建任何任务，点击"新建任务"添加 arXiv 论文追踪
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`bg-white rounded-lg shadow p-4 flex items-center justify-between ${!task.enabled ? 'opacity-50' : ''}`}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium">{task.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded ${task.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {task.enabled ? '启用' : '禁用'}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1 font-mono">{task.query}</p>
                <p className="text-xs text-gray-400 mt-1">最大 {task.maxResults} 篇/次</p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  onClick={() => handleToggle(task)}
                  className="text-sm text-gray-500 hover:text-gray-700 px-2"
                >
                  {task.enabled ? '禁用' : '启用'}
                </button>
                <button
                  onClick={() => startEdit(task)}
                  className="text-sm text-blue-600 hover:text-blue-800 px-2"
                >
                  编辑
                </button>
                <button
                  onClick={() => handleDelete(task.id)}
                  className="text-sm text-red-600 hover:text-red-800 px-2"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <form
            onSubmit={handleSubmit}
            className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md space-y-4"
          >
            <h3 className="text-lg font-semibold">
              {editingId ? '编辑任务' : '新建任务'}
            </h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                任务名称
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="AI 论文追踪"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                arXiv 搜索表达式
              </label>
              <input
                type="text"
                value={form.query}
                onChange={(e) => setForm({ ...form, query: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
                placeholder="cat:cs.AI"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                示例：cat:cs.AI、cat:cs.LG+OR+cat:cs.CL、all:large language model
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                最大抓取数量
              </label>
              <input
                type="number"
                value={form.maxResults}
                onChange={(e) => setForm({ ...form, maxResults: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="rounded border-gray-300"
              />
              <label htmlFor="enabled" className="text-sm text-gray-700">
                启用此任务
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditingId(null) }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

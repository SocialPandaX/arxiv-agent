'use client'

import { useState } from 'react'

type TaskLog = {
  id: string
  taskType: string
  status: string
  message: string | null
  createdAt: Date
}

export default function TasksClient({ tasks }: { tasks: TaskLog[] }) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)

  const allIds = tasks.map((t) => t.id)
  const isAllSelected = tasks.length > 0 && selectedIds.size === tasks.length

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

  async function handleBatchDelete() {
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 条日志吗？此操作不可恢复。`)) return

    setDeleting(true)
    try {
      const res = await fetch('/api/tasks/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      })

      if (res.ok) {
        window.location.reload()
      } else {
        alert('批量删除失败')
      }
    } catch {
      alert('批量删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <span className="text-sm text-blue-700 font-medium">
            已选择 {selectedIds.size} 条
          </span>
          <button
            onClick={handleBatchDelete}
            disabled={deleting}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? '删除中...' : '批量删除'}
          </button>
        </div>
      )}

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
                <th className="text-left px-4 py-3 font-medium text-gray-700 whitespace-nowrap">时间</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 whitespace-nowrap">任务类型</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 whitespace-nowrap">状态</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700">消息</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    暂无任务记录
                  </td>
                </tr>
              )}
              {tasks.map((task) => (
                <tr key={task.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(task.id)}
                      onChange={() => toggleSelect(task.id)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {task.createdAt.toLocaleString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{task.taskType}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs ${
                        task.status === 'success'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {task.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{task.message || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

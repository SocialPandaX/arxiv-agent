'use client'

import { useState } from 'react'

export default function DeleteButton({ arxivId }: { arxivId: string }) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirm(`确定要删除论文 ${arxivId} 吗？此操作不可恢复。`)) return

    setDeleting(true)
    try {
      const res = await fetch(`/api/papers/${arxivId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        window.location.reload()
      } else {
        alert('删除失败')
      }
    } catch {
      alert('删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-red-600 hover:text-red-800 text-sm disabled:opacity-50"
    >
      {deleting ? '删除中...' : '删除'}
    </button>
  )
}


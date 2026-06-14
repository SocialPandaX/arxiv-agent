import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'

export default async function TasksPage() {
  await requireAuth()

  const tasks: Array<{
    id: string
    taskType: string
    status: string
    message: string | null
    createdAt: Date
  }> = await prisma.taskLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">任务日志</h1>
        <p className="text-gray-500">查看 Agent 执行历史</p>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-700">时间</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">任务类型</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">状态</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">消息</th>
            </tr>
          </thead>
          <tbody>
            {tasks.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  暂无任务记录
                </td>
              </tr>
            )}
            {tasks.map((task) => (
              <tr key={task.id} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                  {task.createdAt.toLocaleString('zh-CN')}
                </td>
                <td className="px-4 py-3">{task.taskType}</td>
                <td className="px-4 py-3">
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
                <td className="px-4 py-3 text-gray-700">{task.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

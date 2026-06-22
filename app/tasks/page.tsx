import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'
import TasksClient from './TasksClient'

export default async function TasksPage() {
  await requireAuth()

  const tasks = await prisma.taskLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">任务日志</h1>
        <p className="text-gray-500">查看 Agent 执行历史</p>
      </div>

      <TasksClient tasks={tasks} />
    </div>
  )
}

import { requireAuth } from '@/lib/auth'
import ConfigForm from './ConfigForm'
import TaskManager from './TaskManager'

export default async function ConfigPage() {
  await requireAuth()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">配置</h1>
        <p className="text-gray-500">管理追踪任务和全局设置</p>
      </div>

      <TaskManager />

      <div className="border-t pt-8">
        <h2 className="text-lg font-semibold mb-4">全局设置</h2>
        <ConfigForm />
      </div>
    </div>
  )
}

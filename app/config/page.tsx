import { requireAuth } from '@/lib/auth'
import ConfigForm from './ConfigForm'
import TaskManager from './TaskManager'
import PromptEditor from './PromptEditor'

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

      <div className="border-t pt-8">
        <h2 className="text-lg font-semibold mb-4">提示词管理</h2>
        <p className="text-sm text-gray-500 mb-4">自定义 LLM 使用的提示词，修改后立即生效</p>
        <PromptEditor />
      </div>
    </div>
  )
}

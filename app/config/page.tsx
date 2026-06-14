import { requireAuth } from '@/lib/auth'
import ConfigForm from './ConfigForm'

export default async function ConfigPage() {
  await requireAuth()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">配置</h1>
        <p className="text-gray-500">管理 Agent 的搜索条件、模型和邮件设置</p>
      </div>

      <ConfigForm />
    </div>
  )
}

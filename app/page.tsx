import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'
import type { Paper, TaskLog } from '@/types'
import { FileText, Mail, CheckCircle, Clock } from 'lucide-react'
import Link from 'next/link'

export default async function DashboardPage() {
  await requireAuth()

  const totalPapers = await prisma.paper.count()
  const todayPapers = await prisma.paper.count({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
  })
  const notifiedPapers = await prisma.paper.count({ where: { status: 'notified' } })
  const analyzedPapers = await prisma.paper.count({ where: { status: 'analyzed' } })

  const recentPapers: Paper[] = await prisma.paper.findMany({
    orderBy: { publishedAt: 'desc' },
    take: 5,
  })

  const recentTasks: TaskLog[] = await prisma.taskLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">仪表盘</h1>
        <p className="text-gray-500">arXiv 论文监控概览</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="论文总数" value={totalPapers} />
        <StatCard icon={Clock} label="24 小时内新增" value={todayPapers} />
        <StatCard icon={Mail} label="已发送日报" value={notifiedPapers} />
        <StatCard icon={CheckCircle} label="已深入分析" value={analyzedPapers} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">最近论文</h2>
            <Link href="/papers" className="text-sm text-slate-600 hover:text-slate-900">
              查看全部 →
            </Link>
          </div>
          <div className="space-y-4">
            {recentPapers.length === 0 && (
              <p className="text-gray-400 text-sm">暂无论文</p>
            )}
            {recentPapers.map((paper) => (
              <div key={paper.id} className="border-b border-gray-100 pb-3 last:border-0">
                <Link
                  href={`/paper/${paper.arxivId}`}
                  className="font-medium text-slate-900 hover:text-slate-600 line-clamp-1"
                >
                  {paper.title}
                </Link>
                <p className="text-xs text-gray-500 mt-1">
                  {paper.publishedAt.toLocaleDateString('zh-CN')} · {paper.status}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">最近任务</h2>
            <Link href="/tasks" className="text-sm text-slate-600 hover:text-slate-900">
              查看全部 →
            </Link>
          </div>
          <div className="space-y-3">
            {recentTasks.length === 0 && (
              <p className="text-gray-400 text-sm">暂无任务记录</p>
            )}
            {recentTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{task.taskType}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs ${
                    task.status === 'success'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                  }`}
                >
                  {task.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FileText
  label: string
  value: number
}) {
  return (
    <div className="bg-white rounded-lg shadow p-5 flex items-center gap-4">
      <div className="p-3 bg-slate-100 rounded-lg">
        <Icon size={24} className="text-slate-700" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  )
}

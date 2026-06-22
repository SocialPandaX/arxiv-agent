import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'
import PapersClient from './PapersClient'

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  await requireAuth()
  const { status } = await searchParams

  const where = status ? { status } : {}
  const papers = await prisma.paper.findMany({
    where,
    orderBy: { publishedAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">论文列表</h1>
        <p className="text-gray-500">查看已抓取和总结的论文</p>
      </div>

      <PapersClient papers={papers} status={status} />
    </div>
  )
}

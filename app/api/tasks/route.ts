import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import type { TaskLog } from '@/types'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '20', 10)
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  const [tasks, total] = await Promise.all([
    prisma.taskLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }) as Promise<TaskLog[]>,
    prisma.taskLog.count(),
  ])

  return NextResponse.json({ tasks, total })
}

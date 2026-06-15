import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'

export async function GET() {
  await requireAuth()
  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(tasks)
}

export async function POST(request: NextRequest) {
  await requireAuth()
  const body = await request.json()
  const { name, query, maxResults, enabled } = body

  if (!name || !query) {
    return NextResponse.json(
      { error: 'Name and query are required' },
      { status: 400 }
    )
  }

  const task = await prisma.task.create({
    data: {
      name,
      query,
      maxResults: parseInt(maxResults) || 50,
      enabled: enabled !== false,
    },
  })

  return NextResponse.json(task)
}

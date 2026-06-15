import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth()
  const { id } = await params
  const body = await request.json()
  const { name, query, maxResults, enabled } = body

  const task = await prisma.task.update({
    where: { id },
    data: {
      name,
      query,
      maxResults: parseInt(maxResults) || 50,
      enabled,
    },
  })

  return NextResponse.json(task)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth()
  const { id } = await params

  await prisma.task.delete({ where: { id } })
  return NextResponse.json({ success: true })
}

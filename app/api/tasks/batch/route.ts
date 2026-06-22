import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'

export async function DELETE(request: NextRequest) {
  await requireAuth()
  const body = await request.json()
  const { ids } = body as { ids: string[] }

  if (!ids?.length) {
    return NextResponse.json({ error: 'No tasks selected' }, { status: 400 })
  }

  try {
    await prisma.taskLog.deleteMany({
      where: { id: { in: ids } },
    })
    return NextResponse.json({ success: true, count: ids.length })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to delete tasks' },
      { status: 500 }
    )
  }
}

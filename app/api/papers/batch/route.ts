import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'

export async function DELETE(request: NextRequest) {
  await requireAuth()
  const body = await request.json()
  const { arxivIds } = body as { arxivIds: string[] }

  if (!arxivIds?.length) {
    return NextResponse.json({ error: 'No papers selected' }, { status: 400 })
  }

  try {
    await prisma.paper.deleteMany({
      where: { arxivId: { in: arxivIds } },
    })
    return NextResponse.json({ success: true, count: arxivIds.length })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to delete papers' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  await requireAuth()
  const body = await request.json()
  const { arxivIds } = body as { arxivIds: string[] }

  if (!arxivIds?.length) {
    return NextResponse.json({ error: 'No papers selected' }, { status: 400 })
  }

  try {
    const results = await Promise.all(
      arxivIds.map((id) =>
        fetch(`${process.env.NEXT_PUBLIC_URL || 'http://localhost:3000'}/api/papers/${id}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }).then((r) => r.json())
      )
    )
    return NextResponse.json({ success: true, count: arxivIds.length, results })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to analyze papers' },
      { status: 500 }
    )
  }
}

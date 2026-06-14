import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import type { Config } from '@/types'

const CONFIG_KEYS = [
  'arxiv_query',
  'arxiv_max_results',
  'summary_model',
  'analysis_model',
  'email_to',
  'email_subject_template',
]

export async function GET() {
  const configs: Config[] = await prisma.config.findMany({
    where: { key: { in: CONFIG_KEYS } },
  })

  const result: Record<string, string> = {}
  for (const key of CONFIG_KEYS) {
    const config = configs.find((c: Config) => c.key === key)
    result[key] = config?.value || getDefaultValue(key)
  }

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  const body = await request.json()

  for (const key of CONFIG_KEYS) {
    if (body[key] !== undefined) {
      await prisma.config.upsert({
        where: { key },
        update: { value: String(body[key]) },
        create: { key, value: String(body[key]) },
      })
    }
  }

  return NextResponse.json({ success: true })
}

function getDefaultValue(key: string): string {
  switch (key) {
    case 'arxiv_query':
      return 'cat:cs.AI'
    case 'arxiv_max_results':
      return '50'
    case 'summary_model':
      return 'gpt-4o-mini'
    case 'analysis_model':
      return 'gpt-4o'
    case 'email_subject_template':
      return '[arXiv 日报] {{date}} 发现 {{count}} 篇新论文'
    default:
      return ''
  }
}

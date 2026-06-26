import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'

const DEFAULT_PROMPTS = [
  {
    name: 'summarize-abstract',
    content: `你是一位学术论文助手。
根据这个论文的摘要，向用户说明这个论文主要讲了什么。

非必要情况下，不允许使用大量专业术语强行描述。
尽量语言亲和，内容通俗易懂。
不允许对英文句子简单直译后直接输出。
不允许输出难以理解的长难句。
要求文字清晰易懂。
内容控制在200字以内。
不要使用Markdown格式，建议使用纯文本。
不需要多余说辞，直接给出描述。`,
  },
  {
    name: 'daily-summary',
    content: `你是一位学术研究趋势分析专家。
请根据今日收录的多篇论文摘要，用中文撰写一份概要。
概要中概述今日研究的主要趋势、热点方向和值得关注的发现。

保证内容在中文语境下通俗易懂。
不允许对英文句子简单直译后直接输出。
不允许使用难以理解的长难句。
要求文字清晰易懂。
概要控制在100字左右。
不允许分点回答。
不要使用Markdown格式。
不需要多余说辞，直接给出概要。`,
  },
  {
    name: 'analyze-paper',
    content: `你是一位学术论文分析专家。
请阅读以下论文，分析并用简洁易懂的中文给出总结：
总结的基本格式为：
1) 研究背景与问题
2) 核心方法
3) 主要实验与结果 
4) 创新点与不足

保证内容在中文语境下通俗易懂。
不允许对英文句子简单直译后直接输出。
不允许输出难以理解的长难句。
要求文字清晰易懂。
不需要"我要开始了"等多余说辞，直接给出你的总结。`,
  },
]

export async function GET() {
  await requireAuth()

  let prompts = await prisma.prompt.findMany({
    orderBy: { name: 'asc' },
  })

  // 如果数据库为空，初始化默认提示词
  if (prompts.length === 0) {
    await prisma.prompt.createMany({
      data: DEFAULT_PROMPTS,
    })
    prompts = await prisma.prompt.findMany({
      orderBy: { name: 'asc' },
    })
  }

  return NextResponse.json({ prompts })
}

export async function PUT(request: NextRequest) {
  await requireAuth()
  const body = await request.json()
  const { prompts } = body as { prompts: Array<{ name: string; content: string }> }

  if (!prompts?.length) {
    return NextResponse.json({ error: 'No prompts provided' }, { status: 400 })
  }

  try {
    const results = await Promise.all(
      prompts.map((p) =>
        prisma.prompt.upsert({
          where: { name: p.name },
          update: { content: p.content },
          create: { name: p.name, content: p.content },
        })
      )
    )
    return NextResponse.json({ success: true, count: results.length })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to update prompts' },
      { status: 500 }
    )
  }
}

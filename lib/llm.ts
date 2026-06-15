import OpenAI from 'openai'

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  })
}

export async function summarizeAbstract(
  title: string,
  authors: string,
  abstract: string,
  model = 'gpt-4o-mini'
): Promise<string> {
  const openai = getOpenAI()
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是一位学术论文助手。请用中文简洁地总结论文摘要，突出研究问题、方法、主要贡献。控制在 200 字以内。',
      },
      {
        role: 'user',
        content: `标题：${title}\n作者：${authors}\n摘要：${abstract}`,
      },
    ],
    temperature: 0.3,
  })
  return response.choices[0]?.message?.content?.trim() || ''
}

export async function generateDailySummary(
  papers: Array<{ title: string; summaryZh: string }>,
  model = 'gpt-4o-mini'
): Promise<string> {
  const openai = getOpenAI()
  const papersText = papers
    .map((p, i) => `${i + 1}. ${p.title}\n   ${p.summaryZh}`)
    .join('\n\n')

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是一位 AI 研究趋势分析专家。请根据今日收录的多篇论文摘要，用中文撰写一份今日综述，概述今日研究的主要趋势、热点方向和值得关注的发现。控制在 300-500 字，使用 Markdown 格式。',
      },
      {
        role: 'user',
        content: `今日共收录 ${papers.length} 篇论文：\n\n${papersText}`,
      },
    ],
    temperature: 0.3,
  })
  return response.choices[0]?.message?.content?.trim() || ''
}

export async function analyzeFullPaper(
  title: string,
  text: string,
  model = 'gpt-4o'
): Promise<string> {
  const openai = getOpenAI()
  const maxChars = 15000
  const truncated = text.slice(0, maxChars)

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content:
          '你是一位学术论文分析专家。请阅读以下论文全文节选，用中文总结：1) 研究背景与问题 2) 核心方法 3) 主要实验与结果 4) 创新点与不足。',
      },
      {
        role: 'user',
        content: `标题：${title}\n\n论文内容：\n${truncated}`,
      },
    ],
    temperature: 0.3,
  })
  return response.choices[0]?.message?.content?.trim() || ''
}

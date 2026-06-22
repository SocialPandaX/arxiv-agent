import OpenAI from 'openai'
import fs from 'fs/promises'
import path from 'path'
import { withRetry } from './rate-limit'

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  })
}

const promptsDir = path.join(process.cwd(), 'prompts')

async function loadPrompt(filename: string): Promise<string> {
  try {
    return await fs.readFile(path.join(promptsDir, filename), 'utf-8')
  } catch {
    throw new Error(`Failed to load prompt: ${filename}`)
  }
}

export async function summarizeAbstract(
  title: string,
  authors: string,
  abstract: string,
  model = 'gpt-4o-mini'
): Promise<string> {
  const openai = getOpenAI()
  const systemPrompt = await loadPrompt('summarize-abstract.md')

  const response = await withRetry(
    () => openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `标题：${title}\n作者：${authors}\n摘要：${abstract}`,
        },
      ],
      temperature: 0.3,
    }),
    { label: `LLM summarize (${title.slice(0, 30)})` }
  )
  return response.choices[0]?.message?.content?.trim() || ''
}

export async function generateDailySummary(
  papers: Array<{ title: string; summaryZh: string }>,
  model = 'gpt-4o-mini'
): Promise<string> {
  const openai = getOpenAI()
  const systemPrompt = await loadPrompt('daily-summary.md')
  const papersText = papers
    .map((p, i) => `${i + 1}. ${p.title}\n   ${p.summaryZh}`)
    .join('\n\n')

  const response = await withRetry(
    () => openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `今日共收录 ${papers.length} 篇论文：\n\n${papersText}`,
        },
      ],
      temperature: 0.3,
    }),
    { label: 'LLM daily-summary' }
  )
  return response.choices[0]?.message?.content?.trim() || ''
}

export async function analyzeFullPaper(
  title: string,
  text: string,
  model = 'gpt-4o'
): Promise<string> {
  const openai = getOpenAI()
  const systemPrompt = await loadPrompt('analyze-paper.md')
  const maxChars = 15000
  const truncated = text.slice(0, maxChars)

  const response = await withRetry(
    () => openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `标题：${title}\n\n论文内容：\n${truncated}`,
        },
      ],
      temperature: 0.3,
    }),
    { label: `LLM analyze (${title.slice(0, 30)})` }
  )
  return response.choices[0]?.message?.content?.trim() || ''
}

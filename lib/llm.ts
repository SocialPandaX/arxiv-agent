import OpenAI from 'openai'
import prisma from '@/lib/db'
import { withRetry } from './rate-limit'
import { decryptSecret } from './crypto'

/**
 * 创建 OpenAI 客户端：优先用配置页保存的接入地址/密钥（密文需解密），未配置时回退环境变量。
 */
async function getOpenAI(): Promise<{ client: OpenAI; baseURL: string }> {
  const configs = await prisma.config.findMany({
    where: { key: { in: ['openai_base_url', 'openai_api_key'] } },
  })
  const dbValue = (key: string) => configs.find((c) => c.key === key)?.value || ''

  // API key 存的是密文；解密失败（如 ENCRYPTION_KEY 被更换）时回退环境变量，不阻断整个任务
  let dbApiKey = ''
  const storedKey = dbValue('openai_api_key')
  if (storedKey) {
    try {
      dbApiKey = decryptSecret(storedKey)
    } catch {
      console.error('Failed to decrypt stored openai_api_key, falling back to env (若刚更换过 ENCRYPTION_KEY，请在配置页重新保存 API Key)')
    }
  }

  const apiKey = dbApiKey || process.env.OPENAI_API_KEY
  const baseURL = dbValue('openai_base_url') || process.env.OPENAI_BASE_URL

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set (可在配置页或环境变量中设置)')
  }
  return {
    client: new OpenAI({ apiKey, baseURL: baseURL || undefined }),
    baseURL: baseURL || 'https://api.openai.com/v1',
  }
}

/**
 * 给 LLM 错误补充模型名/接入地址上下文（404 通常是模型名不存在或 baseURL 配错）
 */
function withErrorContext<T>(promise: Promise<T>, model: string, baseURL: string, label: string): Promise<T> {
  return promise.catch((e: any) => {
    e.message = `${label} 失败 (model=${model}, base=${baseURL}): ${e.message}`
    throw e
  })
}

async function loadPrompt(name: string): Promise<string> {
  const prompt = await prisma.prompt.findUnique({ where: { name } })
  if (!prompt) {
    throw new Error(`Prompt not found: ${name}`)
  }
  return prompt.content
}

export async function summarizeAbstract(
  title: string,
  authors: string,
  abstract: string,
  model = 'gpt-4o-mini'
): Promise<string> {
  const { client: openai, baseURL } = await getOpenAI()
  const systemPrompt = await loadPrompt('summarize-abstract')

  const response = await withErrorContext(
    withRetry(
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
    ),
    model,
    baseURL,
    '摘要翻译'
  )
  return response.choices[0]?.message?.content?.trim() || ''
}

export async function generateDailySummary(
  papers: Array<{ title: string; summaryZh: string }>,
  model = 'gpt-4o-mini'
): Promise<string> {
  const { client: openai, baseURL } = await getOpenAI()
  const systemPrompt = await loadPrompt('daily-summary')
  const papersText = papers
    .map((p, i) => `${i + 1}. ${p.title}\n   ${p.summaryZh}`)
    .join('\n\n')

  const response = await withErrorContext(
    withRetry(
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
    ),
    model,
    baseURL,
    '每日综述'
  )
  return response.choices[0]?.message?.content?.trim() || ''
}

export async function analyzeFullPaper(
  title: string,
  text: string,
  model = 'gpt-4o'
): Promise<string> {
  const { client: openai, baseURL } = await getOpenAI()
  const systemPrompt = await loadPrompt('analyze-paper')
  const maxChars = 15000
  const truncated = text.slice(0, maxChars)

  const response = await withErrorContext(
    withRetry(
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
    ),
    model,
    baseURL,
    '全文分析'
  )
  return response.choices[0]?.message?.content?.trim() || ''
}

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import prisma from '@/lib/db'
import { encryptSecret, decryptSecret } from '@/lib/crypto'
import type { Config } from '@/types'

const CONFIG_KEYS = [
  'arxiv_query',
  'arxiv_max_results',
  'summary_model',
  'analysis_model',
  'email_to',
  'email_subject_template',
  'openai_base_url',
  'openai_api_key',
]

const KEY_MASK_PREFIX = '••••••••'

/**
 * 脱敏展示 API key：只保留后 4 位；保存时原样返回则视为未修改。
 * 数据库存的是密文，需先解密再脱敏；解密失败（如 ENCRYPTION_KEY 更换）时返回空串。
 */
function maskStoredKey(stored: string): string {
  try {
    const plain = decryptSecret(stored)
    return `${KEY_MASK_PREFIX}${plain.slice(-4)}`
  } catch {
    return ''
  }
}

export async function GET() {
  await requireAuth()

  const configs: Config[] = await prisma.config.findMany({
    where: { key: { in: CONFIG_KEYS } },
  })

  const result: Record<string, string> = {}
  for (const key of CONFIG_KEYS) {
    const config = configs.find((c: Config) => c.key === key)
    const value = config?.value || getDefaultValue(key)
    // API key 优先用数据库配置（密文，解密后脱敏展示），其次环境变量（仅提示已配置）
    if (key === 'openai_api_key') {
      if (value) {
        result[key] = maskStoredKey(value)
      } else if (process.env.OPENAI_API_KEY) {
        result[key] = `${KEY_MASK_PREFIX}${process.env.OPENAI_API_KEY.slice(-4)}`
      } else {
        result[key] = ''
      }
    } else if (key === 'openai_base_url') {
      result[key] = value || process.env.OPENAI_BASE_URL || ''
    } else {
      result[key] = value
    }
  }

  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  await requireAuth()
  const body = await request.json()

  // 预检查：若本次要保存新 API key，必须先配好加密密钥，避免明文落库
  const newApiKey =
    typeof body['openai_api_key'] === 'string' &&
    !body['openai_api_key'].startsWith(KEY_MASK_PREFIX) &&
    body['openai_api_key'] !== ''
      ? body['openai_api_key']
      : null
  if (newApiKey && !process.env.ENCRYPTION_KEY) {
    return NextResponse.json(
      { error: '保存 API Key 需要先设置 ENCRYPTION_KEY 环境变量（用于加密存储）' },
      { status: 400 }
    )
  }

  for (const key of CONFIG_KEYS) {
    if (body[key] !== undefined) {
      // API key 未修改（回传的是脱敏值）或留空（沿用环境变量）时不覆盖；新值加密后存储
      if (key === 'openai_api_key') {
        if (!newApiKey) continue
        await prisma.config.upsert({
          where: { key },
          update: { value: encryptSecret(newApiKey) },
          create: { key, value: encryptSecret(newApiKey) },
        })
        continue
      }
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

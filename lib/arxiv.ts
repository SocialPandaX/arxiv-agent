import { XMLParser } from 'fast-xml-parser'
import { withRetry, type RetryEvent } from './rate-limit'

const USER_AGENT =
  'arxiv-agent/1.1 (+https://github.com/SocialPandaX/arxiv-agent)'
const SEARCH_ENDPOINT = 'https://export.arxiv.org/api/query'
const RSS_ENDPOINT = 'https://rss.arxiv.org/atom'
const ARXIV_MAX_RESULTS = 2000
const REQUEST_TIMEOUT_MS = 30000

export interface ArxivPaper {
  arxivId: string
  title: string
  authors: string
  summary: string
  pdfUrl: string
  publishedAt: Date
  categories: string
}

export interface ArxivFeedSnapshot {
  papers: ArxivPaper[]
  feedUpdatedAt: Date | null
  totalEntries: number
  newEntries: number
  crossEntries: number
  ignoredEntries: number
  malformedEntries: number
}

export interface ArxivFetchOptions {
  deadlineAt?: number
  beforeAttempt?: (attempt: number) => void | Promise<void>
  onRetry?: (event: RetryEvent) => void
}

export interface CategoryOrQuery {
  categories: string[]
  canonicalQuery: string
  key: string
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * arXiv submittedDate 使用分钟精度 UTC：YYYYMMDDHHMM。
 */
export function formatArxivDate(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('Invalid arXiv date')
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
  ].join('')
}

/**
 * 兼容历史配置里把 URL 空格写成 +OR+ 的形式；只替换引号之外的运算符，
 * 避免破坏诸如 "C++" 的查询值。
 */
export function normalizeLogicalQuery(query: string): string {
  const operators = ['ANDNOT', 'AND', 'OR', 'TO']
  let result = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < query.length; ) {
    const char = query[i]
    if (char === '"' || char === "'") {
      quote = quote === char ? null : quote || char
      result += char
      i++
      continue
    }

    if (!quote && char === '+') {
      const rest = query.slice(i).toUpperCase()
      const operator = operators.find((name) => rest.startsWith(`+${name}+`))
      if (operator) {
        result += ` ${operator} `
        i += operator.length + 2
        continue
      }
    }

    result += char
    i++
  }

  return result.trim()
}

export function buildArxivSearchUrl(
  query: string,
  maxResults = 50,
  dateFrom?: Date,
  dateTo?: Date
): string {
  const normalizedQuery = normalizeLogicalQuery(query)
  if (!normalizedQuery) throw new Error('arXiv query is empty')

  const normalizedMax = Math.min(
    ARXIV_MAX_RESULTS,
    Math.max(1, Number.isFinite(maxResults) ? Math.trunc(maxResults) : 1)
  )

  let searchQuery = normalizedQuery
  if (dateFrom || dateTo) {
    if (!dateFrom || !dateTo) {
      throw new Error('Both arXiv date range boundaries are required')
    }
    if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
      throw new Error('Invalid arXiv date range')
    }
    if (dateFrom.getTime() > dateTo.getTime()) {
      throw new Error('arXiv date range is reversed')
    }
    const dateRange = `submittedDate:[${formatArxivDate(dateFrom)} TO ${formatArxivDate(dateTo)}]`
    searchQuery = `(${normalizedQuery}) AND ${dateRange}`
  }

  const url = new URL(SEARCH_ENDPOINT)
  url.searchParams.set('search_query', searchQuery)
  url.searchParams.set('sortBy', 'submittedDate')
  url.searchParams.set('sortOrder', 'descending')
  url.searchParams.set('max_results', String(normalizedMax))
  return url.toString()
}

/**
 * 只识别可以安全用分类 RSS 表达的查询：一个或多个 cat: 条件，以 OR 连接。
 * 其他 arXiv 查询语法全部交还 Search API，不在本地模拟。
 */
export function parseCategoryOrQuery(query: string): CategoryOrQuery | null {
  const normalized = normalizeLogicalQuery(query)
  if (!normalized || /["']/.test(normalized)) return null

  let depth = 0
  for (const char of normalized) {
    if (char === '(') depth++
    if (char === ')') depth--
    if (depth < 0) return null
  }
  if (depth !== 0) return null

  const flattened = normalized.replace(/[()]/g, ' ').trim()
  const terms = flattened.split(/\s+OR\s+/i)
  if (terms.length === 0) return null

  const categoriesByKey = new Map<string, string>()
  for (const term of terms) {
    const match = term.trim().match(/^cat:([a-z][a-z0-9.\-]*)$/i)
    if (!match) return null
    const category = match[1]
    const key = category.toLowerCase()
    if (!categoriesByKey.has(key)) categoriesByKey.set(key, category)
  }

  const categories = [...categoriesByKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value)
  if (categories.length === 0) return null

  return {
    categories,
    canonicalQuery: categories.map((category) => `cat:${category}`).join(' OR '),
    key: categories.map((category) => category.toLowerCase()).join('|'),
  }
}

/**
 * 把 API URL、OAI ID 或裸 ID 统一成不带版本号的 arXiv ID。
 */
export function extractBaseArxivId(value: string): string {
  let id = value.trim()
  if (!id) return ''

  try {
    id = decodeURIComponent(id)
  } catch {
    // 保留原字符串继续校验
  }

  id = id
    .replace(/^oai:arxiv\.org:/i, '')
    .replace(/^arxiv:/i, '')
    .replace(/^https?:\/\/(?:export\.)?arxiv\.org\/(?:abs|pdf)\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\.pdf$/i, '')

  const match = id.match(
    /^((?:\d{4}\.\d{4,5})|(?:[a-z][a-z0-9.\-]*\/\d{7}))(?:v\d+)?$/i
  )
  return match ? match[1] : ''
}

function textOf(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && '#text' in value) {
    return textOf((value as Record<string, unknown>)['#text'])
  }
  return ''
}

function normalizeText(value: unknown): string {
  return textOf(value).replace(/\s+/g, ' ').trim()
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function validDate(value: unknown): Date | null {
  const date = new Date(textOf(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function categoriesOf(entry: Record<string, unknown>, fallback?: string): string {
  const categories = arrayOf(entry.category)
    .map((category) => textOf(recordOf(category)['@_term']))
    .filter(Boolean)
  const primary = textOf(recordOf(entry.primary_category)['@_term'])
  if (primary && !categories.includes(primary)) categories.push(primary)
  if (categories.length === 0 && fallback) categories.push(fallback)
  return categories.join(', ')
}

function apiEntryToPaper(value: unknown): ArxivPaper | null {
  const entry = recordOf(value)
  const arxivId = extractBaseArxivId(textOf(entry.id))
  const publishedAt = validDate(entry.published)
  if (!arxivId || !publishedAt) return null

  const authors = arrayOf(entry.author)
    .map((author) => normalizeText(recordOf(author).name))
    .filter(Boolean)
    .join(', ')
  const links = arrayOf(entry.link)
  const pdfLink = links.find(
    (link) => textOf(recordOf(link)['@_type']) === 'application/pdf'
  )
  const pdfUrl =
    textOf(recordOf(pdfLink)['@_href']) || `https://arxiv.org/pdf/${arxivId}.pdf`

  return {
    arxivId,
    title: normalizeText(entry.title),
    authors,
    summary: textOf(entry.summary).trim(),
    pdfUrl,
    publishedAt,
    categories: categoriesOf(entry),
  }
}

export function parseArxivApiXml(xml: string): ArxivPaper[] {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })
  const data = parser.parse(xml)
  return arrayOf(data.feed?.entry)
    .map(apiEntryToPaper)
    .filter((paper): paper is ArxivPaper => paper !== null)
}

function rssAbstract(entry: Record<string, unknown>): string {
  const source = textOf(entry.description) || textOf(entry.summary)
  const match = source.match(/(?:^|\n|\r)\s*Abstract:\s*([\s\S]*)$/i)
  return (match ? match[1] : source).trim()
}

function rssAuthors(entry: Record<string, unknown>): string {
  return arrayOf(entry.creator)
    .map((creator) => normalizeText(creator))
    .filter(Boolean)
    .join(', ')
}

function rssEntryToPaper(
  value: unknown,
  fallbackCategory: string
): ArxivPaper | null {
  const entry = recordOf(value)
  const alternateLink = arrayOf(entry.link).find(
    (link) => textOf(recordOf(link)['@_rel']) === 'alternate'
  )
  const arxivId =
    extractBaseArxivId(textOf(entry.id)) ||
    extractBaseArxivId(textOf(recordOf(alternateLink)['@_href']))
  const publishedAt = validDate(entry.published)
  const authors = rssAuthors(entry)
  if (!arxivId || !publishedAt || !authors) return null

  return {
    arxivId,
    title: normalizeText(entry.title),
    authors,
    summary: rssAbstract(entry),
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    publishedAt,
    categories: categoriesOf(entry, fallbackCategory),
  }
}

export function parseArxivRssXml(
  xml: string,
  fallbackCategory: string
): ArxivFeedSnapshot {
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })
  const data = parser.parse(xml)
  const entries = arrayOf(data.feed?.entry)
  const papers: ArxivPaper[] = []
  let newEntries = 0
  let crossEntries = 0
  let ignoredEntries = 0
  let malformedEntries = 0

  for (const entry of entries) {
    const announceType = normalizeText(entry.announce_type).toLowerCase()
    const eligible = announceType === 'new' || announceType === 'cross'
    const knownIgnored = announceType === 'replace' || announceType === 'replace-cross'
    if (!eligible) {
      if (knownIgnored) ignoredEntries++
      else malformedEntries++
      continue
    }

    if (announceType === 'new') newEntries++
    if (announceType === 'cross') crossEntries++

    const paper = rssEntryToPaper(entry, fallbackCategory)
    if (paper) papers.push(paper)
    else malformedEntries++
  }

  return {
    papers,
    feedUpdatedAt: validDate(data.feed?.updated),
    totalEntries: entries.length,
    newEntries,
    crossEntries,
    ignoredEntries,
    malformedEntries,
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (!Number.isNaN(seconds) && seconds >= 0) return seconds * 1000

  const dateMs = Date.parse(value)
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now())
  return undefined
}

interface ArxivHttpError extends Error {
  status: number
  endpoint: string
  retryAfter?: string
  retryAfterMs?: number
}

async function toHttpError(response: Response): Promise<ArxivHttpError> {
  const body = await response.text().catch(() => '')
  const bodyPrefix = body.replace(/\s+/g, ' ').trim().slice(0, 160)
  const host = new URL(response.url || SEARCH_ENDPOINT).hostname
  const error = new Error(
    `arXiv ${host} error: ${response.status}${bodyPrefix ? ` (${bodyPrefix})` : ''}`
  ) as ArxivHttpError
  error.status = response.status
  error.endpoint = host
  error.retryAfter = response.headers.get('retry-after') || undefined
  error.retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
  return error
}

async function fetchWithBackoff(
  url: string,
  label: string,
  options: ArxivFetchOptions = {}
): Promise<Response> {
  return withRetry(
    async () => {
      const remaining = options.deadlineAt
        ? Math.max(1, options.deadlineAt - Date.now())
        : REQUEST_TIMEOUT_MS
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
      })
      if (!response.ok) throw await toHttpError(response)
      return response
    },
    {
      label,
      maxRetries: 3,
      baseDelay: 3000,
      maxDelay: 60000,
      minDelay: 3000,
      retryOnStatus: [429, 500, 502, 503, 504],
      retryOnError: (error) =>
        error instanceof TypeError ||
        (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)),
      deadlineAt: options.deadlineAt,
      beforeAttempt: options.beforeAttempt,
      onRetry: options.onRetry,
    }
  )
}

export async function fetchArxivPapers(
  query: string,
  maxResults = 50,
  dateFrom?: Date,
  dateTo?: Date,
  options: ArxivFetchOptions = {}
): Promise<ArxivPaper[]> {
  const url = buildArxivSearchUrl(query, maxResults, dateFrom, dateTo)
  const response = await fetchWithBackoff(
    url,
    `arXiv search (${normalizeLogicalQuery(query).slice(0, 30)})`,
    options
  )
  return parseArxivApiXml(await response.text())
}

export async function fetchArxivFeed(
  category: string,
  options: ArxivFetchOptions = {}
): Promise<ArxivFeedSnapshot> {
  if (!/^[a-z][a-z0-9.\-]*$/i.test(category)) {
    throw new Error(`Invalid arXiv category: ${category}`)
  }
  const response = await fetchWithBackoff(
    `${RSS_ENDPOINT}/${encodeURIComponent(category)}`,
    `arXiv feed (${category})`,
    options
  )
  return parseArxivRssXml(await response.text(), category)
}

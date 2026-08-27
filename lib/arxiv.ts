import { XMLParser } from 'fast-xml-parser'
import { withRetry } from './rate-limit'

const USER_AGENT = 'arxiv-agent/1.0 (daily paper monitor; contact: site owner)'

export interface ArxivPaper {
  arxivId: string
  title: string
  authors: string
  summary: string
  pdfUrl: string
  publishedAt: Date
  categories: string
}

export function extractBaseArxivId(id: string): string {
  const match = id.match(/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/)
  return match ? match[1].replace(/v\d+$/, '') : id
}

/**
 * 把非 200 响应转成带 Retry-After 信息的错误，供 withRetry 退避使用
 */
function toHttpError(r: Response): Error {
  const err: any = new Error(`arXiv API error: ${r.status}`)
  err.status = r.status
  const retryAfter = r.headers.get('retry-after')
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (!Number.isNaN(seconds)) {
      err.retryAfterMs = seconds * 1000
    } else {
      const dateMs = Date.parse(retryAfter)
      if (!Number.isNaN(dateMs)) {
        err.retryAfterMs = Math.max(0, dateMs - Date.now())
      }
    }
  }
  return err
}

/**
 * arXiv 请求统一带 UA + 指数退避重试（共享 IP 常触发 429）
 */
async function fetchWithBackoff(url: string, label: string): Promise<Response> {
  return withRetry(
    async () => {
      const r = await fetch(url, {
        headers: {
          // arXiv 要求客户端标识身份，缺失 UA 更容易被限流
          'User-Agent': USER_AGENT,
        },
        next: { revalidate: 0 },
      })
      if (!r.ok) throw toHttpError(r)
      return r
    },
    { label, maxRetries: 5, baseDelay: 3000, maxDelay: 60000 }
  )
}

export async function fetchArxivPapers(
  query: string,
  maxResults = 50,
  dateFrom?: Date,
  dateTo?: Date
): Promise<ArxivPaper[]> {
  let searchQuery = query

  if (dateFrom && dateTo) {
    const fromStr = formatArxivDate(dateFrom)
    const toStr = formatArxivDate(dateTo)
    const dateRange = `submittedDate:[${fromStr}+TO+${toStr}]`
    searchQuery = `(${query})+AND+${dateRange}`
  }

  const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`

  const res = await fetchWithBackoff(url, `arXiv (${query.slice(0, 30)})`)
  const xml = await res.text()
  const parser = new XMLParser({ ignoreAttributes: false })
  const data = parser.parse(xml)

  const entries = data.feed?.entry
  if (!entries) return []

  return mapEntries(Array.isArray(entries) ? entries : [entries])
}

/**
 * 抓取 arXiv 官方每日分类 feed（当日新收录论文），限流比 search API 宽松，
 * 适合纯分类监控任务；多个任务涉及同一分类时可共享同一次抓取结果。
 * 注意：feed 只包含最近一次公告的论文，无历史时间窗口。
 */
export async function fetchArxivFeed(category: string): Promise<ArxivPaper[]> {
  const res = await fetchWithBackoff(
    `https://rss.arxiv.org/atom/${category}`,
    `arXiv feed (${category})`
  )
  const xml = await res.text()
  const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true })
  const data = parser.parse(xml)

  const entries = data.feed?.entry
  if (!entries) return []

  return mapEntries(Array.isArray(entries) ? entries : [entries], category)
}

function mapEntries(entriesArray: any[], fallbackCategory?: string): ArxivPaper[] {
  return entriesArray.map((entry: any) => {
    const id = entry.id || ''
    const arxivId = extractBaseArxivId(id)

    const authors = Array.isArray(entry.author)
      ? entry.author.map((a: any) => a.name).join(', ')
      : entry.author?.name || ''

    const links = Array.isArray(entry.link)
      ? entry.link
      : entry.link
        ? [entry.link]
        : []

    const pdfLink = links.find((l: any) => l['@_type'] === 'application/pdf')
    const pdfUrl = pdfLink
      ? pdfLink['@_href']
      : `https://arxiv.org/pdf/${arxivId}.pdf`

    return {
      arxivId,
      title: entry.title?.replace(/\s+/g, ' ').trim() || '',
      authors,
      summary: entry.summary?.trim() || '',
      pdfUrl,
      publishedAt: new Date(entry.published),
      categories: categoriesOf(entry, fallbackCategory),
    }
  })
}

function categoriesOf(entry: any, fallback?: string): string {
  const cats: string[] = Array.isArray(entry.category)
    ? entry.category.map((c: any) => c['@_term'])
    : entry.category?.['@_term']
      ? [entry.category['@_term']]
      : []
  const primary = entry.primary_category?.['@_term']
  if (primary && !cats.includes(primary)) cats.push(primary)
  if (cats.length === 0 && fallback) cats.push(fallback)
  return cats.join(', ')
}

/**
 * 判断查询是否只由分类组成（如 `cat:cs.AI OR cat:cs.LG`），这类任务可走 RSS feed
 */
export function isCategoryOnlyQuery(query: string): boolean {
  const stripped = query
    .replace(/cat:[a-z][\w.\-]*/gi, '')
    .replace(/\b(OR|AND)\b/gi, '')
    .replace(/[()\s]/g, '')
  return query.trim().length > 0 && stripped.length === 0
}

/**
 * 提取查询中出现的分类名（去重）
 */
export function extractCategories(query: string): string[] {
  const matches = query.match(/cat:([a-z][\w.\-]*)/gi) || []
  return [...new Set(matches.map((m) => m.slice(4)))]
}

function cleanToken(token: string): string {
  return token.replace(/^[\s("']+|[\s)"']+$/g, '')
}

/**
 * 在本地判断一篇论文是否匹配 arXiv 查询表达式（用于合并查询后的结果分发）。
 * 支持顶层 OR / AND 及 cat:/ti:/abs:/au:/all: 条件；无法解析时返回 null，
 * 调用方应保守处理（视为匹配），避免本地启发式丢论文。
 */
export function matchesQuery(paper: ArxivPaper, query: string): boolean | null {
  const clauses = query
    .split(/\s+OR\s+/i)
    .map(cleanToken)
    .filter(Boolean)
  if (clauses.length === 0) return null

  const clauseResults: Array<boolean | null> = clauses.map((clause) => {
    const conditions = clause
      .split(/\s+AND\s+/i)
      .map(cleanToken)
      .filter(Boolean)
    if (conditions.length === 0) return null
    const results = conditions.map((c) => matchCondition(paper, c))
    if (results.some((r) => r === null)) return null
    return results.every(Boolean)
  })

  if (clauseResults.some((r) => r === null)) return null
  return clauseResults.some(Boolean)
}

function matchCondition(paper: ArxivPaper, cond: string): boolean | null {
  const m = cond.match(/^(cat|ti|abs|au|all)\s*:\s*(.+)$/i)
  const field = m ? m[1].toLowerCase() : 'all'
  const value = cleanToken(m ? m[2] : cond).toLowerCase()
  if (!value) return null

  const haystacks: Record<string, string> = {
    cat: paper.categories,
    ti: paper.title,
    abs: paper.summary,
    au: paper.authors,
    all: `${paper.title} ${paper.summary} ${paper.authors} ${paper.categories}`,
  }
  const haystack = haystacks[field]
  if (haystack === undefined) return null
  return haystack.toLowerCase().includes(value)
}

function formatArxivDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

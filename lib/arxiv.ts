import { XMLParser } from 'fast-xml-parser'
import { withRetry } from './rate-limit'

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

  const res = await withRetry(
    async () => {
      const r = await fetch(url, {
        headers: {
          // arXiv 要求客户端标识身份，缺失 UA 更容易被限流
          'User-Agent': 'arxiv-agent/1.0 (daily paper monitor; contact: site owner)',
        },
        next: { revalidate: 0 },
      })
      if (!r.ok) {
        const err: any = new Error(`arXiv API error: ${r.status}`)
        err.status = r.status
        // 解析 Retry-After 头（秒或 HTTP 日期），交给 withRetry 遵守
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
        throw err
      }
      return r
    },
    // arXiv 限流较严格（共享 IP 常触发 429），加大重试次数与退避时长
    { label: `arXiv (${query.slice(0, 30)})`, maxRetries: 5, baseDelay: 3000, maxDelay: 60000 }
  )

  const xml = await res.text()
  const parser = new XMLParser({ ignoreAttributes: false })
  const data = parser.parse(xml)

  const entries = data.feed?.entry
  if (!entries) return []

  const entriesArray = Array.isArray(entries) ? entries : [entries]

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

    const categories = Array.isArray(entry.category)
      ? entry.category.map((c: any) => c['@_term']).join(', ')
      : entry.category?.['@_term'] || ''

    return {
      arxivId,
      title: entry.title?.replace(/\s+/g, ' ').trim() || '',
      authors,
      summary: entry.summary?.trim() || '',
      pdfUrl,
      publishedAt: new Date(entry.published),
      categories,
    }
  })
}

function formatArxivDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

import { XMLParser } from 'fast-xml-parser'

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

  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) {
    throw new Error(`arXiv API error: ${res.status}`)
  }

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

export interface Paper {
  id: string
  arxivId: string
  title: string
  authors: string
  summary: string
  pdfUrl: string
  publishedAt: Date
  categories: string
  status: string
  summaryZh: string | null
  fullAnalysis: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Config {
  id: string
  key: string
  value: string
  updatedAt: Date
}

export interface TaskLog {
  id: string
  taskType: string
  status: string
  message: string | null
  meta: unknown
  createdAt: Date
}

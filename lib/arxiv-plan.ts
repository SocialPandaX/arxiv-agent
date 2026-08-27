import {
  normalizeLogicalQuery,
  parseCategoryOrQuery,
  type ArxivFeedSnapshot,
  type ArxivPaper,
} from './arxiv'

export const ARXIV_CHECKPOINT_PREFIX = 'daily_check_success:'

export interface ArxivTaskCheckpoint {
  queryKey: string
  completedAt: Date
}

export function arxivCheckpointKey(taskId: string): string {
  return `${ARXIV_CHECKPOINT_PREFIX}${taskId}`
}

export function serializeArxivCheckpoint(
  queryKey: string,
  completedAt: Date
): string {
  return JSON.stringify({ queryKey, completedAt: completedAt.toISOString() })
}

export function parseArxivCheckpoint(value: string): ArxivTaskCheckpoint | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const record = parsed as Record<string, unknown>
    if (typeof record.queryKey !== 'string' || typeof record.completedAt !== 'string') {
      return null
    }
    const completedAt = new Date(record.completedAt)
    if (Number.isNaN(completedAt.getTime())) return null
    return { queryKey: record.queryKey, completedAt }
  } catch {
    return null
  }
}

export interface ArxivTaskInput {
  id: string
  query: string
  maxResults: number
}

export interface CategoryTaskPlan {
  taskId: string
  kind: 'category'
  categories: string[]
  query: string
  key: string
  maxResults: number
}

export interface SearchTaskPlan {
  taskId: string
  kind: 'search'
  query: string
  key: string
  maxResults: number
}

export type ArxivTaskPlan = CategoryTaskPlan | SearchTaskPlan

export interface SearchGroupPlan {
  key: string
  query: string
  maxResults: number
  taskIds: string[]
}

export interface ArxivFetchPlan {
  tasks: ArxivTaskPlan[]
  categories: string[]
  searchGroups: SearchGroupPlan[]
}

export function buildArxivFetchPlan(tasks: ArxivTaskInput[]): ArxivFetchPlan {
  const plans: ArxivTaskPlan[] = []
  const categoriesByKey = new Map<string, string>()
  const searchGroups = new Map<string, SearchGroupPlan>()

  for (const task of tasks) {
    const maxResults = Math.max(1, Math.trunc(task.maxResults || 1))
    const categoryQuery = parseCategoryOrQuery(task.query)

    if (categoryQuery) {
      for (const category of categoryQuery.categories) {
        const key = category.toLowerCase()
        if (!categoriesByKey.has(key)) categoriesByKey.set(key, category)
      }
      plans.push({
        taskId: task.id,
        kind: 'category',
        categories: categoryQuery.categories,
        query: categoryQuery.canonicalQuery,
        key: `category:${categoryQuery.key}`,
        maxResults,
      })
      continue
    }

    const query = normalizeLogicalQuery(task.query)
    const key = `search:${query}`
    plans.push({ taskId: task.id, kind: 'search', query, key, maxResults })

    const group = searchGroups.get(key)
    if (group) {
      group.maxResults = Math.max(group.maxResults, maxResults)
      group.taskIds.push(task.id)
    } else {
      searchGroups.set(key, {
        key,
        query,
        maxResults,
        taskIds: [task.id],
      })
    }
  }

  return {
    tasks: plans,
    categories: [...categoriesByKey.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, category]) => category),
    searchGroups: [...searchGroups.values()],
  }
}

export function isFeedFresh(
  snapshot: ArxivFeedSnapshot,
  now: Date,
  maxAgeMs = 12 * 60 * 60 * 1000
): boolean {
  if (!snapshot.feedUpdatedAt || snapshot.malformedEntries > 0) return false
  const age = now.getTime() - snapshot.feedUpdatedAt.getTime()
  return age >= -60 * 60 * 1000 && age <= maxAgeMs
}

export function canUseRssWithoutReconciliation(
  feedsComplete: boolean,
  feedsCurrent: boolean,
  feedsWithinGrace: boolean,
  checkpoint: Date | undefined,
  now: Date,
  checkpointFreshMs = 36 * 60 * 60 * 1000
): boolean {
  if (!feedsComplete) return false
  if (!checkpoint || Number.isNaN(checkpoint.getTime())) return feedsCurrent

  const checkpointAge = now.getTime() - checkpoint.getTime()
  const checkpointFresh = checkpointAge >= 0 && checkpointAge <= checkpointFreshMs
  return checkpointFresh && feedsWithinGrace
}

/**
 * 合并多个来源后按 ID 去重、按时间窗口过滤、降序排序，再应用任务上限。
 * 调用方应把更可信的来源放在前面。
 */
export function selectPapers(
  sources: ArxivPaper[][],
  maxResults: number,
  dateFrom?: Date,
  dateTo?: Date
): ArxivPaper[] {
  const papersById = new Map<string, ArxivPaper>()
  for (const source of sources) {
    for (const paper of source) {
      if (!papersById.has(paper.arxivId)) papersById.set(paper.arxivId, paper)
    }
  }

  const fromMs = dateFrom?.getTime()
  const toMs = dateTo?.getTime()
  return [...papersById.values()]
    .filter((paper) => {
      const publishedMs = paper.publishedAt.getTime()
      if (Number.isNaN(publishedMs)) return false
      if (fromMs !== undefined && publishedMs < fromMs) return false
      if (toMs !== undefined && publishedMs > toMs) return false
      return true
    })
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, Math.max(1, Math.trunc(maxResults || 1)))
}

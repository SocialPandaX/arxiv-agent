import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  arxivCheckpointKey,
  buildArxivFetchPlan,
  canUseRssWithoutReconciliation,
  isFeedFresh,
  parseArxivCheckpoint,
  selectPapers,
  serializeArxivCheckpoint,
} from '../lib/arxiv-plan'
import type { ArxivFeedSnapshot, ArxivPaper } from '../lib/arxiv'

function paper(arxivId: string, publishedAt: string, title = arxivId): ArxivPaper {
  return {
    arxivId,
    title,
    authors: 'Author',
    summary: 'Summary',
    pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
    publishedAt: new Date(publishedAt),
    categories: 'cs.AI',
  }
}

test('plans strict category OR tasks as RSS and category AND as search', () => {
  const plan = buildArxivFetchPlan([
    { id: 'rss-a', query: 'cat:cs.LG+OR+cat:cs.CL', maxResults: 10 },
    { id: 'rss-b', query: '(cat:cs.CL OR cat:cs.LG)', maxResults: 20 },
    { id: 'and', query: 'cat:cs.AI AND cat:cs.LG', maxResults: 5 },
  ])

  assert.deepEqual(plan.categories, ['cs.CL', 'cs.LG'])
  assert.equal(plan.tasks[0].kind, 'category')
  assert.equal(plan.tasks[1].kind, 'category')
  assert.equal(plan.tasks[2].kind, 'search')
  assert.equal(plan.searchGroups.length, 1)
  assert.equal(plan.searchGroups[0].query, 'cat:cs.AI AND cat:cs.LG')
})

test('deduplicates identical normalized searches using the largest limit', () => {
  const plan = buildArxivFetchPlan([
    { id: 'a', query: 'all:agent+AND+ti:paper', maxResults: 5 },
    { id: 'b', query: 'all:agent AND ti:paper', maxResults: 30 },
    { id: 'c', query: 'au:Smith', maxResults: 10 },
  ])

  assert.equal(plan.searchGroups.length, 2)
  const shared = plan.searchGroups.find((group) => group.query === 'all:agent AND ti:paper')
  assert.equal(shared?.maxResults, 30)
  assert.deepEqual(shared?.taskIds, ['a', 'b'])
})

test('requires a recent, complete RSS snapshot', () => {
  const base: ArxivFeedSnapshot = {
    papers: [],
    feedUpdatedAt: new Date('2026-08-28T04:00:00Z'),
    totalEntries: 0,
    newEntries: 0,
    crossEntries: 0,
    ignoredEntries: 0,
    malformedEntries: 0,
  }
  const now = new Date('2026-08-28T06:00:00Z')

  assert.equal(isFeedFresh(base, now), true)
  assert.equal(
    isFeedFresh({ ...base, feedUpdatedAt: new Date('2026-08-27T08:00:00Z') }, now),
    false
  )
  assert.equal(isFeedFresh({ ...base, malformedEntries: 1 }, now), false)
})

test('binds checkpoints to the task query plan', () => {
  const completedAt = new Date('2026-08-28T06:00:00Z')
  const encoded = serializeArxivCheckpoint('category:cs.ai', completedAt)
  assert.deepEqual(parseArxivCheckpoint(encoded), {
    queryKey: 'category:cs.ai',
    completedAt,
  })
  assert.equal(parseArxivCheckpoint(completedAt.toISOString()), null)
  assert.equal(arxivCheckpointKey('task-1'), 'daily_check_success:task-1')
})

test('uses current RSS for new tasks and reconciles missed existing tasks', () => {
  const now = new Date('2026-08-28T06:00:00Z')
  assert.equal(
    canUseRssWithoutReconciliation(true, true, true, undefined, now),
    true
  )
  assert.equal(
    canUseRssWithoutReconciliation(true, false, true, undefined, now),
    false
  )
  assert.equal(
    canUseRssWithoutReconciliation(
      true,
      false,
      true,
      new Date('2026-08-27T06:00:00Z'),
      now
    ),
    true
  )
  assert.equal(
    canUseRssWithoutReconciliation(
      true,
      true,
      true,
      new Date('2026-08-26T06:00:00Z'),
      now
    ),
    false
  )
  assert.equal(
    canUseRssWithoutReconciliation(
      true,
      false,
      false,
      new Date('2026-08-28T05:00:00Z'),
      now
    ),
    false
  )
  assert.equal(
    canUseRssWithoutReconciliation(
      false,
      true,
      true,
      new Date('2026-08-28T05:00:00Z'),
      now
    ),
    false
  )
})

test('deduplicates, filters, sorts, and slices papers after merging', () => {
  const selected = selectPapers(
    [
      [
        paper('2608.00001', '2026-08-28T02:00:00Z', 'RSS copy'),
        paper('2608.00002', '2026-08-28T05:00:00Z'),
      ],
      [
        paper('2608.00001', '2026-08-28T03:00:00Z', 'API copy'),
        paper('2608.00003', '2026-08-24T03:00:00Z'),
      ],
    ],
    2,
    new Date('2026-08-26T06:00:00Z'),
    new Date('2026-08-28T06:00:00Z')
  )

  assert.deepEqual(selected.map((item) => item.arxivId), ['2608.00002', '2608.00001'])
  assert.equal(selected[1].title, 'RSS copy')
})

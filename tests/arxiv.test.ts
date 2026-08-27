import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildArxivSearchUrl,
  extractBaseArxivId,
  formatArxivDate,
  normalizeLogicalQuery,
  parseArxivApiXml,
  parseArxivRssXml,
  parseCategoryOrQuery,
} from '../lib/arxiv'

const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), 'tests', 'fixtures', name), 'utf8')

test('formats arXiv dates at UTC minute precision', () => {
  assert.equal(
    formatArxivDate(new Date('2026-08-28T06:05:59.999Z')),
    '202608280605'
  )
  assert.equal(
    formatArxivDate(new Date('2026-01-01T00:00:00.000Z')),
    '202601010000'
  )
})

test('normalizes legacy operators without damaging quoted plus signs', () => {
  assert.equal(
    normalizeLogicalQuery('cat:cs.LG+OR+cat:cs.CL'),
    'cat:cs.LG OR cat:cs.CL'
  )
  assert.equal(
    normalizeLogicalQuery('ti:"C++"+AND+cat:cs.PL'),
    'ti:"C++" AND cat:cs.PL'
  )
})

test('serializes the logical search query exactly once', () => {
  const url = new URL(
    buildArxivSearchUrl(
      'cat:cs.LG+OR+cat:cs.CL',
      25,
      new Date('2026-08-26T06:05:59Z'),
      new Date('2026-08-28T06:05:59Z')
    )
  )
  assert.equal(
    url.searchParams.get('search_query'),
    '(cat:cs.LG OR cat:cs.CL) AND submittedDate:[202608260605 TO 202608280605]'
  )
  assert.equal(url.searchParams.get('max_results'), '25')
  assert.ok(!url.searchParams.get('search_query')?.includes('+AND+'))
  assert.throws(
    () =>
      buildArxivSearchUrl(
        'cat:cs.AI',
        1,
        new Date('2026-08-29T00:00:00Z'),
        new Date('2026-08-28T00:00:00Z')
      ),
    /reversed/
  )
})

test('canonicalizes API, OAI, PDF, and legacy IDs', () => {
  assert.equal(extractBaseArxivId('https://arxiv.org/abs/2608.24886v3'), '2608.24886')
  assert.equal(extractBaseArxivId('oai:arXiv.org:2608.24886v1'), '2608.24886')
  assert.equal(extractBaseArxivId('https://arxiv.org/pdf/hep-th/9901001v2.pdf'), 'hep-th/9901001')
  assert.equal(extractBaseArxivId('not-an-id'), '')
})

test('recognizes only strict category OR queries', () => {
  const spaced = parseCategoryOrQuery('(cat:cs.LG OR cat:cs.CL)')
  const legacy = parseCategoryOrQuery('cat:cs.CL+OR+cat:cs.LG')
  assert.deepEqual(spaced, legacy)
  assert.equal(spaced?.key, 'cs.cl|cs.lg')
  assert.equal(parseCategoryOrQuery('cat:cs.AI AND cat:cs.LG'), null)
  assert.equal(parseCategoryOrQuery('cat:cs.AI ANDNOT cat:cs.LG'), null)
  assert.equal(parseCategoryOrQuery('cat:cs.AI OR ti:"agent"'), null)
  assert.equal(parseCategoryOrQuery('id:2608.12345'), null)
})

test('parses Search API Atom entries without versioned IDs', () => {
  const papers = parseArxivApiXml(fixture('arxiv-api.xml'))
  assert.equal(papers.length, 1)
  assert.deepEqual(papers[0], {
    arxivId: '2608.12345',
    title: 'A Test Paper',
    authors: 'Alice Example, Bob Example',
    summary: 'First line.\nSecond line.',
    pdfUrl: 'https://arxiv.org/pdf/2608.12345v2',
    publishedAt: new Date('2026-08-28T04:00:00Z'),
    categories: 'cs.AI, cs.LG',
  })
})

test('parses the RSS dialect and excludes replacement announcements', () => {
  const snapshot = parseArxivRssXml(fixture('arxiv-rss.xml'), 'cs.AI')
  assert.equal(snapshot.totalEntries, 6)
  assert.equal(snapshot.newEntries, 2)
  assert.equal(snapshot.crossEntries, 1)
  assert.equal(snapshot.ignoredEntries, 2)
  assert.equal(snapshot.malformedEntries, 2)
  assert.equal(snapshot.feedUpdatedAt?.toISOString(), '2026-08-28T04:00:23.000Z')
  assert.equal(snapshot.papers.length, 2)

  const paper = snapshot.papers[0]
  assert.equal(paper.arxivId, '2608.24886')
  assert.equal(paper.authors, 'Alice RSS, Bob RSS')
  assert.equal(paper.summary, 'This is the clean abstract.')
  assert.equal(paper.pdfUrl, 'https://arxiv.org/pdf/2608.24886.pdf')
  assert.equal(paper.categories, 'cs.AI')
  assert.ok(snapshot.papers.some((item) => item.arxivId === '2501.00001'))
  assert.ok(!snapshot.papers.some((item) => item.arxivId === '2401.00001'))
})

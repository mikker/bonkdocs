import test from 'brittle'
import {
  saveDocState,
  clearDocState,
  loadDocState
} from '../renderer/src/state/doc-persistence.js'
import { mergeDocsWithCachedMetadata } from '../renderer/src/state/doc-cache.js'

test('mergeDocsWithCachedMetadata hydrates titles and revisions', (t) => {
  const key = 'doc-merge-test'
  clearDocState(key)

  saveDocState(key, {
    revision: 9,
    snapshotText: JSON.stringify({ type: 'doc', content: [] }),
    snapshotHash: 'hash-merge-1',
    pending: [],
    title: 'Cached Title',
    updatedAt: 1111
  })

  const docs = [
    {
      key,
      title: 'Server Title',
      lastRevision: 1,
      lastOpenedAt: 5
    }
  ]

  const merged = mergeDocsWithCachedMetadata(docs)
  t.is(merged.length, 1)

  const doc = merged[0]
  t.is(doc.title, 'Cached Title')
  t.is(doc.lastRevision, 9)
  t.is(doc.lastOpenedAt, 1111)

  clearDocState(key)
})

test('mergeDocsWithCachedMetadata leaves untouched docs without cache', (t) => {
  const docs = [
    {
      key: 'untracked',
      title: 'Original',
      lastRevision: 2,
      lastOpenedAt: 3
    }
  ]

  const merged = mergeDocsWithCachedMetadata(docs)
  t.alike(merged, docs)
})

test('mergeDocsWithCachedMetadata ignores falsy titles', (t) => {
  const key = 'doc-empty-title'
  clearDocState(key)

  saveDocState(key, {
    revision: 4,
    snapshotText: JSON.stringify({ type: 'doc', content: [] }),
    snapshotHash: 'hash-merge-2',
    pending: [],
    title: '',
    updatedAt: 2222
  })

  const docs = [
    {
      key,
      title: 'Keep Title',
      lastRevision: 1,
      lastOpenedAt: 1
    }
  ]

  const merged = mergeDocsWithCachedMetadata(docs)
  t.is(merged[0].title, 'Keep Title')
  t.is(merged[0].lastOpenedAt, 2222)

  const cached = loadDocState(key)
  t.is(cached.title, '')

  clearDocState(key)
})

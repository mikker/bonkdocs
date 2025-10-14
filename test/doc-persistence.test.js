import test from 'brittle'
import {
  loadDocState,
  saveDocState,
  clearDocState
} from '../renderer/src/state/doc-persistence.js'

test('doc persistence stores and clears state', (t) => {
  clearDocState('persist-test')
  t.is(loadDocState('persist-test'), null)

  const entry = {
    revision: 5,
    snapshotText: JSON.stringify({ type: 'doc', content: [] }),
    snapshotHash: 'hash-123',
    pending: [{ rev: 6 }],
    title: 'Persisted Title',
    updatedAt: 123456
  }

  saveDocState('persist-test', entry)

  const loaded = loadDocState('persist-test')
  t.ok(loaded)
  if (!loaded) return

  t.is(loaded.revision, entry.revision)
  t.is(loaded.snapshotText, entry.snapshotText)
  t.is(loaded.snapshotHash, entry.snapshotHash)
  t.is(Array.isArray(loaded.pending), true)
  t.is(loaded.pending.length, 1)
  t.is(loaded.title, entry.title)
  t.is(loaded.updatedAt, entry.updatedAt)

  clearDocState('persist-test')
  t.is(loadDocState('persist-test'), null)
})

test('doc persistence ignores invalid entries', (t) => {
  clearDocState('persist-invalid')

  // Save malformed entry missing snapshotText
  saveDocState('persist-invalid', {
    revision: 1,
    snapshotHash: null,
    pending: []
  })

  t.is(loadDocState('persist-invalid'), null)
  clearDocState('persist-invalid')
})

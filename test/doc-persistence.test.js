import test from 'brittle'
import {
  loadLastDocKey,
  saveLastDocKey
} from '../renderer/src/state/doc-persistence.js'

test('last doc key storage is persisted and cleared', (t) => {
  const key = 'last-doc-test'
  saveLastDocKey(null)
  t.is(loadLastDocKey(), null)

  saveLastDocKey(key)
  t.is(loadLastDocKey(), key)

  saveLastDocKey(null)
  t.is(loadLastDocKey(), null)
})

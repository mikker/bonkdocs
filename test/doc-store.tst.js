import test from 'brittle'
import * as Y from 'yjs'
import { useDocStore } from '../renderer/src/state/doc-store.ts'
import { setRpcClient } from '../renderer/src/lib/rpc.ts'
import {
  createRpcMock,
  flushMicrotasks,
  resetDocStoreState
} from './helpers/doc-store-mock.js'

test('doc store applies syncUpdate to Y.Doc', async (t) => {
  const doc = {
    key: 'doc-sync',
    title: 'Sync Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: doc.key
  })

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()
  for (let attempt = 0; attempt < 20 && mock.getWatchCount() === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  const ydoc = new Y.Doc()
  ydoc.getText('body').insert(0, 'hello')
  const update = Y.encodeStateAsUpdate(ydoc)

  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: 1,
    syncUpdate: update,
    updatedAt: Date.now()
  })

  await flushMicrotasks()

  let current = null
  let text = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    current = useDocStore.getState().currentUpdate
    text = current?.doc.getText('body').toString() ?? ''
    if (text === 'hello') break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  t.ok(current, 'currentUpdate present')
  t.is(text, 'hello')

  mock.destroyAll()
  resetDocStoreState()
})

test('doc store sends applyUpdates on local edits', async (t) => {
  const doc = {
    key: 'doc-edit',
    title: 'Edit Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: doc.key
  })

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()

  const current = useDocStore.getState().currentUpdate
  t.ok(current, 'currentUpdate present')
  current?.doc.getText('body').insert(0, 'local')

  await new Promise((resolve) => setTimeout(resolve, 100))

  t.ok(
    mock.getApplyUpdatesCalls().length > 0,
    'applyUpdates called after local edit'
  )

  mock.destroyAll()
  resetDocStoreState()
})

test('doc store hydrates Facebonk avatar into local presence', async (t) => {
  const mock = createRpcMock()

  mock.setIdentity(
    {
      identityKey: 'facebonk-identity',
      writerKey: 'facebonk-writer',
      profile: {
        displayName: 'Avatar Bonk',
        bio: 'Has a profile image',
        avatarDataUrl: 'data:image/png;base64,ZmFrZS1hdmF0YXI='
      }
    }
  )

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()

  const state = useDocStore.getState()
  t.is(state.identity?.profile?.avatarDataUrl, 'data:image/png;base64,ZmFrZS1hdmF0YXI=')
  t.is(state.localUser.name, 'Avatar Bonk')
  t.is(state.localUser.avatarDataUrl, 'data:image/png;base64,ZmFrZS1hdmF0YXI=')

  mock.destroyAll()
  resetDocStoreState()
})

test('doc store resets Facebonk identity locally', async (t) => {
  const mock = createRpcMock()

  mock.setIdentity(
    {
      identityKey: 'facebonk-identity',
      writerKey: 'facebonk-writer',
      profile: {
        displayName: 'Avatar Bonk',
        avatarDataUrl: 'data:image/png;base64,ZmFrZS1hdmF0YXI='
      }
    }
  )

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()
  await useDocStore.getState().resetIdentity()

  const state = useDocStore.getState()
  t.is(state.identity, null)
  t.is(state.localUser.key, '')
  t.is(state.localUser.avatarDataUrl, null)

  mock.destroyAll()
  resetDocStoreState()
})

test('doc store rejects invalid Facebonk profile tokens', async (t) => {
  const mock = createRpcMock()

  mock.setLinkIdentityHandler(async () => {
    throw new Error('Invalid Facebonk profile token')
  })

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  let error = null

  try {
    await useDocStore.getState().linkIdentity('not-a-profile-token')
  } catch (err) {
    error = err
  }

  t.ok(error instanceof Error, 'linking rejects with an error')
  t.is(error?.message, 'Invalid Facebonk profile token')

  const state = useDocStore.getState()
  t.is(state.linkingIdentity, false, 'linking state resets after failure')
  t.is(state.identityError, 'Invalid Facebonk profile token')
  t.is(state.error, 'Invalid Facebonk profile token')

  mock.destroyAll()
  resetDocStoreState()
})

test('doc store links Facebonk profile tokens', async (t) => {
  const mock = createRpcMock()

  mock.setLinkIdentityHandler(async () => ({
    identity: {
      identityKey: 'facebonk-identity',
      writerKey: 'facebonk-writer',
      profile: {
        displayName: 'Avatar Wait',
        avatarMimeType: 'image/png',
        avatarDataUrl: 'data:image/png;base64,ZmFrZS1hdmF0YXI='
      }
    }
  }))

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().linkIdentity('facebonk-profile:abc123')

  const state = useDocStore.getState()
  t.is(state.linkingIdentity, false, 'linking state clears after avatar timeout')
  t.is(state.identity?.identityKey, 'facebonk-identity')
  t.is(state.identity?.profile?.displayName, 'Avatar Wait')
  t.is(state.identity?.profile?.avatarDataUrl, 'data:image/png;base64,ZmFrZS1hdmF0YXI=')
  t.is(state.localUser.avatarDataUrl, 'data:image/png;base64,ZmFrZS1hdmF0YXI=')
  t.is(state.identityError, null)

  mock.destroyAll()
  resetDocStoreState()
})

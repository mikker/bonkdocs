import test from 'brittle'
import { useDocStore } from '../renderer/src/state/doc-store.ts'
import { setRpcClient } from '../renderer/src/lib/rpc.ts'
import {
  saveDocState,
  clearDocState
} from '../renderer/src/state/doc-persistence.js'
import {
  createRpcMock,
  flushMicrotasks,
  resetDocStoreState
} from './helpers/doc-store-mock.js'

test('doc store reselects doc after applyOps mismatch', async (t) => {
  const doc = {
    key: 'doc-mismatch',
    title: 'Server Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: doc.key
  })

  mock.setApplyOpsHandler(async () => ({
    accepted: false,
    reason: 'SNAPSHOT_MISMATCH'
  }))

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()

  t.is(mock.getWatchCount(), 1)

  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: 1,
    snapshotRevision: 1,
    snapshot: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'hello' }]
        }
      ]
    },
    updatedAt: Date.now()
  })

  const updateBefore = useDocStore.getState().currentUpdate
  t.is(updateBefore?.revision, 1)

  await useDocStore.getState().applySnapshot(doc.key, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'mismatch' }]
      }
    ]
  })

  await flushMicrotasks()

  t.is(mock.getWatchCount(), 2, 'selectDoc retriggers watchDoc')
  t.is(
    useDocStore.getState().pendingOps[doc.key]?.length ?? 0,
    0,
    'pending ops cleared'
  )
  t.is(useDocStore.getState().error, 'SNAPSHOT_MISMATCH')

  mock.destroyAll()
  resetDocStoreState()
})

test('doc store queues applyOps requests per document', async (t) => {
  const doc = {
    key: 'doc-queue',
    title: 'Queued Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: doc.key
  })

  let callCount = 0
  let releaseFirst
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve
  })

  mock.setApplyOpsHandler(async (request = {}) => {
    callCount++
    if (callCount === 1) {
      await firstGate
    }
    return {
      accepted: true,
      revision: request?.ops?.[0]?.rev ?? 0
    }
  })

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()
  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: 1,
    snapshotRevision: 1,
    snapshot: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '' }]
        }
      ]
    },
    updatedAt: Date.now()
  })

  const firstApply = useDocStore.getState().applySnapshot(doc.key, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'one' }]
      }
    ]
  })

  const secondApply = useDocStore.getState().applySnapshot(doc.key, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'two' }]
      }
    ]
  })

  await flushMicrotasks()
  t.is(
    mock.getApplyOpsCalls().length,
    1,
    'second applyOps waits for first request to resolve'
  )

  if (releaseFirst) {
    releaseFirst()
  }
  await flushMicrotasks()

  await firstApply
  await secondApply

  const calls = mock.getApplyOpsCalls()
  t.is(calls.length, 2, 'both applyOps calls eventually execute')
  t.is(calls[0].ops[0].baseRev, 1, 'first call uses starting revision')
  t.is(calls[1].ops[0].baseRev, 2, 'second call chains from first revision')

  mock.destroyAll()
  resetDocStoreState()
})

test('doc store keeps up with rapid local snapshots', async (t) => {
  const doc = {
    key: 'doc-burst',
    title: 'Burst Doc',
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
  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: 1,
    snapshotRevision: 1,
    snapshot: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'seed' }]
        }
      ]
    },
    updatedAt: Date.now()
  })

  const burstCount = 50
  const applyPromises = []
  for (let i = 0; i < burstCount; i++) {
    const text = `burst-${i + 1}`
    applyPromises.push(
      useDocStore.getState().applySnapshot(doc.key, {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text }]
          }
        ]
      })
    )
  }

  await Promise.all(applyPromises)

  const calls = mock.getApplyOpsCalls()
  const flattened = calls.flatMap((entry) =>
    Array.isArray(entry?.ops) ? entry.ops : []
  )
  const revs = flattened.map((op) => op.rev)
  const startRev = 1
  t.is(revs.length, burstCount, 'sent all revisions')
  const expectedRevs = Array.from(
    { length: burstCount },
    (_, index) => startRev + index + 1
  )
  t.alike(revs, expectedRevs, 'revisions remain contiguous')

  const state = useDocStore.getState()
  t.is(
    state.pendingOps[doc.key]?.length ?? 0,
    0,
    'pending operations drained after burst'
  )
  const latest =
    state.currentUpdate?.snapshot?.content?.[0]?.content?.[0]?.text ?? ''
  t.is(latest, `burst-${burstCount}`, 'latest snapshot available locally')

  mock.destroyAll()
  resetDocStoreState()
})

test('reselecting the same doc preserves current snapshot until refresh lands', async (t) => {
  const doc = {
    key: 'doc-reselect',
    title: 'Reselect Doc',
    lastRevision: 2,
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
  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: 2,
    snapshotRevision: 2,
    snapshot: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'keep-me' }]
        }
      ]
    },
    updatedAt: Date.now()
  })

  const before = useDocStore.getState().currentUpdate
  t.ok(before, 'currentUpdate set after initial watch')
  t.is(before?.snapshot?.content?.[0]?.content?.[0]?.text, 'keep-me')

  await useDocStore.getState().selectDoc(doc.key)
  t.is(mock.getWatchCount(), 2, 'watchDoc reattached')

  const during = useDocStore.getState().currentUpdate
  t.ok(during, 'currentUpdate preserved while reselecting same doc')
  t.is(
    during?.snapshot?.content?.[0]?.content?.[0]?.text,
    'keep-me',
    'snapshot kept while waiting for refresh'
  )

  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: 3,
    snapshotRevision: 3,
    snapshot: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'next' }]
        }
      ]
    },
    updatedAt: Date.now()
  })

  const after = useDocStore.getState().currentUpdate
  t.is(after?.revision, 3, 'snapshot updated after refresh lands')
  t.is(
    after?.snapshot?.content?.[0]?.content?.[0]?.text,
    'next',
    'snapshot replaced with new server state'
  )

  mock.destroyAll()
  resetDocStoreState()
})

test('renameDoc updates title and calls rpc rename', async (t) => {
  const doc = {
    key: 'doc-rename',
    title: 'Original Title',
    lastRevision: 3,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: doc.key
  })

  const renamedAt = Date.now() + 10

  mock.setRenameDocHandler(async (request = {}) => ({
    key: request.key,
    title: request.title || 'Untitled document',
    updatedAt: renamedAt
  }))

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()
  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: doc.lastRevision,
    snapshotRevision: doc.lastRevision,
    snapshot: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }]
    },
    title: doc.title,
    updatedAt: doc.lastOpenedAt
  })

  await useDocStore.getState().renameDoc(doc.key, 'Renamed Document')

  const renameCalls = mock.getRenameDocCalls()
  t.is(renameCalls.length, 1, 'renameDoc called exactly once')
  t.is(renameCalls[0].key, doc.key)
  t.is(renameCalls[0].title, 'Renamed Document')

  const state = useDocStore.getState()
  const renamedDoc = state.docs.find((entry) => entry.key === doc.key)
  t.ok(renamedDoc, 'doc still present after rename')
  t.is(renamedDoc?.title, 'Renamed Document')
  t.is(state.currentUpdate?.title, 'Renamed Document')
  t.is(state.currentUpdate?.updatedAt, renamedAt)

  mock.destroyAll()
  resetDocStoreState()
})

test('doc store drops pending ops once revision is confirmed', async (t) => {
  const doc = {
    key: 'doc-pending',
    title: 'Pending Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: doc.key
  })

  let applyCalled = false
  mock.setApplyOpsHandler(async () => {
    applyCalled = true
    return { accepted: true, revision: 2 }
  })

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()
  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: 1,
    snapshotRevision: 1,
    snapshot: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]
    },
    updatedAt: Date.now()
  })

  await useDocStore.getState().applySnapshot(doc.key, {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'change' }]
      }
    ]
  })

  t.ok(applyCalled, 'applyOps called')
  const pendingAfterApply = useDocStore.getState().pendingOps[doc.key] ?? []
  t.is(pendingAfterApply.length, 1, 'pending op stored optimistically')

  mock.emitUpdate(doc.key, {
    key: doc.key,
    revision: 2,
    snapshotRevision: 2,
    ops: [
      {
        rev: 2,
        data: JSON.stringify({
          type: 'delta',
          version: 1,
          baseHash: pendingAfterApply[0].delta.baseHash,
          nextHash: pendingAfterApply[0].delta.nextHash,
          steps: pendingAfterApply[0].delta.steps
        })
      }
    ],
    snapshot: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'change' }]
        }
      ]
    },
    updatedAt: Date.now()
  })

  t.is(
    useDocStore.getState().pendingOps[doc.key]?.length ?? 0,
    0,
    'pending ops cleared after server confirmation'
  )
  t.is(useDocStore.getState().currentUpdate?.revision, 2)

  mock.destroyAll()
  resetDocStoreState()
})

test('selectDoc preloads cached title immediately', async (t) => {
  const key = 'doc-cached'
  clearDocState(key)
  saveDocState(key, {
    revision: 3,
    snapshotText: JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'cached-body' }] }
      ]
    }),
    snapshotHash: 'hash-cached',
    pending: [],
    title: 'Cached Sidebar Title',
    updatedAt: 1234
  })

  const doc = {
    key,
    title: null,
    lastRevision: 1,
    lastOpenedAt: null
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: key
  })

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().initialize()

  const state = useDocStore.getState()
  const hydratedDoc = state.docs.find((entry) => entry.key === key)
  t.is(hydratedDoc?.title, 'Cached Sidebar Title')
  t.is(state.currentUpdate?.title, 'Cached Sidebar Title')
  t.is(state.currentUpdate?.revision, 3)

  mock.destroyAll()
  clearDocState(key)
  resetDocStoreState()
})

test('loadInvites stores active doc invites', async (t) => {
  const docKey = 'doc-invite-load'
  const doc = {
    key: docKey,
    title: 'Load Invites Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: docKey
  })

  const now = Date.now()
  mock.setInvites(docKey, [
    {
      id: 'invite-a',
      invite: 'code-invite-a',
      roles: ['doc-viewer'],
      createdAt: now
    }
  ])

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  useDocStore.setState({ docs: [doc], activeDoc: docKey })

  await useDocStore.getState().loadInvites(docKey)

  const invites = useDocStore.getState().invites[docKey]
  t.ok(Array.isArray(invites))
  t.is(invites.length, 1)
  t.ok(invites[0].roles.includes('doc-viewer'))

  mock.destroyAll()
  resetDocStoreState()
})

test('createDocInvite ensures read role is always included', async (t) => {
  const docKey = 'doc-invite-create'
  const doc = {
    key: docKey,
    title: 'Create Invite Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: docKey
  })

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  useDocStore.setState({ docs: [doc], activeDoc: docKey })

  await useDocStore.getState().createDocInvite({ roles: ['doc-editor'] })

  const stored = mock.getInvites(docKey)
  t.is(stored.length, 1)
  t.ok(stored[0].roles.includes('doc-viewer'))
  t.ok(stored[0].roles.includes('doc-editor'))

  mock.destroyAll()
  resetDocStoreState()
})

test('revokeDocInvite refreshes invites list', async (t) => {
  const docKey = 'doc-invite-revoke'
  const doc = {
    key: docKey,
    title: 'Revoke Invite Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const initialInvites = [
    {
      id: 'invite-1',
      invite: 'code-1',
      roles: ['doc-viewer'],
      createdAt: Date.now()
    },
    {
      id: 'invite-2',
      invite: 'code-2',
      roles: ['doc-viewer', 'doc-editor'],
      createdAt: Date.now()
    }
  ]

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: docKey
  })
  mock.setInvites(docKey, initialInvites)

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  useDocStore.setState({ docs: [doc], activeDoc: docKey })

  await useDocStore.getState().loadInvites(docKey)
  await useDocStore.getState().revokeDocInvite({ inviteId: 'invite-1' })

  const invites = useDocStore.getState().invites[docKey]
  t.is(invites.length, 1)
  t.is(invites[0].id, 'invite-2')

  mock.destroyAll()
  resetDocStoreState()
})

test('joinDoc adds the new document and selects it', async (t) => {
  const mock = createRpcMock()
  const now = Date.now()
  const joinedDoc = {
    key: 'joined-doc-key',
    title: 'Joined Doc',
    encryptionKey: 'enc-joined',
    createdAt: now,
    joinedAt: now,
    isCreator: false,
    lastRevision: 0,
    lastOpenedAt: now
  }

  mock.setPairInviteHandler((request, stream) => {
    stream.emit('data', {
      state: 'pairing',
      message: 'Resolving invite',
      progress: 10
    })
    stream.emit('data', {
      state: 'joined',
      message: 'Joined document',
      progress: 100,
      doc: joinedDoc
    })
    stream.emit('close')
  })

  setRpcClient(mock.rpc)
  t.teardown(() => {
    setRpcClient(null)
  })
  resetDocStoreState()

  await useDocStore.getState().joinDoc('invite-code-123')

  t.is(mock.getPairInviteCalls(), 1)
  const state = useDocStore.getState()
  t.is(state.activeDoc, joinedDoc.key)
  t.ok(state.docs.some((doc) => doc.key === joinedDoc.key))

  mock.destroyAll()
  resetDocStoreState()
})

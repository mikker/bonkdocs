import test from 'brittle'
import { EventEmitter } from 'events'
import { useDocStore } from '../renderer/src/state/doc-store.ts'
import { setRpcClient } from '../renderer/src/lib/rpc.ts'
import {
  saveDocState,
  clearDocState
} from '../renderer/src/state/doc-persistence.js'

function createMockStream() {
  const emitter = new EventEmitter()
  emitter.destroyed = false
  emitter.destroy = () => {
    if (emitter.destroyed) return
    emitter.destroyed = true
    emitter.emit('close')
  }
  return emitter
}

function createRpcMock({ docs = [], activeDoc = null } = {}) {
  let docsResponse = docs
  let activeDocKey = activeDoc
  let applyOpsHandler = async () => ({ accepted: true })
  const applyOpsCalls = []
  let watchDocCalls = 0
  const watchers = new Map()
  const invitesByKey = new Map()
  let listInvitesCalls = 0
  let joinDocHandler = async (request = {}) => {
    if (!request?.invite) {
      throw new Error('Invite required')
    }
    const key = `joined-${request.invite}`
    const now = Date.now()
    const doc = {
      key,
      title: `Joined ${request.invite}`,
      encryptionKey: `enc-${key}`,
      createdAt: now,
      joinedAt: now,
      isCreator: false,
      lastRevision: 0,
      lastOpenedAt: now
    }
    docsResponse = [
      doc,
      ...docsResponse.filter((entry) => entry.key !== doc.key)
    ]
    return { doc, writerKey: 'writer-key' }
  }
  let joinDocCalls = 0
  let pairInviteHandler = (request = {}, stream) => {
    pairInviteCalls++
    const now = Date.now()
    const doc = {
      key: `paired-${request.invite ?? 'unknown'}`,
      encryptionKey: 'enc-paired',
      createdAt: now,
      joinedAt: now,
      isCreator: false,
      title: `Paired ${request.invite ?? ''}`,
      lastRevision: 0,
      lastOpenedAt: now
    }
    stream.emit('data', {
      state: 'pairing',
      message: 'Resolving invite',
      progress: 10
    })
    stream.emit('data', {
      state: 'joined',
      message: 'Joined document',
      progress: 100,
      doc
    })
    stream.emit('close')
  }
  let pairInviteCalls = 0

  function rememberWatcher(key, stream) {
    if (!watchers.has(key)) {
      watchers.set(key, [])
    }
    watchers.get(key).push(stream)
  }

  const rpc = {
    async initialize() {
      return { docs: docsResponse, activeDoc: activeDocKey }
    },
    async listDocs() {
      return { docs: docsResponse }
    },
    watchDoc(request = {}) {
      watchDocCalls++
      const stream = createMockStream()
      rememberWatcher(request.key, stream)
      return stream
    },
    async applyOps(request = {}) {
      applyOpsCalls.push(request)
      return await applyOpsHandler(request)
    },
    async joinDoc(request = {}) {
      joinDocCalls++
      return await joinDocHandler(request)
    },
    pairInvite(request = {}) {
      const stream = createMockStream()
      setImmediate(() => {
        pairInviteHandler(request, stream)
      })
      return stream
    },
    async listInvites(request = {}) {
      if (!request?.key) {
        throw new Error('Doc key is required to list invites')
      }
      listInvitesCalls++
      return { invites: invitesByKey.get(request.key) ?? [] }
    },
    async createInvite(request = {}) {
      if (!request?.key) {
        throw new Error('Doc key is required to create invite')
      }
      const roles = Array.isArray(request.roles) ? request.roles : []
      const inviteId = `invite-${Math.random().toString(16).slice(2)}`
      const inviteCode = `code-${inviteId}`
      const record = {
        id: inviteId,
        invite: inviteCode,
        roles,
        createdAt: Date.now()
      }
      const existing = invitesByKey.get(request.key) ?? []
      invitesByKey.set(request.key, [...existing, record])
      return { invite: inviteCode, inviteId }
    },
    async revokeInvite(request = {}) {
      if (!request?.key) {
        throw new Error('Doc key is required to revoke invite')
      }
      if (!request?.inviteId) {
        throw new Error('Invite id is required to revoke invite')
      }
      const existing = invitesByKey.get(request.key) ?? []
      const next = existing.filter((entry) => entry.id !== request.inviteId)
      const revoked = next.length !== existing.length
      invitesByKey.set(request.key, next)
      return { revoked }
    }
  }

  return {
    rpc,
    setDocs(nextDocs, nextActive = activeDocKey) {
      docsResponse = nextDocs
      activeDocKey = nextActive
    },
    setApplyOpsHandler(fn) {
      applyOpsHandler = fn
    },
    emitUpdate(key, payload) {
      const streams = watchers.get(key) || []
      for (const stream of streams) {
        if (!stream.destroyed) {
          stream.emit('data', payload)
        }
      }
    },
    getWatchCount() {
      return watchDocCalls
    },
    getApplyOpsCalls() {
      return applyOpsCalls
    },
    setJoinDocHandler(fn) {
      joinDocHandler = fn
    },
    setPairInviteHandler(fn) {
      pairInviteHandler = fn
    },
    getJoinDocCalls() {
      return joinDocCalls
    },
    getPairInviteCalls() {
      return pairInviteCalls
    },
    setInvites(key, invites = []) {
      invitesByKey.set(key, invites)
    },
    getInvites(key) {
      return invitesByKey.get(key) ?? []
    },
    getListInvitesCalls() {
      return listInvitesCalls
    },
    destroyAll() {
      for (const streams of watchers.values()) {
        for (const stream of streams) {
          stream.destroy()
        }
      }
    }
  }
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function resetStoreState() {
  useDocStore.setState({
    docs: [],
    activeDoc: null,
    currentUpdate: null,
    loading: false,
    error: null,
    watcher: null,
    pendingOps: {},
    invites: {},
    invitesLoading: false,
    invitesError: null
  })
}

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
  resetStoreState()

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
  resetStoreState()
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
  resetStoreState()

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
  resetStoreState()
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
  resetStoreState()

  await useDocStore.getState().initialize()

  const state = useDocStore.getState()
  const hydratedDoc = state.docs.find((entry) => entry.key === key)
  t.is(hydratedDoc?.title, 'Cached Sidebar Title')
  t.is(state.currentUpdate?.title, 'Cached Sidebar Title')
  t.is(state.currentUpdate?.revision, 3)

  mock.destroyAll()
  clearDocState(key)
  resetStoreState()
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
  resetStoreState()

  useDocStore.setState({ docs: [doc], activeDoc: docKey })

  await useDocStore.getState().loadInvites(docKey)

  const invites = useDocStore.getState().invites[docKey]
  t.ok(Array.isArray(invites))
  t.is(invites.length, 1)
  t.ok(invites[0].roles.includes('doc-viewer'))

  mock.destroyAll()
  resetStoreState()
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
  resetStoreState()

  useDocStore.setState({ docs: [doc], activeDoc: docKey })

  await useDocStore.getState().createDocInvite({ roles: ['doc-editor'] })

  const stored = mock.getInvites(docKey)
  t.is(stored.length, 1)
  t.ok(stored[0].roles.includes('doc-viewer'))
  t.ok(stored[0].roles.includes('doc-editor'))

  mock.destroyAll()
  resetStoreState()
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
  resetStoreState()

  useDocStore.setState({ docs: [doc], activeDoc: docKey })

  await useDocStore.getState().loadInvites(docKey)
  await useDocStore.getState().revokeDocInvite({ inviteId: 'invite-1' })

  const invites = useDocStore.getState().invites[docKey]
  t.is(invites.length, 1)
  t.is(invites[0].id, 'invite-2')

  mock.destroyAll()
  resetStoreState()
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
  resetStoreState()

  await useDocStore.getState().joinDoc('invite-code-123')

  t.is(mock.getPairInviteCalls(), 1)
  const state = useDocStore.getState()
  t.is(state.activeDoc, joinedDoc.key)
  t.ok(state.docs.some((doc) => doc.key === joinedDoc.key))

  mock.destroyAll()
  resetStoreState()
})

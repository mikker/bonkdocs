import { EventEmitter } from 'events'
import {
  destroyAllSessions,
  useDocStore
} from '../../renderer/src/state/doc-store.ts'

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

export function createRpcMock({ docs = [], activeDoc = null } = {}) {
  let docsResponse = docs
  let activeDocKey = activeDoc
  let identityResponse = null
  let identityAvatarResponse = null
  let applyUpdatesHandler = async () => ({ accepted: true })
  const applyUpdatesCalls = []
  let applyAwarenessHandler = async () => ({ accepted: true })
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
  let pairInviteCalls = 0
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
  const renameDocCalls = []
  let renameDocHandler = async (request = {}) => ({
    key: request.key,
    title: request.title || 'Untitled document',
    updatedAt: Date.now()
  })

  function rememberWatcher(key, stream) {
    if (!watchers.has(key)) {
      watchers.set(key, [])
    }
    watchers.get(key).push(stream)
  }

  const rpc = {
    async initialize() {
      return {
        docs: docsResponse,
        activeDoc: activeDocKey,
        identity: identityResponse
      }
    },
    async getIdentity() {
      return { identity: identityResponse }
    },
    async getIdentityAvatar() {
      return { avatar: identityAvatarResponse }
    },
    async linkIdentity() {
      return { identity: identityResponse }
    },
    async resetIdentity() {
      identityResponse = null
      identityAvatarResponse = null
      return { reset: true }
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
    async applyUpdates(request = {}) {
      applyUpdatesCalls.push(request)
      return await applyUpdatesHandler(request)
    },
    async applyAwareness(request = {}) {
      return await applyAwarenessHandler(request)
    },
    async renameDoc(request = {}) {
      renameDocCalls.push(request)
      return await renameDocHandler(request)
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
    setIdentity(identity, avatar = null) {
      identityResponse = identity
      identityAvatarResponse = avatar
    },
    setApplyUpdatesHandler(fn) {
      applyUpdatesHandler = fn
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
    getApplyUpdatesCalls() {
      return applyUpdatesCalls
    },
    setApplyAwarenessHandler(fn) {
      applyAwarenessHandler = fn
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
    getRenameDocCalls() {
      return renameDocCalls
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
    setRenameDocHandler(fn) {
      renameDocHandler = fn
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

export async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

export function resetDocStoreState(overrides = {}) {
  destroyAllSessions()
  useDocStore.setState({
    docs: [],
    activeDoc: null,
    currentUpdate: null,
    identity: null,
    loading: false,
    error: null,
    watcher: null,
    localUser: {
      name: '',
      color: '#94a3b8',
      key: '',
      avatarDataUrl: null
    },
    linkingIdentity: false,
    resettingIdentity: false,
    identityError: null,
    invites: {},
    invitesLoading: false,
    invitesError: null,
    ...overrides
  })
}

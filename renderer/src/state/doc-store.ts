import { create } from 'zustand'
import { getRpc } from '../lib/rpc.ts'
import { loadLastDocKey, saveLastDocKey } from './doc-persistence.js'
import { DEFAULT_TITLE } from '../constants.ts'
import { toUint8Array } from '../lib/codec.ts'
import { colorFromKey } from '../lib/user-colors.ts'
import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate
} from 'y-protocols/awareness'

type DocCapabilities = {
  canEdit?: boolean
  canComment?: boolean
  canInvite?: boolean
  roles?: string[]
}

type DocInvite = {
  id: string
  invite: string
  roles: string[]
  createdBy?: string
  createdAt?: number
  revokedAt?: number
  expiresAt?: number
}

type RawDocUpdate = {
  key?: string
  revision?: number
  writerKey?: string | null
  updatedAt?: number
  title?: string | null
  syncUpdate?: unknown
  updates?: Array<Record<string, unknown>>
  awareness?: unknown
  capabilities?: DocCapabilities | null
  lockedAt?: number | null
  lockedBy?: string | null
  [key: string]: unknown
}

type DocRecord = {
  key: string
  encryptionKey: string
  createdAt: number
  joinedAt?: number | null
  isCreator?: boolean
  title?: string | null
  lastRevision?: number | null
  lastOpenedAt?: number | null
  lockedAt?: number | null
  lockedBy?: string | null
}

type DocUpdate = {
  key: string
  revision: number
  updatedAt?: number
  title?: string | null
  doc: Y.Doc
  awareness: Awareness
  capabilities?: DocCapabilities | null
  lockedAt?: number | null
  lockedBy?: string | null
}

type DocWatcher = {
  stop: (() => Promise<void> | void) | null
}

export type DocPairStatus = {
  state: string
  message?: string | null
  progress?: number | null
  doc?: DocRecord | null
  writerKey?: string | null
}

export type IdentityProfile = {
  displayName?: string | null
  bio?: string | null
  avatarMimeType?: string | null
  avatarDataUrl?: string | null
  updatedAt?: number | null
}

export type IdentitySummary = {
  identityKey: string
  writerKey: string
  profile?: IdentityProfile | null
}

type JoinDocOptions = {
  onStatus?: (status: DocPairStatus) => void
  signal?: AbortSignal
  timeoutMs?: number
}

type LocalUser = {
  name: string
  color: string
  key: string
  avatarDataUrl?: string | null
}

type DocSession = {
  key: string
  doc: Y.Doc
  awareness: Awareness
  pendingUpdates: Uint8Array[]
  pendingAwareness: Uint8Array | null
  flushTimer: ReturnType<typeof setTimeout> | null
  awarenessTimer: ReturnType<typeof setTimeout> | null
  attached: boolean
}

type DocStore = {
  docs: DocRecord[]
  activeDoc: string | null
  currentUpdate: DocUpdate | null
  identity: IdentitySummary | null
  loading: boolean
  error: string | null
  watcher: DocWatcher | null
  clientId: string
  localUser: LocalUser
  linkingIdentity: boolean
  resettingIdentity: boolean
  identityError: string | null
  invites: Record<string, DocInvite[]>
  invitesLoading: boolean
  invitesError: string | null
  creatingDoc: boolean
  lockingDoc: boolean
  abandoningDoc: boolean
  initialize: () => Promise<void>
  refreshIdentity: () => Promise<void>
  linkIdentity: (invite: string) => Promise<void>
  resetIdentity: () => Promise<void>
  refresh: () => Promise<void>
  selectDoc: (key: string | null) => Promise<void>
  createDoc: (title?: string) => Promise<void>
  joinDoc: (invite: string, options?: JoinDocOptions) => Promise<void>
  renameDoc: (key: string, title: string) => Promise<void>
  lockDoc: (key: string) => Promise<void>
  abandonDoc: (key: string) => Promise<void>
  loadInvites: (
    key: string,
    options?: { includeRevoked?: boolean }
  ) => Promise<DocInvite[]>
  refreshInvites: (options?: {
    includeRevoked?: boolean
  }) => Promise<DocInvite[] | null>
  createDocInvite: (options?: {
    roles?: string[]
    expiresAt?: number
  }) => Promise<{ invite: string; inviteId: string }>
  revokeDocInvite: (options: { inviteId: string }) => Promise<void>
}

const REMOTE_ORIGIN = 'remote'
const DEFAULT_JOIN_TIMEOUT = 15000
const UPDATE_FLUSH_MS = 50
const AWARENESS_FLUSH_MS = 120
const WATCH_RECONNECT_BASE_MS = 400
const WATCH_RECONNECT_MAX_MS = 5000

const sessions = new Map<string, DocSession>()
const applyQueues = new Map<string, Promise<void>>()

function randomId(length = 32) {
  if (length <= 0) return ''
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(length)
    crypto.getRandomValues(array)
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    )
  }
  const chunks = []
  for (let i = 0; i < length; i++) {
    const value = Math.floor(Math.random() * 256)
    chunks.push(value.toString(16).padStart(2, '0'))
  }
  return chunks.join('')
}

function shortLabel(value: string) {
  return value.slice(0, 5)
}

function mergeDocSummary(entry: DocRecord, fetched: DocRecord) {
  return {
    ...entry,
    title: fetched.title ?? entry.title,
    lastRevision: fetched.lastRevision ?? entry.lastRevision,
    lastOpenedAt: fetched.lastOpenedAt ?? entry.lastOpenedAt,
    lockedAt: fetched.lockedAt ?? entry.lockedAt,
    lockedBy: fetched.lockedBy ?? entry.lockedBy
  }
}

function updateDocListEntry(
  docs: DocRecord[],
  key: string,
  updater: (doc: DocRecord) => DocRecord
) {
  return docs.map((doc) => (doc.key === key ? updater(doc) : doc))
}

function updateCurrentDoc(
  current: DocUpdate | null,
  key: string,
  updater: (doc: DocUpdate) => DocUpdate
) {
  if (!current || current.key !== key) return current
  return updater(current)
}

function applyDocUpdateToListEntry(doc: DocRecord, update: DocUpdate) {
  return {
    ...doc,
    title: update.title ?? doc.title,
    lastRevision: update.revision,
    lastOpenedAt: update.updatedAt ?? Date.now(),
    lockedAt: update.lockedAt ?? null,
    lockedBy: update.lockedBy ?? null
  }
}

function userFromWriterKey(writerKey: string | null | undefined) {
  if (typeof writerKey !== 'string') return null
  const trimmed = writerKey.trim()
  if (!trimmed) return null
  return {
    name: shortLabel(trimmed),
    color: colorFromKey(trimmed),
    key: trimmed
  }
}

function userFromIdentity(identity: IdentitySummary | null | undefined) {
  const identityKey =
    typeof identity?.identityKey === 'string' ? identity.identityKey.trim() : ''
  if (!identityKey) return null

  const displayName =
    typeof identity?.profile?.displayName === 'string'
      ? identity.profile.displayName.trim()
      : ''

  return {
    name: displayName || shortLabel(identityKey),
    color: colorFromKey(identityKey),
    key: identityKey,
    avatarDataUrl:
      typeof identity?.profile?.avatarDataUrl === 'string' &&
      identity.profile.avatarDataUrl.length > 0
        ? identity.profile.avatarDataUrl
        : null
  }
}

async function hydrateIdentityAvatar(identity: IdentitySummary | null, rpc: any) {
  if (!identity) return null
  if (!identity.profile?.avatarMimeType) return identity

  try {
    const response = await rpc.getIdentityAvatar({})
    const dataUrl =
      typeof response?.avatar?.dataUrl === 'string' &&
      response.avatar.dataUrl.length > 0
        ? response.avatar.dataUrl
        : null

    return {
      ...identity,
      profile: {
        ...(identity.profile ?? {}),
        avatarDataUrl: dataUrl
      }
    }
  } catch {
    return identity
  }
}

function applyLocalUser(
  set: (next: Partial<DocStore>) => void,
  getState: () => DocStore,
  nextUser: LocalUser,
  nextClientId?: string
) {
  const currentUser = getState().localUser
  if (
    currentUser.name === nextUser.name &&
    currentUser.color === nextUser.color &&
    currentUser.key === nextUser.key &&
    currentUser.avatarDataUrl === nextUser.avatarDataUrl &&
    (nextClientId === undefined || getState().clientId === nextClientId)
  ) {
    return
  }

  const nextState: Partial<DocStore> = { localUser: nextUser }
  if (nextClientId !== undefined) {
    nextState.clientId = nextClientId
  }
  set(nextState)

  // Avoid mutating the active editor awareness here. TipTap's collaboration
  // cursor extension owns that lifecycle and updates it via editor command.
  const activeDoc = getState().activeDoc
  for (const session of sessions.values()) {
    if (session.key === activeDoc) continue
    try {
      session.awareness.setLocalStateField('user', nextUser)
    } catch {}
  }
}

function updateLocalUserFromKey(
  set: (next: Partial<DocStore>) => void,
  getState: () => DocStore,
  writerKey: string | null | undefined
) {
  if (getState().identity?.identityKey) return
  const nextUser = userFromWriterKey(writerKey)
  if (!nextUser) return
  applyLocalUser(set, getState, nextUser, nextUser.key)
}

function updateLocalUserFromIdentity(
  set: (next: Partial<DocStore>) => void,
  getState: () => DocStore,
  identity: IdentitySummary | null | undefined
) {
  const nextUser = userFromIdentity(identity)
  if (!nextUser) return
  applyLocalUser(set, getState, nextUser)
}

const LOCAL_CLIENT_ID = randomId(16)
const LOCAL_USER: LocalUser = {
  name: '',
  color: '#94a3b8',
  key: '',
  avatarDataUrl: null
}

function enqueueSend(key: string, task: () => Promise<void>) {
  const previous = applyQueues.get(key) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(task)
    .catch(() => {})
  applyQueues.set(key, next)
  return next
}

function getSession(key: string): DocSession {
  const existing = sessions.get(key)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  awareness.setLocalStateField('user', LOCAL_USER)

  const session: DocSession = {
    key,
    doc,
    awareness,
    pendingUpdates: [],
    pendingAwareness: null,
    flushTimer: null,
    awarenessTimer: null,
    attached: false
  }

  sessions.set(key, session)
  return session
}

function destroySession(session: DocSession) {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }
  if (session.awarenessTimer) {
    clearTimeout(session.awarenessTimer)
    session.awarenessTimer = null
  }
  session.pendingUpdates = []
  session.pendingAwareness = null
  session.awareness?.destroy?.()
  session.doc?.destroy?.()
  sessions.delete(session.key)
  applyQueues.delete(session.key)
}

function destroySessionByKey(key: string | null) {
  if (!key) return
  const session = sessions.get(key)
  if (!session) return
  destroySession(session)
}

export function destroyAllSessions() {
  for (const session of sessions.values()) {
    destroySession(session)
  }
  sessions.clear()
  applyQueues.clear()
}

function attachSession(
  session: DocSession,
  getState: () => DocStore,
  set: (next: Partial<DocStore>) => void
) {
  if (session.attached) return
  session.attached = true

  session.doc.on('update', (update, origin) => {
    if (origin === REMOTE_ORIGIN) return
    session.pendingUpdates.push(update)
    scheduleFlush(session, getState, set, UPDATE_FLUSH_MS)
  })

  session.awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin === REMOTE_ORIGIN) return
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    session.pendingAwareness = encodeAwarenessUpdate(session.awareness, changed)
    if (session.awarenessTimer) return
    session.awarenessTimer = setTimeout(() => {
      session.awarenessTimer = null
      const update = session.pendingAwareness
      session.pendingAwareness = null
      if (!update) return
      void enqueueSend(session.key, async () => {
        try {
          const rpc = getRpc()
          await rpc.applyAwareness({
            key: session.key,
            update
          })
        } catch {
          // Awareness is ephemeral; ignore failures.
        }
      })
    }, AWARENESS_FLUSH_MS)
  })

  const localUser = getState().localUser
  if (localUser) {
    session.awareness.setLocalStateField('user', localUser)
  }
}

async function prefetchDocTitles(
  docs: DocRecord[],
  set: (
    next: Partial<DocStore> | ((state: DocStore) => Partial<DocStore>)
  ) => void
) {
  if (!Array.isArray(docs) || docs.length === 0) return
  const rpc = getRpc()

  for (const doc of docs) {
    if (!doc?.key) continue
    const title = typeof doc.title === 'string' ? doc.title.trim() : ''
    if (title && title !== DEFAULT_TITLE) continue

    try {
      const response = await rpc.getDoc({ key: doc.key })
      const fetched = response?.doc
      if (!fetched || typeof fetched.key !== 'string') continue

      set((state) => ({
        docs: state.docs.map((entry) =>
          entry.key === fetched.key ? mergeDocSummary(entry, fetched) : entry
        )
      }))
    } catch {}
  }
}

function scheduleFlush(
  session: DocSession,
  getState: () => DocStore,
  set: (next: Partial<DocStore>) => void,
  delay: number
) {
  if (session.flushTimer) return
  session.flushTimer = setTimeout(() => {
    session.flushTimer = null
    void flushUpdates(session, getState, set, delay * 4)
  }, delay)
}

async function flushUpdates(
  session: DocSession,
  getState: () => DocStore,
  set: (next: Partial<DocStore>) => void,
  retryDelay: number
) {
  const queued = session.pendingUpdates.splice(0)
  if (queued.length === 0) return
  const merged = queued.length === 1 ? queued[0] : Y.mergeUpdates(queued)
  await enqueueSend(session.key, async () => {
    try {
      const rpc = getRpc()
      await rpc.applyUpdates({
        key: session.key,
        updates: [
          {
            clientId: getState().clientId,
            timestamp: Date.now(),
            data: merged
          }
        ]
      })
    } catch (error) {
      session.pendingUpdates.unshift(merged)
      scheduleFlush(session, getState, set, retryDelay)
      const message =
        error instanceof Error ? error.message : 'Failed to sync changes'
      set({ error: message })
    }
  })
}

function applyIncoming(session: DocSession, payload: RawDocUpdate) {
  if (payload.syncUpdate) {
    const update = toUint8Array(payload.syncUpdate)
    if (update) {
      Y.applyUpdate(session.doc, update, REMOTE_ORIGIN)
    }
  }

  if (Array.isArray(payload.updates)) {
    for (const entry of payload.updates) {
      const update = toUint8Array(entry?.data)
      if (update) {
        Y.applyUpdate(session.doc, update, REMOTE_ORIGIN)
      }
    }
  }

  if (payload.awareness) {
    const update = toUint8Array(payload.awareness)
    if (update) {
      applyAwarenessUpdate(session.awareness, update, REMOTE_ORIGIN)
    }
  }
}

function normalizeDocMeta(
  payload: RawDocUpdate,
  session: DocSession,
  previous?: DocUpdate | null
): DocUpdate {
  const key =
    typeof payload.key === 'string' ? payload.key : previous?.key || ''
  const revision =
    typeof payload.revision === 'number'
      ? payload.revision
      : (previous?.revision ?? 0)
  const updatedAt =
    typeof payload.updatedAt === 'number'
      ? payload.updatedAt
      : previous?.updatedAt
  const title =
    typeof payload.title === 'string'
      ? payload.title
      : payload.title === null
        ? null
        : previous?.title
  const capabilities =
    payload.capabilities && typeof payload.capabilities === 'object'
      ? { ...payload.capabilities }
      : (previous?.capabilities ?? null)

  let lockedAt: number | null
  if (
    typeof payload.lockedAt === 'number' &&
    Number.isFinite(payload.lockedAt)
  ) {
    lockedAt = payload.lockedAt
  } else if (payload.lockedAt === null) {
    lockedAt = null
  } else if (previous) {
    lockedAt = previous.lockedAt ?? null
  } else {
    lockedAt = null
  }
  if (lockedAt !== null && lockedAt <= 0) {
    lockedAt = null
  }

  let lockedBy: string | null
  if (typeof payload.lockedBy === 'string' && payload.lockedBy.length > 0) {
    lockedBy = payload.lockedBy
  } else if (payload.lockedBy === null) {
    lockedBy = null
  } else if (previous) {
    lockedBy = previous.lockedBy ?? null
  } else {
    lockedBy = null
  }

  return {
    key,
    revision,
    updatedAt,
    title,
    doc: session.doc,
    awareness: session.awareness,
    capabilities,
    lockedAt,
    lockedBy
  }
}

export const useDocStore = create<DocStore>((set, get) => ({
  docs: [],
  activeDoc: null,
  currentUpdate: null,
  identity: null,
  loading: false,
  error: null,
  watcher: null,
  clientId: LOCAL_CLIENT_ID,
  localUser: LOCAL_USER,
  linkingIdentity: false,
  resettingIdentity: false,
  identityError: null,
  invites: {},
  invitesLoading: false,
  invitesError: null,
  creatingDoc: false,
  lockingDoc: false,
  abandoningDoc: false,
  initialize: async () => {
    if (get().loading) return

    set({ loading: true, error: null })

    try {
      const rpc = getRpc()
      const response = await rpc.initialize({})
      const docs = response?.docs ?? []
      const identity = await hydrateIdentityAvatar(response?.identity ?? null, rpc)
      let activeDoc = response?.activeDoc ?? null

      if (!activeDoc) {
        const storedActive = loadLastDocKey()
        if (storedActive && docs.some((doc) => doc.key === storedActive)) {
          activeDoc = storedActive
        }
      }

      set({
        docs,
        activeDoc,
        identity,
        identityError: null,
        loading: false
      })
      updateLocalUserFromIdentity(set, get, identity)
      void prefetchDocTitles(docs, set)

      if (activeDoc) {
        await get().selectDoc(activeDoc)
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  },
  refreshIdentity: async () => {
    try {
      const rpc = getRpc()
      const response = await rpc.getIdentity({})
      const identity = await hydrateIdentityAvatar(response?.identity ?? null, rpc)
      set({ identity, identityError: null })
      updateLocalUserFromIdentity(set, get, identity)
    } catch (error) {
      set({
        identityError: error instanceof Error ? error.message : String(error)
      })
    }
  },
  linkIdentity: async (invite) => {
    const trimmed = typeof invite === 'string' ? invite.trim() : ''
    if (!trimmed) {
      throw new Error('Identity invite is required')
    }

    if (get().linkingIdentity) return

    set({ linkingIdentity: true, identityError: null })

    try {
      const rpc = getRpc()
      const response = await rpc.linkIdentity({ invite: trimmed })
      const identity = await hydrateIdentityAvatar(response?.identity ?? null, rpc)
      if (!identity) {
        throw new Error('Identity link response missing identity')
      }
      set({ identity, linkingIdentity: false, identityError: null })
      updateLocalUserFromIdentity(set, get, identity)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to link identity'
      set({
        linkingIdentity: false,
        identityError: message,
        error: message
      })
      throw error instanceof Error ? error : new Error(message)
    }
  },
  resetIdentity: async () => {
    if (get().resettingIdentity) return

    set({ resettingIdentity: true, identityError: null })

    try {
      const rpc = getRpc()
      await rpc.resetIdentity({})
      set({
        identity: null,
        resettingIdentity: false,
        identityError: null
      })
      applyLocalUser(set, get, LOCAL_USER)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to reset identity'
      set({
        resettingIdentity: false,
        identityError: message,
        error: message
      })
      throw error instanceof Error ? error : new Error(message)
    }
  },
  refresh: async () => {
    try {
      const rpc = getRpc()
      const response = await rpc.listDocs({})
      const docs = response?.docs ?? []
      set({ docs })
      void prefetchDocTitles(docs, set)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
  selectDoc: async (key) => {
    const currentWatcher = get().watcher
    const previous = get()
    const previousActive = previous.activeDoc
    const preserve =
      key && previous.activeDoc === key && previous.currentUpdate !== null

    if (currentWatcher?.stop) {
      const stopPromise = currentWatcher.stop()
      if (stopPromise) {
        await stopPromise.catch(() => {})
      }
    }

    if (!key) {
      destroySessionByKey(previousActive)
      set({
        activeDoc: null,
        currentUpdate: null,
        watcher: null,
        invitesError: null
      })
      saveLastDocKey(null)
      return
    }

    const session = getSession(key)
    attachSession(session, get, set)

    const fallback = preserve ? previous.currentUpdate : null
    const docEntry = previous.docs.find((doc) => doc.key === key)
    const lockedAt = docEntry?.lockedAt ?? fallback?.lockedAt ?? null
    const lockedBy = docEntry?.lockedBy ?? fallback?.lockedBy ?? null

    set({
      activeDoc: key,
      currentUpdate: {
        key,
        revision: docEntry?.lastRevision ?? fallback?.revision ?? 0,
        updatedAt: docEntry?.lastOpenedAt ?? fallback?.updatedAt,
        title: docEntry?.title ?? fallback?.title ?? null,
        doc: session.doc,
        awareness: session.awareness,
        capabilities: fallback?.capabilities ?? null,
        lockedAt,
        lockedBy
      },
      watcher: null,
      invitesError: null
    })

    saveLastDocKey(key)

    try {
      const rpc = getRpc()
      void rpc
        .getDoc({ key })
        .then((response) => {
          if (response?.writerKey) {
            updateLocalUserFromKey(set, get, response.writerKey)
          }
        })
        .catch(() => {})

      let activeStream: any = null
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null
      let reconnectAttempt = 0
      let stopped = false

      const isActiveDoc = () => get().activeDoc === key

      const clearReconnect = () => {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
      }

      const stopWatcher = async () => {
        stopped = true
        clearReconnect()
        if (activeStream && !activeStream.destroyed) {
          activeStream.destroy()
        }
        activeStream = null
      }

      const scheduleReconnect = () => {
        if (stopped || !isActiveDoc()) return
        if (reconnectTimer) return
        const delay = Math.min(
          WATCH_RECONNECT_MAX_MS,
          WATCH_RECONNECT_BASE_MS * 2 ** reconnectAttempt
        )
        reconnectAttempt = Math.min(reconnectAttempt + 1, 8)
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          startWatch()
        }, delay)
      }

      const handleData = (payload: RawDocUpdate) => {
        if (!isActiveDoc()) return
        if (reconnectAttempt !== 0) reconnectAttempt = 0
        const updateKey = typeof payload.key === 'string' ? payload.key : key
        const targetSession = getSession(updateKey)
        applyIncoming(targetSession, payload)
        if (payload.writerKey) {
          updateLocalUserFromKey(set, get, payload.writerKey)
        }

        set((state) => {
          const nextUpdate = normalizeDocMeta(
            payload,
            targetSession,
            state.currentUpdate
          )
          const docs = updateDocListEntry(state.docs, updateKey, (doc) =>
            applyDocUpdateToListEntry(doc, nextUpdate)
          )

          return {
            currentUpdate:
              state.activeDoc === updateKey ? nextUpdate : state.currentUpdate,
            docs
          }
        })

        if (
          payload.capabilities?.canInvite === true &&
          get().invites[updateKey] === undefined
        ) {
          void get()
            .loadInvites(updateKey, { includeRevoked: false })
            .catch(() => {})
        }
      }

      const handleError = (err: Error, stream: any) => {
        if (!isActiveDoc() || activeStream !== stream) return
        set({ error: err.message, watcher: null })
        scheduleReconnect()
      }

      const handleClose = (stream: any) => {
        if (!isActiveDoc() || activeStream !== stream) return
        set({ watcher: null })
        scheduleReconnect()
      }

      const startWatch = () => {
        if (stopped || !isActiveDoc()) return
        const vector = Y.encodeStateVector(session.doc)
        const stream = rpc.watchDoc({
          key,
          stateVector: vector
        })

        activeStream = stream

        const watcher: DocWatcher = {
          stop: stopWatcher
        }

        set({ watcher })

        stream.on('data', handleData)
        stream.on('error', (err: Error) => handleError(err, stream))
        stream.on('close', () => handleClose(stream))
      }

      startWatch()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
  createDoc: async (title) => {
    if (get().creatingDoc) return

    set({ creatingDoc: true })

    try {
      const rpc = getRpc()
      const response = await rpc.createDoc({ title: title || null })
      const doc = response?.doc
      if (!doc) {
        throw new Error('Create doc response missing document')
      }

      set((state) => ({
        docs: [
          doc,
          ...state.docs.filter((existing) => existing.key !== doc.key)
        ],
        error: null
      }))

      updateLocalUserFromKey(set, get, response?.writerKey)
      await get().selectDoc(doc.key)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to create document'

      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    } finally {
      set({ creatingDoc: false })
    }
  },
  renameDoc: async (key, title) => {
    if (!key) return

    const trimmed = typeof title === 'string' ? title.trim() : ''
    const fallbackTitle = trimmed.length > 0 ? trimmed : DEFAULT_TITLE

    const previousState = get()
    const previousDoc =
      previousState.docs.find((doc) => doc.key === key) || null
    const previousTitle = previousDoc?.title ?? null
    const previousUpdate =
      previousState.currentUpdate?.key === key
        ? previousState.currentUpdate
        : null

    set((state) => {
      const docs = updateDocListEntry(state.docs, key, (doc) => ({
        ...doc,
        title: fallbackTitle
      }))

      const currentUpdate = updateCurrentDoc(
        state.currentUpdate,
        key,
        (doc) => ({
          ...doc,
          title: fallbackTitle
        })
      )

      return {
        ...state,
        docs,
        currentUpdate
      }
    })

    try {
      const rpc = getRpc()
      const response = await rpc.renameDoc({ key, title: trimmed || null })
      const nextTitle =
        typeof response?.title === 'string' && response.title.length > 0
          ? response.title
          : fallbackTitle
      const updatedAt =
        typeof response?.updatedAt === 'number' &&
        Number.isFinite(response.updatedAt)
          ? response.updatedAt
          : Date.now()
      set((state) => {
        const docs = updateDocListEntry(state.docs, key, (doc) => ({
          ...doc,
          title: nextTitle,
          lastOpenedAt: updatedAt
        }))

        const currentUpdate = updateCurrentDoc(
          state.currentUpdate,
          key,
          (doc) => ({
            ...doc,
            title: nextTitle,
            updatedAt
          })
        )

        return {
          ...state,
          docs,
          currentUpdate
        }
      })
    } catch (error) {
      set((state) => {
        const docs = updateDocListEntry(state.docs, key, (doc) => ({
          ...doc,
          title: previousTitle ?? doc.title
        }))

        const currentUpdate = previousUpdate
          ? { ...previousUpdate }
          : updateCurrentDoc(state.currentUpdate, key, (doc) => ({
              ...doc,
              title: previousTitle ?? doc.title
            }))

        return {
          ...state,
          docs,
          currentUpdate,
          error: error instanceof Error ? error.message : String(error)
        }
      })

      throw error
    }
  },
  joinDoc: async (invite, options) => {
    const trimmed = typeof invite === 'string' ? invite.trim() : ''
    if (!trimmed) {
      throw new Error('Invite code is required')
    }

    const onStatus = options?.onStatus
    const signal = options?.signal
    const timeoutMs = Math.max(1000, options?.timeoutMs ?? DEFAULT_JOIN_TIMEOUT)
    const rpc = getRpc()
    const stream = rpc.pairInvite({ invite: trimmed })

    return await new Promise<void>((resolve, reject) => {
      let resolved = false
      let finished = false
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const clearJoinTimeout = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
      }

      const cleanup = () => {
        clearJoinTimeout()
        if (signal) {
          signal.removeEventListener('abort', handleAbort)
        }
        if (typeof stream.off === 'function') {
          stream.off('data', handleStatus)
          stream.off('error', handleError)
          stream.off('close', handleClose)
        }
        if (!stream.destroyed) {
          try {
            stream.destroy()
          } catch {}
        }
      }

      const succeed = () => {
        if (finished) return
        finished = true
        resolved = true
        cleanup()
        resolve()
      }

      const fail = (reason: Error) => {
        if (finished) return
        finished = true
        cleanup()
        reject(reason)
      }

      const handleAbort = () => {
        fail(new Error('Join cancelled'))
      }

      const handleTimeout = () => {
        if (resolved || finished) return
        const error = new Error('Timed out waiting for peers')
        set({ error: error.message })
        fail(error)
      }

      const refreshTimeout = () => {
        if (timeoutMs <= 0 || finished) return
        clearJoinTimeout()
        timeoutId = setTimeout(handleTimeout, timeoutMs)
      }

      if (signal) {
        if (signal.aborted) {
          handleAbort()
          return
        }
        signal.addEventListener('abort', handleAbort, { once: true })
      }

      const handleStatus = (payload: unknown) => {
        refreshTimeout()
        const status = normalizePairStatus(payload)
        if (onStatus) {
          onStatus(status)
        }

        if (status.state === 'joined') {
          const doc = status.doc
          if (!doc) {
            fail(new Error('Join response missing document'))
            return
          }

          set((state) => ({
            docs: [
              doc,
              ...state.docs.filter((existing) => existing.key !== doc.key)
            ],
            error: null
          }))

          Promise.resolve()
            .then(() => {
              updateLocalUserFromKey(set, get, status.writerKey)
            })
            .then(() => get().selectDoc(doc.key))
            .then(() => {
              succeed()
            })
            .catch((error) => {
              const reason =
                error instanceof Error ? error : new Error(String(error))
              fail(reason)
            })
        } else if (status.state === 'error') {
          const message =
            status.message && status.message.length > 0
              ? status.message
              : 'Failed to join document'
          set({ error: message })
          fail(new Error(message))
        }
      }

      const handleError = (error: Error) => {
        if (resolved || finished) return
        fail(error)
      }

      const handleClose = () => {
        if (resolved || finished) return
        fail(new Error('Join cancelled'))
      }

      stream.on('data', handleStatus)
      stream.on('error', handleError)
      stream.on('close', handleClose)

      refreshTimeout()
    })
  },
  lockDoc: async (key) => {
    if (!key) return
    if (get().lockingDoc) return

    set({ lockingDoc: true })

    try {
      const rpc = getRpc()
      const response = await rpc.lockDoc({ key })
      const lockedAt =
        typeof response?.lockedAt === 'number' &&
        Number.isFinite(response.lockedAt)
          ? response.lockedAt
          : Date.now()
      const lockedBy =
        typeof response?.lockedBy === 'string' && response.lockedBy.length > 0
          ? response.lockedBy
          : null

      set((state) => {
        const docs = updateDocListEntry(state.docs, key, (doc) => ({
          ...doc,
          lockedAt,
          lockedBy
        }))

        const currentUpdate = updateCurrentDoc(
          state.currentUpdate,
          key,
          (doc) => ({
            ...doc,
            lockedAt,
            lockedBy
          })
        )

        return {
          ...state,
          docs,
          currentUpdate,
          error: null
        }
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to lock document'
      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    } finally {
      set({ lockingDoc: false })
    }
  },
  abandonDoc: async (key) => {
    if (!key) return
    if (get().abandoningDoc) return

    set({ abandoningDoc: true })

    try {
      const wasActive = get().activeDoc === key
      if (wasActive) {
        await get().selectDoc(null)
      }

      const rpc = getRpc()
      await rpc.removeDoc({ key })

      set((state) => {
        const docs = state.docs.filter((doc) => doc.key !== key)
        const nextInvites = { ...state.invites }
        delete nextInvites[key]

        return {
          ...state,
          docs,
          activeDoc: state.activeDoc === key ? null : state.activeDoc,
          watcher: state.activeDoc === key ? null : state.watcher,
          currentUpdate:
            state.currentUpdate && state.currentUpdate.key === key
              ? null
              : state.currentUpdate,
          invites: nextInvites,
          error: null
        }
      })
      destroySessionByKey(key)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to abandon document'
      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    } finally {
      set({ abandoningDoc: false })
    }
  },
  loadInvites: async (key, options) => {
    if (!key) return []

    set({ invitesLoading: true, invitesError: null })

    try {
      const rpc = getRpc()
      const response = await rpc.listInvites({
        key,
        includeRevoked: options?.includeRevoked === true
      })
      const invites = Array.isArray(response?.invites)
        ? response.invites.map((entry: Record<string, unknown>) => {
            const rawRoles = Array.isArray(entry.roles) ? entry.roles : []
            const roles = rawRoles
              .map((role) =>
                typeof role === 'string'
                  ? role
                  : role && typeof role.toString === 'function'
                    ? role.toString()
                    : null
              )
              .filter(
                (role): role is string =>
                  typeof role === 'string' && role.length > 0
              )

            return {
              id: typeof entry.id === 'string' ? entry.id : '',
              invite: typeof entry.invite === 'string' ? entry.invite : '',
              roles,
              createdBy:
                typeof entry.createdBy === 'string' &&
                entry.createdBy.length > 0
                  ? entry.createdBy
                  : undefined,
              createdAt:
                typeof entry.createdAt === 'number' &&
                Number.isFinite(entry.createdAt)
                  ? entry.createdAt
                  : undefined,
              revokedAt:
                typeof entry.revokedAt === 'number' &&
                Number.isFinite(entry.revokedAt)
                  ? entry.revokedAt
                  : undefined,
              expiresAt:
                typeof entry.expiresAt === 'number' &&
                Number.isFinite(entry.expiresAt)
                  ? entry.expiresAt
                  : undefined
            }
          })
        : []

      set((state) => ({
        invites: {
          ...state.invites,
          [key]: invites
        },
        invitesLoading: false,
        invitesError: null
      }))

      return invites
    } catch (error) {
      set({
        invitesLoading: false,
        invitesError: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  },
  refreshInvites: async (options) => {
    const activeDoc = get().activeDoc
    if (!activeDoc) return null
    return await get().loadInvites(activeDoc, options)
  },
  createDocInvite: async (options = {}) => {
    const activeDoc = get().activeDoc
    if (!activeDoc) {
      throw new Error('Open a document before creating invites')
    }

    const rpc = getRpc()
    const response = await rpc.createInvite({
      key: activeDoc,
      roles: options.roles,
      expiresAt: options.expiresAt
    })

    if (!response?.invite || !response?.inviteId) {
      throw new Error('Invite response missing data')
    }

    await get().loadInvites(activeDoc, { includeRevoked: false })
    return {
      invite: response.invite,
      inviteId: response.inviteId
    }
  },
  revokeDocInvite: async ({ inviteId }) => {
    const activeDoc = get().activeDoc
    if (!activeDoc) {
      throw new Error('Open a document before revoking invites')
    }
    const rpc = getRpc()
    await rpc.revokeInvite({ key: activeDoc, inviteId })
    await get().loadInvites(activeDoc, { includeRevoked: false })
  }
}))

function normalizePairStatus(value: unknown): DocPairStatus {
  if (!isPlainObject(value)) {
    return { state: 'unknown', message: null, progress: null, doc: null }
  }

  const state = typeof value.state === 'string' ? value.state : 'unknown'
  const message =
    typeof value.message === 'string' && value.message.length > 0
      ? value.message
      : null
  const progress =
    typeof value.progress === 'number' && Number.isFinite(value.progress)
      ? value.progress
      : null

  let doc: DocRecord | null = null
  const candidate = value.doc
  if (isPlainObject(candidate) && typeof candidate.key === 'string') {
    doc = {
      key: candidate.key,
      encryptionKey:
        typeof candidate.encryptionKey === 'string'
          ? candidate.encryptionKey
          : '',
      createdAt:
        typeof candidate.createdAt === 'number'
          ? candidate.createdAt
          : Date.now(),
      joinedAt:
        typeof candidate.joinedAt === 'number'
          ? candidate.joinedAt
          : candidate.createdAt && Number.isFinite(candidate.createdAt)
            ? Number(candidate.createdAt)
            : null,
      isCreator: candidate.isCreator === true,
      title:
        typeof candidate.title === 'string' && candidate.title.length > 0
          ? candidate.title
          : null,
      lastRevision:
        typeof candidate.lastRevision === 'number'
          ? candidate.lastRevision
          : null,
      lastOpenedAt:
        typeof candidate.lastOpenedAt === 'number'
          ? candidate.lastOpenedAt
          : null,
      lockedAt:
        typeof candidate.lockedAt === 'number' &&
        Number.isFinite(candidate.lockedAt)
          ? candidate.lockedAt
          : null,
      lockedBy:
        typeof candidate.lockedBy === 'string' && candidate.lockedBy.length > 0
          ? candidate.lockedBy
          : null
    }
  }

  const writerKey =
    typeof value.writerKey === 'string' && value.writerKey.length > 0
      ? value.writerKey
      : null

  return {
    state,
    message,
    progress,
    doc,
    writerKey
  }
}

function isPlainObject(
  value: unknown
): value is Record<string | number | symbol, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

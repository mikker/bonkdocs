import { create } from 'zustand'
import { getRpc } from '../lib/rpc.ts'
import {
  fingerprintText,
  createDeltaPayload,
  decodeDeltaPayload,
  applyDeltaSteps
} from '../../../lib/snapshot-delta.js'
import {
  loadDocState,
  saveDocState,
  clearDocState,
  loadLastDocKey,
  saveLastDocKey
} from './doc-persistence.js'
import { mergeDocsWithCachedMetadata } from './doc-cache.js'

type DocSnapshot = {
  type: string
  content?: unknown[]
  [key: string]: unknown
}

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
  baseRevision?: number
  snapshotRevision?: number
  updatedAt?: number
  title?: string | null
  snapshot?: unknown
  ops?: unknown
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
  snapshotRevision?: number | null
  snapshot: DocSnapshot
  snapshotText: string
  rawSnapshot: Uint8Array | null
  snapshotHash: string
  capabilities?: DocCapabilities | null
  lockedAt?: number | null
  lockedBy?: string | null
}

type DocWatcher = {
  stop: (() => Promise<void> | void) | null
}

type DeltaPayload = {
  type: 'delta'
  version: number
  baseHash: string
  nextHash: string
  steps: Array<Record<string, unknown>>
}

type PendingOp = {
  rev: number
  baseRev: number
  timestamp: number
  delta: DeltaPayload
}

export type DocConflictState = {
  message: string
  baseRevision: number
  attemptedRevision: number
  existingRevision: number
  expectedRevision: number
  clientId?: string | null
  sessionId?: string | null
  timestamp?: number | null
}

export type DocPairStatus = {
  state: string
  message?: string | null
  progress?: number | null
  doc?: DocRecord | null
}

type JoinDocOptions = {
  onStatus?: (status: DocPairStatus) => void
  signal?: AbortSignal
  timeoutMs?: number
}

type DocStore = {
  docs: DocRecord[]
  activeDoc: string | null
  currentUpdate: DocUpdate | null
  loading: boolean
  error: string | null
  watcher: DocWatcher | null
  clientId: string
  sessionId: string
  pendingOps: Record<string, PendingOp[]>
  invites: Record<string, DocInvite[]>
  invitesLoading: boolean
  invitesError: string | null
  conflicts: Record<string, DocConflictState | null>
  creatingDoc: boolean
  lockingDoc: boolean
  abandoningDoc: boolean
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  selectDoc: (key: string | null) => Promise<void>
  createDoc: (title?: string) => Promise<void>
  joinDoc: (invite: string, options?: JoinDocOptions) => Promise<void>
  renameDoc: (key: string, title: string) => Promise<void>
  lockDoc: (key: string) => Promise<void>
  abandonDoc: (key: string) => Promise<void>
  applySnapshot: (key: string, snapshot: DocSnapshot) => Promise<void>
  resyncDoc: (key: string) => Promise<void>
  forkDocFromConflict: (key: string) => Promise<void>
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

async function waitForDocActivation(
  key: string,
  getState: () => DocStore,
  timeout = 4000
): Promise<DocUpdate> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeout) {
    const current = getState().currentUpdate
    if (current && current.key === key) {
      return current
    }
    await sleep(50)
  }
  throw new Error('Timed out waiting for document snapshot')
}

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

const applyQueuePromises = new Map<string, Promise<void>>()
const applyQueueTokens = new Map<string, number>()

function enqueueApplyTask(
  key: string,
  task: () => Promise<void>
): Promise<void> {
  const token = applyQueueTokens.get(key) ?? 0
  const previous = applyQueuePromises.get(key) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      if ((applyQueueTokens.get(key) ?? 0) !== token) return
      await task()
    })
  const tracked = next.finally(() => {
    if (applyQueuePromises.get(key) === tracked) {
      applyQueuePromises.delete(key)
    }
  })
  applyQueuePromises.set(key, tracked)
  return tracked
}

function clearApplyQueue(key: string | null | undefined) {
  if (!key) return
  const current = applyQueueTokens.get(key) ?? 0
  applyQueueTokens.set(key, current + 1)
  applyQueuePromises.delete(key)
}

const DOC_VIEWER_ROLE = 'doc-viewer'
const DEFAULT_JOIN_TIMEOUT = 15000

const EMPTY_SNAPSHOT: DocSnapshot = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
}

function isPlainObject(
  value: unknown
): value is Record<string | number | symbol, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const DEFAULT_CONFLICT_MESSAGE = 'Sync conflict detected'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function toConflictState(
  value: unknown,
  fallback: DocConflictState
): DocConflictState {
  if (!isPlainObject(value)) {
    return {
      message: fallback.message,
      baseRevision: fallback.baseRevision,
      attemptedRevision: fallback.attemptedRevision,
      existingRevision: fallback.existingRevision,
      expectedRevision: fallback.expectedRevision,
      clientId: fallback.clientId ?? null,
      sessionId: fallback.sessionId ?? null,
      timestamp: fallback.timestamp ?? null
    }
  }

  const message =
    typeof value.message === 'string' && value.message.length > 0
      ? value.message
      : fallback.message

  const baseRevision =
    typeof value.baseRevision === 'number'
      ? value.baseRevision
      : fallback.baseRevision

  const attemptedRevision =
    typeof value.attemptedRevision === 'number'
      ? value.attemptedRevision
      : fallback.attemptedRevision

  const existingRevision =
    typeof value.existingRevision === 'number'
      ? value.existingRevision
      : fallback.existingRevision

  const expectedRevision =
    typeof value.expectedRevision === 'number'
      ? value.expectedRevision
      : fallback.expectedRevision

  const clientId =
    typeof value.clientId === 'string' && value.clientId.length > 0
      ? value.clientId
      : (fallback.clientId ?? null)

  const sessionId =
    typeof value.sessionId === 'string' && value.sessionId.length > 0
      ? value.sessionId
      : (fallback.sessionId ?? null)

  const timestamp =
    typeof value.timestamp === 'number'
      ? value.timestamp
      : (fallback.timestamp ?? null)

  return {
    message,
    baseRevision,
    attemptedRevision,
    existingRevision,
    expectedRevision,
    clientId,
    sessionId,
    timestamp
  }
}

function sanitizeDocSnapshot(value: unknown): DocSnapshot {
  if (!isPlainObject(value)) {
    return EMPTY_SNAPSHOT
  }

  const type = typeof value.type === 'string' ? value.type : null
  if (type !== 'doc') {
    return EMPTY_SNAPSHOT
  }

  const content = Array.isArray(value.content) ? value.content : []
  const cleaned = content
    .map((node) => sanitizeNode(node))
    .filter((node): node is Record<string, unknown> => node !== null)

  if (cleaned.length === 0) {
    cleaned.push({ type: 'paragraph' })
  }

  return { type: 'doc', content: cleaned }
}

function sanitizeNode(node: unknown): Record<string, unknown> | null {
  if (!isPlainObject(node)) return null

  const type = typeof node.type === 'string' ? node.type : null
  if (!type) return null

  if (type === 'text') {
    const text = typeof node.text === 'string' ? node.text : ''
    if (!text) return null
    return { ...node, type, text }
  }

  const next: Record<string, unknown> = { ...node, type }

  if (Array.isArray(node.content)) {
    const children = node.content
      .map((child) => sanitizeNode(child))
      .filter((child): child is Record<string, unknown> => child !== null)
    if (children.length > 0) {
      next.content = children
    } else {
      delete next.content
    }
  } else if (node.content !== undefined) {
    delete next.content
  }

  return next
}

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

const DEFAULT_CLIENT_ID = randomId(32)
const DEFAULT_SESSION_ID = randomId(32)

function snapshotToText(doc: DocSnapshot): string {
  return JSON.stringify(doc)
}

function snapshotFingerprint(doc: DocSnapshot): {
  text: string
  hash: string
} {
  const text = snapshotToText(doc)
  return { text, hash: fingerprintText(text) }
}

function parseSnapshotText(text: string): DocSnapshot {
  try {
    const parsed = JSON.parse(text)
    return sanitizeDocSnapshot(parsed)
  } catch {
    return EMPTY_SNAPSHOT
  }
}

function normalizePendingEntries(entries: unknown): PendingOp[] {
  if (!Array.isArray(entries)) return []
  const normalized: PendingOp[] = []
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    const rev = Number.isFinite(entry.rev) ? Number(entry.rev) : null
    const baseRev = Number.isFinite(entry.baseRev)
      ? Number(entry.baseRev)
      : null
    const timestamp = Number.isFinite(entry.timestamp)
      ? Number(entry.timestamp)
      : Date.now()
    const delta = entry.delta
    if (
      rev === null ||
      baseRev === null ||
      !delta ||
      typeof delta !== 'object' ||
      delta.type !== 'delta'
    ) {
      continue
    }
    const payload: DeltaPayload = {
      type: 'delta',
      version:
        Number.isFinite(delta.version) && Number(delta.version) > 0
          ? Number(delta.version)
          : 1,
      baseHash: typeof delta.baseHash === 'string' ? delta.baseHash : '',
      nextHash: typeof delta.nextHash === 'string' ? delta.nextHash : '',
      steps: Array.isArray(delta.steps) ? [...delta.steps] : []
    }
    if (!payload.baseHash || !payload.nextHash || payload.steps.length === 0) {
      continue
    }
    normalized.push({ rev, baseRev, timestamp, delta: payload })
  }
  return normalized
}

function persistDocStateEntry(
  key: string,
  update: DocUpdate | null,
  pending: PendingOp[]
) {
  if (!key) return
  if (!update) {
    clearDocState(key)
    return
  }
  saveDocState(key, {
    revision: update.revision,
    snapshotText: update.snapshotText,
    snapshotHash: update.snapshotHash,
    pending,
    title:
      typeof update.title === 'string' && update.title.length > 0
        ? update.title
        : null,
    updatedAt:
      typeof update.updatedAt === 'number' && Number.isFinite(update.updatedAt)
        ? update.updatedAt
        : Date.now()
  })
}

function normalizeSnapshot(value: unknown): {
  json: DocSnapshot
  buffer: Uint8Array | null
  text: string
  hash: string
} {
  let json: DocSnapshot = EMPTY_SNAPSHOT
  let buffer: Uint8Array | null = null

  if (value instanceof Uint8Array) {
    buffer = value
    try {
      const decoded = textDecoder.decode(value)
      const parsed = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object') {
        json = sanitizeDocSnapshot(parsed)
      }
    } catch {}
  } else if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object') {
        json = sanitizeDocSnapshot(parsed)
      }
    } catch {}
  } else if (typeof value === 'object' && value !== null) {
    if (isPlainObject(value) && typeof value.type === 'string') {
      json = sanitizeDocSnapshot(value)
    }
  }

  const { text, hash } = snapshotFingerprint(json)
  if (!buffer) {
    buffer = textEncoder.encode(text)
  }

  return { json, buffer, text, hash }
}

function normalizeDocUpdate(
  update: RawDocUpdate,
  previous?: DocUpdate | null
): DocUpdate {
  const key = typeof update.key === 'string' ? update.key : previous?.key || ''
  const sameDoc = Boolean(previous && previous.key === key)
  const incomingRevision =
    typeof update.revision === 'number'
      ? update.revision
      : Number(update.revision || 0) || 0

  let revision = incomingRevision
  let updatedAt =
    typeof update.updatedAt === 'number'
      ? update.updatedAt
      : update.updatedAt != null
        ? Number(update.updatedAt)
        : sameDoc
          ? previous?.updatedAt
          : undefined
  const title =
    typeof update.title === 'string'
      ? update.title
      : update.title === null
        ? null
        : sameDoc
          ? previous?.title
          : undefined

  let snapshotRevision: number | null =
    typeof update.snapshotRevision === 'number'
      ? update.snapshotRevision
      : update.snapshotRevision != null
        ? Number(update.snapshotRevision)
        : sameDoc && previous?.snapshotRevision != null
          ? previous.snapshotRevision
          : null

  let snapshot: DocSnapshot
  let snapshotText: string
  let snapshotHash: string
  let rawSnapshot: Uint8Array | null

  if (sameDoc && previous) {
    snapshot = previous.snapshot
    snapshotText = previous.snapshotText
    snapshotHash = previous.snapshotHash
    rawSnapshot = previous.rawSnapshot
  } else {
    snapshot = EMPTY_SNAPSHOT
    const fingerprint = snapshotFingerprint(snapshot)
    snapshotText = fingerprint.text
    snapshotHash = fingerprint.hash
    rawSnapshot = textEncoder.encode(snapshotText)
  }

  const capabilities =
    update.capabilities && typeof update.capabilities === 'object'
      ? { ...update.capabilities }
      : sameDoc && previous?.capabilities
        ? previous.capabilities
        : null

  let lockedAt: number | null
  if (typeof update.lockedAt === 'number' && Number.isFinite(update.lockedAt)) {
    lockedAt = update.lockedAt
  } else if (update.lockedAt === null) {
    lockedAt = null
  } else if (sameDoc && previous) {
    lockedAt = previous.lockedAt ?? null
  } else {
    lockedAt = null
  }
  if (lockedAt !== null && lockedAt <= 0) {
    lockedAt = null
  }

  let lockedBy: string | null
  if (typeof update.lockedBy === 'string' && update.lockedBy.length > 0) {
    lockedBy = update.lockedBy
  } else if (update.lockedBy === null) {
    lockedBy = null
  } else if (sameDoc && previous) {
    lockedBy = previous.lockedBy ?? null
  } else {
    lockedBy = null
  }

  if (lockedAt && !lockedBy) {
    lockedBy = previous?.lockedBy ?? null
  }

  const effectiveCapabilities =
    capabilities && lockedAt
      ? {
          ...capabilities,
          canEdit: false,
          canComment: false,
          canInvite: false
        }
      : capabilities

  if (update.snapshot !== undefined && update.snapshot !== null) {
    const normalized = normalizeSnapshot(update.snapshot)
    snapshot = normalized.json
    snapshotText = normalized.text
    snapshotHash = normalized.hash
    rawSnapshot = normalized.buffer
    snapshotRevision =
      typeof update.snapshotRevision === 'number'
        ? update.snapshotRevision
        : incomingRevision
  }

  const ops = Array.isArray(update.ops) ? update.ops : []
  if (ops.length > 0) {
    for (const entry of ops) {
      if (!entry || typeof entry !== 'object') continue
      const op = entry as Record<string, unknown>
      const payload = decodeDeltaPayload(op.data as unknown)
      if (!payload) continue
      if (payload.baseHash && payload.baseHash !== snapshotHash) {
        break
      }

      const nextText = applyDeltaSteps(snapshotText, payload.steps)
      let parsed: unknown = null
      try {
        parsed = JSON.parse(nextText)
      } catch {
        break
      }

      const sanitized = sanitizeDocSnapshot(parsed)
      const fingerprint = snapshotFingerprint(sanitized)
      snapshot = sanitized
      snapshotText = fingerprint.text
      snapshotHash = fingerprint.hash
      rawSnapshot = textEncoder.encode(snapshotText)

      const opRev = typeof op.rev === 'number' ? op.rev : null
      if (opRev && opRev > revision) {
        revision = opRev
      }
      if (opRev && !snapshotRevision) {
        snapshotRevision = opRev
      }
      const opTimestamp = typeof op.timestamp === 'number' ? op.timestamp : null
      if (opTimestamp && (!updatedAt || opTimestamp > updatedAt)) {
        updatedAt = opTimestamp
      }
    }
  }

  return {
    key,
    revision,
    updatedAt,
    title,
    snapshotRevision,
    snapshot,
    snapshotText,
    rawSnapshot,
    snapshotHash,
    capabilities: effectiveCapabilities,
    lockedAt,
    lockedBy
  }
}

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

  return {
    state,
    message,
    progress,
    doc
  }
}

export const useDocStore = create<DocStore>((set, get) => ({
  docs: [],
  activeDoc: null,
  currentUpdate: null,
  loading: false,
  error: null,
  watcher: null,
  clientId: DEFAULT_CLIENT_ID,
  sessionId: DEFAULT_SESSION_ID,
  pendingOps: {},
  invites: {},
  invitesLoading: false,
  invitesError: null,
  conflicts: {},
  creatingDoc: false,
  lockingDoc: false,
  abandoningDoc: false,
  initialize: async () => {
    if (get().loading) return

    set({ loading: true, error: null })

    try {
      const rpc = getRpc()
      const response = await rpc.initialize({})
      const docs = mergeDocsWithCachedMetadata(response?.docs ?? [])
      let activeDoc = response?.activeDoc ?? null

      if (!activeDoc) {
        const storedActive = loadLastDocKey()
        if (storedActive && docs.some((doc) => doc.key === storedActive)) {
          activeDoc = storedActive
        }
      }

      set({ docs, activeDoc, loading: false })

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
  refresh: async () => {
    try {
      const rpc = getRpc()
      const response = await rpc.listDocs({})
      const docs = mergeDocsWithCachedMetadata(response?.docs ?? [])
      set({ docs })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
  selectDoc: async (key) => {
    const currentWatcher = get().watcher
    if (currentWatcher?.stop) {
      const stopPromise = currentWatcher.stop()
      if (stopPromise) {
        await stopPromise.catch(() => {})
      }
    }

    set({
      activeDoc: key,
      currentUpdate: null,
      watcher: null,
      invitesError: null
    })

    saveLastDocKey(key ?? null)

    if (!key) return

    const cached = loadDocState(key)
    let sinceRevision = 0

    if (cached) {
      const cachedSnapshot = parseSnapshotText(cached.snapshotText)
      const fingerprint = snapshotFingerprint(cachedSnapshot)
      sinceRevision = Number.isFinite(cached.revision) ? cached.revision : 0
      const pending = normalizePendingEntries(cached.pending)
      const cachedTitle =
        typeof cached.title === 'string' && cached.title.length > 0
          ? cached.title
          : null
      const cachedUpdatedAt =
        typeof cached.updatedAt === 'number' &&
        Number.isFinite(cached.updatedAt)
          ? cached.updatedAt
          : Date.now()

      set((state) => {
        const existingDoc = state.docs.find((doc) => doc.key === key)
        const lockedAt =
          existingDoc?.lockedAt ?? state.currentUpdate?.lockedAt ?? null
        const lockedBy =
          existingDoc?.lockedBy ?? state.currentUpdate?.lockedBy ?? null
        const capabilities = state.currentUpdate?.capabilities
        const adjustedCapabilities =
          capabilities && lockedAt
            ? {
                ...capabilities,
                canEdit: false,
                canComment: false,
                canInvite: false
              }
            : capabilities
        const updatedDocs = state.docs.map((doc) =>
          doc.key === key
            ? {
                ...doc,
                title: cachedTitle ?? doc.title,
                lastRevision: sinceRevision,
                lastOpenedAt: cachedUpdatedAt,
                lockedAt,
                lockedBy
              }
            : doc
        )

        return {
          docs: existingDoc ? updatedDocs : state.docs,
          currentUpdate: {
            key,
            revision: sinceRevision,
            updatedAt: cachedUpdatedAt,
            title:
              cachedTitle ??
              existingDoc?.title ??
              state.currentUpdate?.title ??
              null,
            snapshotRevision: sinceRevision,
            snapshot: cachedSnapshot,
            snapshotText: fingerprint.text,
            rawSnapshot: textEncoder.encode(fingerprint.text),
            snapshotHash: fingerprint.hash,
            capabilities: adjustedCapabilities ?? null,
            lockedAt,
            lockedBy
          },
          pendingOps: {
            ...state.pendingOps,
            [key]: pending
          },
          conflicts: {
            ...state.conflicts,
            [key]: null
          }
        }
      })
    } else {
      set((state) => ({
        pendingOps: {
          ...state.pendingOps,
          [key]: []
        },
        conflicts: {
          ...state.conflicts,
          [key]: null
        }
      }))
    }

    try {
      const rpc = getRpc()
      const stream = rpc.watchDoc({
        key,
        includeSnapshot: cached ? false : true,
        sinceRevision: sinceRevision > 0 ? sinceRevision : undefined
      })

      const watcher: DocWatcher = {
        stop: async () => {
          stream.destroy()
        }
      }

      set({ watcher })

      stream.on('data', (payload: RawDocUpdate) => {
        let nextUpdate: DocUpdate | null = null
        let nextPending: PendingOp[] = []
        let shouldLoadInvites = false
        set((state) => {
          const update = normalizeDocUpdate(payload, state.currentUpdate)
          nextUpdate = update
          const existingPending = state.pendingOps[update.key] ?? []
          const remaining = existingPending.filter(
            (op) => op.rev > update.revision
          )
          nextPending = remaining
          shouldLoadInvites =
            update.capabilities?.canInvite === true &&
            state.invites[update.key] === undefined
          return {
            currentUpdate: update,
            docs: state.docs.map((doc) =>
              doc.key === update.key
                ? {
                    ...doc,
                    title: update.title ?? doc.title,
                    lastRevision: update.revision,
                    lastOpenedAt: update.updatedAt ?? Date.now(),
                    lockedAt: update.lockedAt ?? null,
                    lockedBy: update.lockedBy ?? null
                  }
                : doc
            ),
            pendingOps: {
              ...state.pendingOps,
              [update.key]: remaining
            },
            conflicts: {
              ...state.conflicts,
              [update.key]: null
            }
          }
        })

        if (shouldLoadInvites && nextUpdate) {
          void get()
            .loadInvites(nextUpdate.key, { includeRevoked: false })
            .catch(() => {})
        }

        if (nextUpdate) {
          persistDocStateEntry(nextUpdate.key, nextUpdate, nextPending)
        }
      })

      stream.on('error', (err: Error) => {
        set({ error: err.message })
      })

      stream.on('close', () => {
        set({ watcher: null })
      })
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
    const fallbackTitle = trimmed.length > 0 ? trimmed : 'Untitled document'

    const previousState = get()
    const previousDoc =
      previousState.docs.find((doc) => doc.key === key) || null
    const previousTitle = previousDoc?.title ?? null
    const previousUpdate =
      previousState.currentUpdate?.key === key
        ? previousState.currentUpdate
        : null

    set((state) => {
      const nextDocs = state.docs.map((doc) =>
        doc.key === key
          ? {
              ...doc,
              title: fallbackTitle
            }
          : doc
      )

      const currentUpdate =
        state.currentUpdate && state.currentUpdate.key === key
          ? {
              ...state.currentUpdate,
              title: fallbackTitle
            }
          : state.currentUpdate

      return {
        ...state,
        docs: nextDocs,
        currentUpdate
      }
    })

    const optimisticState = get()
    if (optimisticState.currentUpdate?.key === key) {
      persistDocStateEntry(
        key,
        optimisticState.currentUpdate,
        optimisticState.pendingOps[key] ?? []
      )
    }

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
        const docs = state.docs.map((doc) =>
          doc.key === key
            ? {
                ...doc,
                title: nextTitle,
                lastOpenedAt: updatedAt
              }
            : doc
        )

        const currentUpdate =
          state.currentUpdate && state.currentUpdate.key === key
            ? {
                ...state.currentUpdate,
                title: nextTitle,
                updatedAt
              }
            : state.currentUpdate

        return {
          ...state,
          docs,
          currentUpdate
        }
      })

      const nextState = get()
      if (nextState.currentUpdate?.key === key) {
        persistDocStateEntry(
          key,
          nextState.currentUpdate,
          nextState.pendingOps[key] ?? []
        )
      }
    } catch (error) {
      set((state) => {
        const docs = state.docs.map((doc) =>
          doc.key === key
            ? {
                ...doc,
                title: previousTitle ?? doc.title
              }
            : doc
        )

        const currentUpdate = previousUpdate
          ? { ...previousUpdate }
          : state.currentUpdate && state.currentUpdate.key === key
            ? {
                ...state.currentUpdate,
                title: previousTitle ?? state.currentUpdate.title
              }
            : state.currentUpdate

        return {
          ...state,
          docs,
          currentUpdate,
          error: error instanceof Error ? error.message : String(error)
        }
      })

      const revertedState = get()
      if (revertedState.currentUpdate?.key === key) {
        persistDocStateEntry(
          key,
          revertedState.currentUpdate,
          revertedState.pendingOps[key] ?? []
        )
      }

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
        if (timeoutId != null) {
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
        const docs = state.docs.map((doc) =>
          doc.key === key
            ? {
                ...doc,
                lockedAt,
                lockedBy
              }
            : doc
        )

        const currentUpdate =
          state.currentUpdate && state.currentUpdate.key === key
            ? {
                ...state.currentUpdate,
                lockedAt,
                lockedBy,
                capabilities: state.currentUpdate.capabilities
                  ? {
                      ...state.currentUpdate.capabilities,
                      canEdit: false,
                      canComment: false,
                      canInvite: false
                    }
                  : state.currentUpdate.capabilities
              }
            : state.currentUpdate

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
        const nextPending = { ...state.pendingOps }
        delete nextPending[key]
        const nextInvites = { ...state.invites }
        delete nextInvites[key]
        const nextConflicts = { ...state.conflicts }
        delete nextConflicts[key]

        return {
          ...state,
          docs,
          activeDoc: state.activeDoc === key ? null : state.activeDoc,
          watcher: state.activeDoc === key ? null : state.watcher,
          currentUpdate:
            state.currentUpdate && state.currentUpdate.key === key
              ? null
              : state.currentUpdate,
          pendingOps: nextPending,
          invites: nextInvites,
          conflicts: nextConflicts,
          error: null
        }
      })

      clearDocState(key)
      clearApplyQueue(key)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to abandon document'
      set({ error: message })
      throw error instanceof Error ? error : new Error(message)
    } finally {
      set({ abandoningDoc: false })
    }
  },
  applySnapshot: async (key, snapshot) => {
    const state = get()
    const current = state.currentUpdate
    if (!current || current.key !== key) return

    const sanitized = sanitizeDocSnapshot(snapshot)
    const fingerprint = snapshotFingerprint(sanitized)

    if (fingerprint.hash === current.snapshotHash) {
      return
    }
    const delta = createDeltaPayload(current.snapshotText, fingerprint.text)
    if (!delta) {
      return
    }

    const encoded = textEncoder.encode(JSON.stringify(delta))
    const baseRevision = current.revision
    const nextRevision = baseRevision + 1
    const timestamp = Date.now()
    const pendingEntry: PendingOp = {
      rev: nextRevision,
      baseRev: baseRevision,
      timestamp,
      delta
    }

    set((prev) => {
      if (!prev.currentUpdate || prev.currentUpdate.key !== key) return prev
      const pendingForDoc = prev.pendingOps[key] ?? []
      const nextPending = [...pendingForDoc, pendingEntry]
      return {
        ...prev,
        currentUpdate: {
          ...prev.currentUpdate,
          snapshot: sanitized,
          snapshotText: fingerprint.text,
          rawSnapshot: textEncoder.encode(fingerprint.text),
          snapshotHash: fingerprint.hash,
          revision: nextRevision,
          snapshotRevision: nextRevision,
          updatedAt: timestamp
        },
        docs: prev.docs.map((doc) =>
          doc.key === key
            ? {
                ...doc,
                lastRevision: nextRevision,
                lastOpenedAt: timestamp
              }
            : doc
        ),
        pendingOps: {
          ...prev.pendingOps,
          [key]: nextPending
        }
      }
    })

    const optimisticState = get()
    persistDocStateEntry(
      key,
      optimisticState.currentUpdate,
      optimisticState.pendingOps[key] ?? []
    )

    const send = async () => {
      try {
        const rpc = getRpc()
        const result = await rpc.applyOps({
          key,
          ops: [
            {
              rev: nextRevision,
              baseRev: baseRevision,
              clientId: state.clientId,
              sessionId: state.sessionId,
              timestamp,
              data: encoded
            }
          ],
          clientTime: timestamp
        })
        const resultPayload = isPlainObject(result) ? result : null
        const accepted = resultPayload?.accepted === true
        if (!accepted) {
          const reason =
            typeof resultPayload?.reason === 'string'
              ? resultPayload.reason
              : 'REJECTED'

          const existingRevision =
            typeof resultPayload?.revision === 'number'
              ? resultPayload.revision
              : baseRevision

          const expectedRevision =
            typeof resultPayload?.expected === 'number'
              ? resultPayload.expected
              : existingRevision + 1

          const conflictDetails =
            reason === 'REVISION_CONFLICT'
              ? toConflictState(resultPayload?.conflict, {
                  message: DEFAULT_CONFLICT_MESSAGE,
                  baseRevision,
                  attemptedRevision: nextRevision,
                  existingRevision,
                  expectedRevision,
                  clientId: null,
                  sessionId: null,
                  timestamp
                })
              : null

          const errorMessage =
            conflictDetails?.message ??
            (typeof reason === 'string' ? reason : 'applyOps failed')

          set((prev) => {
            const existing = prev.pendingOps[key] ?? []
            const filtered = existing.filter((op) => op.rev !== nextRevision)
            return {
              ...prev,
              error: errorMessage,
              pendingOps: {
                ...prev.pendingOps,
                [key]: filtered
              },
              conflicts: conflictDetails
                ? {
                    ...prev.conflicts,
                    [key]: conflictDetails
                  }
                : {
                    ...prev.conflicts,
                    [key]: null
                  }
            }
          })

          clearDocState(key)
          clearApplyQueue(key)
          void get().selectDoc(key)
          return
        }

        set((prev) => {
          const existing = prev.pendingOps[key] ?? []
          const filtered = existing.filter((op) => op.rev !== nextRevision)
          return {
            ...prev,
            pendingOps: {
              ...prev.pendingOps,
              [key]: filtered
            },
            conflicts: {
              ...prev.conflicts,
              [key]: null
            }
          }
        })

        const nextState = get()
        persistDocStateEntry(
          key,
          nextState.currentUpdate,
          nextState.pendingOps[key] ?? []
        )
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) })
        set((prev) => {
          const existing = prev.pendingOps[key] ?? []
          const filtered = existing.filter((op) => op.rev !== pendingEntry.rev)
          return {
            ...prev,
            pendingOps: {
              ...prev.pendingOps,
              [key]: filtered
            },
            conflicts: {
              ...prev.conflicts,
              [key]: null
            }
          }
        })
        clearDocState(key)
        clearApplyQueue(key)
        void get().selectDoc(key)
      }
    }

    return await enqueueApplyTask(key, send)
  },
  resyncDoc: async (key) => {
    if (!key) return

    clearDocState(key)
    clearApplyQueue(key)

    set((state) => ({
      conflicts: {
        ...state.conflicts,
        [key]: null
      },
      pendingOps: {
        ...state.pendingOps,
        [key]: []
      },
      error: null
    }))

    try {
      await get().selectDoc(key)
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  },
  forkDocFromConflict: async (key) => {
    if (!key) return

    const state = get()
    const current = state.currentUpdate
    if (!current || current.key !== key) {
      throw new Error('Open the document before forking')
    }

    const sourceSnapshot = sanitizeDocSnapshot(current.snapshot)
    const sourceTitle =
      typeof current.title === 'string' && current.title.length > 0
        ? current.title
        : 'Untitled document'
    const forkTitle = `${sourceTitle} (Fork)`

    clearDocState(key)
    clearApplyQueue(key)

    set((prev) => ({
      conflicts: {
        ...prev.conflicts,
        [key]: null
      },
      pendingOps: {
        ...prev.pendingOps,
        [key]: []
      }
    }))

    try {
      const rpc = getRpc()
      const response = await rpc.createDoc({ title: forkTitle })
      const doc = response?.doc
      if (!doc) {
        throw new Error('Failed to create forked document')
      }

      set((prev) => ({
        docs: [
          doc,
          ...prev.docs.filter((existing) => existing.key !== doc.key)
        ],
        error: null
      }))

      await get().selectDoc(doc.key)
      await waitForDocActivation(doc.key, get)
      await get().applySnapshot(doc.key, sourceSnapshot)
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
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
      throw error
    }
  },
  refreshInvites: async (options) => {
    const key = get().activeDoc
    if (!key) return null
    return await get().loadInvites(key, options)
  },
  createDocInvite: async (options) => {
    const key = get().activeDoc
    if (!key) {
      throw new Error('Select a document before creating invites')
    }

    const rawRoles = Array.isArray(options?.roles) ? options.roles : []
    const normalizedRoles = Array.from(
      new Set(
        [DOC_VIEWER_ROLE]
          .concat(
            rawRoles
              .filter((role) => typeof role === 'string' && role.length > 0)
              .map((role) => role.trim())
          )
          .filter((role) => role.length > 0)
      )
    )

    const rpc = getRpc()
    const response = await rpc.createInvite({
      key,
      roles: normalizedRoles,
      expiresAt: options?.expiresAt
    })

    await get().loadInvites(key, { includeRevoked: false })

    return response
  },
  revokeDocInvite: async ({ inviteId }) => {
    const key = get().activeDoc
    if (!key) {
      throw new Error('Select a document before revoking invites')
    }
    if (!inviteId) {
      throw new Error('Invite id is required to revoke an invite')
    }

    const rpc = getRpc()
    await rpc.revokeInvite({ key, inviteId })
    await get().loadInvites(key, { includeRevoked: false })
  }
}))

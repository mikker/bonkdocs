import { create } from 'zustand'
import { rpc } from '../lib/rpc'

type DocSnapshot = {
  type: string
  content?: unknown[]
  [key: string]: unknown
}

type DocPresence = {
  id?: string | null
  writerKey?: string | null
  sessionId?: string | null
  displayName?: string | null
  color?: string | null
  updatedAt?: number | null
  payload?: unknown
}

type DocCapabilities = {
  canEdit?: boolean
  canComment?: boolean
  canInvite?: boolean
  roles?: string[]
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
  presence?: DocPresence[] | null
  capabilities?: DocCapabilities | null
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
}

type DocUpdate = {
  key: string
  revision: number
  updatedAt?: number
  title?: string | null
  snapshotRevision?: number | null
  snapshot: DocSnapshot
  rawSnapshot: Uint8Array | null
  snapshotHash: string
  presence?: DocPresence[] | null
  capabilities?: DocCapabilities | null
}

type DocWatcher = {
  stop: (() => Promise<void> | void) | null
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
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  selectDoc: (key: string | null) => Promise<void>
  createDoc: (title?: string) => Promise<void>
  applySnapshot: (key: string, snapshot: DocSnapshot) => Promise<void>
}

const textDecoder = new TextDecoder()
const textEncoder = new TextEncoder()

const EMPTY_SNAPSHOT: DocSnapshot = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
}

function isPlainObject(
  value: unknown
): value is Record<string | number | symbol, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

function encodeReplaceOperation(doc: DocSnapshot): Uint8Array {
  const payload = { type: 'replace', doc }
  return textEncoder.encode(JSON.stringify(payload))
}

function normalizeSnapshot(value: unknown): {
  json: DocSnapshot
  buffer: Uint8Array | null
} {
  if (value == null) {
    return { json: EMPTY_SNAPSHOT, buffer: null }
  }

  if (typeof value === 'object' && value !== null) {
    if (value instanceof Uint8Array) {
      const data = value
      try {
        const decoded = textDecoder.decode(data)
        const parsed = JSON.parse(decoded)
        if (parsed && typeof parsed === 'object') {
          return { json: sanitizeDocSnapshot(parsed), buffer: data }
        }
      } catch {
        return { json: EMPTY_SNAPSHOT, buffer: data }
      }
      return { json: EMPTY_SNAPSHOT, buffer: data }
    }

    if (isPlainObject(value) && typeof value.type === 'string') {
      return { json: sanitizeDocSnapshot(value), buffer: null }
    }
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object') {
        return { json: sanitizeDocSnapshot(parsed), buffer: null }
      }
    } catch {}
  }

  return { json: EMPTY_SNAPSHOT, buffer: null }
}

function normalizeDocUpdate(update: RawDocUpdate): DocUpdate {
  const key = typeof update.key === 'string' ? update.key : ''
  const revision =
    typeof update.revision === 'number'
      ? update.revision
      : Number(update.revision || 0) || 0
  const updatedAt =
    typeof update.updatedAt === 'number'
      ? update.updatedAt
      : update.updatedAt != null
        ? Number(update.updatedAt)
        : undefined
  const snapshotRevision =
    typeof update.snapshotRevision === 'number'
      ? update.snapshotRevision
      : update.snapshotRevision != null
        ? Number(update.snapshotRevision)
        : null
  const title =
    typeof update.title === 'string'
      ? update.title
      : update.title === null
        ? null
        : undefined

  const { json: snapshot, buffer } = normalizeSnapshot(update.snapshot)
  const snapshotHash = JSON.stringify(snapshot)

  const presence = Array.isArray(update.presence)
    ? update.presence.map((entry) => ({ ...entry }))
    : null

  const capabilities =
    update.capabilities && typeof update.capabilities === 'object'
      ? { ...update.capabilities }
      : null

  return {
    key,
    revision,
    updatedAt,
    title,
    snapshotRevision,
    snapshot,
    rawSnapshot: buffer,
    snapshotHash,
    presence,
    capabilities
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
  initialize: async () => {
    if (get().loading) return

    set({ loading: true, error: null })

    try {
      const response = await rpc.initialize({})
      const docs = response?.docs ?? []
      const activeDoc = response?.activeDoc ?? null

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
      const response = await rpc.listDocs({})
      const docs = response?.docs ?? []
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

    set({ activeDoc: key, currentUpdate: null, watcher: null })

    if (!key) return

    try {
      const stream = rpc.watchDoc({
        key,
        includeSnapshot: true
      })

      const watcher: DocWatcher = {
        stop: async () => {
          stream.destroy()
        }
      }

      set({ watcher })

      stream.on('data', (payload: RawDocUpdate) => {
        const update = normalizeDocUpdate(payload)
        set((state) => ({
          currentUpdate: update,
          docs: state.docs.map((doc) =>
            doc.key === update.key
              ? {
                  ...doc,
                  title: update.title ?? doc.title,
                  lastRevision: update.revision,
                  lastOpenedAt: update.updatedAt ?? Date.now()
                }
              : doc
          )
        }))
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
    try {
      const response = await rpc.createDoc({ title: title || null })
      const doc = response?.doc
      if (doc) {
        set((state) => ({
          docs: [
            doc,
            ...state.docs.filter((existing) => existing.key !== doc.key)
          ]
        }))
        await get().selectDoc(doc.key)
      }
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
  applySnapshot: async (key, snapshot) => {
    const state = get()
    const current = state.currentUpdate
    if (!current || current.key !== key) return

    const sanitized = sanitizeDocSnapshot(snapshot)
    const snapshotHash = JSON.stringify(sanitized)

    if (snapshotHash === current.snapshotHash) {
      return
    }
    const baseRevision = current.revision
    const nextRevision = baseRevision + 1
    const timestamp = Date.now()
    const encoded = encodeReplaceOperation(sanitized)

    set((prev) => {
      if (!prev.currentUpdate || prev.currentUpdate.key !== key) return prev
      return {
        ...prev,
        currentUpdate: {
          ...prev.currentUpdate,
          snapshot: sanitized,
          rawSnapshot: encoded,
          snapshotHash,
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
        )
      }
    })

    try {
      await rpc.applyOps({
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
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  }
}))

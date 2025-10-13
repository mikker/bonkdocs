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
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  selectDoc: (key: string | null) => Promise<void>
  createDoc: (title?: string) => Promise<void>
}

const textDecoder = new TextDecoder()

const EMPTY_SNAPSHOT: DocSnapshot = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '' }]
    }
  ]
}

function normalizeSnapshot(value: unknown): {
  json: DocSnapshot
  buffer: Uint8Array | null
} {
  if (value == null) {
    return { json: EMPTY_SNAPSHOT, buffer: null }
  }

  if (typeof value === 'object' && value !== null) {
    if ('type' in (value as Record<string, unknown>)) {
      return { json: value as DocSnapshot, buffer: null }
    }
    if (value instanceof Uint8Array) {
      const data = value
      try {
        const decoded = textDecoder.decode(data)
        const parsed = JSON.parse(decoded)
        if (parsed && typeof parsed === 'object') {
          return { json: parsed as DocSnapshot, buffer: data }
        }
      } catch {
        return { json: EMPTY_SNAPSHOT, buffer: data }
      }
      return { json: EMPTY_SNAPSHOT, buffer: data }
    }
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object') {
        return { json: parsed as DocSnapshot, buffer: null }
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
      await currentWatcher.stop().catch(() => {})
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
  }
}))

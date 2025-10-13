import { create } from 'zustand'
import { rpc } from '../lib/rpc'

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
  title?: string
  [key: string]: unknown
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

      stream.on('data', (update: DocUpdate) => {
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

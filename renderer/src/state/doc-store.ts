import { create } from 'zustand'
import { rpc } from '../lib/rpc'
import {
  fingerprintText,
  createDeltaPayload,
  decodeDeltaPayload,
  applyDeltaSteps
} from '../../../lib/snapshot-delta.js'
import { loadDocState, saveDocState, clearDocState } from './doc-persistence'

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
  snapshotText: string
  rawSnapshot: Uint8Array | null
  snapshotHash: string
  presence?: DocPresence[] | null
  capabilities?: DocCapabilities | null
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
    pending
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

  const presence = Array.isArray(update.presence)
    ? update.presence.map((entry) => ({ ...entry }))
    : sameDoc && previous?.presence
      ? previous.presence
      : null

  const capabilities =
    update.capabilities && typeof update.capabilities === 'object'
      ? { ...update.capabilities }
      : sameDoc && previous?.capabilities
        ? previous.capabilities
        : null

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
  pendingOps: {},
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

    const cached = loadDocState(key)
    let sinceRevision = 0

    if (cached) {
      const cachedSnapshot = parseSnapshotText(cached.snapshotText)
      const fingerprint = snapshotFingerprint(cachedSnapshot)
      sinceRevision = Number.isFinite(cached.revision) ? cached.revision : 0
      const pending = normalizePendingEntries(cached.pending)

      set((state) => {
        const existingDoc = state.docs.find((doc) => doc.key === key)
        const updatedDocs = state.docs.map((doc) =>
          doc.key === key
            ? {
                ...doc,
                lastRevision: sinceRevision,
                lastOpenedAt: Date.now()
              }
            : doc
        )

        return {
          docs: existingDoc ? updatedDocs : state.docs,
          currentUpdate: {
            key,
            revision: sinceRevision,
            updatedAt: Date.now(),
            title: existingDoc?.title ?? state.currentUpdate?.title,
            snapshotRevision: sinceRevision,
            snapshot: cachedSnapshot,
            snapshotText: fingerprint.text,
            rawSnapshot: textEncoder.encode(fingerprint.text),
            snapshotHash: fingerprint.hash,
            presence: state.currentUpdate?.presence ?? null,
            capabilities: state.currentUpdate?.capabilities ?? null
          },
          pendingOps: {
            ...state.pendingOps,
            [key]: pending
          }
        }
      })
    } else {
      set((state) => ({
        pendingOps: {
          ...state.pendingOps,
          [key]: []
        }
      }))
    }

    try {
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
        set((state) => {
          const update = normalizeDocUpdate(payload, state.currentUpdate)
          nextUpdate = update
          const existingPending = state.pendingOps[update.key] ?? []
          const remaining = existingPending.filter(
            (op) => op.rev > update.revision
          )
          nextPending = remaining
          return {
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
            ),
            pendingOps: {
              ...state.pendingOps,
              [update.key]: remaining
            }
          }
        })

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

    try {
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
      if (!result?.accepted) {
        const reason =
          (result && 'reason' in result && result.reason) || 'REJECTED'
        set((prev) => {
          const existing = prev.pendingOps[key] ?? []
          const filtered = existing.filter((op) => op.rev !== nextRevision)
          return {
            ...prev,
            error: typeof reason === 'string' ? reason : 'applyOps failed',
            pendingOps: {
              ...prev.pendingOps,
              [key]: filtered
            }
          }
        })
        clearDocState(key)
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
          }
        }
      })
      clearDocState(key)
      void get().selectDoc(key)
    }
  }
}))

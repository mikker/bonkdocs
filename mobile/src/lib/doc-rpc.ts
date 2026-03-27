import { getRpc } from './rpc'

export type MobileDocRecord = {
  key: string
  title?: string | null
  createdAt?: number
  joinedAt?: number | null
  lockedAt?: number | null
  lastRevision?: number | null
}

export type MobilePairStatus = {
  state: string
  message: string | null
  progress: number | null
  doc: MobileDocRecord | null
  writerKey: string | null
}

export type MobileDocView = {
  key: string
  title: string
  revision: number
  updatedAt: number | null
  lockedAt: number | null
  lockedBy: string | null
  roles: string[]
  canEdit: boolean
  canInvite: boolean
}

type RpcDocUpdate = {
  key?: string
  title?: string | null
  revision?: number
  updatedAt?: number | null
  writerKey?: string | null
  lockedAt?: number | null
  lockedBy?: string | null
  syncUpdate?: Uint8Array | ArrayBuffer | null
  awareness?: Uint8Array | ArrayBuffer | null
  updates?: Array<{
    data?: Uint8Array | ArrayBuffer | null
    [key: string]: unknown
  }> | null
  capabilities?: {
    canEdit?: boolean
    canInvite?: boolean
    roles?: string[]
  } | null
}

function asDocRecord(value: unknown): MobileDocRecord | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (typeof candidate.key !== 'string' || candidate.key.length === 0) {
    return null
  }

  return {
    key: candidate.key,
    title: typeof candidate.title === 'string' ? candidate.title : null,
    createdAt:
      typeof candidate.createdAt === 'number' ? candidate.createdAt : undefined,
    joinedAt:
      typeof candidate.joinedAt === 'number' ? candidate.joinedAt : null,
    lockedAt:
      typeof candidate.lockedAt === 'number' ? candidate.lockedAt : null,
    lastRevision:
      typeof candidate.lastRevision === 'number' ? candidate.lastRevision : null
  }
}

export async function initializeDocs() {
  const rpc = getRpc()
  const response = await rpc.initialize({})
  return Array.isArray(response?.docs)
    ? response.docs.map(asDocRecord).filter(Boolean)
    : []
}

export async function createDoc(title?: string | null) {
  const rpc = getRpc()
  const response = await rpc.createDoc({ title: title || null })
  const doc = asDocRecord(response?.doc)
  if (!doc) {
    throw new Error('Create doc response missing document')
  }
  return doc
}

export async function getDoc(key: string) {
  const rpc = getRpc()
  const response = await rpc.getDoc({ key })
  return asDocRecord(response?.doc)
}

export async function renameDoc(key: string, title: string) {
  const rpc = getRpc()
  const response = await rpc.renameDoc({ key, title: title || null })

  return {
    key,
    title:
      typeof response?.title === 'string' && response.title.trim().length > 0
        ? response.title
        : 'Untitled document',
    updatedAt:
      typeof response?.updatedAt === 'number' ? response.updatedAt : null
  }
}

export async function abandonDoc(key: string) {
  const rpc = getRpc()
  const response = await rpc.removeDoc({ key })

  if (response?.removed !== true) {
    throw new Error('Failed to abandon document')
  }
}

export async function createDocInvite(key: string, roles: string[] = []) {
  const rpc = getRpc()
  const response = await rpc.createInvite({
    key,
    roles
  })

  if (!response?.invite) {
    throw new Error('Invite response missing data')
  }

  return {
    invite: response.invite,
    inviteId:
      typeof response.inviteId === 'string' ? response.inviteId : undefined
  }
}

export async function joinDoc(invite: string, title?: string | null) {
  const rpc = getRpc()
  const response = await rpc.joinDoc({ invite, title: title || null })
  const doc = asDocRecord(response?.doc)
  if (!doc) {
    throw new Error('Join doc response missing document')
  }
  return doc
}

export function pairInvite(invite: string) {
  return getRpc().pairInvite({ invite })
}

export function watchDoc(key: string, stateVector?: Uint8Array) {
  return getRpc().watchDoc({
    key,
    stateVector: stateVector && stateVector.length > 0 ? stateVector : undefined
  })
}

export async function applyDocUpdates(key: string, update: Uint8Array) {
  return await getRpc().applyUpdates({
    key,
    updates: [
      {
        clientId: 'mobile-webview',
        timestamp: Date.now(),
        data: update
      }
    ]
  })
}

export async function applyDocAwareness(key: string, update: Uint8Array) {
  return await getRpc().applyAwareness({
    key,
    update
  })
}

export function normalizePairStatus(value: unknown): MobilePairStatus {
  if (!value || typeof value !== 'object') {
    return {
      state: 'unknown',
      message: null,
      progress: null,
      doc: null,
      writerKey: null
    }
  }

  const candidate = value as Record<string, unknown>
  return {
    state: typeof candidate.state === 'string' ? candidate.state : 'unknown',
    message:
      typeof candidate.message === 'string' && candidate.message.length > 0
        ? candidate.message
        : null,
    progress:
      typeof candidate.progress === 'number' ? candidate.progress : null,
    doc: asDocRecord(candidate.doc),
    writerKey:
      typeof candidate.writerKey === 'string' && candidate.writerKey.length > 0
        ? candidate.writerKey
        : null
  }
}

export function normalizeDocUpdate(
  key: string,
  value: unknown,
  fallbackTitle: string
): MobileDocView {
  const candidate =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const capabilities =
    candidate.capabilities && typeof candidate.capabilities === 'object'
      ? (candidate.capabilities as Record<string, unknown>)
      : {}
  const rawRoles = Array.isArray(capabilities.roles) ? capabilities.roles : []

  return {
    key,
    title:
      typeof candidate.title === 'string' && candidate.title.trim().length > 0
        ? candidate.title
        : fallbackTitle,
    revision: typeof candidate.revision === 'number' ? candidate.revision : 0,
    updatedAt:
      typeof candidate.updatedAt === 'number' ? candidate.updatedAt : null,
    lockedAt:
      typeof candidate.lockedAt === 'number' ? candidate.lockedAt : null,
    lockedBy:
      typeof candidate.lockedBy === 'string' ? candidate.lockedBy : null,
    roles: rawRoles.filter(
      (role): role is string => typeof role === 'string' && role.length > 0
    ),
    canEdit: capabilities.canEdit === true,
    canInvite: capabilities.canInvite === true
  }
}

export function serializeDocUpdate(value: unknown): RpcDocUpdate | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>

  const updates = Array.isArray(candidate.updates)
    ? candidate.updates
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null
          const record = entry as Record<string, unknown>
          const data = toBinaryUpdate(record.data)
          return data ? { ...record, data } : null
        })
        .filter(Boolean)
    : null

  return {
    key: typeof candidate.key === 'string' ? candidate.key : undefined,
    title:
      typeof candidate.title === 'string' || candidate.title === null
        ? candidate.title
        : undefined,
    revision:
      typeof candidate.revision === 'number' ? candidate.revision : undefined,
    updatedAt:
      typeof candidate.updatedAt === 'number' ? candidate.updatedAt : null,
    writerKey:
      typeof candidate.writerKey === 'string' ? candidate.writerKey : null,
    lockedAt:
      typeof candidate.lockedAt === 'number' ? candidate.lockedAt : null,
    lockedBy:
      typeof candidate.lockedBy === 'string' ? candidate.lockedBy : null,
    syncUpdate: toBinaryUpdate(candidate.syncUpdate),
    awareness: toBinaryUpdate(candidate.awareness),
    updates,
    capabilities:
      candidate.capabilities && typeof candidate.capabilities === 'object'
        ? {
            canEdit:
              (candidate.capabilities as Record<string, unknown>).canEdit ===
              true,
            canInvite:
              (candidate.capabilities as Record<string, unknown>).canInvite ===
              true,
            roles: Array.isArray(
              (candidate.capabilities as Record<string, unknown>).roles
            )
              ? (
                  (candidate.capabilities as Record<string, unknown>)
                    .roles as unknown[]
                ).filter(
                  (role): role is string =>
                    typeof role === 'string' && role.length > 0
                )
              : []
          }
        : null
  }
}

function toBinaryUpdate(value: unknown) {
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (Array.isArray(value)) {
    return Uint8Array.from(
      value.filter((entry): entry is number => typeof entry === 'number')
    )
  }
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>
    if (Array.isArray(candidate.data)) {
      return Uint8Array.from(
        candidate.data.filter(
          (entry): entry is number => typeof entry === 'number'
        )
      )
    }
    const numericEntries = Object.entries(candidate)
      .filter(([key, entry]) => /^\d+$/.test(key) && typeof entry === 'number')
      .sort((left, right) => Number(left[0]) - Number(right[0]))
      .map(([, entry]) => entry)
    if (numericEntries.length > 0) {
      return Uint8Array.from(numericEntries)
    }
  }
  return null
}

export function mergeDocs(
  docs: MobileDocRecord[],
  nextDoc: MobileDocRecord
): MobileDocRecord[] {
  return [nextDoc, ...docs.filter((doc) => doc.key !== nextDoc.key)]
}

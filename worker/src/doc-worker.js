import { mkdir } from 'fs/promises'

import { DocManager } from '../../core/doc-manager.js'
import { ensurePear } from '../../lib/pear-env.js'
ensurePear()
import z32 from 'z32'
import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate
} from 'y-protocols/awareness'
import {
  DEFAULT_TITLE,
  PERMISSIONS,
  ROLE_OWNER,
  ROLE_EDITOR,
  ROLE_VIEWER
} from '../../core/constants.js'

const APP_STATE_KEY = 'state/app'

const bufferToHex = (buf) =>
  Buffer.isBuffer(buf) ? Buffer.from(buf).toString('hex') : buf || ''

const hexToBuffer = (hex) => {
  if (typeof hex !== 'string' || hex.length === 0) return Buffer.alloc(0)
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`
  try {
    return Buffer.from(normalized, 'hex')
  } catch {
    return Buffer.alloc(0)
  }
}

function buffersEqual(a, b) {
  if (!a || !b) return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  for (let i = 0; i < bufA.length; i++) {
    if (bufA[i] !== bufB[i]) return false
  }
  return true
}

const SNAPSHOT_OPS_INTERVAL = 50
const SNAPSHOT_TIME_INTERVAL = 60_000
const REMOTE_ORIGIN = 'remote'

function toUint8Array(value) {
  if (!value) return null
  if (value instanceof Uint8Array) return value
  if (Buffer.isBuffer(value)) return new Uint8Array(value)
  return null
}

function isCoreClosingError(error) {
  if (!error) return false
  if (error.code === 'SESSION_CLOSED') return true
  const message = typeof error.message === 'string' ? error.message : ''
  return (
    message.includes('Autobase is closing') ||
    message.includes('core is closing') ||
    message.includes('closing core')
  )
}

export class DocWorker {
  constructor(options = {}) {
    this.baseDir = options.baseDir
    this.watchers = new Map()
    this.syncs = new Map()
    this.syncQueues = new Map()
    this.subscriptions = new Map()

    if (options.ensureStorage !== false) {
      void mkdir(this.baseDir, { recursive: true }).catch(() => {})
    }

    this.manager = new DocManager(this.baseDir, {
      bootstrap: options.bootstrap,
      autobase: options.autobase
    })
  }

  async ready() {
    await this.manager.ready()
  }

  async close() {
    for (const watchers of this.watchers.values()) {
      for (const watcher of watchers) {
        watcher.closed = true
        try {
          watcher.unsubscribe?.()
        } catch {}
      }
    }
    this.watchers.clear()
    for (const unsubscribe of this.subscriptions.values()) {
      try {
        unsubscribe()
      } catch {}
    }
    this.subscriptions.clear()
    this.syncs.clear()
    this.syncQueues.clear()
    await this.manager.close()
  }

  async listDocs() {
    await this.ready()
    const records = await this.manager.listDocs()
    return records.map((record) => this.normalizeDocRecord(record))
  }

  async createDoc(options = {}) {
    await this.ready()
    const context = await this.manager.createDoc({
      title: options.title,
      description: options.description
    })

    const keyHex = bufferToHex(context.key)
    const stored = await this._getStoredContextRecord(keyHex)
    const metadata = await context.getMetadata()
    const fallback = stored || {
      key: keyHex,
      encryptionKey: bufferToHex(context.encryptionKey),
      createdAt: metadata?.createdAt || Date.now(),
      joinedAt: metadata?.createdAt || Date.now(),
      isCreator: true
    }
    const docRecord = this.normalizeDocRecord(fallback, metadata)

    try {
      const sync = await this._ensureSync(context)
      await this._persistSnapshot(context, sync, { force: true })
    } catch (error) {
      console.warn('[doc-worker] failed to record initial snapshot', error)
    }

    return {
      doc: docRecord,
      writerKey: bufferToHex(context.writerKey)
    }
  }

  async joinDoc(options = {}) {
    if (!options.invite) throw new Error('Invite is required to join doc')

    await this.ready()

    const context = await this.manager.joinDoc(options.invite, {
      name: options.title
    })

    const keyHex = bufferToHex(context.key)
    const stored = await this._getStoredContextRecord(keyHex)
    const metadata = await context.getMetadata()
    const fallback = stored || {
      key: keyHex,
      encryptionKey: bufferToHex(context.encryptionKey),
      createdAt: metadata?.createdAt || Date.now(),
      joinedAt: Date.now(),
      isCreator: false
    }
    const docRecord = this.normalizeDocRecord(fallback, metadata)

    return {
      doc: docRecord,
      writerKey: bufferToHex(context.writerKey)
    }
  }

  async removeDoc(keyHex) {
    await this.ready()
    return await this.manager.removeDoc(keyHex)
  }

  async getDoc(keyHex) {
    await this.ready()
    const context = await this.manager.getDoc(keyHex)
    if (!context) return null

    const stored = await this._getStoredContextRecord(keyHex)
    const metadata = await context.getMetadata()
    const fallback = stored || {
      key: keyHex,
      encryptionKey: bufferToHex(context.encryptionKey),
      createdAt: metadata?.createdAt || Date.now(),
      joinedAt: metadata?.createdAt || Date.now(),
      isCreator: !!stored?.isCreator
    }

    return this.normalizeDocRecord(fallback, metadata)
  }

  async renameDoc(request = {}) {
    await this.ready()

    if (!request.key) {
      throw new Error('Doc key is required to rename')
    }

    const context = await this.manager.getDoc(request.key)
    if (!context) {
      throw new Error('Doc not found')
    }

    const inputTitle =
      typeof request.title === 'string' ? request.title.trim() : ''
    const nextTitle =
      inputTitle.length > 0 ? inputTitle.slice(0, 256) : DEFAULT_TITLE

    const metadata = await context.updateMetadata({ title: nextTitle })

    return {
      key: request.key,
      title: metadata?.title || nextTitle,
      updatedAt: metadata?.updatedAt || Date.now(),
      rev: metadata?.rev || null
    }
  }

  async lockDoc(request = {}) {
    await this.ready()

    if (!request.key) {
      throw new Error('Doc key is required to lock')
    }

    const context = await this.manager.getDoc(request.key)
    if (!context) {
      throw new Error('Doc not found')
    }

    const metadata = await context.lockDoc({})

    return {
      key: request.key,
      lockedAt: metadata?.lockedAt || Date.now(),
      lockedBy: metadata?.lockedBy
        ? bufferToHex(metadata.lockedBy)
        : bufferToHex(context.writerKey),
      rev: metadata?.rev || null
    }
  }

  async watchDoc(keyHex, options = {}, onUpdate) {
    await this.ready()

    const context = await this.manager.getDoc(keyHex)
    if (!context) throw new Error('Doc not found')

    const sync = await this._ensureSync(context)
    await this._refreshSync(context, sync)

    const watcherEntry = {
      closed: false,
      emit: onUpdate
    }

    const set = this._getWatcherSet(keyHex)
    set.add(watcherEntry)

    if (!this.subscriptions.has(keyHex)) {
      const unsubscribe = context.subscribe(() => {
        this._queueBroadcast(context)
      })
      this.subscriptions.set(keyHex, unsubscribe)
    }

    const stateVector = toUint8Array(options.stateVector)
    const rawSyncUpdate =
      stateVector && stateVector.length > 0
        ? Y.encodeStateAsUpdate(sync.doc, stateVector)
        : Y.encodeStateAsUpdate(sync.doc)
    const syncUpdate =
      rawSyncUpdate && rawSyncUpdate.length > 0 ? rawSyncUpdate : null

    const awarenessUpdate = encodeAwarenessUpdate(
      sync.awareness,
      Array.from(sync.awareness.getStates().keys())
    )

    const update = await this.buildDocUpdate(context, sync, {
      syncUpdate,
      awareness: awarenessUpdate
    })
    await onUpdate(update)

    return async () => {
      if (watcherEntry.closed) return
      watcherEntry.closed = true
      set.delete(watcherEntry)

      if (set.size === 0) {
        const unsubscribe = this.subscriptions.get(keyHex)
        if (unsubscribe) {
          try {
            unsubscribe()
          } catch {}
        }
        this.subscriptions.delete(keyHex)
      }
    }
  }

  async applyUpdates(request = {}) {
    if (!request.key) throw new Error('Doc key is required')
    const updates = Array.isArray(request.updates) ? request.updates : []
    if (updates.length === 0) {
      return { accepted: false, revision: null, error: 'NO_UPDATES' }
    }

    await this.ready()

    const context = await this.manager.getDoc(request.key)
    if (!context) throw new Error('Doc not found')

    const metadata = await context.getMetadata()
    if (
      metadata &&
      typeof metadata.lockedAt === 'number' &&
      metadata.lockedAt > 0
    ) {
      throw new Error('Document is locked')
    }

    let accepted = false

    for (const entry of updates) {
      if (!entry || typeof entry !== 'object') continue
      const clientId =
        typeof entry.clientId === 'string' && entry.clientId.length > 0
          ? entry.clientId
          : 'unknown'
      const timestamp =
        typeof entry.timestamp === 'number' && entry.timestamp > 0
          ? entry.timestamp
          : Date.now()
      const data = entry.data
      if (!data) continue
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data)
      await context.appendUpdate({
        clientId,
        timestamp,
        data: buffer
      })
      accepted = true
    }

    const latest = await context.getLatestRevision()
    return {
      accepted,
      revision: latest || 0
    }
  }

  async applyAwareness(request = {}) {
    if (!request.key) throw new Error('Doc key is required')
    if (!request.update) return { accepted: false }

    await this.ready()

    const context = await this.manager.getDoc(request.key)
    if (!context) throw new Error('Doc not found')

    const sync = await this._ensureSync(context)
    const update = toUint8Array(request.update)
    if (!update) return { accepted: false }

    applyAwarenessUpdate(sync.awareness, update, REMOTE_ORIGIN)
    await this._broadcastAwareness(context, sync, update)

    return { accepted: true }
  }

  async pairInvite(options = {}, emit, signal) {
    await this.ready()

    if (!options.invite) {
      throw new Error('Invite is required to pair document')
    }

    const manager = this.manager
    const schema = manager.schema
    const bootstrap = manager.bootstrap
    const autobase = manager.autobase
    const namespace = `temp-pair-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
    const tempStore = manager.corestore.namespace(namespace)
    const pairer = manager.ContextClass.pair(tempStore, options.invite, {
      schema,
      bootstrap,
      autobase
    })

    let aborted = false

    const safeEmit = async (status) => {
      if (aborted) return
      await emit(status)
    }

    const handleAbort = () => {
      if (aborted) return
      aborted = true
      void safeEmit({ state: 'cancelled', message: 'Pairing cancelled' })
      void pairer.close().catch(() => {})
    }

    if (signal) {
      if (signal.aborted) {
        handleAbort()
        return
      }
      signal.addEventListener('abort', handleAbort, { once: true })
    }

    await safeEmit({
      state: 'pairing',
      message: 'Resolving invite',
      progress: 10
    })

    let candidate = null
    let announced = false

    const onAnnounce = async () => {
      if (announced || aborted) return
      announced = true
      await safeEmit({
        state: 'pairing',
        message: 'Announcing invite to peers',
        progress: 40
      })
    }

    try {
      if (typeof pairer.ready === 'function') {
        await pairer.ready()
      }

      candidate = pairer?.candidate ?? null
      if (candidate?.on) {
        candidate.on('announce', onAnnounce)
      }

      await safeEmit({
        state: 'pairing',
        message: 'Waiting for document host',
        progress: 25
      })

      const provisional = await pairer.resolve()
      if (aborted) {
        try {
          await provisional.close()
        } catch {}
        return
      }

      await safeEmit({
        state: 'pairing',
        message: 'Invite accepted, syncing document',
        progress: 70
      })

      await provisional.ready()

      const key = provisional.key
      const encryptionKey = provisional.encryptionKey
      const keyHex = bufferToHex(key)
      const namespaceFinal = `ctx-${keyHex.slice(0, 16)}`
      const now = Date.now()

      await provisional.close()

      const finalStore = manager.corestore.namespace(namespaceFinal)
      const context = new manager.ContextClass(finalStore, {
        schema,
        key,
        encryptionKey,
        bootstrap,
        autobase
      })

      await context.ready()

      const record = {
        key: keyHex,
        encryptionKey: bufferToHex(encryptionKey),
        createdAt: now,
        joinedAt: now,
        isCreator: false,
        namespace: namespaceFinal
      }

      if (manager.localDb) {
        await manager.localDb.put(`contexts/${keyHex}`, record)
      }

      manager.contexts.set(keyHex, context)

      const metadata = await context.getMetadata()
      const doc = this.normalizeDocRecord(record, metadata)

      await safeEmit({
        state: 'joined',
        message: 'Joined document',
        progress: 100,
        doc,
        writerKey: bufferToHex(context.writerKey)
      })
    } catch (error) {
      if (!aborted) {
        await safeEmit({
          state: 'error',
          message:
            error instanceof Error ? error.message : 'Failed to join document'
        })
        throw error
      }
    } finally {
      if (candidate?.off) {
        candidate.off('announce', onAnnounce)
      }
      if (signal) {
        signal.removeEventListener('abort', handleAbort)
      }
      await pairer.close().catch(() => {})
    }
  }

  async listInvites(keyHex, includeRevoked = false) {
    await this.ready()

    const context = await this.manager.getDoc(keyHex)
    if (!context) {
      throw new Error('Doc not found')
    }

    try {
      const invites = await context.listInvites({ includeRevoked })
      return invites
        .map((invite) => this.normalizeInvite(invite))
        .filter(Boolean)
    } catch (error) {
      console.warn('[doc-worker] failed to list invites', {
        key: keyHex,
        message: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  }

  async createInvite(keyHex, roles = [], expiresAt) {
    await this.ready()

    const context = await this.manager.getDoc(keyHex)
    if (!context) {
      throw new Error('Doc not found')
    }

    const normalizedRoles = Array.isArray(roles)
      ? Array.from(
          new Set(
            roles
              .filter((role) => typeof role === 'string' && role.length > 0)
              .map((role) => role.trim())
          )
        )
      : []

    const inviteString = await context.createInvite({
      roles: normalizedRoles,
      expires:
        typeof expiresAt === 'number' && Number.isFinite(expiresAt)
          ? expiresAt
          : undefined
    })

    let inviteId = ''
    try {
      const decoded = z32.decode(inviteString)
      const invites = await context.listInvites({ includeRevoked: true })
      const match = invites.find((entry) => buffersEqual(entry.invite, decoded))
      inviteId = match ? bufferToHex(match.id) : bufferToHex(decoded)
    } catch (error) {
      console.warn('[doc-worker] failed to resolve invite id', {
        key: keyHex,
        message: error instanceof Error ? error.message : String(error)
      })
    }

    return {
      invite: inviteString,
      inviteId
    }
  }

  async revokeInvite(keyHex, inviteIdHex) {
    await this.ready()

    const context = await this.manager.getDoc(keyHex)
    if (!context) {
      throw new Error('Doc not found')
    }

    const idBuffer = hexToBuffer(inviteIdHex)
    if (idBuffer.length === 0) {
      throw new Error('Invite id is required to revoke invite')
    }

    try {
      return await context.revokeInvite(idBuffer)
    } catch (error) {
      console.warn('[doc-worker] failed to revoke invite', {
        key: keyHex,
        inviteId: inviteIdHex,
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  async readAppState() {
    const localDb = this.manager.localDb
    if (!localDb) return null
    try {
      const record = await localDb.get(APP_STATE_KEY)
      return record?.value ?? record ?? null
    } catch {
      return null
    }
  }

  async _ensureSync(context) {
    const keyHex = bufferToHex(context.key)
    const existing = this.syncs.get(keyHex)
    if (existing && existing.ready) return existing
    if (existing && existing.loading) {
      return await existing.loading
    }

    const sync = {
      doc: new Y.Doc(),
      awareness: null,
      lastRev: 0,
      lastUpdateAt: 0,
      lastSnapshotAt: 0,
      updatesSinceSnapshot: 0,
      loading: null,
      ready: false
    }
    sync.awareness = new Awareness(sync.doc)

    sync.loading = (async () => {
      let snapshotRecord = null
      try {
        snapshotRecord = await context.base.view.findOne(
          '@bonk-docs/snapshots',
          { reverse: true, limit: 1 }
        )
      } catch {}

      if (snapshotRecord?.data) {
        const snapshotUpdate = toUint8Array(snapshotRecord.data)
        if (snapshotUpdate) {
          Y.applyUpdate(sync.doc, snapshotUpdate, REMOTE_ORIGIN)
        }
        if (typeof snapshotRecord.rev === 'number') {
          sync.lastRev = snapshotRecord.rev
        }
        if (typeof snapshotRecord.createdAt === 'number') {
          sync.lastSnapshotAt = snapshotRecord.createdAt
        }
      }

      const cursor = context.base.view.find('@bonk-docs/updates', {
        gt: { rev: sync.lastRev }
      })
      const records = await cursor.toArray()
      for (const record of records) {
        const update = toUint8Array(record?.data)
        if (update) {
          Y.applyUpdate(sync.doc, update, REMOTE_ORIGIN)
        }
        if (typeof record.rev === 'number') {
          sync.lastRev = record.rev
        }
        if (typeof record.timestamp === 'number') {
          sync.lastUpdateAt = Math.max(sync.lastUpdateAt, record.timestamp)
        }
      }

      if (!snapshotRecord) {
        sync.updatesSinceSnapshot = records.length
      }

      sync.ready = true
      sync.loading = null
      return sync
    })()

    this.syncs.set(keyHex, sync)
    return await sync.loading
  }

  async _refreshSync(context, sync) {
    const latest = await context.base.view.findOne('@bonk-docs/updates', {
      reverse: true,
      limit: 1
    })
    const latestRev = typeof latest?.rev === 'number' ? latest.rev : 0
    if (latestRev <= sync.lastRev) {
      return []
    }

    const cursor = context.base.view.find('@bonk-docs/updates', {
      gt: { rev: sync.lastRev },
      lte: { rev: latestRev }
    })
    const records = await cursor.toArray()

    for (const record of records) {
      const update = toUint8Array(record?.data)
      if (update) {
        Y.applyUpdate(sync.doc, update, REMOTE_ORIGIN)
      }
      if (typeof record.timestamp === 'number') {
        sync.lastUpdateAt = Math.max(sync.lastUpdateAt, record.timestamp)
      }
    }

    if (records.length > 0) {
      sync.lastRev = records[records.length - 1].rev
      sync.updatesSinceSnapshot += records.length
      await this._persistSnapshot(context, sync)
    }

    return records
  }

  async _persistSnapshot(context, sync, options = {}) {
    const force = options.force === true
    const now = Date.now()
    const shouldSnapshot =
      force ||
      sync.updatesSinceSnapshot >= SNAPSHOT_OPS_INTERVAL ||
      (sync.lastSnapshotAt > 0 &&
        now - sync.lastSnapshotAt >= SNAPSHOT_TIME_INTERVAL)

    if (!shouldSnapshot) return

    try {
      const update = Y.encodeStateAsUpdate(sync.doc)
      const vector = Y.encodeStateVector(sync.doc)
      await context.recordSnapshot({
        rev: sync.lastRev,
        createdAt: now,
        data: Buffer.from(update),
        stateVector: Buffer.from(vector)
      })
      sync.lastSnapshotAt = now
      sync.updatesSinceSnapshot = 0
    } catch (error) {
      console.warn('[doc-worker] failed to persist snapshot', error)
    }
  }

  _queueBroadcast(context) {
    const keyHex = bufferToHex(context.key)
    const previous = this.syncQueues.get(keyHex) ?? Promise.resolve()
    const next = previous
      .catch(() => {})
      .then(() => this._broadcastUpdates(context))
    this.syncQueues.set(keyHex, next)
  }

  async _broadcastUpdates(context) {
    const keyHex = bufferToHex(context.key)
    const watchers = this.watchers.get(keyHex)
    if (!watchers || watchers.size === 0) return

    const sync = await this._ensureSync(context)
    const updates = await this._refreshSync(context, sync)
    const payload = await this.buildDocUpdate(context, sync, {
      updates: updates.length > 0 ? updates : null
    })

    for (const watcher of watchers) {
      if (watcher.closed) continue
      try {
        await watcher.emit(payload)
      } catch (error) {
        if (isCoreClosingError(error)) {
          watcher.closed = true
        } else {
          console.warn('[doc-worker] failed to emit doc update', error)
        }
      }
    }
  }

  async _broadcastAwareness(context, sync, awarenessUpdate) {
    const keyHex = bufferToHex(context.key)
    const watchers = this.watchers.get(keyHex)
    if (!watchers || watchers.size === 0) return

    const payload = await this.buildDocUpdate(context, sync, {
      awareness: awarenessUpdate
    })

    for (const watcher of watchers) {
      if (watcher.closed) continue
      try {
        await watcher.emit(payload)
      } catch (error) {
        if (isCoreClosingError(error)) {
          watcher.closed = true
        } else {
          console.warn('[doc-worker] failed to emit awareness update', error)
        }
      }
    }
  }

  async buildDocUpdate(context, sync, options = {}) {
    const metadata = await context.getMetadata()
    const revision = typeof sync.lastRev === 'number' ? sync.lastRev : 0
    const roles = await this._listWriterRoles(context)
    const lockedAt =
      metadata && typeof metadata.lockedAt === 'number' && metadata.lockedAt > 0
        ? metadata.lockedAt
        : null
    const lockedByHex =
      metadata && metadata.lockedBy && lockedAt
        ? bufferToHex(metadata.lockedBy)
        : null
    const canEditPermission = await context.hasPermission(
      context.writerKey,
      PERMISSIONS.DOC_EDIT
    )
    const canCommentPermission = await context.hasPermission(
      context.writerKey,
      PERMISSIONS.DOC_COMMENT
    )
    const canInvitePermission = await context.hasPermission(
      context.writerKey,
      PERMISSIONS.DOC_INVITE
    )

    let updatedAt = metadata?.updatedAt || metadata?.createdAt || Date.now()
    if (sync.lastUpdateAt && sync.lastUpdateAt > updatedAt) {
      updatedAt = sync.lastUpdateAt
    }

    const update = {
      key: bufferToHex(context.key),
      revision,
      updatedAt,
      title: metadata?.title || DEFAULT_TITLE,
      capabilities: {
        canEdit: lockedAt ? false : canEditPermission,
        canComment: lockedAt ? false : canCommentPermission,
        canInvite: lockedAt ? false : canInvitePermission,
        roles
      },
      lockedAt,
      lockedBy: lockedByHex
    }

    if (options.syncUpdate && options.syncUpdate.length > 0) {
      update.syncUpdate = Buffer.from(options.syncUpdate)
    }

    if (Array.isArray(options.updates) && options.updates.length > 0) {
      update.updates = options.updates.map((record) => ({
        rev: record.rev,
        clientId: record.clientId,
        timestamp: record.timestamp,
        data: record.data
      }))
    }

    if (options.awareness && options.awareness.length > 0) {
      update.awareness = Buffer.from(options.awareness)
    }

    return update
  }

  normalizeDocRecord(record = {}, metadata = null) {
    if (!record) return null

    const lockedAt =
      metadata && typeof metadata.lockedAt === 'number' && metadata.lockedAt > 0
        ? metadata.lockedAt
        : typeof record.lockedAt === 'number' && record.lockedAt > 0
          ? record.lockedAt
          : null

    const lockedByBuffer =
      metadata && metadata.lockedBy
        ? metadata.lockedBy
        : record.lockedBy && typeof record.lockedBy !== 'string'
          ? record.lockedBy
          : null

    const doc = {
      key: record.key,
      encryptionKey: record.encryptionKey,
      createdAt: record.createdAt,
      joinedAt: record.joinedAt || record.createdAt,
      isCreator: !!record.isCreator,
      title: metadata?.title || record.title || DEFAULT_TITLE,
      lastRevision:
        typeof record.lastRevision === 'number' ? record.lastRevision : 0,
      lastOpenedAt: record.lastOpenedAt || Date.now(),
      lockedAt,
      lockedBy:
        lockedAt && lockedByBuffer
          ? bufferToHex(lockedByBuffer)
          : lockedAt && typeof record.lockedBy === 'string'
            ? record.lockedBy
            : null
    }

    return doc
  }

  async _listWriterRoles(context) {
    const acl = await context.base.view.get('@autobonk/acl-entry', {
      subjectKey: context.writerKey
    })

    if (!acl || !Array.isArray(acl.roles) || acl.roles.length === 0) {
      return [ROLE_VIEWER]
    }

    const normalized = acl.roles.map((role) =>
      typeof role === 'string' ? role : role.toString()
    )
    if (!normalized.includes(ROLE_OWNER) && context.writable) {
      normalized.push(ROLE_OWNER)
    }
    if (!normalized.includes(ROLE_EDITOR) && context.writable) {
      normalized.push(ROLE_EDITOR)
    }
    if (!normalized.includes(ROLE_VIEWER)) {
      normalized.push(ROLE_VIEWER)
    }
    return Array.from(new Set(normalized))
  }

  normalizeInvite(invite = {}) {
    if (!invite || typeof invite !== 'object') {
      return {
        id: '',
        invite: '',
        roles: []
      }
    }

    let inviteString = ''
    try {
      inviteString = invite.invite ? z32.encode(invite.invite) : ''
    } catch {
      inviteString = ''
    }

    const roles = Array.isArray(invite.roles)
      ? invite.roles
          .map((role) =>
            typeof role === 'string'
              ? role
              : role && typeof role.toString === 'function'
                ? role.toString()
                : null
          )
          .filter((role) => typeof role === 'string' && role.length > 0)
      : []

    return {
      id: bufferToHex(invite.id),
      invite: inviteString,
      roles,
      createdBy: invite.createdBy ? bufferToHex(invite.createdBy) : undefined,
      createdAt:
        typeof invite.createdAt === 'number' &&
        Number.isFinite(invite.createdAt)
          ? invite.createdAt
          : undefined,
      revokedAt:
        typeof invite.revokedAt === 'number' &&
        Number.isFinite(invite.revokedAt)
          ? invite.revokedAt
          : undefined,
      expiresAt:
        typeof invite.expires === 'number' && Number.isFinite(invite.expires)
          ? invite.expires
          : undefined
    }
  }

  _getWatcherSet(keyHex) {
    if (!this.watchers.has(keyHex)) {
      this.watchers.set(keyHex, new Set())
    }
    return this.watchers.get(keyHex)
  }

  async _getStoredContextRecord(keyHex) {
    const localDb = this.manager.localDb
    if (!localDb) return null
    try {
      const record = await localDb.get(`contexts/${keyHex}`)
      return record?.value ?? record ?? null
    } catch {
      return null
    }
  }
}

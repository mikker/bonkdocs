import { mkdir, rm } from 'fs/promises'
import { join } from 'path'

import { DocManager } from '../domain/doc-manager.js'
import { ensurePear } from '../../../lib/pear-env.js'
ensurePear()
import { YjsSyncEngine } from 'autobonk-yjs'
import z32 from 'z32'
import * as Y from 'yjs'
import {
  applyAwarenessUpdate,
  encodeAwarenessUpdate
} from 'y-protocols/awareness'
import {
  DEFAULT_TITLE,
  PERMISSIONS,
  ROLE_OWNER,
  ROLE_EDITOR,
  ROLE_VIEWER
} from '../domain/constants.js'
import {
  bufferToHex,
  buffersEqual,
  hexToBuffer,
  toUint8Array
} from '../../../lib/codec.js'

const REMOTE_ORIGIN = 'remote'

function isCoreClosingError(error) {
  if (!error) return false
  if (error.code === 'SESSION_CLOSED') return true
  const message = typeof error.message === 'string' ? error.message : ''
  return (
    message.includes('Hyperdb is closed') ||
    message.includes('HyperDB is closed') ||
    message.includes('Autobase is closing') ||
    message.includes('core is closing') ||
    message.includes('closing core') ||
    message.includes('Database is closed')
  )
}

export class DocWorker {
  constructor(options = {}) {
    this.baseDir = options.baseDir
    this.identityBaseDir = options.identityBaseDir || join(this.baseDir, 'facebonk')
    this.enableIdentity = options.enableIdentity !== false
    this.identityOptions = {
      bootstrap: options.bootstrap,
      autobase: options.autobase
    }
    this.identityManager = null
    this.identityManagerPromise = null
    this.watchers = new Map()
    this.subscriptions = new Map()
    this.syncEngine = new YjsSyncEngine({
      namespace: 'bonk-docs',
      toUint8Array,
      remoteOrigin: REMOTE_ORIGIN,
      onSnapshotError: (error) => {
        console.warn('[doc-worker] failed to persist snapshot', error)
      }
    })

    if (options.ensureStorage !== false) {
      void mkdir(this.baseDir, { recursive: true }).catch(() => {})
    }

    this.manager = new DocManager(this.baseDir, {
      bootstrap: options.bootstrap,
      autobase: options.autobase
    })
  }

  async createIdentityManager() {
    const { IdentityManager } = await import('facebonk/src/index.js')
    return new IdentityManager(this.identityBaseDir, this.identityOptions)
  }

  async getIdentityManager() {
    if (!this.enableIdentity) return null
    if (this.identityManager) return this.identityManager
    if (!this.identityManagerPromise) {
      this.identityManagerPromise = this.createIdentityManager()
        .then(async (manager) => {
          await manager.ready()
          this.identityManager = manager
          this.identityManagerPromise = null
          return manager
        })
        .catch((error) => {
          this.identityManagerPromise = null
          throw error
        })
    }
    return await this.identityManagerPromise
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
    await this.syncEngine.close()
    await this.identityManager?.close()
    await this.manager.close()
  }

  async getIdentity() {
    await this.ready()
    const identityManager = await this.getIdentityManager()
    if (!identityManager) return null
    return await identityManager.getSummary()
  }

  async getIdentityAvatar() {
    await this.ready()

    const identityManager = await this.getIdentityManager()
    if (!identityManager) return null

    const identity = await identityManager.getActiveIdentity()
    if (!identity) return null

    const avatar = await identity.getAvatar()
    if (!avatar?.data || avatar.data.length === 0) return null

    const mimeType =
      typeof avatar.mimeType === 'string' && avatar.mimeType.length > 0
        ? avatar.mimeType
        : 'application/octet-stream'

    return {
      dataUrl: `data:${mimeType};base64,${avatar.data.toString('base64')}`,
      mimeType,
      byteLength: avatar.byteLength ?? avatar.data.length
    }
  }

  async linkIdentity(invite) {
    await this.ready()

    if (typeof invite !== 'string' || invite.trim().length === 0) {
      throw new Error('Identity invite is required')
    }

    const identityManager = await this.getIdentityManager()
    if (!identityManager) {
      throw new Error('Facebonk identity linking is unavailable in this runtime')
    }

    await identityManager.joinIdentity(invite.trim())
    return await identityManager.getSummary()
  }

  async resetIdentity() {
    const identityManager = await this.getIdentityManager()
    if (!identityManager) {
      return { reset: false }
    }

    await identityManager.close()
    await rm(this.identityBaseDir, { recursive: true, force: true })
    await mkdir(this.identityBaseDir, { recursive: true })
    this.identityManager = null
    this.identityManagerPromise = null
    await this.getIdentityManager()
    return { reset: true }
  }

  async listDocs() {
    await this.ready()
    const records = await this.manager.listDocs()
    const docs = []

    for (const record of records) {
      docs.push(await this._resolveDocRecord(record))
    }

    return docs
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
    await this._updateStoredContextRecord(keyHex, {
      title: docRecord?.title || null
    })

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
    await this._updateStoredContextRecord(keyHex, {
      title: docRecord?.title || null
    })

    return {
      doc: docRecord,
      writerKey: bufferToHex(context.writerKey)
    }
  }

  async removeDoc(keyHex) {
    await this.ready()
    this._teardownWatchers(keyHex)
    this._releaseSync(keyHex)
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

    return {
      doc: this.normalizeDocRecord(fallback, metadata),
      writerKey: bufferToHex(context.writerKey)
    }
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
    await this._updateStoredContextRecord(request.key, {
      title: metadata?.title || nextTitle
    })

    return {
      key: request.key,
      title: metadata?.title || nextTitle,
      updatedAt: metadata?.updatedAt || Date.now()
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
        : bufferToHex(context.writerKey)
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
        this._releaseSync(keyHex)
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

    try {
      applyAwarenessUpdate(sync.awareness, update, REMOTE_ORIGIN)
    } catch {}

    await context.appendAwareness({
      timestamp: Date.now(),
      data: Buffer.from(update)
    })

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
    let pairingClosed = false

    const closePairingResources = async () => {
      if (pairingClosed) return
      pairingClosed = true
      await pairer.close().catch(() => {})
      await tempStore.close?.().catch(() => {})
    }

    const safeEmit = async (status) => {
      if (aborted) return
      await emit(status)
    }

    const handleAbort = () => {
      if (aborted) return
      aborted = true
      void safeEmit({ state: 'cancelled', message: 'Pairing cancelled' })
      void closePairingResources()
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
      await closePairingResources()

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
      await this._updateStoredContextRecord(keyHex, {
        title: doc?.title || null
      })

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
      await closePairingResources()
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

  async _ensureSync(context) {
    return await this.syncEngine.ensure(context, bufferToHex(context.key))
  }

  async _refreshSync(context, sync) {
    return await this.syncEngine.refresh(
      context,
      bufferToHex(context.key),
      sync
    )
  }

  async _refreshAwareness(context, sync) {
    return await this.syncEngine.refreshAwareness(
      context,
      bufferToHex(context.key),
      sync
    )
  }

  async _persistSnapshot(context, sync, options = {}) {
    return await this.syncEngine.persistSnapshot(
      context,
      bufferToHex(context.key),
      options,
      sync
    )
  }

  _queueBroadcast(context) {
    const keyHex = bufferToHex(context.key)
    this.syncEngine.queue(keyHex, () => this._broadcastUpdates(context))
  }

  async _broadcastUpdates(context) {
    const keyHex = bufferToHex(context.key)
    const watchers = this.watchers.get(keyHex)
    if (!watchers || watchers.size === 0) return

    let payload = null

    try {
      const sync = await this._ensureSync(context)
      const refresh = await this._refreshSync(context, sync)
      const awarenessChanged = await this._refreshAwareness(context, sync)
      const awarenessUpdate = awarenessChanged
        ? encodeAwarenessUpdate(
            sync.awareness,
            Array.from(sync.awareness.getStates().keys())
          )
        : null

      payload = await this.buildDocUpdate(context, sync, {
        updates:
          refresh.updates && refresh.updates.length > 0
            ? refresh.updates
            : null,
        syncUpdate: refresh.syncUpdate,
        awareness: awarenessUpdate
      })
    } catch (error) {
      if (isCoreClosingError(error)) {
        this._teardownWatchers(keyHex)
        this._releaseSync(keyHex)
        return
      }

      console.warn('[doc-worker] failed to prepare doc update broadcast', error)
      return
    }

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
    const hasDocPermission =
      typeof context.hasDocPermission === 'function'
        ? context.hasDocPermission.bind(context)
        : context.hasPermission.bind(context)
    const canEditPermission = await hasDocPermission(
      context.writerKey,
      PERMISSIONS.DOC_EDIT
    )
    const canCommentPermission = await hasDocPermission(
      context.writerKey,
      PERMISSIONS.DOC_COMMENT
    )
    const canInvitePermission = await hasDocPermission(
      context.writerKey,
      PERMISSIONS.DOC_INVITE
    )

    let updatedAt = metadata?.updatedAt || metadata?.createdAt || Date.now()
    if (sync.lastUpdateAt && sync.lastUpdateAt > updatedAt) {
      updatedAt = sync.lastUpdateAt
    }

    const update = {
      key: bufferToHex(context.key),
      writerKey: bufferToHex(context.writerKey),
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

  _releaseSync(keyHex) {
    this.syncEngine.release(keyHex)
  }

  _teardownWatchers(keyHex) {
    const watchers = this.watchers.get(keyHex)
    if (watchers) {
      for (const watcher of watchers) {
        watcher.closed = true
      }
      watchers.clear()
      this.watchers.delete(keyHex)
    }
    const unsubscribe = this.subscriptions.get(keyHex)
    if (unsubscribe) {
      try {
        unsubscribe()
      } catch {}
    }
    this.subscriptions.delete(keyHex)
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

  async _resolveDocRecord(record = {}) {
    const doc = this.normalizeDocRecord(record)

    if (!this._shouldPrefetchTitle(record)) {
      return doc
    }

    try {
      const context = await this.manager.getDoc(record.key)
      if (!context) return doc

      const metadata = await context.getMetadata()
      const hydrated = this.normalizeDocRecord(record, metadata)

      await this._updateStoredContextRecord(record.key, {
        title: hydrated?.title || null
      })

      return hydrated
    } catch (error) {
      console.warn('[doc-worker] failed to prefetch doc title', record?.key, error)
      return doc
    }
  }

  _shouldPrefetchTitle(record = {}) {
    if (!record || typeof record.key !== 'string' || record.key.length === 0) {
      return false
    }

    if (typeof record.title !== 'string') return true

    const title = record.title.trim()
    return title.length === 0 || title === DEFAULT_TITLE
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

  async _updateStoredContextRecord(keyHex, patch = {}) {
    if (!keyHex) return

    const current = await this._getStoredContextRecord(keyHex)
    if (!current) return

    const next = { ...current }
    let changed = false

    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined || next[field] === value) continue
      next[field] = value
      changed = true
    }

    if (!changed || !this.manager.localDb) return
    await this.manager.localDb.put(`contexts/${keyHex}`, next)
  }
}

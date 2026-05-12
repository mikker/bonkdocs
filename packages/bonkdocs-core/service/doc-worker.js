import { mkdir } from 'fs/promises'
import { Y, encodeAwarenessUpdate } from 'pear-sdk-yjs'
import b4a from 'b4a'
import z32 from 'z32'

import { DocManager } from '../domain/doc-manager.js'
import { DEFAULT_TITLE, ROLE_EDITOR, ROLE_VIEWER } from '../domain/constants.js'
import { bufferToHex, hexToBuffer, toUint8Array } from '../../../lib/codec.js'

const APP_ID = 'bonkdocs'

export class DocWorker {
  constructor(options = {}) {
    this.baseDir = options.baseDir
    this.watchers = new Map()
    this.bindings = new Map()

    if (options.ensureStorage !== false) {
      void mkdir(this.baseDir, { recursive: true }).catch(() => {})
    }

    this.manager = new DocManager(this.baseDir, {
      appId: APP_ID,
      bootstrap: options.bootstrap,
      recoverySeed: options.recoverySeed
    })
  }

  async ready() {
    await this.manager.ready()
  }

  async close() {
    for (const watchers of this.watchers.values()) {
      for (const watcher of watchers) watcher.stop()
    }
    this.watchers.clear()

    for (const binding of this.bindings.values()) {
      await binding.close().catch(() => {})
    }
    this.bindings.clear()
    await this.manager.close()
  }

  async getIdentity() {
    await this.ready()
    const identity = this.manager.manager.identity
    if (!identity?.id) return null

    const profile = await this.manager.manager.profile.public.get()
    return {
      identityKey: identity.id,
      writerKey: identity.profilePublicWriterPublicKey || identity.id,
      profile: Object.keys(profile || {}).length > 0 ? profile : null
    }
  }

  async setPublicProfile(request = {}) {
    await this.ready()
    const displayName =
      typeof request.displayName === 'string'
        ? request.displayName.trim().slice(0, 80)
        : ''
    const current = await this.manager.manager.profile.public.get()
    const next = {
      ...(current || {}),
      displayName: displayName || null,
      updatedAt: Date.now()
    }

    await this.manager.manager.profile.public.set(next)
    return { identity: await this.getIdentity() }
  }

  async listDocs() {
    await this.ready()
    const records = await this.manager.listDocs()
    const docs = []

    for (const record of records) {
      const context = await this.manager.getDoc(record.key)
      docs.push(await this._docRecord(record, context))
    }

    return docs
  }

  async createDoc(options = {}) {
    await this.ready()
    const context = await this.manager.createDoc({
      title: options.title,
      description: options.description
    })
    const record = await this.manager.manager.appProfile.spaces.get(
      bufferToHex(context.key)
    )
    const binding = await this._binding(context)
    await binding.saveSnapshot({ force: true }).catch(() => {})

    return {
      doc: await this._docRecord(record, context),
      writerKey: bufferToHex(context.writerKey)
    }
  }

  async joinDoc(options = {}) {
    if (!options.invite) throw new Error('Invite is required to join doc')
    await this.ready()

    const context = await this.manager.joinDoc(options.invite, {
      title: options.title
    })
    const record = await this.manager.manager.appProfile.spaces.get(
      bufferToHex(context.key)
    )

    return {
      doc: await this._docRecord(record, context),
      writerKey: bufferToHex(context.writerKey)
    }
  }

  async removeDoc(keyHex) {
    await this.ready()
    this._stopWatchers(keyHex)
    const binding = this.bindings.get(keyHex)
    if (binding) await binding.close().catch(() => {})
    this.bindings.delete(keyHex)
    return await this.manager.removeDoc(keyHex)
  }

  async getDoc(keyHex) {
    await this.ready()
    const context = await this.manager.getDoc(keyHex)
    if (!context) return null
    const record = await this.manager.manager.appProfile.spaces.get(keyHex)
    return {
      doc: await this._docRecord(record, context),
      writerKey: bufferToHex(context.writerKey)
    }
  }

  async renameDoc(request = {}) {
    if (!request.key) throw new Error('Doc key is required to rename')
    const context = await this.manager.getDoc(request.key)
    if (!context) throw new Error('Doc not found')
    await this._assertUnlocked(context)

    const inputTitle =
      typeof request.title === 'string' ? request.title.trim() : ''
    const nextTitle =
      inputTitle.length > 0 ? inputTitle.slice(0, 256) : DEFAULT_TITLE
    const metadata = await context.updateMetadata({ title: nextTitle })

    return {
      key: request.key,
      title: metadata?.title || nextTitle,
      updatedAt: metadata?.updatedAt || Date.now()
    }
  }

  async lockDoc(request = {}) {
    if (!request.key) throw new Error('Doc key is required to lock')
    const context = await this.manager.getDoc(request.key)
    if (!context) throw new Error('Doc not found')

    const lock = await context.lockDoc()
    return {
      key: request.key,
      lockedAt: lock?.acquiredAt || Date.now(),
      lockedBy: lock?.ownerKey ? bufferToHex(lock.ownerKey) : ''
    }
  }

  async watchDoc(keyHex, options = {}, onUpdate) {
    await this.ready()
    const context = await this.manager.getDoc(keyHex)
    if (!context) throw new Error('Doc not found')

    const binding = await this._binding(context)
    await binding.refresh()
    await onUpdate(await this._composeUpdate(context, binding, options))

    const emit = async () => {
      await context.space.flush().catch(() => {})
      await binding.refresh().catch(() => {})
      await onUpdate(await this._composeUpdate(context, binding, {}))
    }

    const watcher = {
      stopped: false,
      interval: null,
      stop: () => {
        if (watcher.stopped) return
        watcher.stopped = true
        if (watcher.interval) clearInterval(watcher.interval)
        off()
        const watchers = this.watchers.get(keyHex)
        if (watchers) watchers.delete(watcher)
      }
    }

    const off = context.space.subscribe(async () => {
      if (watcher.stopped) return
      await emit()
    })

    watcher.interval = setInterval(() => {
      if (!watcher.stopped) void emit()
    }, 1000)

    if (!this.watchers.has(keyHex)) this.watchers.set(keyHex, new Set())
    this.watchers.get(keyHex).add(watcher)

    return async () => watcher.stop()
  }

  async applyUpdates(request = {}) {
    if (!request.key) throw new Error('Doc key is required for applyUpdates')
    const context = await this.manager.getDoc(request.key)
    if (!context) throw new Error('Doc not found')
    await this._assertUnlocked(context)

    const updates = Array.isArray(request.updates) ? request.updates : []
    for (const update of updates) {
      const data = toUint8Array(update?.data)
      if (!data) continue
      await context.appendUpdate({
        clientId: String(update.clientId || 'client'),
        timestamp: update.timestamp || Date.now(),
        data: Buffer.from(data)
      })
    }

    return { accepted: true, revision: await context.getLatestRevision() }
  }

  async applyAwareness(request = {}) {
    if (!request.key) throw new Error('Doc key is required for applyAwareness')
    const context = await this.manager.getDoc(request.key)
    if (!context) throw new Error('Doc not found')
    const update = toUint8Array(request.update)
    if (!update) return { accepted: false }

    await context.appendAwareness({
      clientId: request.clientId || null,
      timestamp: Date.now(),
      data: Buffer.from(update)
    })
    return { accepted: true }
  }

  async listInvites(keyHex, includeRevoked = false) {
    const context = await this.manager.getDoc(keyHex)
    if (!context) throw new Error('Doc not found')
    await this._assertUnlocked(context)

    const invites = await context.space.invites.list({ includeRevoked })
    return invites.map((invite) => this._normalizeInvite(invite))
  }

  async createInvite(keyHex, roles = [], expiresAt) {
    const context = await this.manager.getDoc(keyHex)
    if (!context) throw new Error('Doc not found')
    await this._assertUnlocked(context)

    const normalizedRoles =
      Array.isArray(roles) && roles.includes(ROLE_EDITOR)
        ? [ROLE_EDITOR]
        : [ROLE_VIEWER]
    const inviteOptions = { roles: normalizedRoles }
    if (typeof expiresAt === 'number' && expiresAt > 0) {
      inviteOptions.expires = expiresAt
    }
    if (!normalizedRoles.includes(ROLE_EDITOR)) {
      inviteOptions.optimistic = true
    }

    const invite = await context.space.invites.create(inviteOptions)
    const invites = await context.space.invites.list({ includeRevoked: true })
    const latest = invites[invites.length - 1]

    return {
      invite,
      inviteId: latest?.id ? bufferToHex(latest.id) : invite
    }
  }

  async revokeInvite(keyHex, inviteId) {
    const context = await this.manager.getDoc(keyHex)
    if (!context) throw new Error('Doc not found')
    await this._assertUnlocked(context)
    return await context.space.invites.revoke(hexToBuffer(inviteId))
  }

  async _binding(context) {
    const key = bufferToHex(context.key)
    const existing = this.bindings.get(key)
    if (existing && !existing.closed) return existing

    const binding = await context.openYjs({
      clientId: `worker-${bufferToHex(context.writerKey).slice(0, 12)}`,
      autoSnapshot: true
    })
    this.bindings.set(key, binding)
    return binding
  }

  async _docRecord(record, context) {
    const metadata = await context.getMetadata()
    const lock = await context.getLock()
    const locked = this._activeLock(lock)
    const key = record?.key || bufferToHex(context.key)

    return {
      key,
      encryptionKey:
        record?.encryptionKey || bufferToHex(context.encryptionKey),
      createdAt: metadata?.createdAt || record?.createdAt || Date.now(),
      joinedAt: record?.joinedAt || metadata?.createdAt || Date.now(),
      isCreator: record?.isCreator === true,
      title: metadata?.title || record?.name || DEFAULT_TITLE,
      lastRevision: await context.getLatestRevision(),
      lastOpenedAt: metadata?.updatedAt || Date.now(),
      lockedAt: locked?.acquiredAt || null,
      lockedBy: locked?.ownerKey ? bufferToHex(locked.ownerKey) : null
    }
  }

  async _composeUpdate(context, binding, options = {}) {
    const metadata = await context.getMetadata()
    const lock = await context.getLock()
    const locked = this._activeLock(lock)
    const states = Array.from(binding.awareness.getStates().keys())
    const awareness =
      states.length > 0
        ? Buffer.from(encodeAwarenessUpdate(binding.awareness, states))
        : null

    return {
      key: bufferToHex(context.key),
      revision: binding.lastRev || 0,
      updatedAt: metadata?.updatedAt || Date.now(),
      title: metadata?.title || DEFAULT_TITLE,
      capabilities: await context.getCapabilities(),
      lockedAt: locked?.acquiredAt || null,
      lockedBy: locked?.ownerKey ? bufferToHex(locked.ownerKey) : null,
      syncUpdate: Buffer.from(Y.encodeStateAsUpdate(binding.doc)),
      awareness,
      writerKey: bufferToHex(context.writerKey)
    }
  }

  _normalizeInvite(invite) {
    const rawInvite = invite?.invite
    const code = rawInvite
      ? typeof rawInvite === 'string'
        ? rawInvite
        : z32.encode(toBuffer(rawInvite))
      : ''

    return {
      id: invite?.id ? bufferToHex(invite.id) : code,
      invite: code,
      roles: Array.isArray(invite?.roles) ? invite.roles : [],
      createdBy: invite?.createdBy ? bufferToHex(invite.createdBy) : undefined,
      createdAt: invite?.createdAt,
      revokedAt: invite?.revokedAt,
      expiresAt: invite?.expires
    }
  }

  async _assertUnlocked(context) {
    const lock = await context.getLock()
    if (this._activeLock(lock)) throw new Error('Document is locked')
  }

  _activeLock(lock) {
    if (!lock) return null
    if (lock.releasedAt && lock.releasedAt > 0) return null
    if (lock.expiresAt && lock.expiresAt > 0 && lock.expiresAt <= Date.now()) {
      return null
    }
    return lock
  }

  _stopWatchers(keyHex) {
    const watchers = this.watchers.get(keyHex)
    if (!watchers) return
    for (const watcher of [...watchers]) watcher.stop()
    this.watchers.delete(keyHex)
  }
}

function toBuffer(value) {
  if (b4a.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return b4a.from(value)
}

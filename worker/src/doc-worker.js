import { DocManager } from '../../core/doc-manager.js'
import {
  DEFAULT_TITLE,
  PERMISSIONS,
  ROLE_OWNER,
  ROLE_EDITOR,
  ROLE_VIEWER
} from '../../core/constants.js'
import { mkdir } from './platform.js'

const APP_STATE_KEY = 'state/app'

const bufferToHex = (buf) =>
  Buffer.isBuffer(buf) ? Buffer.from(buf).toString('hex') : buf || ''

const EMPTY_DOC_NODE = Object.freeze({
  type: 'doc',
  content: [{ type: 'paragraph' }]
})

const EMPTY_DOC_SNAPSHOT = Buffer.from(JSON.stringify(EMPTY_DOC_NODE))

const TEXT_DECODER =
  typeof TextDecoder === 'function' ? new TextDecoder() : null

function randomBytes(size) {
  if (size <= 0) return Buffer.alloc(0)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(size)
    crypto.getRandomValues(array)
    return Buffer.from(array)
  }
  const buf = Buffer.alloc(size)
  for (let i = 0; i < size; i++) {
    buf[i] = Math.floor(Math.random() * 256)
  }
  return buf
}

function bytesFromId(id) {
  if (!id) return randomBytes(32)
  if (Buffer.isBuffer(id)) {
    if (id.length === 32) return id
    if (id.length > 32) return id.subarray(0, 32)
    const out = Buffer.alloc(32)
    id.copy(out)
    return out
  }
  if (typeof id === 'string') {
    const normalized = id.trim()
    try {
      if (/^[0-9a-fA-F]{64}$/.test(normalized)) {
        return Buffer.from(normalized, 'hex')
      }
      if (/^[0-9a-fA-F]{32}$/.test(normalized)) {
        return Buffer.from(normalized.repeat(2), 'hex')
      }
    } catch {}
    try {
      const decoded = Buffer.from(normalized, 'base64')
      if (decoded.length === 32) return decoded
      if (decoded.length > 32) return decoded.subarray(0, 32)
      const out = Buffer.alloc(32)
      decoded.copy(out)
      return out
    } catch {}
  }
  return randomBytes(32)
}

function sanitizeDocNode(node) {
  if (!node || typeof node !== 'object') return null
  const type = typeof node.type === 'string' ? node.type : null
  if (!type) return null

  if (type === 'text') {
    const text = typeof node.text === 'string' ? node.text : ''
    if (!text) return null
    const clean = { ...node, type, text }
    return clean
  }

  const clean = { ...node, type }

  if (Array.isArray(node.content)) {
    const children = node.content
      .map((child) => sanitizeDocNode(child))
      .filter((child) => child !== null)
    if (children.length > 0) clean.content = children
    else delete clean.content
  } else if (node.content !== undefined) {
    delete clean.content
  }

  return clean
}

function sanitizeDocSnapshot(doc) {
  if (!doc || typeof doc !== 'object') return EMPTY_DOC_NODE
  const type = typeof doc.type === 'string' ? doc.type : null
  if (type !== 'doc') return EMPTY_DOC_NODE

  const content = Array.isArray(doc.content) ? doc.content : []
  const cleaned = content
    .map((node) => sanitizeDocNode(node))
    .filter((node) => node !== null)

  if (cleaned.length === 0) cleaned.push({ type: 'paragraph' })

  return { type: 'doc', content: cleaned }
}

function decodeOperationPayload(data) {
  if (!data || data.length === 0) return null
  try {
    const str = Buffer.isBuffer(data)
      ? data.toString()
      : TEXT_DECODER
        ? TEXT_DECODER.decode(data)
        : Buffer.from(data).toString()
    const parsed = JSON.parse(str)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

export class DocWorker {
  constructor(options = {}) {
    this.baseDir = options.baseDir
    this.watchers = new Map()

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
      await context.recordSnapshot({
        rev: metadata?.rev || 1,
        data: Buffer.from(EMPTY_DOC_SNAPSHOT)
      })
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

  async watchDoc(keyHex, options = {}, onUpdate) {
    await this.ready()

    const context = await this.manager.getDoc(keyHex)
    if (!context) throw new Error('Doc not found')

    const watcherEntry = {
      closed: false,
      unsubscribe: null
    }

    const set = this._getWatcherSet(keyHex)
    set.add(watcherEntry)

    const sendUpdate = async () => {
      if (watcherEntry.closed) return
      const update = await this.buildDocUpdate(context, {
        includeSnapshot: options.includeSnapshot === true
      })
      await onUpdate(update)
    }

    const queueUpdate = () =>
      Promise.resolve()
        .then(sendUpdate)
        .catch((error) => {
          console.warn('[doc-worker] failed to emit doc update', error)
        })

    queueUpdate()

    watcherEntry.unsubscribe = context.subscribe(queueUpdate)

    return async () => {
      if (watcherEntry.closed) return
      watcherEntry.closed = true
      set.delete(watcherEntry)
      try {
        watcherEntry.unsubscribe?.()
      } catch {}
    }
  }

  async applyOperations(request = {}) {
    if (!request.key) throw new Error('Doc key is required')
    const ops = Array.isArray(request.ops) ? request.ops : []
    if (ops.length === 0) {
      return { accepted: false, applied: 0, revision: null, reason: 'NO_OPS' }
    }

    await this.ready()

    const context = await this.manager.getDoc(request.key)
    if (!context) throw new Error('Doc not found')

    let currentRevision = await context.getLatestRevision()
    const accepted = []

    for (const rawOp of ops) {
      if (!rawOp || typeof rawOp !== 'object') continue

      const payload = decodeOperationPayload(rawOp.data)
      if (!payload) continue

      const baseRev =
        typeof rawOp.baseRev === 'number' && rawOp.baseRev >= 0
          ? rawOp.baseRev
          : currentRevision

      if (baseRev !== currentRevision) {
        return {
          accepted: accepted.length > 0,
          applied: accepted.length,
          revision: currentRevision,
          reason: 'REVISION_MISMATCH',
          expected: currentRevision,
          received: baseRev
        }
      }

      const nextRevision =
        typeof rawOp.rev === 'number' && rawOp.rev > currentRevision
          ? rawOp.rev
          : currentRevision + 1

      const clientId = bytesFromId(rawOp.clientId)
      const sessionId = rawOp.sessionId
        ? bytesFromId(rawOp.sessionId)
        : clientId
      const timestamp =
        typeof rawOp.timestamp === 'number' && rawOp.timestamp > 0
          ? rawOp.timestamp
          : Date.now()

      const opBuffer = Buffer.isBuffer(rawOp.data)
        ? rawOp.data
        : Buffer.from(rawOp.data)

      await context.appendOperation({
        rev: nextRevision,
        baseRev,
        clientId,
        sessionId,
        timestamp,
        data: opBuffer
      })

      if (payload && payload.type === 'replace' && payload.doc) {
        const sanitized = sanitizeDocSnapshot(payload.doc)
        const snapshotBuffer = Buffer.from(JSON.stringify(sanitized))
        await context.recordSnapshot({
          rev: nextRevision,
          createdAt: timestamp,
          data: snapshotBuffer
        })
      }

      currentRevision = nextRevision
      accepted.push({ rev: nextRevision })
    }

    return {
      accepted: accepted.length > 0,
      applied: accepted.length,
      revision: currentRevision
    }
  }

  async updatePresence(keyHex, request = {}) {
    await this.ready()
    const context = await this.manager.getDoc(keyHex)
    if (!context) throw new Error('Doc not found')

    await context.updatePresence({
      id: request.sessionId || bufferToHex(context.writerKey),
      sessionId: request.sessionId,
      displayName: request.displayName,
      color: request.color,
      payload: request.payload,
      updatedAt: request.updatedAt
    })

    return { status: 'ok' }
  }

  async listInvites() {
    throw new Error('Invites are not implemented')
  }

  async createInvite() {
    throw new Error('Invites are not implemented')
  }

  async revokeInvite() {
    throw new Error('Invites are not implemented')
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

  async buildDocUpdate(context, options = {}) {
    const metadata = await context.getMetadata()
    const revision = await context.getLatestRevision()
    const presence = await this._listPresence(context)
    const roles = await this._listWriterRoles(context)

    const update = {
      key: bufferToHex(context.key),
      revision,
      baseRevision: revision,
      updatedAt: metadata?.updatedAt || metadata?.createdAt || Date.now(),
      title: metadata?.title || DEFAULT_TITLE,
      ops: [],
      presence,
      capabilities: {
        canEdit: await context.hasPermission(
          context.writerKey,
          PERMISSIONS.DOC_EDIT
        ),
        canComment: await context.hasPermission(
          context.writerKey,
          PERMISSIONS.DOC_COMMENT
        ),
        canInvite: await context.hasPermission(
          context.writerKey,
          PERMISSIONS.DOC_INVITE
        ),
        roles
      }
    }

    if (options.includeSnapshot === true) {
      update.snapshotRevision = revision
    }

    if (options.includeSnapshot === true) {
      let snapshotRecord = null
      try {
        snapshotRecord = await context.base.view.findOne(
          '@pear-docs/snapshots',
          { reverse: true, limit: 1 }
        )
      } catch {}

      if (snapshotRecord?.data) {
        update.snapshot = snapshotRecord.data
        update.snapshotRevision = snapshotRecord.rev ?? revision
      } else {
        update.snapshot = Buffer.from(EMPTY_DOC_SNAPSHOT)
        update.snapshotRevision = revision
      }
    }

    return update
  }

  normalizeDocRecord(record = {}, metadata = null) {
    if (!record) return null

    const doc = {
      key: record.key,
      encryptionKey: record.encryptionKey,
      createdAt: record.createdAt,
      joinedAt: record.joinedAt || record.createdAt,
      isCreator: !!record.isCreator,
      title: metadata?.title || record.title || DEFAULT_TITLE,
      lastRevision: metadata?.rev || record.lastRevision || 0,
      lastOpenedAt: record.lastOpenedAt || Date.now()
    }

    return doc
  }

  async _listPresence(context) {
    const cursor = context.base.view.find('@pear-docs/presence', {})
    const records = await cursor.toArray()

    return records.map((entry) => ({
      id: entry.id,
      writerKey: bufferToHex(entry.writerKey),
      sessionId: bufferToHex(entry.sessionId),
      displayName: entry.displayName || null,
      color: entry.color || null,
      updatedAt: entry.updatedAt,
      payload: entry.payload || null
    }))
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

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

const EMPTY_DOC_SNAPSHOT = Buffer.from(
  JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '' }]
      }
    ]
  })
)

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

    await sendUpdate()

    watcherEntry.unsubscribe = context.subscribe(() => {
      void sendUpdate().catch((error) => {
        console.warn('[doc-worker] failed to emit doc update', error)
      })
    })

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
    return {
      accepted: false,
      error: 'applyOps not implemented'
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

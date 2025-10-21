import { mkdir } from 'fs/promises'

import { DocManager } from '../../core/doc-manager.js'
import { ensurePear } from '../../lib/pear-env.js'
import { randomBytes } from 'hypercore-crypto'

ensurePear()
import z32 from 'z32'
import {
  DEFAULT_TITLE,
  PERMISSIONS,
  ROLE_OWNER,
  ROLE_EDITOR,
  ROLE_VIEWER
} from '../../core/constants.js'
import {
  decodeDeltaPayload,
  applyDeltaSteps,
  fingerprintText
} from '../../lib/snapshot-delta.js'

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

const EMPTY_DOC_NODE = Object.freeze({
  type: 'doc',
  content: [{ type: 'paragraph' }]
})

const EMPTY_DOC_SNAPSHOT = Buffer.from(JSON.stringify(EMPTY_DOC_NODE))
const EMPTY_DOC_TEXT = JSON.stringify(EMPTY_DOC_NODE)

const TEXT_DECODER =
  typeof TextDecoder === 'function' ? new TextDecoder() : null

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

    const watcherEntry = {
      closed: false,
      unsubscribe: null,
      sinceRevision:
        typeof options.sinceRevision === 'number' && options.sinceRevision >= 0
          ? options.sinceRevision
          : 0,
      includeSnapshot: options.includeSnapshot === true
    }

    const set = this._getWatcherSet(keyHex)
    set.add(watcherEntry)

    const sendUpdate = async () => {
      if (watcherEntry.closed) return
      const update = await this.buildDocUpdate(context, {
        includeSnapshot: watcherEntry.includeSnapshot,
        sinceRevision: watcherEntry.sinceRevision
      })
      watcherEntry.includeSnapshot = false
      watcherEntry.sinceRevision = update.revision
      await onUpdate(update)
    }

    const queueUpdate = () =>
      Promise.resolve()
        .then(sendUpdate)
        .catch((error) => {
          if (isCoreClosingError(error)) {
            watcherEntry.closed = true
            set.delete(watcherEntry)
            try {
              watcherEntry.unsubscribe?.()
            } catch {}
            return
          }
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

    const metadata = await context.getMetadata()
    if (
      metadata &&
      typeof metadata.lockedAt === 'number' &&
      metadata.lockedAt > 0
    ) {
      throw new Error('Document is locked')
    }

    if (!context._conflictListenerAttached) {
      context.base.on('error', (error) => {
        if (
          error &&
          typeof error.message === 'string' &&
          error.message.startsWith('Conflicting operation revision')
        ) {
          return
        }

        context.emit('error', error)
      })
      context._conflictListenerAttached = true
    }

    let currentRevision = await context.getLatestRevision()
    const accepted = []
    let latestDocJSON = null
    let latestDocText = null
    let latestDocHash = null

    const ensureLatestSnapshot = async () => {
      if (latestDocText !== null) return
      let snapshotRecord = null
      try {
        snapshotRecord = await context.base.view.findOne(
          '@bonk-docs/snapshots',
          { reverse: true, limit: 1 }
        )
      } catch {}

      if (snapshotRecord?.data) {
        try {
          const str = snapshotRecord.data.toString()
          const parsed = JSON.parse(str)
          const sanitized = sanitizeDocSnapshot(parsed)
          latestDocJSON = sanitized
          latestDocText = JSON.stringify(sanitized)
        } catch {
          latestDocJSON = EMPTY_DOC_NODE
          latestDocText = EMPTY_DOC_TEXT
        }
      } else {
        latestDocJSON = EMPTY_DOC_NODE
        latestDocText = EMPTY_DOC_TEXT
      }

      latestDocHash = fingerprintText(latestDocText)
    }

    const persistSnapshot = async (doc, rev, timestamp) => {
      latestDocJSON = doc
      latestDocText = JSON.stringify(doc)
      latestDocHash = fingerprintText(latestDocText)
      const snapshotBuffer = Buffer.from(latestDocText)
      await context.recordSnapshot({
        rev,
        createdAt: timestamp,
        data: snapshotBuffer
      })
    }

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

      let duplicateAck = false

      while (true) {
        let latestBeforeAppend
        try {
          latestBeforeAppend = await context.getLatestRevision()
        } catch {
          latestBeforeAppend = currentRevision
        }

        if (latestBeforeAppend >= nextRevision) {
          let existing = null
          try {
            existing = await context.base.view.get('@bonk-docs/operations', {
              rev: nextRevision
            })
          } catch {}

          if (existing) {
            const existingClient = bufferToHex(existing.clientId)
            const incomingClient = bufferToHex(clientId)
            const sameClient = existingClient === incomingClient
            const sameBase =
              typeof existing.baseRev === 'number'
                ? existing.baseRev === baseRev
                : false
            const existingData = Buffer.isBuffer(existing.data)
              ? existing.data
              : existing.data
                ? Buffer.from(existing.data)
                : Buffer.alloc(0)
            const sameData = buffersEqual(existingData, opBuffer)

            if (sameClient && sameBase && sameData) {
              currentRevision = latestBeforeAppend
              accepted.push({ rev: nextRevision })
              duplicateAck = true
              break
            }
          }

          return {
            accepted: accepted.length > 0,
            applied: accepted.length,
            revision: latestBeforeAppend,
            reason: 'REVISION_CONFLICT',
            conflict: {
              message: `Conflicting operation revision ${nextRevision}: expected ${latestBeforeAppend + 1}`,
              attemptedRevision: nextRevision,
              baseRevision: baseRev,
              existingRevision: latestBeforeAppend,
              expectedRevision: latestBeforeAppend + 1,
              clientId: bufferToHex(clientId),
              sessionId: bufferToHex(sessionId),
              timestamp
            }
          }
        }

        try {
          await context.appendOperation({
            rev: nextRevision,
            baseRev,
            clientId,
            sessionId,
            timestamp,
            data: opBuffer
          })
          break
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error))
          const message = typeof err.message === 'string' ? err.message : ''

          if (message.startsWith('Conflicting operation revision')) {
            // re-evaluate with updated revision state
            continue
          }

          if (message.startsWith('Invalid operation revision')) {
            let latestRevision
            try {
              latestRevision = await context.getLatestRevision()
            } catch {
              latestRevision = currentRevision
            }

            return {
              accepted: accepted.length > 0,
              applied: accepted.length,
              revision: latestRevision,
              reason: 'REVISION_OUT_OF_ORDER',
              expected: latestRevision + 1,
              received: nextRevision,
              message
            }
          }

          throw err
        }
      }

      if (duplicateAck) {
        continue
      }

      if (payload && payload.type === 'replace' && payload.doc) {
        const sanitized = sanitizeDocSnapshot(payload.doc)
        await persistSnapshot(sanitized, nextRevision, timestamp)
      } else if (payload && payload.type === 'delta') {
        const delta = decodeDeltaPayload(payload)
        if (!delta) {
          return {
            accepted: accepted.length > 0,
            applied: accepted.length,
            revision: currentRevision,
            reason: 'INVALID_DELTA'
          }
        }

        await ensureLatestSnapshot()

        if (delta.baseHash && delta.baseHash !== latestDocHash) {
          return {
            accepted: accepted.length > 0,
            applied: accepted.length,
            revision: currentRevision,
            reason: 'SNAPSHOT_MISMATCH',
            expected: latestDocHash,
            received: delta.baseHash
          }
        }

        const nextText = applyDeltaSteps(latestDocText, delta.steps)
        let parsed = null
        try {
          parsed = JSON.parse(nextText)
        } catch {
          return {
            accepted: accepted.length > 0,
            applied: accepted.length,
            revision: currentRevision,
            reason: 'DELTA_APPLY_FAILED'
          }
        }

        const sanitized = sanitizeDocSnapshot(parsed)
        await persistSnapshot(sanitized, nextRevision, timestamp)
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

  async buildDocUpdate(context, options = {}) {
    const metadata = await context.getMetadata()
    const revision = await context.getLatestRevision()
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
    const sinceRevision =
      typeof options.sinceRevision === 'number' && options.sinceRevision >= 0
        ? options.sinceRevision
        : revision

    const update = {
      key: bufferToHex(context.key),
      revision,
      baseRevision: sinceRevision,
      updatedAt: metadata?.updatedAt || metadata?.createdAt || Date.now(),
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

    if (options.includeSnapshot === true) {
      update.snapshotRevision = revision
    }

    if (options.includeSnapshot === true) {
      let snapshotRecord = null
      try {
        snapshotRecord = await context.base.view.findOne(
          '@bonk-docs/snapshots',
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

    if (revision > sinceRevision) {
      const opsCursor = context.base.view.find('@bonk-docs/operations', {
        gt: { rev: sinceRevision },
        lte: { rev: revision }
      })
      const records = await opsCursor.toArray()
      if (records.length > 0) {
        update.ops = records.map((record) => {
          const op = {
            rev: record.rev,
            baseRev: record.baseRev,
            clientId: bufferToHex(record.clientId),
            sessionId: record.sessionId ? bufferToHex(record.sessionId) : null,
            timestamp: record.timestamp,
            data: record.data
          }
          return op
        })

        const latestTimestamp = records.reduce((acc, record) => {
          return record.timestamp && record.timestamp > acc
            ? record.timestamp
            : acc
        }, update.updatedAt || 0)
        if (!update.updatedAt || latestTimestamp > update.updatedAt) {
          update.updatedAt = latestTimestamp
        }
      }
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
      lastRevision: metadata?.rev || record.lastRevision || 0,
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

import { DEFAULT_TITLE, METADATA_ID, PERMISSIONS } from './constants.js'
import { DOC_LOCK_ID } from './space-definition.js'

export class DocContext {
  constructor(space) {
    this.space = space
  }

  get key() {
    return this.space.key
  }

  get writerKey() {
    return this.space.writerKey
  }

  get encryptionKey() {
    return this.space.encryptionKey
  }

  async getMetadata() {
    await this.space.flush()
    return await this.space.db.get('@bonkdocs-doc/metadata', {
      id: METADATA_ID
    })
  }

  async bootstrapDoc(options = {}) {
    const existing = await this.getMetadata()
    if (existing) return existing

    const now =
      typeof options.timestamp === 'number' ? options.timestamp : Date.now()
    const record = {
      id: METADATA_ID,
      title: options.title || DEFAULT_TITLE,
      description: options.description || null,
      createdAt: now,
      updatedAt: now,
      creatorKey: this.writerKey,
      rev: 1
    }

    await this.space.dispatch('bonkdocs-doc/metadata-upsert', record)
    return record
  }

  async updateMetadata(patch = {}) {
    const existing = await this.getMetadata()
    if (!existing) throw new Error('Document metadata not found')

    const now = Date.now()
    const rawTitle =
      typeof patch.title === 'string' ? patch.title.trim() : existing.title
    const nextTitle =
      rawTitle && rawTitle.length > 0 ? rawTitle.slice(0, 256) : DEFAULT_TITLE

    const record = {
      ...existing,
      title: nextTitle,
      description:
        patch.description === undefined
          ? existing.description || null
          : patch.description,
      updatedAt: now,
      rev: (existing.rev || 0) + 1
    }

    await this.space.dispatch('bonkdocs-doc/metadata-upsert', record)
    return record
  }

  async lockDoc(options = {}) {
    return await this.space.locks.acquire(DOC_LOCK_ID, {
      acquiredAt: options.lockedAt || Date.now()
    })
  }

  async getLock() {
    return await this.space.locks.get(DOC_LOCK_ID)
  }

  async getLatestRevision() {
    await this.space.flush()
    const latest = await this.space.db.findOne(
      '@bonk-docs/yjs-updates',
      {},
      { reverse: true, limit: 1 }
    )
    return latest ? latest.rev : 0
  }

  async appendUpdate(update = {}) {
    if (!update.clientId || !update.data) {
      throw new Error('appendUpdate requires clientId and data')
    }

    await this.space.dispatch('bonk-docs/yjs-append-update', {
      clientId: update.clientId,
      timestamp: update.timestamp || Date.now(),
      data: update.data,
      sessionId: update.sessionId || null
    })
  }

  async appendAwareness(update = {}) {
    if (!update.data) throw new Error('appendAwareness requires data')

    await this.space.dispatch('bonk-docs/yjs-append-awareness', {
      clientId: update.clientId || null,
      timestamp: update.timestamp || Date.now(),
      data: update.data
    })
  }

  async openYjs(opts = {}) {
    return await this.space.yjs.open(opts)
  }

  async getCapabilities() {
    const roles = await this.getRoles(this.writerKey)
    const canEdit = await this.space.auth.hasPermission(
      this.writerKey,
      PERMISSIONS.DOC_EDIT
    )
    const canInvite = await this.space.auth.hasPermission(
      this.writerKey,
      'user:invite'
    )
    return { canEdit, canInvite, roles }
  }

  async getRoles(subjectKey) {
    await this.space.flush()
    const acl = await this.space.db.get('@spaces/acl', { subjectKey })
    return Array.isArray(acl?.roles) ? acl.roles : []
  }
}

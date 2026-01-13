import { Context } from 'autobonk'
import {
  DEFAULT_TITLE,
  METADATA_ID,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_OWNER,
  ROLE_EDITOR
} from './constants.js'

function uniqueRoles(roles = []) {
  return Array.from(new Set(roles))
}

function permissionsEqual(current = [], expected = []) {
  if (!Array.isArray(current) || !Array.isArray(expected)) return false
  if (current.length !== expected.length) return false
  const sortedCurrent = [...current].sort()
  const sortedExpected = [...expected].sort()
  return sortedCurrent.every((permission, index) => {
    return permission === sortedExpected[index]
  })
}

async function getLatestEntry(view, collection) {
  return await view.findOne(collection, { reverse: true, limit: 1 })
}

export class DocContext extends Context {
  setupRoutes() {
    this.router.add(
      '@bonk-docs/metadata-upsert',
      async (data = {}, context) => {
        await this.requirePermission(context.writerKey, PERMISSIONS.DOC_EDIT)

        const record = {
          id: data.id || METADATA_ID,
          title: data.title,
          description: data.description,
          createdAt: data.createdAt || Date.now(),
          updatedAt: data.updatedAt || Date.now(),
          creatorKey: data.creatorKey || context.writerKey,
          lockedAt:
            typeof data.lockedAt === 'number' && Number.isFinite(data.lockedAt)
              ? data.lockedAt
              : null,
          lockedBy:
            data.lockedBy && Buffer.isBuffer(data.lockedBy)
              ? data.lockedBy
              : null,
          rev: data.rev
        }

        if (typeof record.rev !== 'number') {
          throw new Error('metadata-upsert requires numeric rev')
        }

        await this._assertNextRevision(
          context.view,
          '@bonk-docs/metadata',
          { id: record.id },
          record.rev,
          'Invalid metadata revision'
        )

        await context.view.insert('@bonk-docs/metadata', record)
      }
    )

    this.router.add('@bonk-docs/update-append', async (data = {}, context) => {
      await this.requirePermission(context.writerKey, PERMISSIONS.DOC_EDIT)

      if (typeof data.clientId !== 'string' || data.clientId.length === 0) {
        throw new Error('update-append requires clientId')
      }
      if (!data.data) {
        throw new Error('update-append requires data buffer')
      }

      const latest = await getLatestEntry(context.view, '@bonk-docs/updates')
      const nextRev = latest ? latest.rev + 1 : 1

      const record = {
        clientId: data.clientId,
        timestamp: data.timestamp || Date.now(),
        data: data.data,
        rev: nextRev
      }

      if (typeof data.sessionId === 'string' && data.sessionId.length > 0) {
        record.sessionId = data.sessionId
      }

      await context.view.insert('@bonk-docs/updates', record)
    })

    this.router.add('@bonk-docs/snapshot-save', async (data = {}, context) => {
      await this.requirePermission(context.writerKey, PERMISSIONS.DOC_SNAPSHOT)

      if (typeof data.rev !== 'number') {
        throw new Error('snapshot-save requires numeric rev')
      }
      if (!data.data) {
        throw new Error('snapshot-save requires snapshot data')
      }

      await context.view.insert('@bonk-docs/snapshots', {
        rev: data.rev,
        createdAt: data.createdAt || Date.now(),
        compression: data.compression || null,
        data: data.data,
        hash: data.hash || null
      })
    })

    this.router.add('@local/doc-upsert', async () => {})
    this.router.add('@local/state-update', async () => {})
    this.router.add('@local/profile-upsert', async () => {})
  }

  async setupResources() {
    await this.ensureDocRoles()
  }

  async teardownResources() {
    if (this.base?.view && typeof this.base.view.close === 'function') {
      await this.base.view.close()
    }
  }

  async ensureDocRoles() {
    const roleEntries = Object.entries(ROLE_PERMISSIONS)

    for (const [roleName, permissions] of roleEntries) {
      const definition = await this.base.view.get('@autobonk/role-def', {
        name: roleName
      })

      if (!this.writable) {
        continue
      }

      if (
        !definition ||
        !permissionsEqual(definition?.permissions, permissions)
      ) {
        try {
          await this.defineRole(roleName, permissions)
        } catch (error) {
          if (error && error.name === 'PermissionError') {
            continue
          }
          throw error
        }
      }
    }

    if (!this.writable) return

    const acl = await this.base.view.get('@autobonk/acl-entry', {
      subjectKey: this.writerKey
    })

    const currentRoles = uniqueRoles(acl ? acl.roles : [])
    currentRoles.push(ROLE_OWNER, ROLE_EDITOR)

    try {
      await this.grantRoles(this.writerKey, uniqueRoles(currentRoles))
    } catch (error) {
      if (error && error.name === 'PermissionError') {
        return
      }
      throw error
    }
  }

  async bootstrapDoc(options = {}) {
    await this.ensureDocRoles()

    const existing = await this.base.view.get('@bonk-docs/metadata', {
      id: METADATA_ID
    })
    if (existing) return existing

    if (!this.writable) {
      throw new Error('Cannot bootstrap document from a read-only context')
    }

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

    await this.base.append(
      this.schema.dispatch.encode('@bonk-docs/metadata-upsert', record)
    )

    return record
  }

  async updateMetadata(patch = {}) {
    await this.ensureDocRoles()
    await this.requirePermission(this.writerKey, PERMISSIONS.DOC_EDIT)

    const existing = await this.getMetadata()
    if (!existing) {
      throw new Error('Document metadata not found')
    }

    if (!this.writable) {
      throw new Error('Cannot update metadata from a read-only context')
    }

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

    if (patch.lockedAt !== undefined) {
      record.lockedAt = patch.lockedAt
    }
    if (patch.lockedBy !== undefined) {
      record.lockedBy = patch.lockedBy
    }

    await this.base.append(
      this.schema.dispatch.encode('@bonk-docs/metadata-upsert', record)
    )

    return record
  }

  async lockDoc(options = {}) {
    await this.ensureDocRoles()
    await this.requirePermission(this.writerKey, PERMISSIONS.DOC_EDIT)

    const existing = await this.getMetadata()
    if (!existing) {
      throw new Error('Document metadata not found')
    }

    if (!this.writable) {
      throw new Error('Cannot lock document from a read-only context')
    }

    if (existing.lockedAt && existing.lockedAt > 0) {
      return existing
    }

    const now =
      typeof options.lockedAt === 'number' ? options.lockedAt : Date.now()
    const lockedBy =
      options.lockedBy && Buffer.isBuffer(options.lockedBy)
        ? options.lockedBy
        : this.writerKey

    const record = {
      ...existing,
      lockedAt: now,
      lockedBy,
      updatedAt: now,
      rev: (existing.rev || 0) + 1
    }

    await this.base.append(
      this.schema.dispatch.encode('@bonk-docs/metadata-upsert', record)
    )

    return record
  }

  async getMetadata() {
    return await this.base.view.get('@bonk-docs/metadata', { id: METADATA_ID })
  }

  async getLatestRevision() {
    const latest = await getLatestEntry(this.base.view, '@bonk-docs/updates')
    return latest ? latest.rev : 0
  }

  async appendUpdate(update = {}) {
    await this.requirePermission(this.writerKey, PERMISSIONS.DOC_EDIT)

    const record = {
      clientId: update.clientId,
      timestamp: update.timestamp || Date.now(),
      data: update.data
    }

    if (typeof update.sessionId === 'string' && update.sessionId.length > 0) {
      record.sessionId = update.sessionId
    }

    if (!record.clientId || !record.data) {
      throw new Error('appendUpdate requires clientId and data')
    }

    await this.base.append(
      this.schema.dispatch.encode('@bonk-docs/update-append', record)
    )

    return record
  }

  async recordSnapshot(snapshot = {}) {
    await this.requirePermission(this.writerKey, PERMISSIONS.DOC_SNAPSHOT)

    if (!snapshot.data) {
      throw new Error('recordSnapshot requires snapshot data')
    }

    const latest = await this.getLatestRevision()
    const rev = typeof snapshot.rev === 'number' ? snapshot.rev : latest

    const record = {
      rev,
      createdAt: snapshot.createdAt || Date.now(),
      data: snapshot.data,
      stateVector: snapshot.stateVector || null
    }

    await this.base.append(
      this.schema.dispatch.encode('@bonk-docs/snapshot-save', record)
    )

    return record
  }
}

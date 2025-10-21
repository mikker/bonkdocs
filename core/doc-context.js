import { Context } from 'autobonk'
import b4a from 'b4a'
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

    this.router.add(
      '@bonk-docs/operation-append',
      async (data = {}, context) => {
        await this.requirePermission(context.writerKey, PERMISSIONS.DOC_EDIT)

        if (typeof data.rev !== 'number') {
          throw new Error('operation-append requires numeric rev')
        }
        if (typeof data.baseRev !== 'number') {
          throw new Error('operation-append requires numeric baseRev')
        }
        if (!data.clientId) {
          throw new Error('operation-append requires clientId')
        }
        if (!data.data) {
          throw new Error('operation-append requires data buffer')
        }

        const record = {
          rev: data.rev,
          baseRev: data.baseRev,
          clientId: data.clientId,
          sessionId: data.sessionId || null,
          timestamp: data.timestamp || Date.now(),
          data: data.data
        }

        const shouldInsert = await this._assertNextOperationRevision(
          context.view,
          record
        )

        if (!shouldInsert) return

        await context.view.insert('@bonk-docs/operations', record)
      }
    )

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
    const latest = await getLatestEntry(this.base.view, '@bonk-docs/operations')
    return latest ? latest.rev : 0
  }

  async appendOperation(operation = {}) {
    await this.requirePermission(this.writerKey, PERMISSIONS.DOC_EDIT)

    const latest = await this.getLatestRevision()
    const rev = typeof operation.rev === 'number' ? operation.rev : latest + 1
    const baseRev =
      typeof operation.baseRev === 'number'
        ? operation.baseRev
        : Math.max(latest, 0)

    const record = {
      rev,
      baseRev,
      clientId: operation.clientId,
      sessionId: operation.sessionId || null,
      timestamp: operation.timestamp || Date.now(),
      data: operation.data
    }

    if (!record.clientId || !record.data) {
      throw new Error('appendOperation requires clientId and data')
    }

    await this.base.append(
      this.schema.dispatch.encode('@bonk-docs/operation-append', record)
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
      compression: snapshot.compression || null,
      data: snapshot.data,
      hash: snapshot.hash || null
    }

    await this.base.append(
      this.schema.dispatch.encode('@bonk-docs/snapshot-save', record)
    )

    return record
  }

  async _assertNextOperationRevision(view, record) {
    const latest = await getLatestEntry(view, '@bonk-docs/operations')
    const latestRev = latest ? latest.rev : 0
    const expected = latestRev + 1

    if (record.rev === expected) return true

    if (record.rev <= latestRev) {
      const existing = await view.get('@bonk-docs/operations', {
        rev: record.rev
      })

      if (existing && this._operationEquals(existing, record)) {
        return false
      }

      throw new Error(
        `Conflicting operation revision ${record.rev}: expected ${expected}`
      )
    }

    throw new Error(
      `Invalid operation revision: expected ${expected}, got ${record.rev}`
    )
  }

  _operationEquals(left = null, right = null) {
    if (!left || !right) return false
    if (left.rev !== right.rev) return false
    if (left.baseRev !== right.baseRev) return false
    if (left.clientId !== right.clientId) return false
    if ((left.sessionId || null) !== (right.sessionId || null)) return false
    if ((left.timestamp || null) !== (right.timestamp || null)) return false

    const leftData = left.data
    const rightData = right.data

    if (!leftData || !rightData) return leftData === rightData

    return b4a.equals(leftData, rightData)
  }
}

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

async function getLatestEntry(view, collection) {
  return await view.findOne(collection, { reverse: true, limit: 1 })
}

export class DocContext extends Context {
  setupRoutes() {
    this.router.add(
      '@pear-docs/metadata-upsert',
      async (data = {}, context) => {
        await this.requirePermission(context.writerKey, PERMISSIONS.DOC_EDIT)

        const record = {
          id: data.id || METADATA_ID,
          title: data.title,
          description: data.description,
          createdAt: data.createdAt || Date.now(),
          updatedAt: data.updatedAt || Date.now(),
          creatorKey: data.creatorKey || context.writerKey,
          rev: data.rev
        }

        if (typeof record.rev !== 'number') {
          throw new Error('metadata-upsert requires numeric rev')
        }

        await this._assertNextRevision(
          context.view,
          '@pear-docs/metadata',
          { id: record.id },
          record.rev,
          'Invalid metadata revision'
        )

        await context.view.insert('@pear-docs/metadata', record)
      }
    )

    this.router.add(
      '@pear-docs/operation-append',
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

        await this._assertNextOperationRevision(context.view, data.rev)

        const record = {
          rev: data.rev,
          baseRev: data.baseRev,
          clientId: data.clientId,
          sessionId: data.sessionId || null,
          timestamp: data.timestamp || Date.now(),
          data: data.data
        }

        await context.view.insert('@pear-docs/operations', record)
      }
    )

    this.router.add('@pear-docs/snapshot-save', async (data = {}, context) => {
      await this.requirePermission(context.writerKey, PERMISSIONS.DOC_SNAPSHOT)

      if (typeof data.rev !== 'number') {
        throw new Error('snapshot-save requires numeric rev')
      }
      if (!data.data) {
        throw new Error('snapshot-save requires snapshot data')
      }

      await context.view.insert('@pear-docs/snapshots', {
        rev: data.rev,
        createdAt: data.createdAt || Date.now(),
        compression: data.compression || null,
        data: data.data,
        hash: data.hash || null
      })
    })

    this.router.add(
      '@pear-docs/presence-upsert',
      async (data = {}, context) => {
        await this.requirePermission(
          context.writerKey,
          PERMISSIONS.PRESENCE_UPDATE
        )

        if (typeof data.id !== 'string' || data.id.length === 0) {
          throw new Error('presence-upsert requires id')
        }

        await context.view.insert('@pear-docs/presence', {
          id: data.id,
          writerKey: data.writerKey || context.writerKey,
          sessionId: data.sessionId || data.id,
          displayName: data.displayName || null,
          color: data.color || null,
          updatedAt: data.updatedAt || Date.now(),
          payload: data.payload || null
        })
      }
    )

    this.router.add(
      '@pear-docs/presence-remove',
      async (data = {}, context) => {
        await this.requirePermission(
          context.writerKey,
          PERMISSIONS.PRESENCE_UPDATE
        )

        if (typeof data.id !== 'string' || data.id.length === 0) {
          throw new Error('presence-remove requires id')
        }

        await context.view.delete('@pear-docs/presence', { id: data.id })
      }
    )

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
      if (definition || !this.writable) continue

      try {
        await this.defineRole(roleName, permissions)
      } catch (error) {
        if (error && error.name === 'PermissionError') {
          continue
        }
        throw error
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

    const existing = await this.base.view.get('@pear-docs/metadata', {
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
      this.schema.dispatch.encode('@pear-docs/metadata-upsert', record)
    )

    return record
  }

  async getMetadata() {
    return await this.base.view.get('@pear-docs/metadata', { id: METADATA_ID })
  }

  async getLatestRevision() {
    const latest = await getLatestEntry(this.base.view, '@pear-docs/operations')
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
      this.schema.dispatch.encode('@pear-docs/operation-append', record)
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
      this.schema.dispatch.encode('@pear-docs/snapshot-save', record)
    )

    return record
  }

  async updatePresence(presence = {}) {
    await this.requirePermission(this.writerKey, PERMISSIONS.PRESENCE_UPDATE)

    const record = {
      id: presence.id,
      writerKey: presence.writerKey || this.writerKey,
      sessionId: presence.sessionId || presence.id || null,
      displayName: presence.displayName || null,
      color: presence.color || null,
      updatedAt: presence.updatedAt || Date.now(),
      payload: presence.payload || null
    }

    if (!record.id) {
      throw new Error('updatePresence requires id')
    }

    await this.base.append(
      this.schema.dispatch.encode('@pear-docs/presence-upsert', record)
    )

    return record
  }

  async removePresence(id) {
    await this.requirePermission(this.writerKey, PERMISSIONS.PRESENCE_UPDATE)

    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('removePresence requires id')
    }

    await this.base.append(
      this.schema.dispatch.encode('@pear-docs/presence-remove', {
        id,
        removedAt: Date.now()
      })
    )
  }

  async _assertNextOperationRevision(view, rev) {
    const latest = await getLatestEntry(view, '@pear-docs/operations')
    const expected = latest ? latest.rev + 1 : 1
    if (rev !== expected) {
      throw new Error(
        `Invalid operation revision: expected ${expected}, got ${rev}`
      )
    }
  }
}

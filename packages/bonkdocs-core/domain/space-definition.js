import { defineSpace, locks } from 'pear-sdk/spaces'
import { yjs } from 'pear-sdk-yjs'
import {
  DEFAULT_TITLE,
  METADATA_ID,
  PERMISSIONS,
  ROLE_EDITOR,
  ROLE_VIEWER
} from './constants.js'

export const DOC_SPACE_TYPE = 'bonkdocs-doc'
export const DOC_LOCK_ID = 'document'
export const YJS_NAMESPACE = 'bonk-docs'

const docSpaceDefinition = defineSpace({
  name: DOC_SPACE_TYPE,
  version: 1,

  roles: {
    owner: ['*'],
    [ROLE_EDITOR]: [
      PERMISSIONS.DOC_EDIT,
      PERMISSIONS.DOC_SNAPSHOT,
      PERMISSIONS.DOC_LOCK
    ],
    [ROLE_VIEWER]: []
  },

  use: [
    yjs({
      namespace: YJS_NAMESPACE,
      updatePermission: PERMISSIONS.DOC_EDIT,
      snapshotPermission: PERMISSIONS.DOC_SNAPSHOT,
      awarenessPermission: false
    }),
    locks({
      namespace: 'bonk-docs',
      acquirePermission: PERMISSIONS.DOC_LOCK,
      releasePermission: PERMISSIONS.DOC_LOCK
    })
  ],

  collections: {
    metadata: {
      schema: {
        id: 'string',
        title: { type: 'string', required: false },
        description: { type: 'string', required: false },
        createdAt: 'uint',
        updatedAt: { type: 'uint', required: false },
        creatorKey: { type: 'buffer', required: false },
        rev: 'uint'
      },
      key: ['id']
    }
  },

  commands: {
    'bonkdocs-doc/metadata-upsert': {
      schema: {
        id: 'string',
        title: { type: 'string', required: false },
        description: { type: 'string', required: false },
        createdAt: 'uint',
        updatedAt: { type: 'uint', required: false },
        creatorKey: { type: 'buffer', required: false },
        rev: 'uint'
      },
      permission: PERMISSIONS.DOC_EDIT,
      async apply(data, tx) {
        const id = data.id || METADATA_ID
        const existing = await tx.db.get('@bonkdocs-doc/metadata', { id })
        const expected = existing ? existing.rev + 1 : 1
        if (data.rev !== expected) return

        await tx.db.insert('@bonkdocs-doc/metadata', {
          id,
          title: data.title || DEFAULT_TITLE,
          description: data.description || null,
          createdAt: data.createdAt || existing?.createdAt || Date.now(),
          updatedAt: data.updatedAt || Date.now(),
          creatorKey: data.creatorKey || existing?.creatorKey || tx.writerKey,
          rev: data.rev
        })
      }
    }
  }
})

export { docSpaceDefinition }
export default docSpaceDefinition

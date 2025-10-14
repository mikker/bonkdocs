export const METADATA_ID = 'doc'

export const ROLE_OWNER = 'doc-owner'
export const ROLE_EDITOR = 'doc-editor'
export const ROLE_COMMENTER = 'doc-commenter'
export const ROLE_VIEWER = 'doc-viewer'

export const PERMISSIONS = {
  DOC_EDIT: 'doc:edit',
  DOC_COMMENT: 'doc:comment',
  DOC_INVITE: 'doc:invite',
  DOC_SNAPSHOT: 'doc:snapshot',
  PRESENCE_UPDATE: 'doc:presence'
}

export const ROLE_PERMISSIONS = {
  [ROLE_OWNER]: [
    PERMISSIONS.DOC_EDIT,
    PERMISSIONS.DOC_COMMENT,
    PERMISSIONS.DOC_INVITE,
    PERMISSIONS.DOC_SNAPSHOT,
    PERMISSIONS.PRESENCE_UPDATE
  ],
  [ROLE_EDITOR]: [
    PERMISSIONS.DOC_EDIT,
    PERMISSIONS.DOC_COMMENT,
    PERMISSIONS.DOC_SNAPSHOT,
    PERMISSIONS.PRESENCE_UPDATE
  ],
  [ROLE_COMMENTER]: [PERMISSIONS.DOC_COMMENT, PERMISSIONS.PRESENCE_UPDATE],
  [ROLE_VIEWER]: [PERMISSIONS.PRESENCE_UPDATE]
}

export const DEFAULT_TITLE = 'Untitled document'

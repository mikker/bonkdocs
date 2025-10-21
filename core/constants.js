export const METADATA_ID = 'doc'

export const ROLE_OWNER = 'doc-owner'
export const ROLE_EDITOR = 'doc-editor'
export const ROLE_COMMENTER = 'doc-commenter'
export const ROLE_VIEWER = 'doc-viewer'

export const PERMISSIONS = {
  DOC_EDIT: 'doc:edit',
  DOC_COMMENT: 'doc:comment',
  DOC_INVITE: 'doc:invite',
  DOC_SNAPSHOT: 'doc:snapshot'
}

export const ROLE_PERMISSIONS = {
  [ROLE_OWNER]: [
    PERMISSIONS.DOC_EDIT,
    PERMISSIONS.DOC_COMMENT,
    PERMISSIONS.DOC_INVITE,
    PERMISSIONS.DOC_SNAPSHOT
  ],
  [ROLE_EDITOR]: [
    PERMISSIONS.DOC_EDIT,
    PERMISSIONS.DOC_COMMENT,
    PERMISSIONS.DOC_SNAPSHOT
  ],
  [ROLE_COMMENTER]: [PERMISSIONS.DOC_COMMENT],
  [ROLE_VIEWER]: []
}

export const DEFAULT_TITLE = 'Untitled document'

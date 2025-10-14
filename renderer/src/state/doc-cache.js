import { loadDocState } from './doc-persistence.js'

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

export function mergeDocsWithCachedMetadata(docs) {
  if (!Array.isArray(docs)) return []

  return docs.map((doc) => {
    if (!doc || typeof doc !== 'object' || !doc.key) return doc
    const cached = loadDocState(doc.key)
    if (!cached) return doc

    const next = { ...doc }

    if (
      typeof cached.title === 'string' &&
      cached.title.trim().length > 0 &&
      cached.title !== next.title
    ) {
      next.title = cached.title
    }

    if (
      isFiniteNumber(cached.revision) &&
      (next.lastRevision == null || cached.revision > next.lastRevision)
    ) {
      next.lastRevision = cached.revision
    }

    if (
      isFiniteNumber(cached.updatedAt) &&
      (next.lastOpenedAt == null || cached.updatedAt > next.lastOpenedAt)
    ) {
      next.lastOpenedAt = cached.updatedAt
    }

    return next
  })
}

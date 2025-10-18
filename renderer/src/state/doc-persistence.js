const STORAGE_KEY = 'bonk-docs/doc-state'
const META_KEY = '__meta__'
const memoryStore = {}

function isBrowserStorageAvailable() {
  try {
    if (typeof localStorage === 'undefined') return false
    const testKey = '__bonk-docs-test__'
    localStorage.setItem(testKey, '1')
    localStorage.removeItem(testKey)
    return true
  } catch {
    return false
  }
}

const hasBrowserStorage = isBrowserStorageAvailable()

function readAll() {
  if (!hasBrowserStorage) return memoryStore
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(data) {
  if (!hasBrowserStorage) {
    Object.keys(memoryStore).forEach((key) => {
      delete memoryStore[key]
    })
    Object.assign(memoryStore, data)
    return
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

function readMeta(all) {
  const entry = all?.[META_KEY]
  if (!entry || typeof entry !== 'object') return null
  return entry
}

export function loadDocState(key) {
  if (!key) return null
  const all = readAll()
  const entry = all?.[key]
  if (!entry || typeof entry !== 'object') return null
  const snapshotText =
    typeof entry.snapshotText === 'string' ? entry.snapshotText : null
  if (!snapshotText) return null
  const revision = Number.isFinite(entry.revision) ? entry.revision : 0
  const snapshotHash =
    typeof entry.snapshotHash === 'string' ? entry.snapshotHash : null
  const pending = Array.isArray(entry.pending) ? entry.pending : []
  const title = typeof entry.title === 'string' ? entry.title : null
  const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : null
  return { revision, snapshotText, snapshotHash, pending, title, updatedAt }
}

export function saveDocState(key, entry) {
  if (!key || !entry) return
  const all = { ...readAll(), [key]: entry }
  writeAll(all)
}

export function clearDocState(key) {
  if (!key) return
  const all = { ...readAll() }
  if (all[key]) {
    delete all[key]
    writeAll(all)
  }
}

export function loadLastDocKey() {
  const all = readAll()
  const meta = readMeta(all)
  if (!meta || typeof meta.lastDoc !== 'string') return null
  return meta.lastDoc
}

export function saveLastDocKey(key) {
  const all = { ...readAll() }
  if (!key) {
    if (all[META_KEY]) {
      const nextMeta = { ...all[META_KEY] }
      delete nextMeta.lastDoc
      if (Object.keys(nextMeta).length === 0) {
        delete all[META_KEY]
      } else {
        all[META_KEY] = nextMeta
      }
      writeAll(all)
    }
    return
  }
  const existingMeta = readMeta(all)
  const nextMeta = { ...existingMeta, lastDoc: key }
  all[META_KEY] = nextMeta
  writeAll(all)
}

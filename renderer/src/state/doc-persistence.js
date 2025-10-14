const STORAGE_KEY = 'pear-docs/doc-state'
const memoryStore = {}

function isBrowserStorageAvailable() {
  try {
    if (typeof localStorage === 'undefined') return false
    const testKey = '__pear-docs-test__'
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
  return { revision, snapshotText, snapshotHash, pending }
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

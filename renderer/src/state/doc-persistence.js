const STORAGE_KEY = 'bonk-docs/doc-state'
const META_KEY = '__meta__'
const memoryStore = {}

function isBrowserStorageAvailable() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return false
    }
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

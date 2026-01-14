const hasBuffer =
  typeof Buffer !== 'undefined' && typeof Buffer.from === 'function'

const emptyBuffer = hasBuffer ? Buffer.alloc(0) : new Uint8Array(0)

export function bufferToHex(value) {
  if (!value) return ''
  if (hasBuffer && Buffer.isBuffer(value)) {
    return value.toString('hex')
  }
  if (value instanceof Uint8Array) {
    return hasBuffer ? Buffer.from(value).toString('hex') : ''
  }
  return ''
}

export function hexToBuffer(hex) {
  if (typeof hex !== 'string' || hex.length === 0) return emptyBuffer
  if (!hasBuffer) return emptyBuffer
  const normalized = hex.length % 2 === 0 ? hex : `0${hex}`
  try {
    return Buffer.from(normalized, 'hex')
  } catch {
    return Buffer.alloc(0)
  }
}

export function buffersEqual(a, b) {
  if (!a || !b) return false
  const bufA = hasBuffer && Buffer.isBuffer(a) ? a : Buffer.from(a)
  const bufB = hasBuffer && Buffer.isBuffer(b) ? b : Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  for (let i = 0; i < bufA.length; i++) {
    if (bufA[i] !== bufB[i]) return false
  }
  return true
}

export function toUint8Array(value) {
  if (!value) return null
  if (value instanceof Uint8Array) return value
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (hasBuffer && Buffer.isBuffer(value)) return new Uint8Array(value)
  return null
}

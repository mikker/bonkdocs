const DEFAULT_VERSION = 1

function fingerprintText(input = '') {
  let hash = 2166136261
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    hash ^= code & 0xff
    hash = Math.imul(hash, 16777619)
    hash >>>= 0
    hash ^= (code >>> 8) & 0xff
    hash = Math.imul(hash, 16777619)
    hash >>>= 0
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0')
  const len = input.length.toString(16)
  return `${hex}:${len}`
}

function computeDeltaSteps(prevText = '', nextText = '') {
  if (prevText === nextText) return []

  const prevLength = prevText.length
  const nextLength = nextText.length
  const minLength = Math.min(prevLength, nextLength)

  let start = 0
  while (start < minLength && prevText[start] === nextText[start]) {
    start++
  }

  let endPrev = prevLength
  let endNext = nextLength
  while (endPrev > start && endNext > start) {
    if (prevText[endPrev - 1] !== nextText[endNext - 1]) break
    endPrev--
    endNext--
  }

  const steps = []
  if (start > 0) {
    steps.push({ op: 'retain', count: start })
  }

  const deleteCount = endPrev - start
  if (deleteCount > 0) {
    steps.push({ op: 'delete', count: deleteCount })
  }

  const insertText = endNext > start ? nextText.slice(start, endNext) : ''
  if (insertText.length > 0) {
    steps.push({ op: 'insert', text: insertText })
  }

  const tailRetain = prevLength - endPrev
  if (tailRetain > 0) {
    steps.push({ op: 'retain', count: tailRetain })
  }

  return steps
}

function applyDeltaSteps(baseText = '', steps = []) {
  if (!Array.isArray(steps) || steps.length === 0) return baseText

  let index = 0
  let output = ''

  for (const rawStep of steps) {
    if (!rawStep || typeof rawStep !== 'object') continue
    const op = rawStep.op
    if (op === 'retain') {
      const count = Number.isFinite(rawStep.count) ? rawStep.count : 0
      if (count <= 0) continue
      const end = Math.min(index + count, baseText.length)
      output += baseText.slice(index, end)
      index = end
    } else if (op === 'delete') {
      const count = Number.isFinite(rawStep.count) ? rawStep.count : 0
      if (count <= 0) continue
      index = Math.min(index + count, baseText.length)
    } else if (op === 'insert') {
      const text = typeof rawStep.text === 'string' ? rawStep.text : ''
      if (text.length === 0) continue
      output += text
    }
  }

  if (index < baseText.length) {
    output += baseText.slice(index)
  }

  return output
}

function normalizeSteps(steps = []) {
  if (!Array.isArray(steps)) return []
  const normalized = []
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue
    if (step.op === 'retain' || step.op === 'delete') {
      const count = Number.isFinite(step.count) ? step.count : 0
      if (count <= 0) continue
      normalized.push({ op: step.op, count })
    } else if (step.op === 'insert') {
      const text = typeof step.text === 'string' ? step.text : ''
      if (text.length === 0) continue
      normalized.push({ op: 'insert', text })
    }
  }
  return normalized
}

function createDeltaPayload(prevText = '', nextText = '') {
  const steps = computeDeltaSteps(prevText, nextText)
  if (steps.length === 0) return null
  return {
    type: 'delta',
    version: DEFAULT_VERSION,
    baseHash: fingerprintText(prevText),
    nextHash: fingerprintText(nextText),
    steps
  }
}

function decodeDeltaPayload(value) {
  let payload = null
  if (value == null) return null

  if (typeof value === 'string') {
    try {
      payload = JSON.parse(value)
    } catch {
      return null
    }
  } else if (value instanceof Uint8Array) {
    try {
      const decoder =
        typeof TextDecoder === 'function' ? new TextDecoder() : null
      const str = decoder
        ? decoder.decode(value)
        : Buffer.from(value).toString()
      payload = JSON.parse(str)
    } catch {
      return null
    }
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    try {
      payload = JSON.parse(value.toString())
    } catch {
      return null
    }
  } else if (typeof value === 'object') {
    payload = value
  }

  if (!payload || typeof payload !== 'object') return null
  if (payload.type !== 'delta') return null
  const version = Number.isInteger(payload.version) ? payload.version : 0
  if (version !== DEFAULT_VERSION) return null

  const baseHash =
    typeof payload.baseHash === 'string' ? payload.baseHash : null
  const nextHash =
    typeof payload.nextHash === 'string' ? payload.nextHash : null
  if (!baseHash || !nextHash) return null

  const steps = normalizeSteps(payload.steps)
  if (steps.length === 0) return null

  return {
    type: 'delta',
    version,
    baseHash,
    nextHash,
    steps
  }
}

export {
  fingerprintText,
  computeDeltaSteps,
  applyDeltaSteps,
  createDeltaPayload,
  decodeDeltaPayload
}

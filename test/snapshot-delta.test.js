import test from 'brittle'
import {
  fingerprintText,
  computeDeltaSteps,
  applyDeltaSteps,
  createDeltaPayload,
  decodeDeltaPayload
} from '../lib/snapshot-delta.js'

test('computeDeltaSteps returns empty when unchanged', (t) => {
  const prev = JSON.stringify({ value: 'hello' })
  const next = JSON.stringify({ value: 'hello' })
  const steps = computeDeltaSteps(prev, next)

  t.ok(Array.isArray(steps))
  t.is(steps.length, 0)
})

test('computeDeltaSteps simple roundtrip', (t) => {
  const prev = JSON.stringify({ value: 'hello' })
  const next = JSON.stringify({ value: 'hello world' })
  const steps = computeDeltaSteps(prev, next)

  t.ok(steps.length > 0)
  const result = applyDeltaSteps(prev, steps)
  t.is(result, next)
})

test('applyDeltaSteps reconstructs string', (t) => {
  const prev = 'abcdef'
  const steps = [
    { op: 'retain', count: 3 },
    { op: 'delete', count: 2 },
    { op: 'insert', text: 'XYZ' },
    { op: 'retain', count: 1 }
  ]
  const next = applyDeltaSteps(prev, steps)
  t.is(next, 'abcXYZf')
})

test('createDeltaPayload returns null for identical input', (t) => {
  const prev = JSON.stringify({ text: 'same' })
  const payload = createDeltaPayload(prev, prev)
  t.is(payload, null)
})

test('createDeltaPayload and decodeDeltaPayload roundtrip', (t) => {
  const prev = JSON.stringify({ a: 1, b: 'two' })
  const next = JSON.stringify({ a: 2, b: 'two', c: true })
  const payload = createDeltaPayload(prev, next)

  t.ok(payload)
  if (!payload) return

  const encoded = JSON.stringify(payload)
  const decoded = decodeDeltaPayload(encoded)
  t.ok(decoded)
  if (!decoded) return

  t.is(decoded.baseHash, fingerprintText(prev))
  t.is(decoded.nextHash, fingerprintText(next))

  const patched = applyDeltaSteps(prev, decoded.steps)
  t.is(patched, next)
})

import { join } from 'path'
import { tmpdir } from 'os'
import * as fs from 'fs/promises'

import test from 'brittle'
import * as Y from 'yjs'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate
} from 'y-protocols/awareness'
import { DocWorker } from '../worker/src/doc-worker.js'
import { toUint8Array } from '../lib/codec.js'

const { mkdtemp } = fs
const rm =
  typeof fs.rm === 'function'
    ? fs.rm
    : async (target, opts = {}) => {
        const recursive = opts.recursive ?? false
        const force = opts.force ?? false
        try {
          await fs.rmdir(target, { recursive })
        } catch (error) {
          if (!force || (error && error.code !== 'ENOENT')) {
            throw error
          }
        }
      }

async function createTempDir(prefix) {
  const basePrefix = join(tmpdir(), `${prefix}-`)
  const dir = await mkdtemp(basePrefix)

  const cleanup = async () => {
    if (typeof rm === 'function') {
      try {
        await rm(dir, { recursive: true, force: true })
      } catch (error) {
        if (!error || error.code !== 'ENOENT') {
          throw error
        }
      }
    }
  }

  return { dir, cleanup }
}

function applyDocPayload(doc, payload) {
  const syncUpdate = toUint8Array(payload?.syncUpdate)
  if (syncUpdate) {
    Y.applyUpdate(doc, syncUpdate)
  }

  const updates = Array.isArray(payload?.updates) ? payload.updates : []
  for (const update of updates) {
    const data = toUint8Array(update?.data)
    if (data) {
      Y.applyUpdate(doc, data)
    }
  }
}

function applyAwarenessPayload(awareness, payload) {
  const update = toUint8Array(payload?.awareness)
  if (!update) return
  applyAwarenessUpdate(awareness, update, 'remote')
}

function waitForText(doc, expected, timeoutMs = 2000) {
  if (doc.getText('body').toString() === expected) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      doc.off('update', handler)
      reject(new Error(`Timed out waiting for "${expected}"`))
    }, timeoutMs)

    const handler = () => {
      if (doc.getText('body').toString() !== expected) return
      clearTimeout(timeout)
      doc.off('update', handler)
      resolve()
    }

    doc.on('update', handler)
  })
}

function waitForAwareness(awareness, predicate, timeoutMs = 2000) {
  if (predicate()) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      awareness.off('update', handler)
      reject(new Error('Timed out waiting for awareness update'))
    }, timeoutMs)

    const handler = () => {
      if (!predicate()) return
      clearTimeout(timeout)
      awareness.off('update', handler)
      resolve()
    }

    awareness.on('update', handler)
  })
}

function captureLocalUpdate(doc, edit) {
  return new Promise((resolve) => {
    const handler = (update) => {
      doc.off('update', handler)
      resolve(update)
    }
    doc.on('update', handler)
    edit()
  })
}

async function startWatcher(worker, key, doc, awareness) {
  let readyResolve
  let ready = false
  const readyPromise = new Promise((resolve) => {
    readyResolve = resolve
  })

  const stop = await worker.watchDoc(key, {}, async (payload) => {
    applyDocPayload(doc, payload)
    if (awareness) applyAwarenessPayload(awareness, payload)
    if (!ready) {
      ready = true
      readyResolve()
    }
  })

  return { stop, ready: readyPromise }
}

test('DocWorker syncs updates between two clients', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-multi')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Multi Doc' })

  const clientA = new Y.Doc()
  const clientB = new Y.Doc()

  const watcherA = await startWatcher(worker, doc.key, clientA)
  const watcherB = await startWatcher(worker, doc.key, clientB)

  t.teardown(async () => {
    await watcherA.stop()
    await watcherB.stop()
  })

  await Promise.all([watcherA.ready, watcherB.ready])

  const updateA = await captureLocalUpdate(clientA, () => {
    clientA.getText('body').insert(0, 'hello ')
  })

  await worker.applyUpdates({
    key: doc.key,
    updates: [
      {
        clientId: 'client-a',
        timestamp: Date.now(),
        data: Buffer.from(updateA)
      }
    ]
  })

  await waitForText(clientB, 'hello ')

  const updateB = await captureLocalUpdate(clientB, () => {
    clientB.getText('body').insert(clientB.getText('body').length, 'world')
  })

  await worker.applyUpdates({
    key: doc.key,
    updates: [
      {
        clientId: 'client-b',
        timestamp: Date.now(),
        data: Buffer.from(updateB)
      }
    ]
  })

  await waitForText(clientA, 'hello world')
  await waitForText(clientB, 'hello world')

  t.is(clientA.getText('body').toString(), 'hello world')
  t.is(clientB.getText('body').toString(), 'hello world')
})

test('DocWorker preserves emoji between clients', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-emoji')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Emoji Doc' })

  const clientA = new Y.Doc()
  const clientB = new Y.Doc()

  const watcherA = await startWatcher(worker, doc.key, clientA)
  const watcherB = await startWatcher(worker, doc.key, clientB)

  t.teardown(async () => {
    await watcherA.stop()
    await watcherB.stop()
  })

  await Promise.all([watcherA.ready, watcherB.ready])

  const expected = '🙂 lol'
  const update = await captureLocalUpdate(clientA, () => {
    clientA.getText('body').insert(0, expected)
  })

  await worker.applyUpdates({
    key: doc.key,
    updates: [
      {
        clientId: 'client-a',
        timestamp: Date.now(),
        data: Buffer.from(update)
      }
    ]
  })

  await waitForText(clientB, expected)

  t.is(clientA.getText('body').toString(), expected)
  t.is(clientB.getText('body').toString(), expected)
})

test('DocWorker broadcasts awareness updates to watchers', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-awareness')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Aware Doc' })

  const clientA = new Y.Doc()
  const clientB = new Y.Doc()
  const awarenessA = new Awareness(clientA)
  const awarenessB = new Awareness(clientB)

  const watcherA = await startWatcher(worker, doc.key, clientA, awarenessA)
  const watcherB = await startWatcher(worker, doc.key, clientB, awarenessB)

  t.teardown(async () => {
    await watcherA.stop()
    await watcherB.stop()
  })
  t.teardown(() => {
    awarenessA.destroy()
    awarenessB.destroy()
  })

  await Promise.all([watcherA.ready, watcherB.ready])

  awarenessA.setLocalStateField('user', {
    name: 'Alice',
    color: '#ff0000'
  })

  const update = encodeAwarenessUpdate(awarenessA, [awarenessA.clientID])

  await worker.applyAwareness({
    key: doc.key,
    update: Buffer.from(update)
  })

  const hasAlice = () =>
    Array.from(awarenessB.getStates().values()).some(
      (state) => state.user?.name === 'Alice'
    )

  await waitForAwareness(awarenessB, hasAlice)

  t.ok(hasAlice(), 'awareness update received')
})

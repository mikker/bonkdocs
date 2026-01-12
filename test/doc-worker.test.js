import { join } from 'path'
import { tmpdir } from 'os'
import * as fs from 'fs/promises'

import test from 'brittle'
import * as Y from 'yjs'
import { DocManager } from '../core/doc-manager.js'
import { DocWorker } from '../worker/src/doc-worker.js'

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

test('DocManager bootstrap metadata', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-manager')
  t.teardown(cleanup)

  const manager = new DocManager(dir)
  t.teardown(async () => {
    await manager.close()
  })

  await manager.ready()

  const context = await manager.createDoc({ title: 'Test Doc' })
  t.ok(context, 'context instance created')

  const metadata = await context.getMetadata()
  t.ok(metadata, 'metadata present')
  t.is(metadata.title, 'Test Doc')
  t.is(metadata.rev, 1)

  await context.close()
})

test('DocWorker watch emits initial sync update', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-sync')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Watcher Doc' })

  const seedDoc = new Y.Doc()
  seedDoc.getText('body').insert(0, 'hello')
  const seedUpdate = Y.encodeStateAsUpdate(seedDoc)

  await worker.applyUpdates({
    key: doc.key,
    updates: [
      {
        clientId: 'seed-client',
        timestamp: Date.now(),
        data: Buffer.from(seedUpdate)
      }
    ]
  })

  const payload = await new Promise((resolve, reject) => {
    worker.watchDoc(doc.key, {}, (update) => resolve(update)).catch(reject)
  })

  t.is(payload.key, doc.key)
  t.ok(payload.syncUpdate, 'sync update present')

  const clientDoc = new Y.Doc()
  if (payload.syncUpdate) {
    Y.applyUpdate(clientDoc, payload.syncUpdate)
  }
  t.is(clientDoc.getText('body').toString(), 'hello')
})

test('DocWorker applyUpdates streams updates to watcher', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-stream')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Stream Doc' })

  let stopWatcher = null
  const updates = []
  let resolveStreamed
  const streamedPromise = new Promise((resolve) => {
    resolveStreamed = resolve
  })

  await new Promise((resolve, reject) => {
    worker
      .watchDoc(doc.key, {}, (payload) => {
        updates.push(payload)
        if (updates.length === 1) resolve()
        if (payload.updates && payload.updates.length > 0 && resolveStreamed) {
          resolveStreamed(payload)
          resolveStreamed = null
        }
      })
      .then((stop) => {
        stopWatcher = stop
      })
      .catch(reject)
  })

  const ydoc = new Y.Doc()
  ydoc.getText('body').insert(0, 'update')
  const update = Y.encodeStateAsUpdate(ydoc)

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

  const streamed = await streamedPromise

  t.ok(streamed.updates.length > 0, 'updates streamed')

  if (stopWatcher) await stopWatcher()
})

test('DocWorker persists snapshots', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-snapshot')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Snapshot Doc' })
  const context = await worker.manager.getDoc(doc.key)
  t.ok(context, 'context resolved')

  const snapshotRecord = await context.base.view.findOne(
    '@bonk-docs/snapshots',
    { reverse: true, limit: 1 }
  )

  t.ok(snapshotRecord?.data, 'snapshot data stored')
})

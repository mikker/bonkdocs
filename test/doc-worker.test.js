import { join } from 'path'
import { tmpdir } from 'os'
import * as fs from 'fs/promises'

import test from 'brittle'
import { Y } from 'pear-sdk-yjs'
import { DocManager } from '../core/doc-manager.js'
import { DocWorker } from '../worker/src/doc-worker.js'

const { mkdtemp } = fs
const rm = fs.rm

async function createTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

test('DocManager bootstraps Pear Space metadata', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-manager-pear')
  t.teardown(cleanup)

  const manager = new DocManager(dir)
  t.teardown(() => manager.close())
  await manager.ready()

  const context = await manager.createDoc({ title: 'Test Doc' })
  const metadata = await context.getMetadata()

  t.ok(context.key, 'space key exists')
  t.is(metadata.title, 'Test Doc')
  t.is(metadata.rev, 1)
})

test('DocWorker creates and lists docs with Pear identity', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-pear-list')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(() => worker.close())
  await worker.ready()

  const created = await worker.createDoc({ title: 'Pear Doc' })
  const docs = await worker.listDocs()
  const identity = await worker.getIdentity()

  t.is(created.doc.title, 'Pear Doc')
  t.is(docs.length, 1)
  t.is(docs[0].key, created.doc.key)
  t.ok(identity?.identityKey, 'Pear identity returned')
})

test('DocWorker watch emits Yjs sync updates', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-pear-sync')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(() => worker.close())
  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Watcher Doc' })
  const seedDoc = new Y.Doc()
  seedDoc.getText('body').insert(0, 'hello')

  await worker.applyUpdates({
    key: doc.key,
    updates: [
      {
        clientId: 'seed-client',
        timestamp: Date.now(),
        data: Buffer.from(Y.encodeStateAsUpdate(seedDoc))
      }
    ]
  })

  const payload = await new Promise((resolve, reject) => {
    let stop = null
    worker
      .watchDoc(doc.key, {}, async (update) => {
        if (!update.syncUpdate || update.revision < 1) return
        if (stop) await stop()
        resolve(update)
      })
      .then((value) => {
        stop = value
      })
      .catch(reject)
  })

  const clientDoc = new Y.Doc()
  Y.applyUpdate(clientDoc, payload.syncUpdate)
  t.is(clientDoc.getText('body').toString(), 'hello')
})

test('DocWorker locks reject future edits', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-pear-lock')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(() => worker.close())
  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Lock Doc' })
  const locked = await worker.lockDoc({ key: doc.key })

  t.ok(locked.lockedAt, 'lock timestamp returned')

  const editDoc = new Y.Doc()
  editDoc.getText('body').insert(0, 'blocked')

  await t.exception(() =>
    worker.applyUpdates({
      key: doc.key,
      updates: [
        {
          clientId: 'blocked-client',
          timestamp: Date.now(),
          data: Buffer.from(Y.encodeStateAsUpdate(editDoc))
        }
      ]
    })
  )
})

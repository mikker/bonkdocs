import test from 'brittle'
import { DocManager } from '../core/doc-manager.js'
import { DocWorker } from '../worker/src/doc-worker.js'
import { join, mkdir, rm } from '../worker/src/platform.js'

async function createTempDir(prefix) {
  const root = join(process.cwd(), 'test-tmp')
  await mkdir(root, { recursive: true })
  const unique = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const dir = join(root, unique)
  await mkdir(dir, { recursive: true })

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

test('DocWorker watch emits initial update', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Watcher Doc' })
  t.is(doc.title, 'Watcher Doc')

  const docs = await worker.listDocs()
  t.is(docs.length, 1)

  let stopWatcher = null
  const updates = []
  let nextResolve = null

  const waitForNextUpdate = () =>
    new Promise((resolve) => {
      nextResolve = resolve
    })

  await new Promise((resolve, reject) => {
    worker
      .watchDoc(doc.key, { includeSnapshot: true }, (payload) => {
        updates.push(payload)
        if (updates.length === 1) {
          resolve()
        }
        if (nextResolve) {
          nextResolve(payload)
          nextResolve = null
        }
      })
      .then((stop) => {
        stopWatcher = stop
      })
      .catch(reject)
  })

  const initialUpdate = updates[0]
  t.is(initialUpdate.key, doc.key)
  t.ok(Array.isArray(initialUpdate.presence), 'presence array present')
  t.is(typeof initialUpdate.capabilities.canEdit, 'boolean')

  const pendingUpdate = waitForNextUpdate()

  const payload = {
    type: 'replace',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello from applyOps' }]
        }
      ]
    }
  }

  const applyRes = await worker.applyOperations({
    key: doc.key,
    ops: [
      {
        rev: initialUpdate.revision + 1,
        baseRev: initialUpdate.revision,
        clientId: 'a'.repeat(64),
        sessionId: 'b'.repeat(64),
        timestamp: Date.now(),
        data: Buffer.from(JSON.stringify(payload))
      }
    ],
    clientTime: Date.now()
  })

  t.ok(applyRes.accepted)
  t.is(applyRes.applied, 1)
  t.is(applyRes.revision, initialUpdate.revision + 1)

  const nextUpdate = await pendingUpdate
  t.is(nextUpdate.revision, initialUpdate.revision + 1)

  if (stopWatcher) await stopWatcher()
})

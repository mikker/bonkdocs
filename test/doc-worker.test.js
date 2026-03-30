import { join } from 'path'
import { tmpdir } from 'os'
import * as fs from 'fs/promises'

import test from 'brittle'
import * as Y from 'yjs'
import { IdentityManager } from 'facebonk/src/index.js'
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

test('DocWorker links and reopens a Facebonk identity', async (t) => {
  const { dir: facebonkDir, cleanup: cleanupFacebonk } =
    await createTempDir('doc-worker-facebonk-source')
  const { dir: bonkdocsDir, cleanup: cleanupBonkdocs } =
    await createTempDir('doc-worker-facebonk-target')

  t.teardown(cleanupFacebonk)
  t.teardown(cleanupBonkdocs)

  const steward = new IdentityManager(facebonkDir)
  t.teardown(async () => {
    await steward.close()
  })
  await steward.ready()

  const sourceIdentity = await steward.initIdentity({
    displayName: 'Alice Bonk',
    bio: 'P2P profile'
  })
  const invite = await sourceIdentity.createLinkInvite()

  const worker = new DocWorker({ baseDir: bonkdocsDir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const linked = await worker.linkIdentity(invite)
  t.is(linked?.identityKey, sourceIdentity.key.toString('hex'))
  t.is(linked?.profile?.displayName, 'Alice Bonk')

  const reopened = await worker.getIdentity()
  t.is(reopened?.identityKey, sourceIdentity.key.toString('hex'))
  t.is(reopened?.profile?.bio, 'P2P profile')
})

test('DocWorker reads a linked Facebonk avatar', async (t) => {
  const { dir: facebonkDir, cleanup: cleanupFacebonk } =
    await createTempDir('doc-worker-facebonk-avatar-source')
  const { dir: bonkdocsDir, cleanup: cleanupBonkdocs } =
    await createTempDir('doc-worker-facebonk-avatar-target')

  t.teardown(cleanupFacebonk)
  t.teardown(cleanupBonkdocs)

  const steward = new IdentityManager(facebonkDir)
  t.teardown(async () => {
    await steward.close()
  })
  await steward.ready()

  const sourceIdentity = await steward.initIdentity({
    displayName: 'Avatar Bonk'
  })
  await sourceIdentity.setAvatar(Buffer.from('avatar-png'), {
    mimeType: 'image/png'
  })
  const invite = await sourceIdentity.createLinkInvite()

  const worker = new DocWorker({ baseDir: bonkdocsDir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()
  await worker.linkIdentity(invite)

  const avatar = await worker.getIdentityAvatar()
  t.ok(avatar?.dataUrl?.startsWith('data:image/png;base64,'), 'avatar data URL returned')
  t.is(avatar?.mimeType, 'image/png')
  t.is(avatar?.byteLength, Buffer.byteLength('avatar-png'))
})

test('DocWorker resets linked Facebonk auth without touching docs', async (t) => {
  const { dir: facebonkDir, cleanup: cleanupFacebonk } =
    await createTempDir('doc-worker-facebonk-reset-source')
  const { dir: bonkdocsDir, cleanup: cleanupBonkdocs } =
    await createTempDir('doc-worker-facebonk-reset-target')

  t.teardown(cleanupFacebonk)
  t.teardown(cleanupBonkdocs)

  const steward = new IdentityManager(facebonkDir)
  t.teardown(async () => {
    await steward.close()
  })
  await steward.ready()

  const sourceIdentity = await steward.initIdentity({
    displayName: 'Reset Bonk'
  })
  const invite = await sourceIdentity.createLinkInvite()

  const worker = new DocWorker({ baseDir: bonkdocsDir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()
  const created = await worker.createDoc({ title: 'Still here' })
  await worker.linkIdentity(invite)

  const reset = await worker.resetIdentity()
  t.is(reset?.reset, true)
  t.is(await worker.getIdentity(), null)

  const reopenedDoc = await worker.getDoc(created.doc.key)
  t.is(reopenedDoc?.doc?.title, 'Still here')
})

test('DocWorker listDocs prefetches document titles from metadata', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-list')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Original title' })
  await worker.renameDoc({ key: doc.key, title: 'Renamed title' })
  await worker.manager.localDb.put(`contexts/${doc.key}`, {
    ...(await worker.manager.localDb.get(`contexts/${doc.key}`)).value,
    title: null
  })

  const docs = await worker.listDocs()
  t.is(docs[0]?.title, 'Renamed title')
})

test('DocWorker ignores closed db errors during queued broadcasts', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-broadcast')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Broadcast Doc' })
  const context = await worker.manager.getDoc(doc.key)

  worker.watchers.set(doc.key, new Set([{ closed: false, emit: async () => {} }]))
  worker.subscriptions.set(doc.key, () => {})

  worker._ensureSync = async () => ({})
  worker._refreshSync = async () => ({ updates: null, syncUpdate: null })
  worker._refreshAwareness = async () => {
    throw new Error('Hyperdb is closed')
  }

  await worker._broadcastUpdates(context)

  t.absent(worker.watchers.get(doc.key), 'watchers cleared after close error')
  t.absent(
    worker.subscriptions.get(doc.key),
    'subscriptions cleared after close error'
  )
})

test('DocWorker closes pairer before opening joined context', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-pair')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const originalContextClass = worker.manager.ContextClass
  const key = Buffer.alloc(32, 1)
  const encryptionKey = Buffer.alloc(32, 2)
  const writerKey = Buffer.alloc(32, 3)
  let pairerClosed = false
  let finalReadySawClosedPairer = false

  class FakeContext {
    static pair() {
      return {
        candidate: null,
        async ready() {},
        async resolve() {
          return {
            key,
            encryptionKey,
            async ready() {},
            async close() {}
          }
        },
        async close() {
          pairerClosed = true
        }
      }
    }

    constructor() {
      this.writerKey = writerKey
    }

    async ready() {
      finalReadySawClosedPairer = pairerClosed
    }

    async getMetadata() {
      return {
        title: 'Joined doc',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    }

    async close() {}
  }

  worker.manager.ContextClass = FakeContext
  t.teardown(() => {
    worker.manager.ContextClass = originalContextClass
  })

  const events = []

  const result = await worker.pairInvite(
    { invite: 'fake-invite' },
    async (status) => {
      events.push(status)
    }
  )

  t.ok(finalReadySawClosedPairer, 'joined context opens after pairer closes')
  t.ok(pairerClosed, 'pairer closed during handoff')
  t.is(result, undefined, 'pairInvite resolves without returning a payload')
  t.is(events.at(-1)?.state, 'joined', 'joined status emitted')
})

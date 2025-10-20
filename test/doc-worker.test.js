import { join } from 'path'
import { tmpdir } from 'os'
import * as fs from 'fs/promises'

import test from 'brittle'
import { DocManager } from '../core/doc-manager.js'
import { DocWorker } from '../worker/src/doc-worker.js'
import { createDeltaPayload } from '../lib/snapshot-delta.js'

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

test('DocWorker applies delta operations and persists snapshot', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-delta')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Delta Doc' })
  const prevDoc = {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  }
  const nextDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Updated via delta' }]
      }
    ]
  }

  const prevText = JSON.stringify(prevDoc)
  const nextText = JSON.stringify(nextDoc)
  const delta = createDeltaPayload(prevText, nextText)
  t.ok(delta, 'delta payload created')
  if (!delta) return

  const timestamp = Date.now()
  const applyRes = await worker.applyOperations({
    key: doc.key,
    ops: [
      {
        rev: 1,
        baseRev: 0,
        clientId: 'c'.repeat(64),
        sessionId: 'd'.repeat(64),
        timestamp,
        data: Buffer.from(JSON.stringify(delta))
      }
    ],
    clientTime: timestamp
  })

  t.ok(applyRes.accepted)
  t.is(applyRes.revision, 1)

  const context = await worker.manager.getDoc(doc.key)
  t.ok(context, 'context resolved')

  const snapshotRecord = await context.base.view.findOne(
    '@bonk-docs/snapshots',
    { reverse: true, limit: 1 }
  )

  t.ok(snapshotRecord?.data, 'snapshot data stored')
  if (!snapshotRecord?.data) return

  const parsed = JSON.parse(snapshotRecord.data.toString())
  t.is(
    parsed.content?.[0]?.content?.[0]?.text,
    'Updated via delta',
    'snapshot reflects delta content'
  )
})

test('DocWorker watchDoc streams operations after sinceRevision', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-stream')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Stream Doc' })

  const baseDoc = {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  }
  const firstDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Step one' }]
      }
    ]
  }
  const secondDoc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Step one' }]
      },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Step two' }]
      }
    ]
  }

  const deltaOne = createDeltaPayload(
    JSON.stringify(baseDoc),
    JSON.stringify(firstDoc)
  )
  const deltaTwo = createDeltaPayload(
    JSON.stringify(firstDoc),
    JSON.stringify(secondDoc)
  )

  t.ok(deltaOne && deltaTwo, 'delta payloads created')
  if (!deltaOne || !deltaTwo) {
    t.fail('deltas missing')
    return
  }

  const now = Date.now()
  await worker.applyOperations({
    key: doc.key,
    ops: [
      {
        rev: 1,
        baseRev: 0,
        clientId: 'e'.repeat(64),
        sessionId: 'f'.repeat(64),
        timestamp: now,
        data: Buffer.from(JSON.stringify(deltaOne))
      }
    ],
    clientTime: now
  })

  await worker.applyOperations({
    key: doc.key,
    ops: [
      {
        rev: 2,
        baseRev: 1,
        clientId: 'g'.repeat(64),
        sessionId: 'h'.repeat(64),
        timestamp: now + 1,
        data: Buffer.from(JSON.stringify(deltaTwo))
      }
    ],
    clientTime: now + 1
  })

  const updates = []
  let stopWatcher = null
  const received = new Promise((resolve, reject) => {
    worker
      .watchDoc(
        doc.key,
        { sinceRevision: 0, includeSnapshot: false },
        async (payload) => {
          updates.push(payload)
          resolve(null)
        }
      )
      .then((stop) => {
        stopWatcher = stop
      })
      .catch(reject)
  })

  await received

  if (stopWatcher) await stopWatcher()

  t.is(updates.length, 1, 'received one update')
  const update = updates[0]
  t.ok(Array.isArray(update.ops), 'ops array present')
  t.is(update.ops.length, 2, 'two operations streamed')
  const decoded = update.ops.map((op) =>
    JSON.parse(Buffer.from(op.data).toString())
  )
  t.is(decoded[0].type, 'delta')
  t.is(decoded[1].type, 'delta')
  t.is(decoded[1].steps.length > 0, true)
})

test('DocWorker invite lifecycle', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-invite')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Invite Doc' })
  const key = doc.key

  const initialInvites = await worker.listInvites(key)
  t.is(initialInvites.length, 0, 'no invites initially')

  const created = await worker.createInvite(key, ['doc-viewer'])
  t.ok(created.invite, 'invite code returned')
  t.ok(created.inviteId, 'invite id returned')

  const afterCreate = await worker.listInvites(key)
  t.is(afterCreate.length, 1, 'invite listed after creation')
  t.ok(afterCreate[0].roles.includes('doc-viewer'), 'invite includes read role')

  await worker.revokeInvite(key, afterCreate[0].id)

  const afterRevoke = await worker.listInvites(key)
  t.is(afterRevoke.length, 0, 'invite list empty after revoke')
})

test('DocWorker surfaces revision conflicts with recovery info', async (t) => {
  const { dir, cleanup } = await createTempDir('doc-worker-conflict')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(async () => {
    await worker.close()
  })

  await worker.ready()

  const { doc } = await worker.createDoc({ title: 'Conflict Doc' })
  const context = await worker.manager.getDoc(doc.key)
  t.ok(context, 'context retrieved')
  if (!context) return

  const payloadA = {
    type: 'replace',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First edit' }]
        }
      ]
    }
  }

  const payloadB = {
    type: 'replace',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Conflicting edit' }]
        }
      ]
    }
  }

  const originalGetLatestRevision = context.getLatestRevision.bind(context)
  const revisionQueue = [0, 1]
  context.getLatestRevision = async () =>
    revisionQueue.length > 0 ? revisionQueue.shift() : 1

  const originalViewGet = context.base.view.get.bind(context.base.view)
  const existingRecord = {
    baseRev: 0,
    clientId: Buffer.from('b'.repeat(32)),
    sessionId: Buffer.from('b'.repeat(32)),
    data: Buffer.from(JSON.stringify(payloadB))
  }
  context.base.view.get = async (collection, query) => {
    if (collection === '@bonk-docs/operations' && query?.rev === 1) {
      return existingRecord
    }
    return await originalViewGet(collection, query)
  }

  const originalAppend = context.appendOperation.bind(context)
  let firstCall = true
  context.appendOperation = async function (...args) {
    if (firstCall) {
      firstCall = false
      throw new Error('Conflicting operation revision 1: expected 2')
    }
    return args[0]
  }

  t.teardown(() => {
    context.getLatestRevision = originalGetLatestRevision
    context.base.view.get = originalViewGet
    context.appendOperation = originalAppend
  })

  const timestamp = Date.now()
  const result = await worker.applyOperations({
    key: doc.key,
    ops: [
      {
        rev: 1,
        baseRev: 0,
        clientId: 'a'.repeat(64),
        sessionId: 'a'.repeat(64),
        timestamp,
        data: Buffer.from(JSON.stringify(payloadA))
      }
    ],
    clientTime: timestamp
  })

  t.is(result.accepted, false, 'conflicting operation rejected')
  t.is(result.reason, 'REVISION_CONFLICT')
  t.is(result.revision, 1)
  t.ok(result.conflict, 'conflict payload provided')
  if (result.conflict) {
    t.is(result.conflict.attemptedRevision, 1)
    t.is(result.conflict.existingRevision, 1)
    t.is(result.conflict.baseRevision, 0)
    t.is(result.conflict.message.includes('Conflicting operation revision'), true)
  }

  await context.close?.()
})

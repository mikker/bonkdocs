import { EventEmitter } from 'events'
import { join } from 'path'
import { tmpdir } from 'os'
import * as fs from 'fs/promises'

import test from 'brittle'
import { Y } from 'pear-sdk-yjs'

import HRPC from '../packages/bonkdocs-core/hrpc.js'
import { DocWorker } from '../packages/bonkdocs-core/service/doc-worker.js'
import { createRpcServer } from '../packages/bonkdocs-core/service/rpc-server.js'

const { mkdtemp, rm } = fs

class MemoryStream extends EventEmitter {
  destroyed = false
  peer = null

  write(data) {
    if (this.destroyed || !this.peer || this.peer.destroyed) return false
    const payload = Buffer.from(data)
    queueMicrotask(() => {
      if (!this.peer.destroyed) this.peer.emit('data', payload)
    })
    return true
  }

  destroy(error) {
    if (this.destroyed) return this
    this.destroyed = true
    if (error) this.emit('error', error)
    this.emit('close')
    return this
  }
}

function createStreamPair() {
  const left = new MemoryStream()
  const right = new MemoryStream()
  left.peer = right
  right.peer = left
  return { left, right }
}

async function createTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-`))
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true })
  }
}

function nextData(stream, predicate = () => true, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error('Timed out waiting for stream data'))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      stream.off('data', onData)
      stream.off('error', onError)
    }

    const onData = (data) => {
      if (!predicate(data)) return
      cleanup()
      resolve(data)
    }

    const onError = (error) => {
      cleanup()
      reject(error)
    }

    stream.on('data', onData)
    stream.on('error', onError)
  })
}

test('HRPC e2e creates, watches, edits, renames, invites, and locks a Pear doc', async (t) => {
  const { dir, cleanup } = await createTempDir('bonkdocs-hrpc-e2e')
  t.teardown(cleanup)

  const worker = new DocWorker({ baseDir: dir })
  t.teardown(() => worker.close())
  await worker.ready()

  const pair = createStreamPair()
  const server = createRpcServer(pair.right, worker)
  const client = new HRPC(pair.left)
  t.teardown(() => {
    pair.left.destroy()
    pair.right.destroy()
  })

  const initialized = await client.initialize({})
  t.alike(initialized.docs, [])
  t.ok(initialized.identity?.identityKey, 'identity returned')

  const created = await client.createDoc({ title: 'E2E Doc' })
  t.is(created.doc.title, 'E2E Doc')

  const watch = client.watchDoc({ key: created.doc.key })
  t.teardown(() => watch.destroy())

  const initial = await nextData(watch)
  t.is(initial.title, 'E2E Doc')
  t.ok(initial.syncUpdate, 'initial sync update returned')

  const ydoc = new Y.Doc()
  ydoc.getText('body').insert(0, 'hello e2e')
  const applied = await client.applyUpdates({
    key: created.doc.key,
    updates: [
      {
        clientId: 'hrpc-e2e-client',
        timestamp: Date.now(),
        data: Buffer.from(Y.encodeStateAsUpdate(ydoc))
      }
    ]
  })
  t.is(applied.accepted, true)

  const changed = await nextData(watch, (payload) => payload.revision >= 1)
  const hydrated = new Y.Doc()
  Y.applyUpdate(hydrated, changed.syncUpdate)
  t.is(hydrated.getText('body').toString(), 'hello e2e')

  const renamed = await client.renameDoc({
    key: created.doc.key,
    title: 'Renamed E2E Doc'
  })
  t.is(renamed.title, 'Renamed E2E Doc')

  const invite = await client.createInvite({
    key: created.doc.key,
    roles: ['doc-editor']
  })
  t.ok(invite.invite, 'invite code returned')

  const invites = await client.listInvites({ key: created.doc.key })
  t.is(invites.invites.length, 1)

  const locked = await client.lockDoc({ key: created.doc.key })
  t.ok(locked.lockedAt, 'lock timestamp returned')

  await t.exception(() =>
    client.applyUpdates({
      key: created.doc.key,
      updates: [
        {
          clientId: 'blocked-after-lock',
          timestamp: Date.now(),
          data: Buffer.from(Y.encodeStateAsUpdate(ydoc))
        }
      ]
    })
  )

  server._stream?.destroy?.()
})

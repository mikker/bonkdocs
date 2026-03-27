import { EventEmitter } from 'node:events'

import test from 'brittle'

import { UpdaterWorker } from '../packages/bonkdocs-core/service/updater-worker.js'

function createMockPearClass(updater) {
  return class MockPear {
    constructor() {
      this.updater = updater
    }

    async ready() {}

    async close() {}
  }
}

test('UpdaterWorker applyUpdate throws when updater missing', async (t) => {
  t.plan(1)

  class NoUpdaterPear {
    constructor() {
      this.updater = null
    }

    async ready() {}

    async close() {}
  }

  const w = new UpdaterWorker({}, NoUpdaterPear)
  await t.exception(async () => {
    await w.applyUpdate()
  }, /Updater is not available/)
})

test('UpdaterWorker subscribeStatus streams events and destroy unsubscribes', async (t) => {
  t.plan(4)

  const ee = new EventEmitter()
  ee.ready = async () => {}
  ee.applyUpdate = async () => {}

  const w = new UpdaterWorker({}, createMockPearClass(ee))
  const seen = []

  const stream = w.subscribeStatus()
  stream.on('data', (e) => {
    seen.push(e.type)
  })
  stream.resume()

  await new Promise((resolve) => stream.once('open', resolve))

  ee.emit('updating')
  ee.emit('updated')
  await new Promise((r) => setImmediate(r))
  t.is(seen.length, 2)
  t.is(seen[0], 'updating')
  t.is(seen[1], 'updated')

  stream.destroy()
  ee.emit('updating')
  await new Promise((r) => setImmediate(r))
  t.is(seen.length, 2)
})

test('UpdaterWorker applyUpdate calls underlying applyUpdate', async (t) => {
  t.plan(1)
  let called = false
  const ee = new EventEmitter()
  ee.ready = async () => {}
  ee.applyUpdate = async () => {
    called = true
  }
  const w = new UpdaterWorker({}, createMockPearClass(ee))
  await w.applyUpdate()
  t.ok(called)
})

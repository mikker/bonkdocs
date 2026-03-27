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

test('UpdaterWorker subscribeStatus forwards events and unsubscribes', async (t) => {
  t.plan(4)

  const ee = new EventEmitter()
  ee.ready = async () => {}
  ee.applyUpdate = async () => {}

  const w = new UpdaterWorker({}, createMockPearClass(ee))
  const seen = []

  const unsub = w.subscribeStatus((e) => {
    seen.push(e.event)
  })

  ee.emit('updating')
  ee.emit('updated')
  t.is(seen.length, 2)
  t.is(seen[0], 'updating')
  t.is(seen[1], 'updated')

  unsub()
  ee.emit('updating')
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

/* global Bare */

const PearRuntime = require('pear-mobile')
const goodbye = require('graceful-goodbye')
const { version, upgrade, productName, name } = require('../../package.json')

const isDev = Bare.argv.pop()
const updates = isDev?.toLowerCase() === 'false'

async function main() {
  const pear = new PearRuntime({
    version,
    upgrade,
    name: productName ?? name,
    updates
  })

  pear.updater.on('error', (error) => {
    console.error('[mobile-worker] updater error', error)
  })

  goodbye(async () => {
    await pear.close()
  })

  await pear.ready()

  globalThis.__BONKDOCS_STORAGE_ROOT__ = pear.storage

  if (updates) {
    pear.updater.on('updated', async () => {
      try {
        await pear.updater.applyUpdate()
      } catch (error) {
        console.error('[mobile-worker] failed to apply update', error)
      }
    })
  }

  const { bootstrapWorkerRuntime } =
    await import('../../packages/bonkdocs-core/worker-runtime.js')

  await bootstrapWorkerRuntime()
}

void main().catch((error) => {
  console.error('[mobile-worker] failed to boot', error)
  throw error
})

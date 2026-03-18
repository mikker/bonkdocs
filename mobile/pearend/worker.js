/* global Bare */

import PearRuntime from 'pear-mobile'
import goodbye from 'graceful-goodbye'

const isDev = Bare.argv.pop()
const updates = isDev?.toLowerCase() === 'false'

const pear = new PearRuntime({
  name: 'Bonk Docs Mobile',
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

await import('../../packages/bonkdocs-core/worker-runtime.js')

import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
// @ts-ignore
import updates from 'pear-updates'
import { teardownRpc } from './lib/rpc'
import './global.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Renderer bootstrap failed: #root element missing')
}

const root = createRoot(rootElement)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

let reloading = false

updates(async (update: { diff?: Array<{ key: string }> } | null) => {
  if (reloading) return

  // Only reload on client changes
  const diff = Array.isArray(update?.diff) ? update.diff : []
  const paths = diff.map((entry: { key: string }) => entry.key)
  console.log(paths)
  if (paths.filter((path) => !path.match(/\/renderer\/src/)).length === 0) {
    return
  }

  reloading = true

  // await teardownRpc()

  console.log('reloading due to update:', paths)
  // Pear.reload()
})
//
Pear.teardown(async () => {
  console.log('teardown')
  await teardownRpc()
})

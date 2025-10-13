import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
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

// let reloading = false

updates((update) => {
  //   if (reloading) return
  //
  const paths = update.diff.map((entry) => entry.key)
  //   if (paths.filter((path) => !path.match(/\/renderer\/src/)).length === 0)
  //     return
  //
  //   reloading = true
  //
  //   // await teardownRpc()
  //
  console.log('reloading due to update:', paths)
  //   // Pear.reload()
})
//
Pear.teardown(async () => {
  console.log('teardown')
  await teardownRpc()
})

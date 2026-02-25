import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { teardownRpc } from './lib/rpc'
import { ensurePearCompat } from './lib/pear-compat'
import './global.css'

ensurePearCompat()

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

Pear.teardown(async () => {
  console.log('teardown')
  await teardownRpc()
})

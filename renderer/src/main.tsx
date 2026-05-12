import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { teardownRpc } from './lib/rpc'
import './global.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Renderer bootstrap failed: #root element missing')
}

function renderBootstrapError(error: unknown) {
  const message =
    error instanceof Error ? error.stack || error.message : String(error)
  const pre = document.createElement('pre')
  pre.style.padding = '16px'
  pre.style.whiteSpace = 'pre-wrap'
  pre.style.font = '12px/1.5 monospace'
  pre.textContent = message
  rootElement.replaceChildren(pre)
}

try {
  const root = createRoot(rootElement)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )

  window.addEventListener('beforeunload', () => {
    void teardownRpc()
  })
} catch (error) {
  console.error('Renderer bootstrap failed', error)
  renderBootstrapError(error)
}

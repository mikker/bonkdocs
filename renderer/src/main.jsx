import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import updates from 'pear-updates'
import pearPipe from 'pear-pipe'
import './global.css'

console.log('link', Pear.config.link)
console.log('linkData', Pear.config.linkData)
console.log('key', Pear.config.key)

// const pipe = pearPipe()

// pipe.on('data', (data) => {
//   const cmd = Butter.from(data).toString()
//   console.log(cmd)
// })

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
  //   // await teardownRpc()
})

import { spawn } from 'node:child_process'

const DEV_SERVER_URL = 'http://localhost:5173'
const BONK_DOCS_MARKERS = ['<title>Bonk Docs</title>', 'src/main.tsx']

function isBonkDocsDevServer(body) {
  return BONK_DOCS_MARKERS.every((marker) => body.includes(marker))
}

async function fetchDevServerHtml() {
  try {
    const response = await fetch(DEV_SERVER_URL)
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

async function waitForBonkDocsDevServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const html = await fetchDevServerHtml()
    if (html && isBonkDocsDevServer(html)) return true
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  return false
}

function spawnProcess(command, args, extraEnv = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  })
}

async function main() {
  let vite = null
  let shuttingDown = false

  const existingHtml = await fetchDevServerHtml()
  const hasReusableDevServer =
    existingHtml !== null && isBonkDocsDevServer(existingHtml)

  if (!hasReusableDevServer) {
    vite = spawnProcess('vite', [
      '--config',
      'renderer/vite.config.js',
      '--port',
      '5173',
      '--strictPort'
    ])

    const ready = await waitForBonkDocsDevServer()
    if (!ready) {
      vite.kill('SIGTERM')
      process.exitCode = 1
      throw new Error('Timed out waiting for Bonk Docs dev server on port 5173')
    }
  }

  const electron = spawnProcess('electron', ['.', '--no-updates'], {
    PEAR_DEV_SERVER_URL: DEV_SERVER_URL
  })

  function cleanup(signal) {
    if (shuttingDown) return
    shuttingDown = true

    if (vite && !vite.killed) vite.kill(signal)
    if (!electron.killed) electron.kill(signal)
  }

  process.on('SIGINT', () => cleanup('SIGINT'))
  process.on('SIGTERM', () => cleanup('SIGTERM'))

  electron.on('exit', (code, signal) => {
    if (vite && !vite.killed) vite.kill('SIGTERM')

    if (signal) {
      process.kill(process.pid, signal)
      return
    }

    process.exit(code ?? 0)
  })

  if (vite) {
    vite.on('exit', (code) => {
      if (shuttingDown) return

      if (code !== 0) {
        if (!electron.killed) electron.kill('SIGTERM')
        process.exit(code ?? 1)
      }
    })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

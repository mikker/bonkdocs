import FramedStream from 'framed-stream'
import pearPipe from 'pear-pipe'
import { DocWorker } from './src/doc-worker.js'
import { createRpcServer } from './src/rpc-server.js'
import { join, currentDirectory } from './src/platform.js'

let workerInstance = null
let rpcInstance = null

export async function initializeWorker(options = {}) {
  if (!workerInstance) {
    const baseDir = options.baseDir || resolveBaseDir()
    workerInstance = new DocWorker({
      baseDir,
      bootstrap: options.bootstrap,
      autobase: options.autobase,
      ensureStorage: options.ensureStorage ?? true
    })
  }

  if (options.rpc && rpcInstance === null) {
    rpcInstance = createRpcServer(options.rpc, workerInstance)
  }

  await workerInstance.ready()
  return workerInstance
}

function resolveBaseDir() {
  const envRoot =
    typeof process !== 'undefined' ? process.env?.PEAR_APP_DATA : null
  const pearStorage =
    typeof Pear !== 'undefined' && Pear?.config?.storage
      ? Pear.config.storage
      : null

  if (pearStorage) return join(pearStorage, 'pear-docs')
  if (envRoot) return join(envRoot, 'pear-docs')
  return join(currentDirectory, 'pear-docs-data')
}

async function bootstrapWithPear() {
  if (typeof Pear === 'undefined') return

  const pipe = pearPipe()
  if (!pipe) return

  const framed = new FramedStream(pipe)
  const pearConfig = Pear.config || {}

  await initializeWorker({
    baseDir: pearConfig.storage
      ? join(pearConfig.storage, 'pear-docs')
      : resolveBaseDir(),
    bootstrap: pearConfig.bootstrap,
    autobase: pearConfig.autobase,
    ensureStorage: true,
    rpc: framed
  })

  const cleanup = async () => {
    try {
      await workerInstance?.close()
    } catch {}
    workerInstance = null
    rpcInstance = null
  }

  pipe.on('close', cleanup)
  pipe.on('error', () => {})
}

void bootstrapWithPear()

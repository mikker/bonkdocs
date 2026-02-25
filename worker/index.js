import process from 'process'
import { join } from 'path'

import { DocWorker } from './src/doc-worker.js'
import { createRpcServer } from './src/rpc-server.js'

let workerInstance = null
let rpcInstance = null

export async function initializeWorker(options = {}) {
  if (!workerInstance) {
    const baseDir = options.baseDir || resolveBaseDir(options.storageRoot)
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

function resolveStorageRoot(explicitStorageRoot = null) {
  if (
    typeof explicitStorageRoot === 'string' &&
    explicitStorageRoot.trim().length > 0
  ) {
    return explicitStorageRoot.trim()
  }

  const bareArgv = globalThis.Bare?.argv
  if (Array.isArray(bareArgv) && typeof bareArgv[2] === 'string') {
    const storageRoot = bareArgv[2].trim()
    if (storageRoot.length > 0) {
      return storageRoot
    }
  }

  const envRoot =
    typeof process !== 'undefined' ? process.env?.PEAR_APP_DATA : null

  if (typeof envRoot === 'string' && envRoot.trim().length > 0) {
    return envRoot.trim()
  }

  const cwd =
    typeof process !== 'undefined' && typeof process.cwd === 'function'
      ? process.cwd()
      : '/'

  return cwd
}

function resolveBaseDir(storageRoot = null) {
  const root = resolveStorageRoot(storageRoot)
  if (storageRoot === null && root === process.cwd()) {
    return join(root, 'bonk-docs-data')
  }
  return join(root, 'bonk-docs')
}

function createBareIpcStream() {
  const ipc = globalThis.Bare?.IPC
  if (!ipc || typeof ipc.on !== 'function' || typeof ipc.write !== 'function') {
    return null
  }

  const stream = {
    on(event, listener) {
      ipc.on(event, listener)
      return stream
    },
    off(event, listener) {
      if (typeof ipc.off === 'function') {
        ipc.off(event, listener)
      } else if (typeof ipc.removeListener === 'function') {
        ipc.removeListener(event, listener)
      }
      return stream
    },
    write(data) {
      ipc.write(data)
      return true
    },
    destroy(error) {
      if (error) {
        console.error('[worker] IPC stream destroyed', error)
      }
      return stream
    }
  }

  return stream
}

async function bootstrapWithRuntime() {
  const ipcStream = createBareIpcStream()
  if (!ipcStream) return

  await initializeWorker({
    baseDir: resolveBaseDir(),
    ensureStorage: true,
    rpc: ipcStream
  })

  const cleanup = async () => {
    try {
      await workerInstance?.close()
    } catch {}
    workerInstance = null
    rpcInstance = null
  }

  ipcStream.on('close', cleanup)
  ipcStream.on('error', () => {})
}

void bootstrapWithRuntime()

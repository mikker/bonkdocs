import process from 'process'
import { join } from 'path'

import { DocWorker } from './service/doc-worker.js'
import { createRpcServer } from './service/rpc-server.js'

let workerInstance = null
let rpcInstance = null

function normalizeStorageRoot(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

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
  const globalRoot = normalizeStorageRoot(globalThis.__BONKDOCS_STORAGE_ROOT__)
  if (globalRoot) {
    return globalRoot
  }

  const explicitRoot = normalizeStorageRoot(explicitStorageRoot)
  if (explicitRoot) {
    return explicitRoot
  }

  const bareArgv = globalThis.Bare?.argv
  if (Array.isArray(bareArgv)) {
    const bareRoot = normalizeStorageRoot(bareArgv[2])
    if (bareRoot) return bareRoot
  }

  const envRoot = normalizeStorageRoot(
    typeof process !== 'undefined' ? process.env?.PEAR_APP_DATA : null
  )
  if (envRoot) {
    return envRoot
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

export async function bootstrapWorkerRuntime() {
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

import SystemLog from 'bare-system-logger'
import Console from 'bare-console'
global.console = new Console(new SystemLog()) // NOTE: passes logs to system logs

import process from 'process'
import { join } from 'path'
import Hyperswarm from 'hyperswarm'

import { DocWorker } from './service/doc-worker.js'
import { createRpcServer } from './service/rpc-server.js'
import { UpdaterWorker } from './service/updater-worker.js'

const updaterConfig = JSON.parse(globalThis.Bare.argv.pop()) // NOTE: doing pop cause not sure how other args are handled
console.log('[IMPORTANT LOG]:', updaterConfig)
console.log('[IMPORTANT LOG]:', Bare.argv)
function shouldOpenPearRuntime(cfg) {
  const up = cfg.upgrade
  if (!up || String(up) === 'pear://updates-disabled') return false
  return true
}

function isStorageLockError(error) {
  if (!error) return false
  const message = typeof error.message === 'string' ? error.message : ''
  return message.includes('File descriptor could not be locked')
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let updaterWorkerInstance = null
let workerInstance = null
let rpcInstance = null

let teardownPromise = null
let teardownDone = false

async function teardownWorkerRuntime(reason) {
  if (teardownDone) return
  if (teardownPromise) return teardownPromise

  teardownPromise = (async () => {
    try {
      if (reason) {
        console.warn('[worker] teardown:', reason)
      }
      rpcInstance = null

      const doc = workerInstance
      const upd = updaterWorkerInstance
      workerInstance = null
      updaterWorkerInstance = null

      if (doc) {
        try {
          await doc.close()
        } catch (err) {
          console.error('[worker] DocWorker.close failed', err)
        }
      }
      if (upd) {
        try {
          await upd.close()
        } catch (err) {
          console.error('[worker] UpdaterWorker.close failed', err)
        }
      }
    } finally {
      teardownDone = true
      teardownPromise = null
    }
  })()

  return teardownPromise
}

function registerProcessExitHooks() {
  const hook = () => {
    void teardownWorkerRuntime('process exit hook')
  }
  if (typeof process.once === 'function') {
    process.once('SIGINT', hook)
    process.once('SIGTERM', hook)
  }
}

export async function initializeWorker(options = {}) {
  if (teardownDone) {
    teardownDone = false
  }

  if (!workerInstance) {
    const baseDir = options.baseDir || resolveBaseDir(options.storageRoot)
    workerInstance = new DocWorker({
      baseDir,
      bootstrap: options.bootstrap,
      autobase: options.autobase,
      ensureStorage: options.ensureStorage ?? true
    })
  }

  try {
    await workerInstance.ready()
    if (!updaterWorkerInstance) {
      const store = workerInstance.manager.corestore
      const keyPair = await store.createKeyPair('BONK!')
      const swarm = new Hyperswarm({keyPair})
      const config = { ... updaterConfig, swarm, store }
      if (shouldOpenPearRuntime(updaterConfig)) {
        updaterWorkerInstance = new UpdaterWorker(config)
        await updaterWorkerInstance.ready()
        const pearStorage = updaterWorkerInstance.pear?.storage
        if (typeof pearStorage === 'string' && pearStorage.trim()) {
          globalThis.__BONKDOCS_STORAGE_ROOT__ = pearStorage.trim()
        }
        swarm.on('connection', (conn) => updaterWorkerInstance.updater.store.replicate(conn)) // NOTE: the store is passed and a sub namespace is created, when you move to one swarm arch and replicate the higher order store on connection somewher you dont need this line
        swarm.join(updaterWorkerInstance.updater.drive.core.discoveryKey, {
          server: false,
          client: true
        })
      }
    }
    if (options.rpc && rpcInstance === null) {
      rpcInstance = createRpcServer(
        options.rpc,
        workerInstance,
        updaterWorkerInstance
      )
    }
  } catch (error) {
    console.log('[IMPORTANT LOG]: that went wrong')
    try {
      await teardownWorkerRuntime('initialize failed')
    } catch {}
    throw error
  }

  return {
    workerInstance,
    updaterInstance: updaterWorkerInstance?.updater,
    updaterWorkerInstance
  }
}

function normalizeStorageRoot(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isFilesystemRoot(p) {
  if (typeof p !== 'string') return true
  const n = p.replace(/\\/g, '/').replace(/\/+$/, '')
  if (n === '' || n === '/') return true
  if (/^[a-zA-Z]:$/.test(n)) return true
  return false
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

  if (!isFilesystemRoot(cwd)) {
    return cwd
  }

  const homeLike =
    normalizeStorageRoot(
      typeof process !== 'undefined' ? process.env?.HOME : null
    ) ||
    normalizeStorageRoot(
      typeof process !== 'undefined' ? process.env?.USERPROFILE : null
    )
  if (homeLike) {
    return homeLike
  }

  return cwd
}

function resolveBaseDir(storageRoot = null) {
  const fromElectron =
    updaterConfig && typeof updaterConfig.dir === 'string'
      ? updaterConfig.dir.trim()
      : null
  if (fromElectron) {
    return join(fromElectron, 'bonk-docs')
  }

  const root = resolveStorageRoot(storageRoot)
  if (isFilesystemRoot(root)) {
    throw new Error(
      '[worker] Storage root resolved to filesystem root. Pass updaterConfig.dir (e.g. app document directory on mobile), or set PEAR_APP_DATA / HOME.'
    )
  }

  const cwd =
    typeof process !== 'undefined' && typeof process.cwd === 'function'
      ? process.cwd()
      : '/'
  if (
    storageRoot === null &&
    root === cwd &&
    !isFilesystemRoot(root)
  ) {
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

  registerProcessExitHooks()

  let attempt = 0
  let delayMs = 100
  while (true) {
    try {
      await initializeWorker({
        baseDir: resolveBaseDir(),
        ensureStorage: true,
        rpc: ipcStream
      })
      break
    } catch (error) {
      if (!isStorageLockError(error) || attempt >= 25) throw error
      attempt += 1
      if (attempt === 1 || attempt % 5 === 0) {
        console.warn(
          `[worker] storage lock busy, retry ${attempt} (another process may still be exiting)`
        )
      }
      await delay(delayMs)
      delayMs = Math.min(delayMs * 2, 2000)
    }
  }

  const onIpcEnd = () => {
    void teardownWorkerRuntime('ipc closed or errored')
  }

  ipcStream.on('close', onIpcEnd)
  ipcStream.on('error', onIpcEnd)
}

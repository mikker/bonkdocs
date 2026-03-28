import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import PearRuntime from 'pear-runtime'
import { isMac, isLinux, isWindows } from 'which-runtime'
import { command, flag } from 'paparam'
import storageDir from 'bare-storage'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const { name, productName, version, upgrade } = pkg

const protocol = name
const appName = productName ?? name
const sharedIconPath = path.join(__dirname, '..', 'icon.png')

const workers = new Map()
/** Bare sidecar PIDs — killed synchronously on process exit so children cannot outlive Electron. */
const bareWorkerPids = new Set()
let pear = null

function killPid(pid) {
  if (typeof pid !== 'number' || pid <= 0) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? err.code : null
    if (code !== 'ESRCH') {
      console.warn('[electron] kill pid', pid, err)
    }
  }
}

/**
 * Tear down PearRuntime.run() sidecars aggressively. streamx destroy() only SIGTERM;
 * bare can survive and keep RocksDB locks, so we SIGKILL the child process as well.
 */
function destroyAllPearWorkers() {
  for (const [specifier, worker] of workers) {
    const pid = worker._process?.pid
    try {
      worker.destroy()
    } catch (err) {
      console.error('[electron] worker.destroy failed', specifier, err)
    }
    if (typeof pid === 'number') {
      killPid(pid)
    }
  }
  workers.clear()
}

const cmd = command(
  appName,
  flag('--storage', 'pass custom storage to pear-runtime'),
  flag('--no-updates', 'start without OTA updates'),
  flag(
    '--remote-debugging-port [port]',
    'enable Chromium remote debugging on a port'
  )
)

cmd.parse(app.isPackaged ? process.argv.slice(1) : process.argv.slice(2))

const pearStore = cmd.flags.storage
const updates = cmd.flags.updates
const remoteDebuggingPort = cmd.flags.remoteDebuggingPort
const runtimeUpdates = Boolean(updates && upgrade)
const runtimeUpgrade = upgrade || 'pear://updates-disabled'

if (
  remoteDebuggingPort !== undefined &&
  remoteDebuggingPort !== null &&
  String(remoteDebuggingPort).trim().length > 0
) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    String(remoteDebuggingPort)
  )
}

if (updates && !upgrade) {
  console.warn(
    '[runtime] updates requested but package.json has no "upgrade" link; starting with updates disabled'
  )
}

ipcMain.on('pkg', (evt) => {
  evt.returnValue = pkg
})

function resolveDefaultStorageDir() {
  return path.join(storageDir.persistent(), appName)
}

function getAppPath() {
  return '/Users/geordangesink/Desktop/Bonk Docs.app'// TODO: revert appPath mock
  if (!app.isPackaged) return null
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  if (isWindows) return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

function getPearRuntimeName() {
  const extension = isLinux ? '.AppImage' : isMac ? '.app' : '.msix'
  return `${appName}${extension}`
}

function getAppDir() {
  const appPath = getAppPath()
  if (pearStore) {
    console.log('pear store: ' + pearStore)
    return pearStore
  } else if (appPath === null) {
    return path.join(os.tmpdir(), 'pear', appName)
  } else {
    return resolveDefaultStorageDir()
  }
}

function sendToAll(channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

function getWorker(specifier) {
  if (workers.has(specifier)) {
    const existing = workers.get(specifier)
    if (existing && !existing.destroyed) return existing
    workers.delete(specifier)
  }

  const updaterConfig = {
    dir: getAppDir(),
    app: getAppPath(),
    name: getPearRuntimeName(),
    updates: true || runtimeUpdates, // TODO: revert mock
    version,
    storage: path.join(getAppDir(), 'app-storage'),
    upgrade: runtimeUpgrade,
    win32: { restart: true }
  }

  const workerPath = path.resolve(__dirname, '..' + specifier)
  console.log('starting worker')
  const worker = PearRuntime.run(workerPath, [
    updaterConfig.storage,
    JSON.stringify(updaterConfig)
  ])

  const pid = worker._process?.pid
  if (typeof pid === 'number') bareWorkerPids.add(pid)

  function sendWorkerStdout(data) {
    sendToAll('pear:worker:stdout:' + specifier, data)
  }

  function sendWorkerStderr(data) {
    sendToAll('pear:worker:stderr:' + specifier, data)
  }

  function sendWorkerIPC(data) {
    sendToAll('pear:worker:ipc:' + specifier, data)
  }

  ipcMain.handle('pear:worker:writeIPC:' + specifier, (evt, data) => {
    return worker.write(Buffer.from(data))
  })

  workers.set(specifier, worker)
  worker.on('data', sendWorkerIPC)
  worker.stdout.on('data', sendWorkerStdout)
  worker.stderr.on('data', sendWorkerStderr)

  worker.once('exit', (code) => {
    if (typeof pid === 'number') bareWorkerPids.delete(pid)
    ipcMain.removeHandler('pear:worker:writeIPC:' + specifier)
    worker.removeListener('data', sendWorkerIPC)
    worker.stdout.removeListener('data', sendWorkerStdout)
    worker.stderr.removeListener('data', sendWorkerStderr)
    sendToAll('pear:worker:exit:' + specifier, code)
    workers.delete(specifier)
  })

  return worker
}

nativeTheme.themeSource = 'dark'

async function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 900,
    minWidth: 400,
    minHeight: 300,
    icon: sharedIconPath,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // const pearRuntime = getPear()

  // const onUpdating = () => {
  //   if (!win.isDestroyed()) {
  //     win.webContents.send('pear:event:updating')
  //   }
  // }

  // const onUpdated = () => {
  //   if (!win.isDestroyed()) {
  //     win.webContents.send('pear:event:updated')
  //   }
  // }

  // pearRuntime.updater.on('updating', onUpdating)
  // pearRuntime.updater.on('updated', onUpdated)

  // win.on('closed', () => {
  //   pearRuntime.updater.removeListener('updating', onUpdating)
  //   pearRuntime.updater.removeListener('updated', onUpdated)
  // })

  const devServerUrl = process.env.PEAR_DEV_SERVER_URL

  if (devServerUrl) {
    await win.loadURL(devServerUrl)
    win.webContents.openDevTools()
    return
  }

  await win.loadFile(
    path.join(__dirname, '..', 'renderer', 'dist', 'index.html')
  )
}

ipcMain.on('GET_EXEC_PATH', (event) => {
  event.returnValue = getAppPath()
})

ipcMain.on('GET_APP_STORAGE_DIR', (event) => {
  event.returnValue = IS_PRODUCTION ? keetStorage : IS_INTERNAL ? keetInternalStorage : os.tmpdir()
})

ipcMain.on('GET_APPLING_EXTENSION', (event) => {
  event.returnValue = isMac ? '.app' : isLinux ? '.AppImage' : '.msix'
})

ipcMain.on('GET_OTA_BOOTSTRAP', (event) => {
  event.returnValue = process.env.OTA_BOOTSTRAP ? JSON.parse(process.env.OTA_BOOTSTRAP) : undefined
})

ipcMain.handle('pear:startWorker', (evt, filename) => {
  const specifier = filename.startsWith('/') ? filename : '/' + filename
  getWorker(specifier)
  return true
})
ipcMain.handle('app:restart', () => {
  if (isLinux && process.env.APPIMAGE) {
    app.relaunch({
      execPath: process.env.APPIMAGE,
      args: [
        '--appimage-extract-and-run',
        ...process.argv
          .slice(1)
          .filter((arg) => arg !== '--appimage-extract-and-run')
      ]
    })
  } else {
    app.relaunch()
  }
  app.exit(0)
})

function handleDeepLink(url) {
  console.log('deep link:', url)
}

app.setAsDefaultProtocolClient(protocol)

app.on('open-url', (evt, url) => {
  evt.preventDefault()
  handleDeepLink(url)
})

process.on('exit', () => {
  for (const pid of bareWorkerPids) {
    killPid(pid)
  }
})

const lock = app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (evt, args) => {
    const url = args.find((arg) => arg.startsWith(protocol + '://'))
    if (url) handleDeepLink(url)
  })

  app.on('before-quit', () => {
    destroyAllPearWorkers()
  })

  const onMainSignal = () => {
    destroyAllPearWorkers()
    app.quit()
  }
  process.on('SIGINT', onMainSignal)
  process.on('SIGTERM', onMainSignal)

  app.whenReady().then(() => {
    if (process.platform === 'darwin') {
      app.dock.setIcon(sharedIconPath)
    }

    createWindow().catch((err) => {
      console.error('Failed to create window:', err)
      app.quit()
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((err) => {
          console.error('Failed to create window:', err)
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

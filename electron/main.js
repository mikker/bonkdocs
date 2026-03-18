import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import PearRuntime from 'pear-runtime'
import { isMac, isLinux, isWindows } from 'which-runtime'
import { command, flag } from 'paparam'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const { name, productName, version, upgrade } = pkg

const protocol = name
const appName = productName ?? name

const workers = new Map()
let pear = null

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
  if (process.env.PEAR_APP_DATA) {
    return process.env.PEAR_APP_DATA
  }

  if (isMac) {
    return path.join(os.homedir(), 'Library', 'Application Support', appName)
  }

  if (isLinux) {
    return path.join(os.homedir(), '.config', appName)
  }

  return path.join(os.homedir(), 'AppData', 'Local', appName)
}

function getAppPath() {
  if (!app.isPackaged) return null
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  if (isWindows) return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

function getPearRuntimeName() {
  const extension = isLinux ? '.AppImage' : isMac ? '.app' : '.msix'
  return `${appName}${extension}`
}

function getPear() {
  if (pear) return pear

  const appPath = getAppPath()
  let dir = null

  if (pearStore) {
    console.log('pear store: ' + pearStore)
    dir = pearStore
  } else if (appPath === null) {
    dir = path.join(os.tmpdir(), 'pear', appName)
  } else {
    dir = resolveDefaultStorageDir()
  }

  pear = new PearRuntime({
    dir,
    app: appPath,
    name: getPearRuntimeName(),
    updates: runtimeUpdates,
    version,
    upgrade: runtimeUpgrade,
    win32: { restart: true }
  })

  pear.on('error', console.error)
  return pear
}

function sendToAll(channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  }
}

function getWorker(specifier) {
  if (workers.has(specifier)) return workers.get(specifier)

  const pearRuntime = getPear()
  const workerPath = path.resolve(__dirname, '..' + specifier)
  const worker = pearRuntime.run(workerPath, [pearRuntime.storage])

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

  const onBeforeQuit = () => {
    if (!worker.destroyed) worker.destroy()
  }

  workers.set(specifier, worker)
  worker.on('data', sendWorkerIPC)
  worker.stdout.on('data', sendWorkerStdout)
  worker.stderr.on('data', sendWorkerStderr)

  worker.once('exit', (code) => {
    app.removeListener('before-quit', onBeforeQuit)
    ipcMain.removeHandler('pear:worker:writeIPC:' + specifier)
    worker.removeListener('data', sendWorkerIPC)
    worker.stdout.removeListener('data', sendWorkerStdout)
    worker.stderr.removeListener('data', sendWorkerStderr)
    sendToAll('pear:worker:exit:' + specifier, code)
    workers.delete(specifier)
  })

  app.on('before-quit', onBeforeQuit)
  return worker
}

nativeTheme.themeSource = 'dark'

async function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 900,
    minWidth: 400,
    minHeight: 300,
    icon: path.join(__dirname, '..', 'icon.png'),
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  const pearRuntime = getPear()

  const onUpdating = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('pear:event:updating')
    }
  }

  const onUpdated = () => {
    if (!win.isDestroyed()) {
      win.webContents.send('pear:event:updated')
    }
  }

  pearRuntime.updater.on('updating', onUpdating)
  pearRuntime.updater.on('updated', onUpdated)

  win.on('closed', () => {
    pearRuntime.updater.removeListener('updating', onUpdating)
    pearRuntime.updater.removeListener('updated', onUpdated)
  })

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

ipcMain.handle('pear:applyUpdate', () => getPear().updater.applyUpdate())
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

const lock = app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  app.on('second-instance', (evt, args) => {
    const url = args.find((arg) => arg.startsWith(protocol + '://'))
    if (url) handleDeepLink(url)
  })

  app.whenReady().then(() => {
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

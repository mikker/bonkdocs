/* global __DEV__ */

// @ts-ignore
import HRPC from '../../../spec/hrpc/index.js'
import PearRuntime from 'pear-runtime-react-native'
import bundle from '../worker.bundle.js'

type RpcClient = any
type IpcListener = (...args: any[]) => void
type IpcStream = {
  on: (event: string, listener: IpcListener) => void
  off?: (event: string, listener: IpcListener) => void
  removeListener?: (event: string, listener: IpcListener) => void
  write: (data: Uint8Array) => void
}

let rpcInstance: RpcClient | null = null

function removeIpcListener(
  ipc: IpcStream,
  event: string,
  listener: IpcListener
) {
  if (typeof ipc.off === 'function') {
    ipc.off(event, listener)
    return
  }

  if (typeof ipc.removeListener === 'function') {
    ipc.removeListener(event, listener)
  }
}

class MobileWorkerStream {
  destroyed = false
  private readonly ipc: IpcStream

  constructor() {
    const pear = new PearRuntime()
    this.ipc = pear.run('/worker.bundle', bundle, [String(__DEV__)])
  }

  on(event: string, listener: IpcListener) {
    this.ipc.on(event, listener)
    return this
  }

  off(event: string, listener: IpcListener) {
    removeIpcListener(this.ipc, event, listener)
    return this
  }

  write(data: Uint8Array) {
    if (this.destroyed) return false
    this.ipc.write(data)
    return true
  }

  destroy() {
    this.destroyed = true
    return this
  }
}

export function getRpc() {
  if (!rpcInstance) {
    rpcInstance = new HRPC(new MobileWorkerStream())
  }
  return rpcInstance
}

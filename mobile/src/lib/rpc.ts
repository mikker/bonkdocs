/* global __DEV__ */

// @ts-ignore
import HRPC from '../../../spec/hrpc/index.js'
import { Worklet } from 'react-native-bare-kit'
import bundle from '../worker.bundle.js'

type RpcClient = any
type IpcListener = (...args: any[]) => void
type IpcStream = {
  on: (event: string, listener: IpcListener) => void
  off?: (event: string, listener: IpcListener) => void
  removeListener?: (event: string, listener: IpcListener) => void
  write: (data: Uint8Array) => void
  destroy?: () => void
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
  private readonly worklet: Worklet
  private readonly ipc: IpcStream

  constructor() {
    this.worklet = new Worklet()
    this.worklet.start('/worker.bundle', bundle, [String(__DEV__)])
    this.ipc = this.worklet.IPC
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
    if (this.destroyed) return this
    this.destroyed = true
    this.ipc.destroy?.()
    this.worklet.terminate()
    return this
  }
}

type GlobalRpcState = typeof globalThis & {
  __BONKDOCS_MOBILE_RPC__?: RpcClient | null
  __BONKDOCS_MOBILE_WORKER__?: MobileWorkerStream | null
}

const globalRpcState = globalThis as GlobalRpcState

export function destroyRpc() {
  rpcInstance = null
  globalRpcState.__BONKDOCS_MOBILE_RPC__ = null
  globalRpcState.__BONKDOCS_MOBILE_WORKER__?.destroy()
  globalRpcState.__BONKDOCS_MOBILE_WORKER__ = null
}

export function getRpc() {
  if (globalRpcState.__BONKDOCS_MOBILE_RPC__) {
    rpcInstance = globalRpcState.__BONKDOCS_MOBILE_RPC__
  }

  if (!rpcInstance) {
    const worker = new MobileWorkerStream()
    rpcInstance = new HRPC(worker)
    globalRpcState.__BONKDOCS_MOBILE_RPC__ = rpcInstance
    globalRpcState.__BONKDOCS_MOBILE_WORKER__ = worker
  }

  return rpcInstance
}

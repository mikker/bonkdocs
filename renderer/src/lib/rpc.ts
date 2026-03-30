// @ts-ignore
import HRPC from '../../../packages/bonkdocs-core/hrpc.js'

type RpcClient = any

type BridgeListener = (...args: any[]) => void

type BridgeApi = {
  startWorker: (specifier: string) => Promise<unknown>
  onWorkerIPC: (
    specifier: string,
    listener: (data: Uint8Array) => void
  ) => () => void
  onWorkerExit: (
    specifier: string,
    listener: (code: number) => void
  ) => () => void
  writeWorkerIPC: (specifier: string, data: Uint8Array) => Promise<unknown>
}

const WORKER_SPECIFIER = '/worker/index.js'

let workerStream: any = null
let rpcInstance: RpcClient | null = null

function getBridge(): BridgeApi {
  if (typeof window === 'undefined' || !window.bridge) {
    throw new Error('Electron bridge is unavailable in this runtime')
  }
  return window.bridge
}

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (typeof data === 'string') {
    return new TextEncoder().encode(data)
  }
  return new Uint8Array(0)
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(typeof error === 'string' ? error : 'Unknown worker error')
}

class BridgeWorkerStream {
  destroyed = false
  private readonly specifier: string
  private ready = false

  private listeners = new Map<string, Set<BridgeListener>>()
  private offIPC: (() => void) | null = null
  private offExit: (() => void) | null = null
  private pendingWrites: Uint8Array[] = []

  constructor(specifier: string) {
    this.specifier = specifier
    const bridge = getBridge()

    this.offIPC = bridge.onWorkerIPC(this.specifier, (data) => {
      this.emit('data', toUint8Array(data))
    })

    this.offExit = bridge.onWorkerExit(this.specifier, () => {
      this.destroy()
    })

    void bridge
      .startWorker(this.specifier)
      .then(() => {
        if (this.destroyed) return
        this.ready = true
        this.flushPendingWrites()
      })
      .catch((error) => {
        this.destroy(toError(error))
      })
  }

  on(event: string, listener: BridgeListener): BridgeWorkerStream {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)?.add(listener)
    return this
  }

  off(event: string, listener: BridgeListener): BridgeWorkerStream {
    this.listeners.get(event)?.delete(listener)
    return this
  }

  write(data: unknown): boolean {
    if (this.destroyed) return false

    const payload = toUint8Array(data)
    if (!this.ready) {
      this.pendingWrites.push(payload)
      return true
    }

    this.writeNow(payload)
    return true
  }

  destroy(error?: Error): BridgeWorkerStream {
    if (this.destroyed) return this

    this.destroyed = true

    if (this.offIPC) {
      this.offIPC()
      this.offIPC = null
    }

    if (this.offExit) {
      this.offExit()
      this.offExit = null
    }

    if (error) {
      this.emit('error', error)
    }

    this.pendingWrites = []
    this.emit('close')
    this.listeners.clear()

    return this
  }

  private flushPendingWrites() {
    if (!this.ready || this.destroyed) return
    const writes = this.pendingWrites
    this.pendingWrites = []
    for (const payload of writes) {
      this.writeNow(payload)
    }
  }

  private writeNow(payload: Uint8Array) {
    const bridge = getBridge()
    void bridge.writeWorkerIPC(this.specifier, payload).catch((error) => {
      this.destroy(toError(error))
    })
  }

  private emit(event: string, payload?: unknown) {
    const listeners = this.listeners.get(event)
    if (!listeners || listeners.size === 0) return

    for (const listener of [...listeners]) {
      listener(payload)
    }
  }
}

function createDefaultRpc() {
  const stream = new BridgeWorkerStream(WORKER_SPECIFIER)
  const rpc = new HRPC(stream)

  const reset = () => {
    if (workerStream === stream) {
      workerStream = null
    }
    if (rpcInstance === rpc) {
      rpcInstance = null
    }
  }

  stream.on('close', reset)
  workerStream = stream
  return rpc
}

export function getRpc() {
  if (!rpcInstance) {
    rpcInstance = createDefaultRpc()
  }
  return rpcInstance
}

export function setRpcClient(client: unknown) {
  if (workerStream) {
    workerStream.destroy()
  }
  workerStream = null
  rpcInstance = client
}

export async function teardownRpc() {
  if (workerStream) {
    workerStream.destroy()
  }
  workerStream = null
  rpcInstance = null
}

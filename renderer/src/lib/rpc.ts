// @ts-ignore
import FramedStream from 'framed-stream'
// @ts-ignore
import HRPC from '../../../spec/hrpc/index.js'
// @ts-ignore
import run from 'pear-run'

let workerInstance: { destroy: () => Promise<void> | void } | null = null
let rpcInstance: any = null

function createDefaultRpc() {
  const workerLink = `${Pear.config?.applink ?? ''}/worker/index.js`
  workerInstance = run(workerLink)
  const stream = new FramedStream(workerInstance)
  return new HRPC(stream)
}

export function getRpc() {
  if (!rpcInstance) {
    rpcInstance = createDefaultRpc()
  }
  return rpcInstance
}

export function setRpcClient(client: unknown) {
  if (workerInstance && typeof workerInstance.destroy === 'function') {
    workerInstance.destroy()
  }
  workerInstance = null
  rpcInstance = client
}

export async function teardownRpc() {
  if (workerInstance && typeof workerInstance.destroy === 'function') {
    await workerInstance.destroy()
  }
  workerInstance = null
  rpcInstance = null
}

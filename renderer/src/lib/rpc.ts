// @ts-ignore
import FramedStream from 'framed-stream'
// @ts-ignore
import HRPC from '../../../spec/hrpc/index.js'
// @ts-ignore
import run from 'pear-run'

const workerLink = `${Pear.config?.applink ?? ''}/worker/index.js`
const worker = run(workerLink)
const stream = new FramedStream(worker)

export const rpc = new HRPC(stream)

export async function teardownRpc() {
  await worker.destroy()
}

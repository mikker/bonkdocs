import pearPipe from 'pear-pipe'
import { DocWorker } from './src/doc-worker.js'
import { createRpcServer } from './src/rpc-server.js'
import {
  fileURLToPath,
  dirname,
  join,
  once
} from './src/platform.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DEFAULT_STATE_KEY = 'state/app'

export async function initializeWorker(options = {}) {
  const pipe = pearPipe()

  const baseDir =
    options.baseDir ||
    join(
      process.env.PEAR_APP_DATA || join(__dirname, '..', '.pear-docs'),
      'contexts'
    )

  const worker = new DocWorker({
    baseDir,
    bootstrap: options.bootstrap,
    autobase: options.autobase,
    ensureStorage: options.ensureStorage ?? true
  })
  await worker.ready()

  const rpc = createRpcServer(pipe, worker)
  attachStatePersistence(rpc, worker, DEFAULT_STATE_KEY)

  pipe.on('close', () => {
    worker.close().catch(() => {})
  })

  const closed = once(pipe, 'close')

  return { pipe, worker, rpc, closed }
}

void initializeWorker()

function attachStatePersistence(rpc, worker, stateKey) {
  rpc.onUpdateState(async (request = {}) => {
    const localDb = worker.manager?.localDb
    if (!localDb) return { status: 'noop' }

    const record = {
      id: stateKey,
      activeDoc: request.activeDoc || null,
      lastSeenAt: request.lastSeenAt || Date.now()
    }

    await localDb.put(stateKey, record)
    return { status: 'ok' }
  })
}

import { performance } from 'node:perf_hooks'
import process from 'process'
import * as Y from 'yjs'
import { ensurePear } from '../lib/pear-env.js'

ensurePear()

const [{ useDocStore }, { setRpcClient, teardownRpc }, helpers] =
  await Promise.all([
    import('../renderer/src/state/doc-store.ts'),
    import('../renderer/src/lib/rpc.ts'),
    import('../test/helpers/doc-store-mock.js')
  ])

const { createRpcMock, resetDocStoreState, flushMicrotasks } = helpers

function parseArgs(argv) {
  const options = {
    ops: 200,
    delay: 5,
    key: 'doc-sim',
    verbose: false
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--ops' && argv[i + 1]) {
      options.ops = Math.max(1, Number.parseInt(argv[++i], 10))
    } else if (arg === '--delay' && argv[i + 1]) {
      options.delay = Math.max(0, Number.parseInt(argv[++i], 10))
    } else if (arg === '--key' && argv[i + 1]) {
      options.key = argv[++i]
    } else if (arg === '--verbose') {
      options.verbose = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    }
  }

  return options
}

function printHelp() {
  console.log(
    `Usage: node scripts/typing-sim.js [--ops N] [--delay ms] [--key doc-key]\n` +
      `\n` +
      `Simulates a burst of Yjs updates against the renderer doc store.\n` +
      `Options:\n` +
      `  --ops N     Number of local edits to queue (default 200)\n` +
      `  --delay ms  Artificial network delay per applyUpdates call (default 5ms)\n` +
      `  --key name  Document key to target (default doc-sim)\n` +
      `  --verbose   Print RPC payloads for debugging\n`
  )
}

async function simulateBurst(options) {
  const doc = {
    key: options.key,
    title: 'Simulation Doc',
    lastRevision: 1,
    lastOpenedAt: Date.now()
  }

  const mock = createRpcMock({
    docs: [doc],
    activeDoc: doc.key
  })

  mock.setApplyUpdatesHandler(async (request = {}) => {
    if (options.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delay))
    }
    if (options.verbose) {
      const bytes = request?.updates?.[0]?.data?.length ?? 0
      console.log(`applyUpdates => ${bytes} bytes`)
    }
    return {
      accepted: true,
      revision: request?.revision ?? null
    }
  })

  setRpcClient(mock.rpc)
  resetDocStoreState()

  try {
    await useDocStore.getState().initialize()

    const seedDoc = new Y.Doc()
    seedDoc.getText('body').insert(0, 'seed')
    const seedUpdate = Y.encodeStateAsUpdate(seedDoc)
    mock.emitUpdate(doc.key, {
      key: doc.key,
      revision: 1,
      syncUpdate: seedUpdate,
      updatedAt: Date.now()
    })
    await flushMicrotasks()

    const start = performance.now()
    for (let i = 0; i < options.ops; i++) {
      const current = useDocStore.getState().currentUpdate
      current?.doc.getText('body').insert(0, `sim-${i + 1} `)
    }

    await new Promise((resolve) => setTimeout(resolve, options.delay + 200))
    const durationMs = performance.now() - start

    const calls = mock.getApplyUpdatesCalls()
    const bytesSent = calls.reduce(
      (total, entry) => total + (entry?.updates?.[0]?.data?.length ?? 0),
      0
    )

    const state = useDocStore.getState()
    const latest = state.currentUpdate?.doc.getText('body').toString() ?? ''

    return {
      opsRequested: options.ops,
      durationMs,
      opsPerSecond: (options.ops / durationMs) * 1000,
      rpcCalls: calls.length,
      bytesSent,
      finalTextLength: latest.length
    }
  } finally {
    mock.destroyAll()
    resetDocStoreState()
    setRpcClient(null)
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const metrics = await simulateBurst(options)

  console.log('Doc typing simulation complete:\n')
  console.table({
    'Ops requested': metrics.opsRequested,
    'Duration (ms)': Number(metrics.durationMs.toFixed(2)),
    'Ops/sec': Number(metrics.opsPerSecond.toFixed(2)),
    'applyUpdates calls': metrics.rpcCalls,
    'Bytes sent': metrics.bytesSent,
    'Final text length': metrics.finalTextLength
  })
}

main()
  .catch((error) => {
    console.error('[typing-sim] failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await teardownRpc().catch(() => {})
  })

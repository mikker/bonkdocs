import { performance } from 'node:perf_hooks'
import process from 'process'
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
      `Simulates a burst of TipTap snapshots against the renderer doc store.\n` +
      `Options:\n` +
      `  --ops N     Number of local edits to queue (default 200)\n` +
      `  --delay ms  Artificial network delay per applyOps call (default 5ms)\n` +
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

  mock.setApplyOpsHandler(async (request = {}) => {
    if (options.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delay))
    }
    if (options.verbose) {
      console.log(
        `applyOps => rev ${request?.ops?.[0]?.rev} (ops: ${
          request?.ops?.length ?? 0
        })`
      )
    }
    return {
      accepted: true,
      revision: request?.ops?.at(-1)?.rev ?? null
    }
  })

  setRpcClient(mock.rpc)
  resetDocStoreState()

  try {
    await useDocStore.getState().initialize()
    mock.emitUpdate(doc.key, {
      key: doc.key,
      revision: 1,
      snapshotRevision: 1,
      snapshot: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'seed' }]
          }
        ]
      },
      updatedAt: Date.now()
    })
    await flushMicrotasks()

    let maxPending = 0
    const unsubscribe = useDocStore.subscribe(
      (state) => state.pendingOps[doc.key]?.length ?? 0,
      (pending) => {
        if (pending > maxPending) {
          maxPending = pending
        }
      }
    )

    const start = performance.now()
    const applyTasks = []
    for (let i = 0; i < options.ops; i++) {
      const text = `sim-${i + 1}`
      applyTasks.push(
        useDocStore.getState().applySnapshot(doc.key, {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text }]
            }
          ]
        })
      )
    }

    await Promise.all(applyTasks)
    const durationMs = performance.now() - start

    unsubscribe()

    const calls = mock.getApplyOpsCalls()
    const opsSent = calls.reduce(
      (total, entry) => total + (entry?.ops?.length ?? 0),
      0
    )
    const avgBatch = calls.length > 0 ? opsSent / calls.length : 0

    const state = useDocStore.getState()
    const latest =
      state.currentUpdate?.snapshot?.content?.[0]?.content?.[0]?.text ?? ''

    return {
      opsRequested: options.ops,
      durationMs,
      opsPerSecond: (options.ops / durationMs) * 1000,
      rpcCalls: calls.length,
      opsSent,
      avgBatchSize: avgBatch,
      maxPending,
      finalText: latest,
      pendingLeft: state.pendingOps[doc.key]?.length ?? 0
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
    'applyOps calls': metrics.rpcCalls,
    'Ops sent': metrics.opsSent,
    'Avg ops per call': Number(metrics.avgBatchSize.toFixed(2)),
    'Max pending queue': metrics.maxPending,
    'Pending remaining': metrics.pendingLeft,
    'Final snapshot text': metrics.finalText
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

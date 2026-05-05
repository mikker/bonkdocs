import { ensurePear } from '../lib/pear-env.js'

ensurePear()

const runtime = await import('../packages/bonkdocs-core/worker-runtime.js')

void runtime.bootstrapWorkerRuntime()

export const { bootstrapWorkerRuntime, initializeWorker } = runtime

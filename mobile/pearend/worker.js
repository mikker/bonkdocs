/* global Bare */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isStorageLockError(error) {
  if (!error) return false
  const message = typeof error.message === 'string' ? error.message : ''
  return message.includes('File descriptor could not be locked')
}

async function bootstrapWithRetry(bootstrapWorkerRuntime) {
  let attempt = 0
  let delayMs = 100

  while (true) {
    try {
      await bootstrapWorkerRuntime()

      if (attempt > 0) {
        console.warn(
          `[mobile-worker] storage lock cleared after ${attempt} retries`
        )
      }

      return
    } catch (error) {
      if (!isStorageLockError(error)) throw error

      attempt += 1

      if (attempt === 1 || attempt % 5 === 0) {
        console.warn(
          `[mobile-worker] waiting for storage lock (attempt ${attempt})`
        )
      }

      await delay(delayMs)
      delayMs = Math.min(delayMs * 2, 2000)
    }
  }
}

async function main() {
  const { bootstrapWorkerRuntime } =
    await import('../../packages/bonkdocs-core/worker-runtime.js')

  await bootstrapWithRetry(() =>
    bootstrapWorkerRuntime()
  )
}

void main().catch((error) => {
  console.error('[mobile-worker] failed to boot', error)
  throw error
})

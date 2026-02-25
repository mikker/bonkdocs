type PearTeardown = () => void | Promise<void>

const teardownCallbacks = new Set<PearTeardown>()
let initialized = false

export function ensurePearCompat() {
  if (initialized || typeof window === 'undefined') {
    return
  }

  initialized = true

  const pkg = window.bridge?.pkg?.() || {}

  window.Pear = {
    config: pkg.pear || {},
    reload() {
      window.location.reload()
    },
    teardown(callback) {
      if (typeof callback === 'function') {
        teardownCallbacks.add(callback)
      }
    }
  }

  window.addEventListener('beforeunload', () => {
    for (const callback of teardownCallbacks) {
      try {
        void callback()
      } catch {}
    }
    teardownCallbacks.clear()
  })
}

const DEFAULT_BOOTSTRAP = []
const DEFAULT_NODES = []

function normalizeDhtConfig(config) {
  if (!config)
    return {
      bootstrap: DEFAULT_BOOTSTRAP.slice(),
      nodes: DEFAULT_NODES.slice()
    }
  const bootstrap = Array.isArray(config.bootstrap)
    ? config.bootstrap
    : DEFAULT_BOOTSTRAP
  const nodes = Array.isArray(config.nodes) ? config.nodes : DEFAULT_NODES
  return { bootstrap, nodes }
}

export function ensurePear() {
  const pear = (globalThis.Pear = globalThis.Pear ?? {})
  pear.constructor = pear.constructor ?? {}

  const config = (pear.config = pear.config ?? {})
  config.dht = normalizeDhtConfig(config.dht)

  return pear
}

export function getPear() {
  return ensurePear()
}

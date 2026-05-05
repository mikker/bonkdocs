const DEFAULT_BOOTSTRAP = [
  '88.99.3.86@node1.hyperdht.org:49737',
  '142.93.90.113@node2.hyperdht.org:49737',
  '138.68.147.8@node3.hyperdht.org:49737'
]
const DEFAULT_NODES = []

function normalizeDhtConfig(config) {
  if (!config) {
    return {
      bootstrap: DEFAULT_BOOTSTRAP.slice(),
      nodes: DEFAULT_NODES.slice()
    }
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

let pathModule
let urlModule
let eventsModule
let fsPromises

try {
  pathModule = await import('bare-path')
} catch {
  pathModule = await import('path')
}

try {
  urlModule = await import('bare-url')
} catch {
  urlModule = await import('url')
}

try {
  eventsModule = await import('bare-events')
} catch {
  eventsModule = await import('events')
}

try {
  fsPromises = await import('bare-fs/promises')
} catch {
  fsPromises = await import('fs/promises')
}

const { dirname, join } = pathModule
const { fileURLToPath } = urlModule
const { once } = eventsModule
const mkdir = fsPromises.mkdir

let rm = fsPromises.rm
if (!rm && typeof fsPromises.rmdir === 'function') {
  rm = async (target, opts = {}) => {
    const recursive = opts.recursive ?? false
    const force = opts.force ?? false
    try {
      await fsPromises.rmdir(target, { recursive })
    } catch (error) {
      if (!force || (error && error.code !== 'ENOENT')) {
        throw error
      }
    }
  }
}

export { dirname, join, fileURLToPath, once, mkdir, rm }

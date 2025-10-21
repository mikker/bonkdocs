import process from 'process'
import * as pathModule from 'path'
import * as urlModule from 'url'
import * as eventsModule from 'events'
import * as fsPromises from 'fs/promises'
import * as osModule from 'os'

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

const tmpdir =
  osModule && typeof osModule.tmpdir === 'function'
    ? () => osModule.tmpdir()
    : () => '/tmp'

const mkdtemp =
  typeof fsPromises.mkdtemp === 'function'
    ? async (prefix) => fsPromises.mkdtemp(prefix)
    : async (prefix) => {
        const base = prefix.endsWith('-') ? prefix : `${prefix}-`
        const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`
        const dir = `${base}${unique}`
        await mkdir(dir, { recursive: true })
        return dir
      }

const currentDirectory = typeof process !== 'undefined' ? process.cwd() : '/'

export {
  dirname,
  join,
  fileURLToPath,
  once,
  mkdir,
  mkdtemp,
  tmpdir,
  rm,
  currentDirectory
}

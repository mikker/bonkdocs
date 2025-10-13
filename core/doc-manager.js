import { Manager } from 'autobonk'
import { DocContext } from './doc-context.js'
import { schema } from './schema.js'

export class DocManager extends Manager {
  constructor(baseDir, opts = {}) {
    super(baseDir, {
      ...opts,
      ContextClass: opts.ContextClass || DocContext,
      schema: opts.schema || schema
    })
  }

  async createDoc(opts = {}) {
    const { title, description, name } = opts
    const context = await super.createContext({ name: name || title })

    if (context && typeof context.bootstrapDoc === 'function') {
      await context.bootstrapDoc({ title, description })
    }

    return context
  }

  async joinDoc(invite, opts = {}) {
    const context = await super.joinContext(invite, opts)

    if (context && typeof context.ensureDocRoles === 'function') {
      await context.ensureDocRoles()
    }

    return context
  }

  async getDoc(keyHex) {
    return await super.getContext(keyHex)
  }

  async listDocs() {
    return await super.listContexts()
  }

  async removeDoc(keyHex) {
    return await super.removeContext(keyHex)
  }
}

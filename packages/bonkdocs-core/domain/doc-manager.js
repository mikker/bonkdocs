import { SpaceManager } from 'pear-sdk/spaces'

import { DocContext } from './doc-context.js'
import docSpace, { DOC_SPACE_TYPE } from './space.js'

export class DocManager {
  constructor(baseDir, opts = {}) {
    this.manager = new SpaceManager(baseDir, {
      appId: opts.appId || 'bonkdocs',
      spaces: [opts.space || docSpace],
      bootstrap: opts.bootstrap,
      recoverySeed: opts.recoverySeed
    })
  }

  async ready() {
    await this.manager.ready()
  }

  async close() {
    await this.manager.close()
  }

  async createDoc(opts = {}) {
    await this.ready()
    const { title, description, name } = opts
    const space = await this.manager.createSpace(DOC_SPACE_TYPE, {
      name: name || title
    })
    const context = new DocContext(space)
    await context.bootstrapDoc({ title, description })
    return context
  }

  async joinDoc(invite, opts = {}) {
    await this.ready()
    const space = await this.manager.joinSpace(DOC_SPACE_TYPE, invite, {
      name: opts.name || opts.title
    })
    return new DocContext(space)
  }

  async getDoc(keyHex) {
    await this.ready()
    const space = await this.manager.getSpace(keyHex)
    return space ? new DocContext(space) : null
  }

  async listDocs() {
    await this.ready()
    return await this.manager.listSpaces()
  }

  async removeDoc(keyHex) {
    await this.ready()
    return await this.manager.removeSpace(keyHex)
  }
}

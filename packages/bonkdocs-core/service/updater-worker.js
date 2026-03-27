import PearRuntime from 'pear-runtime'
import { Readable } from 'streamx'

export class UpdaterWorker {
  constructor(config = {}, PearRuntimeClass = PearRuntime) {
    if (config.existingPear) {
      this._ownsPear = false
      this.config = config
      this.pear = config.existingPear
      this.updater = this.pear.updater
      return
    }
    this._ownsPear = true
    this.config = config
    this.pear = new PearRuntimeClass(config)
    this.updater = this.pear.updater
  }

  async ready() {
    if (!this.pear || typeof this.pear.ready !== 'function') return
    await this.pear.ready()
  }

  async close() {
    if (!this._ownsPear) return
    if (!this.pear || typeof this.pear.close !== 'function') return
    await this.pear.close()
  }

  async applyUpdate() {
    const u = this.updater
    if (!u || typeof u.applyUpdate !== 'function') {
      throw new Error('Updater is not available')
    }
    await this.ready()
    await u.applyUpdate()
  }

  subscribeStatus() {
    const self = this
    let onError
    let onUpdating
    let onUpdatingDelta
    let onUpdated
    let poll = null

    const stream = new Readable({
      read(cb) {
        cb(null)
      },
      open(cb) {
        const tryAttach = () => {
          const u = self.updater
          if (!u || typeof u.on !== 'function' || onUpdating) return

          onError = (err) => stream.push({ type: 'error', data: err })
          onUpdating = () => stream.push({ type: 'updating' })
          onUpdatingDelta = (data) =>
            stream.push({ type: 'updating-delta', data })
          onUpdated = () => stream.push({ type: 'updated' })

          u.on('error', onError)
          u.on('updating', onUpdating)
          u.on('updating-delta', onUpdatingDelta)
          u.on('updated', onUpdated)

          if (poll) {
            clearInterval(poll)
            poll = null
          }
        }

        tryAttach()
        if (!onUpdating) poll = setInterval(tryAttach, 50)
        cb(null)
      },
      destroy(cb) {
        if (poll) clearInterval(poll)
        const u = self.updater
        if (u && typeof u.off === 'function') {
          if (onError) u.off('error', onError)
          if (onUpdating) u.off('updating', onUpdating)
          if (onUpdatingDelta) u.off('updating-delta', onUpdatingDelta)
          if (onUpdated) u.off('updated', onUpdated)
        }
        cb(null)
      }
    })

    return stream
  }
}

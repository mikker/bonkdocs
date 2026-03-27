import PearRuntime from 'pear-runtime'

export class UpdaterWorker {
  /**
   * @param {object} config Options for `pear-runtime`, or `{ existingPear }` when the host already opened it (avoids a second Corestore in the same process on mobile).
   * @param {new (config: object) => { updater: object, ready?: () => Promise<void>, close?: () => Promise<void> }} [PearRuntimeClass] Tests may inject a mock.
   */
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

  _hasUpdater() {
    return this.updater != null && typeof this.updater === 'object'
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
    if (!this._hasUpdater() || typeof this.updater.applyUpdate !== 'function') {
      throw new Error('Updater is not available')
    }
    await this.ready()
    await this.updater.applyUpdate()
  }

  subscribeStatus(onEvent) {
    if (typeof onEvent !== 'function') {
      return () => {}
    }
    if (!this._hasUpdater()) {
      return () => {}
    }

    const u = this.updater
    if (typeof u.on !== 'function') {
      return () => {}
    }

    const onUpdating = () => {
      try {
        onEvent({ event: 'updating' })
      } catch {}
    }
    const onUpdated = () => {
      try {
        onEvent({ event: 'updated' })
      } catch {}
    }

    u.on('updating', onUpdating)
    u.on('updated', onUpdated)

    return () => {
      try {
        if (typeof u.off === 'function') {
          u.off('updating', onUpdating)
          u.off('updated', onUpdated)
        } else if (typeof u.removeListener === 'function') {
          u.removeListener('updating', onUpdating)
          u.removeListener('updated', onUpdated)
        }
      } catch {}
    }
  }
}

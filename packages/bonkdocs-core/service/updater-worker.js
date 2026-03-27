import PearRuntime from 'pear-runtime'

export class UpdaterWorker {
  /**
   * @param {object} config Options for `pear-runtime`
   * @param {new (config: object) => { updater: object, ready?: () => Promise<void>, close?: () => Promise<void> }} [PearRuntimeClass] Tests may inject a mock.
   */
  constructor(config = {}) {
    this.config = config
    this.pear = new PearRuntime(config)
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

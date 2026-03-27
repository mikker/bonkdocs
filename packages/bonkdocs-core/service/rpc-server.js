import HRPC from '../../../spec/hrpc/index.js'

const scheduleMicrotask =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (fn) =>
        Promise.resolve()
          .then(fn)
          .catch(() => {})

function createLocalAbortController() {
  const listeners = new Set()

  const signal = {
    aborted: false,
    addEventListener(type, listener, options = {}) {
      if (type !== 'abort' || typeof listener !== 'function') return
      const entry = { listener, once: options.once === true }
      listeners.add(entry)
      if (signal.aborted) {
        scheduleMicrotask(() =>
          listener.call(signal, { type: 'abort', target: signal })
        )
      }
    },
    removeEventListener(type, listener) {
      if (type !== 'abort' || typeof listener !== 'function') return
      for (const entry of listeners) {
        if (entry.listener === listener) {
          listeners.delete(entry)
          break
        }
      }
    }
  }

  return {
    signal,
    abort() {
      if (signal.aborted) return
      signal.aborted = true
      for (const entry of [...listeners]) {
        try {
          entry.listener.call(signal, { type: 'abort', target: signal })
        } catch {}
        if (entry.once) {
          listeners.delete(entry)
        }
      }
      listeners.clear()
    }
  }
}

function createAbortController() {
  if (typeof globalThis.AbortController === 'function') {
    return new globalThis.AbortController()
  }
  return createLocalAbortController()
}

export function createRpcServer(stream, worker, updater) {
  const rpc = new HRPC(stream)

  rpc.onApplyUpdate(async () => {
    console.log('[worker] applying runtime update')
    if (!updater || typeof updater.applyUpdate !== 'function') {
      throw new Error('Updater is not available')
    }
    await updater.applyUpdate()
    return {}
  })

  rpc.onUpdaterStatus((hrpcStream) => {
    let unsubscribe = () => {}
    let cleaned = false

    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      try {
        unsubscribe()
      } catch {}
    }

    try {
      if (!updater || typeof updater.subscribeStatus !== 'function') {
        hrpcStream.destroy(new Error('Updater is not available'))
        return
      }
      unsubscribe = updater.subscribeStatus((payload) => {
        if (hrpcStream.destroyed) {
          cleanup()
          return
        }
        try {
          hrpcStream.write(payload)
        } catch (err) {
          cleanup()
          if (!hrpcStream.destroyed) hrpcStream.destroy(err)
        }
      })
    } catch (err) {
      hrpcStream.destroy(err instanceof Error ? err : new Error(String(err)))
      return
    }

    hrpcStream.on('close', cleanup)
    hrpcStream.on('error', cleanup)
  })

  rpc.onInitialize(async () => {
    console.log('[worker] initialize request')
    const docs = await worker.listDocs()
    return { docs }
  })

  rpc.onListDocs(async () => {
    console.log('[worker] list-docs request')
    const docs = await worker.listDocs()
    return { docs }
  })

  rpc.onCreateDoc(async (request = {}) => {
    console.log('[worker] create-doc request')
    return await worker.createDoc({
      title: request.title,
      description: request.description
    })
  })

  rpc.onRenameDoc(async (request = {}) => {
    console.log('[worker] rename-doc request', request?.key)
    if (!request.key) throw new Error('Doc key is required to rename')
    return await worker.renameDoc({
      key: request.key,
      title: request.title
    })
  })

  rpc.onLockDoc(async (request = {}) => {
    console.log('[worker] lock-doc request', request?.key)
    if (!request.key) throw new Error('Doc key is required to lock')
    return await worker.lockDoc({ key: request.key })
  })

  rpc.onJoinDoc(async (request = {}) => {
    console.log('[worker] join-doc request')
    return await worker.joinDoc({
      invite: request.invite,
      title: request.title
    })
  })

  rpc.onPairInvite((stream) => {
    const request = stream.data || {}
    if (!request.invite) {
      stream.destroy(new Error('Invite is required to pair document'))
      return
    }

    const controller = createAbortController()
    let finished = false

    const cancel = () => {
      if (finished) return
      finished = true
      controller.abort()
    }

    stream.on('close', cancel)
    stream.on('error', cancel)

    const emitStatus = async (status) => {
      if (finished || stream.destroyed) return
      stream.write(status)
    }

    worker
      .pairInvite(request, emitStatus, controller.signal)
      .then(() => {
        if (!finished && !stream.destroyed) {
          finished = true
          stream.end()
        }
      })
      .catch((error) => {
        if (!finished) {
          finished = true
          stream.destroy(error)
        }
      })
      .finally(() => {
        stream.off('close', cancel)
        stream.off('error', cancel)
      })
  })

  rpc.onRemoveDoc(async (request = {}) => {
    console.log('[worker] remove-doc request', request?.key)
    if (!request.key) throw new Error('Doc key is required to remove')
    const removed = await worker.removeDoc(request.key)
    return { removed }
  })

  rpc.onGetDoc(async (request = {}) => {
    console.log('[worker] get-doc request', request?.key)
    if (!request.key) throw new Error('Doc key is required to load doc')
    const result = await worker.getDoc(request.key)
    if (!result) {
      return { doc: undefined }
    }
    if (result.doc) {
      return { doc: result.doc ?? undefined, writerKey: result.writerKey }
    }
    return { doc: result ?? undefined }
  })

  rpc.onWatchDoc(async (stream) => {
    console.log('[worker] watch-doc request', stream.data)
    const request = stream.data || {}
    if (!request.key) {
      stream.destroy(new Error('Doc key is required to watch'))
      return
    }

    let stop

    try {
      stop = await worker.watchDoc(
        request.key,
        {
          stateVector: request.stateVector
        },
        async (update) => {
          if (!stream.destroyed) {
            stream.write(update)
          }
        }
      )
    } catch (error) {
      stream.destroy(error)
      return
    }

    const cleanup = () => {
      if (!stop) return
      const pending = stop
      stop = null
      Promise.resolve()
        .then(() => pending())
        .catch(() => {})
    }

    stream.on('close', cleanup)
    stream.on('error', cleanup)
  })

  rpc.onApplyUpdates(async (request = {}) => {
    console.log('[worker] apply-updates request')
    if (!request.key) throw new Error('Doc key is required for applyUpdates')
    return await worker.applyUpdates(request)
  })

  rpc.onApplyAwareness(async (request = {}) => {
    console.log('[worker] apply-awareness request')
    if (!request.key) throw new Error('Doc key is required for applyAwareness')
    return await worker.applyAwareness(request)
  })

  rpc.onListInvites(async (request = {}) => {
    console.log('[worker] list-invites request', request?.key)
    if (!request.key) throw new Error('Doc key is required to list invites')
    const invites = await worker.listInvites(
      request.key,
      request.includeRevoked === true
    )
    return { invites }
  })

  rpc.onCreateInvite(async (request = {}) => {
    console.log('[worker] create-invite request', request?.key)
    if (!request.key) throw new Error('Doc key is required to create invite')
    return await worker.createInvite(
      request.key,
      Array.isArray(request.roles) ? request.roles : [],
      request.expiresAt
    )
  })

  rpc.onRevokeInvite(async (request = {}) => {
    console.log(
      '[worker] revoke-invite request',
      request?.key,
      request?.inviteId
    )
    if (!request.key) throw new Error('Doc key is required to revoke invite')
    if (!request.inviteId) {
      throw new Error('Invite id is required to revoke invite')
    }
    const revoked = await worker.revokeInvite(request.key, request.inviteId)
    return { revoked: revoked === undefined ? true : !!revoked }
  })

  return rpc
}

import HRPC from '../../spec/hrpc/index.js'

export function createRpcServer(stream, worker) {
  const rpc = new HRPC(stream)

  rpc.onInitialize(async () => {
    const docs = await worker.listDocs()
    const state = await worker.readAppState()
    const response = { docs }
    if (state?.activeDoc) {
      response.activeDoc = state.activeDoc
    }
    return response
  })

  rpc.onListDocs(async () => {
    const docs = await worker.listDocs()
    return { docs }
  })

  rpc.onCreateDoc(async (request = {}) => {
    return await worker.createDoc({
      title: request.title,
      description: request.description
    })
  })

  rpc.onJoinDoc(async (request = {}) => {
    return await worker.joinDoc({
      invite: request.invite,
      title: request.title
    })
  })

  rpc.onPairInvite((stream) => {
    stream.destroy(new Error('Invites are not implemented'))
  })

  rpc.onRemoveDoc(async (request = {}) => {
    if (!request.key) throw new Error('Doc key is required to remove')
    const removed = await worker.removeDoc(request.key)
    return { removed }
  })

  rpc.onGetDoc(async (request = {}) => {
    if (!request.key) throw new Error('Doc key is required to load doc')
    const doc = await worker.getDoc(request.key)
    return { doc: doc ?? undefined }
  })

  rpc.onWatchDoc(async (stream) => {
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
          includeSnapshot: request.includeSnapshot === true,
          sinceRevision: request.sinceRevision
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

  rpc.onApplyOps(async (request = {}) => {
    if (!request.key) throw new Error('Doc key is required for applyOps')
    return await worker.applyOperations(request)
  })

  rpc.onUpdatePresence(async (request = {}) => {
    if (!request.key) throw new Error('Doc key is required for updatePresence')
    return await worker.updatePresence(request.key, request)
  })

  rpc.onListInvites(async () => {
    throw new Error('Invites are not implemented')
  })

  rpc.onCreateInvite(async () => {
    throw new Error('Invites are not implemented')
  })

  rpc.onRevokeInvite(async () => {
    throw new Error('Invites are not implemented')
  })

  return rpc
}

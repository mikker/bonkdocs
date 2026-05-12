import HRPC from '../hrpc.js'

export function createRpcServer(stream, worker) {
  const rpc = new HRPC(stream)

  rpc.onInitialize(async () => {
    console.log('[worker] initialize request')
    const [docs, identity] = await Promise.all([
      worker.listDocs(),
      worker.getIdentity()
    ])
    return { docs, identity: identity ?? undefined }
  })

  rpc.onListDocs(async () => {
    console.log('[worker] list-docs request')
    const docs = await worker.listDocs()
    return { docs }
  })

  rpc.onSetPublicProfile(async (request = {}) => {
    console.log('[worker] set-public-profile request')
    return await worker.setPublicProfile({ displayName: request.displayName })
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

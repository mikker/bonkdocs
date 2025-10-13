// import path from 'path'
// import FramedStream from 'framed-stream'
// import HRPC from '../../spec/hrpc/index.js'
// import { JamWorker, extractPersistedRooms } from './jam-worker.js'
import pearPipe from 'pear-pipe'

export async function initializeWorker() {
  const pipe = pearPipe()

  pipe.write('hi')
}

void initializeWorker()

//
// const VERSION = '0.0.0'
//
// let workerInstance = null
//
// export async function initializeWorker(options = {}) {
//   if (!workerInstance) {
//     const baseDir = resolveBaseDir(options)
//     workerInstance = new JamWorker({
//       baseDir,
//       bootstrap: options.bootstrap,
//       autobase: options.autobase,
//       ensureStorage: options.ensureStorage ?? false
//     })
//   }
//
//   if (options.rpc) {
//     attachRpc(options.rpc, workerInstance)
//   }
//
//   await workerInstance.ready()
//   return workerInstance
// }
//
// function attachRpc(rpc, worker) {
//   rpc.onPing(async (request) => {
//     return {
//       now: Date.now(),
//       nonce: request?.nonce,
//       status: 'ok',
//       version: VERSION
//     }
//   })
//
//   rpc.onInitialize(async () => {
//     const rooms = await worker.listRooms()
//
//     let selectedRoom
//     let activeRoom
//
//     const localDb = worker.manager?.localDb
//     if (localDb) {
//       try {
//         const stateRecord = await localDb.get('@local/state', { id: 'app' })
//         const value = stateRecord?.value ?? stateRecord
//         const persisted = extractPersistedRooms(value)
//         selectedRoom = persisted.selected
//         activeRoom = persisted.active
//       } catch {}
//     }
//
//     const response = { rooms }
//     if (typeof selectedRoom === 'string' && selectedRoom.length > 0) {
//       response.selectedRoom = selectedRoom
//     }
//     if (typeof activeRoom === 'string' && activeRoom.length > 0) {
//       response.activeRoom = activeRoom
//     }
//
//     const profile = await worker.getProfile()
//     if (profile?.nickname) {
//       response.profile = profile
//     }
//
//     return response
//   })
//
//   rpc.onListRooms(async () => {
//     const rooms = await worker.listRooms()
//     return { rooms }
//   })
//
//   rpc.onCreateRoom(async (request) => {
//     return await worker.createRoom({
//       name: request?.name,
//       displayName: request?.displayName
//     })
//   })
//
//   rpc.onJoinRoom(async (request) => {
//     if (!request?.invite) {
//       throw new Error('Invite is required to join a room')
//     }
//     return await worker.joinRoom({
//       invite: request.invite,
//       name: request?.name,
//       displayName: request?.displayName
//     })
//   })
//
//   rpc.onPairInvite(async (stream) => {
//     const request = stream.data || {}
//     if (!request.invite) {
//       stream.destroy(new Error('Invite is required to pair room'))
//       return
//     }
//
//     const controller = new AbortController()
//     let finished = false
//
//     const cancel = () => {
//       if (finished) return
//       finished = true
//       controller.abort()
//     }
//
//     stream.on('close', cancel)
//     stream.on('error', cancel)
//
//     try {
//       await worker.pairInvite(
//         request,
//         async (status) => {
//           if (finished) return
//           stream.write(status)
//         },
//         controller.signal
//       )
//       if (!finished) {
//         finished = true
//         stream.end()
//       }
//     } catch (error) {
//       if (!finished) {
//         finished = true
//         controller.abort()
//         stream.destroy(error)
//       }
//     } finally {
//       stream.off('close', cancel)
//       stream.off('error', cancel)
//     }
//   })
//
//   rpc.onRemoveRoom(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to remove room')
//     }
//     const removed = await worker.removeRoom(request.key)
//     return { removed }
//   })
//
//   rpc.onGetRoom(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to get room')
//     }
//     const room = await worker.getRoom(request.key)
//     return { room: room ?? undefined }
//   })
//
//   rpc.onGetSnapshot(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to fetch snapshot')
//     }
//     const snapshot = await worker.getSnapshot(request.key, {
//       includeInvites: request.includeInvites,
//       eventLimit: request.eventLimit,
//       trackLimit: request.trackLimit
//     })
//     return { snapshot }
//   })
//
//   rpc.onWatchRoom(async (stream) => {
//     const request = { ...stream.data }
//     if (!request.key) {
//       stream.destroy(new Error('Room key is required to watch room'))
//       return
//     }
//
//     let stop = null
//
//     try {
//       stop = await worker.watchRoom(
//         request.key,
//         {
//           includeInvites: request.includeInvites,
//           eventLimit: request.eventLimit,
//           trackLimit: request.trackLimit
//         },
//         async (snapshot) => {
//           if (!stream.destroyed) {
//             stream.write(snapshot)
//           }
//         }
//       )
//     } catch (error) {
//       stream.destroy(error)
//       return
//     }
//
//     const cleanup = () => {
//       if (!stop) return
//       const pending = stop
//       stop = null
//       void pending().catch(() => {})
//     }
//
//     stream.on('close', cleanup)
//     stream.on('error', cleanup)
//   })
//
//   rpc.onUpsertMember(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to upsert member')
//     }
//     await worker.upsertMember(request.key, request.displayName)
//   })
//
//   rpc.onSendChat(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to send chat')
//     }
//     await worker.sendChat(request.key, request.message, request.time)
//   })
//
//   rpc.onClaimDj(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to claim DJ')
//     }
//     await worker.claimDj(request.key, request.time)
//   })
//
//   rpc.onReleaseDj(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to release DJ')
//     }
//     await worker.releaseDj(request.key, request.time, request.reason)
//   })
//
//   rpc.onQueueTrack(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to queue track')
//     }
//     if (!request?.media) {
//       throw new Error('Track media is required to queue track')
//     }
//     await worker.queueTrack({
//       key: request.key,
//       media: request.media,
//       title: request.title,
//       duration: request.duration,
//       mimeType: request.mimeType,
//       queuedAt: request.queuedAt
//     })
//   })
//
//   rpc.onRemoveTrack(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to remove track')
//     }
//     if (typeof request?.trackIndex !== 'number') {
//       throw new Error('Track index is required to remove track')
//     }
//     await worker.removeTrack({
//       key: request.key,
//       trackIndex: request.trackIndex,
//       removedAt: request.removedAt
//     })
//   })
//
//   rpc.onStoreTrackMedia(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to store track media')
//     }
//     if (!request?.data) {
//       throw new Error('Media data is required to store track media')
//     }
//     const result = await worker.storeTrackMedia(request.key, request.data)
//     return result
//   })
//
//   rpc.onPlaybackStart(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to start playback')
//     }
//     await worker.startPlayback(request.key, request.trackIndex, request.duration, request.time)
//   })
//
//   rpc.onPlaybackStop(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to stop playback')
//     }
//     await worker.stopPlayback(request.key, request.time)
//   })
//
//   rpc.onStreamTrackMedia(async (stream) => {
//     const request = stream.data || {}
//     if (!request.key) {
//       stream.destroy(new Error('Room key is required to stream track media'))
//       return
//     }
//     if (typeof request.trackIndex !== 'number') {
//       stream.destroy(new Error('Track index is required to stream track media'))
//       return
//     }
//
//     let media
//     try {
//       media = await worker.streamTrackMedia(request.key, request.trackIndex)
//     } catch (error) {
//       stream.destroy(error)
//       return
//     }
//
//     const mediaStream = media.stream
//     let sequence = 0
//     let closed = false
//
//     const cleanup = () => {
//       if (closed) return
//       closed = true
//       try {
//         mediaStream.destroy()
//       } catch {}
//       stream.off('close', onClose)
//       stream.off('error', onClose)
//       mediaStream.off('data', onData)
//       mediaStream.off('end', onEnd)
//       mediaStream.off('error', onError)
//     }
//
//     const onClose = () => {
//       cleanup()
//     }
//
//     const onData = (chunk) => {
//       if (closed) return
//       const payload = {
//         sequence,
//         data: chunk
//       }
//       if (sequence === 0) {
//         if (typeof media.byteLength === 'number') {
//           payload.totalBytes = media.byteLength
//         }
//         if (media.mimeType) {
//           payload.mimeType = media.mimeType
//         }
//       }
//       stream.write(payload)
//       sequence += 1
//     }
//
//     const onEnd = () => {
//       if (closed) return
//       stream.write({
//         sequence,
//         data: Buffer.alloc(0),
//         done: true,
//         totalBytes: typeof media.byteLength === 'number' ? media.byteLength : undefined
//       })
//       stream.end()
//       cleanup()
//     }
//
//     const onError = (error) => {
//       if (closed) return
//       if (error && error.code === 'REQUEST_CANCELLED') {
//         try {
//           stream.end()
//         } catch {}
//       } else {
//         try {
//           stream.destroy(error)
//         } catch (err) {
//           console.warn('[worker] response stream destroy failed', {
//             message: err instanceof Error ? err.message : String(err)
//           })
//         }
//       }
//       cleanup()
//     }
//
//     stream.on('close', onClose)
//     stream.on('error', onClose)
//     mediaStream.on('data', onData)
//     mediaStream.on('end', onEnd)
//     mediaStream.on('error', onError)
//   })
//
//   rpc.onUpdateConfig(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to update config')
//     }
//     await worker.updateConfig(request.key, request.name)
//   })
//
//   rpc.onUpdateState(async (request) => {
//     await worker.updateLocalState({
//       selectedRoom: request?.selectedRoom,
//       activeRoom: request?.activeRoom,
//       currentRoom: request?.currentRoom,
//       currentPlayingRoom: request?.currentPlayingRoom
//     })
//   })
//
//   rpc.onListInvites(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to list invites')
//     }
//     const invites = await worker.listInvites(request.key, request.includeRevoked === true)
//     return { invites }
//   })
//
//   rpc.onCreateInvite(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to create invite')
//     }
//     return await worker.createInvite(
//       request.key,
//       Array.isArray(request.roles) ? request.roles : [],
//       request.expiresAt
//     )
//   })
//
//   rpc.onRevokeInvite(async (request) => {
//     if (!request?.key) {
//       throw new Error('Room key is required to revoke invite')
//     }
//     if (!request?.inviteId) {
//       throw new Error('Invite id is required to revoke invite')
//     }
//     const revoked = await worker.revokeInvite(request.key, request.inviteId)
//     return { revoked }
//   })
//
//   rpc.onGetProfile(async () => {
//     const profile = await worker.getProfile()
//     return { profile }
//   })
//
//   rpc.onSetProfile(async (request) => {
//     const result = await worker.setProfile(request?.nickname)
//     return { profile: result }
//   })
// }
//
// function resolveBaseDir(options) {
//   if (options.baseDir) return options.baseDir
//   const pear = globalThis.Pear
//   if (pear?.config?.storage) {
//     return path.join(pear.config.storage, 'pear-jam')
//   }
//   return path.join(process.cwd(), '.pear-jam')
// }
//
// async function bootstrapWithPear() {
//   const pipe = pearPipe()
//   const rpc = new HRPC(pipe)
//
//   await initializeWorker({
//     baseDir: path.join(pear.config.storage, 'pear-jam'),
//     bootstrap: pear.config.bootstrap,
//     autobase: pear.config.autobase,
//     ensureStorage: true,
//     rpc
//   })
//
//   notifyRendererReady()
//
//   const cleanup = async () => {
//     if (!workerInstance) return
//     try {
//       await workerInstance.close()
//     } catch {}
//     workerInstance = null
//   }
//
//   pipe.on('close', cleanup)
//   pipe.on('end', cleanup)
//   pipe.on('error', () => {})
// }
//
// void bootstrapWithPear()
//
// function notifyRendererReady() {
//   try {
//     if (typeof globalThis.postMessage === 'function') {
//       globalThis.postMessage({ type: 'pear-jam-worker-ready' })
//     }
//   } catch {}
// }

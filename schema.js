#!/usr/bin/env node
import Hyperschema from 'hyperschema'
import HyperdbBuilder from 'hyperdb/builder'
import Hyperdispatch from 'hyperdispatch'
import HRPCBuilder from 'hrpc'
import { extendSchema, extendDb, extendDispatch } from 'autobonk'

const specRoot = './spec'
const schemaDir = specRoot + '/schema'
const dbDir = specRoot + '/db'
const dispatchDir = specRoot + '/dispatch'
const hrpcDir = specRoot + '/hrpc'

// --- Hyperschema ---------------------------------------------------------
const schema = Hyperschema.from(schemaDir)
extendSchema(schema)

const docs = schema.namespace('bonk-docs')

docs.register({
  name: 'metadata',
  compact: false,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'title', type: 'string', required: false },
    { name: 'description', type: 'string', required: false },
    { name: 'createdAt', type: 'uint', required: true },
    { name: 'updatedAt', type: 'uint', required: false },
    { name: 'creatorKey', type: 'fixed32', required: false },
    { name: 'rev', type: 'uint', required: true }
  ]
})

docs.register({
  name: 'operation',
  compact: false,
  fields: [
    { name: 'rev', type: 'uint', required: true },
    { name: 'baseRev', type: 'uint', required: true },
    { name: 'clientId', type: 'fixed32', required: true },
    { name: 'sessionId', type: 'fixed32', required: false },
    { name: 'timestamp', type: 'uint', required: true },
    { name: 'data', type: 'buffer', required: true }
  ]
})

docs.register({
  name: 'snapshot',
  compact: false,
  fields: [
    { name: 'rev', type: 'uint', required: true },
    { name: 'createdAt', type: 'uint', required: true },
    { name: 'compression', type: 'string', required: false },
    { name: 'data', type: 'buffer', required: true },
    { name: 'hash', type: 'buffer', required: false }
  ]
})

docs.register({
  name: 'presence',
  compact: false,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'writerKey', type: 'fixed32', required: true },
    { name: 'sessionId', type: 'fixed32', required: true },
    { name: 'displayName', type: 'string', required: false },
    { name: 'color', type: 'string', required: false },
    { name: 'updatedAt', type: 'uint', required: true },
    { name: 'payload', type: 'buffer', required: false }
  ]
})

docs.register({
  name: 'presence-remove',
  compact: false,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'removedAt', type: 'uint', required: true }
  ]
})

const local = schema.namespace('local')

local.register({
  name: 'doc',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'encryptionKey', type: 'string', required: true },
    { name: 'createdAt', type: 'uint', required: true },
    { name: 'joinedAt', type: 'uint', required: false },
    { name: 'isCreator', type: 'bool', required: false },
    { name: 'title', type: 'string', required: false },
    { name: 'lastRevision', type: 'uint', required: false },
    { name: 'lastOpenedAt', type: 'uint', required: false }
  ]
})

local.register({
  name: 'state',
  compact: false,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'activeDoc', type: 'string', required: false },
    { name: 'lastSeenAt', type: 'uint', required: false }
  ]
})

local.register({
  name: 'profile',
  compact: false,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'displayName', type: 'string', required: false },
    { name: 'color', type: 'string', required: false },
    { name: 'updatedAt', type: 'uint', required: false }
  ]
})

const rpc = schema.namespace('bonk-docs-rpc')

rpc.register({
  name: 'doc-capabilities',
  compact: false,
  fields: [
    { name: 'canEdit', type: 'bool', required: true },
    { name: 'canComment', type: 'bool', required: true },
    { name: 'canInvite', type: 'bool', required: true },
    { name: 'roles', type: 'string', array: true, required: false }
  ]
})

rpc.register({
  name: 'doc-presence',
  compact: false,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'writerKey', type: 'string', required: true },
    { name: 'sessionId', type: 'string', required: true },
    { name: 'displayName', type: 'string', required: false },
    { name: 'color', type: 'string', required: false },
    { name: 'updatedAt', type: 'uint', required: true },
    { name: 'payload', type: 'buffer', required: false }
  ]
})

rpc.register({
  name: 'doc-operation',
  compact: false,
  fields: [
    { name: 'rev', type: 'uint', required: false },
    { name: 'baseRev', type: 'uint', required: false },
    { name: 'clientId', type: 'string', required: true },
    { name: 'sessionId', type: 'string', required: false },
    { name: 'timestamp', type: 'uint', required: false },
    { name: 'data', type: 'buffer', required: true }
  ]
})

rpc.register({
  name: 'doc-update',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'revision', type: 'uint', required: true },
    { name: 'baseRevision', type: 'uint', required: false },
    { name: 'snapshotRevision', type: 'uint', required: false },
    { name: 'updatedAt', type: 'uint', required: false },
    { name: 'title', type: 'string', required: false },
    { name: 'snapshot', type: 'buffer', required: false },
    {
      name: 'ops',
      type: '@bonk-docs-rpc/doc-operation',
      array: true,
      required: false
    },
    {
      name: 'presence',
      type: '@bonk-docs-rpc/doc-presence',
      array: true,
      required: false
    },
    {
      name: 'capabilities',
      type: '@bonk-docs-rpc/doc-capabilities',
      required: false
    }
  ]
})

rpc.register({
  name: 'doc-invite',
  compact: false,
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'invite', type: 'string', required: true },
    { name: 'roles', type: 'string', array: true, required: false },
    { name: 'createdBy', type: 'string', required: false },
    { name: 'createdAt', type: 'uint', required: false },
    { name: 'revokedAt', type: 'uint', required: false },
    { name: 'expiresAt', type: 'int', required: false }
  ]
})

rpc.register({
  name: 'initialize-request',
  compact: false,
  fields: [{ name: 'refresh', type: 'bool', required: false }]
})

rpc.register({
  name: 'initialize-response',
  compact: false,
  fields: [
    { name: 'docs', type: '@local/doc', array: true, required: true },
    { name: 'activeDoc', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'list-docs-request',
  compact: false,
  fields: [{ name: 'refresh', type: 'bool', required: false }]
})

rpc.register({
  name: 'list-docs-response',
  compact: false,
  fields: [{ name: 'docs', type: '@local/doc', array: true, required: true }]
})

rpc.register({
  name: 'create-doc-request',
  compact: false,
  fields: [
    { name: 'title', type: 'string', required: false },
    { name: 'displayName', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'create-doc-response',
  compact: false,
  fields: [
    { name: 'doc', type: '@local/doc', required: true },
    { name: 'writerKey', type: 'string', required: true },
    { name: 'invite', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'join-doc-request',
  compact: false,
  fields: [
    { name: 'invite', type: 'string', required: true },
    { name: 'title', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'join-doc-response',
  compact: false,
  fields: [
    { name: 'doc', type: '@local/doc', required: true },
    { name: 'writerKey', type: 'string', required: true }
  ]
})

rpc.register({
  name: 'remove-doc-request',
  compact: false,
  fields: [{ name: 'key', type: 'string', required: true }]
})

rpc.register({
  name: 'remove-doc-response',
  compact: false,
  fields: [{ name: 'removed', type: 'bool', required: true }]
})

rpc.register({
  name: 'rename-doc-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'title', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'rename-doc-response',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'title', type: 'string', required: true },
    { name: 'updatedAt', type: 'uint', required: false },
    { name: 'rev', type: 'uint', required: false }
  ]
})

rpc.register({
  name: 'get-doc-request',
  compact: false,
  fields: [{ name: 'key', type: 'string', required: true }]
})

rpc.register({
  name: 'get-doc-response',
  compact: false,
  fields: [{ name: 'doc', type: '@local/doc', required: false }]
})

rpc.register({
  name: 'watch-doc-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'sinceRevision', type: 'uint', required: false },
    { name: 'includeSnapshot', type: 'bool', required: false }
  ]
})

rpc.register({
  name: 'apply-ops-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    {
      name: 'ops',
      type: '@bonk-docs-rpc/doc-operation',
      array: true,
      required: true
    },
    { name: 'clientTime', type: 'uint', required: false }
  ]
})

rpc.register({
  name: 'apply-ops-response',
  compact: false,
  fields: [
    { name: 'accepted', type: 'bool', required: true },
    { name: 'revision', type: 'uint', required: false },
    { name: 'error', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'update-presence-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'sessionId', type: 'string', required: true },
    { name: 'displayName', type: 'string', required: false },
    { name: 'color', type: 'string', required: false },
    { name: 'payload', type: 'buffer', required: false },
    { name: 'updatedAt', type: 'uint', required: false }
  ]
})

rpc.register({
  name: 'update-presence-response',
  compact: false,
  fields: [{ name: 'status', type: 'string', required: false }]
})

rpc.register({
  name: 'list-invites-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'includeRevoked', type: 'bool', required: false }
  ]
})

rpc.register({
  name: 'list-invites-response',
  compact: false,
  fields: [
    {
      name: 'invites',
      type: '@bonk-docs-rpc/doc-invite',
      array: true,
      required: true
    }
  ]
})

rpc.register({
  name: 'create-invite-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'roles', type: 'string', array: true, required: false },
    { name: 'expiresAt', type: 'uint', required: false }
  ]
})

rpc.register({
  name: 'create-invite-response',
  compact: false,
  fields: [
    { name: 'invite', type: 'string', required: true },
    { name: 'inviteId', type: 'string', required: true }
  ]
})

rpc.register({
  name: 'revoke-invite-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'inviteId', type: 'string', required: true }
  ]
})

rpc.register({
  name: 'revoke-invite-response',
  compact: false,
  fields: [{ name: 'revoked', type: 'bool', required: true }]
})

rpc.register({
  name: 'pair-invite-request',
  compact: false,
  fields: [
    { name: 'invite', type: 'string', required: true },
    { name: 'title', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'pair-status',
  compact: false,
  fields: [
    { name: 'state', type: 'string', required: true },
    { name: 'message', type: 'string', required: false },
    { name: 'progress', type: 'uint', required: false },
    { name: 'doc', type: '@local/doc', required: false },
    { name: 'writerKey', type: 'string', required: false }
  ]
})

Hyperschema.toDisk(schema)

// --- Hyperdb -------------------------------------------------------------
const dbBuilder = HyperdbBuilder.from(schemaDir, dbDir)
extendDb(dbBuilder)

const docsDb = dbBuilder.namespace('bonk-docs')

docsDb.collections.register({
  name: 'metadata',
  schema: '@bonk-docs/metadata',
  key: ['id']
})
docsDb.collections.register({
  name: 'operations',
  schema: '@bonk-docs/operation',
  key: ['rev']
})
docsDb.collections.register({
  name: 'snapshots',
  schema: '@bonk-docs/snapshot',
  key: ['rev']
})
docsDb.collections.register({
  name: 'presence',
  schema: '@bonk-docs/presence',
  key: ['id']
})

const localDb = dbBuilder.namespace('local')

localDb.collections.register({
  name: 'docs',
  schema: '@local/doc',
  key: ['key']
})
localDb.collections.register({
  name: 'state',
  schema: '@local/state',
  key: ['id']
})
localDb.collections.register({
  name: 'profile',
  schema: '@local/profile',
  key: ['id']
})

HyperdbBuilder.toDisk(dbBuilder)

// --- Hyperdispatch -------------------------------------------------------
const dispatch = Hyperdispatch.from(schemaDir, dispatchDir)
extendDispatch(dispatch)

const docDispatch = dispatch.namespace('bonk-docs')

docDispatch.register({
  name: 'metadata-upsert',
  requestType: '@bonk-docs/metadata'
})
docDispatch.register({
  name: 'operation-append',
  requestType: '@bonk-docs/operation'
})
docDispatch.register({
  name: 'snapshot-save',
  requestType: '@bonk-docs/snapshot'
})
docDispatch.register({
  name: 'presence-upsert',
  requestType: '@bonk-docs/presence'
})
docDispatch.register({
  name: 'presence-remove',
  requestType: '@bonk-docs/presence-remove'
})

const localDispatch = dispatch.namespace('local')

localDispatch.register({ name: 'doc-upsert', requestType: '@local/doc' })
localDispatch.register({ name: 'state-update', requestType: '@local/state' })
localDispatch.register({
  name: 'profile-upsert',
  requestType: '@local/profile'
})

Hyperdispatch.toDisk(dispatch)

// --- HRPC ----------------------------------------------------------------
const hrpc = HRPCBuilder.from(schemaDir, hrpcDir)

const workerRpc = hrpc.namespace('bonk-docs')

workerRpc.register({
  name: 'initialize',
  request: { name: '@bonk-docs-rpc/initialize-request' },
  response: { name: '@bonk-docs-rpc/initialize-response' }
})

workerRpc.register({
  name: 'list-docs',
  request: { name: '@bonk-docs-rpc/list-docs-request' },
  response: { name: '@bonk-docs-rpc/list-docs-response' }
})

workerRpc.register({
  name: 'create-doc',
  request: { name: '@bonk-docs-rpc/create-doc-request' },
  response: { name: '@bonk-docs-rpc/create-doc-response' }
})

workerRpc.register({
  name: 'join-doc',
  request: { name: '@bonk-docs-rpc/join-doc-request' },
  response: { name: '@bonk-docs-rpc/join-doc-response' }
})

workerRpc.register({
  name: 'pair-invite',
  request: { name: '@bonk-docs-rpc/pair-invite-request' },
  response: { name: '@bonk-docs-rpc/pair-status', stream: true }
})

workerRpc.register({
  name: 'remove-doc',
  request: { name: '@bonk-docs-rpc/remove-doc-request' },
  response: { name: '@bonk-docs-rpc/remove-doc-response' }
})

workerRpc.register({
  name: 'get-doc',
  request: { name: '@bonk-docs-rpc/get-doc-request' },
  response: { name: '@bonk-docs-rpc/get-doc-response' }
})

workerRpc.register({
  name: 'watch-doc',
  request: { name: '@bonk-docs-rpc/watch-doc-request' },
  response: { name: '@bonk-docs-rpc/doc-update', stream: true }
})

workerRpc.register({
  name: 'apply-ops',
  request: { name: '@bonk-docs-rpc/apply-ops-request' },
  response: { name: '@bonk-docs-rpc/apply-ops-response' }
})

workerRpc.register({
  name: 'update-presence',
  request: { name: '@bonk-docs-rpc/update-presence-request' },
  response: { name: '@bonk-docs-rpc/update-presence-response' }
})

workerRpc.register({
  name: 'list-invites',
  request: { name: '@bonk-docs-rpc/list-invites-request' },
  response: { name: '@bonk-docs-rpc/list-invites-response' }
})

workerRpc.register({
  name: 'create-invite',
  request: { name: '@bonk-docs-rpc/create-invite-request' },
  response: { name: '@bonk-docs-rpc/create-invite-response' }
})

workerRpc.register({
  name: 'revoke-invite',
  request: { name: '@bonk-docs-rpc/revoke-invite-request' },
  response: { name: '@bonk-docs-rpc/revoke-invite-response' }
})

workerRpc.register({
  name: 'rename-doc',
  request: { name: '@bonk-docs-rpc/rename-doc-request' },
  response: { name: '@bonk-docs-rpc/rename-doc-response' }
})

HRPCBuilder.toDisk(hrpc)

console.log('✅ Generated bonk-docs schema bundle in', specRoot)

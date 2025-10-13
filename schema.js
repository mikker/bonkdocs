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

const local = schema.namespace('local')

local.register({
  name: 'doc',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'encryptionKey', type: 'string', required: true },
    { name: 'createdAt', type: 'uint', required: true },
    { name: 'joinedAt', type: 'uint', required: false },
    { name: 'isCreator', type: 'bool', required: false }
  ]
})

const rpc = schema.namespace('pear-docs-rpc')

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
    { name: 'name', type: 'string', required: false },
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
    { name: 'name', type: 'string', required: false },
    { name: 'displayName', type: 'string', required: false }
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
  name: 'get-doc-request',
  compact: false,
  fields: [{ name: 'key', type: 'string', required: true }]
})

rpc.register({
  name: 'get-doc-response',
  compact: false,
  fields: [{ name: 'doc', type: '@local/doc', required: false }]
})

Hyperschema.toDisk(schema)

// --- Hyperdb -------------------------------------------------------------
const dbBuilder = HyperdbBuilder.from(schemaDir, dbDir)
extendDb(dbBuilder)

const localDb = dbBuilder.namespace('local')

localDb.collections.register({
  name: 'docs',
  schema: '@local/doc',
  key: ['key']
})

HyperdbBuilder.toDisk(dbBuilder)

// --- Hyperdispatch -------------------------------------------------------
const dispatch = Hyperdispatch.from(schemaDir, dispatchDir)
extendDispatch(dispatch)

Hyperdispatch.toDisk(dispatch)

// --- HRPC ----------------------------------------------------------------
const hrpc = HRPCBuilder.from(schemaDir, hrpcDir)

const workerRpc = hrpc.namespace('pear-jam')

workerRpc.register({
  name: 'ping',
  request: { name: '@pear-jam-rpc/ping-request' },
  response: { name: '@pear-jam-rpc/ping-response' }
})

workerRpc.register({
  name: 'initialize',
  request: { name: '@pear-jam-rpc/initialize-request' },
  response: { name: '@pear-jam-rpc/initialize-response' }
})

workerRpc.register({
  name: 'list-docs',
  request: { name: '@pear-jam-rpc/list-docs-request' },
  response: { name: '@pear-jam-rpc/list-docs-response' }
})

workerRpc.register({
  name: 'create-doc',
  request: { name: '@pear-jam-rpc/create-doc-request' },
  response: { name: '@pear-jam-rpc/create-doc-response' }
})

workerRpc.register({
  name: 'join-doc',
  request: { name: '@pear-jam-rpc/join-doc-request' },
  response: { name: '@pear-jam-rpc/join-doc-response' }
})

workerRpc.register({
  name: 'remove-doc',
  request: { name: '@pear-jam-rpc/remove-doc-request' },
  response: { name: '@pear-jam-rpc/remove-doc-response' }
})

workerRpc.register({
  name: 'get-doc',
  request: { name: '@pear-jam-rpc/get-doc-request' },
  response: { name: '@pear-jam-rpc/get-doc-response' }
})

HRPCBuilder.toDisk(hrpc)

console.log('✅ Generated Autobonk-compatible schema bundle in', specRoot)

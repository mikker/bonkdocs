#!/usr/bin/env node
import { rmSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import Hyperschema from 'hyperschema'
import HRPCBuilder from 'hrpc'
import { generateSpaceSpec } from 'pear-sdk/spaces'
import docSpaceDefinition from './domain/space-definition.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const specRoot = resolve(currentDir, 'spec')
const schemaDir = resolve(specRoot, 'schema')
const hrpcDir = resolve(specRoot, 'hrpc')

rmSync(specRoot, { recursive: true, force: true })
generateSpaceSpec(docSpaceDefinition, specRoot)

const schema = Hyperschema.from(schemaDir)
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
    { name: 'lastOpenedAt', type: 'uint', required: false },
    { name: 'lockedAt', type: 'uint', required: false },
    { name: 'lockedBy', type: 'string', required: false }
  ]
})

const rpc = schema.namespace('bonk-docs-rpc')

rpc.register({
  name: 'doc-capabilities',
  compact: false,
  fields: [
    { name: 'canEdit', type: 'bool', required: true },
    { name: 'canInvite', type: 'bool', required: true },
    { name: 'roles', type: 'string', array: true, required: false }
  ]
})

rpc.register({
  name: 'doc-update-entry',
  compact: false,
  fields: [
    { name: 'rev', type: 'uint', required: false },
    { name: 'clientId', type: 'string', required: true },
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
    { name: 'updatedAt', type: 'uint', required: false },
    { name: 'title', type: 'string', required: false },
    {
      name: 'capabilities',
      type: '@bonk-docs-rpc/doc-capabilities',
      required: false
    },
    { name: 'lockedAt', type: 'uint', required: false },
    { name: 'lockedBy', type: 'string', required: false },
    { name: 'syncUpdate', type: 'buffer', required: false },
    {
      name: 'updates',
      type: '@bonk-docs-rpc/doc-update-entry',
      array: true,
      required: false
    },
    { name: 'awareness', type: 'buffer', required: false },
    { name: 'writerKey', type: 'string', required: false }
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
  name: 'identity-profile',
  compact: false,
  fields: [
    { name: 'displayName', type: 'string', required: false },
    { name: 'bio', type: 'string', required: false },
    { name: 'updatedAt', type: 'uint', required: false }
  ]
})

rpc.register({
  name: 'identity-summary',
  compact: false,
  fields: [
    { name: 'identityKey', type: 'string', required: true },
    { name: 'writerKey', type: 'string', required: true },
    {
      name: 'profile',
      type: '@bonk-docs-rpc/identity-profile',
      required: false
    }
  ]
})

rpc.register({
  name: 'initialize-request',
  compact: false,
  fields: []
})

rpc.register({
  name: 'initialize-response',
  compact: false,
  fields: [
    { name: 'docs', type: '@local/doc', array: true, required: true },
    { name: 'activeDoc', type: 'string', required: false },
    {
      name: 'identity',
      type: '@bonk-docs-rpc/identity-summary',
      required: false
    }
  ]
})

rpc.register({
  name: 'list-docs-request',
  compact: false,
  fields: []
})

rpc.register({
  name: 'list-docs-response',
  compact: false,
  fields: [{ name: 'docs', type: '@local/doc', array: true, required: true }]
})

rpc.register({
  name: 'set-public-profile-request',
  compact: false,
  fields: [{ name: 'displayName', type: 'string', required: false }]
})

rpc.register({
  name: 'set-public-profile-response',
  compact: false,
  fields: [
    {
      name: 'identity',
      type: '@bonk-docs-rpc/identity-summary',
      required: true
    }
  ]
})

rpc.register({
  name: 'create-doc-request',
  compact: false,
  fields: [{ name: 'title', type: 'string', required: false }]
})

rpc.register({
  name: 'create-doc-response',
  compact: false,
  fields: [
    { name: 'doc', type: '@local/doc', required: true },
    { name: 'writerKey', type: 'string', required: true }
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
    { name: 'updatedAt', type: 'uint', required: false }
  ]
})

rpc.register({
  name: 'lock-doc-request',
  compact: false,
  fields: [{ name: 'key', type: 'string', required: true }]
})

rpc.register({
  name: 'lock-doc-response',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'lockedAt', type: 'uint', required: true },
    { name: 'lockedBy', type: 'string', required: true }
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
  fields: [
    { name: 'doc', type: '@local/doc', required: false },
    { name: 'writerKey', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'watch-doc-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'stateVector', type: 'buffer', required: false }
  ]
})

rpc.register({
  name: 'apply-updates-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    {
      name: 'updates',
      type: '@bonk-docs-rpc/doc-update-entry',
      array: true,
      required: true
    }
  ]
})

rpc.register({
  name: 'apply-updates-response',
  compact: false,
  fields: [
    { name: 'accepted', type: 'bool', required: true },
    { name: 'revision', type: 'uint', required: false },
    { name: 'error', type: 'string', required: false }
  ]
})

rpc.register({
  name: 'apply-awareness-request',
  compact: false,
  fields: [
    { name: 'key', type: 'string', required: true },
    { name: 'update', type: 'buffer', required: true }
  ]
})

rpc.register({
  name: 'apply-awareness-response',
  compact: false,
  fields: [{ name: 'accepted', type: 'bool', required: true }]
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
  fields: [{ name: 'invite', type: 'string', required: true }]
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
  name: 'set-public-profile',
  request: { name: '@bonk-docs-rpc/set-public-profile-request' },
  response: { name: '@bonk-docs-rpc/set-public-profile-response' }
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
  name: 'apply-updates',
  request: { name: '@bonk-docs-rpc/apply-updates-request' },
  response: { name: '@bonk-docs-rpc/apply-updates-response' }
})

workerRpc.register({
  name: 'apply-awareness',
  request: { name: '@bonk-docs-rpc/apply-awareness-request' },
  response: { name: '@bonk-docs-rpc/apply-awareness-response' }
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

workerRpc.register({
  name: 'lock-doc',
  request: { name: '@bonk-docs-rpc/lock-doc-request' },
  response: { name: '@bonk-docs-rpc/lock-doc-response' }
})

HRPCBuilder.toDisk(hrpc)

console.log('✅ Generated bonk-docs pear-sdk schema bundle in', specRoot)

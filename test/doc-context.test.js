import test from 'brittle'
import b4a from 'b4a'
import { DocContext } from '../core/doc-context.js'

function createRecord(overrides = {}) {
  return {
    rev: 5,
    baseRev: 4,
    clientId: 'client-1',
    sessionId: 'session-1',
    timestamp: 1700000000000,
    data: b4a.from('operation'),
    ...overrides
  }
}

test('doc context accepts the next sequential operation', async (t) => {
  const ctx = Object.create(DocContext.prototype)
  const record = createRecord({ rev: 6, baseRev: 5 })

  const view = {
    async findOne(collection) {
      t.is(collection, '@bonk-docs/operations')
      return { rev: 5 }
    },
    async get() {
      throw new Error('get should not be called for sequential append')
    }
  }

  const result = await ctx._assertNextOperationRevision(view, record)
  t.is(result, true)
})

test('doc context skips duplicate operations that match existing state', async (t) => {
  const ctx = Object.create(DocContext.prototype)
  const record = createRecord()

  const view = {
    async findOne(collection) {
      t.is(collection, '@bonk-docs/operations')
      return { rev: 7 }
    },
    async get(collection, query) {
      t.is(collection, '@bonk-docs/operations')
      t.alike(query, { rev: record.rev })
      return createRecord()
    }
  }

  const result = await ctx._assertNextOperationRevision(view, record)
  t.is(result, false)
})

test('doc context throws on conflicting duplicate operations', async (t) => {
  const ctx = Object.create(DocContext.prototype)
  const record = createRecord()

  const view = {
    async findOne() {
      return { rev: 8 }
    },
    async get() {
      return createRecord({ data: b4a.from('different') })
    }
  }

  let error = null
  try {
    await ctx._assertNextOperationRevision(view, record)
  } catch (err) {
    error = err
  }

  t.ok(error)
  if (error) {
    t.is(error.message, 'Conflicting operation revision 5: expected 9')
  }
})

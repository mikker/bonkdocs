import db from './spec/db/index.js'
import * as dispatch from './spec/dispatch/index.js'
import hrpc from './spec/hrpc/index.js'

export const schema = { db, dispatch }
export const hrpcTypes = hrpc

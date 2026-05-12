import definition, {
  DOC_LOCK_ID,
  DOC_SPACE_TYPE,
  YJS_NAMESPACE
} from './space-definition.js'
import db from '../spec/db/index.js'
import * as dispatch from '../spec/dispatch/index.js'

const docSpace = definition.withSpec({ db, dispatch })

export { DOC_LOCK_ID, DOC_SPACE_TYPE, YJS_NAMESPACE }
export default docSpace

// @ts-check
import { loadCompleteBarList } from '../../../../../shared/barLocalPagination.js'

/** @typedef {{query:(name:string,filters:Record<string,unknown>)=>Promise<{data:unknown,complete?:boolean,scope?:Record<string,unknown>,snapshot_watermark?:number,pagination?:{has_more?:boolean,next_cursor?:string|null}}>,command:(request:Record<string,unknown>)=>Promise<unknown>,retryOperation:(id:string)=>Promise<unknown>}} BarLocalControlBridge */
/** @typedef {{ok?:unknown,outcome?:unknown,result?:unknown,error?:{code?:unknown,message?:unknown}}} ControlCommandResult */

/**
 * Local implementation for the established Bar Control board. Query results
 * must be complete and carry a single actor/business/outlet watermark. Pending
 * commands retain only their operation ID in renderer storage; exact payload
 * recovery remains in the protected main-process journal.
 * @param {{bridge:BarLocalControlBridge, storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>, businessId:string, outletId:string, randomUUID?:()=>string}} options
 */
export function createLocalHposControlApi({ bridge, storage, businessId, outletId, randomUUID = () => crypto.randomUUID() }) {
  const assertScope = () => {
    if (!businessId || !outletId) throw new Error('Local Bar business and outlet scope must load before Control actions.')
  }
  const keyFor = (key) => `bar-local:control:${businessId}:${outletId}:${key}`
  const list = (name, filters = {}) => { assertScope(); return loadCompleteBarList((queryName, queryFilters) => bridge.query(queryName, queryFilters), name, filters) }
  const execute = async (command, key, payload) => {
    assertScope()
    const storageKey = keyFor(key)
    let operationId = storage.getItem(storageKey)
    const retrying = Boolean(operationId)
    if (!operationId) {
      operationId = randomUUID()
      storage.setItem(storageKey, operationId)
    }
    try {
      const result = /** @type {ControlCommandResult|null|undefined} */ (retrying
        ? await bridge.retryOperation(operationId)
        : await bridge.command({ command, operation_id: operationId, payload }))
      if (result?.ok === true) {
        storage.removeItem(storageKey)
        return result.result
      }
      if (result?.outcome === 'refused') storage.removeItem(storageKey)
      const detail = result?.error?.message || result?.error?.code
      throw new Error(detail || (result?.outcome === 'unknown'
        ? 'The local result is not confirmed. Retry the saved Control operation; it will reuse the original ID and payload.'
        : 'The local authority refused the Control operation.'))
    } catch (error) {
      // A terminal server refusal is safe to forget. Transport errors and
      // ambiguous outcomes keep the original ID for exact journal retry.
      const code = error && typeof error === 'object' ? (/** @type {{code?:unknown}} */ (error)).code : null
      if (['VALIDATION_FAILED', 'CHECKLIST_VERSION_CONFLICT', 'CHECKLIST_NOT_FOUND', 'INCIDENT_STATE_CONFLICT', 'INCIDENT_VERSION_CONFLICT'].includes(String(code))) storage.removeItem(storageKey)
      throw error
    }
  }
  return Object.freeze({
    listTemplates: () => list('control.templates.list'),
    listChecklists: (filters = {}) => list('control.checklists.list', filters),
    listIncidents: (filters = {}) => list('control.incidents.list', filters),
    startChecklist: (templateKey) => execute('control.checklist.start', `checklist:start:${templateKey}`, { template_key: templateKey }),
    setChecklistItem: (item) => execute('control.checklist.item.set', `checklist:item:${item.checklist_id}:${item.item_id}`, {
      checklist_id: item.checklist_id, item_id: item.item_id, completed: true,
      expected_version: item.expected_version, note: null
    }),
    logIncident: (payload) => execute('control.incident.log', 'incident:log', payload),
    resolveIncident: (payload) => execute('control.incident.resolve', `incident:resolve:${payload.incident_id}`, payload),
    hasPending: (key) => Boolean(storage.getItem(keyFor(key)))
  })
}

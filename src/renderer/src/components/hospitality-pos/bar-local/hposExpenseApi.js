const PENDING_KEY = 'hpos:bar-local:expense.create'
const PENDING_VOID_KEY = 'hpos:bar-local:expense.void'

function readIntent(storage, key, command) {
  try {
    const value = JSON.parse(storage?.getItem(key) || 'null')
    if (!value || value.command !== command || !/^[0-9a-f-]{36}$/i.test(String(value.operation_id))
      || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return null
    return { command, operation_id: String(value.operation_id), payload: value.payload }
  } catch { return null }
}

/** @param {Storage | null | undefined} storage */
export function readPendingExpenseIntent(storage) {
  return readIntent(storage, PENDING_KEY, 'expense.create')
}

/** @param {Storage|null|undefined} storage */
export function readPendingExpenseVoidIntent(storage) {
  return readIntent(storage, PENDING_VOID_KEY, 'expense.void')
}

/** @param {{storage:Storage|null|undefined, command:(request:Record<string,unknown>)=>Promise<any>, payload:Record<string,unknown>, operationId?:string}} input */
export async function submitLocalExpense(input) {
  const storage = input.storage
  const saved = readPendingExpenseIntent(storage)
  if (saved && input.operationId && saved.operation_id !== input.operationId) {
    throw new Error('A saved expense submission is unresolved. Retry its saved operation before recording another expense.')
  }
  const intent = saved || {
    command: 'expense.create',
    operation_id: input.operationId || globalThis.crypto?.randomUUID?.(),
    payload: input.payload
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(intent.operation_id || ''))) throw new Error('A stable operation ID could not be created. No expense was submitted.')
  if (!saved) storage?.setItem(PENDING_KEY, JSON.stringify(intent))
  const result = await input.command(intent)
  if (result?.outcome === 'committed_local') storage?.removeItem(PENDING_KEY)
  else if (result?.outcome === 'refused') storage?.removeItem(PENDING_KEY)
  else throw new Error('The expense result is uncertain. Retry the saved submission with the same operation ID; do not record it again.')
  if (result.outcome === 'refused') throw new Error(result.error?.message || 'The local authority refused this expense. No entry was posted.')
  return result
}

/** @param {Storage|null|undefined} storage */
export function clearPendingExpenseIntent(storage) {
  storage?.removeItem(PENDING_KEY)
}

/** @param {{storage:Storage|null|undefined, requestApproval:(request:Record<string,unknown>)=>Promise<any>, command:(request:Record<string,unknown>)=>Promise<any>, payload?:Record<string,unknown>, pin?:string}} input */
export async function submitLocalExpenseVoid(input) {
  const storage = input.storage
  let intent = readPendingExpenseVoidIntent(storage)
  if (!intent) {
    if (!input.payload) throw new Error('Select the current posted expense before requesting a reversal.')
    intent = { command: 'expense.void', operation_id: globalThis.crypto?.randomUUID?.(), payload: input.payload }
    if (!/^[0-9a-f-]{36}$/i.test(String(intent.operation_id || ''))) throw new Error('A stable operation ID could not be created. No reversal was requested.')
    storage?.setItem(PENDING_VOID_KEY, JSON.stringify(intent))
  }
  if (!intent.payload.approval_id) {
    if (!/^\d{4,12}$/.test(String(input.pin || ''))) throw new Error('Enter a different manager’s 4–12 digit PIN to approve this reversal.')
    const approval = await input.requestApproval({ command: intent.command, payload: intent.payload, pin: input.pin, operation_id: intent.operation_id })
    if (!approval?.approval_id) throw new Error('Manager approval was not confirmed. The reversal was not submitted.')
    intent = { ...intent, payload: { ...intent.payload, approval_id: approval.approval_id } }
    storage?.setItem(PENDING_VOID_KEY, JSON.stringify(intent))
  }
  const result = await input.command(intent)
  if (result?.outcome === 'committed_local' || result?.outcome === 'refused') storage?.removeItem(PENDING_VOID_KEY)
  else throw new Error('The reversal result is uncertain. Retry the saved operation; do not create another reversal.')
  if (result.outcome === 'refused') throw new Error(result.error?.message || 'The local authority refused the reversal. No reversal was posted.')
  return result
}

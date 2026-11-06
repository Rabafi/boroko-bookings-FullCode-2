const PENDING_KEY = 'hpos:bar-local:customer.create'

/** @param {Storage|null|undefined} storage */
export function readPendingCustomerIntent(storage) {
  try {
    const value = JSON.parse(storage?.getItem(PENDING_KEY) || 'null')
    if (!value || value.command !== 'customer.create' || !/^[0-9a-f-]{36}$/i.test(String(value.operation_id))
      || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) return null
    return { command: 'customer.create', operation_id: String(value.operation_id), payload: value.payload }
  } catch { return null }
}

/** @param {{storage:Storage|null|undefined, command:(request:Record<string,unknown>)=>Promise<any>, payload?:Record<string,unknown>}} input */
export async function submitLocalCustomer(input) {
  const storage = input.storage
  const intent = readPendingCustomerIntent(storage) || {
    command: 'customer.create', operation_id: globalThis.crypto?.randomUUID?.(), payload: input.payload
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(intent.operation_id || ''))) throw new Error('A stable operation ID could not be created. No customer was saved.')
  if (!readPendingCustomerIntent(storage)) storage?.setItem(PENDING_KEY, JSON.stringify(intent))
  const result = await input.command(intent)
  if (result?.outcome === 'committed_local' || result?.outcome === 'refused') storage?.removeItem(PENDING_KEY)
  else throw new Error('The customer result is uncertain. Retry the saved submission; do not create the customer again.')
  if (result.outcome === 'refused') throw new Error(result.error?.message || 'The local authority refused this customer. No record was created.')
  return result
}

// @ts-check
/** @param {Record<string, unknown>|null|undefined} ticket */
/** @param {Record<string, unknown>|null|undefined} ticket */
export function normalizeMaintenanceTicket(ticket) {
  return {
    ...ticket,
    title: ticket?.title || ticket?.issue || '',
    issue: ticket?.issue || ticket?.title || '',
    description: ticket?.description || ticket?.notes || ''
  }
}

/** @param {{lodge_id: string} & Record<string, unknown>} payload */
/** @param {{lodge_id: string} & Record<string, unknown>} payload */
export async function createMaintenanceTicket(payload) {
  const { createMaintenance } = await import('./api')
  return createMaintenance(payload.lodge_id, payload)
}

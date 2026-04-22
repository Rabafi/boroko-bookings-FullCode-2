export function normalizeMaintenanceTicket(ticket) {
  return {
    ...ticket,
    title: ticket?.title || ticket?.issue || '',
    issue: ticket?.issue || ticket?.title || '',
    description: ticket?.description || ticket?.notes || ''
  }
}

export async function createMaintenanceTicket(payload) {
  const { createMaintenance } = await import('./api')
  return createMaintenance(payload.lodge_id, payload)
}

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

export async function updateMaintenanceTicket(id, lodgeId, payload) {
  const normalized = {
    ...payload,
    id,
    lodge_id: lodgeId,
    title: payload.title,
    issue: payload.issue || payload.title
  }
  const { createMaintenance } = await import('./api')
  return createMaintenance(lodgeId, normalized)
}

export async function resolveMaintenanceTicket(id, lodgeId) {
  const { resolveMaintenance } = await import('./api')
  return resolveMaintenance(lodgeId, { id })
}

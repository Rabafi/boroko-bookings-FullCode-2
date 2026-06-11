const MANAGER_SENDER_TYPES = new Set(['manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager'])

function clean(value) {
  return String(value || '').trim()
}

function parseMessages(value) {
  if (Array.isArray(value)) return value
  if (!value) return []
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function normalizeSupportSenderType(value) {
  const raw = clean(value).toLowerCase().replace(/[\s-]+/g, '_')
  if (!raw) return 'system'
  if (raw === 'frontdesk') return 'front_desk'
  if (raw === 'commandcentral') return 'command_central'
  return raw
}

export function supportMessageSide(message) {
  return MANAGER_SENDER_TYPES.has(normalizeSupportSenderType(message?.sender_type)) ? 'manager' : 'desk'
}

export function supportSenderName(message, fallback = 'Boroko user') {
  const type = normalizeSupportSenderType(message?.sender_type)
  const name = clean(message?.sender_name || message?.author_name || message?.name)
  if (name) return name
  if (MANAGER_SENDER_TYPES.has(type)) return 'Manager Mobile App'
  if (type === 'command_central') return 'Command Central'
  if (type === 'support') return 'Boroko Support'
  return fallback
}

export function supportSenderMeta(message) {
  const role = clean(message?.sender_role || message?.role)
  const surface = clean(message?.sender_surface || message?.surface)
  const type = normalizeSupportSenderType(message?.sender_type)
  if (role && surface) return `${role.replace(/_/g, ' ')} - ${surface.replace(/_/g, ' ')}`
  if (role) return role.replace(/_/g, ' ')
  if (surface) return surface.replace(/_/g, ' ')
  if (MANAGER_SENDER_TYPES.has(type)) return 'manager mobile app'
  if (type === 'front_desk' || type === 'desktop') return 'front desk desktop'
  if (type === 'command_central') return 'command central'
  return ''
}

function normalizeMessage(message, ticket, index) {
  const body = clean(message?.body || message?.message || message?.text)
  if (!body) return null
  const createdAt = message?.created_at || message?.createdAt || ticket?.created_at || new Date().toISOString()
  return {
    id: message?.id || `${ticket?.id || 'ticket'}-${index}`,
    ticket_id: message?.ticket_id || ticket?.id || null,
    lodge_id: message?.lodge_id || ticket?.lodge_id || null,
    body,
    sender_type: normalizeSupportSenderType(message?.sender_type || message?.type || message?.sender),
    sender_name: supportSenderName(message),
    sender_role: clean(message?.sender_role || message?.role),
    sender_user_id: clean(message?.sender_user_id || message?.user_id),
    sender_surface: clean(message?.sender_surface || message?.surface),
    metadata: message?.metadata && typeof message.metadata === 'object' ? message.metadata : {},
    created_at: createdAt
  }
}

function fallbackMessages(ticket) {
  const messages = []
  const requesterName = clean(ticket?.requester_name || ticket?.sender_name || ticket?.created_by_name) || 'Manager Mobile App'
  const requesterRole = clean(ticket?.requester_role || ticket?.sender_role) || 'manager'
  const requesterId = clean(ticket?.requester_user_id || ticket?.sender_user_id)
  if (clean(ticket?.description)) {
    messages.push({
      id: `${ticket?.id || 'ticket'}-request`,
      ticket_id: ticket?.id || null,
      lodge_id: ticket?.lodge_id || null,
      body: clean(ticket.description),
      sender_type: normalizeSupportSenderType(ticket?.requester_surface || 'manager_pwa'),
      sender_name: requesterName,
      sender_role: requesterRole,
      sender_user_id: requesterId,
      sender_surface: clean(ticket?.requester_surface) || 'manager_pwa',
      metadata: { fallback: true },
      created_at: ticket?.created_at || ticket?.updated_at || new Date().toISOString()
    })
  }
  if (clean(ticket?.admin_notes)) {
    messages.push({
      id: `${ticket?.id || 'ticket'}-desk`,
      ticket_id: ticket?.id || null,
      lodge_id: ticket?.lodge_id || null,
      body: clean(ticket.admin_notes),
      sender_type: 'desktop',
      sender_name: clean(ticket?.admin_name) || 'Front desk',
      sender_role: clean(ticket?.admin_role) || 'front desk',
      sender_user_id: clean(ticket?.admin_user_id),
      sender_surface: 'desktop',
      metadata: { fallback: true },
      created_at: ticket?.updated_at || ticket?.resolved_at || ticket?.created_at || new Date().toISOString()
    })
  }
  return messages
}

export function normalizeSupportMessages(ticket) {
  const normalized = parseMessages(ticket?.messages)
    .map((message, index) => normalizeMessage(message, ticket, index))
    .filter(Boolean)

  const messages = normalized.length > 0 ? normalized : fallbackMessages(ticket)
  return messages.sort((left, right) => {
    const leftTime = new Date(left.created_at || 0).getTime()
    const rightTime = new Date(right.created_at || 0).getTime()
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    return String(left.id || '').localeCompare(String(right.id || ''))
  })
}

export function normalizeSupportTicket(ticket) {
  const messages = normalizeSupportMessages(ticket)
  const firstManager = messages.find((message) => supportMessageSide(message) === 'manager')
  const latest = messages[messages.length - 1] || null
  return {
    ...ticket,
    messages,
    requester_name: clean(ticket?.requester_name) || firstManager?.sender_name || '',
    requester_role: clean(ticket?.requester_role) || firstManager?.sender_role || '',
    requester_user_id: clean(ticket?.requester_user_id) || firstManager?.sender_user_id || '',
    latest_message: latest,
    latest_message_body: latest?.body || '',
    latest_message_sender_name: latest?.sender_name || '',
    latest_message_sender_type: latest?.sender_type || ''
  }
}

export function normalizeSupportTickets(rows) {
  return (Array.isArray(rows) ? rows : []).map(normalizeSupportTicket)
}

export function buildSupportAuthorFromUser(user, surface = 'manager_pwa') {
  const normalizedSurface = normalizeSupportSenderType(surface)
  return {
    sender_type: normalizedSurface === 'desktop' ? 'desktop' : normalizedSurface,
    sender_name: clean(user?.name || user?.email) || (normalizedSurface === 'desktop' ? 'Front desk' : 'Manager Mobile App'),
    sender_role: clean(user?.role) || (normalizedSurface === 'desktop' ? 'front desk' : 'manager'),
    sender_user_id: clean(user?.id),
    sender_surface: normalizedSurface
  }
}

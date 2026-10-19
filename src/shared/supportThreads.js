// @ts-check
/** @typedef {Record<string, unknown> | null | undefined} SupportRecord */
/** @typedef {{id: unknown, ticket_id: unknown, lodge_id: unknown, body: string, sender_type: string, sender_name: string, sender_role: string, sender_user_id: string, sender_surface: string, metadata: unknown, created_at: unknown}} SupportMessage */
const MANAGER_SENDER_TYPES = new Set(['manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager'])

/** @param {unknown} value @returns {string} */
function clean(value) {
  return String(value || '').trim()
}

/** @param {unknown} value @returns {unknown[]} */
function parseMessages(value) {
  if (Array.isArray(value)) return /** @type {unknown[]} */ (value)
  if (!value) return []
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? /** @type {unknown[]} */ (parsed) : []
    } catch {
      return []
    }
  }
  return []
}

/** @param {unknown} value @returns {string} */
export function normalizeSupportSenderType(value) {
  const raw = clean(value).toLowerCase().replace(/[\s-]+/g, '_')
  if (!raw) return 'system'
  if (raw === 'frontdesk') return 'front_desk'
  if (raw === 'commandcentral') return 'command_central'
  return raw
}

/** @param {SupportRecord} message @returns {'manager' | 'desk'} */
export function supportMessageSide(message) {
  return MANAGER_SENDER_TYPES.has(normalizeSupportSenderType(message?.sender_type)) ? 'manager' : 'desk'
}

/** @param {SupportRecord} message @param {string} [fallback] @returns {string} */
export function supportSenderName(message, fallback = 'Tsa Bonno user') {
  const type = normalizeSupportSenderType(message?.sender_type)
  const name = clean(message?.sender_name || message?.author_name || message?.name)
  if (name) return name
  if (MANAGER_SENDER_TYPES.has(type)) return 'Manager Mobile App'
  if (type === 'command_central') return 'Command Central'
  if (type === 'support') return 'Tsa Bonno Support'
  return fallback
}

/** @param {SupportRecord} message @returns {string} */
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

/** @param {SupportRecord} message @param {SupportRecord} ticket @param {number} index @returns {SupportMessage | null} */
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

/** @param {SupportRecord} ticket @returns {SupportMessage[]} */
function fallbackMessages(ticket) {
  const ticketFields = /** @type {Record<string, unknown> | null | undefined} */ (ticket)
  const messages = []
  const requesterName = clean(ticketFields?.requester_name || ticketFields?.sender_name || ticketFields?.created_by_name) || 'Manager Mobile App'
  const requesterRole = clean(ticketFields?.requester_role || ticketFields?.sender_role) || 'manager'
  const requesterId = clean(ticketFields?.requester_user_id || ticketFields?.sender_user_id)
  if (clean(ticketFields?.description)) {
    messages.push({
      id: `${ticketFields?.id || 'ticket'}-request`,
      ticket_id: ticketFields?.id || null,
      lodge_id: ticketFields?.lodge_id || null,
      body: clean(ticketFields?.description),
      sender_type: normalizeSupportSenderType(ticketFields?.requester_surface || 'manager_pwa'),
      sender_name: requesterName,
      sender_role: requesterRole,
      sender_user_id: requesterId,
      sender_surface: clean(ticketFields?.requester_surface) || 'manager_pwa',
      metadata: { fallback: true },
      created_at: ticketFields?.created_at || ticketFields?.updated_at || new Date().toISOString()
    })
  }
  if (clean(ticketFields?.admin_notes)) {
    messages.push({
      id: `${ticketFields?.id || 'ticket'}-desk`,
      ticket_id: ticketFields?.id || null,
      lodge_id: ticketFields?.lodge_id || null,
      body: clean(ticketFields?.admin_notes),
      sender_type: 'desktop',
      sender_name: clean(ticketFields?.admin_name) || 'Front desk',
      sender_role: clean(ticketFields?.admin_role) || 'front desk',
      sender_user_id: clean(ticketFields?.admin_user_id),
      sender_surface: 'desktop',
      metadata: { fallback: true },
      created_at: ticketFields?.updated_at || ticketFields?.resolved_at || ticketFields?.created_at || new Date().toISOString()
    })
  }
  return messages
}

/** @param {SupportRecord} ticket @returns {SupportMessage[]} */
export function normalizeSupportMessages(ticket) {
  const ticketFields = /** @type {Record<string, unknown> | null | undefined} */ (ticket)
  const normalized = parseMessages(ticketFields?.messages)
    .map((message, index) => normalizeMessage(/** @type {SupportRecord} */ (message), ticket, index))
    .filter(Boolean)

  const messages = /** @type {SupportMessage[]} */ (normalized.length > 0 ? normalized : fallbackMessages(ticket))
  return messages.sort((left, right) => {
    const leftTime = new Date(/** @type {string | number} */ (left.created_at || 0)).getTime()
    const rightTime = new Date(/** @type {string | number} */ (right.created_at || 0)).getTime()
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
      return leftTime - rightTime
    }
    return String(left.id || '').localeCompare(String(right.id || ''))
  })
}

/** @param {SupportRecord} ticket @returns {Record<string, unknown>} */
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

/** @param {unknown} rows @returns {Record<string, unknown>[]} */
export function normalizeSupportTickets(rows) {
  return (Array.isArray(rows) ? /** @type {unknown[]} */ (rows) : []).map((row) => normalizeSupportTicket(/** @type {SupportRecord} */ (row)))
}

/** @param {SupportRecord} user @param {string} [surface] @returns {Record<string, string>} */
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

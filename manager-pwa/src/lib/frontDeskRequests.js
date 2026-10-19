// @ts-check
import { createSupportTicket } from './api'
import { buildSupportAuthorFromUser } from '@shared/supportThreads'

/** @param {{user: Record<string, unknown> & {lodge_id: string}, title?: unknown, description?: unknown, category?: unknown, priority?: unknown, source?: unknown, context?: unknown}} request @returns {Promise<Record<string, unknown>>} */
export async function sendFrontDeskRequest({
  user,
  title,
  description,
  category = 'Front Desk Request',
  priority = 'Normal',
  source = 'frontdesk-request',
  context: _context = {}
}) {
  if (!user?.lodge_id) throw new Error('No lodge is selected.')

  const cleanTitle = String(title || 'Manager desk message').trim()
  const cleanDescription = String(description || '').trim()
  if (!cleanDescription) throw new Error('Add a note for front desk first.')

  const author = buildSupportAuthorFromUser(user, 'manager_pwa')
  const rawResult = await createSupportTicket(user.lodge_id, {
    lodge_name: user.lodge_display_name,
    title: cleanTitle,
    description: cleanDescription,
    category,
    priority,
    source: source || 'manager_pwa',
    ...author,
    requester_name: author.sender_name,
    requester_role: author.sender_role,
    requester_user_id: author.sender_user_id,
    requester_surface: author.sender_surface
  })

  // Object spread boxes the original API result; its fields remain unknown.
  const result = Object(rawResult)
  const queued = rawResult === null || rawResult === undefined
    ? undefined
    : Reflect.get(result, 'queued', rawResult)
  return { ...result, queued: Boolean(queued) }
}

import { createSupportTicket } from './api'
import { buildSupportAuthorFromUser } from '@shared/supportThreads'

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
  const result = await createSupportTicket(user.lodge_id, {
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

  return { ...result, queued: Boolean(result?.queued) }
}

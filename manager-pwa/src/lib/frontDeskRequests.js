import { createSupportTicket } from './api'
import { buildPwaNotificationSourceKey, upsertPwaNotification } from './runtime'
import { buildSupportAuthorFromUser } from '@shared/supportThreads'

export async function sendFrontDeskRequest({
  user,
  title,
  description,
  category = 'Front Desk Request',
  priority = 'Normal',
  source = 'frontdesk-request',
  href = '/control',
  context = {}
}) {
  if (!user?.lodge_id) throw new Error('No lodge is selected.')

  const cleanTitle = String(title || 'Manager desk message').trim()
  const cleanDescription = String(description || '').trim()
  if (!cleanDescription) throw new Error('Add a note for front desk first.')

  const now = new Date().toISOString()
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

  const notification = upsertPwaNotification(user.lodge_id, {
    sourceKey: buildPwaNotificationSourceKey(
      source,
      cleanTitle,
      cleanDescription,
      category,
      priority,
      context.referenceId || context.kind || ''
    ),
    title: `Sent to front desk: ${cleanTitle}`,
    message: cleanDescription,
    tone: 'info',
    category: 'frontDeskRequest',
    href,
    meta: {
      requestTitle: cleanTitle,
      requestBody: cleanDescription,
      deskResponse: '',
      requestStatus: 'open',
      requestCategory: category,
      requestPriority: priority,
      requestContext: context,
      messages: [{
        id: `local-${now}`,
        body: cleanDescription,
        sender_type: author.sender_type,
        sender_name: author.sender_name,
        sender_role: author.sender_role,
        sender_user_id: author.sender_user_id,
        sender_surface: author.sender_surface,
        created_at: now
      }],
      sentAt: now,
      updatedAt: now
    }
  })

  return { ...result, notification, queued: Boolean(result?.queued) }
}

import { buildPwaNotificationSourceKey, getPwaNotificationSeenVersion, removePwaNotification, setPwaNotificationSeenVersion, upsertPwaNotification } from './runtime'
import { normalizeSupportMessages, supportMessageSide } from '@shared/supportThreads'

export function isFrontDeskConversation(request) {
  return String(request?.category || '').trim().toLowerCase() === 'front desk request'
}

export function getFrontDeskNotificationSourceKey(request) {
  if (request?.id) return `frontdesk-request:${request.id}`
  return getLegacyFrontDeskNotificationSourceKey(request)
}

function getLegacyFrontDeskNotificationSourceKey(request) {
  return buildPwaNotificationSourceKey(
    'frontdesk-request',
    request?.title || '',
    request?.description || '',
    request?.category || 'Front Desk Request',
    request?.priority || 'Normal'
  )
}

export function getFrontDeskNotificationVersion(request, latestDeskMessage = null) {
  const desk = latestDeskMessage || null
  return [
    request?.id || '',
    request?.status || 'open',
    desk?.id || '',
    desk?.created_at || '',
    desk?.body || '',
    request?.admin_notes || ''
  ].map((part) => String(part ?? '').trim()).join('|')
}

export function upsertFrontDeskNotification(lodgeId, request, { quiet = false } = {}) {
  if (!lodgeId || !isFrontDeskConversation(request)) return null
  const messages = normalizeSupportMessages(request)
  const latestMessage = messages[messages.length - 1] || null
  const latestDeskMessage = latestMessage && supportMessageSide(latestMessage) === 'desk' ? latestMessage : null
  const hasDeskResponse = latestDeskMessage || String(request.admin_notes || '').trim()
  if (!hasDeskResponse) return null

  const sourceKey = getFrontDeskNotificationSourceKey(request)
  const legacySourceKey = getLegacyFrontDeskNotificationSourceKey(request)
  if (legacySourceKey !== sourceKey) removePwaNotification(lodgeId, legacySourceKey)
  const version = getFrontDeskNotificationVersion(request, latestDeskMessage)
  const seen = getPwaNotificationSeenVersion(lodgeId, sourceKey)
  const alreadySeen = seen?.version === version
  const now = new Date().toISOString()
  const notification = upsertPwaNotification(lodgeId, {
    sourceKey,
    title: `Front desk updated: ${request.title}`,
    message: latestDeskMessage?.body || request.admin_notes || `Status changed to ${request.status || 'open'}.`,
    tone: request.status === 'resolved' || request.status === 'closed' ? 'info' : 'warn',
    category: 'frontDeskRequest',
    href: '/control',
    readAt: quiet || alreadySeen ? (seen?.seenAt || now) : null,
    meta: {
      requestId: request.id || null,
      requestTitle: request.title || '',
      requestBody: request.description || '',
      deskResponse: latestDeskMessage?.body || request.admin_notes || '',
      requestStatus: request.status || 'open',
      requestCategory: request.category || 'Front Desk Request',
      requestPriority: request.priority || 'Normal',
      notificationVersion: version,
      messages,
      sentAt: request.created_at || null,
      updatedAt: request.updated_at || null
    }
  })

  if (quiet || notification?.readAt) {
    setPwaNotificationSeenVersion(lodgeId, sourceKey, version)
  }
  return notification
}

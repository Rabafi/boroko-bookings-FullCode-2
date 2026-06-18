// ══════════════════════════════════════════════════════════════════════════════
// Admin Notification Inbox — backend domain
// ══════════════════════════════════════════════════════════════════════════════
import { state } from '../state.js'

function requireAdmin() {
  if (!state.adminDb) throw new Error('Admin client not initialised')
  return state.adminDb
}

// ── Create a notification ────────────────────────────────────────────────────
export async function createNotification(payload = {}) {
  if (!state.isOnline) return null
  const db = requireAdmin()
  const { data, error } = await db.rpc('create_admin_notification', {
    p_type: payload.type || 'info',
    p_title: payload.title,
    p_body: payload.body || null,
    p_entity_type: payload.entity_type || null,
    p_entity_id: payload.entity_id || null,
    p_lodge_id: payload.lodge_id || null,
    p_lodge_name: payload.lodge_name || null,
    p_action_url: payload.action_url || null,
    p_actor_email: payload.actor_email || state.currentUser?.email || null
  })
  if (error) throw error
  return data
}

// ── List notifications ───────────────────────────────────────────────────────
export async function getNotifications(filters = {}) {
  if (!state.isOnline) return []
  const db = requireAdmin()
  const { data, error } = await db.rpc('get_admin_notifications', {
    p_unread_only: filters.unread_only || false,
    p_type: filters.type || null,
    p_limit: filters.limit || 50,
    p_offset: filters.offset || 0
  })
  if (error) return []
  return data || []
}

// ── Get unread count ─────────────────────────────────────────────────────────
export async function getUnreadCount() {
  if (!state.isOnline) return 0
  const db = requireAdmin()
  const { data, error } = await db.rpc('get_admin_notification_count')
  if (error) return 0
  return data || 0
}

// ── Mark as read ─────────────────────────────────────────────────────────────
export async function markRead(ids = null) {
  if (!state.isOnline) return 0
  const db = requireAdmin()
  const { data, error } = await db.rpc('mark_admin_notifications_read', {
    p_ids: ids
  })
  if (error) return 0
  return data || 0
}

// ── Cleanup old notifications ────────────────────────────────────────────────
export async function cleanup(days = 90) {
  if (!state.isOnline) return 0
  const db = requireAdmin()
  const { data, error } = await db.rpc('cleanup_admin_notifications', {
    p_older_than_days: days
  })
  if (error) return 0
  return data || 0
}

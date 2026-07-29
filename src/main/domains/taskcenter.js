/**
 * Task Center domain — Admin Daily Tasks, Global Search, Bulk Actions, Fleet Deep Health, Release Rollout
 * Schema-corrected: settings=lodge/company, bookings=financial truth, real device_health_reports columns
 */
import { state } from '../state.js'
import { getRuntimeProductId } from '../../shared/productIdentity.js'

function adminRpc(name, params = {}) {
  return state.adminDb.rpc(name, params)
}

// ── Daily Task Center ──

export async function getAdminToday() {
  try {
    const { data, error } = await adminRpc('app_get_admin_today')
    if (error) throw error
    return data || { ok: true, summary: {}, overdue_bookings: [], trials_ending: [], failed_devices: [], urgent_tickets: [], lead_followups: [], recent_payments: [] }
  } catch (err) {
    console.error('[TaskCenter] getAdminToday error:', err)
    return { ok: false, error: err.message, summary: {}, overdue_bookings: [], trials_ending: [], failed_devices: [], urgent_tickets: [], lead_followups: [], recent_payments: [] }
  }
}

// ── Global Search ──

export async function globalSearch(query, limit = 20) {
  try {
    const { data, error } = await adminRpc('app_global_search', { p_query: query, p_limit: limit })
    if (error) throw error
    return data || { ok: true, results: [] }
  } catch (err) {
    console.error('[TaskCenter] globalSearch error:', err)
    return { ok: false, error: err.message, results: [] }
  }
}

// ── Bulk Actions (leads, tickets only — no financial mutations) ──

export async function bulkUpdateStatus(entityType, entityIds, newStatus) {
  try {
    const { data, error } = await adminRpc('app_bulk_update_status', {
      p_entity_type: entityType,
      p_entity_ids: entityIds,
      p_new_status: newStatus
    })
    if (error) throw error
    return data || { ok: true, updated: 0 }
  } catch (err) {
    console.error('[TaskCenter] bulkUpdateStatus error:', err)
    return { ok: false, error: err.message }
  }
}

export async function bulkDelete(entityType, entityIds) {
  try {
    const { data, error } = await adminRpc('app_bulk_delete', {
      p_entity_type: entityType,
      p_entity_ids: entityIds
    })
    if (error) throw error
    return data || { ok: true, deleted: 0 }
  } catch (err) {
    console.error('[TaskCenter] bulkDelete error:', err)
    return { ok: false, error: err.message }
  }
}

export async function bulkNotify(entityType, entityIds, message) {
  try {
    const { data, error } = await adminRpc('app_bulk_notify', {
      p_entity_type: entityType,
      p_entity_ids: entityIds,
      p_message: message
    })
    if (error) throw error
    return data || { ok: true, notified: 0 }
  } catch (err) {
    console.error('[TaskCenter] bulkNotify error:', err)
    return { ok: false, error: err.message }
  }
}

// ── Fleet Deep Health + Update Control ──

export async function getSyncQueueStatus() {
  try {
    const { data, error } = await adminRpc('app_get_sync_queue_status')
    if (error) throw error
    return data || { ok: true, devices: [], stale_count: 0, total_devices: 0 }
  } catch (err) {
    console.error('[TaskCenter] getSyncQueueStatus error:', err)
    return { ok: false, error: err.message, devices: [], stale_count: 0, total_devices: 0 }
  }
}

export async function pushUpdateNotification(version, message = '', force = false) {
  try {
    const { data, error } = await adminRpc('app_push_update_notification', {
      p_version: version,
      p_message: message,
      p_force: force
    })
    if (error) throw error
    return data || { ok: true }
  } catch (err) {
    console.error('[TaskCenter] pushUpdateNotification error:', err)
    return { ok: false, error: err.message }
  }
}

// ── Release Rollout Control ──

export async function createRelease(release) {
  try {
    const { data, error } = await adminRpc('app_create_product_release', {
      p_product_id: release.product_id || getRuntimeProductId(),
      p_version: release.version,
      p_release_notes: release.release_notes || '',
      p_channel: release.channel || 'stable',
      p_force_update: release.force_update || false,
      p_min_version: release.min_version || null
    })
    if (error) throw error
    return data || { ok: true }
  } catch (err) {
    console.error('[TaskCenter] createRelease error:', err)
    return { ok: false, error: err.message }
  }
}

export async function updateRelease(version, updates = {}) {
  try {
    const { data, error } = await adminRpc('app_update_product_release', {
      p_product_id: updates.product_id || getRuntimeProductId(),
      p_version: version,
      ...(updates.rollout_pct !== undefined ? { p_rollout_pct: updates.rollout_pct } : {}),
      ...(updates.status ? { p_status: updates.status } : {}),
      ...(updates.release_notes ? { p_release_notes: updates.release_notes } : {})
    })
    if (error) throw error
    return data || { ok: true }
  } catch (err) {
    console.error('[TaskCenter] updateRelease error:', err)
    return { ok: false, error: err.message }
  }
}

export async function checkUpdateAvailability(currentVersion, deviceId = null) {
  try {
    if (!state.supabase) {
      throw new Error('The client update service is not initialized')
    }
    const { data, error } = await state.supabase.rpc('app_check_product_update_availability', {
      p_product_id: getRuntimeProductId(),
      p_current_version: currentVersion,
      ...(deviceId ? { p_device_id: deviceId } : {})
    })
    if (error) throw error
    return data || { ok: true, update_available: false }
  } catch (err) {
    console.error('[TaskCenter] checkUpdateAvailability error:', err)
    return { ok: false, error: err.message, update_available: false }
  }
}

export async function getReleases(productId = getRuntimeProductId()) {
  const { data, error } = await adminRpc('app_get_product_releases', { p_product_id: productId })
  if (error) throw new Error(error.message)
  return data || []
}

// ── Cross-Surface Intelligence ──

function daysAgoIso(days) {
  return new Date(Date.now() - Number(days || 0) * 24 * 60 * 60 * 1000).toISOString()
}

async function safeAdminSelect(table, select, configure = (query) => query) {
  try {
    if (!state.adminDb) throw new Error('Admin database is not configured')
    const query = configure(state.adminDb.from(table).select(select))
    const { data, error } = await query
    if (error) throw error
    return { rows: Array.isArray(data) ? data : [], error: null }
  } catch (err) {
    return { rows: [], error: `${table}: ${err?.message || String(err)}` }
  }
}

function normalizeSurfaceClientType(value = '') {
  const raw = String(value || '').toLowerCase().replace(/[-\s]+/g, '_')
  if (raw === 'pos' || raw === 'legacypos' || raw === 'legacy_pos') return 'legacy_pos'
  if (raw === 'booking_site' || raw === 'bookings_site' || raw === 'online_booking') return 'bookings_site'
  if (raw === 'marketing' || raw === 'marketing_site') return 'marketing_site'
  return raw || 'unknown'
}

function maxIso(rows, fields = ['reported_at', 'last_seen_at', 'created_at', 'updated_at']) {
  let max = 0
  for (const row of rows || []) {
    for (const field of fields) {
      const value = row?.[field]
      if (!value) continue
      const time = new Date(value).getTime()
      if (Number.isFinite(time) && time > max) max = time
    }
  }
  return max ? new Date(max).toISOString() : null
}

function isRecent(value, days = 7) {
  if (!value) return false
  const time = new Date(value).getTime()
  return Number.isFinite(time) && time >= Date.now() - days * 24 * 60 * 60 * 1000
}

function countBy(rows, field, fallback = 'unknown') {
  const counts = {}
  for (const row of rows || []) {
    const key = String(row?.[field] || fallback).trim() || fallback
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function deviceIssueCount(rows = []) {
  return rows.reduce((sum, row) => {
    const failed = Number(row.failed_queue_count || 0)
    const unresolved = Number(row.unresolved_local_count || 0)
    const pending = Number(row.pending_queue_count || 0)
    const mismatch = String(row.reconciliation_state || '').toLowerCase() === 'mismatch' ? 1 : 0
    const stale = !isRecent(row.reported_at, 2) ? 1 : 0
    return sum + failed + unresolved + mismatch + stale + (pending > 25 ? 1 : 0)
  }, 0)
}

function buildSurface({ id, label, description, primaryMetric, secondaryMetric, rows = [], issues = 0, lastSeen = null, status = 'unknown', details = {} }) {
  const issueCount = Number(issues || 0)
  const inferredStatus = status !== 'unknown'
    ? status
    : issueCount > 0
      ? 'attention'
      : (Number(primaryMetric?.value || 0) > 0 || lastSeen ? 'healthy' : 'quiet')
  return {
    id,
    label,
    description,
    status: inferredStatus,
    issue_count: issueCount,
    last_seen_at: lastSeen || maxIso(rows),
    primary_metric: primaryMetric || { label: 'Records', value: rows.length },
    secondary_metric: secondaryMetric || null,
    details
  }
}

export async function getSurfaceIntelligence() {
  const since30 = daysAgoIso(30)
  const since90 = daysAgoIso(90)
  const [
    deviceRes,
    sessionRes,
    userRes,
    bookingRes,
    posRes,
    leadRes,
    ticketRes
  ] = await Promise.all([
    safeAdminSelect(
      'device_health_reports',
      'lodge_id, device_id, client_type, reported_at, pending_queue_count, failed_queue_count, unresolved_local_count, replay_auth_ready, last_successful_sync_at, reconciliation_state, top_fault_types, raw_summary',
      (query) => query.order('reported_at', { ascending: false }).limit(1000)
    ),
    safeAdminSelect(
      'app_sessions',
      'id, session_type, lodge_id, role, created_at, last_seen_at, expires_at, revoked_at',
      (query) => query.gte('last_seen_at', since30).order('last_seen_at', { ascending: false }).limit(1000)
    ),
    safeAdminSelect(
      'users',
      'id, lodge_id, role, status, pwa_enabled, last_desktop_sign_in_at, last_pwa_sign_in_at, last_activity_at, created_at',
      (query) => query.order('created_at', { ascending: false }).limit(1000)
    ),
    safeAdminSelect(
      'bookings',
      'id, lodge_id, status, payment_status, total_amount, amount_paid, source, created_at, check_in, check_out',
      (query) => query.gte('created_at', since90).order('created_at', { ascending: false }).limit(1000)
    ),
    safeAdminSelect(
      'pos_orders',
      'id, lodge_id, status, total, created_at, completed_at, payment_method, outlet_id',
      (query) => query.gte('created_at', since30).order('created_at', { ascending: false }).limit(1000)
    ),
    safeAdminSelect(
      'marketing_leads',
      'id, lodge_name, source, status, stage, created_at',
      (query) => query.gte('created_at', since90).order('created_at', { ascending: false }).limit(1000)
    ),
    safeAdminSelect(
      'support_tickets',
      'id, lodge_id, status, priority, category, created_at, updated_at',
      (query) => query.gte('created_at', since90).order('created_at', { ascending: false }).limit(1000)
    )
  ])

  const deviceRows = deviceRes.rows.map((row) => ({ ...row, client_type: normalizeSurfaceClientType(row.client_type) }))
  const sessions = sessionRes.rows
  const users = userRes.rows
  const bookings = bookingRes.rows
  const posOrders = posRes.rows
  const leads = leadRes.rows
  const tickets = ticketRes.rows
  const errors = [deviceRes, sessionRes, userRes, bookingRes, posRes, leadRes, ticketRes]
    .map((res) => res.error)
    .filter(Boolean)

  const desktopDevices = deviceRows.filter((row) => row.client_type === 'desktop')
  const legacyDevices = deviceRows.filter((row) => ['legacy_pos', 'pos'].includes(row.client_type))
  const pwaDevices = deviceRows.filter((row) => row.client_type === 'pwa')
  const desktopSessions = sessions.filter((row) => row.session_type === 'desktop' && !row.revoked_at)
  const pwaSessions = sessions.filter((row) => row.session_type === 'pwa' && !row.revoked_at)
  const pwaUsers = users.filter((row) => row.pwa_enabled === true && String(row.status || 'active') === 'active')
  const recentPwaUsers = pwaUsers.filter((row) => isRecent(row.last_pwa_sign_in_at, 30))
  const onlineBookings = bookings.filter((row) => !['desktop', ''].includes(String(row.source || '').toLowerCase()))
  const pendingBookings = bookings.filter((row) => String(row.status || '').toLowerCase() === 'pending')
  const unpaidBookings = bookings.filter((row) => ['unpaid', 'partial', ''].includes(String(row.payment_status || '').toLowerCase()))
  const activeTickets = tickets.filter((row) => ['open', 'in_progress', 'acknowledged'].includes(String(row.status || '').toLowerCase()))
  const hotLeads = leads.filter((row) => !['won', 'lost', 'dropped'].includes(String(row.stage || row.status || '').toLowerCase()))

  const surfaces = [
    buildSurface({
      id: 'desktop',
      label: 'Desktop App',
      description: 'Installed lodge desktop clients, sync health, and active office sessions.',
      rows: [...desktopDevices, ...desktopSessions],
      issues: deviceIssueCount(desktopDevices),
      primaryMetric: { label: 'Reporting devices', value: desktopDevices.length },
      secondaryMetric: { label: 'Active sessions in 30d', value: desktopSessions.length },
      details: {
        reconciliation: countBy(desktopDevices, 'reconciliation_state'),
        sessions_by_role: countBy(desktopSessions, 'role')
      }
    }),
    buildSurface({
      id: 'legacy_pos',
      label: 'Legacy POS',
      description: 'POS terminals, offline queue pressure, and recent bar/restaurant sales activity.',
      rows: [...legacyDevices, ...posOrders],
      issues: deviceIssueCount(legacyDevices),
      primaryMetric: { label: 'POS orders in 30d', value: posOrders.length },
      secondaryMetric: { label: 'Reporting POS devices', value: legacyDevices.length },
      details: {
        order_status: countBy(posOrders, 'status'),
        payment_methods: countBy(posOrders, 'payment_method'),
        sales_total: posOrders.reduce((sum, row) => sum + Number(row.total || 0), 0)
      }
    }),
    buildSurface({
      id: 'pwa',
      label: 'Manager PWA',
      description: 'Mobile manager access, PWA sessions, and enabled staff coverage.',
      rows: [...pwaDevices, ...pwaSessions, ...pwaUsers],
      issues: deviceIssueCount(pwaDevices),
      primaryMetric: { label: 'PWA-enabled users', value: pwaUsers.length },
      secondaryMetric: { label: 'Recent PWA users', value: recentPwaUsers.length },
      details: {
        sessions_30d: pwaSessions.length,
        users_by_role: countBy(pwaUsers, 'role')
      }
    }),
    buildSurface({
      id: 'bookings_site',
      label: 'Bookings Site',
      description: 'Website/online booking intake, pending requests, and unpaid booking exposure.',
      rows: onlineBookings.length ? onlineBookings : bookings,
      issues: pendingBookings.length,
      primaryMetric: { label: 'Online bookings in 90d', value: onlineBookings.length },
      secondaryMetric: { label: 'Pending review', value: pendingBookings.length },
      details: {
        booking_sources: countBy(bookings, 'source'),
        unpaid_or_partial: unpaidBookings.length
      }
    }),
    buildSurface({
      id: 'marketing_site',
      label: 'Marketing Site',
      description: 'Lead capture, campaign sources, and active sales pipeline intake.',
      rows: leads,
      issues: hotLeads.filter((row) => !isRecent(row.created_at, 14)).length,
      primaryMetric: { label: 'Leads in 90d', value: leads.length },
      secondaryMetric: { label: 'Open pipeline', value: hotLeads.length },
      details: {
        lead_sources: countBy(leads, 'source'),
        lead_stages: countBy(leads, 'stage')
      }
    }),
    buildSurface({
      id: 'support',
      label: 'Support Desk',
      description: 'Client issues, bugs, upgrade requests, and follow-up workload.',
      rows: tickets,
      issues: activeTickets.length,
      primaryMetric: { label: 'Tickets in 90d', value: tickets.length },
      secondaryMetric: { label: 'Active tickets', value: activeTickets.length },
      details: {
        by_status: countBy(tickets, 'status'),
        by_priority: countBy(tickets, 'priority'),
        by_category: countBy(tickets, 'category')
      }
    })
  ]

  return {
    ok: errors.length === 0,
    generated_at: new Date().toISOString(),
    errors,
    surfaces,
    totals: {
      reporting_devices: deviceRows.length,
      sessions_30d: sessions.length,
      pwa_enabled_users: pwaUsers.length,
      bookings_90d: bookings.length,
      pos_orders_30d: posOrders.length,
      leads_90d: leads.length,
      tickets_90d: tickets.length,
      attention_count: surfaces.reduce((sum, surface) => sum + Number(surface.issue_count || 0), 0)
    }
  }
}

// @ts-check
/**
 * Automation domain — Notification rules, event dispatch, evaluation
 */
import { state } from '../state.js'

/** @param {string} name @param {Record<string, unknown>} [params] @returns {Promise<unknown>} */
function adminRpc(name, params = {}) {
  return state.adminDb.rpc(name, params)
}

/** @returns {Promise<unknown>} */
export async function getNotificationRules() {
  try {
    const { data, error } = await adminRpc('app_get_notification_rules')
    if (error) throw error
    return data || []
  } catch (err) {
    console.error('[Automation] getNotificationRules error:', err)
    return []
  }
}

/** @param {unknown} rule @returns {Promise<unknown>} */
export async function upsertNotificationRule(rule) {
  try {
    // Type-only view for the existing property reads; this does not validate
    // values supplied at the IPC boundary.
    const fields = /** @type {Record<string, unknown>} */ (rule)
    const { data, error } = await adminRpc('app_upsert_notification_rule', {
      p_rule_key: fields.rule_key,
      p_label: fields.label,
      p_description: fields.description || '',
      p_enabled: fields.enabled !== false,
      p_severity: fields.severity || 'info',
      p_channel: fields.channel || 'inbox',
      p_cooldown_minutes: fields.cooldown_minutes || 60
    })
    if (error) throw error
    return data || { ok: true }
  } catch (err) {
    console.error('[Automation] upsertNotificationRule error:', err)
    return { ok: false, error: /** @type {Record<string, unknown>} */ (err).message }
  }
}

/** @param {unknown} ruleKey @returns {Promise<unknown>} */
export async function evaluateRule(ruleKey) {
  try {
    const { data, error } = await adminRpc('app_evaluate_notification_rule', { p_rule_key: ruleKey })
    if (error) throw error
    return data || { ok: false }
  } catch (err) {
    console.error('[Automation] evaluateRule error:', err)
    return { ok: false, error: /** @type {Record<string, unknown>} */ (err).message }
  }
}

/** @returns {Promise<unknown>} */
export async function evaluateAllRules() {
  try {
    const { data, error } = await adminRpc('app_evaluate_all_notification_rules')
    if (error) throw error
    return data || { ok: true, results: [] }
  } catch (err) {
    console.error('[Automation] evaluateAllRules error:', err)
    return { ok: false, error: /** @type {Record<string, unknown>} */ (err).message, results: [] }
  }
}

/** @param {unknown} [options] @returns {Promise<unknown>} */
export async function getNotificationEvents(options = {}) {
  const { limit = 50, offset = 0, ruleKey = null, dispatched = null } = /** @type {Record<string, unknown>} */ (options)
  try {
    const { data, error } = await adminRpc('app_get_notification_events', {
      p_limit: limit,
      p_offset: offset,
      ...(ruleKey ? { p_rule_key: ruleKey } : {}),
      ...(dispatched !== null ? { p_dispatched: dispatched } : {})
    })
    if (error) throw error
    return data || []
  } catch (err) {
    console.error('[Automation] getNotificationEvents error:', err)
    return []
  }
}

/** @returns {Promise<unknown>} */
export async function getNotificationEventSummary() {
  try {
    const { data, error } = await adminRpc('app_get_notification_event_summary')
    if (error) throw error
    return data || { total_events: 0, undispatched: 0, active_rules: 0, events_by_rule_7d: {} }
  } catch (err) {
    console.error('[Automation] getNotificationEventSummary error:', err)
    return { total_events: 0, undispatched: 0, active_rules: 0, events_by_rule_7d: {} }
  }
}

/** @param {unknown} eventIds @returns {Promise<unknown>} */
export async function markEventsDispatched(eventIds) {
  try {
    const { data, error } = await adminRpc('app_mark_events_dispatched', { p_event_ids: eventIds })
    if (error) throw error
    return data || { ok: true }
  } catch (err) {
    console.error('[Automation] markEventsDispatched error:', err)
    return { ok: false, error: /** @type {Record<string, unknown>} */ (err).message }
  }
}

import { randomUUID } from 'crypto'
import { state } from '../state.js'
import { readCache, writeCache, queueOperation, dedupePromise } from './infrastructure.js'
import { checkOnline } from './connectivity.js'
import { isFnbOptionalModuleKey } from '../../shared/fnbModules.js'

const FNB_PREFS_CACHE = 'fnb-module-preferences'
// Cache keys are scoped by lodge + outlet + date/range: offline data for one
// outlet or period must never render under another.
const fnbTodayCacheKey = (lodgeId, outletId) => `fnb-today:${lodgeId}:${outletId || 'all'}`
const fnbReportCacheKey = (lodgeId, start, end, outletId) => `fnb-consolidated-report:${lodgeId}:${start}:${end}:${outletId || 'all'}`
const fnbDemandCacheKey = (lodgeId, date, outletId) => `fnb-demand-recommendations:${lodgeId}:${date}:${outletId || 'all'}`

function lodgeIdOrThrow(override = null) {
  const lodgeId = override || state.lodgeId
  if (!lodgeId) throw new Error('No lodge selected')
  return lodgeId
}

function failClosedOfflineError(feature = 'This F&B action') {
  return new Error(`${feature} needs an online connection. Your last confirmed data is shown; reconnect and retry.`)
}

function normalizeRpcError(error, fallback) {
  const message = String(error?.message || error || fallback || 'Request failed.')
  const err = new Error(message)
  err.cause = error
  // Preserve machine-readable codes surfaced by PostgREST/RPC bodies.
  if (error?.code) err.code = error.code
  if (error?.details) err.details = error.details
  return err
}

// ── Module preferences: online-only, server-confirmed ─────────────────────
// Offline activation is unavailable by product decision. The renderer keeps
// the last confirmed state and shows a retry message.

async function _getFnbModulePreferences(lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const online = await checkOnline().catch(() => false)
  if (!online) {
    const cached = readCache(FNB_PREFS_CACHE)
    if (Array.isArray(cached) && cached.length > 0) {
      const stale = [...cached]
      stale._source = 'cache'
      stale._complete = false
      return { success: true, lodge_id: lodgeId, modules: cached, source: 'cache', offline: true }
    }
    throw failClosedOfflineError('F&B module settings')
  }
  const { data, error } = await state.supabase.rpc('get_fnb_module_preferences', { p_lodge_id: lodgeId })
  if (error) throw normalizeRpcError(error, 'Could not load F&B module settings.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not load F&B module settings.')
    err.code = data.code
    throw err
  }
  const modules = Array.isArray(data?.modules) ? data.modules : []
  writeCache(FNB_PREFS_CACHE, modules)
  return { success: true, lodge_id: data?.lodge_id || lodgeId, modules, source: 'server' }
}

export const getFnbModulePreferences = (...args) =>
  dedupePromise('getFnbModulePreferences', () => _getFnbModulePreferences(...args))

export function getCachedFnbModulePreferences() {
  const cached = readCache(FNB_PREFS_CACHE)
  return Array.isArray(cached) ? cached : []
}

export async function setFnbModulePreference(moduleKey, enabled, expectedVersion = null, lodgeIdArg = null) {
  const key = String(moduleKey || '')
  if (!isFnbOptionalModuleKey(key)) throw new Error('Unknown F&B module.')
  if (typeof enabled !== 'boolean') throw new Error('A target state (enabled/disabled) is required.')
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const online = await checkOnline().catch(() => false)
  if (!online) throw failClosedOfflineError('F&B module activation')
  const { data, error } = await state.supabase.rpc('set_fnb_module_preference', {
    p_lodge_id: lodgeId,
    p_module_key: key,
    p_enabled: enabled,
    p_expected_version: expectedVersion
  })
  if (error) throw normalizeRpcError(error, 'Could not update the F&B module.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not update the F&B module.')
    err.code = data.code
    err.blockers = data.blockers
    err.server_version = data.server_version
    err.server_enabled = data.server_enabled
    throw err
  }
  // Refresh the confirmed cache on success.
  try {
    await _getFnbModulePreferences(lodgeId)
  } catch {
    // Cache refresh is best-effort; the authoritative result is returned.
  }
  return data
}

// ── Today + consolidated reads (server-confirmed, cache-labelled) ──────────

async function _getFnbToday(outletId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const cacheKey = fnbTodayCacheKey(lodgeId, outletId)
  try {
    const { data, error } = await state.supabase.rpc('get_fnb_today', {
      p_lodge_id: lodgeId,
      p_outlet_id: outletId || null
    })
    if (error) throw error
    if (data && data.success === false) throw new Error(data.error || 'Today view is unavailable.')
    writeCache(cacheKey, data)
    return { ...data, _source: 'server', _complete: true }
  } catch (e) {
    const cached = readCache(cacheKey)
    if (cached && typeof cached === 'object') {
      return { ...cached, _source: 'cache', _complete: false, _stale_error: String(e?.message || e) }
    }
    throw normalizeRpcError(e, 'Today view is unavailable. Reconnect and retry.')
  }
}

// Dedupe key includes outlet + lodge so concurrent requests for different
// outlets never share one in-flight promise.
export const getFnbToday = (outletId = null, lodgeIdArg = null) =>
  dedupePromise(`getFnbToday:${lodgeIdArg || state.lodgeId}:${outletId || 'all'}`, () => _getFnbToday(outletId, lodgeIdArg))

export async function getFnbConsolidatedReport(start, end, outletId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  if (!start || !end) throw new Error('A valid date range is required.')
  const cacheKey = fnbReportCacheKey(lodgeId, start, end, outletId)
  try {
    const { data, error } = await state.supabase.rpc('get_fnb_consolidated_report', {
      p_lodge_id: lodgeId,
      p_start: start,
      p_end: end,
      p_outlet_id: outletId || null
    })
    if (error) throw error
    if (data && data.success === false) throw new Error(data.error || 'Consolidated report is unavailable.')
    writeCache(cacheKey, data)
    // Complete only when every money section is server-certified; a cached or
    // partially unavailable section must never read as financial truth.
    const complete = data?.sales_complete === true && data?.purchase_cost_complete === true && data?.expense_complete === true
    return { ...data, _source: 'server', _complete: complete }
  } catch (e) {
    const cached = readCache(cacheKey)
    if (cached && typeof cached === 'object') {
      return { ...cached, _source: 'cache', _complete: false, _stale_error: String(e?.message || e) }
    }
    throw normalizeRpcError(e, 'Consolidated report is unavailable. Reconnect and retry.')
  }
}

// ── Room service (offline-eligible create, online transitions) ─────────────

export async function createFnbRoomServiceOrder(payload = {}, operationId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const opId = operationId || randomUUID()
  const body = { ...(payload || {}) }
  const online = await checkOnline().catch(() => false)
  if (!online) {
    queueOperation('rpc', 'create_fnb_room_service_order', {
      p_lodge_id: lodgeId,
      p_payload: body,
      p_operation_id: opId
    }, null, { _queue_id: `fnb-room-service-${opId}` })
    return { success: true, offline: true, operation_id: opId, _pending: true }
  }
  const { data, error } = await state.supabase.rpc('create_fnb_room_service_order', {
    p_lodge_id: lodgeId,
    p_payload: body,
    p_operation_id: opId
  })
  if (error) throw normalizeRpcError(error, 'Could not create the room-service order.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not create the room-service order.')
    err.code = data.code
    throw err
  }
  return data
}

export async function updateFnbRoomServiceStatus(orderId, toStatus, payload = {}, operationId = null) {
  if (!orderId) throw new Error('An order ID is required.')
  const online = await checkOnline().catch(() => false)
  // Status transitions change live fulfilment state; keep them online-only so
  // two devices cannot fork a delivery queue while partitioned.
  if (!online) throw failClosedOfflineError('Room-service status changes')
  // folio_posted is server-derived on delivery; strip any client value.
  const { folio_posted: _stripFolio, ...safePayload } = payload || {}
  const { data, error } = await state.supabase.rpc('update_fnb_room_service_status', {
    p_order_id: orderId,
    p_to_status: toStatus,
    p_payload: safePayload,
    p_operation_id: operationId || null
  })
  if (error) throw normalizeRpcError(error, 'Could not update the room-service order.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not update the room-service order.')
    err.code = data.code
    err.status = data.status
    throw err
  }
  return data
}

// ── Meal plans (offline-eligible, same RPC + stable key on replay) ──────────

export async function createFnbMealEntitlement(payload = {}, operationId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const opId = operationId || randomUUID()
  const online = await checkOnline().catch(() => false)
  if (!online) {
    queueOperation('rpc', 'create_fnb_meal_entitlement', {
      p_lodge_id: lodgeId,
      p_payload: payload || {},
      p_operation_id: opId
    }, null, { _queue_id: `fnb-meal-entitlement-${opId}` })
    return { success: true, offline: true, operation_id: opId, _pending: true }
  }
  const { data, error } = await state.supabase.rpc('create_fnb_meal_entitlement', {
    p_lodge_id: lodgeId,
    p_payload: payload || {},
    p_operation_id: opId
  })
  if (error) throw normalizeRpcError(error, 'Could not grant the meal plan.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not grant the meal plan.')
    err.code = data.code
    throw err
  }
  return data
}

export async function redeemFnbMeal(entitlementId, payload = {}, operationId = null) {
  if (!entitlementId) throw new Error('An entitlement ID is required.')
  const opId = operationId || randomUUID()
  // inventory_consumed / folio_reference are server-derived and always stored
  // as false / null. Strip any client-supplied values so a compromised or
  // stale renderer can never claim effects that never happened.
  const { inventory_consumed: _stripInventory, folio_reference: _stripFolio, ...safePayload } = payload || {}
  const online = await checkOnline().catch(() => false)
  if (!online) {
    queueOperation('rpc', 'redeem_fnb_meal', {
      p_entitlement_id: entitlementId,
      p_payload: safePayload,
      p_operation_id: opId
    }, null, { _queue_id: `fnb-meal-redeem-${opId}` })
    return { success: true, offline: true, operation_id: opId, _pending: true }
  }
  const { data, error } = await state.supabase.rpc('redeem_fnb_meal', {
    p_entitlement_id: entitlementId,
    p_payload: safePayload,
    p_operation_id: opId
  })
  if (error) throw normalizeRpcError(error, 'Could not redeem the meal.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not redeem the meal.')
    err.code = data.code
    err.remaining_covers = data.remaining_covers
    throw err
  }
  return data
}

// ── Food safety (offline-eligible logs, online close) ───────────────────────

export async function createFnbTemperatureLog(payload = {}, operationId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const opId = operationId || randomUUID()
  const online = await checkOnline().catch(() => false)
  if (!online) {
    queueOperation('rpc', 'create_fnb_temperature_log', {
      p_lodge_id: lodgeId,
      p_payload: payload || {},
      p_operation_id: opId
    }, null, { _queue_id: `fnb-temp-${opId}` })
    return { success: true, offline: true, operation_id: opId, _pending: true }
  }
  const { data, error } = await state.supabase.rpc('create_fnb_temperature_log', {
    p_lodge_id: lodgeId,
    p_payload: payload || {},
    p_operation_id: opId
  })
  if (error) throw normalizeRpcError(error, 'Could not record the temperature.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not record the temperature.')
    err.code = data.code
    throw err
  }
  return data
}

export async function closeFnbCorrectiveAction(actionId, closeNote, operationId = null) {
  if (!actionId) throw new Error('A corrective-action ID is required.')
  const online = await checkOnline().catch(() => false)
  if (!online) throw failClosedOfflineError('Corrective-action close-out')
  const { data, error } = await state.supabase.rpc('close_fnb_corrective_action', {
    p_action_id: actionId,
    p_close_note: closeNote,
    p_operation_id: operationId || null
  })
  if (error) throw normalizeRpcError(error, 'Could not close the corrective action.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not close the corrective action.')
    err.code = data.code
    throw err
  }
  return data
}

// ── Invoice matching (offline-eligible capture, online approval/handoff) ────

export async function captureFnbSupplierInvoice(payload = {}, operationId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const opId = operationId || randomUUID()
  const online = await checkOnline().catch(() => false)
  if (!online) {
    queueOperation('rpc', 'capture_fnb_supplier_invoice', {
      p_lodge_id: lodgeId,
      p_payload: payload || {},
      p_operation_id: opId
    }, null, { _queue_id: `fnb-invoice-${opId}` })
    return { success: true, offline: true, operation_id: opId, _pending: true }
  }
  const { data, error } = await state.supabase.rpc('capture_fnb_supplier_invoice', {
    p_lodge_id: lodgeId,
    p_payload: payload || {},
    p_operation_id: opId
  })
  if (error) throw normalizeRpcError(error, 'Could not capture the supplier invoice.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not capture the supplier invoice.')
    err.code = data.code
    throw err
  }
  return data
}

export async function approveFnbInvoiceMatch(invoiceId, approve, note = null, operationId = null) {
  const online = await checkOnline().catch(() => false)
  if (!online) throw failClosedOfflineError('Invoice variance approval')
  const { data, error } = await state.supabase.rpc('approve_fnb_invoice_match', {
    p_invoice_id: invoiceId,
    p_approve: approve,
    p_note: note,
    p_operation_id: operationId || null
  })
  if (error) throw normalizeRpcError(error, 'Could not decide the invoice match.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not decide the invoice match.')
    err.code = data.code
    throw err
  }
  return data
}

export async function handoffFnbInvoiceToAccounting(invoiceId, operationId = null) {
  const online = await checkOnline().catch(() => false)
  if (!online) throw failClosedOfflineError('Accounting handoff')
  const { data, error } = await state.supabase.rpc('handoff_fnb_invoice_to_accounting', {
    p_invoice_id: invoiceId,
    p_operation_id: operationId || null
  })
  if (error) throw normalizeRpcError(error, 'Could not hand the invoice to accounting.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not hand the invoice to accounting.')
    err.code = data.code
    throw err
  }
  return data
}

// ── Demand planning (advisory read + explicit online approval) ──────────────

export async function getFnbDemandRecommendations(date, outletId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const cacheKey = fnbDemandCacheKey(lodgeId, date, outletId)
  try {
    const { data, error } = await state.supabase.rpc('get_fnb_demand_recommendations', {
      p_lodge_id: lodgeId,
      p_date: date,
      p_outlet_id: outletId || null
    })
    if (error) throw error
    if (data && data.success === false) throw new Error(data.error || 'Demand planning is unavailable.')
    writeCache(cacheKey, data)
    return { ...data, _source: 'server', _complete: true }
  } catch (e) {
    const cached = readCache(cacheKey)
    if (cached && typeof cached === 'object') {
      return { ...cached, _source: 'cache', _complete: false, _stale_error: String(e?.message || e) }
    }
    throw normalizeRpcError(e, 'Demand planning is unavailable. Reconnect and retry.')
  }
}

// ── Operational queues (server reads; no local estimates) ───────────────────

async function fnbRead(rpc, args, label) {
  const { data, error } = await state.supabase.rpc(rpc, args)
  if (error) throw normalizeRpcError(error, `${label} is unavailable. Reconnect and retry.`)
  if (data && data.success === false) {
    const err = new Error(data.error || `${label} is unavailable.`)
    err.code = data.code
    throw err
  }
  return data
}

export async function getFnbRoomServiceQueue(outletId = null, includeClosed = false, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  return fnbRead('get_fnb_room_service_queue', {
    p_lodge_id: lodgeId,
    p_outlet_id: outletId || null,
    p_include_closed: includeClosed,
    p_limit: 50
  }, 'Room-service queue')
}

export async function getFnbMealEntitlements(includeDepleted = false, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  return fnbRead('get_fnb_meal_entitlements', {
    p_lodge_id: lodgeId,
    p_include_depleted: includeDepleted,
    p_limit: 50
  }, 'Meal plans')
}

export async function getFnbFoodSafetyTemplates(lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  return fnbRead('get_fnb_food_safety_templates', { p_lodge_id: lodgeId }, 'Check templates')
}

export async function getFnbCorrectiveQueue(includeClosed = false, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  return fnbRead('get_fnb_corrective_queue', {
    p_lodge_id: lodgeId,
    p_include_closed: includeClosed,
    p_limit: 50
  }, 'Corrective actions')
}

export async function getFnbSupplierInvoices(lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  return fnbRead('get_fnb_supplier_invoices', { p_lodge_id: lodgeId, p_limit: 50 }, 'Supplier invoices')
}

export async function createFnbFoodSafetyTemplate(payload = {}, operationId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const online = await checkOnline().catch(() => false)
  if (!online) throw failClosedOfflineError('Check templates')
  const { data, error } = await state.supabase.rpc('create_fnb_food_safety_template', {
    p_lodge_id: lodgeId,
    p_payload: payload || {},
    p_operation_id: operationId || randomUUID()
  })
  if (error) throw normalizeRpcError(error, 'Could not create the check template.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not create the check template.')
    err.code = data.code
    throw err
  }
  return data
}

export async function approveFnbDemandRecommendation(recommendationKey, action, payload = {}, operationId = null, lodgeIdArg = null) {
  const lodgeId = lodgeIdOrThrow(lodgeIdArg)
  const online = await checkOnline().catch(() => false)
  if (!online) throw failClosedOfflineError('Demand approvals')
  const { data, error } = await state.supabase.rpc('approve_fnb_demand_recommendation', {
    p_lodge_id: lodgeId,
    p_recommendation_key: recommendationKey,
    p_action: action,
    p_payload: payload || {},
    p_operation_id: operationId || randomUUID()
  })
  if (error) throw normalizeRpcError(error, 'Could not approve the recommendation.')
  if (data && data.success === false) {
    const err = new Error(data.error || 'Could not approve the recommendation.')
    err.code = data.code
    throw err
  }
  return data
}

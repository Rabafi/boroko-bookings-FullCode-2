import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { logActivity, queueOperation, readCache, writeCache, dedupePromise } from './infrastructure.js';

async function _getRateCalendar(roomTypeId, startDate, endDate) {
  const cacheKey = `rate-calendar:${roomTypeId}:${startDate}:${endDate}`;
  if (!state.isOnline) return readCache(cacheKey) || { entries: [], restrictions: [] };
  try {
    const { data, error } = await state.supabase.rpc('get_rate_calendar', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_start_date: startDate,
      p_end_date: endDate
    });
    if (error) throw error;
    const result = data || { entries: [], restrictions: [] };
    writeCache(cacheKey, result);
    return result;
  } catch (err) {
    const cached = readCache(cacheKey);
    if (cached) return cached;
    throw new Error(err?.message || 'Failed to load rate calendar');
  }
}

async function _setRateCalendarEntry(roomTypeId, date, amount, currency) {
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('set_rate_calendar_entry', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_date: date,
      p_amount: Number(amount) || 0,
      p_currency: currency || 'BWP'
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not set rate calendar entry');
    logActivity('rate_calendar_entry_set', `Rate set for ${date} room type ${roomTypeId}`);
    return data;
  } else {
    queueOperation('rpc', 'set_rate_calendar_entry', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_date: date,
      p_amount: Number(amount) || 0,
      p_currency: currency || 'BWP'
    });
    return { success: true, _queued: true };
  }
}

async function _setRateCalendarBulk(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('Entries array is required');
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('set_rate_calendar_bulk', {
      p_lodge_id: state.lodgeId,
      p_entries: JSON.stringify(entries)
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not set bulk rates');
    logActivity('rate_calendar_bulk_set', `Set ${data?.count || entries.length} rate entries`);
    return data;
  } else {
    queueOperation('rpc', 'set_rate_calendar_bulk', {
      p_lodge_id: state.lodgeId,
      p_entries: JSON.stringify(entries)
    });
    return { success: true, _queued: true };
  }
}

async function _setRateRestriction(roomTypeId, date, restrictions) {
  if (state.isOnline) {
    const { data, error } = await state.supabase.rpc('set_rate_restriction', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_date: date,
      p_restrictions: restrictions
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not set rate restriction');
    logActivity('rate_restriction_set', `Restrictions set for ${date}`);
    return data;
  } else {
    queueOperation('rpc', 'set_rate_restriction', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_date: date,
      p_restrictions: restrictions
    });
    return { success: true, _queued: true };
  }
}

async function _getRateConflicts(roomTypeId, startDate, endDate) {
  if (!state.isOnline) return { multiple_entries_per_day: [], days_without_restrictions: [] };
  try {
    const { data, error } = await state.supabase.rpc('get_rate_conflicts', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_start_date: startDate,
      p_end_date: endDate
    });
    if (error) throw error;
    return data || { multiple_entries_per_day: [], days_without_restrictions: [] };
  } catch (err) {
    throw new Error(err?.message || 'Failed to check rate conflicts');
  }
}

async function _getApplicableRate(roomTypeId, date) {
  if (!state.isOnline) {
    return {
      rate_amount: 0,
      currency: 'BWP',
      source: 'offline_client_estimate',
      is_estimate: true,
      authoritative: false,
      _financial_estimate: true,
      message: 'Offline rate estimate only; server get_applicable_rate / quote_room_stay is authoritative when online.'
    };
  }
  try {
    const { data, error } = await state.supabase.rpc('get_applicable_rate', {
      p_lodge_id: state.lodgeId,
      p_room_type_id: roomTypeId,
      p_date: date
    });
    if (error) throw error;
    const result = data || { rate_amount: 0, currency: 'BWP', source: 'none' };
    return {
      ...result,
      is_estimate: false,
      authoritative: true,
      source: result.source || 'server_get_applicable_rate'
    };
  } catch (err) {
    throw new Error(err?.message || 'Failed to get applicable rate');
  }
}

/**
 * Prefer server quote_room_stay for multi-night stay totals.
 * Falls back to per-day get_applicable_rate labelled as estimate when offline.
 */
async function _quoteStayTotal(roomId, checkIn, checkOut, corporateAccountId = null) {
  if (!state.lodgeId) throw new Error('No lodge selected');
  if (!roomId || !checkIn || !checkOut) throw new Error('roomId, checkIn, and checkOut are required');

  if (state.isOnline && typeof state.supabase?.rpc === 'function') {
    try {
      const { data, error } = await state.supabase.rpc('quote_room_stay', {
        p_lodge_id: state.lodgeId,
        p_room_id: roomId,
        p_check_in: checkIn,
        p_check_out: checkOut,
        p_corporate_account_id: corporateAccountId
      });
      if (!error && data && data.success !== false) {
        return {
          ...data,
          source: 'server_quote_room_stay',
          is_estimate: false,
          authoritative: true
        };
      }
    } catch {
      // fall through to estimate path
    }
  }

  return {
    success: true,
    total: 0,
    source: 'client_rate_calendar_estimate',
    is_estimate: true,
    authoritative: false,
    _financial_estimate: true,
    message: 'Client estimate only; prefer server quote_room_stay when online.'
  };
}

// ─── Promo Codes ──────────────────────────────────────────────────────────────

async function _getAllPromoCodes() {
  if (!state.isOnline) return readCache('promo-codes') || [];
  try {
    const { data, error } = await state.supabase
      .from('promo_codes')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('code');
    if (error) throw error;
    writeCache('promo-codes', data || []);
    return data || [];
  } catch (err) {
    const cached = readCache('promo-codes');
    if (cached.length > 0) return cached;
    throw new Error(err?.message || 'Failed to load promo codes');
  }
}

async function _createPromoCode(data) {
  const id = randomUUID();
  const payload = {
    id,
    lodge_id: state.lodgeId,
    code: data.code,
    description: data.description || '',
    discount_type: data.discount_type || 'percentage',
    discount_value: Number(data.discount_value) || 0,
    valid_from: data.valid_from || null,
    valid_to: data.valid_to || null,
    min_nights: Number(data.min_nights) || 1,
    max_discount_amount: data.max_discount_amount ? Number(data.max_discount_amount) : null,
    usage_limit: data.usage_limit ? Number(data.usage_limit) : null,
    applies_to_room_types: Array.isArray(data.applies_to_room_types) ? data.applies_to_room_types : [],
    active: data.active !== false
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_promo_code', {
      p_lodge_id: state.lodgeId,
      p_code: payload
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create promo code');
    logActivity('promo_code_created', `Promo code ${data.code} created`);
    return result?.id || id;
  } else {
    const cached = readCache('promo-codes');
    cached.push({ ...payload, _pending_sync: true });
    writeCache('promo-codes', cached);
    queueOperation('rpc', 'create_promo_code', { p_lodge_id: state.lodgeId, p_code: payload }, null, { _queue_id: `promo-${id}` });
    return id;
  }
}

async function _updatePromoCode(id, data) {
  const update = {
    code: data.code,
    description: data.description,
    discount_type: data.discount_type,
    discount_value: Number(data.discount_value) || 0,
    valid_from: data.valid_from,
    valid_to: data.valid_to,
    min_nights: Number(data.min_nights) || 1,
    max_discount_amount: data.max_discount_amount ? Number(data.max_discount_amount) : null,
    usage_limit: data.usage_limit ? Number(data.usage_limit) : null,
    applies_to_room_types: Array.isArray(data.applies_to_room_types) ? data.applies_to_room_types : undefined,
    active: data.active
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_promo_code', {
      p_id: id, p_lodge_id: state.lodgeId, p_code: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update promo code');
    logActivity('promo_code_updated', `Promo code ${id} updated`);
  } else {
    const cached = readCache('promo-codes');
    const idx = cached.findIndex((p) => p.id === id);
    const pending = idx >= 0 && cached[idx]?._pending_sync;
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('promo-codes', cached);
    queueOperation('rpc', 'update_promo_code', {
      p_id: id, p_lodge_id: state.lodgeId, p_code: update
    }, null, pending ? { _depends_on: `promo-${id}` } : {});
  }
}

async function _deletePromoCode(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_promo_code', {
      p_id: id, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete promo code');
    logActivity('promo_code_deleted', `Promo code ${id} deleted`);
  } else {
    const cached = readCache('promo-codes');
    const pending = cached.some((p) => p.id === id && p?._pending_sync);
    writeCache('promo-codes', cached.filter((p) => p.id !== id));
    queueOperation('rpc', 'delete_promo_code', {
      p_id: id, p_lodge_id: state.lodgeId
    }, null, pending ? { _depends_on: `promo-${id}` } : {});
  }
}

async function _validatePromoCode(code, roomTypeId, nights) {
  if (!state.isOnline) return { valid: false, error: 'Cannot validate promo codes offline' };
  try {
    const { data, error } = await state.supabase.rpc('validate_promo_code', {
      p_lodge_id: state.lodgeId,
      p_code: code,
      p_room_type_id: roomTypeId || null,
      p_nights: Number(nights) || 1
    });
    if (error) throw error;
    return data || { valid: false, error: 'Could not validate promo code' };
  } catch (err) {
    throw new Error(err?.message || 'Failed to validate promo code');
  }
}

// ─── Season Labels ────────────────────────────────────────────────────────────

async function _getAllSeasonLabels() {
  if (!state.isOnline) return readCache('season-labels') || [];
  try {
    const { data, error } = await state.supabase
      .from('season_labels')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('start_date');
    if (error) throw error;
    writeCache('season-labels', data || []);
    return data || [];
  } catch (err) {
    const cached = readCache('season-labels');
    if (cached.length > 0) return cached;
    throw new Error(err?.message || 'Failed to load season labels');
  }
}

async function _createSeasonLabel(data) {
  const id = randomUUID();
  const payload = {
    id, lodge_id: state.lodgeId, name: data.name,
    color: data.color || '#6366f1',
    start_date: data.start_date, end_date: data.end_date
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_season_label', {
      p_lodge_id: state.lodgeId, p_season: payload
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create season label');
    return result?.id || id;
  } else {
    const cached = readCache('season-labels');
    cached.push({ ...payload, _pending_sync: true });
    writeCache('season-labels', cached);
    queueOperation('rpc', 'create_season_label', { p_lodge_id: state.lodgeId, p_season: payload }, null, { _queue_id: `season-${id}` });
    return id;
  }
}

async function _updateSeasonLabel(id, data) {
  const update = {
    name: data.name, color: data.color,
    start_date: data.start_date, end_date: data.end_date
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_season_label', {
      p_id: id, p_lodge_id: state.lodgeId, p_season: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update season label');
  } else {
    const cached = readCache('season-labels');
    const idx = cached.findIndex((s) => s.id === id);
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('season-labels', cached);
    queueOperation('rpc', 'update_season_label', {
      p_id: id, p_lodge_id: state.lodgeId, p_season: update
    });
  }
}

async function _deleteSeasonLabel(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_season_label', {
      p_id: id, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete season label');
  } else {
    const cached = readCache('season-labels');
    writeCache('season-labels', cached.filter((s) => s.id !== id));
    queueOperation('rpc', 'delete_season_label', {
      p_id: id, p_lodge_id: state.lodgeId
    });
  }
}

// ─── Yield Rules ──────────────────────────────────────────────────────────────

async function _getYieldRules() {
  if (!state.isOnline) return readCache('yield-rules') || [];
  try {
    const { data, error } = await state.supabase.rpc('get_yield_rules', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw error;
    writeCache('yield-rules', data || []);
    return data || [];
  } catch (err) {
    const cached = readCache('yield-rules');
    if (cached?.length > 0) return cached;
    throw new Error(err?.message || 'Failed to load yield rules');
  }
}

async function _createYieldRule(data) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_yield_rule', {
      p_lodge_id: state.lodgeId,
      p_name: data.name,
      p_description: data.description || '',
      p_rule_type: data.rule_type || 'occupancy_based',
      p_conditions: data.conditions || {},
      p_action: data.action || {},
      p_priority: Number(data.priority) || 0
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create yield rule');
    logActivity('yield_rule_created', `Yield rule ${data.name} created`);
    return result;
  } else {
    queueOperation('rpc', 'create_yield_rule', {
      p_lodge_id: state.lodgeId,
      p_name: data.name,
      p_description: data.description || '',
      p_rule_type: data.rule_type || 'occupancy_based',
      p_conditions: data.conditions || {},
      p_action: data.action || {},
      p_priority: Number(data.priority) || 0
    });
    return { success: true, _queued: true };
  }
}

async function _updateYieldRule(id, data) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_yield_rule', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_name: data.name || null,
      p_description: data.description !== undefined ? data.description : null,
      p_rule_type: data.rule_type || null,
      p_conditions: data.conditions || null,
      p_action: data.action || null,
      p_priority: data.priority !== undefined ? Number(data.priority) : null,
      p_active: data.active !== undefined ? data.active : null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update yield rule');
    logActivity('yield_rule_updated', `Yield rule ${id} updated`);
    return result;
  } else {
    queueOperation('rpc', 'update_yield_rule', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      p_name: data.name || null,
      p_description: data.description || null,
      p_rule_type: data.rule_type || null,
      p_conditions: data.conditions || null,
      p_action: data.action || null,
      p_priority: data.priority !== undefined ? Number(data.priority) : null,
      p_active: data.active !== undefined ? data.active : null
    });
    return { success: true, _queued: true };
  }
}

async function _deleteYieldRule(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_yield_rule', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete yield rule');
    logActivity('yield_rule_deleted', `Yield rule ${id} deleted`);
    return result;
  } else {
    queueOperation('rpc', 'delete_yield_rule', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    return { success: true, _queued: true };
  }
}

async function _getApplicableYieldAdjustment(date, currentOccupancyPct) {
  if (!state.isOnline) {
    return {
      adjusted: false,
      multiplier: 1.0,
      note: 'offline',
      is_estimate: true,
      authoritative: false,
      source: 'offline_client_estimate'
    };
  }
  try {
    const { data, error } = await state.supabase.rpc('get_applicable_yield_adjustment', {
      p_lodge_id: state.lodgeId,
      p_date: date,
      p_current_occupancy_pct: Number(currentOccupancyPct) || 0
    });
    if (error) throw error;
    return {
      ...(data || { adjusted: false, multiplier: 1.0 }),
      is_estimate: false,
      authoritative: true,
      source: 'server_get_applicable_yield_adjustment'
    };
  } catch (err) {
    throw new Error(err?.message || 'Failed to get yield adjustment');
  }
}

async function _calculateOccupancyBasedRate(baseRate, date, roomTypeId) {
  if (!state.isOnline) {
    return {
      rate: Number(baseRate) || 0,
      adjusted: false,
      note: 'offline',
      is_estimate: true,
      authoritative: false,
      source: 'offline_client_estimate',
      _financial_estimate: true
    };
  }
  try {
    const { data, error } = await state.supabase.rpc('calculate_occupancy_based_rate', {
      p_lodge_id: state.lodgeId,
      p_base_rate: Number(baseRate) || 0,
      p_date: date,
      p_room_type_id: roomTypeId || null
    });
    if (error) throw error;
    return {
      ...(data || { rate: baseRate, adjusted: false }),
      is_estimate: false,
      authoritative: true,
      source: 'server_calculate_occupancy_based_rate'
    };
  } catch (err) {
    throw new Error(err?.message || 'Failed to calculate occupancy based rate');
  }
}

async function _getOccupancyForecast(startDate, endDate) {
  if (!state.isOnline) return { forecast: [] };
  try {
    const { data, error } = await state.supabase.rpc('get_occupancy_forecast', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate
    });
    if (error) throw error;
    return data || { forecast: [] };
  } catch (err) {
    throw new Error(err?.message || 'Failed to get occupancy forecast');
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function getRateCalendar(roomTypeId, startDate, endDate) {
  return dedupePromise(`rateCalendar:${roomTypeId}:${startDate}:${endDate}`, () => _getRateCalendar(roomTypeId, startDate, endDate));
}

export function setRateCalendarEntry(roomTypeId, date, amount, currency) {
  return _setRateCalendarEntry(roomTypeId, date, amount, currency);
}

export function setRateCalendarBulk(entries) {
  return _setRateCalendarBulk(entries);
}

export function setRateRestriction(roomTypeId, date, restrictions) {
  return _setRateRestriction(roomTypeId, date, restrictions);
}

export function getRateConflicts(roomTypeId, startDate, endDate) {
  return _getRateConflicts(roomTypeId, startDate, endDate);
}

export function getApplicableRate(roomTypeId, date) {
  return _getApplicableRate(roomTypeId, date);
}

export function quoteStayTotal(roomId, checkIn, checkOut, corporateAccountId = null) {
  return _quoteStayTotal(roomId, checkIn, checkOut, corporateAccountId);
}

export function getAllPromoCodes() {
  return dedupePromise('promoCodes', _getAllPromoCodes);
}

export function createPromoCode(data) {
  return _createPromoCode(data);
}

export function updatePromoCode(id, data) {
  return _updatePromoCode(id, data);
}

export function deletePromoCode(id) {
  return _deletePromoCode(id);
}

export function validatePromoCode(code, roomTypeId, nights) {
  return _validatePromoCode(code, roomTypeId, nights);
}

export function getAllSeasonLabels() {
  return dedupePromise('seasonLabels', _getAllSeasonLabels);
}

export function createSeasonLabel(data) {
  return _createSeasonLabel(data);
}

export function updateSeasonLabel(id, data) {
  return _updateSeasonLabel(id, data);
}

export function deleteSeasonLabel(id) {
  return _deleteSeasonLabel(id);
}

export function getYieldRules() {
  return dedupePromise('yieldRules', _getYieldRules);
}

export function createYieldRule(data) {
  return _createYieldRule(data);
}

export function updateYieldRule(id, data) {
  return _updateYieldRule(id, data);
}

export function deleteYieldRule(id) {
  return _deleteYieldRule(id);
}

export function getApplicableYieldAdjustment(date, currentOccupancyPct) {
  return _getApplicableYieldAdjustment(date, currentOccupancyPct);
}

export function calculateOccupancyBasedRate(baseRate, date, roomTypeId) {
  return _calculateOccupancyBasedRate(baseRate, date, roomTypeId);
}

export function getOccupancyForecast(startDate, endDate) {
  return _getOccupancyForecast(startDate, endDate);
}

import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { dedupePromise, logActivity, readCache, writeCache } from './infrastructure.js';

const APPROVAL_CACHE = 'revenue-recommendation-approvals';

function labelRecommendations(payload) {
  const recommendations = Array.isArray(payload?.recommendations)
    ? payload.recommendations.map((rec, index) => ({
      ...rec,
      id: rec.id || rec.recommendation_id || `rec-${index}-${String(rec.action || 'action').slice(0, 24)}`,
      status: rec.status || 'pending_approval',
      requires_approval: true,
      auto_applied: false,
      applied: false
    }))
    : [];

  return {
    ...payload,
    recommendations,
    requires_approval: true,
    auto_applied: false,
    silent_apply: false,
    message: payload?.message || 'Recommendations require explicit manager approval and are never applied silently.'
  };
}

async function _getRevenueForecast(startDate, endDate) {
  if (!state.isOnline) return { entries: [], is_estimate: true, source: 'offline' };
  try {
    const { data, error } = await state.supabase.rpc('get_revenue_forecast', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate
    });
    if (error) throw error;
    return data || { entries: [] };
  } catch (err) {
    throw new Error(err?.message || 'Failed to load revenue forecast');
  }
}

async function _upsertForecastEntry(date, forecastOccupancyPct, forecastAdr, notes) {
  if (!state.isOnline) throw new Error('Cannot update forecast offline');
  const { data, error } = await state.supabase.rpc('upsert_forecast_entry', {
    p_lodge_id: state.lodgeId,
    p_date: date,
    p_forecast_occupancy_pct: Number(forecastOccupancyPct) || null,
    p_forecast_adr: Number(forecastAdr) || null,
    p_notes: notes || null
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not upsert forecast entry');
  return data;
}

async function _getCompetitorNotes() {
  if (!state.isOnline) return { notes: [] };
  try {
    const { data, error } = await state.supabase.rpc('get_competitor_notes', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw error;
    return data || { notes: [] };
  } catch (err) {
    throw new Error(err?.message || 'Failed to load competitor notes');
  }
}

async function _createCompetitorNote(competitorName, roomTypeId, notedRate, notes) {
  if (!state.isOnline) throw new Error('Cannot create competitor note offline');
  const { data, error } = await state.supabase.rpc('create_competitor_note', {
    p_lodge_id: state.lodgeId,
    p_competitor_name: competitorName,
    p_room_type_id: roomTypeId,
    p_noted_rate: Number(notedRate) || 0,
    p_notes: notes || null
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not create competitor note');
  return data;
}

async function _getDemandEvents(startDate, endDate) {
  if (!state.isOnline) return { events: [] };
  try {
    const { data, error } = await state.supabase.rpc('get_demand_events', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate
    });
    if (error) throw error;
    return data || { events: [] };
  } catch (err) {
    throw new Error(err?.message || 'Failed to load demand events');
  }
}

async function _createDemandEvent(eventName, eventDate, expectedImpact, notes) {
  if (!state.isOnline) throw new Error('Cannot create demand event offline');
  const { data, error } = await state.supabase.rpc('create_demand_event', {
    p_lodge_id: state.lodgeId,
    p_event_name: eventName,
    p_event_date: eventDate,
    p_expected_impact: expectedImpact || null,
    p_notes: notes || null
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not create demand event');
  return data;
}

async function _getRevenueRecommendations() {
  if (!state.isOnline) {
    return labelRecommendations({ recommendations: [], current_occupancy: 0, offline: true });
  }
  try {
    const { data, error } = await state.supabase.rpc('get_revenue_recommendations', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw error;
    return labelRecommendations(data || { recommendations: [], current_occupancy: 0 });
  } catch (err) {
    throw new Error(err?.message || 'Failed to get revenue recommendations');
  }
}

function recordApprovalLocally(entry) {
  const cached = readCache(APPROVAL_CACHE) || [];
  const list = Array.isArray(cached) ? cached : [];
  list.unshift(entry);
  writeCache(APPROVAL_CACHE, list.slice(0, 200));
  return entry;
}

/**
 * Approve a revenue recommendation for operator action.
 * Does NOT apply rates, yield rules, or calendar changes.
 */
export async function approveRevenueRecommendation(recommendation, notes = null) {
  if (!state.lodgeId) throw new Error('No lodge selected');
  if (!recommendation || typeof recommendation !== 'object') {
    throw new Error('Recommendation payload is required');
  }

  const approvalId = randomUUID();
  const approvedAt = new Date().toISOString();
  const payload = {
    approval_id: approvalId,
    lodge_id: state.lodgeId,
    recommendation_id: recommendation.id || recommendation.recommendation_id || null,
    action: recommendation.action || null,
    reason: recommendation.reason || null,
    status: 'approved',
    applied: false,
    auto_applied: false,
    notes: notes || null,
    approved_by: state.currentUser?.id || null,
    approved_at: approvedAt,
    payload: recommendation
  };

  // Prefer durable table write when the enterprise recommendations table is reachable.
  if (state.isOnline && state.supabase) {
    try {
      const { data, error } = await state.supabase
        .from('enterprise_revenue_recommendations')
        .insert({
          id: approvalId,
          lodge_id: state.lodgeId,
          room_type_id: recommendation.room_type_id || null,
          rate_plan_id: recommendation.rate_plan_id || null,
          recommendation_date: recommendation.recommendation_date || new Date().toISOString().slice(0, 10),
          status: 'approved',
          payload: {
            ...recommendation,
            notes,
            applied: false,
            auto_applied: false
          },
          approved_by: state.currentUser?.id || null,
          approved_at: approvedAt
        })
        .select('id')
        .maybeSingle();
      if (error) throw error;
      logActivity('revenue_recommendation_approved', `Recommendation approved · ${recommendation.action || approvalId}`);
      return {
        success: true,
        approval_id: data?.id || approvalId,
        status: 'approved',
        applied: false,
        auto_applied: false,
        message: 'Recommendation approved for operator action. Rates were not applied automatically.'
      };
    } catch {
      // Fall through to local audit record — still must not apply rates.
    }
  }

  recordApprovalLocally(payload);
  logActivity('revenue_recommendation_approved', `Recommendation approved (local) · ${recommendation.action || approvalId}`);
  return {
    success: true,
    approval_id: approvalId,
    status: 'approved',
    applied: false,
    auto_applied: false,
    _local: true,
    message: 'Recommendation approved for operator action. Rates were not applied automatically.'
  };
}

/**
 * Reject a revenue recommendation. No rate changes.
 */
export async function rejectRevenueRecommendation(recommendation, reason = null) {
  if (!state.lodgeId) throw new Error('No lodge selected');
  if (!recommendation || typeof recommendation !== 'object') {
    throw new Error('Recommendation payload is required');
  }

  const rejectionId = randomUUID();
  const rejectedAt = new Date().toISOString();
  const entry = {
    approval_id: rejectionId,
    lodge_id: state.lodgeId,
    recommendation_id: recommendation.id || recommendation.recommendation_id || null,
    action: recommendation.action || null,
    status: 'rejected',
    applied: false,
    auto_applied: false,
    notes: reason || null,
    approved_by: state.currentUser?.id || null,
    approved_at: rejectedAt,
    payload: recommendation
  };

  if (state.isOnline && state.supabase) {
    try {
      await state.supabase.from('enterprise_revenue_recommendations').insert({
        id: rejectionId,
        lodge_id: state.lodgeId,
        room_type_id: recommendation.room_type_id || null,
        rate_plan_id: recommendation.rate_plan_id || null,
        recommendation_date: recommendation.recommendation_date || new Date().toISOString().slice(0, 10),
        status: 'rejected',
        payload: { ...recommendation, reject_reason: reason, applied: false },
        approved_by: state.currentUser?.id || null,
        approved_at: rejectedAt
      });
    } catch {
      recordApprovalLocally(entry);
    }
  } else {
    recordApprovalLocally(entry);
  }

  logActivity('revenue_recommendation_rejected', `Recommendation rejected · ${recommendation.action || rejectionId}`);
  return {
    success: true,
    approval_id: rejectionId,
    status: 'rejected',
    applied: false,
    auto_applied: false,
    message: 'Recommendation rejected. No rate changes were applied.'
  };
}

/**
 * Explicit no-op guard: applying rates from a recommendation is never silent.
 * Callers must use rate calendar / rate plan mutations after separate approval.
 */
export async function applyRevenueRecommendation() {
  return {
    success: false,
    applied: false,
    auto_applied: false,
    requires_approval: true,
    error: 'Revenue recommendations cannot be applied silently. Approve the recommendation, then change rates through the rate calendar or rate plans APIs.'
  };
}

export function getRevenueForecast(startDate, endDate) {
  return dedupePromise(`revenueForecast:${startDate}:${endDate}`, () => _getRevenueForecast(startDate, endDate));
}

export function upsertForecastEntry(date, forecastOccupancyPct, forecastAdr, notes) {
  return _upsertForecastEntry(date, forecastOccupancyPct, forecastAdr, notes);
}

export function getCompetitorNotes() {
  return dedupePromise('competitorNotes', _getCompetitorNotes);
}

export function createCompetitorNote(competitorName, roomTypeId, notedRate, notes) {
  return _createCompetitorNote(competitorName, roomTypeId, notedRate, notes);
}

export function getDemandEvents(startDate, endDate) {
  return dedupePromise(`demandEvents:${startDate}:${endDate}`, () => _getDemandEvents(startDate, endDate));
}

export function createDemandEvent(eventName, eventDate, expectedImpact, notes) {
  return _createDemandEvent(eventName, eventDate, expectedImpact, notes);
}

export function getRevenueRecommendations() {
  return dedupePromise('revenueRecommendations', _getRevenueRecommendations);
}

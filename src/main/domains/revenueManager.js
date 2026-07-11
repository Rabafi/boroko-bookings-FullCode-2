import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

async function _getRevenueForecast(startDate, endDate) {
  if (!state.isOnline) return { entries: [] };
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
  if (!state.isOnline) return { recommendations: [], current_occupancy: 0 };
  try {
    const { data, error } = await state.supabase.rpc('get_revenue_recommendations', {
      p_lodge_id: state.lodgeId
    });
    if (error) throw error;
    return data || { recommendations: [], current_occupancy: 0 };
  } catch (err) {
    throw new Error(err?.message || 'Failed to get revenue recommendations');
  }
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

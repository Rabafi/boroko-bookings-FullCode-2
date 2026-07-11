import { randomUUID } from 'crypto';
import { state } from '../state.js';
import {
  logActivity,
  queueOperation,
  readCache,
  refreshCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

const FLOOR_SECTION_SELECT = 'id, lodge_id, name, code, section_type, parent_id, floor_number, description, sort_order, active, created_at, updated_at';

function isMissingFloorSectionsSchema(error) {
  const message = String(error?.message || error || '');
  return /schema cache|Could not find the table|floor_sections|create_floor_section|update_floor_section|delete_floor_section/i.test(message);
}

async function _getAllFloorSections() {
  if (!state.isOnline) {
    return readCache('floor-sections');
  }

  try {
    const { data, error } = await state.supabase
      .from('floor_sections')
      .select(FLOOR_SECTION_SELECT)
      .eq('lodge_id', state.lodgeId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .limit(300);
    if (error) throw error;
    writeCache('floor-sections', data || []);
    return data || [];
  } catch (error) {
    const cached = readCache('floor-sections');
    if (cached.length > 0) {
      console.warn('getAllFloorSections falling back to cache:', error?.message || error);
      return cached;
    }
    if (isMissingFloorSectionsSchema(error)) {
      console.warn('getAllFloorSections schema not deployed yet; returning empty local list:', error?.message || error);
      return [];
    }
    throw new Error(error?.message || 'Failed to load floors and sections');
  }
}

export function getAllFloorSections() {
  return dedupePromise('getAllFloorSections', _getAllFloorSections);
}

export async function getFloorSectionById(id) {
  try {
    const { data, error } = await state.supabase
      .from('floor_sections')
      .select('*')
      .eq('id', id)
      .eq('lodge_id', state.lodgeId)
      .single();
    if (error) throw error;
    return data || null;
  } catch {
    return readCache('floor-sections').find((section) => section.id === id) || null;
  }
}

export async function createFloorSection(data) {
  const id = randomUUID();
  const payload = {
    id,
    lodge_id: state.lodgeId,
    name: data.name,
    code: data.code || '',
    section_type: data.section_type || 'floor',
    parent_id: data.parent_id || null,
    floor_number: data.floor_number === '' || data.floor_number === undefined ? null : Number(data.floor_number),
    description: data.description || '',
    sort_order: Number(data.sort_order) || 0
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_floor_section', { payload });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create floor or section');
    await refreshCache('floor-sections');
    logActivity('floor_section_created', `Floor/section created · ${payload.name}`);
    return result?.id || id;
  }

  const cached = readCache('floor-sections');
  cached.push({ ...payload, active: true, _pending_sync: true, created_at: new Date().toISOString() });
  writeCache('floor-sections', cached);
  queueOperation('rpc', 'create_floor_section', { payload }, null, { _queue_id: `floor-section-${id}` });
  logActivity('floor_section_created', `Floor/section created (offline) · ${payload.name}`);
  return id;
}

export async function updateFloorSection(id, data) {
  const payload = {
    name: data.name,
    code: data.code || '',
    section_type: data.section_type || 'floor',
    parent_id: data.parent_id || null,
    floor_number: data.floor_number === '' || data.floor_number === undefined ? null : Number(data.floor_number),
    description: data.description || '',
    sort_order: Number(data.sort_order) || 0
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_floor_section', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload,
      p_expected_updated_at: null
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update floor or section');
    await refreshCache('floor-sections');
    logActivity('floor_section_updated', `Floor/section updated · ${payload.name}`);
    return;
  }

  const cached = readCache('floor-sections');
  const idx = cached.findIndex((section) => section.id === id);
  if (idx >= 0) cached[idx] = { ...cached[idx], ...payload, _pending_sync: true };
  writeCache('floor-sections', cached);
  queueOperation('rpc', 'update_floor_section', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    payload,
    p_expected_updated_at: null
  }, null, { _queue_id: `floor-section-update-${id}` });
  logActivity('floor_section_updated', `Floor/section updated (offline) · ${payload.name}`);
}

export async function deleteFloorSection(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_floor_section', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete floor or section');
    await refreshCache('floor-sections');
    logActivity('floor_section_deleted', 'Floor/section deleted');
    return result;
  }

  const cached = readCache('floor-sections');
  const deleted = cached.find((section) => section.id === id);
  writeCache('floor-sections', cached.filter((section) => section.id !== id));
  queueOperation('rpc', 'delete_floor_section', {
    p_id: id,
    p_lodge_id: state.lodgeId
  }, null, { _queue_id: `floor-section-delete-${id}` });
  logActivity('floor_section_deleted', `Floor/section deleted (offline) · ${deleted?.name || id}`);
  return { success: true };
}

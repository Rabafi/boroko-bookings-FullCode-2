// @ts-check
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

/** @typedef {Record<string, unknown>} FloorSectionPropertyView */
/** @typedef {FloorSectionPropertyView[]} FloorSectionRowsView */

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForDomainRpc() {
  // Preserve each existing unguarded client access; setup occurs in authClients/infrastructure.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

/** @param {unknown} message @returns {Error} */
function errorWithUnknownMessage(message) {
  return Reflect.construct(Error, [message])
}

/** @param {unknown} error @returns {boolean} */
function isMissingFloorSectionsSchema(error) {
  const errorView = /** @type {FloorSectionPropertyView | null | undefined} */ (error)
  const message = String(errorView?.message || error || '');
  return /schema cache|Could not find the table|floor_sections|create_floor_section|update_floor_section|delete_floor_section/i.test(message);
}

/** @returns {Promise<unknown>} */
async function _getAllFloorSections() {
  if (!state.isOnline) {
    return readCache('floor-sections');
  }

  try {
    const { data, error } = await supabaseForDomainRpc()
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
    const cachedView = /** @type {{length: number}} */ (cached)
    const errorView = /** @type {FloorSectionPropertyView | null | undefined} */ (error)
    if (cachedView.length > 0) {
      console.warn('getAllFloorSections falling back to cache:', errorView?.message || error);
      return cached;
    }
    if (isMissingFloorSectionsSchema(error)) {
      console.warn('getAllFloorSections schema not deployed yet; returning empty local list:', errorView?.message || error);
      return [];
    }
    throw errorWithUnknownMessage(errorView?.message || 'Failed to load floors and sections');
  }
}

export function getAllFloorSections() {
  return dedupePromise('getAllFloorSections', _getAllFloorSections);
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function getFloorSectionById(id) {
  try {
    const { data, error } = await supabaseForDomainRpc()
      .from('floor_sections')
      .select('*')
      .eq('id', id)
      .eq('lodge_id', state.lodgeId)
      .single();
    if (error) throw error;
    return data || null;
  } catch {
    const cached = /** @type {FloorSectionRowsView} */ (readCache('floor-sections'))
    return cached.find((entry) => {
      const section = /** @type {FloorSectionPropertyView} */ (entry)
      return section.id === id
    }) || null;
  }
}

/** @param {unknown} data @returns {Promise<unknown>} */
export async function createFloorSection(data) {
  const sectionData = /** @type {FloorSectionPropertyView} */ (data)
  const id = randomUUID();
  const payload = {
    id,
    lodge_id: state.lodgeId,
    name: sectionData.name,
    code: sectionData.code || '',
    section_type: sectionData.section_type || 'floor',
    parent_id: sectionData.parent_id || null,
    floor_number: sectionData.floor_number === '' || sectionData.floor_number === undefined ? null : Number(sectionData.floor_number),
    description: sectionData.description || '',
    sort_order: Number(sectionData.sort_order) || 0
  };

  if (state.isOnline) {
    const { data: result, error } = await supabaseForDomainRpc().rpc('create_floor_section', { payload });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {FloorSectionPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not create floor or section');
    await refreshCache('floor-sections');
    logActivity('floor_section_created', `Floor/section created · ${payload.name}`);
    return resultView?.id || id;
  }

  const cached = /** @type {FloorSectionRowsView} */ (readCache('floor-sections'));
  cached.push({ ...payload, active: true, _pending_sync: true, created_at: new Date().toISOString() });
  writeCache('floor-sections', cached);
  queueOperation('rpc', 'create_floor_section', { payload }, null, { _queue_id: `floor-section-${id}` });
  logActivity('floor_section_created', `Floor/section created (offline) · ${payload.name}`);
  return id;
}

/** @param {unknown} id @param {unknown} data @returns {Promise<void>} */
export async function updateFloorSection(id, data) {
  const sectionData = /** @type {FloorSectionPropertyView} */ (data)
  const payload = {
    name: sectionData.name,
    code: sectionData.code || '',
    section_type: sectionData.section_type || 'floor',
    parent_id: sectionData.parent_id || null,
    floor_number: sectionData.floor_number === '' || sectionData.floor_number === undefined ? null : Number(sectionData.floor_number),
    description: sectionData.description || '',
    sort_order: Number(sectionData.sort_order) || 0
  };

  if (state.isOnline) {
    const { data: result, error } = await supabaseForDomainRpc().rpc('update_floor_section', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload,
      p_expected_updated_at: null
    });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {FloorSectionPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not update floor or section');
    await refreshCache('floor-sections');
    logActivity('floor_section_updated', `Floor/section updated · ${payload.name}`);
    return;
  }

  const cached = /** @type {FloorSectionRowsView} */ (readCache('floor-sections'));
  const idx = cached.findIndex((entry) => {
    const section = /** @type {FloorSectionPropertyView} */ (entry)
    return section.id === id
  });
  if (idx >= 0) cached[idx] = { .../** @type {FloorSectionPropertyView} */ (cached[idx]), ...payload, _pending_sync: true };
  writeCache('floor-sections', cached);
  queueOperation('rpc', 'update_floor_section', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    payload,
    p_expected_updated_at: null
  }, null, { _queue_id: `floor-section-update-${id}` });
  logActivity('floor_section_updated', `Floor/section updated (offline) · ${payload.name}`);
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function deleteFloorSection(id) {
  if (state.isOnline) {
    const { data: result, error } = await supabaseForDomainRpc().rpc('delete_floor_section', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {FloorSectionPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not delete floor or section');
    await refreshCache('floor-sections');
    logActivity('floor_section_deleted', 'Floor/section deleted');
    return result;
  }

  const cached = /** @type {FloorSectionRowsView} */ (readCache('floor-sections'));
  const deleted = cached.find((entry) => {
    const section = /** @type {FloorSectionPropertyView} */ (entry)
    return section.id === id
  });
  writeCache('floor-sections', cached.filter((entry) => {
    const section = /** @type {FloorSectionPropertyView} */ (entry)
    return section.id !== id
  }));
  queueOperation('rpc', 'delete_floor_section', {
    p_id: id,
    p_lodge_id: state.lodgeId
  }, null, { _queue_id: `floor-section-delete-${id}` });
  const deletedView = /** @type {FloorSectionPropertyView | null | undefined} */ (deleted)
  logActivity('floor_section_deleted', `Floor/section deleted (offline) · ${deletedView?.name || id}`);
  return { success: true };
}

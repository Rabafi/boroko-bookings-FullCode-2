import { randomUUID } from 'crypto'
import { state } from '../state.js'
import {
  MAX_FINANCIAL_AMOUNT,
  checkExclusiveEventConflict,
  logActivity,
  queueOperation,
  readCache,
  writeCache
} from './infrastructure.js'

// ─── POOL / DAY USE ────────────────────────────────────────────────────────────

export async function getPoolDayUse(start, end) {
  const cached = readCache('pool-day-use');
  if (!state.isOnline) {
    return cached.
    filter((row) => (!start || String(row.date || '') >= start) && (!end || String(row.date || '') <= end)).
    sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
  }
  let q = state.supabase.from('pool_day_use').select('*').eq('lodge_id', state.lodgeId);
  if (start) q = q.gte('date', start);
  if (end) q = q.lte('date', end);
  const { data } = await q.order('date', { ascending: false }).order('created_at', { ascending: false });
  if (data) writeCache('pool-day-use', data, { source: 'remote' });
  return data || [];
}

export async function getPoolDayUseById(id) {
  if (!id) return null;
  if (!state.isOnline) return readCache('pool-day-use').find((row) => row.id === id) || null;
  const { data, error } = await state.supabase.
  from('pool_day_use').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', id).
  single();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function addPoolDayUse(data) {
  await checkExclusiveEventConflict(data.date, data.date + 'T23:59:59');
  if (Number(data.fee_per_adult || 0) < 0 || Number(data.fee_per_child || 0) < 0) {
    throw new Error('Day-use fees cannot be negative');
  }
  if (Number(data.fee_per_adult || 0) > MAX_FINANCIAL_AMOUNT || Number(data.fee_per_child || 0) > MAX_FINANCIAL_AMOUNT) {
    throw new Error(`Day-use fees cannot exceed P${MAX_FINANCIAL_AMOUNT.toLocaleString('en-BW')}`);
  }
  const total = (data.adults || 0) * (data.fee_per_adult || 0) + (data.children || 0) * (data.fee_per_child || 0);
  const id = randomUUID();
  const payload = {
    id,
    lodge_id: state.lodgeId,
    date: data.date,
    guest_name: data.guest_name || 'Walk-in',
    phone: data.phone || null,
    adults: data.adults || 1,
    children: data.children || 0,
    fee_per_adult: data.fee_per_adult || 0,
    fee_per_child: data.fee_per_child || 0,
    total,
    payment_method: data.payment_method || 'cash',
    notes: data.notes || null
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('add_pool_day_use', { payload });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not add pool day-use entry');
    writeCache('pool-day-use', [payload, ...readCache('pool-day-use').filter((row) => row.id !== id)], { source: 'local' });
    logActivity('pool_day_use_added', `Pool day use · ${data.guest_name || 'Walk-in'} · ${data.date} · P${total}`);
    return { id: result.id || id };
  }
  const offlineRow = {
    ...payload,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    created_at: new Date().toISOString()
  };
  writeCache('pool-day-use', [offlineRow, ...readCache('pool-day-use').filter((row) => row.id !== id)], { source: 'local' });
  queueOperation('rpc', 'add_pool_day_use', { payload }, null, {
    _queue_id: `dayuse-${id}`
  });
  logActivity('pool_day_use_added', `(Offline) Pool day use · ${data.guest_name || 'Walk-in'} · ${data.date} · P${total}`);
  return { id };
}

export async function deletePoolDayUse(id) {
  if (!id) throw new Error('Pool day-use ID is required');
  if (!state.isOnline) {
    const cached = readCache('pool-day-use');
    const existing = cached.find((row) => row.id === id);
    const dependsOn = existing?._pending_sync ? `dayuse-${id}` : null;
    writeCache('pool-day-use', cached.filter((row) => row.id !== id), { source: 'local' });
    queueOperation('rpc', 'delete_pool_day_use', {
      p_id: id,
      p_lodge_id: state.lodgeId
    }, null, dependsOn ? { _depends_on: dependsOn } : {});
    return { success: true };
  }
  const { data: result, error } = await state.supabase.rpc('delete_pool_day_use', {
    p_id: id,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!result?.success) throw new Error(result?.error || 'Could not delete pool day-use entry');
  writeCache('pool-day-use', readCache('pool-day-use').filter((row) => row.id !== id), { source: 'local' });
  return { success: true };
}

export async function getPoolDayUseSummary(date) {
  const entries = state.isOnline ?
  (await state.supabase.from('pool_day_use').select('*').eq('lodge_id', state.lodgeId).eq('date', date)).data || [] :
  readCache('pool-day-use').filter((row) => row.date === date);
  return {
    total: entries.reduce((s, e) => s + (e.total || 0), 0),
    adults: entries.reduce((s, e) => s + (e.adults || 0), 0),
    children: entries.reduce((s, e) => s + (e.children || 0), 0),
    entries
  };
}

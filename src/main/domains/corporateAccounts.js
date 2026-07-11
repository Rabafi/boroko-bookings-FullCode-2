import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { logActivity, queueOperation, readCache, refreshCache, writeCache, dedupePromise } from './infrastructure.js';

async function _getAllCorporateAccounts() {
  if (!state.isOnline) return readCache('corporate-accounts');
  try {
    const { data, error } = await state.supabase
      .from('corporate_accounts')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('company_name');
    if (error) throw error;
    writeCache('corporate-accounts', data || []);
    return data || [];
  } catch (err) {
    const cached = readCache('corporate-accounts');
    if (cached.length > 0) return cached;
    throw new Error(err?.message || 'Failed to load corporate accounts');
  }
}

export function getAllCorporateAccounts() {
  return dedupePromise('corporateAccounts', _getAllCorporateAccounts);
}

export async function createCorporateAccount(data) {
  const id = randomUUID();
  const account = {
    id,
    lodge_id: state.lodgeId,
    company_name: data.company_name,
    contact_name: data.contact_name || '',
    contact_email: data.contact_email || '',
    contact_phone: data.contact_phone || '',
    billing_address: data.billing_address || '',
    credit_limit: Number(data.credit_limit) || 0,
    payment_terms_days: Number(data.payment_terms_days) || 30,
    tax_number: data.tax_number || '',
    notes: data.notes || '',
    status: data.status || 'active',
    created_at: new Date().toISOString()
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_corporate_account', { payload: account });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create corporate account');
    await refreshCache('corporate-accounts');
    return result?.id || id;
  } else {
    const cached = readCache('corporate-accounts');
    cached.push({ ...account, _pending_sync: true });
    writeCache('corporate-accounts', cached);
    queueOperation('rpc', 'create_corporate_account', { payload: account }, null, { _queue_id: `corp-${id}` });
    return id;
  }
}

export async function updateCorporateAccount(id, data) {
  const update = {
    company_name: data.company_name,
    contact_name: data.contact_name,
    contact_email: data.contact_email,
    contact_phone: data.contact_phone,
    billing_address: data.billing_address,
    credit_limit: Number(data.credit_limit) || 0,
    payment_terms_days: Number(data.payment_terms_days) || 30,
    tax_number: data.tax_number,
    notes: data.notes,
    status: data.status
  };

  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_corporate_account', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update corporate account');
    await refreshCache('corporate-accounts');
  } else {
    const cached = readCache('corporate-accounts');
    const idx = cached.findIndex((a) => a.id === id);
    const pending = idx >= 0 && cached[idx]?._pending_sync;
    if (idx >= 0) cached[idx] = { ...cached[idx], ...update };
    writeCache('corporate-accounts', cached);
    queueOperation('rpc', 'update_corporate_account', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update
    }, null, pending ? { _depends_on: `corp-${id}` } : {});
  }
}

export async function deleteCorporateAccount(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_corporate_account', {
      p_id: id, p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete corporate account');
    await refreshCache('corporate-accounts');
  } else {
    const cached = readCache('corporate-accounts');
    const pending = cached.some((a) => a.id === id && a?._pending_sync);
    writeCache('corporate-accounts', cached.filter((a) => a.id !== id));
    queueOperation('rpc', 'delete_corporate_account', {
      p_id: id, p_lodge_id: state.lodgeId
    }, null, pending ? { _depends_on: `corp-${id}` } : {});
  }
}

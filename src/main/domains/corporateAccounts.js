// @ts-check
import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { logActivity, queueOperation, readCache, refreshCache, writeCache, dedupePromise } from './infrastructure.js';

/** @typedef {Record<string, unknown>} CorporateAccountPropertyView */

/** @returns {NonNullable<typeof state.supabase>} */
function supabaseForDomainRpc() {
  // Preserve each existing unguarded RPC dereference if client setup has not run.
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase)
}

/** @param {unknown} message @returns {Error} */
function errorWithUnknownMessage(message) {
  return Reflect.construct(Error, [message])
}

/** @param {unknown} error @returns {unknown} */
function readThrownMessage(error) {
  if (error === null || error === undefined) return undefined
  return /** @type {CorporateAccountPropertyView} */ (error).message
}

/** @returns {Promise<unknown>} */
async function _getAllCorporateAccounts() {
  if (!state.isOnline) return readCache('corporate-accounts');
  try {
    const { data, error } = await supabaseForDomainRpc()
      .from('corporate_accounts')
      .select('*')
      .eq('lodge_id', state.lodgeId)
      .order('company_name');
    if (error) throw error;
    writeCache('corporate-accounts', data || []);
    return data || [];
  } catch (err) {
    const cached = readCache('corporate-accounts');
    // This property view preserves the original `.length > 0` cache read; it does not validate the cache.
    const cachedView = /** @type {{length: number}} */ (cached)
    if (cachedView.length > 0) return cached;
    throw errorWithUnknownMessage(readThrownMessage(err) || 'Failed to load corporate accounts');
  }
}

export function getAllCorporateAccounts() {
  return dedupePromise('corporateAccounts', _getAllCorporateAccounts);
}

/** @param {unknown} data @returns {Promise<unknown>} */
export async function createCorporateAccount(data) {
  const accountData = /** @type {CorporateAccountPropertyView} */ (data)
  const id = randomUUID();
  const account = {
    id,
    lodge_id: state.lodgeId,
    company_name: accountData.company_name,
    contact_name: accountData.contact_name || '',
    contact_email: accountData.contact_email || '',
    contact_phone: accountData.contact_phone || '',
    billing_address: accountData.billing_address || '',
    credit_limit: Number(accountData.credit_limit) || 0,
    payment_terms_days: Number(accountData.payment_terms_days) || 30,
    tax_number: accountData.tax_number || '',
    notes: accountData.notes || '',
    status: accountData.status || 'active',
    created_at: new Date().toISOString()
  };

  if (state.isOnline) {
    const { data: result, error } = await supabaseForDomainRpc().rpc('create_corporate_account', { payload: account });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {CorporateAccountPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not create corporate account');
    await refreshCache('corporate-accounts');
    return resultView?.id || id;
  } else {
    const cached = /** @type {unknown[]} */ (readCache('corporate-accounts'));
    cached.push({ ...account, _pending_sync: true });
    writeCache('corporate-accounts', cached);
    queueOperation('rpc', 'create_corporate_account', { payload: account }, null, { _queue_id: `corp-${id}` });
    return id;
  }
}

/** @param {unknown} id @param {unknown} data @returns {Promise<void>} */
export async function updateCorporateAccount(id, data) {
  const accountData = /** @type {CorporateAccountPropertyView} */ (data)
  const update = {
    company_name: accountData.company_name,
    contact_name: accountData.contact_name,
    contact_email: accountData.contact_email,
    contact_phone: accountData.contact_phone,
    billing_address: accountData.billing_address,
    credit_limit: Number(accountData.credit_limit) || 0,
    payment_terms_days: Number(accountData.payment_terms_days) || 30,
    tax_number: accountData.tax_number,
    notes: accountData.notes,
    status: accountData.status
  };

  if (state.isOnline) {
    const { data: result, error } = await supabaseForDomainRpc().rpc('update_corporate_account', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update
    });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {CorporateAccountPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not update corporate account');
    await refreshCache('corporate-accounts');
  } else {
    const cached = /** @type {unknown[]} */ (readCache('corporate-accounts'));
    // Keep the original unvalidated cache row reads; the local view is only for their properties.
    const idx = cached.findIndex((entry) => {
      const a = /** @type {CorporateAccountPropertyView} */ (entry)
      return a.id === id
    });
    const pendingRow = /** @type {CorporateAccountPropertyView | null | undefined} */ (cached[idx])
    const pending = idx >= 0 && pendingRow?._pending_sync;
    if (idx >= 0) cached[idx] = { .../** @type {CorporateAccountPropertyView} */ (cached[idx]), ...update };
    writeCache('corporate-accounts', cached);
    queueOperation('rpc', 'update_corporate_account', {
      p_id: id, p_lodge_id: state.lodgeId, payload: update
    }, null, pending ? { _depends_on: `corp-${id}` } : {});
  }
}

/** @param {unknown} id @returns {Promise<void>} */
export async function deleteCorporateAccount(id) {
  if (state.isOnline) {
    const { data: result, error } = await supabaseForDomainRpc().rpc('delete_corporate_account', {
      p_id: id, p_lodge_id: state.lodgeId
    });
    if (error) throw errorWithUnknownMessage(error.message);
    const resultView = /** @type {CorporateAccountPropertyView | null | undefined} */ (result)
    if (!resultView?.success) throw errorWithUnknownMessage(resultView?.error || 'Could not delete corporate account');
    await refreshCache('corporate-accounts');
  } else {
    const cached = /** @type {unknown[]} */ (readCache('corporate-accounts'));
    const pending = cached.some((entry) => {
      const a = /** @type {CorporateAccountPropertyView} */ (entry)
      return a.id === id && a?._pending_sync
    });
    writeCache('corporate-accounts', cached.filter((entry) => {
      const a = /** @type {CorporateAccountPropertyView} */ (entry)
      return a.id !== id
    }));
    queueOperation('rpc', 'delete_corporate_account', {
      p_id: id, p_lodge_id: state.lodgeId
    }, null, pending ? { _depends_on: `corp-${id}` } : {});
  }
}

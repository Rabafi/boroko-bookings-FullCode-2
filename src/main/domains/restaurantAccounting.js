// @ts-check
import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

/** @returns {Promise<unknown>} */
export function getAccounts() {
  return dedupePromise('getAccounts', async () => {
    if (!state.isOnline) throw new Error('Chart of Accounts requires online connection');
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_accounts', { p_lodge_id: state.lodgeId });
    if (error) throw new Error(error.message);
    return data || [];
  });
}

/** @param {unknown} code @param {unknown} name @param {unknown} accountType @param {unknown} [parentId] @param {unknown} [openingBalance] @param {unknown} [description] @returns {Promise<unknown>} */
export async function createAccount(code, name, accountType, parentId = null, openingBalance = 0, description = null) {
  if (!state.isOnline) throw new Error('Chart of Accounts requires online connection');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_restaurant_account', {
    p_lodge_id: state.lodgeId, p_code: code, p_name: name, p_account_type: accountType,
    p_parent_id: parentId, p_opening_balance: openingBalance, p_description: description
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to create account');
  return data;
}

/** @param {unknown} id @param {object} updates @returns {Promise<unknown>} */
export async function updateAccount(id, updates) {
  if (!state.isOnline) throw new Error('Chart of Accounts requires online connection');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_restaurant_account', {
    p_id: id, p_lodge_id: state.lodgeId, .../** @type {Record<string, unknown>} */ (updates)
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to update account');
  return data;
}

/** @param {unknown} id @returns {Promise<unknown>} */
export async function deleteAccount(id) {
  if (!state.isOnline) throw new Error('Chart of Accounts requires online connection');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('delete_restaurant_account', { p_id: id, p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to delete account');
  return data;
}

/** @returns {Promise<unknown>} */
export async function seedDefaultAccounts() {
  if (!state.isOnline) throw new Error('Chart of Accounts requires online connection');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('seed_restaurant_default_accounts', { p_lodge_id: state.lodgeId });
  if (error) throw new Error(error.message);
  return data;
}

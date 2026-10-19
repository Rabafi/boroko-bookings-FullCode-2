// @ts-check
import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

/** @param {unknown} [startDate] @param {unknown} [endDate] @param {unknown} [sourceType] @param {unknown} [accountId] @param {unknown} [limit] @returns {Promise<unknown>} */
function _getJournalEntries(startDate = null, endDate = null, sourceType = null, accountId = null, limit = 100) {
  const key = `gl:getJournalEntries:${startDate || ''}:${endDate || ''}:${sourceType || ''}:${accountId || ''}:${limit}`;
  return dedupePromise(key, async () => {
    if (!state.isOnline) throw new Error('General Ledger requires online connection');
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_journal_entries', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_source_type: sourceType || null,
      p_account_id: accountId || null,
      p_limit: limit
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Failed to load journal entries');
    return data;
  });
}
export const getJournalEntries = _getJournalEntries;

/** @param {unknown} entryDate @param {unknown} description @param {unknown} sourceType @param {unknown} [sourceId] @param {unknown} [referenceNumber] @param {unknown} [lines] @returns {Promise<unknown>} */
export async function createJournalEntry(entryDate, description, sourceType, sourceId = null, referenceNumber = null, lines) {
  if (!state.isOnline) throw new Error('General Ledger requires online connection');
  if (!description) throw new Error('Description is required');
  // Keep the original length check for all runtime inputs; this view performs no array validation.
  if (!lines || /** @type {{length?: unknown}} */ (lines).length === 0) throw new Error('At least one journal line is required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_restaurant_journal_entry', {
    p_lodge_id: state.lodgeId,
    p_entry_date: entryDate,
    p_description: description,
    p_source_type: sourceType,
    p_source_id: sourceId || null,
    p_reference_number: referenceNumber || null,
    p_lines: lines
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to create journal entry');
  return data;
}

/** @param {unknown} accountId @param {unknown} [startDate] @param {unknown} [endDate] @returns {Promise<unknown>} */
function _getGeneralLedger(accountId, startDate = null, endDate = null) {
  const key = `gl:getGeneralLedger:${accountId}:${startDate || ''}:${endDate || ''}`;
  return dedupePromise(key, async () => {
    if (!state.isOnline) throw new Error('General Ledger requires online connection');
    if (!accountId) throw new Error('Account ID is required');
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_general_ledger', {
      p_lodge_id: state.lodgeId,
      p_account_id: accountId,
      p_start_date: startDate || null,
      p_end_date: endDate || null
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Failed to load general ledger');
    return data;
  });
}
export const getGeneralLedger = _getGeneralLedger;

/** @param {unknown} [asOfDate] @returns {Promise<unknown>} */
function _getTrialBalance(asOfDate = null) {
  const key = `gl:getTrialBalance:${asOfDate || ''}`;
  return dedupePromise(key, async () => {
    if (!state.isOnline) throw new Error('General Ledger requires online connection');
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_trial_balance', {
      p_lodge_id: state.lodgeId,
      p_as_of_date: asOfDate || null
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Failed to load trial balance');
    return data;
  });
}
export const getTrialBalance = _getTrialBalance;

/** @param {unknown} startDate @param {unknown} endDate @returns {Promise<unknown>} */
export async function postPosSalesToGL(startDate, endDate) {
  if (!state.isOnline) throw new Error('General Ledger requires online connection');
  if (!startDate || !endDate) throw new Error('Start and end dates are required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('post_pos_sales_to_gl', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate,
    p_end_date: endDate
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to post POS sales to GL');
  return data;
}

/** @param {unknown} startDate @param {unknown} endDate @returns {Promise<unknown>} */
export async function postExpensesToGL(startDate, endDate) {
  if (!state.isOnline) throw new Error('General Ledger requires online connection');
  if (!startDate || !endDate) throw new Error('Start and end dates are required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('post_expenses_to_gl', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate,
    p_end_date: endDate
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to post expenses to GL');
  return data;
}

/** @param {unknown} startDate @param {unknown} endDate @returns {Promise<unknown>} */
function _getProfitAndLoss(startDate, endDate) {
  const key = `gl:getProfitAndLoss:${startDate}:${endDate}`;
  return dedupePromise(key, async () => {
    if (!state.isOnline) throw new Error('General Ledger requires online connection');
    if (!startDate || !endDate) throw new Error('Start and end dates are required');
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_profit_and_loss', {
      p_lodge_id: state.lodgeId,
      p_start_date: startDate,
      p_end_date: endDate
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Failed to load profit and loss');
    return data;
  });
}
export const getProfitAndLoss = _getProfitAndLoss;

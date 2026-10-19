// @ts-check
import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

/** @returns {Promise<unknown>} */
async function _getBankAccounts() {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_bank_accounts', {
    p_lodge_id: state.lodgeId,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to load bank accounts');
  return data;
}
/** @param {...unknown} args @returns {Promise<unknown>} */
export const getBankAccounts = (...args) => dedupePromise('br:getBankAccounts', () => /** @type {(...args: unknown[]) => Promise<unknown>} */ (_getBankAccounts)(...args));

/** @param {Record<string, unknown>} param0 @returns {Promise<unknown>} */
export async function createBankAccount({ name, bank_name, account_number, account_type, opening_balance, account_id }) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_restaurant_bank_account', {
    p_lodge_id: state.lodgeId,
    p_name: name,
    p_account_id: account_id,
    p_bank_name: bank_name || null,
    p_account_number: account_number || null,
    p_account_type: account_type || 'checking',
    p_opening_balance: Number(opening_balance) || 0,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to create bank account');
  return data;
}

/** @param {Record<string, unknown>} param0 @returns {Promise<unknown>} */
export async function updateBankAccount({ id, name, bank_name, account_number, is_active }) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_restaurant_bank_account', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_name: name,
    p_bank_name: bank_name || null,
    p_account_number: account_number || null,
    p_is_active: is_active !== false,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to update bank account');
  return data;
}

/** @param {unknown} bankAccountId @param {unknown} transactions @param {unknown} statementHash @param {unknown} fileName @returns {Promise<unknown>} */
export async function importBankStatement(bankAccountId, transactions, statementHash, fileName) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('import_bank_statement', {
    p_lodge_id: state.lodgeId,
    p_bank_account_id: bankAccountId,
    p_transactions: transactions,
    p_statement_hash: statementHash,
    p_file_name: fileName,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to import transactions');
  return data;
}

/** @param {unknown} bankAccountId @param {Record<string, unknown>} [param1] @returns {Promise<unknown>} */
function _getBankTransactions(bankAccountId, { startDate, endDate, unreconciled } = {}) {
  const key = `br:getBankTransactions:${bankAccountId}:${startDate || ''}:${endDate || ''}:${unreconciled || false}`;
  return dedupePromise(key, async () => {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_bank_transactions', {
      p_lodge_id: state.lodgeId,
      p_bank_account_id: bankAccountId,
      p_start_date: startDate || null,
      p_end_date: endDate || null,
      p_unreconciled: unreconciled || false,
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Failed to load transactions');
    return data;
  });
}
export const getBankTransactions = _getBankTransactions;

/** @param {unknown} bankAccountId @returns {Promise<unknown>} */
export async function proposeBankMatches(bankAccountId) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('propose_bank_matches', {
    p_lodge_id: state.lodgeId,
    p_bank_account_id: bankAccountId,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to propose bank matches');
  return data;
}

/** @param {unknown} proposalId @param {unknown} approve @returns {Promise<unknown>} */
export async function approveBankMatch(proposalId, approve) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('approve_bank_match', {
    p_lodge_id: state.lodgeId,
    p_proposal_id: proposalId,
    p_approve: approve,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to approve bank match');
  return data;
}

/** @param {Record<string, unknown>} param0 @returns {Promise<unknown>} */
export async function createBankReconciliation({ bankAccountId, statementBalance, reconciliationDate, transactionIds }) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_bank_reconciliation', {
    p_lodge_id: state.lodgeId,
    p_bank_account_id: bankAccountId,
    p_statement_balance: Number(statementBalance),
    p_reconciliation_date: reconciliationDate,
    p_transaction_ids: transactionIds,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to create reconciliation');
  return data;
}

/** @param {unknown} id @param {unknown} notes @returns {Promise<unknown>} */
export async function completeBankReconciliation(id, notes) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('complete_bank_reconciliation', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_notes: notes || null,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to complete reconciliation');
  return data;
}

/** @param {unknown} bankAccountId @returns {Promise<unknown>} */
function _getBankReconciliations(bankAccountId) {
  const key = `br:getBankReconciliations:${bankAccountId || ''}`;
  return dedupePromise(key, async () => {
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_bank_reconciliations', {
      p_lodge_id: state.lodgeId,
      p_bank_account_id: bankAccountId,
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Failed to load reconciliations');
    return data;
  });
}
export const getBankReconciliations = _getBankReconciliations;

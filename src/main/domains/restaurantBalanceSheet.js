// @ts-check
import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

/** @param {unknown} [asOfDate] */
function _getBalanceSheet(asOfDate = null) {
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_balance_sheet', {
    p_lodge_id: state.lodgeId,
    p_as_of_date: asOfDate || null,
  });
}

/** @param {unknown} [asOfDate] @returns {Promise<unknown>} */
export function getBalanceSheet(asOfDate = null) {
  return dedupePromise(`getBalanceSheet:${asOfDate}`, async () => {
    if (!state.isOnline) throw new Error('Balance Sheet requires online connection');
    const { data, error } = await _getBalanceSheet(asOfDate);
    if (error) throw new Error(error.message);
    return data || {};
  });
}

/** @param {unknown} startDate @param {unknown} endDate */
function _getIncomeStatement(startDate, endDate) {
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_income_statement', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
}

/** @param {unknown} startDate @param {unknown} endDate @returns {Promise<unknown>} */
export function getIncomeStatement(startDate, endDate) {
  return dedupePromise(`getIncomeStatement:${startDate}:${endDate}`, async () => {
    if (!state.isOnline) throw new Error('Income Statement requires online connection');
    const { data, error } = await _getIncomeStatement(startDate, endDate);
    if (error) throw new Error(error.message);
    return data || {};
  });
}

/** @param {unknown} startDate @param {unknown} endDate */
function _getCashFlowStatement(startDate, endDate) {
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_cash_flow_statement', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
}

/** @param {unknown} startDate @param {unknown} endDate @returns {Promise<unknown>} */
export function getCashFlowStatement(startDate, endDate) {
  return dedupePromise(`getCashFlowStatement:${startDate}:${endDate}`, async () => {
    if (!state.isOnline) throw new Error('Cash Flow Statement requires online connection');
    const { data, error } = await _getCashFlowStatement(startDate, endDate);
    if (error) throw new Error(error.message);
    return data || {};
  });
}

/** @param {unknown} startDate @param {unknown} endDate */
function _getFinancialStatements(startDate, endDate) {
  return /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_financial_statements', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
}

/** @param {unknown} startDate @param {unknown} endDate @returns {Promise<unknown>} */
export function getFinancialStatements(startDate, endDate) {
  return dedupePromise(`getFinancialStatements:${startDate}:${endDate}`, async () => {
    if (!state.isOnline) throw new Error('Financial Statements require online connection');
    const { data, error } = await _getFinancialStatements(startDate, endDate);
    if (error) throw new Error(error.message);
    return data || {};
  });
}

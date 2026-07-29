import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

function _getBalanceSheet(asOfDate = null) {
  return state.supabase.rpc('get_restaurant_balance_sheet', {
    p_lodge_id: state.lodgeId,
    p_as_of_date: asOfDate || null,
  });
}

export function getBalanceSheet(asOfDate = null) {
  return dedupePromise(`getBalanceSheet:${asOfDate}`, async () => {
    if (!state.isOnline) throw new Error('Balance Sheet requires online connection');
    const { data, error } = await _getBalanceSheet(asOfDate);
    if (error) throw new Error(error.message);
    return data || {};
  });
}

function _getIncomeStatement(startDate, endDate) {
  return state.supabase.rpc('get_restaurant_income_statement', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
}

export function getIncomeStatement(startDate, endDate) {
  return dedupePromise(`getIncomeStatement:${startDate}:${endDate}`, async () => {
    if (!state.isOnline) throw new Error('Income Statement requires online connection');
    const { data, error } = await _getIncomeStatement(startDate, endDate);
    if (error) throw new Error(error.message);
    return data || {};
  });
}

function _getCashFlowStatement(startDate, endDate) {
  return state.supabase.rpc('get_restaurant_cash_flow_statement', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
}

export function getCashFlowStatement(startDate, endDate) {
  return dedupePromise(`getCashFlowStatement:${startDate}:${endDate}`, async () => {
    if (!state.isOnline) throw new Error('Cash Flow Statement requires online connection');
    const { data, error } = await _getCashFlowStatement(startDate, endDate);
    if (error) throw new Error(error.message);
    return data || {};
  });
}

function _getFinancialStatements(startDate, endDate) {
  return state.supabase.rpc('get_restaurant_financial_statements', {
    p_lodge_id: state.lodgeId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
}

export function getFinancialStatements(startDate, endDate) {
  return dedupePromise(`getFinancialStatements:${startDate}:${endDate}`, async () => {
    if (!state.isOnline) throw new Error('Financial Statements require online connection');
    const { data, error } = await _getFinancialStatements(startDate, endDate);
    if (error) throw new Error(error.message);
    return data || {};
  });
}

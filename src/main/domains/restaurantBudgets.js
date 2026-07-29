import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

export function getBudgets(year) {
  return dedupePromise(`getBudgets:${year}`, async () => {
    if (!state.isOnline) throw new Error('Budgets require online connection');
    const { data, error } = await state.supabase.rpc('get_restaurant_budgets', {
      p_lodge_id: state.lodgeId,
      p_year: year
    });
    if (error) throw new Error(error.message);
    return data || [];
  });
}

export async function setBudget(accountId, year, month, amount, notes = null) {
  if (!state.isOnline) throw new Error('Budgets require online connection');
  const { data, error } = await state.supabase.rpc('set_restaurant_budget', {
    p_lodge_id: state.lodgeId,
    p_account_id: accountId,
    p_year: year,
    p_month: month,
    p_amount: amount,
    p_notes: notes
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to save budget');
  return data;
}

export async function bulkSetBudgets(year, month, entries) {
  if (!state.isOnline) throw new Error('Budgets require online connection');
  const { data, error } = await state.supabase.rpc('bulk_set_restaurant_budgets', {
    p_lodge_id: state.lodgeId,
    p_year: year,
    p_month: month,
    p_entries: entries
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to save budgets');
  return data;
}

export async function copyBudgetToYear(fromYear, toYear) {
  if (!state.isOnline) throw new Error('Budgets require online connection');
  const { data, error } = await state.supabase.rpc('copy_budget_to_year', {
    p_lodge_id: state.lodgeId,
    p_from_year: fromYear,
    p_to_year: toYear
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to copy budgets');
  return data;
}

export function getBudgetVsActual(year, month) {
  return dedupePromise(`getBudgetVsActual:${year}:${month}`, async () => {
    if (!state.isOnline) throw new Error('Budget vs Actual requires online connection');
    const { data, error } = await state.supabase.rpc('get_budget_vs_actual', {
      p_lodge_id: state.lodgeId,
      p_year: year,
      p_month: month
    });
    if (error) throw new Error(error.message);
    return data || [];
  });
}

export function getBudgetVsActualSummary(year, startMonth = 1, endMonth = 12) {
  return dedupePromise(`getBudgetVsActualSummary:${year}:${startMonth}:${endMonth}`, async () => {
    if (!state.isOnline) throw new Error('Budget vs Actual Summary requires online connection');
    const { data, error } = await state.supabase.rpc('get_budget_vs_actual_summary', {
      p_lodge_id: state.lodgeId,
      p_year: year,
      p_start_month: startMonth,
      p_end_month: endMonth
    });
    if (error) throw new Error(error.message);
    return data || [];
  });
}

export async function getTemplates() {
  if (!state.isOnline) throw new Error('Budget templates require online connection');
  const { data, error } = await state.supabase.rpc('get_restaurant_budget_templates', {
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  return data || [];
}

export async function createTemplate(name, description = null, lines = []) {
  if (!state.isOnline) throw new Error('Budget templates require online connection');
  const { data, error } = await state.supabase.rpc('create_restaurant_budget_template', {
    p_lodge_id: state.lodgeId,
    p_name: name,
    p_description: description,
    p_lines: lines
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to create template');
  return data;
}

export async function applyTemplate(templateId, year, month) {
  if (!state.isOnline) throw new Error('Budget templates require online connection');
  const { data, error } = await state.supabase.rpc('apply_restaurant_budget_template', {
    p_lodge_id: state.lodgeId,
    p_template_id: templateId,
    p_year: year,
    p_month: month
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to apply template');
  return data;
}

export async function deleteTemplate(templateId) {
  if (!state.isOnline) throw new Error('Budget templates require online connection');
  const { data, error } = await state.supabase.rpc('delete_restaurant_budget_template', {
    p_lodge_id: state.lodgeId,
    p_template_id: templateId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Failed to delete template');
  return data;
}

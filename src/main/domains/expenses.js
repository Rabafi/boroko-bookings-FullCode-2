import { state } from '../state.js';
import { MAX_FINANCIAL_AMOUNT } from './shared.js';
import {
  readCache,
  writeCache
} from './infrastructure.js';

function payloadHasAmount(payload) {
  return !!payload && Object.prototype.hasOwnProperty.call(payload, 'amount');
}

export async function getExpenses(startDate, endDate, outletId = 'all') {
  const canonicalExpenses = readCache('expenses');
  const cachedExpenses = canonicalExpenses.
  filter((row) =>
  (!startDate || row.date >= startDate) && (
  !endDate || row.date <= endDate) && (

  !outletId ||
  outletId === 'all' || (
  outletId === 'unassigned' ? !row.outlet_id : row.outlet_id === outletId))

  ).
  sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const isCanonicalExpenseLoad =
  (!outletId || outletId === 'all') &&
  startDate === '2000-01-01' &&
  endDate === '2099-12-31';
  if (state.isOnline) {
    let query = state.supabase.
    from('expenses').
    select('*, outlets(name)').
    eq('lodge_id', state.lodgeId);
    if (startDate) query = query.gte('date', startDate);
    if (endDate) query = query.lte('date', endDate);
    if (outletId && outletId !== 'all') {
      if (outletId === 'unassigned') query = query.is('outlet_id', null);else
      query = query.eq('outlet_id', outletId);
    }
    const { data, error } = await query.order('date', { ascending: false });
    if (!error) {
      if ((data || []).length === 0 && cachedExpenses.length > 0) {
        console.warn('getExpenses received empty live result; using cached expenses instead');
        return cachedExpenses;
      }
      if (isCanonicalExpenseLoad) {
        writeCache('expenses', data || []);
      }
      return data || [];
    }
    if (cachedExpenses.length > 0) {
      console.warn('getExpenses falling back to cache:', error.message);
      return cachedExpenses;
    }
    throw new Error(error.message);
  }
  return cachedExpenses;
}

export async function getExpenseById(id) {
  if (!id || !state.isOnline) return null;
  const { data, error } = await state.supabase.
  from('expenses').
  select('*').
  eq('lodge_id', state.lodgeId).
  eq('id', id).
  single();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function createExpense(data) {
  if (Number(data.amount) <= 0) throw new Error('Expense amount must be greater than zero');
  if (Number(data.amount) > MAX_FINANCIAL_AMOUNT) throw new Error(`Expense amount cannot exceed P${MAX_FINANCIAL_AMOUNT.toLocaleString('en-BW')}`);
  const expense = {
    lodge_id: state.lodgeId,
    date: data.date,
    category: data.category,
    description: data.description,
    amount: Number(data.amount),
    notes: data.notes || null,
    outlet_id: data.outlet_id || null
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_expense', { payload: expense });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create expense');
    const cached = readCache('expenses');
    writeCache('expenses', [{ ...expense, id: result?.id }, ...cached.filter((row) => row.id !== result?.id)]);
    return { success: true, id: result?.id };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function updateExpense(id, data) {
  if (payloadHasAmount(data) && Number(data.amount) <= 0) throw new Error('Expense amount must be greater than zero');
  if (payloadHasAmount(data) && Number(data.amount) > MAX_FINANCIAL_AMOUNT) throw new Error(`Expense amount cannot exceed P${MAX_FINANCIAL_AMOUNT.toLocaleString('en-BW')}`);
  const update = {
    date: data.date,
    category: data.category,
    description: data.description,
    amount: Number(data.amount),
    notes: data.notes || null,
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {})
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('update_expense', {
      p_id: id,
      p_lodge_id: state.lodgeId,
      payload: update
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not update expense');
    const cached = readCache('expenses');
    writeCache('expenses', cached.map((row) => row.id === id ? { ...row, ...update } : row));
    return { success: true };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function deleteExpense(id) {
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_expense', {
      p_id: id,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not delete expense');
    writeCache('expenses', readCache('expenses').filter((row) => row.id !== id));
    return { success: true };
  }
  return { success: false, error: 'Requires internet connection' };
}

export async function getAdminExpenses() {
  return getExpenses('2000-01-01', '2099-12-31');
}

export async function createAdminExpense(data) {
  return createExpense(data);
}

export async function updateAdminExpense(id, data) {
  return updateExpense(id, data);
}

export async function deleteAdminExpense(id) {
  return deleteExpense(id);
}

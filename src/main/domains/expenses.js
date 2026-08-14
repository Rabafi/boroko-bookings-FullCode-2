import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { MAX_FINANCIAL_AMOUNT } from './shared.js';
import {
  queueOperation,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

function payloadHasAmount(payload) {
  return !!payload && Object.prototype.hasOwnProperty.call(payload, 'amount');
}

function withReadMetadata(rows, source, complete) {
  const output = Array.isArray(rows) ? rows : [];
  Object.defineProperties(output, {
    _source: { value: source, enumerable: true, configurable: true },
    _complete: { value: complete, enumerable: true, configurable: true },
  });
  return output;
}

async function _getExpenses(startDate, endDate, outletId = 'all') {
  const canonicalExpenses = readCache('expenses');
  const cachedExpenses = canonicalExpenses.
  filter((row) => row?._deleted_offline !== true).
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
    const rows = [];
    let error = null;
    for (let from = 0; from < 100000; from += 1000) {
      let query = state.supabase.
      from('expenses').
      select('id, date, category, description, amount, notes, outlet_id, status, operation_id, journal_entry_id, source_kind, source_document_type, source_document_id, supplier_id, payee_name, payment_method, payment_account_id, expense_account_id, tax_code, tax_amount, reference_number, evidence_ref, submitted_by, submitted_at, approved_by, approved_at, posted_by, posted_at, paid_by, paid_at, payment_journal_entry_id, reversed_by, reversed_at, reversal_journal_entry_id, created_at, updated_at, outlets(name)').
      eq('lodge_id', state.lodgeId);
      if (startDate) query = query.gte('date', startDate);
      if (endDate) query = query.lte('date', endDate);
      if (outletId && outletId !== 'all') {
        if (outletId === 'unassigned') query = query.is('outlet_id', null); else query = query.eq('outlet_id', outletId);
      }
      const page = await query.order('date', { ascending: false }).order('id', { ascending: false }).range(from, from + 999);
      if (page.error) { error = page.error; break; }
      rows.push(...(page.data || []));
      if ((page.data || []).length < 1000) break;
    }
    if (!error) {
      if (isCanonicalExpenseLoad) writeCache('expenses', rows);
      return withReadMetadata(rows, 'server', true);
    }
    throw new Error(error.message);
  }
  return withReadMetadata(cachedExpenses, 'cache', false);
}

export function getExpenses(startDate, endDate, outletId = 'all') {
  return dedupePromise(`getExpenses:${startDate}:${endDate}:${outletId}`, () => _getExpenses(startDate, endDate, outletId));
}

export async function getExpenseById(id) {
  if (!id) return null;
  if (!state.isOnline) return readCache('expenses').find((row) => row?.id === id) || null;
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
  const id = data.id || randomUUID();
  const expense = {
    id,
    lodge_id: state.lodgeId,
    date: data.date,
    category: data.category,
    description: data.description,
    amount: Number(data.amount),
    notes: data.notes || null,
    outlet_id: data.outlet_id || null,
    operation_id: id,
    evidence_ref: data.evidence_ref || null,
    source_kind: data.source_kind || 'direct',
    source_document_type: data.source_document_type || null,
    source_document_id: data.source_document_id || null,
    supplier_id: data.supplier_id || null,
    payee_name: data.payee_name || null,
    payment_method: data.payment_method || null,
    payment_account_id: data.payment_account_id || null,
    expense_account_id: data.expense_account_id || null,
    tax_code: data.tax_code || null,
    tax_amount: Number(data.tax_amount || 0),
    reference_number: data.reference_number || null,
    duplicate_fingerprint: data.duplicate_fingerprint || null,
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('create_expense', { payload: expense });
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not create expense');
    const cached = readCache('expenses');
    writeCache('expenses', [{ ...expense, id: result?.id }, ...cached.filter((row) => row.id !== result?.id)]);
    return { success: true, id: result?.id };
  }
  const offlineExpense = {
    ...expense,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null
  };
  writeCache('expenses', [offlineExpense, ...readCache('expenses').filter((row) => row?.id !== id)]);
  queueOperation('rpc', 'create_expense', { payload: expense }, null, {
    _queue_id: `expense-${id}`
  });
  return { success: true, id, offline: true, queued: true };
}

export async function updateExpense(id, data) {
  if (payloadHasAmount(data) && Number(data.amount) <= 0) throw new Error('Expense amount must be greater than zero');
  if (payloadHasAmount(data) && Number(data.amount) > MAX_FINANCIAL_AMOUNT) throw new Error(`Expense amount cannot exceed P${MAX_FINANCIAL_AMOUNT.toLocaleString('en-BW')}`);
  const update = {
    ...(data.date !== undefined ? { date: data.date } : {}),
    ...(data.category !== undefined ? { category: data.category } : {}),
    ...(data.description !== undefined ? { description: data.description } : {}),
    ...(payloadHasAmount(data) ? { amount: Number(data.amount) } : {}),
    ...(data.notes !== undefined ? { notes: data.notes || null } : {}),
    ...(data.outlet_id !== undefined ? { outlet_id: data.outlet_id || null } : {}),
    ...(data.evidence_ref !== undefined ? { evidence_ref: data.evidence_ref || null } : {}),
    ...(data.source_kind !== undefined ? { source_kind: data.source_kind || 'direct' } : {}),
    ...(data.source_document_type !== undefined ? { source_document_type: data.source_document_type || null } : {}),
    ...(data.source_document_id !== undefined ? { source_document_id: data.source_document_id || null } : {}),
    ...(data.supplier_id !== undefined ? { supplier_id: data.supplier_id || null } : {}),
    ...(data.payee_name !== undefined ? { payee_name: data.payee_name || null } : {}),
    ...(data.payment_method !== undefined ? { payment_method: data.payment_method || null } : {}),
    ...(data.payment_account_id !== undefined ? { payment_account_id: data.payment_account_id || null } : {}),
    ...(data.expense_account_id !== undefined ? { expense_account_id: data.expense_account_id || null } : {}),
    ...(data.tax_code !== undefined ? { tax_code: data.tax_code || null } : {}),
    ...(data.tax_amount !== undefined ? { tax_amount: Number(data.tax_amount || 0) } : {}),
    ...(data.reference_number !== undefined ? { reference_number: data.reference_number || null } : {})
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
  const cached = readCache('expenses');
  const existing = cached.find((row) => row?.id === id);
  if (!existing) return { success: false, error: 'Expense not found in offline cache' };
  writeCache('expenses', cached.map((row) => row.id === id ? {
    ...row,
    ...update,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : row));
  queueOperation('rpc', 'update_expense', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    payload: update
  }, null, {
    _queue_id: `expense-update-${id}-${Date.now()}`,
    ...(existing?._pending_sync ? { _depends_on: `expense-${id}` } : {})
  });
  return { success: true, offline: true, queued: true };
}

async function transitionExpense(id, action, payload = {}, operationId = randomUUID()) {
  const args = { p_id: id, p_lodge_id: state.lodgeId, p_operation_id: operationId, p_payload: payload };
  const rpcName = `${action}_expense`;
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc(rpcName, args);
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || `Could not ${action} expense`);
    const cached = readCache('expenses');
    writeCache('expenses', cached.map((row) => row.id === id ? { ...row, ...result, status: result.status || row.status } : row));
    return result;
  }
  const cached = readCache('expenses');
  const existing = cached.find((row) => row?.id === id);
  if (!existing) return { success: false, error: 'Expense not found in offline cache' };
  writeCache('expenses', cached.map((row) => row.id === id ? {
    ...row,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : row));
  queueOperation('rpc', rpcName, args, null, {
    _queue_id: `expense-${action}-${id}-${operationId}`,
    ...(existing?._pending_sync ? { _depends_on: `expense-${id}` } : {})
  });
  return { success: true, id, status: existing.status, offline: true, queued: true, operation_id: operationId };
}

export async function submitExpense(id, payload = {}, operationId) {
  return transitionExpense(id, 'submit', payload, operationId);
}

export async function approveExpense(id, payload = {}, operationId) {
  return transitionExpense(id, 'approve', payload, operationId);
}

export async function postExpense(id, payload = {}, operationId) {
  return transitionExpense(id, 'post', payload, operationId);
}

export async function payExpense(id, payload = {}, operationId) {
  return transitionExpense(id, 'pay', payload, operationId);
}

export async function voidExpense(id, payload = {}, operationId) {
  return transitionExpense(id, 'void', payload, operationId);
}

export async function reverseExpense(id, payload = {}, operationId) {
  return transitionExpense(id, 'reverse', payload, operationId);
}

export async function deleteExpense(id, operationId) {
  const stableOperationId = operationId || randomUUID();
  const args = {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_operation_id: stableOperationId
  };
  if (state.isOnline) {
    const { data: result, error } = await state.supabase.rpc('delete_expense', args);
    if (error) throw new Error(error.message);
    if (!result?.success) throw new Error(result?.error || 'Could not void expense');
    const cached = readCache('expenses');
    writeCache('expenses', cached.map((row) => row.id === id ? { ...row, ...result, status: result.status || 'voided' } : row));
    return result;
  }
  const cached = readCache('expenses');
  const existing = cached.find((row) => row?.id === id);
  if (!existing) return { success: false, error: 'Expense not found in offline cache' };
  writeCache('expenses', cached.map((row) => row.id === id ? {
    ...row,
    _pending_sync: true,
    _sync_state: 'pending',
    _sync_error: null,
    updated_at: new Date().toISOString()
  } : row));
  queueOperation('rpc', 'delete_expense', args, null, {
    _queue_id: `expense-delete-${id}-${stableOperationId}`,
    ...(existing?._pending_sync ? { _depends_on: `expense-${id}` } : {})
  });
  return { success: true, id, status: existing.status, offline: true, queued: true, operation_id: stableOperationId };
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

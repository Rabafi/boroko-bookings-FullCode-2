import { state } from '../state.js';
import {
  queueOperation,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

async function _getPayrollSettings() {
  const { data, error } = await state.supabase.rpc('get_restaurant_payroll_settings', {
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not load payroll settings');
  return data.data;
}
export const getPayrollSettings = (...args) => dedupePromise('pr:getPayrollSettings', () => _getPayrollSettings(...args));

export async function updatePayrollSettings(settings) {
  const { data, error } = await state.supabase.rpc('update_restaurant_payroll_settings', {
    p_lodge_id: state.lodgeId,
    p_settings: settings
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not update payroll settings');
  return { success: true };
}

export async function createPayPeriod(name, startDate, endDate) {
  if (!name || !startDate || !endDate) throw new Error('Name, start date, and end date are required');
  const { data, error } = await state.supabase.rpc('create_pay_period', {
    p_lodge_id: state.lodgeId,
    p_name: name,
    p_start_date: startDate,
    p_end_date: endDate
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not create pay period');
  return { success: true, id: data.id };
}

async function _getPayPeriods() {
  const { data, error } = await state.supabase.rpc('get_pay_periods', {
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not load pay periods');
  return data.data || [];
}
export const getPayPeriods = (...args) => dedupePromise('pr:getPayPeriods', () => _getPayPeriods(...args));

export async function calculatePayroll(payPeriodId) {
  if (!payPeriodId) throw new Error('Pay period ID is required');
  const { data, error } = await state.supabase.rpc('calculate_payroll', {
    p_pay_period_id: payPeriodId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not calculate payroll');
  return data;
}

function _getPayPeriodRecords(payPeriodId) {
  const key = `pr:getPayPeriodRecords:${payPeriodId}`;
  return dedupePromise(key, async () => {
    if (!payPeriodId) throw new Error('Pay period ID is required');
    const { data, error } = await state.supabase.rpc('get_pay_period_records', {
      p_pay_period_id: payPeriodId,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not load pay records');
    return data.data || [];
  });
}
export const getPayPeriodRecords = _getPayPeriodRecords;

export async function updateEmployeePayRecord(recordId, overrides) {
  if (!recordId) throw new Error('Record ID is required');
  const { data, error } = await state.supabase.rpc('update_employee_pay_record', {
    p_id: recordId,
    p_lodge_id: state.lodgeId,
    p_overrides: overrides
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not update pay record');
  return { success: true };
}

export async function approvePayroll(payPeriodId) {
  if (!payPeriodId) throw new Error('Pay period ID is required');
  const { data, error } = await state.supabase.rpc('approve_payroll', {
    p_pay_period_id: payPeriodId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not approve payroll');
  return { success: true };
}

export async function generatePayslip(employeeRecordId) {
  if (!employeeRecordId) throw new Error('Employee record ID is required');
  const { data, error } = await state.supabase.rpc('generate_payslip', {
    p_employee_record_id: employeeRecordId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not generate payslip');
  return data.data;
}

export async function postPayrollToGL(payPeriodId) {
  if (!payPeriodId) throw new Error('Pay period ID is required');
  const { data, error } = await state.supabase.rpc('post_payroll_to_gl', {
    p_pay_period_id: payPeriodId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not post payroll to GL');
  return data;
}

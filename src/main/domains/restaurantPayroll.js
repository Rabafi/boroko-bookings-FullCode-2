// @ts-check
import { state } from '../state.js';
import {
  queueOperation,
  readCache,
  writeCache,
  dedupePromise
} from './infrastructure.js';

/** @returns {Promise<unknown>} */
async function _getPayrollSettings() {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_payroll_settings', {
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not load payroll settings');
  return data.data;
}
/** @param {...unknown} args @returns {Promise<unknown>} */
export const getPayrollSettings = (...args) => dedupePromise('pr:getPayrollSettings', () => /** @type {(...args: unknown[]) => Promise<unknown>} */ (_getPayrollSettings)(...args));

/** @param {unknown} settings @returns {Promise<{success: true}>} */
export async function updatePayrollSettings(settings) {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_restaurant_payroll_settings', {
    p_lodge_id: state.lodgeId,
    p_settings: settings
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not update payroll settings');
  return { success: true };
}

/** @param {unknown} name @param {unknown} startDate @param {unknown} endDate @returns {Promise<{success: true, id: unknown}>} */
export async function createPayPeriod(name, startDate, endDate) {
  if (!name || !startDate || !endDate) throw new Error('Name, start date, and end date are required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_pay_period', {
    p_lodge_id: state.lodgeId,
    p_name: name,
    p_start_date: startDate,
    p_end_date: endDate
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not create pay period');
  return { success: true, id: data.id };
}

/** @returns {Promise<unknown>} */
async function _getPayPeriods() {
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_pay_periods', {
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not load pay periods');
  return data.data || [];
}
/** @param {...unknown} args @returns {Promise<unknown>} */
export const getPayPeriods = (...args) => dedupePromise('pr:getPayPeriods', () => /** @type {(...args: unknown[]) => Promise<unknown>} */ (_getPayPeriods)(...args));

/** @param {unknown} payPeriodId @returns {Promise<unknown>} */
export async function calculatePayroll(payPeriodId) {
  if (!payPeriodId) throw new Error('Pay period ID is required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('calculate_payroll', {
    p_pay_period_id: payPeriodId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not calculate payroll');
  return data;
}

/** @param {unknown} payPeriodId @returns {Promise<unknown>} */
function _getPayPeriodRecords(payPeriodId) {
  const key = `pr:getPayPeriodRecords:${payPeriodId}`;
  return dedupePromise(key, async () => {
    if (!payPeriodId) throw new Error('Pay period ID is required');
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_pay_period_records', {
      p_pay_period_id: payPeriodId,
      p_lodge_id: state.lodgeId
    });
    if (error) throw new Error(error.message);
    if (!data?.success) throw new Error(data?.error || 'Could not load pay records');
    return data.data || [];
  });
}
export const getPayPeriodRecords = _getPayPeriodRecords;

/** @param {unknown} recordId @param {unknown} overrides @returns {Promise<{success: true}>} */
export async function updateEmployeePayRecord(recordId, overrides) {
  if (!recordId) throw new Error('Record ID is required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_employee_pay_record', {
    p_id: recordId,
    p_lodge_id: state.lodgeId,
    p_overrides: overrides
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not update pay record');
  return { success: true };
}

/** @param {unknown} payPeriodId @returns {Promise<{success: true}>} */
export async function approvePayroll(payPeriodId) {
  if (!payPeriodId) throw new Error('Pay period ID is required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('approve_payroll', {
    p_pay_period_id: payPeriodId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not approve payroll');
  return { success: true };
}

/** @param {unknown} employeeRecordId @returns {Promise<unknown>} */
export async function generatePayslip(employeeRecordId) {
  if (!employeeRecordId) throw new Error('Employee record ID is required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('generate_payslip', {
    p_employee_record_id: employeeRecordId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not generate payslip');
  return data.data;
}

/** @param {unknown} payPeriodId @returns {Promise<unknown>} */
export async function postPayrollToGL(payPeriodId) {
  if (!payPeriodId) throw new Error('Pay period ID is required');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('post_payroll_to_gl', {
    p_pay_period_id: payPeriodId,
    p_lodge_id: state.lodgeId
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not post payroll to GL');
  return data;
}

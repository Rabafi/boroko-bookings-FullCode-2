// @ts-check
import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

/** @param {unknown} periodStart @param {unknown} periodEnd @param {unknown} [taxRate] @returns {Promise<unknown>} */
export function generateTaxReturn(periodStart, periodEnd, taxRate = 14) {
  return dedupePromise(
    `generateTaxReturn:${periodStart}:${periodEnd}:${taxRate}`,
    async () => {
      if (!state.isOnline) throw new Error('Tax returns require an online connection');
      // Existing unconditional property access is represented by a type-only view; no new guard changes failure behavior.
      const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('generate_tax_return', {
        p_lodge_id: state.lodgeId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_tax_rate: taxRate,
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Could not generate tax return');
      return data;
    }
  );
}

/** @returns {Promise<unknown>} */
export function getTaxReturns() {
  return dedupePromise('getTaxReturns', async () => {
    if (!state.isOnline) throw new Error('Tax returns require an online connection');
    // Keep RPC data unknown beyond the existing property access.
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_restaurant_tax_returns', {
      p_lodge_id: state.lodgeId,
    });
    if (error) throw new Error(error.message);
    return data?.tax_returns || [];
  });
}

/** @param {unknown} id @param {{status?: unknown, notes?: unknown}} updates @returns {Promise<unknown>} */
export async function updateTaxReturn(id, updates) {
  if (!state.isOnline) throw new Error('Tax returns require an online connection');
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('update_tax_return', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_status: updates.status || null,
    p_notes: updates.notes !== undefined ? updates.notes : null,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not update tax return');
  return data;
}

/** @param {unknown} periodStart @param {unknown} periodEnd @returns {Promise<unknown>} */
export function getTaxReturnSummary(periodStart, periodEnd) {
  return dedupePromise(
    `getTaxReturnSummary:${periodStart}:${periodEnd}`,
    async () => {
      if (!state.isOnline) throw new Error('Tax returns require an online connection');
      const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_tax_return_summary', {
        p_lodge_id: state.lodgeId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      if (error) throw new Error(error.message);
      return data;
    }
  );
}

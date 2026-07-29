import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

export function generateTaxReturn(periodStart, periodEnd, taxRate = 14) {
  return dedupePromise(
    `generateTaxReturn:${periodStart}:${periodEnd}:${taxRate}`,
    async () => {
      if (!state.isOnline) throw new Error('Tax returns require an online connection');
      const { data, error } = await state.supabase.rpc('generate_tax_return', {
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

export function getTaxReturns() {
  return dedupePromise('getTaxReturns', async () => {
    if (!state.isOnline) throw new Error('Tax returns require an online connection');
    const { data, error } = await state.supabase.rpc('get_restaurant_tax_returns', {
      p_lodge_id: state.lodgeId,
    });
    if (error) throw new Error(error.message);
    return data?.tax_returns || [];
  });
}

export async function updateTaxReturn(id, updates) {
  if (!state.isOnline) throw new Error('Tax returns require an online connection');
  const { data, error } = await state.supabase.rpc('update_tax_return', {
    p_id: id,
    p_lodge_id: state.lodgeId,
    p_status: updates.status || null,
    p_notes: updates.notes !== undefined ? updates.notes : null,
  });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not update tax return');
  return data;
}

export function getTaxReturnSummary(periodStart, periodEnd) {
  return dedupePromise(
    `getTaxReturnSummary:${periodStart}:${periodEnd}`,
    async () => {
      if (!state.isOnline) throw new Error('Tax returns require an online connection');
      const { data, error } = await state.supabase.rpc('get_tax_return_summary', {
        p_lodge_id: state.lodgeId,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      if (error) throw new Error(error.message);
      return data;
    }
  );
}

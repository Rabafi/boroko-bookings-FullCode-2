/**
 * Accounting domain — MRR/ARR, Revenue Summary, Lodge Financial Summary
 * Schema-corrected: uses bookings+payments for financial truth, licenses for MRR
 */
import { state } from '../state.js'

function adminRpc(name, params = {}) {
  return state.adminDb.rpc(name, params)
}

export async function getMrrSummary() {
  try {
    const { data, error } = await adminRpc('app_get_mrr_summary')
    if (error) throw error
    return data || { ok: true, mrr: 0, arr: 0, lodge_count: 0, trials_active: 0, by_plan: {} }
  } catch (err) {
    console.error('[Accounting] getMrrSummary error:', err)
    return { ok: false, error: err.message, mrr: 0, arr: 0, lodge_count: 0, trials_active: 0, by_plan: {} }
  }
}

export async function getRevenueSummary(days = 90) {
  try {
    const { data, error } = await adminRpc('app_get_revenue_summary', { p_days: days })
    if (error) throw error
    return data || { ok: true, daily: [], total_revenue: 0, payment_count: 0, avg_daily: 0 }
  } catch (err) {
    console.error('[Accounting] getRevenueSummary error:', err)
    return { ok: false, error: err.message, daily: [], total_revenue: 0, payment_count: 0, avg_daily: 0 }
  }
}

export async function getLodgeFinancialSummary() {
  try {
    const { data, error } = await adminRpc('app_get_lodge_financial_summary')
    if (error) throw error
    return data || { ok: true, lodges: [] }
  } catch (err) {
    console.error('[Accounting] getLodgeFinancialSummary error:', err)
    return { ok: false, error: err.message, lodges: [] }
  }
}

export async function getCollectionsQueue() {
  try {
    const { data, error } = await adminRpc('app_get_collections_queue')
    if (error) throw error
    return data || { ok: true, queue: [] }
  } catch (err) {
    console.error('[Accounting] getCollectionsQueue error:', err)
    return { ok: false, error: err.message, queue: [] }
  }
}

export async function getRevenueByMethod(days = 90) {
  try {
    const { data, error } = await adminRpc('app_get_revenue_by_method', { p_days: days })
    if (error) throw error
    return data || { ok: true, methods: [] }
  } catch (err) {
    console.error('[Accounting] getRevenueByMethod error:', err)
    return { ok: false, error: err.message, methods: [] }
  }
}

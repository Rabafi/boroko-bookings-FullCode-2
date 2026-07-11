import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'master-folios'

async function _getAllMasterFolios() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    const { data, error } = await state.supabase.rpc('rpc', { fn: 'get_master_folios', args: { p_lodge_id: currentLodgeId } })
    if (error) throw error
    const rows = Array.isArray(data) ? data : []
    writeCache(CACHE_KEY, rows)
    return rows
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    return Array.isArray(cached) ? cached : []
  }
}

export const getAllMasterFolios = (...args) => dedupePromise('getAllMasterFolios', () => _getAllMasterFolios(...args))

export async function createMasterFolio(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('create_master_folio', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function getDebtorAging(corporateAccountId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('get_debtor_aging', {
    p_lodge_id: currentLodgeId,
    p_corporate_account_id: corporateAccountId
  })
  if (error) throw error
  return data
}

export async function checkCreditLimit(corporateAccountId, additionalAmount, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('check_credit_limit', {
    p_lodge_id: currentLodgeId,
    p_corporate_account_id: corporateAccountId,
    p_additional_amount: additionalAmount
  })
  if (error) throw error
  return data
}

export async function generateCompanyStatement(corporateAccountId, periodStart, periodEnd, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('generate_company_statement', {
    p_lodge_id: currentLodgeId,
    p_corporate_account_id: corporateAccountId,
    p_period_start: periodStart,
    p_period_end: periodEnd
  })
  if (error) throw error
  return data
}

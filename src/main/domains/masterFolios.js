// @ts-check
import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'master-folios'

/** @returns {Promise<unknown[]>} */
async function _getAllMasterFolios() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return []
  try {
    // This unconditional type-only client view preserves native access failure before initialization.
    const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('rpc', { fn: 'get_master_folios', args: { p_lodge_id: currentLodgeId } })
    if (error) throw error
    // RPC row fields have no local validator.
    const rows = /** @type {unknown[]} */ (Array.isArray(data) ? data : [])
    writeCache(CACHE_KEY, rows)
    return rows
  } catch (e) {
    const cached = readCache(CACHE_KEY)
    return Array.isArray(cached) ? /** @type {unknown[]} */ (cached) : []
  }
}

/** @param {...unknown} args @returns {Promise<unknown[]>} */
export const getAllMasterFolios = (...args) => {
  // This dedicated key's factory returns [] or array-only RPC/cache rows.
  return /** @type {Promise<unknown[]>} */ (dedupePromise('getAllMasterFolios', () => _getAllMasterFolios()))
}

/** @param {unknown} payload @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function createMasterFolio(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('create_master_folio', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  return data
}

/** @param {unknown} corporateAccountId @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function getDebtorAging(corporateAccountId, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('get_debtor_aging', {
    p_lodge_id: currentLodgeId,
    p_corporate_account_id: corporateAccountId
  })
  if (error) throw error
  return data
}

/** @param {unknown} corporateAccountId @param {unknown} additionalAmount @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function checkCreditLimit(corporateAccountId, additionalAmount, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('check_credit_limit', {
    p_lodge_id: currentLodgeId,
    p_corporate_account_id: corporateAccountId,
    p_additional_amount: additionalAmount
  })
  if (error) throw error
  return data
}

/** @param {unknown} corporateAccountId @param {unknown} periodStart @param {unknown} periodEnd @param {unknown} [lodgeIdArg] @returns {Promise<unknown>} */
export async function generateCompanyStatement(corporateAccountId, periodStart, periodEnd, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await /** @type {NonNullable<typeof state.supabase>} */ (state.supabase).rpc('generate_company_statement', {
    p_lodge_id: currentLodgeId,
    p_corporate_account_id: corporateAccountId,
    p_period_start: periodStart,
    p_period_end: periodEnd
  })
  if (error) throw error
  return data
}

// @ts-check

import { state } from '../state.js';
import { dedupePromise } from './infrastructure.js';

/** @typedef {{data: unknown, error: unknown, source: 'unavailable' | 'server_rpc', authority: 'none' | 'ledger_derived'}} AdvancedReportResult */

/**
 * Advanced hotel reports are online-only RPC reads.
 * Parameter names match the live (post lint-repair) signatures: p_from / p_to.
 * Values are never invented client-side — empty/error responses surface as-is.
 */
/** @param {string} rpcName @param {Record<string, unknown>} [params] @returns {Promise<AdvancedReportResult>} */
async function callReportRpc(rpcName, params = {}) {
  if (!state.isOnline) {
    return {
      data: null,
      error: 'Online connection required for advanced reports',
      source: 'unavailable',
      authority: 'none'
    };
  }
  if (!state.supabase || !state.lodgeId) {
    return {
      data: null,
      error: 'Lodge session required for advanced reports',
      source: 'unavailable',
      authority: 'none'
    };
  }
  try {
    const { data, error } = await state.supabase.rpc(rpcName, {
      p_lodge_id: state.lodgeId,
      ...params
    });
    if (error) throw error;
    if (data?.success === false) {
      return {
        data: null,
        error: data.error || `${rpcName} failed`,
        source: 'server_rpc',
        authority: 'none'
      };
    }
    return {
      data,
      error: null,
      source: 'server_rpc',
      authority: 'ledger_derived'
    };
  } catch (err) {
    // Type-only view of the existing optional message access; the RPC error is
    // not validated or rewritten, and the original property access remains.
    const errorView = /** @type {{message?: unknown} | null | undefined} */ (err);
    return {
      data: null,
      error: errorView?.message || `${rpcName} failed`,
      source: 'server_rpc',
      authority: 'none'
    };
  }
}

/** @param {string} startDate @param {string} endDate @returns {{p_from: string, p_to: string}} */
function dateRangeParams(startDate, endDate) {
  return { p_from: startDate, p_to: endDate };
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getOccupancy(startDate, endDate) {
  return callReportRpc('get_occupancy_report', dateRangeParams(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getPace(startDate, endDate) {
  return callReportRpc('get_pace_report', dateRangeParams(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getPickup(startDate, endDate) {
  return callReportRpc('get_pickup_report', dateRangeParams(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getChannelSource(startDate, endDate) {
  return callReportRpc('get_channel_source_report', dateRangeParams(startDate, endDate));
}

/** @returns {Promise<AdvancedReportResult>} */
function _getDebtorAging() {
  // Optional second arg for corporate filter; null = all accounts
  return callReportRpc('get_debtor_aging_detail', { p_corporate_account_id: null });
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getRatePerformance(startDate, endDate) {
  return callReportRpc('get_rate_performance_report', dateRangeParams(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getHousekeepingProductivity(startDate, endDate) {
  return callReportRpc('get_housekeeping_productivity', dateRangeParams(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getRoomDowntime(startDate, endDate) {
  return callReportRpc('get_room_downtime_report', dateRangeParams(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getGroupPickup(startDate, endDate) {
  return callReportRpc('get_group_pickup_report', dateRangeParams(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getCancellationNoShow(startDate, endDate) {
  return callReportRpc('get_cancellation_no_show_report', dateRangeParams(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<AdvancedReportResult>} */
function _getTaxVat(startDate, endDate) {
  return callReportRpc('get_tax_vat_report', dateRangeParams(startDate, endDate));
}

/** @returns {Promise<AdvancedReportResult>} */
function _getDepositLiability() {
  return callReportRpc('get_deposit_liability_report', {});
}

/** @returns {Promise<AdvancedReportResult>} */
function _getFolioExceptions() {
  return callReportRpc('get_folio_exception_report', {});
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getOccupancy(startDate, endDate) {
  return dedupePromise(`advReport:occupancy:${startDate}:${endDate}`, () => _getOccupancy(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getPace(startDate, endDate) {
  return dedupePromise(`advReport:pace:${startDate}:${endDate}`, () => _getPace(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getPickup(startDate, endDate) {
  return dedupePromise(`advReport:pickup:${startDate}:${endDate}`, () => _getPickup(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getChannelSource(startDate, endDate) {
  return dedupePromise(`advReport:channelSource:${startDate}:${endDate}`, () => _getChannelSource(startDate, endDate));
}

/** @returns {Promise<unknown>} */
export function getDebtorAging() {
  return dedupePromise('advReport:debtorAging', _getDebtorAging);
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getRatePerformance(startDate, endDate) {
  return dedupePromise(`advReport:ratePerformance:${startDate}:${endDate}`, () => _getRatePerformance(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getHousekeepingProductivity(startDate, endDate) {
  return dedupePromise(`advReport:housekeepingProductivity:${startDate}:${endDate}`, () => _getHousekeepingProductivity(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getRoomDowntime(startDate, endDate) {
  return dedupePromise(`advReport:roomDowntime:${startDate}:${endDate}`, () => _getRoomDowntime(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getGroupPickup(startDate, endDate) {
  return dedupePromise(`advReport:groupPickup:${startDate}:${endDate}`, () => _getGroupPickup(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getCancellationNoShow(startDate, endDate) {
  return dedupePromise(`advReport:cancellationNoShow:${startDate}:${endDate}`, () => _getCancellationNoShow(startDate, endDate));
}

/** @param {string} startDate @param {string} endDate @returns {Promise<unknown>} */
export function getTaxVat(startDate, endDate) {
  return dedupePromise(`advReport:taxVat:${startDate}:${endDate}`, () => _getTaxVat(startDate, endDate));
}

/** @returns {Promise<unknown>} */
export function getDepositLiability() {
  return dedupePromise('advReport:depositLiability', _getDepositLiability);
}

/** @returns {Promise<unknown>} */
export function getFolioExceptions() {
  return dedupePromise('advReport:folioExceptions', _getFolioExceptions);
}

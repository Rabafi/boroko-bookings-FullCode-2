// @ts-check
/**
 * A Bar is a local-first business. Choosing "Bar" in the ordinary
 * company-creation journey must never create a Supabase/cloud company: the
 * owner either commissions the local Bar server on this PC or joins an
 * existing Bar server, and only then is the business created — locally, by the
 * Bar service.
 *
 * This module is the single shared rule used by the Electron main process (both
 * the `setup:initializeCompany` handler and the settings domain behind it) and
 * by the setup renderer. Keeping one narrow implementation means bypassing the
 * visible UI cannot register a cloud Bar through the company-creation contract.
 *
 * Restaurant, hotel, lodge and every already-cloud Bar business are unaffected:
 * only an explicit `bar_only` choice on a *new* company payload is refused.
 */
import { HOSPITALITY_MODES, getExplicitHospitalityMode, isBarPropertyType } from './propertyTypes.js'

export const BAR_LOCAL_SETUP_REQUIRED = 'bar_local_setup_required'

export const BAR_LOCAL_SETUP_MESSAGE =
  'A Bar cannot be created in this business setup. ' +
  'Open Bar setup and choose "Set up a new Bar on this computer" or "Connect this till to my Bar". ' +
  'Restaurant, hotel, lodge and existing cloud businesses are not changed.'

/** @param {unknown} settings */
export function isLocalBarSetupRequest(settings) {
  try {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false
    const root = /** @type {Record<string, unknown>} */ (settings)
    let profile = root.operating_profile
    if (typeof profile === 'string') {
      try { profile = JSON.parse(profile) } catch { profile = null }
    }
    const nested = profile && typeof profile === 'object' && !Array.isArray(profile)
      ? /** @type {Record<string, unknown>} */ (profile)
      : {}
    // A Bar-only company can arrive through the legacy property/business type,
    // explicit operating-mode aliases, or the Bar POS package selector. Catch
    // all supported representations at the shared main/domain boundary.
    const types = [root.property_type, root.business_type, root.propertyType, root.businessType]
    if (types.some((value) => typeof value === 'string' && isBarPropertyType(value))) return true
    const packages = [root.package_key, root.commercial_package_key, nested.package_key, nested.commercial_package_key]
    if (packages.some((value) => typeof value === 'string' && ['bar_pos', 'bar_only', 'bar'].includes(value.trim().toLowerCase().replace(/[\s-]+/g, '_')))) return true
    return getExplicitHospitalityMode(settings) === HOSPITALITY_MODES.BAR_ONLY
  } catch {
    // A malformed payload is not a proven Bar request. The domain validation
    // that runs next still rejects the incomplete setup payload.
    return false
  }
}

export class BarLocalSetupRequiredError extends Error {
  /** @param {string} [message] */
  constructor(message = BAR_LOCAL_SETUP_MESSAGE) {
    super(message)
    this.name = 'BarLocalSetupRequiredError'
    this.code = BAR_LOCAL_SETUP_REQUIRED
  }
}

/**
 * Refuse to author a cloud company for a Bar registration payload.
 * @param {unknown} settings
 */
export function assertCloudCompanySetupAllowed(settings) {
  if (isLocalBarSetupRequest(settings)) throw new BarLocalSetupRequiredError()
}

/**
 * The exact refusal returned over the `setup:initializeCompany` IPC contract.
 * Returns `null` when the payload may continue to cloud company setup, so the
 * handler can guarantee that a Bar never reaches `initializeCompanySetup`.
 * @param {unknown} settings
 * @returns {{success: false, code: string, required_flow: string, error: string} | null}
 */
export function cloudCompanySetupRefusal(settings) {
  if (!isLocalBarSetupRequest(settings)) return null
  return {
    success: false,
    code: BAR_LOCAL_SETUP_REQUIRED,
    required_flow: 'bar_local_commissioning',
    error: BAR_LOCAL_SETUP_MESSAGE
  }
}

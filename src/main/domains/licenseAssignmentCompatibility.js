// @ts-check
import { resolveProductFamily } from '../../shared/productIdentity.js'

/** @typedef {{ product_id?: unknown, property_type?: unknown, business_type?: unknown }} LicenseInferenceSource */

/**
 * Resolve the legacy product fallback using only columns selected by the
 * admin license/company readers. `product_id` remains unknown because an
 * existing license value is returned unchanged when truthy; this helper does
 * not validate the remote row.
 * @param {LicenseInferenceSource | null} [company]
 * @param {LicenseInferenceSource | null} [license]
 * @returns {unknown}
 */
export function inferLicenseProductId(company = null, license = null) {
  return license?.product_id || resolveProductFamily(
    company?.property_type || company?.business_type || license?.business_type
  )
}

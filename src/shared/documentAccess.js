// @ts-check
const HOTEL_PRODUCT_ID = 'hotel'
/** @typedef {{productId?: unknown, entitlement?: unknown, canView?: unknown}} HotelDocumentAccessOptions */

/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptionalField(value, key) {
  return value === null || value === undefined
    ? undefined
    : Reflect.get(Object(value), key, value)
}

/**
 * Keeps the dormant document workspace fail-closed until it is rebuilt as a
 * proper HotelOS document-branding workflow. Client navigation does not
 * currently expose this surface.
 */
/** @param {unknown} entitlement @returns {boolean} */
export function hasHotelDocumentsEntitlement(entitlement = {}) {
  if (!entitlement || typeof entitlement !== 'object') return false

  if (readOptionalField(entitlement, 'expired') === true) return false
  const productId = String(readOptionalField(entitlement, 'product_id') || '').trim().toLowerCase()
  if (productId && productId !== HOTEL_PRODUCT_ID) return false

  const features = readOptionalField(entitlement, 'effective_features')
  if (features && typeof features === 'object' && Object.prototype.hasOwnProperty.call(features, 'documents')) {
    return readOptionalField(features, 'documents') === true
  }

  return readOptionalField(entitlement, 'status') === 'trial'
}

/** @param {HotelDocumentAccessOptions} [options] @returns {boolean} */
export function canUseHotelDocuments({ productId, entitlement, canView = false } = {}) {
  return productId === HOTEL_PRODUCT_ID
    && hasHotelDocumentsEntitlement(entitlement)
    && canView === true
}

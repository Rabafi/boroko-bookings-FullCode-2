const HOTEL_PRODUCT_ID = 'hotel'

/**
 * Keeps the dormant document workspace fail-closed until it is rebuilt as a
 * proper HotelOS document-branding workflow. Client navigation does not
 * currently expose this surface.
 */
export function hasHotelDocumentsEntitlement(entitlement = {}) {
  if (!entitlement || typeof entitlement !== 'object' || entitlement.expired === true) return false

  const productId = String(entitlement.product_id || '').trim().toLowerCase()
  if (productId && productId !== HOTEL_PRODUCT_ID) return false

  const features = entitlement.effective_features
  if (features && typeof features === 'object' && Object.prototype.hasOwnProperty.call(features, 'documents')) {
    return features.documents === true
  }

  return entitlement.status === 'trial'
}

export function canUseHotelDocuments({ productId, entitlement, canView = false } = {}) {
  return productId === HOTEL_PRODUCT_ID
    && hasHotelDocumentsEntitlement(entitlement)
    && canView === true
}

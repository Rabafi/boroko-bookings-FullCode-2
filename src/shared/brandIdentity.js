/**
 * Canonical customer-facing Tsa Bonno product names.
 *
 * Compatibility identifiers (app IDs, app-data directories, product-family keys,
 * database keys and updater repositories) deliberately do not live here. They are
 * migration contracts and must not be mistaken for public branding.
 */
export const ECOSYSTEM_BRAND = Object.freeze({
  name: 'Tsa Bonno HospitalityOS',
  legalOwner: 'Botswapelo Studios Pty Ltd'
})

export const PRODUCT_BRANDS = Object.freeze({
  'lodge-camp': Object.freeze({
    name: 'Tsa Bonno LodgingOS',
    shortName: 'LodgingOS'
  }),
  hotel: Object.freeze({
    name: 'Tsa Bonno HotelOS',
    shortName: 'HotelOS'
  }),
  'hospitality-pos': Object.freeze({
    name: 'Tsa Bonno Restaurant & Bar POS',
    shortName: 'Restaurant & Bar POS'
  })
})

export function getProductBrand(productId = 'lodge-camp') {
  return PRODUCT_BRANDS[productId] || PRODUCT_BRANDS['lodge-camp']
}

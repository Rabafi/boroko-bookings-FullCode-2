// @ts-check
/**
 * Canonical customer-facing Tsa Bonno product names.
 *
 * Compatibility identifiers (app IDs, app-data directories, product-family keys,
 * database keys and updater repositories) deliberately do not live here. They are
 * migration contracts and must not be mistaken for public branding.
 */
/** @typedef {(typeof import('../../packages/product-config/index.js'))['PRODUCT_IDS'][number]} ProductId */
/** @typedef {{readonly name: string, readonly shortName: string}} ProductBrand */
export const ECOSYSTEM_BRAND = Object.freeze({
  name: 'Tsa Bonno HospitalityOS',
  legalOwner: 'Botswapelo Studios Pty Ltd'
})

/** @type {Readonly<Record<ProductId, ProductBrand>> & Readonly<Record<string, unknown>>} */
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

/**
 * Resolve the customer-facing brand for a product id.
 *
 * Pre-existing runtime semantics (unchanged): known IDs resolve their own
 * brand; ordinary unsupported IDs fall back to LodgingOS, while inherited
 * Object.prototype keys (for example 'constructor' or 'toString') resolve to
 * functions. The unknown return keeps that uncertainty honest; narrow before use.
 *
 * @param {string} [productId]
 * @returns {unknown}
 */
export function getProductBrand(productId = 'lodge-camp') {
  return PRODUCT_BRANDS[productId] || PRODUCT_BRANDS['lodge-camp']
}

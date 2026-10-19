// @ts-check
/**
 * Frozen product catalogue for Tsa Bonno HospitalityOS.
 *
 * Runtime contract (unchanged): frozen `PRODUCTS` keyed by product, frozen
 * `PRODUCT_IDS` derived from `PRODUCTS` in object-value order, and frozen
 * `hospitalityPos.modes`. Types are inferred from these runtime definitions;
 * consumers derive ID unions via `typeof` (see tests/typecheck/product-config).
 */
export const PRODUCTS = Object.freeze({
  lodgeCamp: Object.freeze({ id: 'lodge-camp', databaseProduct: 'lodge_camp' }),
  hotel: Object.freeze({ id: 'hotel', databaseProduct: 'hotel' }),
  hospitalityPos: Object.freeze({
    id: 'hospitality-pos',
    databaseProduct: 'hospitality_pos',
    modes: Object.freeze(['restaurant_bar', 'bar_only'])
  })
})

export const PRODUCT_IDS = Object.freeze(Object.values(PRODUCTS).map((product) => product.id))

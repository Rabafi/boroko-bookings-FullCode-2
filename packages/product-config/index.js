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

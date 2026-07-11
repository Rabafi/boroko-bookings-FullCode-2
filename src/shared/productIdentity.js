// A build without BOROKO_PRODUCT is the established Boroko Bookings client.
// Keep this fallback stable: existing customers must continue to receive only
// releases from the legacy Boroko Bookings update channel.
const FALLBACK_PRODUCT_ID = 'boroko-bookings'

export const PRODUCT_DEFINITIONS = Object.freeze({
  'boroko-bookings': Object.freeze({
    id: 'boroko-bookings',
    name: 'Boroko Bookings',
    appId: 'com.boroko.bookings',
    appDataName: 'boroko-bookings',
    allowedPropertyTypes: Object.freeze(['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant']),
    hospitalityModes: Object.freeze(['restaurant_bar', 'bar_only'])
  }),
  'lodge-camp': Object.freeze({
    id: 'lodge-camp',
    name: 'Boroko Lodge & Camp',
    appId: 'com.boroko.lodgecamp',
    appDataName: 'boroko-lodge-camp',
    allowedPropertyTypes: Object.freeze(['guest_house', 'bnb', 'lodge', 'camp', 'motel']),
    hospitalityModes: Object.freeze([])
  }),
  hotel: Object.freeze({
    id: 'hotel',
    name: 'Boroko Hotel',
    appId: 'com.boroko.hotel',
    appDataName: 'boroko-hotel',
    allowedPropertyTypes: Object.freeze(['hotel', 'resort']),
    hospitalityModes: Object.freeze([])
  }),
  'hospitality-pos': Object.freeze({
    id: 'hospitality-pos',
    name: 'Boroko Restaurant & Bar POS',
    appId: 'com.boroko.hospitalitypos',
    appDataName: 'boroko-hospitality-pos',
    allowedPropertyTypes: Object.freeze(['restaurant']),
    hospitalityModes: Object.freeze(['restaurant_bar', 'bar_only'])
  })
})

export function getRuntimeProductId() {
  if (typeof __BOROKO_PRODUCT__ === 'string' && PRODUCT_DEFINITIONS[__BOROKO_PRODUCT__]) return __BOROKO_PRODUCT__
  return FALLBACK_PRODUCT_ID
}

export function getProductDefinition(productId = getRuntimeProductId()) {
  return PRODUCT_DEFINITIONS[productId] || PRODUCT_DEFINITIONS[FALLBACK_PRODUCT_ID]
}

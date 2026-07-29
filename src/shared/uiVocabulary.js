/**
 * Operator-facing product vocabulary.
 * Internal fields may still use lodge_id / lodge_name; UI must not.
 * Language follows product shell first, then the setup property type.
 */
import { getProductDefinition, getRuntimeProductId } from './productIdentity.js'
import { isBarOnlyMode, isRestaurantOnly, normalizePropertyType } from './propertyTypes.js'

function freezeVocab(base) {
  return Object.freeze(base)
}

function accommodationVocab(product, {
  noun,
  nounTitle,
  nounPlural,
  slug,
  fullPropertyLabel = 'Full property',
  emailLocal = 'info',
  websiteSlug = null
}) {
  const web = websiteSlug || slug
  return freezeVocab({
    productId: product.id,
    brandName: product.brandName || product.name || 'Tsa Bonno HospitalityOS',
    noun,
    nounTitle,
    nounPlural,
    theNoun: `the ${noun}`,
    thisNoun: `this ${noun}`,
    yourNoun: `your ${noun}`,
    nameLabel: `${nounTitle} name`,
    nameFallback: nounTitle,
    propertyLabel: 'Property',
    companyLabel: 'Company',
    workspaceLabel: `${nounTitle} workspace`,
    chooserLabel: `${noun} chooser`,
    emailPlaceholder: `${emailLocal}@your${slug}.com`,
    websitePlaceholder: `www.your${web}.com`,
    fullPropertyLabel,
    retainsLabel: `${nounTitle} retains`,
    leavesCashLabel: `the ${noun}`,
    accessNoun: `${noun} access`
  })
}

/** Property-type language for accommodation products (Lodge app and Hotel app). */
export function getAccommodationVocabulary(product, propertyType) {
  const type = normalizePropertyType(propertyType)
  switch (type) {
    case 'guest_house':
      return accommodationVocab(product, {
        noun: 'guest house',
        nounTitle: 'Guest House',
        nounPlural: 'guest houses',
        slug: 'guesthouse',
        fullPropertyLabel: 'Full guest house'
      })
    case 'bnb':
      return accommodationVocab(product, {
        noun: 'B&B',
        nounTitle: 'Bed & Breakfast',
        nounPlural: 'B&Bs',
        slug: 'bnb',
        fullPropertyLabel: 'Full B&B'
      })
    case 'camp':
      return accommodationVocab(product, {
        noun: 'camp',
        nounTitle: 'Camp',
        nounPlural: 'camps',
        slug: 'camp',
        fullPropertyLabel: 'Full camp'
      })
    case 'motel':
      return accommodationVocab(product, {
        noun: 'motel',
        nounTitle: 'Motel',
        nounPlural: 'motels',
        slug: 'motel',
        emailLocal: 'reservations',
        fullPropertyLabel: 'Full motel'
      })
    case 'resort':
      return accommodationVocab(product, {
        noun: 'resort',
        nounTitle: 'Resort',
        nounPlural: 'resorts',
        slug: 'resort',
        emailLocal: 'reservations',
        fullPropertyLabel: 'Full resort'
      })
    case 'hotel':
      return accommodationVocab(product, {
        noun: 'hotel',
        nounTitle: 'Hotel',
        nounPlural: 'hotels',
        slug: 'hotel',
        emailLocal: 'reservations',
        fullPropertyLabel: 'Full property'
      })
    case 'lodge':
    default:
      return accommodationVocab(product, {
        noun: 'lodge',
        nounTitle: 'Lodge',
        nounPlural: 'lodges',
        slug: 'lodge',
        fullPropertyLabel: 'Full Lodge'
      })
  }
}

export function getUiVocabulary({
  productId = getRuntimeProductId(),
  propertyType = null,
  settings = null
} = {}) {
  const product = getProductDefinition(productId)
  const type = normalizePropertyType(
    propertyType || settings?.property_type || settings?.business_type || ''
  )

  // Hotel product shell: always accommodation hotel-family language (hotel vs resort).
  if (product.id === 'hotel') {
    return getAccommodationVocabulary(product, type === 'resort' ? 'resort' : (type || 'hotel'))
  }

  if (product.id === 'hospitality-pos' || isRestaurantOnly(type)) {
    const barOnly = isBarOnlyMode(settings)
    if (barOnly) {
      return freezeVocab({
        productId: product.id,
        brandName: product.brandName || product.name,
        noun: 'bar',
        nounTitle: 'Bar',
        nounPlural: 'bars',
        theNoun: 'the bar',
        thisNoun: 'this bar',
        yourNoun: 'your bar',
        nameLabel: 'Bar name',
        nameFallback: 'Bar',
        propertyLabel: 'Business',
        companyLabel: 'Company',
        workspaceLabel: 'Bar workspace',
        chooserLabel: 'bar chooser',
        emailPlaceholder: 'info@yourbar.com',
        websitePlaceholder: 'www.yourbar.com',
        fullPropertyLabel: 'Full venue',
        retainsLabel: 'Business retains',
        leavesCashLabel: 'the business',
        accessNoun: 'bar access',
        productsLabel: 'Drinks & products',
        sellLabel: 'Sell',
        staffRoleLabel: 'Bartender / cashier'
      })
    }

    return freezeVocab({
      productId: product.id,
      brandName: product.brandName || product.name,
      noun: 'restaurant',
      nounTitle: 'Restaurant',
      nounPlural: 'restaurants',
      theNoun: 'the restaurant',
      thisNoun: 'this restaurant',
      yourNoun: 'your restaurant',
      nameLabel: 'Restaurant name',
      nameFallback: 'Restaurant',
      propertyLabel: 'Business',
      companyLabel: 'Company',
      workspaceLabel: 'Restaurant workspace',
      chooserLabel: 'restaurant chooser',
      emailPlaceholder: 'info@yourrestaurant.com',
      websitePlaceholder: 'www.yourrestaurant.com',
      fullPropertyLabel: 'Full venue',
      retainsLabel: 'Business retains',
      leavesCashLabel: 'the business',
      accessNoun: 'restaurant access',
      productsLabel: 'Menu & Production',
      sellLabel: 'Service',
      staffRoleLabel: 'Waiter'
    })
  }

  // LodgingOS product — language follows setup property type (guest house, B&B, lodge, camp, motel).
  return getAccommodationVocabulary(product, type || 'lodge')
}

/** Display name for a company/settings row without leaking internal keys. */
export function getBusinessDisplayName(settings = {}, vocab = getUiVocabulary({ settings })) {
  return settings?.lodge_name?.trim()
    || settings?.company_name?.trim()
    || vocab.nameFallback
}

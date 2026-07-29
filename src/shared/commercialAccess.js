import { COMMERCIAL_PRODUCT_IDS, getCommercialAddon, getCommercialOffer } from './commercialEntitlements.js'

/**
 * Commercial package checks are deliberately separate from legacy plan checks.
 * POS packages all remain internally compatible with Pro, but their package key
 * is the runtime boundary for restaurant capabilities.
 */
export function isCommercialFeatureIncluded(productId, commercialPackageKey, featureKey, selectedAddonKeys = []) {
  if (productId !== COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS || !commercialPackageKey) return true

  const offer = getCommercialOffer(productId, commercialPackageKey)
  if (!offer) return false

  const feature = String(featureKey || '').trim()
  if (!feature) return true

  const aliases = {
    restaurant_service: 'tables',
    restaurant_control: 'stock_control',
    restaurant_growth: 'loyalty',
    multi_outlet_pos: 'multi_outlet_controls',
    guest_crm: 'customer_accounts',
    guest_crm_view: 'customer_accounts',
    guest_crm_manage: 'customer_accounts'
  }
  const normalizedFeature = aliases[feature] || feature
  if (offer.includedFeatures.includes(normalizedFeature)) return true
  return [...new Set(Array.isArray(selectedAddonKeys) ? selectedAddonKeys : [])].some((addonKey) => {
    const addon = getCommercialAddon(productId, addonKey)
    const eligible = !addon?.eligiblePackageKeys || addon.eligiblePackageKeys.includes(commercialPackageKey)
    return eligible && addon?.includedFeatures?.includes(normalizedFeature) === true
  })
}

export function getCommercialFeatureSet(productId, commercialPackageKey, selectedAddonKeys = []) {
  const offer = getCommercialOffer(productId, commercialPackageKey)
  const features = new Set(offer?.includedFeatures || [])
  for (const addonKey of [...new Set(Array.isArray(selectedAddonKeys) ? selectedAddonKeys : [])]) {
    const addon = getCommercialAddon(productId, addonKey)
    if (!addon?.eligiblePackageKeys || addon.eligiblePackageKeys.includes(commercialPackageKey)) {
      addon?.includedFeatures?.forEach((feature) => features.add(feature))
    }
  }
  return features
}

export function isCommercialPackageSelected(productId, commercialPackageKey) {
  return Boolean(getCommercialOffer(productId, commercialPackageKey))
}

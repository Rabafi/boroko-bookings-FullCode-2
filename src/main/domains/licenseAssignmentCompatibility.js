import { resolveProductFamily } from '../../shared/productIdentity.js'

export function inferLicenseProductId(company = null, license = null) {
  return license?.product_id || resolveProductFamily(
    company?.property_type || company?.business_type || license?.business_type
  )
}

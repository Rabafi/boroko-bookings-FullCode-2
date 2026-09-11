/**
 * Till entitlement decisions (pure, node-testable): which customer,
 * promotion, voucher, tip and recipe capabilities the current commercial
 * context grants. Restaurant (non-Bar) service keeps its established
 * ungated behavior; Bar-only resolves the effective feature set including
 * approved add-ons and explicit server denials. Capabilities layer on top:
 * a granted feature still needs the operator capability at submit time.
 */
import { getCommercialFeatureSet } from "./commercialAccess.js";

export function getTillEntitlements({
  productId = null,
  packageKey = null,
  addonKeys = [],
  entitlement = null,
  lodgeId = null,
  barOnly = false,
} = {}) {
  if (!barOnly) {
    return {
      canAccounts: true,
      canPromos: true,
      canVouchers: true,
      canTips: true,
      canRecipes: true,
    };
  }
  let features;
  try {
    features = getCommercialFeatureSet(productId, packageKey, addonKeys, entitlement, lodgeId);
  } catch {
    features = new Set();
  }
  const has = (feature) => features instanceof Set && features.has(feature);
  return {
    canAccounts: has("customer_accounts"),
    canPromos: has("promotions"),
    canVouchers: has("vouchers"),
    canTips: has("tips_payouts"),
    canRecipes: has("recipes"),
  };
}

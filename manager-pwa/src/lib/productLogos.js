import { PRODUCT_FAMILY_IDS, resolveProductFamily } from '@shared/productIdentity'
import lodgingColor from '../assets/tsa-bonno-lodgingos-logo-color.png'
import lodgingLight from '../assets/tsa-bonno-lodgingos-logo-light.png'
import hotelColor from '../assets/tsa-bonno-hotelos-logo-color.png'
import hotelLight from '../assets/tsa-bonno-hotelos-logo-light.png'
import restaurantColor from '../assets/tsa-bonno-restaurant-bar-os-logo-color.png'
import restaurantLight from '../assets/tsa-bonno-restaurant-bar-os-logo-light.png'

const LOGOS = Object.freeze({
  [PRODUCT_FAMILY_IDS.LODGE_CAMP]: Object.freeze({ color: lodgingColor, light: lodgingLight }),
  [PRODUCT_FAMILY_IDS.HOTEL]: Object.freeze({ color: hotelColor, light: hotelLight }),
  [PRODUCT_FAMILY_IDS.HOSPITALITY_POS]: Object.freeze({ color: restaurantColor, light: restaurantLight })
})

export function getPwaProductLogo(productFamily, { light = false } = {}) {
  const family = resolveProductFamily(productFamily || PRODUCT_FAMILY_IDS.LODGE_CAMP)
  const logo = LOGOS[family] || LOGOS[PRODUCT_FAMILY_IDS.LODGE_CAMP]
  return light ? logo.light : logo.color
}

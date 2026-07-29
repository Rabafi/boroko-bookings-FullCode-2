import { getRuntimeProductId } from '../../../shared/productIdentity'
import lodgingColor from './tsa-bonno-lodgingos-logo-color.png'
import lodgingLight from './tsa-bonno-lodgingos-logo-light.png'
import hotelColor from './tsa-bonno-hotelos-logo-color.png'
import hotelLight from './tsa-bonno-hotelos-logo-light.png'
import restaurantColor from './tsa-bonno-restaurant-bar-os-logo-color.png'
import restaurantLight from './tsa-bonno-restaurant-bar-os-logo-light.png'

export const PRODUCT_LOGOS = Object.freeze({
  'lodge-camp': Object.freeze({ color: lodgingColor, light: lodgingLight }),
  hotel: Object.freeze({ color: hotelColor, light: hotelLight }),
  'hospitality-pos': Object.freeze({ color: restaurantColor, light: restaurantLight })
})

const runtimeLogos = PRODUCT_LOGOS[getRuntimeProductId()] || PRODUCT_LOGOS['lodge-camp']

export const productLogoColor = runtimeLogos.color
export const productLogoLight = runtimeLogos.light

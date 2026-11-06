import { PUBLIC_BOOKING_ORIGIN } from '../../../src/shared/publicEndpoints.js'

export function normalizePublicBookingOrigin(value) {
  if (typeof value !== 'string') return PUBLIC_BOOKING_ORIGIN
  const candidate = value.trim()
  if (!candidate) return PUBLIC_BOOKING_ORIGIN
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return PUBLIC_BOOKING_ORIGIN
    return parsed.origin
  } catch {
    return PUBLIC_BOOKING_ORIGIN
  }
}

function readConfiguredOrigin() {
  try {
    return import.meta.env.VITE_PUBLIC_BOOKING_BASE_URL
  } catch {
    return undefined
  }
}

export function getPublicBookingOrigin(configured = readConfiguredOrigin()) {
  return normalizePublicBookingOrigin(configured)
}

export function buildPublicBookingUrl(pathname = '/', configured = readConfiguredOrigin()) {
  const origin = normalizePublicBookingOrigin(configured)
  const path = typeof pathname === 'string' && pathname.trim() ? pathname.trim() : '/'
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`
}

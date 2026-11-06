export const MARKETING_SITE_ORIGIN = 'https://tsabonno.com'
export const MARKETING_SITE_WWW_ORIGIN = 'https://www.tsabonno.com'
export const PUBLIC_BOOKING_ORIGIN = 'https://book.tsabonno.com'
export const MANAGER_PWA_ORIGIN = 'https://manager.tsabonno.com'
export const SUPPORT_EMAIL = 'support@tsabonno.com'
export const MANAGER_RESET_PASSWORD_URL = `${MANAGER_PWA_ORIGIN}/reset-password`

/**
 * @param {string} slug
 * @param {string} [path]
 * @returns {string}
 */
export function buildLodgeBookingUrl(slug, path = '') {
  const cleanSlug = typeof slug === 'string' ? slug.trim().replace(/^\/+|\/+$/g, '') : ''
  if (!cleanSlug) return PUBLIC_BOOKING_ORIGIN
  const cleanPath = typeof path === 'string' ? path.trim().replace(/^\/+/, '') : ''
  return `${PUBLIC_BOOKING_ORIGIN}/${cleanSlug}${cleanPath ? `/${cleanPath}` : ''}`
}

/**
 * @param {string} [subject]
 * @param {string} [body]
 * @returns {string}
 */
export function buildSupportMailto(subject = '', body = '') {
  const params = []
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`)
  if (body) params.push(`body=${encodeURIComponent(body)}`)
  return `mailto:${SUPPORT_EMAIL}${params.length ? `?${params.join('&')}` : ''}`
}

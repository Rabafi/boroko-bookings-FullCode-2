// @ts-check
/**
 * Shared utilities for the booking site.
 * These functions are pure, stateless, and safe to import anywhere.
 */
/**
 * Build a wa.me URL from a phone number with an optional country-code prefix.
 * Unknown input passes through the existing String conversion, which can
 * still throw for exotic conversion hooks. No international numbering,
 * identity or ownership validation is performed; null country code disables
 * prefixing. Options/default handling is preserved exactly as implemented.
 *
 * @param {unknown} number
 * @param {{defaultCountryCode?: string | null}} [options]
 * @returns {string | null}
 */
export function buildWhatsAppUrl(number, { defaultCountryCode = '267' } = {}) {
  let digits = String(number || '').replace(/[^\d]/g, '')
  if (!digits) return null

  // Common local Botswana mobiles are 8 digits (7x/6x). Prefix country code when missing.
  if (defaultCountryCode && !digits.startsWith(defaultCountryCode)) {
    if (digits.length === 8 && /^[67]/.test(digits)) {
      digits = `${defaultCountryCode}${digits}`
    } else if (digits.length === 7 || digits.length === 8) {
      digits = `${defaultCountryCode}${digits}`
    }
  }

  return `https://wa.me/${digits}`
}

/**
 * Normalize a website URL when it uses an allowed scheme. This is a scheme
 * allowlist (http/https), not proof of trust, same-origin or absence of
 * credentials. No base URL is added and no extra data is stripped.
 *
 * @param {string | URL | null | undefined} [value]
 * @returns {string | null}
 */
export function sanitizeWebsiteUrl(value) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

/**
 * Build a Google Calendar template URL from a caller-owned booking object.
 * No schema validation is performed: dates, timezone, availability,
 * confirmed-booking status and ownership are not verified, and missing
 * metadata renders as undefined in the output. Null/undefined bookings or
 * unsupported field conversions may throw; no new catch or validator is added.
 *
 * @typedef {{check_in?: string | null, check_out?: string | null, lodge_name?: unknown, reference?: unknown, room_number?: unknown}} CalendarBooking
 * @param {CalendarBooking} booking
 * @returns {string | null}
 */
export function buildCalendarUrl(booking) {
  const start = booking.check_in?.replace(/-/g, '')
  const end = booking.check_out?.replace(/-/g, '')
  if (!start || !end) return null
  const title = encodeURIComponent(`Stay at ${booking.lodge_name}`)
  const details = encodeURIComponent(
    `Booking reference: ${booking.reference}. Room: ${booking.room_number}.`
  )
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}`
}

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Plain boolean slug check against the existing length limits and regexp.
 * No branded identifier, type predicate or server authorization is claimed.
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isValidSlug(value) {
  return (
    typeof value === 'string' && value.length >= 2 && value.length <= 64 && SLUG_REGEX.test(value)
  )
}

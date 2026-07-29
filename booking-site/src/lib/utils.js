/**
 * Shared utilities for the booking site.
 * These functions are pure, stateless, and safe to import anywhere.
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

export function sanitizeWebsiteUrl(value) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

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

export function isValidSlug(value) {
  return (
    typeof value === 'string' && value.length >= 2 && value.length <= 64 && SLUG_REGEX.test(value)
  )
}

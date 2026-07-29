const ANALYTICS_ENDPOINT = import.meta.env.VITE_ANALYTICS_ENDPOINT || ''

export function telemetryUrl() {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  for (const key of ['token', 'session', 'code']) url.searchParams.delete(key)
  return `${url.origin}${url.pathname}`
}

function safeProperties(properties = {}) {
  const blocked = new Set(['token', 'session', 'code', 'guest_name', 'guest_email', 'guest_phone', 'notes', 'booking_id', 'full_url'])
  return Object.fromEntries(Object.entries(properties).filter(([key, value]) => {
    if (blocked.has(key)) return false
    if (typeof value === 'string' && value.length > 160) return false
    return ['string', 'number', 'boolean'].includes(typeof value) || value == null
  }))
}

/**
 * Lightweight, privacy-first analytics for the booking site.
 * If VITE_ANALYTICS_ENDPOINT is set, events are POSTed there.
 * Otherwise they are logged to the console in production builds.
 */
export function trackEvent(eventName, properties = {}) {
  const payload = {
    event: eventName,
    properties: safeProperties(properties),
    url: telemetryUrl(),
    timestamp: new Date().toISOString()
  }

  if (ANALYTICS_ENDPOINT) {
    fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {
      // Silently drop analytics failures so they never block the user
    })
  } else {
    // eslint-disable-next-line no-console
    if (import.meta.env.PROD) console.log('[Analytics]', payload)
  }
}

export function trackSearch(lodgeSlug, checkIn, checkOut, roomCount) {
  trackEvent('search_availability', {
    lodge_slug: lodgeSlug,
    check_in: checkIn,
    check_out: checkOut,
    room_count: roomCount
  })
}

export function trackSelectRoom(lodgeSlug, roomId, roomType, nights, totalPrice) {
  trackEvent('select_room', {
    lodge_slug: lodgeSlug,
    room_id: roomId,
    room_type: roomType,
    nights,
    total_price: totalPrice
  })
}

export function trackBeginCheckout(lodgeSlug, roomId, totalPrice) {
  trackEvent('begin_checkout', {
    lodge_slug: lodgeSlug,
    room_id: roomId,
    total_price: totalPrice
  })
}

export function trackBookingRequest(lodgeSlug, roomId, bookingId, totalPrice) {
  trackEvent('booking_request', {
    lodge_slug: lodgeSlug,
    room_id: roomId,
    total_price: totalPrice
  })
}

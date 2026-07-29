const ERROR_ENDPOINT = import.meta.env.VITE_ANALYTICS_ENDPOINT || ''

/**
 * Minimal error tracker for the booking site.
 * Captures uncaught JS errors and unhandled promise rejections,
 * then logs them to console and optionally POSTs to the analytics endpoint.
 */
import { telemetryUrl } from './analytics.js'

function scrub(value) {
  return String(value || '')
    .replace(/[?&](token|session|code)=[^&#]*/gi, '')
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, '[redacted]')
    .slice(0, 1000)
}

function reportError(error, context = {}) {
  const payload = {
    type: 'js_error',
    message: scrub(error?.message || String(error)),
    stack: scrub(error?.stack || ''),
    url: telemetryUrl(),
    userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : '',
    context: Object.fromEntries(Object.entries(context).filter(([key]) => !['token', 'session', 'code', 'email', 'phone', 'notes'].includes(key))),
    timestamp: new Date().toISOString()
  }

  // Always log to console so it shows up in Sentry / LogRocket if those are added later
  // eslint-disable-next-line no-console
  console.error('[BookingSiteError]', payload)

  if (ERROR_ENDPOINT) {
    fetch(ERROR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true
    }).catch(() => {})
  }
}

export function initErrorTracking() {
  if (typeof window === 'undefined') return

  window.addEventListener('error', (event) => {
    reportError(event.error, { source: 'window.onerror', filename: event.filename, lineno: event.lineno })
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { source: 'unhandledrejection' })
  })
}

export function captureException(error, context = {}) {
  reportError(error, context)
}

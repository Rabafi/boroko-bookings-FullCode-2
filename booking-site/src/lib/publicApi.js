const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
const rpcBaseUrl = supabaseUrl ? `${supabaseUrl}/rest/v1/rpc` : ''
const cachePrefix = 'boroko-booking-public:'
const EMAIL_FUNCTION_URL = import.meta.env.VITE_CONFIRMATION_EMAIL_FUNCTION_URL

if (!supabaseUrl || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment')
}

// ── Rate limiting ────────────────────────────────────────────────────────────
// Uses localStorage so the limit survives page reloads and incognito sessions.
const BOOKING_SUBMISSION_LIMIT = 6
const BOOKING_SUBMISSION_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT_KEY = 'boroko:booking_submissions'

function readRateLimitTimestamps() {
  try {
    const raw = localStorage.getItem(RATE_LIMIT_KEY)
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeRateLimitTimestamps(timestamps) {
  try {
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(timestamps))
  } catch {
    // Ignore storage failures in private mode
  }
}

function checkBookingSubmissionRateLimit() {
  const now = Date.now()
  const timestamps = readRateLimitTimestamps().filter(ts => now - ts < BOOKING_SUBMISSION_WINDOW_MS)

  if (timestamps.length >= BOOKING_SUBMISSION_LIMIT) {
    throw new Error(`Too many booking requests. Please wait an hour before trying again.`)
  }

  timestamps.push(now)
  writeRateLimitTimestamps(timestamps)
}

// ── Email retry queue ───────────────────────────────────────────────────────
// Pending confirmation emails are stored in localStorage and retried on page load.
const EMAIL_QUEUE_KEY = 'boroko:pending_emails'

export function queueConfirmationEmail(payload) {
  if (!EMAIL_FUNCTION_URL) return
  try {
    const queue = JSON.parse(localStorage.getItem(EMAIL_QUEUE_KEY) || '[]')
    queue.push({ payload, attempts: 0, lastAttempt: Date.now() })
    localStorage.setItem(EMAIL_QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // ignore
  }
}

export async function flushPendingEmails() {
  if (!EMAIL_FUNCTION_URL) return
  try {
    const raw = localStorage.getItem(EMAIL_QUEUE_KEY)
    if (!raw) return
    const queue = JSON.parse(raw)
    if (!Array.isArray(queue) || queue.length === 0) return

    const remaining = []
    for (const item of queue) {
      if (item.attempts >= 3) continue
      try {
        const response = await fetch(EMAIL_FUNCTION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
      } catch {
        item.attempts += 1
        item.lastAttempt = Date.now()
        remaining.push(item)
      }
    }

    if (remaining.length === 0) {
      localStorage.removeItem(EMAIL_QUEUE_KEY)
    } else {
      localStorage.setItem(EMAIL_QUEUE_KEY, JSON.stringify(remaining))
    }
  } catch {
    // ignore
  }
}

function cacheKey(key) {
  return `${cachePrefix}${key}`
}

function normalizeError(message, status = 0) {
  return { message, status }
}

async function parseJsonResponse(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function rpc(functionName, payload = {}, options = {}) {
  if (!rpcBaseUrl || !anonKey) {
    return {
      data: null,
      error: normalizeError('Booking API is not configured.')
    }
  }

  // P0-3: Rate limit booking submissions to prevent abuse/DoS
  if (functionName === 'create_online_booking') {
    try {
      checkBookingSubmissionRateLimit()
    } catch (e) {
      return {
        data: null,
        error: normalizeError(e.message)
      }
    }
  }

  try {
    const response = await fetch(`${rpcBaseUrl}/${functionName}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: options.signal
    })

    const data = await parseJsonResponse(response)

    if (!response.ok) {
      return {
        data: null,
        error: normalizeError(
          data?.message || data?.error || `Request failed (${response.status})`,
          response.status
        )
      }
    }

    return { data, error: null }
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { data: null, error: normalizeError('Request cancelled.') }
    }

    return {
      data: null,
      error: normalizeError(error?.message || 'Network error.')
    }
  }
}

export function readSessionCache(key, maxAgeMs) {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(cacheKey(key))
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.savedAt !== 'number') return null

    if (Date.now() - parsed.savedAt > maxAgeMs) {
      window.sessionStorage.removeItem(cacheKey(key))
      return null
    }

    return parsed.data ?? null
  } catch {
    return null
  }
}

export function writeSessionCache(key, data) {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.setItem(
      cacheKey(key),
      JSON.stringify({
        savedAt: Date.now(),
        data
      })
    )
  } catch {
    // Ignore cache write failures in private mode or low-storage conditions.
  }
}

export function isMissingRpcError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('function') && (message.includes('does not exist') || message.includes('not found'))
}

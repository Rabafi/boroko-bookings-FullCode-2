const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')
const rpcBaseUrl = supabaseUrl ? `${supabaseUrl}/rest/v1/rpc` : ''
const cachePrefix = 'boroko-booking-public:'

// P0-3: Rate limiting for public booking submissions
// Tracks submission attempts per session to prevent abuse/DoS
const BOOKING_SUBMISSION_LIMIT = 10 // max requests per 1-hour window
const BOOKING_SUBMISSION_WINDOW_MS = 60 * 60 * 1000 // 1 hour
let bookingSubmissionTimestamps = [] // timestamps of booking submissions this session

if (!supabaseUrl || !anonKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment')
}

function checkBookingSubmissionRateLimit() {
  const now = Date.now()
  // Remove timestamps older than the window
  bookingSubmissionTimestamps = bookingSubmissionTimestamps.filter(ts => now - ts < BOOKING_SUBMISSION_WINDOW_MS)

  if (bookingSubmissionTimestamps.length >= BOOKING_SUBMISSION_LIMIT) {
    throw new Error(`Too many booking requests. Please wait an hour before trying again. (${bookingSubmissionTimestamps.length}/${BOOKING_SUBMISSION_LIMIT})`)
  }

  // Record this submission attempt
  bookingSubmissionTimestamps.push(now)
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

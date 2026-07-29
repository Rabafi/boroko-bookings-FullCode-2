import { state } from '../state.js'
import { readCache, writeCache, dedupePromise } from './infrastructure.js'

const CACHE_KEY = 'payment-provider-configs'

export async function getPaymentProviderConfig(lodgeIdArg, provider = null) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) {
    return { data: null, error: new Error('No lodge selected') }
  }
  try {
    const { data, error } = await state.supabase.rpc('get_payment_provider_config', {
      p_lodge_id: currentLodgeId,
      p_provider: provider
    })
    if (error) throw error
    return { data: Array.isArray(data) ? data : [], error: null }
  } catch (e) {
    if (lodgeIdArg) throw e
    const cached = readCache(`${CACHE_KEY}:${currentLodgeId}`)
    if (Array.isArray(cached) && cached.length > 0) {
      return { data: cached.filter(c => !provider || c.provider === provider), error: null }
    }
    throw e
  }
}

export async function savePaymentProviderConfig(payload, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) {
    throw new Error('No lodge selected')
  }
  const { data, error } = await state.supabase.rpc('save_payment_provider_config', {
    p_lodge_id: currentLodgeId,
    p_payload: payload
  })
  if (error) throw error
  writeCache(`${CACHE_KEY}:${currentLodgeId}`, [])
  return data
}

export async function getProviderSecrets(lodgeIdArg, provider) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('get_payment_provider_secrets', {
    p_lodge_id: currentLodgeId,
    p_provider: provider
  })
  if (error) throw error
  return data
}

export async function verifyWebhookSignature(provider, signature, payloadRaw) {
  const { data, error } = await state.supabase.rpc('verify_webhook_signature', {
    p_provider: provider,
    p_signature: signature,
    p_payload_raw: payloadRaw
  })
  if (error) throw error
  return data
}

export async function recordWebhookPayment(payload, signature, lodgeIdArg) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) throw new Error('No lodge selected')
  // Webhook payment recording is ONLINE-ONLY financial authority (docs/OFFLINE_MATRIX.md).
  if (state.isOnline === false) {
    const err = new Error('Record webhook payment requires an internet connection. Payment confirmation cannot be queued offline.')
    err.onlineOnly = true
    throw err
  }
  const { data, error } = await state.supabase.rpc('record_webhook_payment', {
    p_lodge_id: currentLodgeId,
    p_payload: payload,
    p_signature: signature
  })
  if (error) throw error
  return data
}

export async function createBookingIntent(slug, payload) {
  const { data, error } = await state.supabase.rpc('create_booking_intent', {
    p_slug: slug,
    p_payload: payload
  })
  if (error) throw error
  return data
}

export async function createPaymentIntent(bookingIntentId, provider, amount) {
  const { data, error } = await state.supabase.rpc('create_payment_intent', {
    p_booking_intent_id: bookingIntentId,
    p_provider: provider,
    p_amount: amount
  })
  if (error) throw error
  return data
}

export async function confirmPaymentFromWebhook(providerPaymentId, provider, webhookPayload = {}) {
  // Payment confirmation is ONLINE-ONLY (docs/OFFLINE_MATRIX.md).
  if (state.isOnline === false) {
    const err = new Error('Confirm payment requires an internet connection. Payment confirmation cannot be queued offline.')
    err.onlineOnly = true
    throw err
  }
  const { data, error } = await state.supabase.rpc('confirm_payment_from_webhook', {
    p_provider_payment_id: providerPaymentId,
    p_provider: provider,
    p_payload: webhookPayload
  })
  if (error) throw error
  return data
}

export async function expireStaleBookingIntents() {
  const { data, error } = await state.supabase.rpc('expire_stale_booking_intents', {})
  if (error) throw error
  return data
}

async function _getPaymentDashboard(lodgeIdArg = null) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await state.supabase.rpc('get_payment_dashboard', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache(`payment-dashboard:${currentLodgeId}`, data)
    return data
  } catch (error) {
    if (lodgeIdArg) throw error
    const cached = readCache(`payment-dashboard:${currentLodgeId}`)
    return cached || null
  }
}

export function getPaymentDashboard(lodgeIdArg = null) {
  const currentLodgeId = lodgeIdArg || state.lodgeId
  return dedupePromise(`paymentDashboard:${currentLodgeId}:get`, () => _getPaymentDashboard(lodgeIdArg))
}

/**
 * Abandoned-payment recovery helpers.
 * Recovery only updates abandoned_payment_sessions status.
 * It must never invent client-side payment_status or amount_paid — those remain
 * authoritative database ledger fields from payment RPCs only.
 */
export async function recoverAbandonedPaymentSession(sessionToken) {
  if (!state.lodgeId) throw new Error('No lodge selected')
  if (!sessionToken) throw new Error('Session token is required')
  const { data, error } = await state.supabase.rpc('recover_abandoned_session', {
    p_lodge_id: state.lodgeId,
    p_session_token: sessionToken
  })
  if (error) throw error
  if (data?.success === false) throw new Error(data.error || 'Could not recover abandoned session')

  // Explicit contract: recovery is session-state only, not a paid confirmation.
  const session = data && typeof data === 'object' ? { ...data } : { result: data }
  delete session.payment_status
  delete session.amount_paid
  delete session.paid
  delete session.is_paid

  return {
    success: true,
    recovery_status: session.status || 'recovered',
    session,
    // Callers must re-read booking payment totals from authoritative ledger RPCs.
    payment_confirmed: false,
    amount_paid: undefined,
    payment_status: undefined,
    note: 'Abandoned session marked recovered. Booking payment totals remain server-authoritative and were not modified by this client.'
  }
}

export async function listAbandonedPaymentSessions(statusFilter = null) {
  if (!state.lodgeId) throw new Error('No lodge selected')
  const { data, error } = await state.supabase.rpc('get_abandoned_sessions', {
    p_lodge_id: state.lodgeId,
    p_status_filter: statusFilter || null
  })
  if (error) throw error
  return data
}

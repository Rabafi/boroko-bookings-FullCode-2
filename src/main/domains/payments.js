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
    const cached = readCache(CACHE_KEY)
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
  writeCache(CACHE_KEY, [])
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

async function _getPaymentDashboard() {
  const currentLodgeId = state.lodgeId
  if (!currentLodgeId) return null
  try {
    const { data, error } = await state.supabase.rpc('get_payment_dashboard', {
      p_lodge_id: currentLodgeId
    })
    if (error) throw error
    writeCache('payment-dashboard', data)
    return data
  } catch (error) {
    const cached = readCache('payment-dashboard')
    return cached || null
  }
}

export function getPaymentDashboard() {
  return dedupePromise('paymentDashboard:get', () => _getPaymentDashboard())
}

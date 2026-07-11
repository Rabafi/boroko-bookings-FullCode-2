// ── Payment Provider Abstraction ────────────────────────────────────────────
// Shared module for payment intent state machine and provider config.

export const PAYMENT_PROVIDERS = {
  dpo: {
    key: 'dpo',
    label: 'DPO Pay',
    countries: ['BW', 'ZA', 'KE', 'NG', 'TZ', 'GH'],
    defaultCurrency: 'BWP',
    modes: ['test', 'live'],
    requiresWebhookSecret: true
  },
  paygate: {
    key: 'paygate',
    label: 'PayGate',
    countries: ['ZA', 'BW', 'NA'],
    defaultCurrency: 'ZAR',
    modes: ['test', 'live'],
    requiresWebhookSecret: true
  },
  paystack: {
    key: 'paystack',
    label: 'Paystack',
    countries: ['NG', 'GH', 'ZA', 'KE'],
    defaultCurrency: 'NGN',
    modes: ['test', 'live'],
    requiresWebhookSecret: true
  },
  flutterwave: {
    key: 'flutterwave',
    label: 'Flutterwave',
    countries: ['NG', 'GH', 'KE', 'ZA', 'TZ'],
    defaultCurrency: 'NGN',
    modes: ['test', 'live'],
    requiresWebhookSecret: true
  },
  stripe: {
    key: 'stripe',
    label: 'Stripe',
    countries: ['US', 'GB', 'ZA', 'KE', 'NG', 'BW'],
    defaultCurrency: 'USD',
    modes: ['test', 'live'],
    requiresWebhookSecret: true
  },
  manual_adapter: {
    key: 'manual_adapter',
    label: 'Manual / Custom Adapter',
    countries: ['*'],
    defaultCurrency: 'BWP',
    modes: ['test', 'live'],
    requiresWebhookSecret: false
  }
}

// ── Payment Intent State Machine ───────────────────────────────────────────
export const PAYMENT_INTENT_STATUS = {
  created: 'created',
  processing: 'processing',
  succeeded: 'succeeded',
  failed: 'failed',
  refunded: 'refunded'
}

const VALID_TRANSITIONS = {
  created: ['processing', 'failed'],
  processing: ['succeeded', 'failed'],
  succeeded: ['refunded'],
  failed: [],
  refunded: []
}

/**
 * Check if a payment intent status transition is valid.
 * @param {string} currentStatus
 * @param {string} newStatus
 * @returns {boolean}
 */
export function isValidPaymentTransition(currentStatus, newStatus) {
  const allowed = VALID_TRANSITIONS[currentStatus]
  return Array.isArray(allowed) && allowed.includes(newStatus)
}

// ── Booking Intent Status ──────────────────────────────────────────────────
export const BOOKING_INTENT_STATUS = {
  pending: 'pending',
  payment_started: 'payment_started',
  payment_completed: 'payment_completed',
  payment_failed: 'payment_failed',
  expired: 'expired',
  cancelled: 'cancelled',
  confirmed: 'confirmed'
}

const BOOKING_TRANSITIONS = {
  pending: ['payment_started', 'expired', 'cancelled'],
  payment_started: ['payment_completed', 'payment_failed', 'expired', 'cancelled'],
  payment_completed: ['confirmed', 'cancelled'],
  payment_failed: ['payment_started', 'cancelled'],
  expired: [],
  cancelled: [],
  confirmed: []
}

/**
 * Check if a booking intent status transition is valid.
 * @param {string} currentStatus
 * @param {string} newStatus
 * @returns {boolean}
 */
export function isValidBookingIntentTransition(currentStatus, newStatus) {
  const allowed = BOOKING_TRANSITIONS[currentStatus]
  return Array.isArray(allowed) && allowed.includes(newStatus)
}

/**
 * Get the list of valid next states for a booking intent.
 * @param {string} currentStatus
 * @returns {string[]}
 */
export function getNextBookingIntentStates(currentStatus) {
  return BOOKING_TRANSITIONS[currentStatus] || []
}

/**
 * Validate provider config payload before saving.
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProviderConfig(config) {
  const errors = []

  if (!config.provider || !PAYMENT_PROVIDERS[config.provider]) {
    errors.push('Invalid or missing payment provider')
  }

  if (config.provider && config.provider !== 'manual_adapter') {
    if (!config.public_key) errors.push('Public key is required')
    if (!config.secret_key) errors.push('Secret key is required')
    if (!config.webhook_secret) errors.push('Webhook secret is required')
  }

  if (config.country && config.country.length !== 2) {
    errors.push('Country must be a 2-letter ISO code')
  }

  if (!config.mode || !['test', 'live'].includes(config.mode)) {
    errors.push('Mode must be test or live')
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Get the checkout URL for a provider. In test mode, returns a mock URL.
 * @param {string} provider
 * @param {object} paymentIntent - { id, amount, currency, provider_payment_id }
 * @param {string} successUrl
 * @param {string} cancelUrl
 * @returns {string|null}
 */
export function getCheckoutUrl(provider, paymentIntent, successUrl, cancelUrl) {
  if (!provider || !PAYMENT_PROVIDERS[provider]) return null

  // In production, each provider would have its own checkout URL format
  // For now, return a structured object that the frontend can use
  return {
    provider,
    payment_intent_id: paymentIntent.id,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Provider-specific redirect URLs would be built server-side
    // with actual API calls to the provider
    mode: 'redirect'
  }
}

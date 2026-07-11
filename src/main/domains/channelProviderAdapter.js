// Channel Manager Provider Adapter Boundary
// This defines the contract for external OTA provider integration.
// No real provider is implemented yet, so the adapter must fail closed.

function notConnected(operation) {
  return {
    success: false,
    provider_connected: false,
    manual_review_required: true,
    error: `Live OTA provider adapter is not connected; ${operation} was not sent to a live channel.`,
    message: `Provider adapter not connected - ${operation} requires manual review.`
  }
}

export async function pushAvailability(provider, payload) {
  return notConnected('availability sync')
}

export async function pushRates(provider, payload) {
  return notConnected('rate sync')
}

export async function fetchReservations(provider, since) {
  return {
    ...notConnected('reservation fetch'),
    reservations: []
  }
}

export async function acknowledgeReservation(provider, reservationId) {
  return notConnected('reservation acknowledgement')
}

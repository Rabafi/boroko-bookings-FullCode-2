export function sanitizeBarPosError(err) {
  if (!err) return { message: 'Unknown error', code: 'UNKNOWN' }
  const msg = String(err?.message || err || '')
  const code = err?.code || 'UNKNOWN'
  if (msg.includes('login') || msg.includes('password') || msg.includes('invalid_credentials')) return { message: 'Invalid email or password', code: 'AUTH_FAILED' }
  if (msg.includes('offline') || msg.includes('not configured')) return { message: 'System is offline. Check your connection.', code: 'OFFLINE' }
  return { message: msg, code }
}

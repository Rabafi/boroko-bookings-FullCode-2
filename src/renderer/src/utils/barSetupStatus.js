// @ts-check
/** A transport failure must never become permission to create a new Bar.
 * @param {unknown} value
 */
export function classifyBarSetupStatus(value) {
  if (!value || typeof value !== 'object' || !('available' in value)) throw new Error('The saved setup status could not be verified. Keep this window and retry the status check; do not create another Bar.')
  if (value.available === false && 'phase' in value && value.phase === null && 'can_resume' in value && value.can_resume === false) return 'absent'
  if (value.available === true && 'attempt_id' in value && typeof value.attempt_id === 'string' && value.attempt_id && 'phase' in value && typeof value.phase === 'string') return 'present'
  throw new Error('The saved setup response is incomplete. Preserve this Windows profile and contact support.')
}

/** @template T
 * @param {Promise<T>} request
 * @param {number} [timeoutMs]
 * @returns {Promise<T>}
 */
export async function boundedSetupRead(request, timeoutMs = 15000) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  /** @type {Promise<never>} */
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The saved setup check is taking too long. Keep this window open and retry the status check. Do not create another Bar.')), timeoutMs)
  })
  try {
    return await Promise.race([request, timeout])
  } finally { clearTimeout(timer) }
}

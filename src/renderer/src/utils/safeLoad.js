/**
 * safeLoad — wraps a promise to never throw, returning [data, error].
 * Use in parallel loads to detect partial failures.
 */
export async function safeLoad(promise) {
  try {
    const data = await promise
    return [data, null]
  } catch (err) {
    return [null, err?.message || String(err)]
  }
}

/**
 * safeLoadAll — runs multiple promises in parallel, returns { data, errors }.
 * `data` is an array of results (null for failed loads).
 * `errors` is an array of error messages (null for successful loads).
 */
export async function safeLoadAll(...promises) {
  const results = await Promise.allSettled(promises)
  const data = results.map(r => r.status === 'fulfilled' ? r.value : null)
  const errors = results.map(r => r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : null)
  return { data, errors }
}

/**
 * hasPartialFailures — returns true if any error entry is non-null.
 */
export function hasPartialFailures(errors) {
  return Array.isArray(errors) && errors.some(e => e !== null)
}

/**
 * getFailureSummary — returns a human-readable summary of which loads failed.
 */
export function getFailureSummary(errors, labels = []) {
  if (!hasPartialFailures(errors)) return null
  const failed = errors
    .map((err, i) => err ? (labels[i] || `Section ${i + 1}`) : null)
    .filter(Boolean)
  return `Failed to load: ${failed.join(', ')}`
}

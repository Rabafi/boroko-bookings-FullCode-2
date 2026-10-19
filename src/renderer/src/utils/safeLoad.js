// @ts-check
/** @param {unknown} error @returns {unknown} */
function readErrorMessage(error) {
  if (error === null || error === undefined) return undefined
  return /** @type {Record<string, unknown>} */ (Object(error)).message
}

/**
 * safeLoad — wraps a promise to never throw, returning [data, error].
 * Use in parallel loads to detect partial failures.
 * @template T
 * @param {PromiseLike<T>|T} promise
 * @returns {Promise<[T, null]|[null, unknown]>}
 */
export async function safeLoad(promise) {
  try {
    const data = await promise
    return [data, null]
  } catch (err) {
    const errorMessage = readErrorMessage(err)
    return [null, errorMessage || String(err)]
  }
}

/**
 * safeLoadAll — runs multiple promises in parallel, returns { data, errors }.
 * `data` is an array of results (null for failed loads).
 * `errors` is an array of error messages (null for successful loads).
 * @param {...PromiseLike<unknown>} promises
 * @returns {Promise<{data: Array<unknown|null>, errors: Array<unknown|null>}>}
 */
export async function safeLoadAll(...promises) {
  const results = await Promise.allSettled(promises)
  const data = results.map(r => r.status === 'fulfilled' ? r.value : null)
  const errors = results.map(r => r.status === 'rejected' ? (r.reason?.message || String(r.reason)) : null)
  return { data, errors }
}

/**
 * hasPartialFailures — returns true if any error entry is non-null.
 * @param {unknown} errors
 * @returns {errors is unknown[]}
 */
export function hasPartialFailures(errors) {
  return Array.isArray(errors) && errors.some(e => e !== null)
}

/**
 * getFailureSummary — returns a human-readable summary of which loads failed.
 * @param {unknown} errors
 * @param {string[]} [labels]
 * @returns {string|null}
 */
export function getFailureSummary(errors, labels = []) {
  if (!hasPartialFailures(errors)) return null
  const failed = errors
    .map((err, i) => err ? (labels[i] || `Section ${i + 1}`) : null)
    .filter(Boolean)
  return `Failed to load: ${failed.join(', ')}`
}

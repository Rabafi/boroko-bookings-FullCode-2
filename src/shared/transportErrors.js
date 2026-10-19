// @ts-check
/**
 * Human-readable transport errors for operator screens.
 * Electron prefixes main-process IPC failures with
 * "Error invoking remote method '<channel>': ...", which means nothing to a
 * bartender. This strips the prefix (preserving any error code) so screens
 * show the human message underneath. Pure helper: safe in main, preload and
 * renderer worlds.
 */
/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptionalField(value, key) {
  return value === null || value === undefined
    ? undefined
    : Reflect.get(Object(value), key, value)
}

/** @param {unknown} error @returns {Error} */
export function cleanTransportError(error) {
  const text = readOptionalField(error, 'message') || String(error || 'Something went wrong.')
  const stripped = String(text).replace(/^Error invoking remote method '[^']+':\s*/, '')
  if (stripped !== text) {
    const clean = new Error(stripped)
    if (readOptionalField(error, 'code')) {
      // `Error` has no standard code field; retain the existing custom-code assignment.
      Object.assign(clean, { code: readOptionalField(error, 'code') })
    }
    return clean
  }
  return error instanceof Error ? error : new Error(text)
}

/** @param {unknown} error @param {string} [fallback] @returns {string} */
export function transportErrorMessage(error, fallback = 'Something went wrong.') {
  if (error === null || error === undefined || error === '') return fallback
  return cleanTransportError(error).message || fallback
}

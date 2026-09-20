/**
 * Human-readable transport errors for operator screens.
 * Electron prefixes main-process IPC failures with
 * "Error invoking remote method '<channel>': ...", which means nothing to a
 * bartender. This strips the prefix (preserving any error code) so screens
 * show the human message underneath. Pure helper: safe in main, preload and
 * renderer worlds.
 */
export function cleanTransportError(error) {
  const text = error?.message || String(error || 'Something went wrong.')
  const stripped = String(text).replace(/^Error invoking remote method '[^']+':\s*/, '')
  if (stripped !== text) {
    const clean = new Error(stripped)
    if (error?.code) clean.code = error.code
    return clean
  }
  return error instanceof Error ? error : new Error(text)
}

export function transportErrorMessage(error, fallback = 'Something went wrong.') {
  if (error === null || error === undefined || error === '') return fallback
  return cleanTransportError(error).message || fallback
}

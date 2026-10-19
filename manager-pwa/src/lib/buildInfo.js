/* global __BOROKO_APP_BUILD_ID__, __BOROKO_APP_VERSION__ */
// @ts-check
/**
 * Manager PWA build identity (browser scope).
 *
 * APP_VERSION/APP_BUILD_ID come from Vite build-time globals declared in
 * manager-pwa/src/types/build-info.d.ts; on a raw unbundled import without
 * those globals this module throws (ReferenceError). These declarations add
 * no runtime defaults and must not be read as support for raw execution.
 */
/**
 * Return trimmed nonempty strings unchanged, else the replacement unchanged.
 *
 * @param {unknown} value
 * @param {string} replacement
 * @returns {string}
 */
const fallback = (value, replacement) => (typeof value === 'string' && value.trim() ? value.trim() : replacement)

export const APP_VERSION = fallback(__BOROKO_APP_VERSION__, 'development')
export const APP_BUILD_ID = fallback(__BOROKO_APP_BUILD_ID__, 'dev-local')

/**
 * Short display form of a build id. Unknown input falls back honestly via
 * the existing boundary (see fallback); strings over 18 characters truncate
 * to 18 plus an ellipsis.
 *
 * @param {unknown} [value]
 * @returns {string}
 */
export function shortBuildId(value = APP_BUILD_ID) {
  const normalized = fallback(value, 'unknown')
  return normalized.length > 18 ? `${normalized.slice(0, 18)}…` : normalized
}

/**
 * Service-worker registration URL carrying the current version/build query,
 * in the existing key order and encoding.
 *
 * @returns {string}
 */
export function serviceWorkerUrl() {
  const query = new URLSearchParams({ version: APP_VERSION, build: APP_BUILD_ID })
  return `/sw.js?${query.toString()}`
}

/**
 * Optional worker build metadata from a registration worker's scriptURL.
 * Missing/falsy scriptURL and any parse exception yield {} (own empty
 * object). Returned fields are optional strings that never guarantee
 * worker/app build agreement — narrow before use.
 *
 * @typedef {{version?: string, buildId?: string}} WorkerBuildInfo
 * @param {ServiceWorker | null | undefined} [worker]
 * @returns {WorkerBuildInfo}
 */
export function getWorkerBuildInfo(worker) {
  if (!worker?.scriptURL) return {}
  try {
    const url = new URL(worker.scriptURL, window.location.origin)
    return {
      version: url.searchParams.get('version') || undefined,
      buildId: url.searchParams.get('build') || undefined
    }
  } catch {
    return {}
  }
}

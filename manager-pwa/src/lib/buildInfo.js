/* global __BOROKO_APP_BUILD_ID__, __BOROKO_APP_VERSION__ */

const fallback = (value, replacement) => (typeof value === 'string' && value.trim() ? value.trim() : replacement)

export const APP_VERSION = fallback(__BOROKO_APP_VERSION__, 'development')
export const APP_BUILD_ID = fallback(__BOROKO_APP_BUILD_ID__, 'dev-local')

export function shortBuildId(value = APP_BUILD_ID) {
  const normalized = fallback(value, 'unknown')
  return normalized.length > 18 ? `${normalized.slice(0, 18)}…` : normalized
}

export function serviceWorkerUrl() {
  const query = new URLSearchParams({ version: APP_VERSION, build: APP_BUILD_ID })
  return `/sw.js?${query.toString()}`
}

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

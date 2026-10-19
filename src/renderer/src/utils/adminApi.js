// @ts-check
export function getAdminApi() {
  return window?.api?.admin || {}
}

/** @param {string} name */
export function isAdminApiAvailable(name) {
  const api = getAdminApi()
  return typeof Reflect.get(Object(api), name) === 'function'
}

/** @param {string} name @param {Record<string, unknown>} [fallback] */
export function unavailableAdminApiResult(name, fallback = {}) {
  return {
    ok: false,
    unavailable: true,
    error: `Command Central API "${name}" is unavailable. Restart or update the desktop app.`,
    ...fallback
  }
}

/** @param {string} name @param {Iterable<unknown>} [args] @param {Record<string, unknown>} [fallback] */
export async function callAdminApi(name, args = [], fallback = {}) {
  const api = getAdminApi()
  const candidate = Reflect.get(Object(api), name)
  if (typeof candidate !== 'function') return unavailableAdminApiResult(name, fallback)
  return candidate(...args)
}

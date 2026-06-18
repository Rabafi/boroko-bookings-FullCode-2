export function getAdminApi() {
  return window?.api?.admin || {}
}

export function isAdminApiAvailable(name) {
  return typeof getAdminApi()[name] === 'function'
}

export function unavailableAdminApiResult(name, fallback = {}) {
  return {
    ok: false,
    unavailable: true,
    error: `Command Central API "${name}" is unavailable. Restart or update the desktop app.`,
    ...fallback
  }
}

export async function callAdminApi(name, args = [], fallback = {}) {
  const fn = getAdminApi()[name]
  if (typeof fn !== 'function') return unavailableAdminApiResult(name, fallback)
  return fn(...args)
}

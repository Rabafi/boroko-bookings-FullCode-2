import { APP_BUILD_ID, APP_VERSION, getWorkerBuildInfo } from './buildInfo'

const listeners = new Set()
let registration = null
let snapshot = {
  phase: 'idle',
  registration: null,
  version: APP_VERSION,
  buildId: APP_BUILD_ID
}

function publish(next) {
  snapshot = { ...snapshot, ...next, registration }
  listeners.forEach((listener) => listener(snapshot))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('boroko:pwa-update-state', { detail: snapshot }))
  }
}

export function getAppUpdateSnapshot() {
  return snapshot
}

export function subscribeToAppUpdate(listener) {
  listeners.add(listener)
  listener(snapshot)
  return () => listeners.delete(listener)
}

export function setServiceWorkerRegistration(nextRegistration) {
  registration = nextRegistration || null
  const worker = registration?.waiting || registration?.active || registration?.installing
  const identity = getWorkerBuildInfo(worker)
  publish({
    phase: registration?.waiting && navigator.serviceWorker?.controller ? 'available' : 'ready',
    version: identity.version || APP_VERSION,
    buildId: identity.buildId || APP_BUILD_ID
  })
}

export function markServiceWorkerUpdateAvailable(nextRegistration, worker = nextRegistration?.waiting) {
  if (nextRegistration) registration = nextRegistration
  const identity = getWorkerBuildInfo(worker)
  publish({
    phase: 'available',
    version: identity.version || APP_VERSION,
    buildId: identity.buildId || APP_BUILD_ID
  })
}

export async function checkForAppUpdate() {
  if (!registration) {
    publish({ phase: 'unavailable' })
    return false
  }

  publish({ phase: 'checking' })
  try {
    await registration.update()
    if (registration.waiting && navigator.serviceWorker?.controller) {
      markServiceWorkerUpdateAvailable(registration)
      return true
    }
    publish({ phase: 'ready' })
    return false
  } catch {
    publish({ phase: 'error' })
    return false
  }
}

export function applyAppUpdate() {
  const waiting = registration?.waiting
  if (!waiting) return false
  publish({ phase: 'applying' })
  waiting.postMessage({ type: 'SKIP_WAITING' })
  return true
}

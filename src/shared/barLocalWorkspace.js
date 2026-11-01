// @ts-check
/**
 * A Bar is local-first. An owner who already runs a cloud business on this
 * computer cannot commission a local Bar inside the running cloud workspace:
 * that process has already started the cloud database, replay queue and timers,
 * and its profile directory belongs to the cloud business.
 *
 * Instead the app opens a dedicated local Bar workspace window. It is the same
 * application, launched with this flag, but it owns a separate `userData` root
 * (protected authority profile, device credential, intent journal, caches) and
 * therefore its own single-instance lock. The cloud business is never imported,
 * converted or erased, and the two authorities never share one business.
 */
export const LOCAL_BAR_WORKSPACE_FLAG = '--bar-local-workspace'
export const LOCAL_BAR_WORKSPACE_DIR = 'local-bar-workspace'
export const LOCAL_BAR_SETUP_REQUEST_FILE = 'bar-local-setup-request.json'
export const LOCAL_BAR_SETUP_REQUEST_VERSION = 2
export const LEGACY_LOCAL_BAR_SETUP_REQUEST_VERSION = 1

/** @param {readonly string[]} argv */
export function isDedicatedLocalBarWorkspaceArgv(argv) {
  return Array.isArray(argv) && argv.includes(LOCAL_BAR_WORKSPACE_FLAG)
}

// @ts-check
import { state } from '../state.js';

/** @type {WeakMap<object, number>} */
const clientIds = new WeakMap();
let nextClientId = 1;

/** @param {{includeActor?: boolean}} [options] */
export function captureReadScope({ includeActor = true } = {}) {
  return { lodgeId: state.lodgeId, cacheDir: state.cacheDir, client: state.supabase, actorId: state.currentUser?.id || null, includeActor };
}

/** @param {ReturnType<typeof captureReadScope>} scope */
export function isReadScopeCurrent(scope) {
  return scope.lodgeId === state.lodgeId && scope.cacheDir === state.cacheDir &&
    scope.client === state.supabase && (!scope.includeActor || scope.actorId === (state.currentUser?.id || null));
}

/** @param {ReturnType<typeof captureReadScope>} scope */
export function assertReadScopeCurrent(scope) {
  if (!isReadScopeCurrent(scope)) {
    const error = Object.assign(new Error('The business or signed-in session changed while data was loading. Refresh this workspace.'), { code: 'business_context_changed' });
    throw error;
  }
}

/** @param {string} name */
export function scopedReadKey(name) {
  const scope = captureReadScope();
  let clientId = 0;
  if (scope.client) {
    if (!clientIds.has(scope.client)) clientIds.set(scope.client, nextClientId++);
    clientId = clientIds.get(scope.client) || 0;
  }
  return JSON.stringify([name, scope.lodgeId, scope.cacheDir, scope.actorId, clientId]);
}

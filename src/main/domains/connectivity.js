import { BrowserWindow } from 'electron';
import { state } from '../state.js';
import { buildSyncStatusSnapshot } from './syncStatus.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY;
const CONNECTIVITY_PROBE_TIMEOUT_MS = 10000;
const CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD = 3;
// Short startup probe budget. initDatabase runs before the main window is
// created, so a dead/slow network must not hold first paint hostage for the
// full periodic-probe budget (let alone twice). The reconnect + periodic
// timers keep the full 10s budget once the app is running.
export const STARTUP_CONNECTIVITY_PROBE_TIMEOUT_MS = 4000;
export const NETWORK_READ_TIMEOUT_MS = 12000;

/**
 * Races any network-backed read against a timeout so an unreachable network
 * fails fast to the caller's cache fallback instead of hanging the Till.
 * The underlying promise is left to settle; only the waiter moves on.
 */
export function withNetworkTimeout(promise, ms = NETWORK_READ_TIMEOUT_MS, label = 'network read') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${ms}ms. Showing last saved data.`);
      error.code = 'network_read_timeout';
      reject(error);
    }, ms);
    if (timer?.unref) timer.unref();
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function broadcastSyncStatus() {
  try {
    const status = buildSyncStatusSnapshot();
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('sync:status-changed', status);
    });
  } catch (e) {
    console.error('[Sync] IPC broadcast failed:', e);
  }
}

/** True when the Supabase project is reachable over the network (not whether RLS allows reading rooms). */
export async function checkOnline(options = {}) {
  if (process.env.BOROKO_TEST_FORCE_OFFLINE === 'true') {
    const wasOnline = state.isOnline;
    state.isOnline = false;
    state.consecutiveConnectivityFailures = CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD;
    if (wasOnline) broadcastSyncStatus();
    return state.isOnline;
  }
  const timeoutMs = Number(options?.timeoutMs) > 0 ? Number(options.timeoutMs) : CONNECTIVITY_PROBE_TIMEOUT_MS;
  const wasOnline = state.isOnline;
  const base = SUPABASE_URL.replace(/\/$/, '');
  const reachable = (res) => res && res.status > 0 && res.status < 500;

  const probeNoAuth = async (url) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return reachable(await fetch(url, { method: 'GET', signal: ctrl.signal }));
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  };

  const rawOnline = await probeNoAuth(`${base}/auth/v1/health`);

  if (rawOnline) {
    state.consecutiveConnectivityFailures = 0;
    state.isOnline = true;
  } else {
    state.consecutiveConnectivityFailures += 1;
    if (state.consecutiveConnectivityFailures >= CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD) {
      state.isOnline = false;
    }
  }

  if (wasOnline !== state.isOnline) broadcastSyncStatus();
  return state.isOnline;
}

import { BrowserWindow } from 'electron';
import { state } from '../state.js';
import { buildSyncStatusSnapshot } from './syncStatus.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_KEY;
const CONNECTIVITY_PROBE_TIMEOUT_MS = 10000;
const CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD = 3;

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
export async function checkOnline() {
  if (process.env.BOROKO_TEST_FORCE_OFFLINE === 'true') {
    const wasOnline = state.isOnline;
    state.isOnline = false;
    state.consecutiveConnectivityFailures = CONNECTIVITY_OFFLINE_FAILURE_THRESHOLD;
    if (wasOnline) broadcastSyncStatus();
    return state.isOnline;
  }
  const wasOnline = state.isOnline;
  const base = SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`
  };
  const fetchWithTimeout = async (url, init = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONNECTIVITY_PROBE_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, headers, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };
  const reachable = (res) => res && res.status > 0 && res.status < 500;
  const probe = async (url) => {
    try {
      return reachable(await fetchWithTimeout(url, { method: 'GET' }));
    } catch {
      return false;
    }
  };

  const rawOnline = (await Promise.all([
    probe(`${base}/auth/v1/health`),
    probe(`${base}/rest/v1/`)
  ])).some(Boolean);

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

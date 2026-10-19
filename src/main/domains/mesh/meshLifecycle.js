// @ts-check
import { state } from '../../state.js';
import { meshState, getOrCreateLocalNodeId } from './meshState.js';
import { startMeshServer, stopMeshServer } from './meshServer.js';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { readCache } from '../cacheStore.js';

// Register clean exit handler if Electron environment is present
/** @type {ReturnType<typeof setInterval> | null} */
let meshSyncIntervalId = null;
let meshSecretColumnWarningShown = false;

/** @typedef {Omit<typeof meshState, 'lodgeId' | 'lodgeMeshSecret' | 'lastError'> & {
 * lodgeId: string | null,
 * lodgeMeshSecret: string | null,
 * lastError: unknown,
 * _failedLodgeId?: string,
 * _lastFailureAt?: number,
 * _failureLogged?: boolean
 * }} LifecycleMeshState */
const lifecycleMeshState = /** @type {LifecycleMeshState} */ (meshState);
/** @param {unknown} error */
function readThrownMessage(error) {
  const errorFields = /** @type {Record<string, unknown> | null | undefined} */ (error);
  return errorFields?.message;
}

/** @param {unknown} error */
function readDirectThrownMessage(error) {
  return /** @type {{ message: unknown }} */ (error).message;
}

if (app) {
  app.on('will-quit', () => {
    shutdownMesh();
  });
}

async function loadLodgeMeshSecret() {
  const settings = readCache('settings');
  const row = Array.isArray(settings) ? settings[0] : settings;
  const cachedSecret = String(row?.lodge_mesh_secret || '').trim();
  if (cachedSecret) return cachedSecret;

  if (state.isOnline && state.supabase && state.lodgeId) {
    try {
      const { data, error } = await state.supabase
        .from('settings')
        .select('lodge_mesh_secret')
        .eq('lodge_id', state.lodgeId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const remoteSecret = String(data?.lodge_mesh_secret || '').trim();
      if (remoteSecret) return remoteSecret;
    } catch (error) {
      const message = String(readThrownMessage(error) || error || '');
      if (/column settings\.lodge_mesh_secret does not exist/i.test(message)) {
        if (!meshSecretColumnWarningShown) {
          meshSecretColumnWarningShown = true;
          console.warn('[MeshLifecycle] Remote settings table is missing lodge_mesh_secret; mesh will rely on cached local settings until the database schema is updated.');
        }
      } else {
        console.warn('[MeshLifecycle] Could not load lodge_mesh_secret from Supabase:', message);
      }
    }
  }

  if (app && !app.isPackaged) {
    try {
      const secretPath = path.join(app.getPath('appData'), 'boroko-bookings-local-mesh-secret.json');
      if (fs.existsSync(secretPath)) {
        const secret = String(JSON.parse(fs.readFileSync(secretPath, 'utf8'))?.lodge_mesh_secret || '').trim();
        if (secret) return secret;
      }
    } catch {}
  }

  return null;
}

/**
 * Initializes and starts all local P2P mesh network operations for the active lodge.
 */
export async function initializeMesh() {
  if (!state.lodgeId) return;

  if (meshState.running) return;

  const RETRY_INTERVAL_MS = 120_000;
  const lastFailureAt = lifecycleMeshState._failedLodgeId === state.lodgeId ? (lifecycleMeshState._lastFailureAt || 0) : 0;
  if (lastFailureAt && Date.now() - lastFailureAt < RETRY_INTERVAL_MS) return;

  try {
    // 1. Initialize node identity
    const nodeId = getOrCreateLocalNodeId();
    lifecycleMeshState.lodgeId = state.lodgeId;
    meshState.enabled = true;

    // 2. Load the lodge mesh secret from the authenticated settings cache.
    // Never derive this from lodgeId; a predictable LAN secret breaks mesh auth.
    const secret = await loadLodgeMeshSecret();
    if (!secret) {
      meshState.enabled = false;
      lifecycleMeshState.lodgeId = null;
      lifecycleMeshState._failedLodgeId = state.lodgeId;
      lifecycleMeshState._lastFailureAt = Date.now();
      lifecycleMeshState.lastError = 'Mesh disabled: missing lodge_mesh_secret in cached settings.';
      if (!lifecycleMeshState._failureLogged) {
        lifecycleMeshState._failureLogged = true;
        console.warn('[MeshLifecycle] Mesh disabled: missing lodge_mesh_secret in cached settings.');
      }
      return;
    }

    lifecycleMeshState.lodgeMeshSecret = secret;

    // 3. Start the dynamic HTTP/TCP server
    startMeshServer(secret);
    console.log(`[MeshLifecycle] Mesh initialized successfully for Lodge: ${state.lodgeId}, Node: ${nodeId}`);

    // 4. (Phase 2 Hook) Start UDP discovery
    try {
      const { startMeshDiscovery } = await import('./meshDiscovery.js');
      startMeshDiscovery();
    } catch (err) {
      console.warn('[MeshLifecycle] Discovery module not yet implemented or loaded:', readDirectThrownMessage(err));
    }

    // 5. Start periodic sync queue reconciliation (every 15 seconds)
    meshSyncIntervalId = setInterval(async () => {
      try {
        const { syncMeshQueues } = await import('./meshQueueMerge.js');
        await syncMeshQueues();
      } catch (err) {
        console.error('[MeshLifecycle] Error running scheduled mesh queue sync:', err);
      }
    }, 15000);

  } catch (err) {
    lifecycleMeshState._failedLodgeId = state.lodgeId;
    lifecycleMeshState._lastFailureAt = Date.now();
    if (!lifecycleMeshState._failureLogged) {
      lifecycleMeshState._failureLogged = true;
      console.error('[MeshLifecycle] Failed to initialize P2P mesh services:', err);
    }
    lifecycleMeshState.lastError = readDirectThrownMessage(err);
  }
}

/**
 * Gracefully shuts down all local P2P mesh network operations.
 */
export function shutdownMesh() {
  console.log('[MeshLifecycle] Shutting down local P2P mesh network...');
  
  if (meshSyncIntervalId) {
    clearInterval(meshSyncIntervalId);
    meshSyncIntervalId = null;
  }

  // 1. (Phase 2 Hook) Stop UDP discovery
  try {
    import('./meshDiscovery.js').then((module) => {
      if (module.stopMeshDiscovery) {
        module.stopMeshDiscovery();
      }
    }).catch(() => {});
  } catch (err) {
    // ignore
  }

  // 2. Stop HTTP server
  stopMeshServer();

  // 3. Reset in-memory state
  meshState.enabled = false;
  meshState.running = false;
  meshState.peers.clear();
  meshState.activeLocks = [];
  lifecycleMeshState.lodgeMeshSecret = null;
  lifecycleMeshState.lodgeId = null;

  console.log('[MeshLifecycle] Mesh services fully stopped and cleaned.');
}

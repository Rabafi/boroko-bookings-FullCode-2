import { state } from '../../state.js';
import { meshState, getOrCreateLocalNodeId } from './meshState.js';
import { startMeshServer, stopMeshServer } from './meshServer.js';
import { app } from 'electron';
import { readCache } from '../cacheStore.js';

// Register clean exit handler if Electron environment is present
let meshSyncIntervalId = null;

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
      console.warn('[MeshLifecycle] Could not load lodge_mesh_secret from Supabase:', error?.message || error);
    }
  }

  return null;
}

/**
 * Initializes and starts all local P2P mesh network operations for the active lodge.
 */
export async function initializeMesh() {
  if (!state.lodgeId) {
    console.log('[MeshLifecycle] Cannot initialize mesh: No active lodgeId.');
    return;
  }

  if (meshState.running) {
    console.log('[MeshLifecycle] Mesh services are already running.');
    return;
  }

  try {
    // 1. Initialize node identity
    const nodeId = getOrCreateLocalNodeId();
    meshState.lodgeId = state.lodgeId;
    meshState.enabled = true;

    // 2. Load the lodge mesh secret from the authenticated settings cache.
    // Never derive this from lodgeId; a predictable LAN secret breaks mesh auth.
    const secret = await loadLodgeMeshSecret();
    if (!secret) {
      meshState.enabled = false;
      meshState.lodgeId = null;
      meshState.lastError = 'Mesh disabled: missing lodge_mesh_secret in cached settings.';
      console.warn('[MeshLifecycle] Mesh disabled: missing lodge_mesh_secret in cached settings.');
      return;
    }

    meshState.lodgeMeshSecret = secret;

    // 3. Start the dynamic HTTP/TCP server
    startMeshServer(secret);
    console.log(`[MeshLifecycle] Mesh initialized successfully for Lodge: ${state.lodgeId}, Node: ${nodeId}`);

    // 4. (Phase 2 Hook) Start UDP discovery
    try {
      const { startMeshDiscovery } = await import('./meshDiscovery.js');
      startMeshDiscovery();
    } catch (err) {
      console.warn('[MeshLifecycle] Discovery module not yet implemented or loaded:', err.message);
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
    console.error('[MeshLifecycle] Failed to initialize P2P mesh services:', err);
    meshState.lastError = err.message;
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
  meshState.lodgeMeshSecret = null;
  meshState.lodgeId = null;

  console.log('[MeshLifecycle] Mesh services fully stopped and cleaned.');
}

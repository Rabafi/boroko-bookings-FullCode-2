// @ts-check
import http from 'http';
import url from 'url';
import { validateIncomingRequest } from './meshSecurity.js';
import { meshState } from './meshState.js';
import { readSyncQueue } from '../syncStore.js';
import { registerRemoteLock, releaseRemoteLock } from './meshLocks.js';
import { getQueueItemBodyHash, getQueueItemOperationHash, isMeshShareableQueueItem } from './meshQueueMerge.js';
import { buildTeamStateSnapshot } from './meshStateSync.js';

export const MESH_HTTP_PORT_START = 53536;
export const MESH_HTTP_PORT_END = 53545;

/** @typedef {Omit<typeof meshState, 'server' | 'httpPort' | 'lastError'> & {
 * server: ReturnType<typeof http.createServer> | null,
 * httpPort: number | null,
 * lastError: unknown
 * }} MeshServerState */
const serverMeshState = /** @type {MeshServerState} */ (meshState);

/** @param {unknown} error */
function readDirectThrownMessage(error) {
  return /** @type {{ message: unknown }} */ (error).message;
}

/**
 * Starts the P2P dynamic local HTTP server.
 */
/** @param {string} lodgeMeshSecret */
export function startMeshServer(lodgeMeshSecret) {
  if (serverMeshState.server) {
    console.log('[MeshServer] HTTP server already running.');
    return;
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(/** @type {string} */ (req.url), true);
    const pathname = /** @type {string} */ (parsedUrl.pathname);

    const allowlistedRoutes = new Set([
      '/mesh/hello',
      '/mesh/state',
      '/mesh/state/team',
      '/mesh/capabilities',
      '/mesh/queue/summary',
      '/mesh/queue/items',
      '/mesh/locks',
      '/mesh/conflicts/report'
    ]);

    // Check for DELETE lock request (/mesh/locks/:lockId)
    const isDeleteLockRoute = req.method === 'DELETE' && pathname.startsWith('/mesh/locks/');

    if (!allowlistedRoutes.has(pathname) && !isDeleteLockRoute) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Route not found or unallowlisted' }));
      return;
    }

    /** @type {Buffer[]} */
    let bodyBuffers = [];
    let bodyLength = 0;
    let limitExceeded = false;

    req.on('data', (chunk) => {
      if (limitExceeded) return;
      bodyLength += chunk.length;
      if (bodyLength > 102400) { // 100 KB body limit
        limitExceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        req.destroy();
      } else {
        bodyBuffers.push(chunk);
      }
    });

    req.on('end', () => {
      if (limitExceeded) return;

      const body = Buffer.concat(bodyBuffers).toString('utf8');

      // Validate HMAC signature (required on all routes)
      // req.url contains full path + query string exactly as received
      const validation = validateIncomingRequest(/** @type {string} */ (req.method), /** @type {string} */ (req.url), req.headers, body, lodgeMeshSecret);
      if (!validation.isValid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unauthorized: ${validation.error}` }));
        return;
      }

      try {
        if (req.method === 'GET' && pathname === '/mesh/hello') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            version: 1,
            nodeId: meshState.nodeId,
            lodgeId: meshState.lodgeId,
            serverTime: new Date().toISOString()
          }));
          return;
        }

        if (req.method === 'GET' && pathname === '/mesh/state') {
          const queue = /** @type {Array<Record<string, unknown>>} */ (readSyncQueue().filter(isMeshShareableQueueItem));
          let oldestQueuedAt = null;
          if (queue.length > 0) {
            const times = queue
              .map((item) => {
                const data = /** @type {Record<string, unknown> | null | undefined} */ (item.data);
                return item.createdAt || item.timestamp || item.created_at || data?.created_at || item.lastAttemptedAt;
              })
              .filter(Boolean);
            if (times.length > 0) {
              oldestQueuedAt = new Date(Math.min(...times.map((t) => new Date(/** @type {string | number | Date} */ (t)).getTime()))).toISOString();
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            nodeId: meshState.nodeId,
            queueSize: queue.length,
            oldestQueuedAt,
            lastQueueMutationAt: meshState.lastQueueMergeAt ? meshState.lastQueueMergeAt.toISOString() : null,
            activeLockCount: meshState.activeLocks.length
          }));
          return;
        }

        if (req.method === 'DELETE' && pathname.startsWith('/mesh/locks/')) {
          const lockId = pathname.slice('/mesh/locks/'.length);
          const released = releaseRemoteLock(lockId);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: released }));
          return;
        }

        if (req.method === 'POST' && pathname === '/mesh/locks') {
          let lockPayload;
          try {
            lockPayload = JSON.parse(body);
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
            return;
          }

          const registered = registerRemoteLock(lockPayload);
          res.writeHead(registered ? 201 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: registered }));
          return;
        }

        // Visible-only team state (attendance, cash movements/counts,
        // drawer periods, cash-up submissions), sanitized at build time.
        // Never replayed: the origin till remains the sole executor.
        if (req.method === 'GET' && pathname === '/mesh/state/team') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(buildTeamStateSnapshot()));
          return;
        }

        if (req.method === 'GET' && pathname === '/mesh/capabilities') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            protocolVersion: 2,
            queueFeatures: ['atomic_multi_room_booking_v1']
          }));
          return;
        }
        if (req.method === 'GET' && pathname === '/mesh/queue/summary') {
        const queue = /** @type {Array<Record<string, unknown>>} */ (readSyncQueue().filter(isMeshShareableQueueItem));
          const summary = queue.map((item) => {
            const data = /** @type {Record<string, unknown> | null | undefined} */ (item.data);
            const payload = /** @type {Record<string, unknown> | null | undefined} */ (data?.payload);
            return ({
            _queue_id: item._queue_id,
            operation: item.table || null,
            type: item.type || null,
            createdAt: item.createdAt || item.timestamp || null,
            intentId: item.intentId || data?.p_idempotency_key || payload?.create_idempotency_key || null,
            bodyHash: getQueueItemBodyHash(item),
            operationHash: getQueueItemOperationHash(item),
            requiredFeatures: item.table === 'create_multi_room_booking' ? ['atomic_multi_room_booking_v1'] : []
            });
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(summary));
          return;
        }

        if (req.method === 'GET' && pathname === '/mesh/queue/items') {
          const idsParam = /** @type {string} */ (parsedUrl.query.ids || '');
          const requestedIds = new Set(idsParam.split(',').map((id) => id.trim()).filter(Boolean));

          const queue = /** @type {Array<Record<string, unknown>>} */ (readSyncQueue().filter(isMeshShareableQueueItem));
          const matchedItems = queue.filter((item) => requestedIds.has(/** @type {string} */ (item._queue_id)));

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(matchedItems));
          return;
        }

        // Return 501 for allowlisted endpoints that belong to future phases
        res.writeHead(501, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint not implemented in this phase' }));
      } catch (err) {
        console.error('[MeshServer] Internal server error handling request:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Internal server error: ${readDirectThrownMessage(err)}` }));
      }
    });
  });

  /** @param {unknown} err */
  const handleRuntimeError = (err) => {
    console.error('[MeshServer] P2P HTTP Server experienced an error:', err);
    serverMeshState.lastError = readDirectThrownMessage(err);
    meshState.running = false;
  };

  /** @param {number} port */
  const tryPort = (port) => {
    /** @param {unknown} error */
    const onBindError = (error) => {
      server.removeListener('listening', onListening);
      const errorFields = /** @type {Record<string, unknown> | null | undefined} */ (error);
      if (errorFields?.code === 'EADDRINUSE' && port < MESH_HTTP_PORT_END) {
        tryPort(port + 1);
        return;
      }
      handleRuntimeError(error);
    };
    const onListening = () => {
      server.removeListener('error', onBindError);
      serverMeshState.httpPort = port;
      serverMeshState.server = server;
      meshState.running = true;
      serverMeshState.lastError = null;
      server.on('error', handleRuntimeError);
      console.log(`[MeshServer] P2P HTTP Server bound to predictable port ${port}`);
    };
    server.once('error', onBindError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  };

  tryPort(MESH_HTTP_PORT_START);
}

/**
 * Stops the P2P local HTTP server.
 */
export function stopMeshServer() {
  if (serverMeshState.server) {
    try {
      serverMeshState.server.close();
      console.log('[MeshServer] P2P HTTP Server stopped.');
    } catch (err) {
      console.error('[MeshServer] Error stopping HTTP server:', err);
    }
    serverMeshState.server = null;
    serverMeshState.httpPort = null;
    meshState.running = false;
  }
}

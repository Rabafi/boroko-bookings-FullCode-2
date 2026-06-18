import http from 'http';
import url from 'url';
import { validateIncomingRequest } from './meshSecurity.js';
import { meshState } from './meshState.js';
import { readSyncQueue } from '../syncStore.js';
import { registerRemoteLock, releaseRemoteLock } from './meshLocks.js';
import { getQueueItemBodyHash, isMeshShareableQueueItem } from './meshQueueMerge.js';

/**
 * Starts the P2P dynamic local HTTP server.
 */
export function startMeshServer(lodgeMeshSecret) {
  if (meshState.server) {
    console.log('[MeshServer] HTTP server already running.');
    return;
  }

  const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    const allowlistedRoutes = new Set([
      '/mesh/hello',
      '/mesh/state',
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
      const validation = validateIncomingRequest(req.method, req.url, req.headers, body, lodgeMeshSecret);
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
          const queue = readSyncQueue().filter(isMeshShareableQueueItem);
          let oldestQueuedAt = null;
          if (queue.length > 0) {
            const times = queue
              .map((item) => item.created_at || item.data?.created_at || item.lastAttemptedAt)
              .filter(Boolean);
            if (times.length > 0) {
              oldestQueuedAt = new Date(Math.min(...times.map((t) => new Date(t).getTime()))).toISOString();
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

        if (req.method === 'GET' && pathname === '/mesh/queue/summary') {
          const queue = readSyncQueue().filter(isMeshShareableQueueItem);
          const summary = queue.map((item) => ({
            _queue_id: item._queue_id,
            intentId: item.intentId || item.data?.p_idempotency_key || item.data?.payload?.create_idempotency_key || null,
            bodyHash: getQueueItemBodyHash(item)
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(summary));
          return;
        }

        if (req.method === 'GET' && pathname === '/mesh/queue/items') {
          const idsParam = parsedUrl.query.ids || '';
          const requestedIds = new Set(idsParam.split(',').map((id) => id.trim()).filter(Boolean));

          const queue = readSyncQueue();
          const matchedItems = queue.filter((item) => requestedIds.has(item._queue_id));

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
        res.end(JSON.stringify({ error: `Internal server error: ${err.message}` }));
      }
    });
  });

  // Bind to a dynamic local port on standard local interfaces
  server.listen(0, '0.0.0.0', () => {
    const address = server.address();
    meshState.httpPort = address.port;
    meshState.server = server;
    meshState.running = true;
    console.log(`[MeshServer] P2P HTTP Server successfully bound to dynamic port: ${address.port}`);
  });

  server.on('error', (err) => {
    console.error('[MeshServer] P2P HTTP Server experienced an error:', err);
    meshState.lastError = err.message;
    meshState.running = false;
  });
}

/**
 * Stops the P2P local HTTP server.
 */
export function stopMeshServer() {
  if (meshState.server) {
    try {
      meshState.server.close();
      console.log('[MeshServer] P2P HTTP Server stopped.');
    } catch (err) {
      console.error('[MeshServer] Error stopping HTTP server:', err);
    }
    meshState.server = null;
    meshState.httpPort = null;
    meshState.running = false;
  }
}

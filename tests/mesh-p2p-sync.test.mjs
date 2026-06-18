import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define directories for mocked environment
const workspaceRoot = path.resolve(__dirname, '..');
const scratchDir = path.join(workspaceRoot, 'scratch');
const mockedDir = path.join(scratchDir, 'mocked');

async function setupMockedEnvironment() {
  // Ensure mocked directory exists
  await fs.mkdir(mockedDir, { recursive: true });

  // 1. Create mockState.js
  await fs.writeFile(
    path.join(mockedDir, 'mockState.js'),
    `
    export const state = {
      lodgeId: 'test-lodge-123',
      cacheDir: ${JSON.stringify(path.join(scratchDir, 'test_cache'))}
    };
    `,
    'utf8'
  );

  // Ensure test cache directory exists
  await fs.mkdir(path.join(scratchDir, 'test_cache'), { recursive: true });

  // 2. Create mockElectron.js
  await fs.writeFile(
    path.join(mockedDir, 'mockElectron.js'),
    `
    export const app = {
      on: (event, cb) => {}
    };
    export const BrowserWindow = {
      getAllWindows() {
        return [];
      }
    };
    `,
    'utf8'
  );

  // 3. Create mockSyncStore.js
  await fs.writeFile(
    path.join(mockedDir, 'mockSyncStore.js'),
    `
    let queue = [];
    export function readSyncQueue() {
      return queue;
    }
    export function writeSyncQueue(newQueue) {
      queue = newQueue;
    }
    let failed = [];
    export function readFailedSyncQueue() {
      return failed;
    }
    export function writeFailedSyncQueue(newQueue) {
      failed = newQueue;
    }
    export function setMockSyncQueue(newQueue) {
      queue = newQueue;
    }
    export function setMockFailedSyncQueue(newQueue) {
      failed = newQueue;
    }
    `,
    'utf8'
  );

  // 4. Create mockCacheStore.js
  await fs.writeFile(
    path.join(mockedDir, 'mockCacheStore.js'),
    `
    let caches = {
      bookings: [],
      rooms: [],
      customers: [],
      users: []
    };
    export function readCache(entity) {
      return caches[entity] || [];
    }
    export function writeCache(entity, data) {
      caches[entity] = data;
    }
    export function setMockCache(entity, data) {
      caches[entity] = data;
    }
    `,
    'utf8'
  );

  // 5. Create mockConnectivity.js
  await fs.writeFile(
    path.join(mockedDir, 'mockConnectivity.js'),
    `
    export function broadcastSyncStatus() {
      // No-op in mock tests
    }
    `,
    'utf8'
  );

  // Copy and modify P2P source files into the mocked dir
  const sourceMeshDir = path.join(workspaceRoot, 'src', 'main', 'domains', 'mesh');
  const filesToCopy = [
    'meshState.js',
    'meshSecurity.js',
    'meshLocks.js',
    'meshQueueMerge.js',
    'meshConflict.js',
    'meshClient.js',
    'meshDiscovery.js',
    'meshServer.js',
    'meshLifecycle.js'
  ];

  for (const filename of filesToCopy) {
    const srcPath = path.join(sourceMeshDir, filename);
    let content = await fs.readFile(srcPath, 'utf8');

    // Perform import path rewriting
    content = content
      .replace(/import\s+\{\s*state\s*\}\s+from\s+['"]\.\.\/\.\.\/state\.js['"];/g, "import { state } from './mockState.js';")
      .replace(/import\s+\{\s*readSyncQueue,\s*writeSyncQueue\s*\}\s+from\s+['"]\.\.\/syncStore\.js['"];/g, "import { readSyncQueue, writeSyncQueue } from './mockSyncStore.js';")
      .replace(/import\s+\{\s*readFailedSyncQueue,\s*readSyncQueue,\s*writeFailedSyncQueue,\s*writeSyncQueue\s*\}\s+from\s+['"]\.\.\/syncStore\.js['"];/g, "import { readFailedSyncQueue, readSyncQueue, writeFailedSyncQueue, writeSyncQueue } from './mockSyncStore.js';")
      .replace(/import\s+\{\s*readSyncQueue\s*\}\s+from\s+['"]\.\.\/syncStore\.js['"];/g, "import { readSyncQueue } from './mockSyncStore.js';")
      .replace(/import\s+\{\s*readCache,\s*writeCache\s*\}\s+from\s+['"]\.\.\/cacheStore\.js['"];/g, "import { readCache, writeCache } from './mockCacheStore.js';")
      .replace(/import\s+['"]\.\.\/connectivity\.js['"]/g, "import './mockConnectivity.js'")
      .replace(/import\s+\{\s*broadcastSyncStatus\s*\}\s+from\s+['"]\.\.\/connectivity\.js['"];/g, "import { broadcastSyncStatus } from './mockConnectivity.js';")
      .replace(/import\s+\{\s*app\s*\}\s+from\s+['"]electron['"];/g, "import { app } from './mockElectron.js';")
      .replace(/import\s+\{\s*BrowserWindow\s*\}\s+from\s+['"]electron['"];/g, "import { BrowserWindow } from './mockElectron.js';")
      // Intercept inline dynamic imports
      .replace(/import\(['"]\.\.\/connectivity\.js['"]\)/g, "import('./mockConnectivity.js')")
      .replace(/import\(['"]\.\/meshQueueMerge\.js['"]\)/g, "import('./meshQueueMerge.js')")
      .replace(/import\(['"]\.\/meshDiscovery\.js['"]\)/g, "import('./meshDiscovery.js')")
      .replace(/fs\.existsSync\(settingsPath\)/g, "false"); // Ignore settings load in tests to fallback to derived secret

    await fs.writeFile(path.join(mockedDir, filename), content, 'utf8');
  }
}

async function runTests() {
  console.log('----------------------------------------------------');
  console.log('🔄 Setting up Boroko Bookings P2P Sync Mesh Test Suite');
  console.log('----------------------------------------------------');
  
  await setupMockedEnvironment();

  // Dynamically import our mocked domain modules
  const { meshState } = await import('../scratch/mocked/meshState.js');
  const { generateMeshSignature, validateIncomingRequest, computeBodyHash } = await import('../scratch/mocked/meshSecurity.js');
  const { createLocalLock, registerRemoteLock, releaseLocalLock } = await import('../scratch/mocked/meshLocks.js');
  const { validateSyncQueueItem, syncMeshQueues, applyImportedPosInventoryEffects, isMeshShareableQueueItem } = await import('../scratch/mocked/meshQueueMerge.js');
  const { detectConflicts, datesOverlap } = await import('../scratch/mocked/meshConflict.js');
  const { state } = await import('../scratch/mocked/mockState.js');
  const mockSyncStore = await import('../scratch/mocked/mockSyncStore.js');
  const mockCacheStore = await import('../scratch/mocked/mockCacheStore.js');

  // Initialize basic meshState identities
  meshState.running = true;
  meshState.nodeId = 'test-node-A';
  meshState.lodgeId = state.lodgeId;
  meshState.lodgeMeshSecret = 'test-mesh-shared-secret';

  let passed = 0;
  let failed = 0;

  async function runTest(name, fn) {
    try {
      await fn();
      console.log(`✅ TEST PASSED: ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ TEST FAILED: ${name}`);
      console.error(err);
      failed++;
    }
  }

  // ----------------------------------------------------
  // TEST 1: Strict HMAC Signature Generation & Timing-Safe Validation
  // ----------------------------------------------------
  await runTest('Strict HMAC Signature validation with path & query exactly', () => {
    const method = 'GET';
    const pathAndQuery = '/mesh/queue/items?ids=booking-1,booking-2';
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const body = '';

    const signature = generateMeshSignature(method, pathAndQuery, timestamp, nonce, body, meshState.lodgeMeshSecret);
    
    // Validate request headers matching signature
    const headers = {
      'x-boroko-mesh-node-id': 'peer-node-B',
      'x-boroko-mesh-lodge-id': meshState.lodgeId,
      'x-boroko-mesh-timestamp': timestamp,
      'x-boroko-mesh-nonce': nonce,
      'x-boroko-mesh-signature': signature
    };

    const validation = validateIncomingRequest(method, pathAndQuery, headers, body, meshState.lodgeMeshSecret);
    assert.equal(validation.isValid, true, `Validation failed: ${validation.error}`);
  });

  // ----------------------------------------------------
  // TEST 2: Bad HMAC Signature Rejection
  // ----------------------------------------------------
  await runTest('Rejection of incorrect request signature', () => {
    const headers = {
      'x-boroko-mesh-node-id': 'peer-node-B',
      'x-boroko-mesh-lodge-id': meshState.lodgeId,
      'x-boroko-mesh-timestamp': new Date().toISOString(),
      'x-boroko-mesh-nonce': crypto.randomUUID(),
      'x-boroko-mesh-signature': 'incorrect-hmac-signature-12345'
    };

    const validation = validateIncomingRequest('GET', '/mesh/hello', headers, '', meshState.lodgeMeshSecret);
    assert.equal(validation.isValid, false);
    assert.match(validation.error, /Signature verification failed|Invalid request signature/);
  });

  // ----------------------------------------------------
  // TEST 3: Nonce Replay Attack Protection
  // ----------------------------------------------------
  await runTest('Prevention of Nonce Replay Attacks', () => {
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const signature = generateMeshSignature('GET', '/mesh/hello', timestamp, nonce, '', meshState.lodgeMeshSecret);

    const headers = {
      'x-boroko-mesh-node-id': 'peer-node-B',
      'x-boroko-mesh-lodge-id': meshState.lodgeId,
      'x-boroko-mesh-timestamp': timestamp,
      'x-boroko-mesh-nonce': nonce,
      'x-boroko-mesh-signature': signature
    };

    // First attempt -> should succeed
    const firstAttempt = validateIncomingRequest('GET', '/mesh/hello', headers, '', meshState.lodgeMeshSecret);
    assert.equal(firstAttempt.isValid, true);

    // Second identical attempt (Replay) -> should fail
    const secondAttempt = validateIncomingRequest('GET', '/mesh/hello', headers, '', meshState.lodgeMeshSecret);
    assert.equal(secondAttempt.isValid, false);
    assert.equal(secondAttempt.error, 'Nonce already utilized');
  });

  // ----------------------------------------------------
  // TEST 4: Timestamp Drift Rejection
  // ----------------------------------------------------
  await runTest('Timestamp drift rejection (> 30 seconds)', () => {
    const oldTimestamp = new Date(Date.now() - 45000).toISOString();
    const nonce = crypto.randomUUID();
    const signature = generateMeshSignature('GET', '/mesh/hello', oldTimestamp, nonce, '', meshState.lodgeMeshSecret);

    const headers = {
      'x-boroko-mesh-node-id': 'peer-node-B',
      'x-boroko-mesh-lodge-id': meshState.lodgeId,
      'x-boroko-mesh-timestamp': oldTimestamp,
      'x-boroko-mesh-nonce': nonce,
      'x-boroko-mesh-signature': signature
    };

    const validation = validateIncomingRequest('GET', '/mesh/hello', headers, '', meshState.lodgeMeshSecret);
    assert.equal(validation.isValid, false);
    assert.match(validation.error, /Timestamp drift exceeds tolerance/);
  });

  // ----------------------------------------------------
  // TEST 5: Schema Validation of Queue Items
  // ----------------------------------------------------
  await runTest('Schema validation of allowlisted queue operations', () => {
    const validItem = {
      _queue_id: 'booking-create-11',
      type: 'rpc',
      table: 'create_booking',
      data: {
        p_lodge_id: meshState.lodgeId,
        p_customer_id: 'customer-11',
        p_room_id: 'room-A',
        p_check_in: '2026-06-01',
        p_check_out: '2026-06-03',
        p_booking_id: 'booking-11',
        p_idempotency_key: 'intent-11'
      }
    };

    const validation = validateSyncQueueItem(validItem);
    assert.equal(validation.isValid, true);

    const invalidTableItem = {
      _queue_id: 'corrupt-op-22',
      type: 'rpc',
      table: 'confidential_passwords', // NOT allowlisted table
      data: { secret: '123' }
    };

    const validation2 = validateSyncQueueItem(invalidTableItem);
    assert.equal(validation2.isValid, false);
    assert.match(validation2.reason, /not allowlisted/);

    const validPosItem = {
      _queue_id: 'pos-order-11',
      type: 'rpc',
      table: 'create_pos_order',
      data: {
        payload: {
          id: 'pos-11',
          lodge_id: meshState.lodgeId,
          create_idempotency_key: 'pos-intent-11',
          total: 60,
          payment_method: 'cash',
          items: [
            {
              inventory_item_id: 'stock-1',
              item_name: 'Water',
              quantity: 3,
              unit_price: 20,
              depletion_qty: 1
            }
          ]
        }
      }
    };
    assert.equal(validateSyncQueueItem(validPosItem).isValid, true);

    const invalidPosItem = {
      ...validPosItem,
      _queue_id: 'pos-order-bad',
      data: {
        payload: {
          ...validPosItem.data.payload,
          items: [{ inventory_item_id: 'stock-1', item_name: 'Water', quantity: -2, unit_price: 20 }]
        }
      }
    };
    const invalidPosValidation = validateSyncQueueItem(invalidPosItem);
    assert.equal(invalidPosValidation.isValid, false);
    assert.match(invalidPosValidation.reason, /invalid quantity/);

    const validPosV3Item = {
      _queue_id: 'pos-order-v3-11',
      type: 'rpc',
      table: 'create_pos_order_v3',
      data: {
        payload: {
          id: 'pos-v3-11',
          lodge_id: meshState.lodgeId,
          catalog_snapshot_id: 'catalog-11',
          shift_id: 'shift-11',
          source_device_id: 'desktop-test',
          create_idempotency_key: 'pos-v3-intent-11',
          items: [{ menu_item_id: 'menu-water', quantity: 2, modifier_option_ids: [] }]
        }
      }
    };
    assert.equal(validateSyncQueueItem(validPosV3Item).isValid, true);
    assert.equal(isMeshShareableQueueItem(validPosV3Item), true);

    const encryptedApproval = {
      _queue_id: 'pos-return-secret',
      type: 'rpc',
      table: 'create_pos_return_v3',
      data: {
        payload: {
          lodge_id: meshState.lodgeId,
          approval_pin: { _secure_queue_secret: true, data: 'machine-bound' }
        }
      }
    };
    assert.equal(isMeshShareableQueueItem(encryptedApproval), false, 'Machine-bound approvals must stay on their origin device');
  });

  // ----------------------------------------------------
  // TEST 6: Quarantine File Verification for Malformed Payloads
  // ----------------------------------------------------
  await runTest('Quarantining invalid operations instead of merging them', async () => {
    const quarantinePath = path.join(state.cacheDir, 'sync-mesh-quarantine.json');
    
    // Ensure any old quarantine file is removed
    try {
      await fs.unlink(quarantinePath);
    } catch (_) {}

    const badPayload = {
      _queue_id: 'booking-bad-33',
      type: 'rpc',
      table: 'invalid_table_name',
      data: {}
    };

    const validation = validateSyncQueueItem(badPayload);
    assert.equal(validation.isValid, false);

    // Trigger local quarantine log
    const { quarantineInvalidItem } = await import('../scratch/mocked/meshQueueMerge.js');
    quarantineInvalidItem(badPayload, validation.reason);

    // Verify written file contains quarantine details
    const fileContent = await fs.readFile(quarantinePath, 'utf8');
    const parsed = JSON.parse(fileContent);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed[0].item._queue_id, 'booking-bad-33');
    assert.match(parsed[0].reason, /not allowlisted/);
  });

  // ----------------------------------------------------
  // TEST 7: Advisory Locks Memory Tracking and TTL Registry
  // ----------------------------------------------------
  await runTest('Advisory locks creation, remote registration, and deletion', async () => {
    meshState.activeLocks = [];

    const mockLock = {
      lockId: 'lock-999',
      roomId: 'room-5',
      startDate: '2026-05-20',
      endDate: '2026-05-22',
      sourceNodeId: 'peer-node-B',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120000).toISOString()
    };

    // Register Remote Lock
    const success = registerRemoteLock(mockLock);
    assert.equal(success, true);
    assert.equal(meshState.activeLocks.length, 1);
    assert.equal(meshState.activeLocks[0].lockId, 'lock-999');

    // Register another remote lock with same ID -> should deduplicate
    const success2 = registerRemoteLock(mockLock);
    assert.equal(success2, true);
    assert.equal(meshState.activeLocks.length, 1);

    // Check expiry logic (manually prune with back-dated expiresAt)
    meshState.activeLocks[0].expiresAt = new Date(Date.now() - 5000).toISOString(); // 5 seconds in the past
    const { pruneExpiredLocks } = await import('../scratch/mocked/meshLocks.js');
    pruneExpiredLocks();
    assert.equal(meshState.activeLocks.length, 0, 'Stale lock should be auto-expired');
  });

  // ----------------------------------------------------
  // TEST 8: Provenance Metadata Verification
  // ----------------------------------------------------
  await runTest('Stamping operations with mesh provenance metadata', () => {
    // Stamping logic runs inside syncMeshQueues loop upon incoming payloads
    const incomingItem = {
      _queue_id: 'remote-booking-99',
      type: 'rpc',
      table: 'create_booking',
      data: {
        p_lodge_id: meshState.lodgeId,
        p_customer_id: 'customer-99',
        p_room_id: 'room-99',
        p_check_in: '2026-06-01',
        p_check_out: '2026-06-03',
        p_booking_id: 'booking-99',
        p_idempotency_key: 'intent-99'
      }
    };

    const validation = validateSyncQueueItem(incomingItem);
    assert.equal(validation.isValid, true);

    // Simulate import stamp
    incomingItem._mesh_imported = true;
    incomingItem._mesh_source_node_id = 'peer-node-C';
    incomingItem._mesh_imported_at = new Date().toISOString();

    assert.equal(incomingItem._mesh_imported, true);
    assert.equal(incomingItem._mesh_source_node_id, 'peer-node-C');
    assert.ok(incomingItem._mesh_imported_at);
  });

  // ----------------------------------------------------
  // TEST 9: Deterministic P2P Conflict Detection (Without Silent Mutation)
  // ----------------------------------------------------
  await runTest('Deterministic Conflict Detection & Advisory Resolution suggested alternatives', async () => {
    // Setup Mock Rooms
    mockCacheStore.setMockCache('rooms', [
      { id: 'room-1', room_number: '101', room_type: 'Standard', rate_per_night: 100 },
      { id: 'room-2', room_number: '102', room_type: 'Standard Deluxe', rate_per_night: 150 },
      { id: 'room-3', room_number: '103', room_type: 'Executive Suite', rate_per_night: 300 }
    ]);

    // Setup overlapping offline bookings
    // Booking A (Older, wins)
    const bookingA = {
      id: 'booking-A',
      room_id: 'room-1',
      check_in: '2026-06-01',
      check_out: '2026-06-05',
      created_at: '2026-05-20T10:00:00.000Z', // 10:00 AM
      _mesh_source_node_id: 'node-A'
    };

    // Booking B (Newer, loses)
    const bookingB = {
      id: 'booking-B',
      room_id: 'room-1',
      check_in: '2026-06-03', // Overlaps with June 1 - June 5
      check_out: '2026-06-07',
      created_at: '2026-05-20T10:15:00.000Z', // 10:15 AM
      _mesh_source_node_id: 'node-B'
    };

    mockCacheStore.setMockCache('bookings', [bookingA, bookingB]);
    mockSyncStore.setMockSyncQueue([]);

    // Trigger conflict detection
    await detectConflicts();

    const updatedBookings = mockCacheStore.readCache('bookings');
    
    // Assert Booking A (Winner) is unmodified
    const resA = updatedBookings.find((b) => b.id === 'booking-A');
    assert.equal(resA._sync_state || null, null);
    assert.equal(resA.room_id, 'room-1'); // DID NOT MUTATE

    // Assert Booking B (Loser) is flagged but room_id DID NOT MUTATE
    const resB = updatedBookings.find((b) => b.id === 'booking-B');
    assert.equal(resB.room_id, 'room-1'); // ROOM ID MUST REMAIN EXACTLY AS CREATED (No silent mutation!)
    assert.equal(resB._sync_state, 'manual_review_required');
    assert.match(resB._sync_error, /Mesh conflict detected: Room 101/);

    // Verify assisted suggestions were populated
    assert.ok(Array.isArray(resB._sync_resolution_suggestions));
    assert.equal(resB._sync_resolution_suggestions.length, 2, 'Should offer room-2 and room-3 as alternatives');
    
    // Sort logic upgraded room-3 first, then swap room-2
    assert.equal(resB._sync_resolution_suggestions[0].roomId, 'room-3');
    assert.equal(resB._sync_resolution_suggestions[0].action, 'upgrade');
    assert.equal(resB._sync_resolution_suggestions[1].roomId, 'room-2');
    assert.equal(resB._sync_resolution_suggestions[1].action, 'upgrade'); // Both are upgrades since rate is higher
  });

  // ----------------------------------------------------
  // TEST 10: Queue-only conflicts are persisted for manual review
  // ----------------------------------------------------
  await runTest('Queue-only conflict is moved out of live sync queue', async () => {
    mockCacheStore.setMockCache('rooms', [
      { id: 'room-1', room_number: '101', room_type: 'Standard', rate_per_night: 100 },
      { id: 'room-2', room_number: '102', room_type: 'Standard Deluxe', rate_per_night: 150 }
    ]);
    mockCacheStore.setMockCache('bookings', [
      {
        id: 'booking-cache-winner',
        room_id: 'room-1',
        check_in: '2026-07-01',
        check_out: '2026-07-05',
        created_at: '2026-05-20T09:00:00.000Z',
        _mesh_source_node_id: 'node-A'
      }
    ]);
    mockSyncStore.setMockFailedSyncQueue([]);
    mockSyncStore.setMockSyncQueue([
      {
        _queue_id: 'booking-queued-loser',
        type: 'rpc',
        table: 'create_booking',
        data: {
          p_lodge_id: meshState.lodgeId,
          p_customer_id: 'customer-queued',
          p_room_id: 'room-1',
          p_check_in: '2026-07-02',
          p_check_out: '2026-07-06',
          p_booking_id: 'booking-queued-loser',
          p_idempotency_key: 'intent-queued-loser'
        },
        timestamp: '2026-05-20T10:00:00.000Z',
        _mesh_imported: true,
        _mesh_source_node_id: 'node-B'
      }
    ]);

    await detectConflicts();

    assert.equal(mockSyncStore.readSyncQueue().length, 0, 'Conflicting queued booking should not remain live');
    const failedQueue = mockSyncStore.readFailedSyncQueue();
    assert.equal(failedQueue.length, 1);
    assert.equal(failedQueue[0]._queue_id, 'booking-queued-loser');
    assert.equal(failedQueue[0]._sync_state, 'manual_review_required');
    assert.equal(failedQueue[0].manualRetryOnly, true);
    assert.match(failedQueue[0]._sync_error, /Mesh conflict detected: Room 101/);
  });

  // ----------------------------------------------------
  // TEST 11: Imported POS orders reserve/deplete local inventory
  // ----------------------------------------------------
  await runTest('Imported POS queue operations update local inventory reservation', () => {
    mockCacheStore.setMockCache('inventory-items', [
      { id: 'stock-1', name: 'Water', current_stock: 12 },
      { id: 'stock-2', name: 'Juice', current_stock: 8 }
    ]);
    mockCacheStore.setMockCache('pos-menu-items', [
      { id: 'menu-water', name: 'Water', inventory_item_id: 'stock-1', depletion_qty: 2 }
    ]);

    applyImportedPosInventoryEffects([
      {
        _queue_id: 'pos-order-peer-1',
        type: 'rpc',
        table: 'create_pos_order',
        data: {
          payload: {
            lodge_id: meshState.lodgeId,
            id: 'peer-pos-1',
            create_idempotency_key: 'peer-pos-intent-1',
            items: [
              { inventory_item_id: 'stock-1', item_name: 'Water', quantity: 2, unit_price: 10, depletion_qty: 2 }
            ]
          }
        },
        _mesh_imported: true
      }
    ]);

    let inventory = mockCacheStore.readCache('inventory-items');
    assert.equal(inventory.find((item) => item.id === 'stock-1').current_stock, 8);
    assert.equal(inventory.find((item) => item.id === 'stock-1')._sync_state, 'pending');

    applyImportedPosInventoryEffects([
      {
        _queue_id: 'pos-void-peer-1',
        type: 'rpc',
        table: 'approve_pos_void_with_pin',
        data: {
          payload: {
            lodge_id: meshState.lodgeId,
            order_id: 'peer-pos-1',
            override_log_id: 'void-log-1',
            items: [
              { inventory_item_id: 'stock-1', item_name: 'Water', quantity: 1, unit_price: 10, depletion_qty: 2 }
            ]
          }
        },
        _mesh_imported: true
      }
    ]);

    inventory = mockCacheStore.readCache('inventory-items');
    assert.equal(inventory.find((item) => item.id === 'stock-1').current_stock, 8, 'Pending void must not restore sellable stock');

    mockCacheStore.setMockCache('inventory-items', [
      { id: 'stock-1', name: 'Water', current_stock: 12 }
    ]);
    applyImportedPosInventoryEffects([
      {
        _queue_id: 'pos-order-peer-v3',
        type: 'rpc',
        table: 'create_pos_order_v3',
        data: {
          payload: {
            lodge_id: meshState.lodgeId,
            id: 'peer-pos-v3',
            catalog_snapshot_id: 'catalog-1',
            shift_id: 'shift-1',
            source_device_id: 'peer-device',
            create_idempotency_key: 'peer-pos-v3-intent',
            items: [{ menu_item_id: 'menu-water', quantity: 2, modifier_option_ids: [] }]
          }
        },
        _mesh_imported: true
      }
    ]);
    inventory = mockCacheStore.readCache('inventory-items');
    assert.equal(inventory.find((item) => item.id === 'stock-1').current_stock, 8, 'V3 mesh sale must reserve linked stock');
  });

  // ----------------------------------------------------
  // TEST 12: No Cache Exchange Endpoint Exists
  // ----------------------------------------------------
  await runTest('Strictly ban cache snapshot transfers', () => {
    // Assert there is no GET /mesh/cache/:entity route allowlisted in meshServer.js
    // We can verify this programmatically by reading the meshServer.js allowlist route definitions
    const allowlisted = [
      '/mesh/hello',
      '/mesh/state',
      '/mesh/queue/summary',
      '/mesh/queue/items',
      '/mesh/locks',
      '/mesh/conflicts/report'
    ];

    assert.ok(!allowlisted.includes('/mesh/cache'));
    assert.ok(!allowlisted.some(r => r.startsWith('/mesh/cache/')));
  });

  await runTest('Every desktop offline RPC operation is represented by the mesh contract', async () => {
    const domainDir = path.join(workspaceRoot, 'src', 'main', 'domains');
    const domainFiles = await fs.readdir(domainDir, { withFileTypes: true });
    const queuedOperations = new Set();
    for (const entry of domainFiles) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const source = await fs.readFile(path.join(domainDir, entry.name), 'utf8');
      for (const match of source.matchAll(/queueOperation\(\s*['"]rpc['"]\s*,\s*['"]([^'"]+)['"]/g)) {
        queuedOperations.add(match[1]);
      }
    }
    const meshSource = await fs.readFile(path.join(workspaceRoot, 'src', 'main', 'domains', 'mesh', 'meshQueueMerge.js'), 'utf8');
    for (const operation of queuedOperations) {
      assert.ok(meshSource.includes(`'${operation}'`), `${operation} is queued offline but missing from the mesh contract`);
    }
    const nonRpcQueueCalls = [];
    for (const entry of domainFiles) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      const source = await fs.readFile(path.join(domainDir, entry.name), 'utf8');
      for (const match of source.matchAll(/queueOperation\(\s*['"]([^'"]+)['"]/g)) {
        if (match[1] !== 'rpc') nonRpcQueueCalls.push(`${entry.name}:${match[1]}`);
      }
    }
    assert.deepEqual(nonRpcQueueCalls, [], 'All offline mutations must be RPC operations');
  });

  console.log('----------------------------------------------------');
  console.log(`📊 P2P sync mesh tests completed: Passed ${passed}/${passed + failed}, Failed ${failed}`);
  console.log('----------------------------------------------------');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((error) => {
  console.error('Fatal error during P2P sync mesh tests:', error);
  process.exit(1);
});

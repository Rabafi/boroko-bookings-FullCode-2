// Browser harness: mounts the REAL HposOpenChecks and RestaurantWorkspace
// with mocked window.api / localStorage seeds driven by URL params.
// Served by run-browser-suite.mjs; never touches a real backend.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, MemoryRouter, Routes, Route } from 'react-router';
import { AuthContext, SettingsContext, AccessContext, FeaturesContext } from '../../src/renderer/src/app-context.jsx';
import Checks from '../../src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx';
import RestaurantWorkspace from '../../src/renderer/src/components/restaurant/RestaurantWorkspace.jsx';
import RestaurantAccountingActivation from '../../src/renderer/src/components/restaurant-accounting/RestaurantAccountingActivation.jsx';
import '../../src/renderer/src/styles/hospitality-pos.css';

const params = new URLSearchParams(location.search);
const suite = params.get('suite') || 'recovery';
const scenario = params.get('scenario') || '';

window.__calls = [];
window.__apiCalls = [];
const TENANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Audit Waiter', role: 'cashier', lodge_id: TENANT };
const OTHER = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', name: 'Other Waiter' };
const OUTLET = 'outlet-1';
const TAB = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tab_name: 'Audit Tab', table_name: null,
  tab_version: 4, waiter_id: STAFF.id, waiter_name: STAFF.name, outlet_id: OUTLET,
  shift_id: 'shift-1', total: 30, financial_complete: true, status: 'open',
  items: [
    { item_name: 'Audit Beer', unit_price: 20, quantity: 1, line_total: 20 },
    { item_name: 'Audit Snack', unit_price: 10, quantity: 1, line_total: 10 }
  ]
};

function seedEnvelope(kind, envelope) {
  const key = `hpos:pending-tab-op:${kind}:${TENANT}:${envelope.sourceTabId}`;
  localStorage.setItem(key, JSON.stringify(envelope));
}

function splitEnvelope(overrides = {}) {
  return {
    schemaVersion: 1,
    operationId: '11111111-1111-4111-8111-111111111111',
    kind: 'split', tenantId: TENANT, outletId: OUTLET, sourceTabId: TAB.id,
    actorId: STAFF.id, expectedVersion: 4,
    payload: { split_count: 3, source_tab_version: 4 },
    payloadFingerprint: JSON.stringify({ split_count: 3, source_tab_version: 4 }),
    request: { source_tab_id: TAB.id, split_count: 3, target_table_names: [], source_tab_version: 4 },
    createdAt: new Date().toISOString(), lastCheckedAt: null,
    outcome: 'unknown', authoritativeResult: null, lastCode: null,
    ...overrides
  };
}

function transferEnvelope(overrides = {}) {
  return {
    schemaVersion: 1,
    operationId: '22222222-2222-4222-8222-222222222222',
    kind: 'transfer', tenantId: TENANT, outletId: OUTLET, sourceTabId: TAB.id,
    actorId: STAFF.id, expectedVersion: 5,
    payload: { target_waiter_id: 'waiter-2', target_shift_id: 'shift-2', expected_tab_version: 5, notes: 'handover note' },
    payloadFingerprint: 'transfer-fp',
    request: { tab_id: TAB.id, target_waiter_id: 'waiter-2', target_shift_id: 'shift-2', expected_tab_version: 5, notes: 'handover note' },
    createdAt: new Date().toISOString(), lastCheckedAt: null,
    outcome: 'unknown', authoritativeResult: null, lastCode: null,
    ...overrides
  };
}

const TRANSFER_TAB = { ...TAB, tab_version: 5 };

if (suite === 'recovery') {
  const seed = params.get('seed') !== '0';
  if (seed && scenario === 'split-unknown-replay') seedEnvelope('split', splitEnvelope());
  if (seed && scenario === 'transfer-replay') {
    const tab = { ...TRANSFER_TAB };
    window.__transferTab = tab;
    seedEnvelope('transfer', transferEnvelope());
  }
  if (seed && scenario === 'inbox-gone-tab') seedEnvelope('split', splitEnvelope());
  if (seed && scenario === 'ownership-lost') seedEnvelope('split', splitEnvelope());
  if (seed && scenario === 'foreign-tenant') {
    seedEnvelope('split', splitEnvelope());
    localStorage.setItem(
      'hpos:pending-tab-op:split:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee:' + TAB.id,
      JSON.stringify({ ...splitEnvelope(), tenantId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', operationId: '33333333-3333-4333-8333-333333333333' })
    );
  }

  const script = params.get('script') || 'unknown';
  const scripted = (kind) => {
    if (script === 'commit') {
      return kind === 'split'
        ? { success: true, source_tab: { ...TAB, status: 'closed', tab_version: 5 }, new_tabs: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }] }
        : { success: true, tab: { ...TRANSFER_TAB, waiter_id: 'waiter-2', tab_version: 6 } };
    }
    if (script === 'reject-terminal') {
      return { success: false, code: 'tab_version_conflict', provenance: 'server-rpc-response', error: 'This tab changed on another terminal.' };
    }
    return { success: false, code: kind === 'split' ? 'unknown_split_error' : 'unknown_transfer_error', outcome: 'unknown', provenance: 'transport-error', error: 'socket hang up' };
  };

  const tabsFor = () => {
    if (scenario === 'inbox-gone-tab') return [];
    if (scenario === 'ownership-lost') return [{ ...TAB, waiter_id: OTHER.id, waiter_name: OTHER.name }];
    if (scenario === 'transfer-replay') return [{ ...TRANSFER_TAB, waiter_id: STAFF.id }];
    return [{ ...TAB, waiter_id: STAFF.id }];
  };

  window.api = {
    pos: {
      getTabs: async () => tabsFor(),
      getSharedTillOperatorSession: async () => ({ success: true, session: { staffId: STAFF.id } }),
      getBarActiveShifts: async () => [{ staff_user_id: 'waiter-2', staff_name: 'Waiter Two' }],
      getStaffOpenShift: async () => ({ id: 'shift-2', status: 'open', outlet_id: OUTLET }),
      splitBillEvenly: async (args) => { window.__calls.push({ op: 'split', ...args }); return scripted('split'); },
      transferTabWaiter: async (args) => { window.__calls.push({ op: 'transfer', ...args }); return scripted('transfer'); }
    }
  };

  const settings = { property_type: 'bar', hospitality_mode: 'bar_only', lodge_id: TENANT, currency: 'P' };
  const access = { capabilities: new Proxy({}, { get: () => true }), allowedOutletIds: null, role: 'cashier', entitlement: { product_id: 'hospitality-pos', lodge_id: TENANT } };
  createRoot(document.getElementById('root')).render(
    <AuthContext.Provider value={{ user: STAFF }}>
      <SettingsContext.Provider value={{ settings }}>
        <AccessContext.Provider value={access}>
          <MemoryRouter initialEntries={['/hpos/checks']}>
            <Routes><Route path="/hpos/checks" element={<Checks />} /></Routes>
          </MemoryRouter>
        </AccessContext.Provider>
      </SettingsContext.Provider>
    </AuthContext.Provider>
  );
}

if (suite === 'accounting') {
  // Stateful contract-faithful fixture: a server-side batch store with
  // actor separation, tenant scope, hash checks, and replay semantics.
  // Actors switch via ?actor=a|b (separate reviewer session simulation).
  const mode = params.get('script') || 'w-maker-checker';
  const actorKey = params.get('actor') || 'a';
  const ACTORS = {
    a: { id: 'user-aaaa', name: 'Preparer A' },
    b: { id: 'user-bbbb', name: 'Reviewer B' },
    c: { id: 'user-cccc', name: 'Concurrent preparer C' }
  };
  const me = ACTORS[actorKey] || ACTORS.a;
  const calls = [];
  window.__calls = calls;
  const store = {
    batches: {},
    seq: 0,
    readiness: { active: false, ready: false, status: 'draft', policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'unconfigured', missing_requirements: [], unposted_expenses: 0, blocking_exceptions: 0 },
    activation: { lodge_id: TENANT, status: 'draft', active: false, effective_from: null, policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'unconfigured', historical_cutover_batch_id: null },
    failNext: {},
    delayNext: {}
  };
  const failMode = params.get('fail') || '';
  if (failMode === 'read') store.failNext.getCutoverBatch = 'read failed: socket hang up';
  const seedBatch = (overrides = {}) => {
    store.seq += 1;
    const id = overrides.id || `batch-${store.seq}`;
    store.batches[id] = {
      id, lodge_id: TENANT, cutover_date: '2026-08-01', status: 'prepared',
      prepared_by: 'user-aaaa', approved_by: null,
      opening_balances: [{ account_id: 'a1', equity_account_id: 'e1', entry_date: '2026-08-01', amount: 1500 }],
      opening_payload_hash: 'hashabc123456', source_manifest_hash: 'srcmanifest1',
      source_counts: {}, control_totals: {}, evidence_manifest: {},
      opening_postings: [], review_notes: null, created_at: new Date().toISOString(),
      ...overrides
    };
    return store.batches[id];
  };
  if (mode === 'w-prepared' || mode === 'w-apply' || mode === 'w-activate-applied' || mode === 'w-stale') seedBatch({ id: 'batch-1' });
  if (mode === 'w-nohash') seedBatch({ id: 'batch-1', opening_payload_hash: null });
  if (mode === 'w-two') { seedBatch({ id: 'batch-1' }); seedBatch({ id: 'batch-2', cutover_date: '2026-08-02', opening_payload_hash: 'hashdef789012', source_manifest_hash: 'srcmanifest2' }); }
  if (mode === 'w-approved') seedBatch({ id: 'batch-1', status: 'approved', approved_by: 'user-aaaa', review_notes: 'Seeded review.' });
  if (mode === 'w-applied') seedBatch({ id: 'batch-1', status: 'applied', approved_by: 'user-aaaa', review_notes: 'Seeded review.', opening_postings: [{ account_id: 'a1', idempotency_key: 'cutover:batch-1:opening:a1' }] });
  if (mode === 'w-foreign') {
    store.batches['batch-x'] = {
      id: 'batch-x', lodge_id: 'foreign-lodge', cutover_date: '2026-08-01', status: 'prepared',
      prepared_by: 'user-aaaa', approved_by: null, opening_balances: [], opening_payload_hash: 'h',
      source_manifest_hash: 's', source_counts: {}, control_totals: {}, evidence_manifest: {},
      opening_postings: [], review_notes: null, created_at: new Date().toISOString()
    };
  }
  const maybeDelay = async (op) => {
    if (store.delayNext[op]) {
      const ms = store.delayNext[op];
      delete store.delayNext[op];
      await new Promise((resolve) => setTimeout(resolve, ms));
    }
  };
  // G1 drift controls: full (hash+source+preparer) or source-only
  // re-preparation between the reviewer's confirmation and the mutation.
  window.__driftBatch = (id, mode) => {
    const row = store.batches[id || 'batch-1'];
    if (!row) return null;
    if (mode !== 'source-only') row.opening_payload_hash = 'hashH2changed999';
    row.source_manifest_hash = 'srcH2changed999';
    row.prepared_by = 'user-cccc';
    row.status = 'prepared';
    return { ...row };
  };
  window.__batchRow = (id) => (store.batches[id || 'batch-1'] ? { ...store.batches[id || 'batch-1'] } : null);
  // H3 out-of-band approval: another authorized reviewer approves the
  // CURRENT stored revision directly (correct evidence, harness actor).
  window.__approveRow = (id) => {
    const row = store.batches[id || 'batch-1'];
    if (!row) return Promise.resolve({ success: false, error: 'no such batch' });
    return window.api.restaurantAccountingV2.invoke('approveCutover', {
      batchId: row.id,
      reviewNotes: 'Out-of-band approval of the current revision.',
      expectedOpeningPayloadHash: row.opening_payload_hash,
      expectedSourceManifestHash: row.source_manifest_hash ?? null,
      expectedPreparedBy: row.prepared_by ?? null
    });
  };
  if (params.get('slowFirst') === '1') store.delayNext.getCutoverBatch = 700;
  window.api = {
    restaurantAccountingV2: {
      invoke: async (op, args) => {
        calls.push({ op, args, actor: window.__actorId || me.id });
        await maybeDelay(op);
        if (store.failNext[op]) {
          const message = store.failNext[op];
          delete store.failNext[op];
          throw new Error(message);
        }
        if (op === 'getReadiness') {
          const override = JSON.parse(params.get('readiness') || 'null');
          return override || { active: false, ready: false, status: 'draft', policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'unconfigured', missing_requirements: [], unposted_expenses: 0, blocking_exceptions: 0 };
        }
        if (op === 'getAccounts') {
          return [{ id: 'a1', code: '1000', name: 'Cash', account_type: 'asset' }, { id: 'e1', code: '3000', name: 'Opening equity', account_type: 'equity' }];
        }
        if (op === 'getCutoverBatches') {
          return Object.values(store.batches)
            .filter((row) => row.lodge_id === TENANT)
            .map((row) => ({ id: row.id, lodge_id: row.lodge_id, cutover_date: row.cutover_date, status: row.status, prepared_by: row.prepared_by, approved_by: row.approved_by, opening_payload_hash: row.opening_payload_hash, source_manifest_hash: row.source_manifest_hash, source_counts: row.source_counts, evidence_manifest: row.evidence_manifest, created_at: row.created_at }));
        }
        if (op === 'getCutoverBatch') {
          const id = typeof args === 'string' ? args : args?.batchId;
          if (store.nullDetailOnce) {
            store.nullDetailOnce = false;
            return { success: true, data: null };
          }
          const row = store.batches[id];
          if (!row || row.lodge_id !== TENANT) return { success: true, data: null };
          return { success: true, data: { ...row } };
        }
        if (op === 'prepareCutover') {
          store.seq += 1;
          const id = `batch-${store.seq}`;
          store.batches[id] = {
            id, lodge_id: TENANT, cutover_date: args.cutoverDate, status: 'prepared',
            prepared_by: me.id, approved_by: null,
            opening_balances: args.openingBalances, opening_payload_hash: `hash-of-${id}`,
            source_manifest_hash: null, source_counts: {}, control_totals: { opening_payload_hash: `hash-of-${id}` },
            evidence_manifest: args.evidenceManifest || {}, opening_postings: [],
            review_notes: null, created_at: new Date().toISOString()
          };
          return { success: true, id, payload_hash: `hash-of-${id}`, status: 'prepared' };
        }
        if (op === 'approveCutover') {
          const row = store.batches[args?.batchId];
          if (!row || row.lodge_id !== TENANT) return { success: false, error: 'Cutover batch not found.' };
          // Race hooks: mutate between the reviewer's preflight read and the
          // mutation to prove the server backstop rejects unseen evidence.
          if (params.get('driftOnApprove') === '1' && !store.driftedOnApprove) {
            store.driftedOnApprove = true;
            window.__driftBatch(args?.batchId);
          }
          if (params.get('driftSourceOnly') === '1' && !store.driftedSourceOnly) {
            store.driftedSourceOnly = true;
            window.__driftBatch(args?.batchId, 'source-only');
          }
          if (row.status !== 'prepared') return { success: false, error: `Only a prepared batch can be approved; this batch is ${row.status}.` };
          if (row.prepared_by === me.id) return { success: false, code: 'self_approval', error: 'The cutover preparer cannot approve the same batch.' };
          if (!args?.reviewNotes || args.reviewNotes.trim().length < 8) return { success: false, error: 'Independent review notes are required.' };
          // Mirrors the revision-binding repair: the reviewed opening hash is
          // mandatory, and the reviewed source/preparer identities must be
          // present and match null-safely. A missing key is rejected even
          // when the value would compare equal.
          if (!args?.expectedOpeningPayloadHash || !String(args.expectedOpeningPayloadHash).trim()) {
            return { success: false, code: 'missing_evidence', error: 'Reviewed opening-balance evidence is required: approval must name the exact hash the reviewer confirmed.' };
          }
          if (!('expectedSourceManifestHash' in (args || {}))) {
            return { success: false, code: 'missing_evidence', error: 'Reviewed source evidence is required.' };
          }
          if (!('expectedPreparedBy' in (args || {}))) {
            return { success: false, code: 'missing_evidence', error: 'Reviewed preparation identity is required.' };
          }
          if (args.expectedOpeningPayloadHash !== row.opening_payload_hash) {
            return { success: false, code: 'hash_drift', error: 'Opening-balance payload hash does not match the prepared batch.' };
          }
          if ((args.expectedSourceManifestHash ?? null) !== (row.source_manifest_hash ?? null)) {
            return { success: false, code: 'source_drift', error: 'Source-manifest evidence does not match the reviewed batch; reload and review the current evidence.' };
          }
          if ((args.expectedPreparedBy ?? null) !== (row.prepared_by ?? null)) {
            return { success: false, code: 'preparer_drift', error: 'Preparation identity does not match the reviewed batch; reload and review the current evidence.' };
          }
          const approveBehavior = params.get('approveBehavior') || '';
          if (approveBehavior === 'malformed') return {};
          if (approveBehavior === 'timeout-once' && !store.approveThrown) {
            store.approveThrown = true;
            row.status = 'approved';
            row.approved_by = me.id;
            row.review_notes = args.reviewNotes.trim();
            throw new Error('socket hang up');
          }
          row.status = 'approved';
          row.approved_by = me.id;
          row.review_notes = args.reviewNotes.trim();
          if (approveBehavior === 'lying') {
            row.status = 'prepared';
            row.approved_by = null;
            return { success: true, data: { id: row.id, status: 'approved', reviewed_by: me.id } };
          }
          return { success: true, data: { id: row.id, status: 'approved', reviewed_by: me.id, source_manifest_hash: row.source_manifest_hash, opening_payload_hash: row.opening_payload_hash } };
        }
        if (op === 'applyCutover') {
          const id = typeof args === 'string' ? args : args?.batchId;
          const applyBehavior = params.get('applyBehavior') || '';
          if (applyBehavior === 'malformed') return {};
          if (applyBehavior === 'timeout-once' && !store.applyThrown) {
            store.applyThrown = true;
            const target = store.batches[id];
            if (target && target.lodge_id === TENANT && target.status === 'approved') {
              target.status = 'applied';
              target.opening_postings = target.opening_balances.map((line) => ({ account_id: line.account_id, idempotency_key: `cutover:${id}:opening:${line.account_id}` }));
            }
            throw new Error('socket hang up');
          }
          if (params.get('slowApply') === '1' && !store.applyDelayedOnce) {
            store.applyDelayedOnce = true;
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
          const target = store.batches[id];
          if (!target || target.lodge_id !== TENANT) return { success: false, error: 'Historical cutover batch not found.' };
          if (target.status === 'applied') {
            return { success: true, data: { id, status: 'applied', replayed: true, opening_postings: target.opening_postings } };
          }
          if (target.status !== 'approved') return { success: false, error: 'An independently approved cutover batch is required before applying opening balances.' };
          target.status = 'applied';
          target.opening_postings = target.opening_balances.map((line) => ({ account_id: line.account_id, idempotency_key: `cutover:${id}:opening:${line.account_id}` }));
          if (applyBehavior === 'null-detail') store.nullDetailOnce = true;
          if (applyBehavior === 'lying-success') {
            target.status = 'approved';
            target.opening_postings = [];
            return { success: true, data: { id, status: 'applied', replayed: false, opening_postings: [] } };
          }
          return { success: true, data: { id, status: 'applied', replayed: false, opening_postings: target.opening_postings } };
        }
        if (op === 'activateAccounting') {
          const behavior = params.get('activate') || 'success';
          if (behavior === 'reject') return { success: false, error: 'Accounting readiness gate is not satisfied: cash tender mapping.' };
          if (behavior === 'malformed') return {};
          const applied = {
            lodge_id: TENANT, status: 'active', active: true,
            effective_from: args.effectiveFrom, policy_version: args.policyVersion,
            configuration_version: args.configurationVersion,
            historical_cutover_batch_id: args.cutoverBatchId || null
          };
          if (behavior === 'timeout-once') {
            if (!store.activateThrown) {
              store.activateThrown = true;
              store.activation = applied;
              throw new Error('socket hang up');
            }
            return { success: true };
          }
          store.activation = applied;
          return { success: true };
        }
        if (op === 'getActivationState') {
          if (params.get('stateFail') === '1') throw new Error('state read failed');
          const override = JSON.parse(params.get('activationState') || 'null');
          return override || { ...store.activation };
        }
        if (op === 'suspendAccounting') return { success: true, status: 'suspended' };
        return { success: true };
      }
    },
    trial: { getStatus: async () => null }
  };
  const caps = {};
  const manage = params.get('manage') !== '0';
  if (manage) caps['accounting.manage'] = true;
  caps['accounting.read'] = true;
  const settings = { property_type: 'bar', hospitality_mode: 'bar_only', lodge_id: TENANT, currency: 'P' };
  const entry = `/restaurant/accounting-setup${params.get('batch') ? `?batch=${params.get('batch')}` : ''}`;
  // Production parity: App.jsx mounts under HashRouter, where the batch
  // query lives in the hash fragment. router=hash exercises that path;
  // the component resolves the batch from either location.
  const useHashRouter = params.get('router') === 'hash';
  // Session switcher for F3: re-renders the SAME mounted tree with a new
  // operator, exercising the production session-change path (context
  // update, same component instance, session effect invalidation).
  function AccountingHarnessApp() {
    const [key, setKey] = useState(actorKey);
    useEffect(() => {
      window.__switchActor = (next) => setKey(ACTORS[next] ? next : 'a');
    }, []);
    const current = ACTORS[key] || ACTORS.a;
    window.__actorId = current.id;
    const Router = useHashRouter ? HashRouter : MemoryRouter;
    const routerProps = useHashRouter ? {} : { initialEntries: [entry] };
    return (
      <AuthContext.Provider value={{ user: current }}>
        <SettingsContext.Provider value={{ settings }}>
          <AccessContext.Provider value={{ capabilities: caps, allowedOutletIds: null, role: manage ? 'manager' : 'cashier', entitlement: { product_id: 'hospitality-pos', lodge_id: TENANT } }}>
            <FeaturesContext.Provider value={{}}>
              <Router {...routerProps}>
                <Routes><Route path="/restaurant/accounting-setup" element={<RestaurantAccountingActivation />} /></Routes>
              </Router>
            </FeaturesContext.Provider>
          </AccessContext.Provider>
        </SettingsContext.Provider>
      </AuthContext.Provider>
    );
  }
  window.__actorId = me.id;
  createRoot(document.getElementById('root')).render(<AccountingHarnessApp />);
}

if (suite === 'finance') {
  const caps = {};
  for (const cap of String(params.get('caps') || '').split(',').filter(Boolean)) caps[cap] = true;
  const features = {};
  for (const feat of String(params.get('features') || '').split(',').filter(Boolean)) features[feat] = true;
  const failClosed = params.get('failClosed') === '1';

  window.api = new Proxy({}, {
    get: (target, ns) => new Proxy({}, {
      get: (inner, method) => {
        if (method === 'then') return undefined;
        return async (...args) => {
          window.__apiCalls.push(`${String(ns)}.${String(method)}`);
          return [];
        };
      }
    })
  });

  const settings = { property_type: 'bar', hospitality_mode: 'bar_only', lodge_id: TENANT, currency: 'P' };
  const access = failClosed
    ? {}
    : { capabilities: caps, allowedOutletIds: null, role: 'cashier', entitlement: { product_id: 'hospitality-pos', lodge_id: TENANT } };
  const entry = `/restaurant/finance-close?tab=${params.get('tab') || 'overview'}${params.get('outlet') ? `&outlet=${params.get('outlet')}` : ''}`;
  createRoot(document.getElementById('root')).render(
    <AuthContext.Provider value={{ user: STAFF }}>
      <SettingsContext.Provider value={{ settings }}>
        <AccessContext.Provider value={access}>
          <FeaturesContext.Provider value={features}>
            <MemoryRouter initialEntries={[entry]}>
              <Routes><Route path="/restaurant/finance-close" element={<RestaurantWorkspace workspace="finance" defaultTab="overview" />} /></Routes>
            </MemoryRouter>
          </FeaturesContext.Provider>
        </AccessContext.Provider>
      </SettingsContext.Provider>
    </AuthContext.Provider>
  );
}

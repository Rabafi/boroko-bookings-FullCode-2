import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clearDrawerAttemptKey,
  drawerAttemptFingerprint,
  getDrawerAttemptKey,
} from '../src/renderer/src/utils/drawerPeriodSubmission.js'

const posDomain = readFileSync('src/main/domains/pos.js', 'utf8')
const index = readFileSync('src/main/index.js', 'utf8')
const preload = readFileSync('src/preload/index.js', 'utf8')
const facade = readFileSync('src/main/database.js', 'utf8')
const syncQueue = readFileSync('src/shared/syncQueue.js', 'utf8')
const shiftClose = readFileSync('src/renderer/src/components/hospitality-pos/HposSharedShiftClose.jsx', 'utf8')
const drawerMovements = readFileSync('src/renderer/src/components/hospitality-pos/HposDrawerMovements.jsx', 'utf8')
const drawerClose = readFileSync('src/renderer/src/components/hospitality-pos/HposDrawerClose.jsx', 'utf8')
const cashClose = readFileSync('src/renderer/src/components/hospitality-pos/HposCashClose.jsx', 'utf8')
const myShift = readFileSync('src/renderer/src/components/hospitality-pos/HposMyShift.jsx', 'utf8')
const myCashup = readFileSync('src/renderer/src/components/hospitality-pos/HposMyCashup.jsx', 'utf8')
const multiOutlet = readFileSync('src/renderer/src/components/MultiOutletPos.jsx', 'utf8')
const drawerRounds = readFileSync('src/renderer/src/utils/drawerPeriodSubmission.js', 'utf8')

test('drawer domain functions exist with offline-first branches', () => {
  for (const fn of [
    'openDrawerPeriod', 'recordCashMovement', 'recordCashCount',
    'submitDrawerPeriodCashup', 'reviewDrawerPeriodCashup',
    'getDrawerPeriodState', 'setOutletCashModel',
  ]) {
    assert.match(posDomain, new RegExp(`export async function ${fn}\\(`), `${fn} exported`)
  }
  assert.match(posDomain, /queueOperation\('rpc', 'open_pos_drawer_period'/)
  assert.match(posDomain, /queueOperation\('rpc', 'record_pos_cash_movement'/)
  assert.match(posDomain, /queueOperation\('rpc', 'record_pos_cash_count'/)
  assert.match(posDomain, /queueOperation\('rpc', 'submit_pos_drawer_period_cashup'/)
  assert.match(posDomain, /queueOperation\('rpc', 'review_pos_drawer_period_cashup'/)
  assert.match(posDomain, /pos-drawer-periods/)
  assert.match(posDomain, /pos-cash-movements/)
  assert.match(posDomain, /pos-cash-counts/)
})

test('offline review mirrors the manager-PIN check and never closes local tills', () => {
  const start = posDomain.indexOf('export async function reviewDrawerPeriodCashup')
  const body = posDomain.slice(start, start + 4000)
  assert.match(body, /validateCachedPosPin\(state\.currentUser\?\.id, payload\.manager_pin, \{ manager: true \}\)/)
  assert.match(body, /review_pos_drawer_period_cashup/)
  assert.match(body, /review never closes local Till shifts/i)
})

test('offline clock-out mirrors the shared-drawer release', () => {
  assert.match(posDomain, /localTillModel/)
  assert.match(posDomain, /getOutletCashModel\(localOpenTill\.outlet_id\)/)
  assert.match(posDomain, /getOutletCashModel\(openShift\.outlet_id\)/)
})

test('outlet reads carry the cash model with a personal fallback', () => {
  assert.match(posDomain, /select\('id, name, type, sort_order, cash_model'\)/)
  assert.match(posDomain, /row\?\.cash_model === 'shared_drawer' \? 'shared_drawer' : 'personal_bank'/)
})

test('drawer replay uses the same RPC contract as online', () => {
  for (const table of [
    'open_pos_drawer_period', 'record_pos_cash_movement', 'record_pos_cash_count',
    'submit_pos_drawer_period_cashup', 'review_pos_drawer_period_cashup',
  ]) {
    assert.match(syncQueue, new RegExp(`'${table}'`), `${table} classified`)
  }
})

test('IPC, preload and facade expose the drawer workflow with matching gates', () => {
  assert.match(index, /pos:openDrawerPeriod/)
  assert.match(index, /pos:recordCashMovement/)
  assert.match(index, /pos:recordCashCount/)
  assert.match(index, /pos:submitDrawerPeriodCashup/)
  assert.match(index, /pos:reviewDrawerPeriodCashup/)
  assert.match(index, /pos:getDrawerPeriodState/)
  assert.match(index, /pos:setOutletCashModel/)
  for (const fn of [
    'openDrawerPeriod', 'recordCashMovement', 'recordCashCount',
    'submitDrawerPeriodCashup', 'reviewDrawerPeriodCashup',
    'getDrawerPeriodState', 'setOutletCashModel',
  ]) {
    assert.match(preload, new RegExp(`${fn}:`), `preload ${fn}`)
    assert.match(facade, new RegExp(`  ${fn},`), `facade ${fn}`)
  }
})

test('shared screen splits personal and drawer flows by outlet model', () => {
  assert.match(shiftClose, /outletCashModel/)
  assert.match(shiftClose, /HposDrawerMovements/)
  assert.match(shiftClose, /no personal cash-up is needed here/)
  assert.match(shiftClose, /outletCashModel !== 'shared_drawer' && !submitted/)
  assert.match(drawerMovements, /recordCashMovement/)
  assert.match(drawerMovements, /recordCashCount/)
  assert.match(drawerMovements, /openDrawerPeriod/)
  assert.match(drawerMovements, /operator Staff PIN/)
})

test('drawer close stays blind until manager review', () => {
  assert.match(drawerClose, /blind/)
  assert.match(drawerClose, /reviewDrawerPeriodCashup/)
  assert.match(drawerClose, /Manager PIN/)
  assert.match(drawerClose, /Enter a correction note before returning/)
  assert.match(cashClose, /HposDrawerClose/)
  assert.match(cashClose, /drawerOutlets/)
})

test('personal screens defer to the drawer in shared outlets', () => {
  assert.match(myShift, /activeOutlet\?\.cash_model !== 'shared_drawer'/)
  assert.match(myCashup, /sharedDrawer/)
  assert.match(myCashup, /counts one shared drawer, not personal shifts/)
})

test('outlet editor asks the physical cash question with plain consequences', () => {
  assert.match(multiOutlet, /cash_model/)
  assert.match(multiOutlet, /One shared drawer/)
  assert.match(multiOutlet, /Separate pouches/)
  assert.match(multiOutlet, /setOutletCashModel/)
  assert.match(multiOutlet, /zero open shifts, periods or reviews/)
})

test('drawer panel sends stable retry keys instead of per-tap timestamps', () => {
  // A per-tap Date.now() key turns an ambiguous-timeout retry into a second
  // recording of the same money. Identical retries must reuse one key.
  assert.match(drawerMovements, /getDrawerAttemptKey/)
  assert.match(drawerMovements, /clearDrawerAttemptKey/)
  assert.match(drawerMovements, /drawerAttemptFingerprint/)
  assert.match(drawerMovements, /resolveDrawerAttemptKey/)
  assert.doesNotMatch(drawerMovements, /Date\.now\(\)/)
  assert.match(drawerRounds, /export function getDrawerAttemptKey/)
  assert.match(drawerRounds, /export function clearDrawerAttemptKey/)
  assert.match(drawerRounds, /export function drawerAttemptFingerprint/)
})

const memoryStorage = () => {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
  }
}

test('drawer retry keys stay stable across identical retries and rotate on changed intent', () => {
  const storage = memoryStorage()
  const intent = { lodge_id: 'l1', outlet_id: 'o1', movement_type: 'drop_to_safe', amount: 100, operator_id: 's1', notes: null }
  const first = getDrawerAttemptKey({ scope: 'cash-movement:p1', keyPrefix: 'pos-cash-movement', fingerprint: drawerAttemptFingerprint(intent), storage })
  assert.equal(first.durable, true)
  assert.equal(first.reused, false)
  assert.ok(String(first.key).startsWith('pos-cash-movement:'))
  const retry = getDrawerAttemptKey({ scope: 'cash-movement:p1', keyPrefix: 'pos-cash-movement', fingerprint: drawerAttemptFingerprint({ ...intent }), storage })
  assert.equal(retry.reused, true)
  assert.equal(retry.key, first.key)
  const changed = getDrawerAttemptKey({ scope: 'cash-movement:p1', keyPrefix: 'pos-cash-movement', fingerprint: drawerAttemptFingerprint({ ...intent, amount: 200 }), storage })
  assert.equal(changed.reused, false)
  assert.notEqual(changed.key, first.key)
  // A corrected Staff PIN is the same money intent: the key must not rotate.
  const pinRetry = getDrawerAttemptKey({ scope: 'cash-movement:p1', keyPrefix: 'pos-cash-movement', fingerprint: drawerAttemptFingerprint({ ...intent, amount: 200, pin: '9999' }), storage })
  assert.equal(pinRetry.reused, true)
  assert.equal(pinRetry.key, changed.key)
  assert.equal(clearDrawerAttemptKey({ scope: 'cash-movement:p1', storage }), true)
  const fresh = getDrawerAttemptKey({ scope: 'cash-movement:p1', keyPrefix: 'pos-cash-movement', fingerprint: drawerAttemptFingerprint(intent), storage })
  assert.equal(fresh.reused, false)
  assert.notEqual(fresh.key, first.key)
})

test('drawer retry keys fail closed on corrupt storage', () => {
  const corrupt = { getItem: () => 'not-json{{{', setItem: () => {}, removeItem: () => {} }
  const result = getDrawerAttemptKey({ scope: 'cash-movement:p1', keyPrefix: 'pos-cash-movement', fingerprint: 'fingerprint', storage: corrupt })
  assert.equal(result.durable, false)
  assert.ok(result.error)
})

test('shared-outlet sales need an open drawer period', () => {
  // A sale with no open period belongs to no review window (expectations are
  // computed per period from opened_at). Fail closed before any journal
  // residue, shared outlets only; a submitted period is frozen for review so
  // only open (or rejected, back for correction) admits sales.
  assert.match(posDomain, /findSaleDrawerPeriod/)
  assert.match(posDomain, /DRAWER_SALE_GATE_TTL_MS/)
  assert.match(posDomain, /Open the drawer in Staff shift close before selling/)
  assert.match(posDomain, /awaiting manager review\. Review it in Cash & close before selling on/)
  assert.match(posDomain, /\['open', 'rejected'\]/)
  assert.match(posDomain, /getOutletCashModel\(saleOutletId\) === 'shared_drawer'/)
  const guardAt = posDomain.indexOf('Shared drawers reconcile every sale inside one open period')
  assert.ok(guardAt >= 0)
  assert.ok(guardAt < posDomain.indexOf('resolvePosSubmitAttempt({'))
})

test('drawer writes time out with retry-safe guidance instead of hanging', () => {
  // The "Recording…" forever hang: drawer RPCs awaited with no timeout, so a
  // stalled connection never settled. Every drawer write now races the
  // standard timeout and translates it into an explicitly ambiguous message;
  // retrying reuses the stable per-attempt key, so it replays instead of
  // recording twice. Offline legs queue instantly and never hang.
  assert.match(posDomain, /drawerWriteTimeout/)
  for (const label of ['Drawer open', 'Cash movement', 'Handover count', 'Drawer cash-up submit', 'Drawer cash-up review']) {
    assert.match(posDomain, new RegExp(`drawerWriteTimeout\\('${label}'\\)`), `${label} guarded`)
  }
  assert.match(posDomain, /may already be recorded\. Refresh the drawer list/)
  assert.match(posDomain, /same retry key replays instead of recording twice/)
  assert.match(posDomain, /withNetworkTimeout\(state\.supabase\.rpc\('get_pos_drawer_period_state'/)
})

test('drawer buttons explain instead of silently ignoring taps', () => {
  assert.match(drawerMovements, /The drawer is still loading\. Wait a moment and try again\./)
  assert.match(drawerMovements, /disabled=\{saving \|\| loading\}/)
})

test('cash-up review works offline from the device queue with provisional labelling', () => {
  // The domain already queues offline reviews (manager-PIN checked) and the
  // server replays the authoritative review at sync. The refusal was the
  // review screen treating any offline read as fatal, plus the approve gate
  // demanding server totals a blind device cannot have.
  assert.match(cashClose, /provisionalReview/)
  assert.match(cashClose, /result\.submissions\.length === 0/)
  assert.match(cashClose, /saved on this device and queued/)
  assert.match(cashClose, /Approving accepts the counted cash/)
  assert.match(cashClose, /!provisionalReview/)
  assert.match(posDomain, /queueOperation\('rpc', 'review_pos_cashup_submission_offline'/)
})

test('cash counting switch is reachable from cash and close without the multi-outlet add-on', () => {
  // The outlet editor answers the same question, but it is feature-gated and
  // hides single outlets — unreachable for the single-outlet base bars that
  // need it most. Cash & close is base and manager-gated, so it asks it here.
  assert.match(cashClose, /setOutletCashModel/)
  assert.match(cashClose, /How this outlet counts cash/)
  assert.match(cashClose, /One shared drawer/)
  assert.match(cashClose, /Separate pouches/)
  assert.match(cashClose, /zero open Till shifts/)
  assert.match(cashClose, /canSwitchCashModel/)
  assert.match(cashClose, /Only an admin can switch it/)
  assert.ok((cashClose.match(/await loadOutletCashModels\(\)/g) || []).length >= 2, 'a refused switch resyncs the dropdown to server truth')
})

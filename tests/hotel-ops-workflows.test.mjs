/**
 * Phase 2 Hotel ops workflows contract:
 * - check-in / room moves / HK / maintenance use RPCs (not client payment writes)
 * - UI does not swallow critical load errors into empty success
 * - room moves require audit reason
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

const checkinDomain = read('src/main/domains/checkinWorkflow.js')
const roomMovesDomain = read('src/main/domains/roomMoves.js')
const hkDomain = read('src/main/domains/housekeepingCommandCenter.js')
const maintDomain = read('src/main/domains/maintenance.js')
const maintEntDomain = read('src/main/domains/maintenanceEnterprise.js')

const checkinUi = read('src/renderer/src/components/CheckinWorkflow.jsx')
const roomMovesUi = read('src/renderer/src/components/RoomMoves.jsx')
const hkUi = read('src/renderer/src/components/Housekeeping.jsx')
const advHkUi = read('src/renderer/src/components/AdvancedHousekeeping.jsx')
const maintUi = read('src/renderer/src/components/Maintenance.jsx')
const preload = read('src/preload/index.js')
const mainIndex = read('src/main/index.js')

// ── Domain: RPC-first, no direct payment writes ────────────────────────────

test('checkin domain uses authoritative hotel check-in/out RPCs only', () => {
  for (const rpc of [
    'get_checkin_checklist',
    'complete_checkin_step',
    'complete_hotel_checkin',
    'get_checkout_checklist',
    'complete_hotel_checkout'
  ]) {
    assert.ok(checkinDomain.includes(`rpc('${rpc}'`) || checkinDomain.includes(`rpc("${rpc}"`), `must call ${rpc}`)
  }
  assert.equal(checkinDomain.includes("from('bookings').update"), false, 'must not direct-update bookings')
  assert.equal(checkinDomain.includes('amount_paid'), true, 'may read amount_paid for display estimates')
  assert.equal(
    /payment_status\s*[:=]/.test(checkinDomain),
    false,
    'must not author payment_status'
  )
  assert.equal(checkinDomain.includes(".from('payments')"), false)
  assert.equal(checkinDomain.includes(".from('booking_payments')"), false)
})

test('checkin domain surfaces pre-arrival readiness and manager override via existing step RPC', () => {
  assert.ok(checkinDomain.includes('pre_arrival') || checkinDomain.includes('room_ready'))
  assert.ok(checkinDomain.includes('balance_source'))
  assert.ok(checkinDomain.includes('booking_ledger_estimate'))
  assert.ok(checkinDomain.includes('completeHotelCheckinWithOverride'))
  assert.ok(checkinDomain.includes('manager_override'))
  assert.ok(checkinDomain.includes('override_reason'))
  // Override still completes steps then calls complete_hotel_checkin — no invented bypass RPC
  assert.ok(checkinDomain.includes('complete_hotel_checkin'))
  assert.ok(checkinDomain.includes('complete_checkin_step'))
})

test('checkin domain does not convert live checklist failure into empty success without cache', () => {
  assert.ok(checkinDomain.includes('throw new Error') || checkinDomain.includes('throw e'))
  assert.ok(checkinDomain.includes('from_cache') || checkinDomain.includes('stale'))
  // Empty success on no-lodge is ok; live failure without cache must throw
  assert.ok(
    checkinDomain.includes('Could not load check-in checklist') ||
      checkinDomain.includes('Could not load check-out checklist')
  )
})

test('room moves domain requires audit reason and uses move_booking_room RPC', () => {
  assert.ok(roomMovesDomain.includes("rpc('move_booking_room'") || roomMovesDomain.includes('move_booking_room'))
  assert.ok(roomMovesDomain.includes('Room move requires an audit reason'))
  assert.ok(roomMovesDomain.includes('requireMoveReason') || roomMovesDomain.includes('auditReason'))
  assert.ok(roomMovesDomain.includes('p_reason'))
  assert.ok(roomMovesDomain.includes('p_idempotency_key'))
  assert.equal(roomMovesDomain.includes('amount_paid'), false)
  assert.equal(/payment_status\s*[:=]/.test(roomMovesDomain), false)
  assert.equal(roomMovesDomain.includes(".from('bookings').update"), false)
  assert.ok(roomMovesDomain.includes('rate_impact') || roomMovesDomain.includes('navigate_folio'))
  assert.ok(roomMovesDomain.includes('booking conflict'))
})

test('housekeeping command center domain uses dashboard/assignment/inspection RPCs', () => {
  for (const rpc of [
    'get_housekeeping_dashboard',
    'create_housekeeping_assignment',
    'update_housekeeping_assignment_status',
    'create_housekeeping_inspection',
    'start_turnaround',
    'complete_turnaround'
  ]) {
    assert.ok(hkDomain.includes(rpc), `HK domain must use ${rpc}`)
  }
  assert.equal(/payment_status\s*[:=]/.test(hkDomain), false)
  assert.equal(hkDomain.includes(".from('payments')"), false)
})

test('maintenance domains use ticket and OOO RPCs, not payment writes', () => {
  assert.ok(maintDomain.includes("rpc('create_maintenance_ticket'") || maintDomain.includes('create_maintenance_ticket'))
  assert.ok(maintDomain.includes('update_maintenance_ticket'))
  assert.ok(maintDomain.includes('resolve_maintenance_ticket'))
  for (const rpc of [
    'set_room_out_of_order',
    'set_room_out_of_service',
    'return_room_to_service',
    'get_maintenance_dashboard'
  ]) {
    assert.ok(maintEntDomain.includes(rpc), `enterprise maintenance must use ${rpc}`)
  }
  assert.equal(/payment_status\s*[:=]/.test(maintDomain + maintEntDomain), false)
  assert.equal(maintDomain.includes(".from('payments')"), false)
})

// ── Preload / IPC for override ─────────────────────────────────────────────

test('manager override check-in is bridged through IPC and preload', () => {
  assert.ok(mainIndex.includes("checkinWorkflow:completeHotelCheckinWithOverride"))
  assert.ok(preload.includes('completeHotelCheckinWithOverride'))
})

// ── UI contracts ───────────────────────────────────────────────────────────

test('CheckinWorkflow does not swallow board/checklist failures into empty success', () => {
  // Critical: departures must not use .catch(() => [])
  assert.equal(
    checkinUi.includes(".catch(() => [])"),
    false,
    'must not blank departures/in-house errors into empty arrays'
  )
  assert.ok(checkinUi.includes('Partial board load') || checkinUi.includes('boardWarnings'))
  assert.ok(checkinUi.includes('Checklist failed to load') || checkinUi.includes('checklist failed'))
  assert.ok(checkinUi.includes('setChecklist(null)'))
  assert.ok(checkinUi.includes('Pre-arrival') || checkinUi.includes('pre_arrival') || checkinUi.includes('preArrival'))
  assert.ok(checkinUi.includes('Manager override') || checkinUi.includes('manager override'))
  assert.ok(checkinUi.includes('overrideReason') || checkinUi.includes('override reason'))
  assert.ok(checkinUi.includes('booking_ledger_estimate') || checkinUi.includes('balance_source') || checkinUi.includes('Balance estimate'))
})

test('RoomMoves UI requires reason and offers folio navigation on rate impact', () => {
  assert.ok(roomMovesUi.includes('Room move requires an audit reason') || roomMovesUi.includes('requires an audit reason'))
  assert.ok(roomMovesUi.includes('required') || roomMovesUi.includes('(required)'))
  assert.ok(
    roomMovesUi.includes("!String(reason") ||
      roomMovesUi.includes("reason || '').trim()") ||
      roomMovesUi.includes('auditReason')
  )
  assert.ok(roomMovesUi.includes('/folios') || roomMovesUi.includes('Open folio') || roomMovesUi.includes('navigate_folio'))
  assert.ok(roomMovesUi.includes('rate_impact') || roomMovesUi.includes('rateImpact') || roomMovesUi.includes('Rate impact'))
  assert.equal(roomMovesUi.includes(".catch(() => [])"), false)
})

test('Housekeeping UI exposes dirty/clean/inspected, refuse service, maintenance escalate', () => {
  assert.ok(hkUi.includes("inspected") || advHkUi.includes('inspected'))
  assert.ok(hkUi.includes('Escalate to maintenance') || hkUi.includes('/maintenance'))
  assert.ok(hkUi.includes('Refuse service') || hkUi.includes('REFUSE_SERVICE') || hkUi.includes('skipped'))
  // Board load must not silently empty on rooms failure
  assert.ok(
    hkUi.includes('Partial load') ||
      hkUi.includes('Could not load rooms') ||
      !hkUi.includes("rooms.getAll().catch(() => [])")
  )
  assert.equal(hkUi.includes("window.api.rooms.getAll().catch(() => [])"), false)
})

test('AdvancedHousekeeping does not swallow room load failures', () => {
  assert.equal(advHkUi.includes(".catch(() => [])"), false)
  assert.ok(advHkUi.includes('Partial load') || advHkUi.includes('setError'))
  assert.ok(advHkUi.includes('inspected'))
  assert.ok(advHkUi.includes('/maintenance') || advHkUi.includes('Maintenance'))
})

test('Maintenance UI surfaces ticket and OOO errors instead of console-only swallow', () => {
  assert.equal(maintUi.includes('.catch(console.error)'), false, 'must not console-only swallow mutations')
  assert.ok(maintUi.includes('Failed to update ticket') || maintUi.includes('setError'))
  assert.ok(maintUi.includes('Failed to resolve ticket') || maintUi.includes('resolve'))
  assert.ok(maintUi.includes('return_room_to_service') || maintUi.includes('Return to Service'))
  assert.ok(maintUi.includes('set_room_out_of_order') || maintUi.includes('Set Out of Order'))
  assert.ok(maintUi.includes('OOO requires a reason') || maintUi.includes('Reason (required)'))
})

// ── Behavioral unit: requireMoveReason logic via source contract ───────────

test('executeRoomMove path always validates reason before RPC/queue', () => {
  // The reason guard must appear before rpc call in source order
  const reasonIdx = roomMovesDomain.indexOf('Room move requires an audit reason')
  const rpcIdx = roomMovesDomain.indexOf("rpc('move_booking_room'")
  assert.ok(reasonIdx >= 0)
  assert.ok(rpcIdx >= 0)
  assert.ok(reasonIdx < rpcIdx, 'reason must be required before move_booking_room RPC')
})

test('checkin ready flags require explicit true (not !== false empty success)', () => {
  // Avoid treating missing ready_to_check_in as ready
  assert.ok(
    checkinUi.includes('ready_to_check_in === true') ||
      checkinUi.includes("checklist?.ready_to_check_in === true")
  )
  assert.ok(
    checkinUi.includes('ready_to_check_out === true') ||
      checkinUi.includes("checklist?.ready_to_check_out === true")
  )
})

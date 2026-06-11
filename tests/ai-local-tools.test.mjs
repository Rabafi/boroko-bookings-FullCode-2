import assert from 'node:assert/strict'
import { createLocalReadToolRunner } from '../src/main/ai/aiOrchestrator.js'

let pass = 0
let fail = 0

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => {
      pass++
      console.log(`  PASS: ${name}`)
    })
    .catch((error) => {
      fail++
      console.log(`  FAIL: ${name} - ${error.message}`)
    })
}

console.log('\n=== Local AI Tool Tests ===\n')

function makeRunner(overrides = {}) {
  const db = {
    getTodayBookingPaymentMix: async (dateKey) => {
      const map = {
        '2026-05-19': { total_collected: 0, payment_count: 0 },
        '2026-05-20': { total_collected: 1200, payment_count: 2 },
        '2026-05-21': { total_collected: 1800, payment_count: 3 }
      }
      return dateKey ? (map[dateKey] || { total_collected: 0, payment_count: 0 }) : { total_collected: 1800, payment_count: 3 }
    },
    getAllRooms: async () => ([
      { id: 'r1', room_number: '1', room_type: 'Single', default_rate: 450, housekeeping_status: 'dirty' },
      { id: 'r2', room_number: '2', room_type: 'Double', default_rate: 650 }
    ]),
    getAllBookings: async () => ([
      { id: 'b1', room_id: 'r1', room_number: '1', customer_name: 'Amina', status: 'confirmed', check_in: '2026-05-21', check_out: '2026-05-23', total_amount: 900, charges_total: 0, amount_paid: 300 },
      { id: 'b2', room_id: 'r2', room_number: '2', customer_name: 'Neo', customer_id: 'c2', status: 'checked_in', check_in: '2026-05-19', check_out: '2026-05-20', total_amount: 650, charges_total: 50, amount_paid: 0 },
      { id: 'b3', room_id: 'r2', room_number: '2', customer_name: 'Lebo', customer_id: 'c2', status: 'cancelled', check_in: '2026-05-21', check_out: '2026-05-22', total_amount: 650, charges_total: 0, amount_paid: 0 }
    ]),
    getAllCustomers: async () => ([
      { id: 'c1', name: 'Amina Dube', phone: '71234567', email: 'amina@example.com' },
      { id: 'c2', name: 'Neo K', phone: '70000000', email: 'neo@example.com', blacklisted: true }
    ]),
    getForecast: async (days) => Array.from({ length: days }, (_, index) => ({ date: `2026-05-${String(21 + index).padStart(2, '0')}`, rate: index === 2 ? 90 : 55 + index, occupied: 5 + index, total: 10 })),
    getLowStockItems: async () => ([{ id: 's1', item_name: 'Laundry soap', current_stock: 1, reorder_level: 4, unit: 'bottles' }]),
    getPendingOnlineBookings: async () => ([{ id: 'o1', customer_name: 'Sara', room_number: '3', check_in: '2026-05-22', check_out: '2026-05-24', created_at: '2026-05-21T08:00:00Z' }]),
    getBackupInfo: async () => ({ backupDir: 'C:/backup', backups: [{ name: 'boroko-2026-05-18.zip', createdAt: '2026-05-18T08:00:00Z' }] }),
    getTodayActivity: async () => ({
      checkins_today: [{ id: 'a1', customer_name: 'Tumi', room_number: '4' }],
      checkouts_today: [{ id: 'd1', customer_name: 'Pako', room_number: '5' }],
      checkins_tomorrow: [{ id: 't1', customer_name: 'Masego', room_number: '6' }]
    }),
    getAllMaintenanceTickets: async () => ([{ id: 'm1', title: 'Leaking tap', room_number: '1', priority: 'high', status: 'open' }]),
    getSyncDetails: async () => ({
      pending: [{ id: 'q1', isFinancial: true, data: { amount: 500 } }],
      failed: [{ id: 'q2', isFinancial: true, data: { payload: { amount: 900 } }, error: 'Offline' }],
      faults: [{ id: 'f1', message: 'Offline' }]
    }),
    ...overrides
  }
  return createLocalReadToolRunner({ db })
}

test('room availability ignores cancelled bookings', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_room_availability', { room_number: '2', days: 1 })
  assert.equal(result.rooms[0].available, true)
})

test('room rate lookup returns matching room rate', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_room_rate', { room_number: '2' })
  assert.equal(result.count, 1)
  assert.equal(result.rooms[0].default_rate, 650)
})

test('guest search requires at least two characters', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('search_guest', { guest_query: 'n' })
  assert.equal(result.needs_query, true)
})

test('lookup booking prefers active stay at the top', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('lookup_booking', { room_number: '1' })
  assert.equal(result.bookings[0].is_active_stay, true)
  assert.equal(result.bookings[0].guest, 'Amina')
})

test('occupancy forecast returns peak day and average rate', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_occupancy_forecast', { days: 5 })
  assert.equal(result.peak_day.rate, 90)
  assert.ok(result.average_rate > 0)
  assert.ok(result.comparison.first_vs_last)
})

test('unpaid summary includes yesterday comparison', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_unpaid_summary')
  assert.ok(result.comparison.outstanding)
  assert.equal(result.comparison.label, 'yesterday')
})

test('daily briefing includes actual comparison object', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_daily_briefing')
  assert.ok(result.comparison.revenue)
  assert.ok(result.comparison.occupancy)
  assert.equal(result.comparison.label, 'yesterday')
})

test('backup status reports stale backup correctly', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_backup_status')
  assert.equal(result.status, 'stale')
})

test('handover report includes guest and room detail', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_handover_report')
  assert.equal(result.arrivals_today[0].guest, 'Tumi')
  assert.equal(result.dirty_rooms[0].room_number, '1')
})

test('sync impact sums financial risk', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_sync_impact')
  assert.equal(result.financial_amount_at_risk, 1400)
})

test('maintenance satisfaction risk finds occupied room issues', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_maintenance_satisfaction_risk')
  assert.equal(result.count, 1)
  assert.equal(result.items[0].guest, 'Amina')
})

test('operational cleanliness audit flags missed departures', async () => {
  const runner = makeRunner()
  const result = await runner.runTool('get_operational_cleanliness_audit')
  assert.ok(result.total_flags >= 1)
  assert.equal(result.missed_check_outs[0].guest, 'Neo')
})

setTimeout(() => {
  console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`)
  if (fail > 0) process.exit(1)
}, 100)

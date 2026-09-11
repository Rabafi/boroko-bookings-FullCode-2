/**
 * AI Smarts Runtime Tests — offline improvements with no outside LLM.
 *
 * Covers:
 *   - Number-word room hints ("room five" -> "5")
 *   - chrono-backed day windows ("last 7 days", "in 5 days", "fortnight")
 *   - Hour-parameterized shift suggestions
 *   - Fuse did-you-mean topics
 *   - Recommendation routes (recommend-only contract)
 *   - execute() always rejects with guidance
 *   - Deterministic briefing narrative
 *
 * Run: node tests/ai-smarts.test.mjs
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import {
  extractRoomHint,
  resolveNumberWords,
  extractDayWindow,
  getTimeAwareSuggestions,
  findClosestTopics,
  resolveLocalAssistantTurn,
  createLocalAssistantSession
} from '../src/main/ai/localAssistant.js'
import {
  buildRecommendation,
  createAiOrchestrator,
  createLocalReadToolRunner
} from '../src/main/ai/aiOrchestrator.js'

let pass = 0
let fail = 0

async function test(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  PASS: ${name}`)
  } catch (e) {
    fail++
    console.log(`  FAIL: ${name} - ${e.message}`)
  }
}

console.log('\n=== AI Smarts Runtime Tests ===\n')

// ─── Number-word rooms ────────────────────────────────────────────────────

await test('room digits still resolve', () => {
  assert.equal(extractRoomHint('who is in room 12?'), '12')
})

await test('room number words resolve', () => {
  assert.equal(extractRoomHint('balance for room five'), '5')
})

await test('compound number words resolve', () => {
  assert.equal(extractRoomHint('rate for room twenty one'), '21')
  assert.equal(resolveNumberWords('thirty'), 30)
  assert.equal(resolveNumberWords('seven'), 7)
})

await test('non-room words do not resolve', () => {
  assert.equal(extractRoomHint('open room board'), null)
  assert.equal(resolveNumberWords('board'), null)
  assert.equal(resolveNumberWords(''), null)
})

// ─── Day windows ──────────────────────────────────────────────────────────

await test('explicit day counts resolve', () => {
  assert.equal(extractDayWindow('compare revenue last 7 days'), 7)
  assert.equal(extractDayWindow('revenue in 5 days'), 5)
})

await test('fortnight resolves to 14', () => {
  assert.equal(extractDayWindow('occupancy for the fortnight'), 14)
})

await test('room digits never corrupt the window', () => {
  assert.equal(extractDayWindow('balance for room 5'), null)
})

await test('dateless queries return null', () => {
  assert.equal(extractDayWindow('show revenue'), null)
})

await test('relative weekday resolves inside the tool range', () => {
  const days = extractDayWindow('revenue next friday')
  assert.ok(days === null || (days >= 1 && days <= 7), `expected 1..7 or null, got ${days}`)
})

// ─── Shift suggestions ────────────────────────────────────────────────────

await test('morning suggests the briefing', () => {
  const s = getTimeAwareSuggestions(8)
  assert.equal(s.period, 'morning')
  assert.equal(s.boost, 'get_daily_briefing')
})

await test('midday suggests triage', () => {
  assert.equal(getTimeAwareSuggestions(13).boost, 'get_attention')
})

await test('afternoon suggests overdue checkouts', () => {
  assert.equal(getTimeAwareSuggestions(16).boost, 'get_overdue_checkouts')
})

await test('evening suggests handover', () => {
  assert.equal(getTimeAwareSuggestions(20).boost, 'get_handover_report')
})

await test('night suggests backups', () => {
  assert.equal(getTimeAwareSuggestions(2).boost, 'get_backup_status')
  assert.equal(getTimeAwareSuggestions(23).boost, 'get_backup_status')
})

// ─── Did-you-mean ─────────────────────────────────────────────────────────

await test('typo finds the check-out workflow', () => {
  const hits = findClosestTopics('chekcout gest', 3)
  assert.ok(hits.length > 0, 'expected at least one hit')
  assert.equal(hits[0].id, 'check-out')
  assert.ok(hits[0].route, 'hit should carry its route')
})

await test('empty query returns no topics', () => {
  assert.deepEqual(findClosestTopics('   '), [])
})

// ─── Recommendations (recommend-only contract) ────────────────────────────

await test('payment recommendation deep-links the payment form', () => {
  const rec = buildRecommendation('record_payment', { booking_id: 'b1' })
  assert.equal(rec.route, '/bookings')
  assert.equal(rec.state.collectPaymentBookingId, 'b1')
  assert.match(rec.label, /record the payment/i)
})

await test('bulk collection recommends Invoices', () => {
  const rec = buildRecommendation('bulk_record_payment', { booking_ids: ['a', 'b'] })
  assert.equal(rec.route, '/invoices')
})

await test('unknown tools fall back to the Assistant', () => {
  const rec = buildRecommendation('nope_not_a_tool', null)
  assert.equal(rec.route, '/ai')
  assert.deepEqual(rec.state, {})
})

await test('execute() always rejects with guidance', async () => {
  const ai = createAiOrchestrator({ appUserDataPath: os.tmpdir(), db: {}, requireCapability: async () => {} })
  await assert.rejects(() => ai.execute({ proposalId: 'anything' }), /recommend/i)
})

// ─── Briefing narrative ───────────────────────────────────────────────────

await test('briefing carries a deterministic story', async () => {
  const db = {
    getDashboardStats: async () => ({ occupancy: 60, total_rooms: 10, revenue: 100 }),
    getTodayBookingPaymentMix: async () => ({ total_collected: 500, payment_count: 2 }),
    getAllMaintenanceTickets: async () => [],
    getAllBookings: async () => [],
    getSyncStatus: async () => ({ pending: 0, failed: 0, isOnline: true, financialPendingCount: 0, financialFailedCount: 0 })
  }
  const runner = createLocalReadToolRunner({ db, now: () => new Date('2026-05-21T12:00:00Z') })
  const result = await runner.runTool('get_daily_briefing', {})
  assert.equal(typeof result.story, 'string')
  assert.ok(result.story.length > 20, 'story should be a real narrative')
  assert.match(result.story, /occupancy/i)
  assert.match(result.story, /P500\.00/)
  assert.equal(result.comparison.label, 'yesterday')
})

// ─── Intent accuracy (misroute regressions) ─────────────────────────────────
// Each of these answered something different before the matcher hardening:
// guarded synonyms, light-text identity gates, content-token sequences,
// bare check-in/out rule, and session raw-first.

await test('order-stock questions route to inventory, not POS', () => {
  for (const q of ['how do I order stock', 'purchase order']) {
    const r = resolveLocalAssistantTurn({ message: q })
    assert.equal(r?.localHelp?.bestMatch?.id, 'inventory-stock', q)
  }
})

await test('void/cancel-sale questions route to pos-void', () => {
  for (const q of ['void a sale', 'void order', 'cancel a sale']) {
    const r = resolveLocalAssistantTurn({ message: q })
    assert.equal(r?.localHelp?.bestMatch?.id, 'pos-void', q)
  }
})

await test('refund questions reach refund guidance', () => {
  for (const q of ['refund a payment', 'refund', 'reverse a payment', 'cancel payment']) {
    const r = resolveLocalAssistantTurn({ message: q })
    assert.equal(r?.localHelp?.mode, 'faq', q)
    assert.equal(r?.localHelp?.bestMatch?.id, 'refund-guidance', q)
  }
})

await test('refusal-to-pay reaches the playbook', () => {
  const r = resolveLocalAssistantTurn({ message: 'guest wont pay' })
  assert.equal(r?.localHelp?.mode, 'playbook')
  assert.equal(r?.localHelp?.bestMatch?.id, 'guest-refuses-payment')
})

await test('offline sync reaches the sync FAQ', () => {
  const r = resolveLocalAssistantTurn({ message: 'offline sync' })
  assert.equal(r?.localHelp?.mode, 'faq')
})

await test('expense questions reach expenses, not invoices', () => {
  for (const q of ['food costs', 'where do I record the electricity bill', 'electricity bill']) {
    const r = resolveLocalAssistantTurn({ message: q })
    assert.equal(r?.localHelp?.bestMatch?.id, 'expenses', q)
  }
})

await test('bare check in/out reach the guides', () => {
  assert.equal(resolveLocalAssistantTurn({ message: 'check in' })?.localHelp?.bestMatch?.id, 'check-in')
  assert.equal(resolveLocalAssistantTurn({ message: 'check out' })?.localHelp?.bestMatch?.id, 'check-out')
})

await test('purchase-order-supplies reaches room supplies', () => {
  const r = resolveLocalAssistantTurn({ message: 'purchase order supplies' })
  assert.equal(r?.localHelp?.bestMatch?.id, 'room-supplies')
})

await test('clear follow-ups are not hijacked by session context', () => {
  const session = createLocalAssistantSession({ maxTurns: 5 })
  session.resolve({ message: 'how do I check in?' })
  session.resolve({ message: 'and the payment?' })
  const rooms = session.resolve({ message: 'rooms?' })
  assert.equal(rooms.tool, 'get_room_availability')
  const tomorrow = session.resolve({ message: 'what about tomorrow?' })
  assert.equal(tomorrow.tool, 'get_room_availability')
  assert.ok(Number(tomorrow.params.days) >= 2)
})

await test('continuation follow-ups still use session context', () => {
  const session = createLocalAssistantSession({ maxTurns: 5 })
  session.resolve({ message: 'how do I check in a guest' })
  const second = session.resolve({ message: 'and payment?' })
  assert.equal(second?.localHelp?.bestMatch?.title, 'Record a booking payment')
})

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`)
if (fail > 0) process.exit(1)

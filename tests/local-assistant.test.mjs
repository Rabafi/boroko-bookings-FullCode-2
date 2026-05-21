import assert from 'node:assert/strict'
import { createLocalAssistantSession, resolveLocalAssistantTurn, searchLocalAppHelp } from '../src/main/ai/localAssistant.js'

let pass = 0
let fail = 0

function test(name, fn) {
  try {
    fn()
    pass++
    console.log(`  PASS: ${name}`)
  } catch (error) {
    fail++
    console.log(`  FAIL: ${name} - ${error.message}`)
  }
}

console.log('\n=== Local Assistant Tests ===\n')

test('typo: add stok routes to inventory stock help', () => {
  const result = resolveLocalAssistantTurn({ message: 'how do i add stok', route: '/inventory' })
  assert.equal(result.localHelp.bestMatch.title, 'Manage inventory stock')
})

test('typo: recieve payment routes to booking payment help', () => {
  const result = resolveLocalAssistantTurn({ message: 'where do i recieve payment' })
  assert.equal(result.localHelp.bestMatch.title, 'Record a booking payment')
})

test('typo: funcctions for maintanance routes to maintenance', () => {
  const result = resolveLocalAssistantTurn({ message: 'locate funcctions for maintanance' })
  assert.equal(result.localHelp.bestMatch.title, 'Raise or resolve maintenance tickets')
})

test('fuzzy matching handles messy conceptual wording', () => {
  const result = resolveLocalAssistantTurn({ message: 'how do i prep tomorrow arrivals and rooms' })
  assert.ok(result.localHelp || result.tool)
  assert.notEqual(result.localHelp?.mode, 'fallback')
})

test('live intent: unpaid bookngs routes to list_unpaid_bookings tool', () => {
  const result = resolveLocalAssistantTurn({ message: 'show unpaid bookngs' })
  assert.equal(result.tool, 'list_unpaid_bookings')
})

test('live intent: full unpaid summary routes to get_unpaid_summary tool', () => {
  const result = resolveLocalAssistantTurn({ message: 'full unpaid summary' })
  assert.equal(result.tool, 'get_unpaid_summary')
})

test('current screen help uses active route', () => {
  const result = resolveLocalAssistantTurn({ message: 'what can i do here', route: '/inventory' })
  assert.equal(result.localHelp.bestMatch.title, 'Manage inventory stock')
})

test('failed sync routes to system health, not maintenance', () => {
  const result = resolveLocalAssistantTurn({ message: 'How do I fix failed sync?' })
  assert.equal(result.localHelp.bestMatch.title, 'Fix failed sync and system health issues')
})

test('capabilities question returns capabilities mode', () => {
  const result = resolveLocalAssistantTurn({ message: 'what can you do' })
  assert.equal(result.localHelp.mode, 'capabilities')
})

test('greeting returns greeting mode', () => {
  const result = resolveLocalAssistantTurn({ message: 'hello' })
  assert.equal(result.localHelp.mode, 'greeting')
})

test('closing returns closing mode', () => {
  const result = resolveLocalAssistantTurn({ message: 'goodnight' })
  assert.equal(result.localHelp.mode, 'closing')
})

test('room availability intent resolves to local read tool', () => {
  const result = resolveLocalAssistantTurn({ message: 'which rooms are available tonight' })
  assert.equal(result.tool, 'get_room_availability')
})

test('weekend availability expands beyond one day', () => {
  const result = resolveLocalAssistantTurn({ message: 'which rooms are free this weekend' })
  assert.equal(result.tool, 'get_room_availability')
  assert.ok(Number(result.params.days || 0) >= 2)
})

test('room rate intent resolves to local read tool', () => {
  const result = resolveLocalAssistantTurn({ message: 'what is the rate for room 5' })
  assert.equal(result.tool, 'get_room_rate')
  assert.equal(result.params.room_number, '5')
})

test('negative intent does not jump into an action flow', () => {
  const result = resolveLocalAssistantTurn({ message: "don't check out yet" })
  assert.equal(result.localHelp.mode, 'clarify')
})

test('pending online requests resolves to read tool', () => {
  const result = resolveLocalAssistantTurn({ message: 'any new online booking requests' })
  assert.equal(result.tool, 'get_pending_online_requests')
})

test('booking lookup routes balance by room to lookup tool', () => {
  const result = resolveLocalAssistantTurn({ message: 'balance for room 12' })
  assert.equal(result.tool, 'lookup_booking')
  assert.equal(result.params.room_number, '12')
})

test('room lookup does not leak room words into guest hint', () => {
  const result = resolveLocalAssistantTurn({ message: 'Who is in room 12?' })
  assert.equal(result.tool, 'lookup_booking')
  assert.equal(result.params.room_number, '12')
  assert.equal(result.params.guest_query, null)
})

test('policy-style how do deposits work uses faq mode', () => {
  const result = resolveLocalAssistantTurn({ message: 'how do deposits work' })
  assert.equal(result.localHelp.mode, 'faq')
  assert.match(result.assistantText, /amount_paid/)
})

test('financial faq explains deposits and payment rules', () => {
  const result = resolveLocalAssistantTurn({ message: 'what is the difference between deposit and payment status' })
  assert.equal(result.localHelp.mode, 'faq')
  assert.match(result.assistantText.toLowerCase(), /payment flow/)
})

test('fuzzy faq finds payment policy despite loose wording', () => {
  const result = resolveLocalAssistantTurn({ message: 'can staff type over paid totals' })
  assert.equal(result.localHelp.mode, 'faq')
  assert.match(result.assistantText, /amount_paid/)
})

test('guest search without a guest hint asks for clarification', () => {
  const result = resolveLocalAssistantTurn({ message: 'find guest' })
  assert.equal(result.localHelp.mode, 'clarify')
})

test('handover report intent resolves to handover tool, not daily briefing', () => {
  const result = resolveLocalAssistantTurn({ message: 'show shift handover report' })
  assert.equal(result.tool, 'get_handover_report')
})

test('maintenance satisfaction risk routes to local audit tool', () => {
  const result = resolveLocalAssistantTurn({ message: 'show maintenance risk for active guests' })
  assert.equal(result.tool, 'get_maintenance_satisfaction_risk')
})

test('operational cleanliness audit routes to local audit tool', () => {
  const result = resolveLocalAssistantTurn({ message: 'run the operational cleanliness audit' })
  assert.equal(result.tool, 'get_operational_cleanliness_audit')
})

test('start of shift returns playbook mode', () => {
  const result = resolveLocalAssistantTurn({ message: 'start of shift checklist' })
  assert.equal(result.localHelp.mode, 'playbook')
  assert.match(result.assistantText.toLowerCase(), /start of shift/)
})

test('internet down returns playbook mode', () => {
  const result = resolveLocalAssistantTurn({ message: 'the internet is down' })
  assert.equal(result.localHelp.mode, 'playbook')
  assert.match(result.assistantText.toLowerCase(), /internet down/)
})

test('search returns several related app workflows', () => {
  const matches = searchLocalAppHelp('invoice payment balance', { limit: 3 })
  assert.ok(matches.length >= 2)
  assert.equal(matches[0].title, 'Record a booking payment')
})

test('live data is injected into check-in help', () => {
  const result = resolveLocalAssistantTurn({
    message: 'how do I check in a guest',
    liveContext: { upcoming: { today: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } }
  })
  assert.match(result.assistantText, /3/)
  assert.match(result.assistantText.toLowerCase(), /arrival/)
})

test('fallback includes proactive attention when live alerts exist', () => {
  const result = resolveLocalAssistantTurn({
    message: 'purple banana mystery',
    liveContext: { overdueCount: 2, unpaidCount: 4, stats: { sync_failed: 1 } }
  })
  assert.equal(result.localHelp.mode, 'fallback')
  assert.match(result.assistantText, /sync failure/)
  assert.match(result.assistantText, /overdue checkout/)
  assert.match(result.assistantText, /unpaid booking/)
})

test('session remembers short follow-up context', () => {
  const session = createLocalAssistantSession({ maxTurns: 5 })
  const first = session.resolve({ message: 'how do I check in a guest' })
  assert.equal(first.localHelp.bestMatch.title, 'Check in a guest')
  const second = session.resolve({ message: 'and payment?' })
  assert.equal(second.localHelp.bestMatch.title, 'Record a booking payment')
})

test('session enriches anaphoric follow-up', () => {
  const session = createLocalAssistantSession({ maxTurns: 5 })
  session.resolve({ message: 'How do I send an invoice?' })
  const second = session.resolve({ message: 'and how do I print that?' })
  assert.ok(second.localHelp)
})

test('session uses prior tool context for overdue follow-up', () => {
  const session = createLocalAssistantSession({ maxTurns: 5 })
  const first = session.resolve({ message: 'show unpaid bookings' })
  assert.equal(first.tool, 'list_unpaid_bookings')
  const second = session.resolve({ message: 'and the overdue ones?' })
  assert.equal(second.tool, 'get_overdue_checkouts')
})

test('session carries clarifier slot into the next turn', () => {
  const session = createLocalAssistantSession({ maxTurns: 5 })
  const first = session.resolve({ message: 'what is the room rate' })
  assert.equal(first.localHelp.mode, 'clarify')
  const second = session.resolve({ message: 'room 5' })
  assert.equal(second.tool, 'get_room_rate')
  assert.equal(second.params.room_number, '5')
})

test('session uses structured result memory for first booking follow-up', () => {
  const session = createLocalAssistantSession({ maxTurns: 5 })
  session.resolve({ message: 'show unpaid bookings' })
  session.rememberToolResult('list_unpaid_bookings', { unpaid: [{ id: 'b-100', guest: 'Neo', room_number: '7', balance: 500 }] })
  const second = session.resolve({ message: 'open the first one' })
  assert.equal(second.tool, 'lookup_booking')
  assert.equal(second.params.booking_query, 'b-100')
})

test('state machine asks for missing booking lookup and completes next turn', () => {
  const session = createLocalAssistantSession({ maxTurns: 5 })
  const first = session.resolve({ message: 'find booking' })
  assert.equal(first.localHelp.mode, 'clarify')
  const second = session.resolve({ message: 'room 12' })
  assert.equal(second.tool, 'lookup_booking')
  assert.equal(second.params.room_number, '12')
})

console.log(`\n=== Results: ${pass} passed, ${fail} failed ===\n`)

if (fail > 0) process.exit(1)

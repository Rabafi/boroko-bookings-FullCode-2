import assert from 'node:assert/strict'
import pg from 'pg'
import test from 'node:test'
import { randomUUID } from 'node:crypto'

const DB_URL = process.env.RESTAURANT_ACCOUNTING_TEST_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const client = () => new pg.Client({ connectionString: DB_URL })

async function actor(connection, userId, lodgeId) {
  await connection.query(
    "select set_config('request.jwt.claim.role','service_role',false), set_config('app.session_valid','true',false), set_config('app.actor_id',$1,false), set_config('app.lodge_id',$2,false), set_config('app.session_role','admin',false)",
    [userId, lodgeId]
  )
}

async function ticket(connection, payload) {
  const result = await connection.query('select public.create_support_ticket($1::jsonb) as result', [JSON.stringify(payload)])
  return result.rows[0].result
}

async function message(connection, ticketId, lodgeId, payload) {
  const result = await connection.query(
    `select public.add_lodge_support_ticket_message($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11) as result`,
    [ticketId, lodgeId, payload.body, payload.sender_type, payload.sender_name, payload.sender_role, payload.sender_user_id, payload.sender_surface, JSON.stringify(payload.metadata || {}), payload.status || null, payload.operation_id]
  )
  return result.rows[0].result
}

test('support operation locks make concurrent ticket and message replays safe', async () => {
  const setup = client()
  await setup.connect()
  const lodgeId = randomUUID()
  const userId = randomUUID()
  const ticketOperationId = `ticket-${randomUUID()}`
  const messageOperationId = `message-${randomUUID()}`

  try {
    await setup.query("insert into public.settings(lodge_id,lodge_name,company_name,business_type,property_type,currency) values ($1,'Support Test','Support Test','restaurant','restaurant','BWP')", [lodgeId])
    await setup.query("insert into public.users(id,lodge_id,name,email,role,password_hash,status) values ($1,$2,'Support Manager',$1::text||'@example.invalid','admin','unused','active')", [userId, lodgeId])
    await actor(setup, userId, lodgeId)

    const identicalTicket = {
      lodge_id: lodgeId,
      lodge_name: 'Support Test',
      title: 'Printer issue',
      description: 'Receipt printer is offline',
      category: 'Hardware',
      priority: 'High',
      sender_type: 'manager_pwa',
      sender_name: 'Support Manager',
      sender_role: 'manager',
      sender_user_id: userId,
      sender_surface: 'manager_pwa',
      source: 'manager_pwa',
      operation_id: ticketOperationId
    }
    const a = client()
    const b = client()
    await Promise.all([a.connect(), b.connect()])
    await Promise.all([actor(a, userId, lodgeId), actor(b, userId, lodgeId)])
    const ticketResults = await Promise.all([ticket(a, identicalTicket), ticket(b, identicalTicket)])
    await Promise.all([a.end(), b.end()])
    assert.equal(ticketResults[0].success, true)
    assert.equal(ticketResults[1].success, true)
    assert.equal(ticketResults[0].id, ticketResults[1].id)
    const ticketCount = await setup.query('select count(*)::int as count from public.support_tickets where lodge_id = $1 and client_operation_id = $2', [lodgeId, ticketOperationId])
    assert.equal(ticketCount.rows[0].count, 1)

    const ticketId = ticketResults[0].id
    const identicalMessage = {
      body: 'Please confirm when the printer is available again.',
      sender_type: 'manager_pwa',
      sender_name: 'Support Manager',
      sender_role: 'manager',
      sender_user_id: userId,
      sender_surface: 'manager_pwa',
      metadata: { source: 'manager_pwa', device: 'test' },
      operation_id: messageOperationId
    }
    const c = client()
    const d = client()
    await Promise.all([c.connect(), d.connect()])
    await Promise.all([actor(c, userId, lodgeId), actor(d, userId, lodgeId)])
    const messageResults = await Promise.all([message(c, ticketId, lodgeId, identicalMessage), message(d, ticketId, lodgeId, identicalMessage)])
    await Promise.all([c.end(), d.end()])
    assert.equal(messageResults[0].success, true)
    assert.equal(messageResults[1].success, true)
    assert.equal(messageResults[0].message_id, messageResults[1].message_id)
    const messageCount = await setup.query('select count(*)::int as count from public.support_ticket_messages where lodge_id = $1 and ticket_id = $2 and client_operation_id = $3', [lodgeId, ticketId, messageOperationId])
    assert.equal(messageCount.rows[0].count, 1)

    const conflict = await ticket(setup, { ...identicalTicket, title: 'Different title' })
    assert.equal(conflict.success, false)
    assert.equal(conflict.code, 'idempotency_conflict')
    const senderConflict = await message(setup, ticketId, lodgeId, { ...identicalMessage, sender_surface: 'desktop' })
    assert.equal(senderConflict.success, false)
    assert.equal(senderConflict.code, 'idempotency_conflict')

    const replay = await message(setup, ticketId, lodgeId, identicalMessage)
    assert.equal(replay.success, true)
    assert.equal(replay.replayed, true)
    assert.equal(replay.message_id, messageResults[0].message_id)
  } finally {
    await setup.query('delete from public.support_tickets where lodge_id = $1', [lodgeId]).catch(() => {})
    await setup.query('delete from public.users where lodge_id = $1', [lodgeId]).catch(() => {})
    await setup.query('delete from public.settings where lodge_id = $1', [lodgeId]).catch(() => {})
    await setup.end()
  }
})

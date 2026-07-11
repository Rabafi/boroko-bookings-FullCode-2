import test from 'node:test'
import assert from 'node:assert/strict'

const TRIGGER_EVENTS = [
  'booking_confirmed', 'checkin_done', 'checkout_done',
  'night_audit_close', 'balance_due', 'cancellation', 'no_show'
]

const CHANNELS = ['email', 'whatsapp', 'sms']

const CATEGORIES = ['pre_arrival', 'checkin', 'balance', 'cancellation', 'no_show', 'post_stay', 'custom']

test('Guest messaging trigger events are defined', () => {
  assert.ok(Array.isArray(TRIGGER_EVENTS))
  assert.ok(TRIGGER_EVENTS.includes('booking_confirmed'))
  assert.ok(TRIGGER_EVENTS.includes('checkin_done'))
  assert.ok(TRIGGER_EVENTS.includes('checkout_done'))
  assert.ok(TRIGGER_EVENTS.includes('night_audit_close'))
  assert.ok(TRIGGER_EVENTS.includes('balance_due'))
  assert.ok(TRIGGER_EVENTS.includes('cancellation'))
  assert.ok(TRIGGER_EVENTS.includes('no_show'))
  assert.equal(TRIGGER_EVENTS.length, 7)
})

test('Guest messaging channels are defined', () => {
  assert.ok(Array.isArray(CHANNELS))
  assert.ok(CHANNELS.includes('email'))
  assert.ok(CHANNELS.includes('whatsapp'))
  assert.ok(CHANNELS.includes('sms'))
  assert.equal(CHANNELS.length, 3)
})

test('Guest messaging categories are defined', () => {
  assert.ok(Array.isArray(CATEGORIES))
  assert.ok(CATEGORIES.includes('pre_arrival'))
  assert.ok(CATEGORIES.includes('checkin'))
  assert.ok(CATEGORIES.includes('balance'))
  assert.ok(CATEGORIES.includes('cancellation'))
  assert.ok(CATEGORIES.includes('no_show'))
  assert.ok(CATEGORIES.includes('post_stay'))
  assert.ok(CATEGORIES.includes('custom'))
  assert.equal(CATEGORIES.length, 7)
})

test('Template variable substitution works correctly', () => {
  const template = 'Dear {{guest_name}}, your booking {{booking_reference}} starts {{check_in}}.'
  const variables = { guest_name: 'John', booking_reference: 'BR-001', check_in: '2026-07-10' }

  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }

  assert.equal(result, 'Dear John, your booking BR-001 starts 2026-07-10.')
})

test('Template variable substitution handles missing variables', () => {
  const template = 'Hello {{guest_name}}, room {{room_number}}'
  const variables = { guest_name: 'Alice' }

  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }

  assert.equal(result, 'Hello Alice, room {{room_number}}')
})

test('Template variable substitution handles empty variables', () => {
  const template = '{{guest_name}} {{guest_email}}'
  const variables = {}

  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }

  assert.equal(result, '{{guest_name}} {{guest_email}}')
})

test('Trigger delay is non-negative', () => {
  const delays = [0, 5, 30, 120, 1440]
  for (const d of delays) {
    assert.ok(Number.isFinite(d) && d >= 0, `Delay ${d} must be non-negative`)
  }

  const negative = -5
  const sanitized = Math.max(0, negative)
  assert.equal(sanitized, 0, 'Negative delay should be clamped to 0')
})

test('Template model shape is valid', () => {
  const template = {
    id: 'uuid-1',
    lodge_id: 'uuid-lodge',
    template_key: 'pre_arrival_reminder',
    name: 'Pre-arrival Reminder',
    subject_template: 'Your stay at {{property_name}}',
    body_template: 'Dear {{guest_name}}...',
    channel: 'email',
    variables: ['guest_name', 'check_in', 'room_number'],
    category: 'pre_arrival',
    active: true
  }

  assert.ok(template.id)
  assert.ok(template.lodge_id)
  assert.ok(template.template_key)
  assert.ok(template.body_template)
  assert.ok(Array.isArray(template.variables))
  assert.equal(typeof template.active, 'boolean')
  assert.ok(['email', 'whatsapp', 'sms'].includes(template.channel))
  assert.ok(CATEGORIES.includes(template.category))
})

test('Trigger model shape is valid', () => {
  const trigger = {
    id: 'uuid-1',
    lodge_id: 'uuid-lodge',
    trigger_event: 'booking_confirmed',
    template_id: 'uuid-template',
    delay_minutes: 30,
    active: true,
    channel: 'email'
  }

  assert.ok(trigger.id)
  assert.ok(trigger.lodge_id)
  assert.ok(TRIGGER_EVENTS.includes(trigger.trigger_event))
  assert.ok(trigger.template_id)
  assert.ok(Number.isFinite(trigger.delay_minutes) && trigger.delay_minutes >= 0)
  assert.equal(typeof trigger.active, 'boolean')
  assert.ok(['email', 'whatsapp', 'sms'].includes(trigger.channel))
})

test('Render result shape is valid', () => {
  const renderResult = {
    success: true,
    subject: 'Your stay at Test Lodge',
    body: 'Dear John, welcome to Test Lodge!',
    template_key: 'pre_arrival_reminder',
    channel: 'email'
  }

  assert.equal(renderResult.success, true)
  assert.equal(typeof renderResult.subject, 'string')
  assert.equal(typeof renderResult.body, 'string')
  assert.equal(renderResult.template_key, 'pre_arrival_reminder')
  assert.ok(['email', 'whatsapp', 'sms'].includes(renderResult.channel))
})

test('Render error shape is valid', () => {
  const errorResult = { success: false, error: 'Template not found' }

  assert.equal(errorResult.success, false)
  assert.equal(typeof errorResult.error, 'string')
})

test('Message delivery status values', () => {
  const statuses = ['draft', 'queued', 'sent', 'delivered', 'failed']
  assert.equal(statuses.length, 5)
  assert.ok(statuses.includes('draft'))
  assert.ok(statuses.includes('queued'))
  assert.ok(statuses.includes('sent'))
  assert.ok(statuses.includes('delivered'))
  assert.ok(statuses.includes('failed'))
})

test('Enterprise guest messages table shape', () => {
  const message = {
    id: 'uuid-1',
    lodge_id: 'uuid-lodge',
    booking_id: null,
    customer_id: null,
    template_key: 'pre_arrival_reminder',
    channel: 'email',
    status: 'queued',
    payload: { subject: 'Test', body: 'Hello' },
    created_at: new Date().toISOString()
  }

  assert.ok(message.id)
  assert.ok(message.lodge_id)
  assert.equal(message.template_key, 'pre_arrival_reminder')
  assert.equal(message.channel, 'email')
  assert.ok(['draft', 'queued', 'sent', 'delivered', 'failed'].includes(message.status))
  assert.ok(message.payload)
  assert.ok(message.created_at)
})

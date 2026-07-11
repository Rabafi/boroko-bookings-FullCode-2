import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'

const MIGRATION_FILE = '20260705130000_payment_gateway_full.sql'
const WEBHOOK_LOCKDOWN_FILE = '20260707100000_payment_webhook_service_role_only.sql'

function readMigration() {
  const migrationDir = path.resolve('supabase/migrations')
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'))
  const migration = files.find(f => f.includes('payment_gateway_full'))
  assert.ok(migration, `Expected ${MIGRATION_FILE} to exist`)
  return fs.readFileSync(path.join(migrationDir, migration), 'utf8')
}

function readWebhookLockdownMigration() {
  const file = path.resolve('supabase/migrations', WEBHOOK_LOCKDOWN_FILE)
  assert.ok(fs.existsSync(file), `Expected ${WEBHOOK_LOCKDOWN_FILE} to exist`)
  return fs.readFileSync(file, 'utf8')
}

test('Migration file exists', () => {
  const migrationDir = path.resolve('supabase/migrations')
  const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.sql'))
  const migration = files.find(f => f.includes('payment_gateway_full'))
  assert.ok(migration, `Expected ${MIGRATION_FILE} to exist`)
})

test('Migration uses verify_webhook_signature function', () => {
  const sql = readMigration()
  const match = sql.match(/create or replace function public\.verify_webhook_signature\s*\(/)
  assert.ok(match, 'verify_webhook_signature function must be defined')
})

test('verify_webhook_signature rejects missing provider (missing config lookup)', () => {
  const sql = readMigration()
  assert.ok(sql.includes("'provider_not_found_or_inactive'"), 'Must return provider_not_found_or_inactive when provider config is missing')
  assert.ok(sql.includes("is_active = true"), 'Must only match active provider configs')
})

test('verify_webhook_signature rejects missing secret', () => {
  const sql = readMigration()
  assert.ok(sql.includes("'provider_secret_not_configured'"), 'Must reject when webhook_secret is null or empty')
  assert.ok(sql.includes("webhook_secret is null"), 'Must check for null webhook_secret')
  assert.ok(sql.includes("webhook_secret = ''"), 'Must check for empty webhook_secret')
})

test('verify_webhook_signature rejects stale timestamp', () => {
  const sql = readMigration()
  assert.ok(sql.includes("'stale_timestamp'"), 'Must reject timestamps older than max age')
  assert.ok(sql.includes("max_age_seconds"), 'Must have configurable max age')
  assert.ok(sql.includes("p_timestamp"), 'Must accept p_timestamp parameter')
})

test('verify_webhook_signature handles provider-specific algorithms', () => {
  const sql = readMigration()
  assert.ok(sql.includes("hmac("), 'HMAC used for stripe and generic providers')
  assert.ok(sql.includes("digest("), 'digest/MD5 used for payfast and paygate')
  assert.ok(sql.includes("'stripe'"), 'stripe provider support')
  assert.ok(sql.includes("'payfast'"), 'payfast provider support')
  assert.ok(sql.includes("'paygate'"), 'paygate provider support')
  assert.ok(sql.includes("'signature_mismatch'"), 'Must return signature_mismatch on failure')
})

test('record_webhook_payment requires verification (calls verify_webhook_signature)', () => {
  const sql = readMigration()
  assert.ok(sql.includes('verify_webhook_signature'), 'record_webhook_payment must call verify_webhook_signature')
  assert.ok(sql.includes("'success', false"), 'record_webhook_payment must return success=false on verification failure')
  assert.ok(sql.includes("'verified', false"), 'record_webhook_payment must indicate unverified status')
})

test('record_webhook_payment rejects unverified webhooks (no transaction created)', () => {
  const sql = readMigration()
  assert.ok(sql.includes("'failed'"), 'Failed verification creates webhook_events with failed status')
  assert.ok(sql.includes('webhook_events'), 'record_webhook_payment must use webhook_events table')
  assert.ok(sql.includes('v_verified'), 'record_webhook_payment must check verification result')
})

test('record_webhook_payment is idempotent on event_id', () => {
  const sql = readMigration()
  assert.ok(sql.includes('webhook_events_provider_event_idx'), 'UNIQUE index on (provider, event_id) must exist')
  assert.ok(sql.includes('event_id = v_event_id'), 'Must look up existing event by event_id')
  assert.ok(sql.includes("'duplicate', true"), 'Must return duplicate=true for repeated event_id')
})

test('confirm_payment_from_webhook checks verification status', () => {
  const sql = readMigration()
  assert.ok(sql.includes('create or replace function public.confirm_payment_from_webhook('),
    'confirm_payment_from_webhook function must exist')
  assert.ok(sql.includes("'Webhook not verified for provider payment %'"), 'Must raise exception when webhook not verified')
  assert.ok(sql.includes('pt.webhook_verified = true'), 'Must check webhook_verified flag on payment_transactions')
})

test('No placeholder text remains in migration file', () => {
  const sql = readMigration()
  const placeholders = ['TODO', 'FIXME', 'PLACEHOLDER', 'replace_me', 'placeholder']
  for (const placeholder of placeholders) {
    const pattern = new RegExp(placeholder, 'i')
    assert.ok(!pattern.test(sql), `No "${placeholder}" placeholder text should remain in migration`)
  }
})

test('Browser redirect/session success cannot mark paid', () => {
  const sql = readMigration()
  assert.ok(sql.includes("'completed'"), 'payment_transactions status includes completed')
  assert.ok(sql.match(/grant execute on function public\.confirm_payment_from_webhook\(text,\s*text,\s*jsonb\) to service_role/),
    'Only service_role can call confirm_payment_from_webhook')
  assert.ok(sql.includes('revoke insert, update, delete on public.payment_transactions from authenticated, anon'),
    'Authenticated users cannot directly mutate payment_transactions')
})

test('record_webhook_payment is service-role only after webhook lockdown migration', () => {
  const sql = readWebhookLockdownMigration()
  assert.match(sql, /revoke all on function public\.record_webhook_payment\(uuid,\s*jsonb,\s*text,\s*text\) from authenticated/i)
  assert.match(sql, /revoke all on function public\.record_webhook_payment\(uuid,\s*jsonb,\s*text,\s*text\) from anon/i)
  assert.match(sql, /grant execute on function public\.record_webhook_payment\(uuid,\s*jsonb,\s*text,\s*text\) to service_role/i)
})

test('webhook_events table has UNIQUE constraint on (provider, event_id)', () => {
  const sql = readMigration()
  assert.ok(sql.includes('webhook_events_provider_event_idx'), 'Unique index on provider and event_id')
  assert.ok(sql.includes('provider, event_id'), 'Index covers provider and event_id')
  assert.ok(sql.includes('event_id is not null'), 'Partial index only applies when event_id is not null')
})

test('webhook_events table has proper structure', () => {
  const sql = readMigration()
  assert.ok(sql.includes('create table if not exists public.webhook_events'), 'webhook_events table must exist')
  assert.ok(sql.includes('lodge_id uuid'), 'lodge_id column must exist')
  assert.ok(sql.includes('provider text'), 'provider column must exist')
  assert.ok(sql.includes('event_id text'), 'event_id column must exist')
  assert.ok(sql.includes("status text"), 'status column must exist')
  assert.ok(sql.includes("'verified'"), 'verified status option must exist')
  assert.ok(sql.includes("'failed'"), 'failed status option must exist')
  assert.ok(sql.includes('verification_result'), 'verification_result column must exist')
  assert.ok(sql.includes('transaction_id'), 'transaction_id column must exist')
  assert.ok(sql.includes('verified_at'), 'verified_at column must exist')
})

test('record_webhook_payment accepts p_event_id parameter', () => {
  const sql = readMigration()
  assert.ok(sql.includes('p_event_id text default null'), 'record_webhook_payment must accept p_event_id parameter')
})

test('Payment gateway UI verifies signatures without recording fake payments', () => {
  const component = fs.readFileSync(path.resolve('src/renderer/src/components/PaymentGatewayConfig.jsx'), 'utf8')
  const preload = fs.readFileSync(path.resolve('src/preload/index.js'), 'utf8')
  const mainIndex = fs.readFileSync(path.resolve('src/main/index.js'), 'utf8')
  const databaseFacade = fs.readFileSync(path.resolve('src/main/database.js'), 'utf8')
  assert.ok(component.includes('verifyWebhookSignature'), 'UI should expose signature verification')
  assert.ok(component.includes('without creating a payment or settling a booking'), 'UI should state that signature checks do not settle payments')
  assert.ok(!component.includes('recordWebhookPayment(payload'), 'UI must not record a fake webhook payment from a manual test payload')
  assert.ok(!component.includes('test_signature'), 'UI must not use a hard-coded dummy signature to record a payment')
  assert.ok(!preload.includes('recordWebhookPayment'), 'preload must not expose webhook recording to renderer code')
  assert.ok(!mainIndex.includes("payments:recordWebhookPayment"), 'main IPC must not expose webhook recording to renderer code')
  assert.ok(!databaseFacade.includes('recordWebhookPayment'), 'database facade must not export webhook recording to desktop IPC handlers')
  assert.ok(!preload.includes('createPaymentIntent'), 'preload must not expose provider checkout creation to renderer code')
  assert.ok(!mainIndex.includes("payments:createPaymentIntent"), 'main IPC must not expose provider checkout creation to renderer code')
  assert.ok(!databaseFacade.includes('createPaymentIntent'), 'database facade must not export provider checkout creation to desktop IPC handlers')
  assert.ok(!preload.includes('createBookingIntent'), 'preload must not expose public booking-intent creation to renderer code')
  assert.ok(!mainIndex.includes("payments:createBookingIntent"), 'main IPC must not expose public booking-intent creation to renderer code')
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('support-inbox idempotency migration stores a client operation key per ticket and message', async () => {
  const migration = await read('supabase/migrations/20260805100000_support_inbox_operation_id_idempotency.sql')

  assert.match(migration, /add column if not exists client_operation_id text/)
  assert.match(migration, /create unique index if not exists support_tickets_client_operation_uidx/)
  assert.match(migration, /on public\.support_tickets \(lodge_id, client_operation_id\)/)
  assert.match(migration, /create unique index if not exists support_ticket_messages_client_operation_uidx/)
  assert.match(migration, /on public\.support_ticket_messages \(lodge_id, ticket_id, client_operation_id\)/)
  assert.match(migration, /add column if not exists client_payload_hash text/)
})

test('create_support_ticket replays the original ticket instead of duplicating it', async () => {
  const migration = await read('supabase/migrations/20260805100000_support_inbox_operation_id_idempotency.sql')

  assert.match(migration, /v_operation_id text := nullif\(btrim\(coalesce\(payload->>'operation_id', payload->>'client_operation_id', ''\)\), ''\)/)
  assert.match(migration, /operation_id must be between 8 and 128 characters/)
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(format\('support-ticket:/)
  assert.match(migration, /encode\(sha256\(convert_to\(jsonb_build_object\(/)
  assert.match(migration, /'lodge_name', v_lodge_name/)
  assert.match(migration, /'requester_user_id', v_sender_user_id/)
  assert.match(migration, /'replayed', true/)
  assert.match(migration, /'code', 'idempotency_conflict'/)
  assert.match(migration, /client_payload_hash/)
  assert.match(migration, /grant execute on function public\.create_support_ticket\(jsonb\) to anon, authenticated, service_role/)
})

test('add_lodge_support_ticket_message accepts an operation key and replays the original message', async () => {
  const migration = await read('supabase/migrations/20260805100000_support_inbox_operation_id_idempotency.sql')

  assert.match(migration, /drop function if exists public\.add_lodge_support_ticket_message\(uuid, uuid, text, text, text, text, text, text, jsonb, text\)/)
  assert.match(migration, /p_operation_id text default null/)
  assert.match(migration, /where lodge_id = p_lodge_id and ticket_id = p_ticket_id and client_operation_id = v_operation_id/)
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(format\('support-message:/)
  assert.match(migration, /'metadata', coalesce\(p_metadata, '\{\}'::jsonb\)/)
  assert.match(migration, /'message_id', v_existing_message_id, 'replayed', true/)
  assert.match(migration, /grant execute on function public\.add_lodge_support_ticket_message\(uuid, uuid, text, text, text, text, text, text, jsonb, text, text\) to anon, authenticated, service_role/)
})

test('PWA support queue persists a stable operation key so flush replays resolve instead of duplicating', async () => {
  const pwaApi = await read('manager-pwa/src/lib/api.js')
  const runtime = await read('manager-pwa/src/lib/runtime.js')

  assert.match(pwaApi, /function isSupportOperation\(type\)/)
  assert.match(pwaApi, /const operationId = supportOperation/)
  assert.match(pwaApi, /queueItem\.id = operationId/)
  assert.match(pwaApi, /enqueueOfflineOperationVerified\(lodgeId, queueItem\)/)
  assert.match(pwaApi, /removeOfflineOperation\(lodgeId, operationId\)/)
  assert.match(pwaApi, /if \(supportOperation\) removeOfflineOperation/)
  assert.match(pwaApi, /payload: carriedPayload,/)
  assert.match(pwaApi, /execute: \(executionPayload, operationId\) => executeSupport\(executionPayload, operationId\)/)
  assert.match(pwaApi, /execute: \(executionPayload, operationId\) => executeSupportMessage\(executionPayload, operationId\)/)
  assert.match(pwaApi, /operation_id: operationId \|\| payload\.client_operation_id \|\| payload\.operation_id \|\| null/)
  assert.match(pwaApi, /p_operation_id: operationId \|\| payload\.client_operation_id \|\| payload\.operation_id \|\| null/)
  assert.match(pwaApi, /case 'support\/create':/)
  assert.match(pwaApi, /await executeSupport\(item\.payload, item\.id\)/)
  assert.match(pwaApi, /await executeSupportMessage\(item\.payload, item\.id\)/)
  assert.match(runtime, /createQueuedOperation\(type, label, payload\)/)
  assert.match(runtime, /readLocalJsonVerified/)
  assert.match(runtime, /deduplicateQueueItems/)
})

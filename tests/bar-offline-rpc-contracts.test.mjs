import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('plain clock-out and offline menu update use stable wrapper operation keys', () => {
  const pos = read('src/main/domains/pos.js')
  assert.match(pos, /const resolvedKey = idempotency_key \|\| idempotencyKey \|\| randomUUID\(\)/)
  assert.match(pos, /queueOperation\('rpc', 'clock_out_staff_offline'/)
  assert.match(pos, /const operationKey = data\?\.operation_key \|\| data\?\.operationKey \|\| randomUUID\(\)/)
  assert.match(pos, /queueOperation\('rpc', 'update_pos_menu_item_offline'/)
  assert.match(pos, /pos-menu-item-update-\$\{id\}-\$\{operationKey\}/)
})

test('legacy direct queue rows are replayed through wrappers without minting retry keys', () => {
  const sync = read('src/main/domains/infrastructure.js')
  assert.match(sync, /item\.table === 'update_pos_menu_item'/)
  assert.match(sync, /replayRpc = 'update_pos_menu_item_offline'/)
  assert.match(sync, /item\.table === 'clock_out_staff'/)
  assert.match(sync, /replayRpc = 'clock_out_staff_offline'/)
  assert.match(sync, /legacy-menu-update:\$\{item\._queue_id/)
  assert.match(sync, /legacy-clock-out:\$\{item\._queue_id/)
})

test('forward migration provides idempotent wrappers and reviewed desktop grants', () => {
  const sql = read('supabase/migrations/20260821040000_offline_rpc_contracts_and_desktop_grants.sql')
  for (const fn of [
    'clock_out_staff_offline(jsonb)',
    'update_pos_menu_item_offline(jsonb)',
    'get_staff_open_pos_shift(uuid,uuid)',
    'clock_in_staff(jsonb)',
    'create_pos_menu_item(jsonb)',
    'update_pos_menu_item(uuid,uuid,jsonb)',
    'activate_shared_till_operator(jsonb)',
    'link_my_pos_shift_to_attendance(jsonb)',
    'submit_pos_shift_cashup(jsonb)',
    'submit_pos_shift_cashup_with_attendance_pin(jsonb)',
    'review_pos_cashup_submission(jsonb)',
    'get_pos_shift_close_resolution(uuid,uuid,text)',
    'split_pos_tab_evenly(jsonb)',
    'get_restaurant_setup_progress(uuid)',
    'set_restaurant_setup_stage(jsonb)',
    'record_restaurant_setup_evidence(jsonb)'
  ]) {
    assert.match(sql, new RegExp(`grant execute on function[^;]*${fn.replace(/[()[\],]/g, '\\$&')}[^;]*to anon`, 'i'), fn)
  }
  assert.match(sql, /payload_hash/)
  assert.match(sql, /Clock-out idempotency key was already used with a different payload/)
  assert.match(sql, /Menu update operation key was already used with a different payload/)
  assert.match(sql, /log_restaurant_financial_action\(/)
  assert.match(sql, /revoke all on function public\.clock_out_staff\(jsonb\) from public, anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.clock_out_staff\(jsonb\) to service_role/i)
  assert.doesNotMatch(sql, /grant execute on function public\.clock_out_staff\(jsonb\)[^;]*to anon/i)
})

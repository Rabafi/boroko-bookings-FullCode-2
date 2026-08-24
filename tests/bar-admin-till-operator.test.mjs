import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (file) => fs.readFileSync(file, 'utf8')
const migration = read('supabase/migrations/20260821030000_bar_till_administrative_operator_roles.sql')
const main = read('src/main/index.js')
const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

test('admin may be the selected Bar Till operator without an owner-role override', () => {
  assert.match(
    migration,
    /lower\(coalesce\(u\.role, ''\)\) in \([\s\S]*'admin'[\s\S]*'manager'[\s\S]*'supervisor'[\s\S]*'super_admin'/,
  )
  assert.match(migration, /from public\.users u[\s\S]*u\.lodge_id = p_lodge_id/)
  assert.match(migration, /s\.outlet_id is not distinct from p_outlet_id[\s\S]*s\.cashier_id = p_waiter_id[\s\S]*s\.status = 'open'/)
  assert.match(migration, /a\.staff_user_id = p_waiter_id[\s\S]*a\.status = 'active'/)
  assert.doesNotMatch(migration, /user_lodge_roles/)
  assert.doesNotMatch(migration, /'owner'/)
})

test('desktop shared Till actor allowlists remain admin-scoped', () => {
  assert.match(main, /const SHARED_TILL_ROLES = new Set\(\['manager', 'admin', 'supervisor', 'super_admin'\]\)/)
  assert.match(terminal, /const sharedTerminalMode = \[[\s\S]*"manager"[\s\S]*"admin"[\s\S]*"supervisor"[\s\S]*"super_admin"/)
  assert.doesNotMatch(terminal, /const sharedTerminalMode = \[[\s\S]*"owner"/)
})

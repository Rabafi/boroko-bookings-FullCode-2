import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('bootstrap company settings migration and client path exist', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260712120000_bootstrap_company_settings.sql'),
    'utf8'
  )
  const settings = fs.readFileSync(path.join(root, 'src/main/domains/settings.js'), 'utf8')
  const hospitalityRepair = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260713150000_hospitality_mode_bootstrap_repair.sql'),
    'utf8'
  )

  assert.match(migration, /create or replace function public\.bootstrap_company_settings/)
  assert.match(migration, /security definer/i)
  assert.match(migration, /grant execute on function public\.bootstrap_company_settings/)
  assert.match(migration, /remote_lodge_already_exists/)

  assert.match(settings, /bootstrap_company_settings/)
  assert.match(settings, /allowBootstrap/)
  assert.match(settings, /bootstrapRemoteSettingsRecord/)
  assert.match(settings, /isRowLevelSecurityError/)
  assert.match(settings, /saveSettings\(settings, \{ allowBootstrap: true \}\)/)
  assert.match(hospitalityRepair, /operating_profile = excluded\.operating_profile/)
  assert.match(hospitalityRepair, /hospitality_mode/)
})

test('global admin email unique index is dropped for multi-company setup', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260712153000_drop_global_admin_email_unique.sql'),
    'utf8'
  )
  assert.match(migration, /drop index if exists public\.users_admin_email_unique/)
  assert.match(migration, /users_admin_email_lookup_idx/)
})

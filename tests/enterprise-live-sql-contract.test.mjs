import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const migrationsDir = resolve(__dirname, '../supabase/migrations')
const allMigrations = readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort()

const enterpriseMigrations = allMigrations.filter(f => (
  f.startsWith('20260705') || f.startsWith('20260706') || f.startsWith('20260707')
))

const KNOWN_NO_LODGE_ROLE = [
  '20260705150500_hotel_roles_permissions.sql',
  '20260707100000_payment_webhook_service_role_only.sql',
  '20260707113000_settings_property_type.sql'
]

const KNOWN_NO_RLS = [
  '20260705125000_group_operations.sql',
  '20260705150000_advanced_reports.sql',
  '20260706100000_channel_sync_manual_review_until_provider.sql',
  '20260707100000_payment_webhook_service_role_only.sql',
  '20260707113000_settings_property_type.sql'
]

const KNOWN_NO_GRANT_EXECUTE = [
  '20260707100000_payment_webhook_service_role_only.sql',
  '20260707113000_settings_property_type.sql'
]

const KNOWN_NO_SECURITY_DEFINER = [
  '20260707100000_payment_webhook_service_role_only.sql',
  '20260707113000_settings_property_type.sql'
]

for (const file of enterpriseMigrations) {
  const sql = readFileSync(resolve(migrationsDir, file), 'utf8')
  const lower = sql.toLowerCase()

  const skipRole = KNOWN_NO_LODGE_ROLE.includes(file)
  const skipRls = KNOWN_NO_RLS.includes(file)
  const skipGrant = KNOWN_NO_GRANT_EXECUTE.includes(file)
  const skipSecurityDefiner = KNOWN_NO_SECURITY_DEFINER.includes(file)

  test(`migration ${file}: includes app_require_lodge_role`, () => {
    if (skipRole) {
      assert.ok(!lower.includes('app_require_lodge_role'),
        `${file} is a known exception without app_require_lodge_role`)
      return
    }
    assert.ok(
      lower.includes('app_require_lodge_role'),
      `${file} should include app_require_lodge_role`
    )
  })

  test(`migration ${file}: enables RLS on at least one table`, () => {
    if (skipRls) {
      assert.ok(!lower.includes('enable row level security'),
        `${file} is a known exception without RLS`)
      return
    }
    assert.ok(
      lower.includes('enable row level security'),
      `${file} should enable RLS`
    )
  })

  test(`migration ${file}: grants EXECUTE to authenticated`, () => {
    if (skipGrant) {
      assert.ok(!/grant\s+execute[\s\S]*\bto\s+authenticated\b/i.test(sql),
        `${file} is a known exception without GRANT EXECUTE`)
      return
    }
    assert.ok(
      lower.includes('grant execute') && lower.includes('authenticated'),
      `${file} should grant EXECUTE to authenticated`
    )
  })

  test(`migration ${file}: no placeholder patterns (TODO/FIXME/placeholder/replace_me)`, () => {
    assert.ok(!lower.includes('todo'), `${file} should not contain TODO`)
    assert.ok(!lower.includes('fixme'), `${file} should not contain FIXME`)
    assert.ok(!lower.includes('placeholder'), `${file} should not contain placeholder`)
    assert.ok(!lower.includes('replace_me'), `${file} should not contain replace_me`)
  })

  test(`migration ${file}: has at least one SECURITY DEFINER function`, () => {
    if (skipSecurityDefiner) {
      assert.ok(!lower.includes('security definer'),
        `${file} is a known grants-only exception without SECURITY DEFINER`)
      return
    }
    const securityDefinerCount = (sql.match(/SECURITY DEFINER/gi) || []).length
    assert.ok(
      securityDefinerCount >= 1,
      `${file} should have at least one SECURITY DEFINER function, found ${securityDefinerCount}`
    )
  })
}

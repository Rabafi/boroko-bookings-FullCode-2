import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
const migrationsDir = path.join(root, 'supabase', 'migrations')
const definitionPattern = /create\s+or\s+replace\s+function\s+public\._license_plan_features\s*\(/i

function latestLicenseFeatureDefinition() {
  const matches = fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .filter((name) => definitionPattern.test(fs.readFileSync(path.join(migrationsDir, name), 'utf8')))

  assert.ok(matches.length > 0, 'Expected a _license_plan_features migration')
  const name = matches.at(-1)
  return { name, sql: fs.readFileSync(path.join(migrationsDir, name), 'utf8') }
}

test('latest license feature resolver avoids PostgreSQL variadic argument limits', () => {
  const { name, sql } = latestLicenseFeatureDefinition()
  const executableSql = sql.replace(/^\s*--.*$/gm, '')

  assert.equal(name, '20260829010000_fix_license_feature_argument_limit.sql')
  assert.match(executableSql, /jsonb_object_agg\s*\(/i)
  assert.match(executableSql, /unnest\s*\(v_all_features\)/i)
  assert.doesNotMatch(executableSql, /jsonb?_build_object\s*\(/i)
})

test('hotfix preserves the complete feature-key contract and plan branches', () => {
  const { sql } = latestLicenseFeatureDefinition()
  const allFeaturesBlock = sql.match(/v_all_features\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/i)?.[1]
  assert.ok(allFeaturesBlock, 'Expected the canonical feature-key array')

  const features = [...allFeaturesBlock.matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.equal(features.length, 63)
  assert.equal(new Set(features).size, 63)

  for (const capability of [
    'prepayments_basic',
    'pwa',
    'hotel_mode',
    'housekeeping_command_center',
    'night_audit_enterprise',
    'venue_management'
  ]) {
    assert.ok(features.includes(capability), `Expected ${capability} in the feature contract`)
  }

  assert.match(sql, /if\s+p_expired\s+then/i)
  assert.match(sql, /elsif\s+p_trial\s+then[\s\S]*?v_enable_all\s*:=\s*true/i)
  assert.match(sql, /v_plan\s+in\s*\('enterprise',\s*'hotel',\s*'resort'\)/i)
  assert.match(sql, /v_plan\s+in\s*\('pro',\s*'premium'\)/i)
  assert.match(sql, /v_plan\s*=\s*'standard'/i)
})

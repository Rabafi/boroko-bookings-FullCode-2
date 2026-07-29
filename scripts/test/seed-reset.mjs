#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { buildFixtureRows } from '../../tests/integration/tenant-fixture.mjs'
import {
  assertDisposableTarget,
  formatSafeTarget,
  loadTestEnv,
  redactSecrets,
  requireResetConfirmation,
  requireServiceRoleKey,
  RESET_DATA_CONFIRMATION
} from '../../tests/integration/test-tenant-guard.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function printUsage() {
  console.log(`Usage:
  node scripts/test/seed-reset.mjs seed [--env-file .env]
  node scripts/test/seed-reset.mjs preview [--mode tagged_test_data] [--days 30]
  node scripts/test/seed-reset.mjs reset --confirm-reset [--mode tagged_test_data] [--days 30] [--reason "..."]

Safety requirements:
  BOROKO_TEST_TENANT=true
  BOROKO_TEST_LODGE_ID=<dedicated UUID> (set outside .env)
  SUPABASE_SERVICE_ROLE_KEY=<process environment only>

Reset additionally requires the literal confirmation phrase: ${RESET_DATA_CONFIRMATION}`)
}

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv
  const options = {
    command: command === '--help' || command === '-h' ? 'help' : command,
    envFile: '.env',
    mode: 'tagged_test_data',
    days: 30,
    reason: '',
    confirmed: false
  }
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (arg === '--help' || arg === '-h') options.command = 'help'
    else if (arg === '--confirm-reset') options.confirmed = true
    else if (arg === '--env-file') options.envFile = rest[++index] || options.envFile
    else if (arg === '--mode') options.mode = rest[++index] || options.mode
    else if (arg === '--days') options.days = Number(rest[++index] || options.days)
    else if (arg === '--reason') options.reason = rest[++index] || ''
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 3650) {
    throw new Error('--days must be an integer between 1 and 3650.')
  }
  if (!['recent_activity', 'tagged_test_data', 'full_demo_reset'].includes(options.mode)) {
    throw new Error('--mode must be recent_activity, tagged_test_data, or full_demo_reset.')
  }
  return options
}

function safeSupabaseError(error) {
  const message = error?.message || error?.details || error?.hint || String(error)
  return redactSecrets(message).replace(/https?:\/\/[^\s)]+/gi, '[SUPABASE_URL_REDACTED]')
}

async function upsertRows(client, table, rows, onConflict = 'id') {
  const list = Array.isArray(rows) ? rows : [rows]
  const { error } = await client.from(table).upsert(list, { onConflict, ignoreDuplicates: false })
  if (error) throw new Error(`Seed ${table} failed: ${safeSupabaseError(error)}`)
  return list.length
}

async function seedTenant(client, lodgeId) {
  const fixture = buildFixtureRows(lodgeId)
  let count = 0
  count += await upsertRows(client, 'settings', fixture.settings, 'lodge_id')
  count += await upsertRows(client, 'lodge_features', fixture.feature, 'lodge_id,feature_name')
  count += await upsertRows(client, 'outlets', fixture.outlets)
  count += await upsertRows(client, 'rooms', fixture.rooms)
  count += await upsertRows(client, 'inventory_items', fixture.inventoryItems)
  count += await upsertRows(client, 'pos_menu_items', fixture.menuItems)
  return count
}

async function callResetPreview(client, lodgeId, options) {
  const { data, error } = await client.rpc('get_test_data_reset_preview', {
    p_lodge_id: lodgeId,
    p_mode: options.mode,
    p_days: options.days
  })
  if (error) throw new Error(`Reset preview failed: ${safeSupabaseError(error)}`)
  if (!data || data.success === false) throw new Error(`Reset preview rejected: ${redactSecrets(data?.error || 'unknown server response')}`)
  return data
}

async function resetTenant(client, lodgeId, options) {
  const preview = await callResetPreview(client, lodgeId, options)
  console.log(JSON.stringify({ target: formatSafeTarget(options.target), preview }, null, 2))
  const { data, error } = await client.rpc('reset_test_data', {
    p_lodge_id: lodgeId,
    p_mode: options.mode,
    p_days: options.days,
    p_confirmation: requireResetConfirmation({ env: options.env, confirmed: options.confirmed }),
    p_reason: options.reason || 'Phase 0 integration test reset',
    p_triggered_by: null
  })
  if (error) throw new Error(`Reset failed: ${safeSupabaseError(error)}`)
  if (!data || data.success === false) throw new Error(`Reset rejected: ${redactSecrets(data?.error || 'unknown server response')}`)
  return data
}

async function run() {
  const options = parseArgs(process.argv.slice(2))
  if (options.command === 'help') {
    printUsage()
    return
  }
  if (!['seed', 'preview', 'reset'].includes(options.command)) {
    throw new Error(`Unknown command: ${options.command}`)
  }

  const env = loadTestEnv({ cwd: repoRoot, envFile: options.envFile })
  // No client is constructed until the fail-closed target guard passes.
  const target = assertDisposableTarget(env)
  options.target = target
  options.env = env
  // Service-role credentials are intentionally read from the process only.
  // A checked-in .env may provide the public URL/flag, but it must never carry
  // an admin key.
  const serviceRoleKey = requireServiceRoleKey(process.env)
  const client = createClient(target.url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  if (options.command === 'seed') {
    const count = await seedTenant(client, target.lodgeId)
    console.log(`Seeded ${count} deterministic fixture rows into ${formatSafeTarget(target)}.`)
    return
  }

  if (options.command === 'preview') {
    const preview = await callResetPreview(client, target.lodgeId, options)
    console.log(JSON.stringify({ target: formatSafeTarget(target), preview }, null, 2))
    return
  }

  const result = await resetTenant(client, target.lodgeId, options)
  console.log(JSON.stringify({ target: formatSafeTarget(target), reset: result }, null, 2))
}

run().catch((error) => {
  console.error(`Phase 0 test backend stopped safely: ${redactSecrets(error.message || error)}`)
  process.exitCode = 1
})

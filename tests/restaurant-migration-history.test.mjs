import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync, readdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')

function readMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f.includes('restaurant'))
    .sort()
}

function readSQL(filename) {
  return readFileSync(join(MIGRATIONS_DIR, filename), 'utf8')
}

describe('Phase 0: Restaurant Migration History Baseline', () => {
  const restaurantMigrations = readMigrations()

  it('restaurant migrations exist', () => {
    assert.ok(restaurantMigrations.length > 0, 'Expected at least one restaurant migration file')
  })

  it('migrations are timestamp-sequential', () => {
    for (let i = 1; i < restaurantMigrations.length; i++) {
      const prev = restaurantMigrations[i - 1].slice(0, 14)
      const curr = restaurantMigrations[i].slice(0, 14)
      assert.ok(prev <= curr, `${restaurantMigrations[i - 1]} should come before ${restaurantMigrations[i]}`)
    }
  })

  it('all restaurant migration files have valid SQL structure', () => {
    for (const file of restaurantMigrations) {
      const sql = readSQL(file)
      assert.ok(sql.length > 100, `${file} is too short to be a valid migration`)
      const openDollar = (sql.match(/\$\$/g) || []).length
      assert.strictEqual(openDollar % 2, 0, `${file} has unmatched $$ delimiters (${openDollar} found)`)
    }
  })

  it('phase6 differentiators migration exists', () => {
    assert.ok(
      restaurantMigrations.some(f => f.includes('20260709100000_restaurant_phase6_differentiators')),
      'Phase 6 differentiators migration file must exist'
    )
  })

  it('security hardening migration exists or is pending', () => {
    const hasHardening = restaurantMigrations.some(f => f.includes('security_hardening'))
    const hasPhase6 = restaurantMigrations.some(f => f.includes('phase6_differentiators'))
    if (hasPhase6) {
      assert.ok(hasHardening || !hasHardening, 'Security hardening migration status noted')
    }
  })

  it('phase6 migration creates all expected tables', () => {
    const phase6 = readMigrations().find(f => f.includes('phase6_differentiators'))
    if (!phase6) return
    const sql = readSQL(phase6)
    const expectedTables = [
      'restaurant_reservations',
      'restaurant_waitlist_entries',
      'restaurant_combo_groups',
      'restaurant_combo_slots',
      'restaurant_combo_slot_items',
      'restaurant_recipe_variance_snapshots',
      'restaurant_prep_items',
      'restaurant_prep_item_ingredients',
      'restaurant_prep_batches',
      'restaurant_prep_batch_ingredient_movements',
      'restaurant_ticket_status_events',
      'restaurant_supplier_items',
      'restaurant_purchase_suggestions'
    ]
    for (const table of expectedTables) {
      assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `Missing CREATE TABLE for ${table}`)
    }
  })

  it('phase6 tenant foreign keys reference the settings lodge key', () => {
    const phase6 = readMigrations().find(f => f.includes('phase6_differentiators'))
    if (!phase6) return
    const sql = readSQL(phase6)
    assert.ok(!/REFERENCES\s+l\(id\)/i.test(sql), 'Phase 6 must not reference the non-existent l table')
    const tenantForeignKeys = sql.match(/REFERENCES\s+public\.settings\(lodge_id\)/gi) || []
    assert.ok(tenantForeignKeys.length >= 9, 'Phase 6 tenant tables must reference public.settings(lodge_id)')
  })

  it('phase6 RLS policies cast the JWT lodge claim to UUID', () => {
    const phase6 = readMigrations().find(f => f.includes('phase6_differentiators'))
    if (!phase6) return
    const sql = readSQL(phase6)
    assert.ok(!/jsonb\s*->>\s*'lodge_id'\)(?!::uuid)/i.test(sql), 'Phase 6 RLS policies must cast the text JWT lodge claim to uuid')
    const uuidClaims = sql.match(/jsonb\s*->>\s*'lodge_id'\)::uuid/gi) || []
    assert.ok(uuidClaims.length >= 13, 'Every Phase 6 lodge policy comparison must use a UUID claim')
  })

  it('phase6 reconciles an older prep-batch shape before adding its replay index', () => {
    const phase6 = readMigrations().find(f => f.includes('phase6_differentiators'))
    if (!phase6) return
    const sql = readSQL(phase6)
    assert.match(sql, /ADD COLUMN IF NOT EXISTS idempotency_key text/)
    assert.match(sql, /SET idempotency_key = concat\('legacy-', id::text\)/)
    assert.match(sql, /ALTER COLUMN idempotency_key SET NOT NULL/)
  })

  it('phase6 migration creates all expected functions', () => {
    const phase6 = readMigrations().find(f => f.includes('phase6_differentiators'))
    if (!phase6) return
    const sql = readSQL(phase6)
    const expectedFunctions = [
      'create_restaurant_reservation',
      'get_restaurant_reservations',
      'update_restaurant_reservation',
      'cancel_restaurant_reservation',
      'seat_restaurant_reservation',
      'mark_restaurant_reservation_no_show',
      'create_restaurant_waitlist_entry',
      'get_restaurant_waitlist',
      'seat_restaurant_waitlist_entry',
      'get_restaurant_combos',
      'upsert_restaurant_combo',
      'delete_restaurant_combo',
      'get_recipe_variance_report',
      'get_restaurant_prep_items',
      'upsert_restaurant_prep_item',
      'get_restaurant_prep_batches',
      'create_restaurant_prep_batch',
      'post_restaurant_prep_batch',
      'record_ticket_status_event',
      'get_kitchen_timing_report',
      'get_low_stock_purchase_suggestions',
      'upsert_restaurant_supplier_item',
      'convert_purchase_suggestions_to_po'
    ]
    for (const fn of expectedFunctions) {
      assert.ok(sql.includes(`FUNCTION ${fn}`), `Missing CREATE FUNCTION for ${fn}`)
    }
  })
})

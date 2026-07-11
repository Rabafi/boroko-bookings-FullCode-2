import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function read(relPath) {
  return readFileSync(join(ROOT, relPath), 'utf8')
}

const HARDENING = 'supabase/migrations/20260710120000_restaurant_phase6_security_hardening.sql'
const PHASE6 = 'supabase/migrations/20260709100000_restaurant_phase6_differentiators.sql'

describe('Phase 2: Tenant-Safe Reservations and Cross-Lodge Isolation', () => {

  describe('2.1 app_require_restaurant_lodge enforces restaurant property type', () => {
    it('rejects non-restaurant property types', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('CREATE OR REPLACE FUNCTION public.app_require_restaurant_lodge')
      const fnBody = sql.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes("NOT IN ('restaurant', 'pos_only')"), 'checks property_type not in restaurant/pos_only')
      assert.ok(fnBody.includes('RAISE EXCEPTION'), 'raises exception on wrong type')
      assert.ok(fnBody.includes('restaurant-only'), 'meaningful error message')
    })

    it('reads property_type from settings table (not from payload)', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('CREATE OR REPLACE FUNCTION public.app_require_restaurant_lodge')
      const fnBody = sql.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('FROM public.settings'), 'reads from settings table')
      assert.ok(fnBody.includes('WHERE id = p_lodge_id'), 'matches by lodge_id')
    })

    it('fails closed when settings record is absent', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('CREATE OR REPLACE FUNCTION public.app_require_restaurant_lodge')
      const fnBody = sql.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('IS NULL'), 'null check')
      assert.ok(fnBody.includes("'Lodge settings not found for restaurant guard.'"), 'fails closed')
    })
  })

  describe('2.2 RLS policies enforce lodge isolation at table level', () => {
    const tables = [
      { name: 'restaurant_reservations', policy: 'restaurant_reservations_lodge_isolation' },
      { name: 'restaurant_waitlist_entries', policy: 'restaurant_waitlist_lodge_isolation' },
      { name: 'restaurant_combo_groups', policy: 'restaurant_combo_groups_lodge_isolation' },
      { name: 'restaurant_combo_slots', policy: 'restaurant_combo_slots_lodge_isolation' },
      { name: 'restaurant_combo_slot_items', policy: 'restaurant_combo_slot_items_lodge_isolation' },
      { name: 'restaurant_recipe_variance_snapshots', policy: 'restaurant_recipe_variance_lodge_isolation' },
      { name: 'restaurant_prep_items', policy: 'restaurant_prep_items_lodge_isolation' },
      { name: 'restaurant_prep_item_ingredients', policy: 'restaurant_prep_item_ingredients_lodge_isolation' },
      { name: 'restaurant_prep_batches', policy: 'restaurant_prep_batches_lodge_isolation' },
      { name: 'restaurant_prep_batch_ingredient_movements', policy: 'restaurant_prep_batch_movements_lodge_isolation' },
      { name: 'restaurant_ticket_status_events', policy: 'restaurant_ticket_events_lodge_isolation' },
      { name: 'restaurant_supplier_items', policy: 'restaurant_supplier_items_lodge_isolation' },
      { name: 'restaurant_purchase_suggestions', policy: 'restaurant_purchase_suggestions_lodge_isolation' }
    ]

    for (const { name, policy } of tables) {
      it(`${name} has RLS enabled`, () => {
        const sql = read(PHASE6)
        assert.ok(sql.includes(`ALTER TABLE ${name} ENABLE ROW LEVEL SECURITY`), `${name} has RLS`)
      })

      it(`${name} has lodge isolation policy`, () => {
        const sql = read(PHASE6)
        assert.ok(sql.includes(`"${policy}"`), `${name} has policy ${policy}`)
        assert.ok(sql.includes('request.jwt.claims'), `${name} policy uses JWT claims`)
      })
    }
  })

  describe('2.3 seat_restaurant_reservation validates table ownership and conflicts', () => {
    it('validates table belongs to lodge before seating', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.seat_restaurant_reservation')
      const fnBody = sql.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('restaurant_tables'), 'checks restaurant_tables')
      assert.ok(fnBody.includes('lodge_id = p_lodge_id'), 'validates table lodge ownership')
    })

    it('locks reservation row with FOR UPDATE to prevent race conditions', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.seat_restaurant_reservation')
      const fnBody = sql.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('FOR UPDATE'), 'row-level lock')
    })

    it('rejects seating on a table with existing active reservations', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.seat_restaurant_reservation')
      const fnBody = sql.slice(fnIdx, fnIdx + 2500)
      assert.ok(fnBody.includes('v_conflict_count'), 'counts conflicts')
      assert.ok(fnBody.includes("'seated'"), 'checks seated status')
      assert.ok(fnBody.includes("'confirmed'"), 'checks confirmed status')
      assert.ok(fnBody.includes('Table is already occupied'), 'meaningful rejection')
    })
  })

  describe('2.4 Prep batch validates all cross-entity relationships', () => {
    it('create_restaurant_prep_batch validates prep_item_id belongs to lodge', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.create_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 3000)
      assert.ok(fnBody.includes('v_prep_item_lodge'), 'checks prep item lodge')
      assert.ok(fnBody.includes('Prep item does not belong to this lodge'), 'cross-lodge rejection')
    })

    it('create_restaurant_prep_batch validates produced_inventory_item_id belongs to lodge', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.create_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 3000)
      assert.ok(fnBody.includes('v_produced_lodge'), 'checks produced item lodge')
      assert.ok(fnBody.includes('Produced inventory item does not belong to this lodge'), 'cross-lodge rejection')
    })

    it('post_restaurant_prep_batch validates ingredient lodge ownership', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.post_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 4000)
      assert.ok(fnBody.includes('item_lodge_id'), 'checks ingredient lodge')
      assert.ok(fnBody.includes('does not belong to this lodge'), 'cross-lodge rejection')
    })
  })

  describe('2.5 All mutating RPCs derive actor from session, not payload', () => {
    const actorFunctions = [
      { fn: 'create_restaurant_reservation', field: 'created_by', sessionVar: 'v_session.user_id' },
      { fn: 'update_restaurant_reservation', field: 'updated_by', sessionVar: 'v_session.user_id' },
      { fn: 'cancel_restaurant_reservation', field: 'updated_by', sessionVar: 'v_session.user_id' },
      { fn: 'seat_restaurant_reservation', field: 'updated_by', sessionVar: 'v_session.user_id' },
      { fn: 'mark_restaurant_reservation_no_show', field: 'updated_by', sessionVar: 'v_session.user_id' },
      { fn: 'create_restaurant_waitlist_entry', field: 'created_by', sessionVar: 'v_session.user_id' },
      { fn: 'create_restaurant_prep_batch', field: 'prepared_by', sessionVar: 'v_session.user_id' },
      { fn: 'post_restaurant_prep_batch', field: 'approved_by', sessionVar: 'v_session.user_id' },
      { fn: 'record_ticket_status_event', field: 'changed_by', sessionVar: 'v_session.user_id' }
    ]

    for (const { fn, field, sessionVar } of actorFunctions) {
      it(`${fn} derives ${field} from session (${sessionVar})`, () => {
        const sql = read(HARDENING)
        const fnIdx = sql.indexOf(`FUNCTION public.${fn}`)
        assert.ok(fnIdx > -1, `${fn} not found`)
        const fnBody = sql.slice(fnIdx, fnIdx + 4000)
        assert.ok(fnBody.includes('app_current_session_row'), 'loads session')
        assert.ok(fnBody.includes(sessionVar), `uses ${sessionVar} as actor`)
        assert.ok(!fnBody.includes(`'${field}' = (payload->>'${field}')::uuid`) &&
                   !fnBody.includes(`${field} = (payload->>'${field}')::uuid`),
          `does not accept ${field} from payload`)
      })
    }
  })

  describe('2.6 Every function is SECURITY DEFINER with hardened search_path', () => {
    const ALL_FUNCTIONS = [
      'app_require_restaurant_lodge',
      'create_restaurant_reservation', 'get_restaurant_reservations',
      'update_restaurant_reservation', 'cancel_restaurant_reservation',
      'seat_restaurant_reservation', 'mark_restaurant_reservation_no_show',
      'create_restaurant_waitlist_entry', 'get_restaurant_waitlist',
      'seat_restaurant_waitlist_entry', 'get_restaurant_combos',
      'upsert_restaurant_combo', 'delete_restaurant_combo',
      'get_recipe_variance_report', 'get_restaurant_prep_items',
      'upsert_restaurant_prep_item', 'get_restaurant_prep_batches',
      'create_restaurant_prep_batch', 'post_restaurant_prep_batch',
      'record_ticket_status_event', 'get_kitchen_timing_report',
      'get_low_stock_purchase_suggestions', 'upsert_restaurant_supplier_item',
      'convert_purchase_suggestions_to_po'
    ]

    for (const fn of ALL_FUNCTIONS) {
      it(`${fn} is SECURITY DEFINER`, () => {
        const sql = read(HARDENING)
        const fnIdx = sql.indexOf(`FUNCTION public.${fn}`)
        assert.ok(fnIdx > -1, `${fn} not found`)
        const chunk = sql.slice(fnIdx, fnIdx + 500)
        assert.ok(chunk.includes('SECURITY DEFINER'), `${fn} missing SECURITY DEFINER`)
      })

      it(`${fn} has SET search_path TO 'public'`, () => {
        const sql = read(HARDENING)
        const fnIdx = sql.indexOf(`FUNCTION public.${fn}`)
        assert.ok(fnIdx > -1, `${fn} not found`)
        const chunk = sql.slice(fnIdx, fnIdx + 500)
        assert.ok(chunk.includes("SET search_path TO 'public'"), `${fn} missing SET search_path`)
      })
    }
  })
})

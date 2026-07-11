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

describe('Phase 1: Restaurant RPC Security Hardening', () => {

  it('uses PL/pgSQL for guarded set-returning reader functions', () => {
    const sql = read(HARDENING)
    for (const fn of [
      'get_restaurant_reservations',
      'get_restaurant_waitlist',
      'get_restaurant_combos',
      'get_restaurant_prep_items',
      'get_restaurant_prep_batches'
    ]) {
      const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}`)
      const end = sql.indexOf('$$;', start)
      const body = sql.slice(start, end)
      assert.ok(body.includes('LANGUAGE plpgsql'), `${fn} must support PERFORM authorization guards`)
      assert.ok(body.includes('RETURN QUERY'), `${fn} must return its guarded query result`)
    }
  })

  describe('1.1 app_require_restaurant_lodge helper', () => {
    it('is defined in the corrective migration', () => {
      const sql = read(HARDENING)
      assert.ok(sql.includes('public.app_require_restaurant_lodge'), 'function defined')
    })

    it('uses SECURITY DEFINER and SET search_path', () => {
      const sql = read(HARDENING)
      const idx = sql.indexOf('CREATE OR REPLACE FUNCTION public.app_require_restaurant_lodge')
      assert.ok(idx > -1, 'CREATE OR REPLACE found')
      const chunk = sql.slice(idx, idx + 500)
      assert.ok(chunk.includes('SECURITY DEFINER'), 'has SECURITY DEFINER')
      assert.ok(chunk.includes("SET search_path TO 'public'"), 'has SET search_path')
    })

    it('calls app_is_service_role for service-role bypass', () => {
      const sql = read(HARDENING)
      const fnStart = sql.indexOf('app_require_restaurant_lodge')
      const fnBody = sql.slice(fnStart, fnStart + 2000)
      assert.ok(fnBody.includes('app_is_service_role'), 'bypasses for service role')
    })

    it('calls app_require_lodge_role internally', () => {
      const sql = read(HARDENING)
      const fnStart = sql.indexOf('app_require_restaurant_lodge')
      const fnBody = sql.slice(fnStart, fnStart + 2000)
      assert.ok(fnBody.includes('app_require_lodge_role'), 'delegates to lodge role check')
    })

    it('validates property_type from settings table', () => {
      const sql = read(HARDENING)
      const fnStart = sql.indexOf('app_require_restaurant_lodge')
      const fnBody = sql.slice(fnStart, fnStart + 2000)
      assert.ok(fnBody.includes('property_type'), 'checks property_type')
      assert.ok(fnBody.includes('settings'), 'reads from settings table')
      assert.ok(fnBody.includes("'restaurant'"), 'allows restaurant type')
      assert.ok(fnBody.includes("'pos_only'"), 'allows pos_only type')
    })

    it('fails closed when settings are absent', () => {
      const sql = read(HARDENING)
      const fnStart = sql.indexOf('app_require_restaurant_lodge')
      const fnBody = sql.slice(fnStart, fnStart + 2000)
      assert.ok(fnBody.includes('IS NULL'), 'null check for settings')
      assert.ok(fnBody.includes('RAISE EXCEPTION'), 'raises on missing settings')
    })

    it('is REVOKE/GRANT protected', () => {
      const sql = read(HARDENING)
      assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.app_require_restaurant_lodge'), 'REVOKE exists')
      assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.app_require_restaurant_lodge'), 'GRANT exists')
    })
  })

  describe('1.2 REVOKE ALL / GRANT EXECUTE on all 23 RPCs', () => {
    const ALL_FUNCTIONS = [
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

    for (const fn of ALL_FUNCTIONS) {
      it(`${fn} has REVOKE ALL`, () => {
        const sql = read(HARDENING)
        assert.ok(
          sql.includes(`REVOKE ALL ON FUNCTION public.${fn}`),
          `Missing REVOKE ALL for ${fn}`
        )
      })

      it(`${fn} has GRANT EXECUTE to authenticated, service_role`, () => {
        const sql = read(HARDENING)
        assert.ok(
          sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn}`) &&
          sql.includes('authenticated, service_role'),
          `Missing GRANT for ${fn}`
        )
      })
    }
  })

  describe('1.3 SET search_path on all 23 functions', () => {
    const ALL_FUNCTIONS = [
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

    for (const fn of ALL_FUNCTIONS) {
      it(`${fn} has SET search_path TO 'public'`, () => {
        const sql = read(HARDENING)
        const fnIdx = sql.indexOf(`FUNCTION public.${fn}`)
        assert.ok(fnIdx > -1, `Function ${fn} not found in hardening migration`)
        const chunk = sql.slice(fnIdx, fnIdx + 500)
        assert.ok(
          chunk.includes("SET search_path TO 'public'"),
          `${fn} missing SET search_path`
        )
      })
    }
  })

  describe('1.4 app_require_restaurant_lodge replaces app_require_lodge_role', () => {
    const ALL_FUNCTIONS = [
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

    for (const fn of ALL_FUNCTIONS) {
      it(`${fn} uses app_require_restaurant_lodge (not plain app_require_lodge_role)`, () => {
        const sql = read(HARDENING)
        const fnIdx = sql.indexOf(`FUNCTION public.${fn}`)
        assert.ok(fnIdx > -1, `Function ${fn} not found`)
        const fnBody = sql.slice(fnIdx, fnIdx + 2000)
        assert.ok(
          fnBody.includes('app_require_restaurant_lodge'),
          `${fn} must call app_require_restaurant_lodge`
        )
      })
    }
  })

  describe('1.5 Previously unprotected functions now have role checks', () => {
    const WAS_UNPROTECTED = [
      'get_restaurant_reservations',
      'get_restaurant_waitlist',
      'get_restaurant_combos',
      'get_recipe_variance_report',
      'get_restaurant_prep_items',
      'get_restaurant_prep_batches',
      'record_ticket_status_event',
      'get_kitchen_timing_report',
      'get_low_stock_purchase_suggestions'
    ]

    for (const fn of WAS_UNPROTECTED) {
      it(`${fn} now has role-based authorization`, () => {
        const sql = read(HARDENING)
        const fnIdx = sql.indexOf(`FUNCTION public.${fn}`)
        assert.ok(fnIdx > -1, `Function ${fn} not found in hardening`)
        const fnBody = sql.slice(fnIdx, fnIdx + 2000)
        assert.ok(
          fnBody.includes('app_require_restaurant_lodge'),
          `${fn} must call app_require_restaurant_lodge`
        )
      })
    }
  })

  describe('1.6 Actor fields derived from session', () => {
    it('create_restaurant_reservation derives created_by from session', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.create_restaurant_reservation')
      const fnBody = sql.slice(fnIdx, fnIdx + 2000)
      assert.ok(fnBody.includes('app_current_session_row'), 'loads session')
      assert.ok(fnBody.includes('v_session.user_id'), 'uses session user_id as actor')
    })

    it('create_restaurant_prep_batch derives prepared_by from session', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.create_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 3000)
      assert.ok(fnBody.includes('app_current_session_row'), 'loads session')
      assert.ok(fnBody.includes('v_session.user_id'), 'uses session user_id as actor')
    })

    it('post_restaurant_prep_batch derives approved_by from session', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.post_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 4000)
      assert.ok(fnBody.includes('app_current_session_row'), 'loads session')
      assert.ok(fnBody.includes('v_session.user_id'), 'uses session user_id as actor')
      assert.ok(!fnBody.includes('approved_by = p_lodge_id'), 'does not use p_lodge_id as actor')
    })

    it('record_ticket_status_event derives changed_by from session', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.record_ticket_status_event')
      const fnBody = sql.slice(fnIdx, fnIdx + 1500)
      assert.ok(fnBody.includes('app_current_session_row'), 'loads session')
      assert.ok(fnBody.includes('v_session.user_id'), 'uses session user_id as actor')
    })
  })

  describe('1.7 Table conflict locking in seat_restaurant_reservation', () => {
    it('locks reservation row with FOR UPDATE', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.seat_restaurant_reservation')
      const fnBody = sql.slice(fnIdx, fnIdx + 2000)
      assert.ok(fnBody.includes('FOR UPDATE'), 'locks reservation row')
    })

    it('validates table belongs to lodge', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.seat_restaurant_reservation')
      const fnBody = sql.slice(fnIdx, fnIdx + 2000)
      assert.ok(fnBody.includes('restaurant_tables'), 'checks restaurant_tables')
      assert.ok(fnBody.includes('Table does not belong to this lodge'), 'rejection message')
    })

    it('checks for overlapping seated reservations', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.seat_restaurant_reservation')
      const fnBody = sql.slice(fnIdx, fnIdx + 2000)
      assert.ok(fnBody.includes('conflict_count'), 'checks conflict count')
      assert.ok(fnBody.includes("'seated'"), 'checks seated status')
      assert.ok(fnBody.includes("'confirmed'"), 'checks confirmed status')
    })
  })

  describe('1.8 Prep batch validation improvements', () => {
    it('create_restaurant_prep_batch validates prep item belongs to lodge', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.create_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 3000)
      assert.ok(fnBody.includes('v_prep_item_lodge'), 'checks prep item lodge')
      assert.ok(fnBody.includes('Prep item does not belong to this lodge'), 'rejection message')
    })

    it('create_restaurant_prep_batch validates produced inventory item belongs to lodge', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.create_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 3000)
      assert.ok(fnBody.includes('v_produced_lodge'), 'checks produced item lodge')
      assert.ok(fnBody.includes('Produced inventory item does not belong to this lodge'), 'rejection message')
    })

    it('create_restaurant_prep_batch validates positive quantities', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.create_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 3000)
      assert.ok(fnBody.includes('planned_yield_quantity'), 'checks yield quantity')
      assert.ok(fnBody.includes('must be positive'), 'positive check')
    })

    it('post_restaurant_prep_batch locks batch with FOR UPDATE', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.post_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 4000)
      assert.ok(fnBody.includes('FOR UPDATE'), 'locks batch row')
    })

    it('post_restaurant_prep_batch validates ingredient lodge ownership', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.post_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 4000)
      assert.ok(fnBody.includes('item_lodge_id'), 'checks ingredient lodge')
      assert.ok(fnBody.includes('does not belong to this lodge'), 'rejection message')
    })

    it('post_restaurant_prep_batch checks insufficient stock', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.post_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 4000)
      assert.ok(fnBody.includes('Insufficient stock'), 'insufficient stock check')
    })

    it('post_restaurant_prep_batch is retry-safe for already-posted', () => {
      const sql = read(HARDENING)
      const fnIdx = sql.indexOf('FUNCTION public.post_restaurant_prep_batch')
      const fnBody = sql.slice(fnIdx, fnIdx + 4000)
      assert.ok(fnBody.includes("status = 'posted'"), 'checks posted status')
      assert.ok(fnBody.includes('already posted') || fnBody.includes('v_batch.status ='), 'retry-safe path')
    })
  })
})

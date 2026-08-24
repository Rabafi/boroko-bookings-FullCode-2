import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const legacyRoot = path.resolve(process.cwd());
const workspaceRoot = path.resolve(legacyRoot, '..');

for (const filePath of [
  path.join(workspaceRoot, '.env'),
  path.join(workspaceRoot, '.env.local'),
  path.join(legacyRoot, '.env'),
  path.join(legacyRoot, '.env.local')
]) {
  if (fs.existsSync(filePath)) dotenv.config({ path: filePath, override: false, quiet: true });
}

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_KEY;

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL and Supabase key.');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const tables = [
  'pos_orders',
  'pos_order_items',
  'pos_menu_items',
  'pos_prep_tickets',
  'pos_tables',
  'pos_tabs',
  'pos_shifts',
  'pos_cashup_sessions',
  'pos_modifier_groups',
  'pos_promotions',
  'pos_floor_layouts',
  'inventory_movements'
];

const rpcProbes = [
  ['get_active_pos_catalog_snapshot', {
    p_lodge_id: '00000000-0000-0000-0000-000000000000',
    p_outlet_id: null
  }],
  ['publish_pos_catalog_snapshot', {
    p_lodge_id: '00000000-0000-0000-0000-000000000000',
    p_outlet_id: null
  }],
  ['create_pos_order_v3', { payload: {} }],
  ['create_pos_return_v3', { payload: {} }],
  ['get_pos_shift_cashup_preview_v2', {
    p_shift_id: '00000000-0000-0000-0000-000000000000',
    p_lodge_id: '00000000-0000-0000-0000-000000000000'
  }],
  ['finalize_pos_shift_cashup_v2', { payload: {} }],
  ['approve_pos_void_with_pin', { payload: {} }],
  ['create_pos_menu_item', { payload: {} }],
  ['update_pos_menu_item', { p_id: '00000000-0000-0000-0000-000000000000', p_lodge_id: '00000000-0000-0000-0000-000000000000', payload: {} }],
  ['delete_pos_menu_item', { p_id: '00000000-0000-0000-0000-000000000000', p_lodge_id: '00000000-0000-0000-0000-000000000000' }],
  ['set_bar_pos_pack_template', { payload: {} }],
  ['upsert_pos_table', { payload: {} }],
  ['upsert_pos_tab', { payload: {} }],
  ['update_pos_tab_status', { p_tab_id: '00000000-0000-0000-0000-000000000000', p_status: 'closed', p_notes: null }],
  ['open_pos_shift', { p_lodge_id: '00000000-0000-0000-0000-000000000000', p_cashier_id: '00000000-0000-0000-0000-000000000000', p_cashier_name: 'probe', p_opening_float: 0, p_notes: null }],
  ['open_pos_shift_with_id', { payload: {} }],
  ['get_pos_shifts', { p_lodge_id: '00000000-0000-0000-0000-000000000000' }],
  ['update_pos_prep_ticket_status', { p_ticket_id: '00000000-0000-0000-0000-000000000000', p_status: 'ready', p_lodge_id: '00000000-0000-0000-0000-000000000000', p_operation_id: 'probe-ticket-status' }],
  ['upsert_pos_modifier_groups', { payload: {} }],
  ['upsert_pos_promotions', { payload: {} }],
  ['upsert_pos_floor_layout', { payload: {} }],
  ['update_booking_payment', {
    p_booking_id: '00000000-0000-0000-0000-000000000000',
    p_lodge_id: '00000000-0000-0000-0000-000000000000',
    p_amount: 0,
    p_method: 'cash',
    p_type: 'payment',
    p_idempotency_key: 'probe-only',
    p_recorded_by: null,
    p_expected_updated_at: null
  }]
];

let failed = false;

for (const table of tables) {
  const { error } = await supabase.from(table).select('id', { head: true, count: 'exact' }).limit(1);
  const ok = !error || error.code !== '42P01';
  console.log(`${ok ? 'OK' : 'MISSING'} table ${table}`);
  if (!ok) failed = true;
}

for (const [fn, args] of rpcProbes) {
  const { error } = await supabase.rpc(fn, args);
  const missing = error && (error.code === 'PGRST202' || /Could not find the function|not found/i.test(error.message || ''));
  console.log(`${missing ? 'MISSING' : 'OK'} rpc ${fn}${error && !missing ? ` (${error.code || 'validation'})` : ''}`);
  if (missing) failed = true;
}

process.exit(failed ? 1 : 0);

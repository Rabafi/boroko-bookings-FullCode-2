import test from 'node:test'
import assert from 'node:assert/strict'

test('multi-property migration has expected tables', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705135000_multi_property_foundation.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS property_groups'), 'property_groups table')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS property_group_members'), 'property_group_members table')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS property_group_settings'), 'property_group_settings table')
  assert.ok(sql.includes('property_groups ENABLE ROW LEVEL SECURITY'), 'RLS on property_groups')
  assert.ok(sql.includes('property_group_members ENABLE ROW LEVEL SECURITY'), 'RLS on property_group_members')
  assert.ok(sql.includes('property_group_settings ENABLE ROW LEVEL SECURITY'), 'RLS on property_group_settings')
})

test('multi-property migration has expected RPCs', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705135000_multi_property_foundation.sql', import.meta.url),
      'utf8'
    )
  )

  const expectedRPCs = [
    'create_property_group',
    'update_property_group',
    'delete_property_group',
    'add_property_to_group',
    'remove_property_from_group',
    'get_group_properties',
    'get_group_settings',
    'update_group_setting',
    'get_consolidated_dashboard',
    'get_consolidated_occupancy_report',
    'get_consolidated_financial_summary',
    'switch_active_property',
    'get_all_property_groups'
  ]

  for (const rpc of expectedRPCs) {
    assert.ok(sql.includes(`CREATE OR REPLACE FUNCTION ${rpc}`), `RPC ${rpc} exists`)
  }
})

test('consolidated dashboard returns key metrics', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705135000_multi_property_foundation.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('total_bookings'), 'total_bookings metric')
  assert.ok(sql.includes('total_revenue'), 'total_revenue metric')
  assert.ok(sql.includes('total_rooms'), 'total_rooms metric')
  assert.ok(sql.includes('occupancy_pct'), 'occupancy_pct metric')
  assert.ok(sql.includes('adr'), 'adr metric')
  assert.ok(sql.includes('revpar'), 'revpar metric')
})

test('consolidated occupancy report returns per-property breakdown', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705135000_multi_property_foundation.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('get_consolidated_occupancy_report'), 'occupancy report RPC')
  assert.ok(sql.includes('total_rooms'), 'total_rooms in occupancy')
  assert.ok(sql.includes('booked_rooms'), 'booked_rooms in occupancy')
  assert.ok(sql.includes('occupancy_pct'), 'occupancy_pct in occupancy')
})

test('consolidated financial summary returns revenue, expenses, profit', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705135000_multi_property_foundation.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('get_consolidated_financial_summary'), 'financial summary RPC')
  assert.ok(sql.includes('total_revenue'), 'total_revenue in financial')
  assert.ok(sql.includes('total_expenses'), 'total_expenses in financial')
  assert.ok(sql.includes('net_profit'), 'net_profit in financial')
})

test('property_group_members has UNIQUE constraint on group_id + lodge_id', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705135000_multi_property_foundation.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('UNIQUE(group_id, lodge_id)'), 'UNIQUE constraint exists')
})

test('property_group_settings has UNIQUE constraint on group_id + setting_key', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705135000_multi_property_foundation.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes('UNIQUE(group_id, setting_key)'), 'UNIQUE constraint on settings')
})

test('multi-property domain file exports all functions', async () => {
  const src = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../src/main/domains/multiProperty.js', import.meta.url),
      'utf8'
    )
  )

  const expectedExports = [
    'getAllPropertyGroups',
    'createPropertyGroup',
    'updatePropertyGroup',
    'deletePropertyGroup',
    'getGroupProperties',
    'addPropertyToGroup',
    'removePropertyFromGroup',
    'getGroupSettings',
    'updateGroupSettings',
    'getConsolidatedDashboard',
    'getConsolidatedOccupancyReport',
    'getConsolidatedFinancialSummary',
    'switchActiveProperty'
  ]

  for (const fn of expectedExports) {
    assert.ok(src.includes(`export async function ${fn}`) || src.includes(`export const ${fn}`),
      `exports ${fn}`)
  }
})

test('multi-property domain uses dedupePromise for getAll', async () => {
  const src = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../src/main/domains/multiProperty.js', import.meta.url),
      'utf8'
    )
  )

  assert.ok(src.includes('dedupePromise'), 'uses dedupePromise')
})

test('multi-property member roles are validated', async () => {
  const sql = await import('fs').then(fs =>
    fs.readFileSync(
      new URL('../supabase/migrations/20260705135000_multi_property_foundation.sql', import.meta.url),
      'utf8'
    )
  )

  assert.ok(sql.includes("CHECK (role_in_group IN ('member', 'head_office'))"), 'role check constraint')
})

test('access control has multi_property capabilities', async () => {
  const { CAPABILITY_LABELS } = await import('../src/shared/accessControl.js')

  assert.ok(CAPABILITY_LABELS['multi_property.manage'], 'multi_property.manage capability exists')
  assert.ok(CAPABILITY_LABELS['multi_property.switch'], 'multi_property.switch capability exists')
  assert.ok(CAPABILITY_LABELS['corporate_billing.manage'], 'corporate_billing.manage capability exists')
  assert.ok(CAPABILITY_LABELS['corporate_billing.charge'], 'corporate_billing.charge capability exists')
  assert.ok(CAPABILITY_LABELS['group_operations.manage'], 'group_operations.manage capability exists')
})

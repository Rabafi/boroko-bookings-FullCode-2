import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const migrationSQL = readFileSync(resolve(__dirname, '../supabase/migrations/20260705190000_yield_rules.sql'), 'utf8')
const rateCalendarJsSource = readFileSync(resolve(__dirname, '../src/main/domains/rateCalendar.js'), 'utf8')
const mainIndexSource = readFileSync(resolve(__dirname, '../src/main/index.js'), 'utf8')
const preloadSource = readFileSync(resolve(__dirname, '../src/preload/index.js'), 'utf8')

// ── Migration file existence ──────────────────────────────────────────────────

test('migration file exists and contains yield_rules', () => {
  assert.ok(migrationSQL.includes('yield_rules'), 'migration must contain yield_rules')
})

test('migration creates yield_rules table', () => {
  assert.ok(migrationSQL.includes('CREATE TABLE IF NOT EXISTS yield_rules'), 'yield_rules table must be created')
  assert.ok(migrationSQL.includes('rule_type'), 'yield_rules must have rule_type column')
  assert.ok(migrationSQL.includes('conditions'), 'yield_rules must have conditions JSONB column')
  assert.ok(migrationSQL.includes('action'), 'yield_rules must have action JSONB column')
  assert.ok(migrationSQL.includes('priority'), 'yield_rules must have priority column')
  assert.ok(migrationSQL.includes('active'), 'yield_rules must have active column')
  assert.ok(migrationSQL.includes('UNIQUE(lodge_id, name)'), 'yield_rules must have unique constraint on lodge_id and name')
})

test('migration creates yield_rule_exceptions table', () => {
  assert.ok(migrationSQL.includes('CREATE TABLE IF NOT EXISTS yield_rule_exceptions'), 'yield_rule_exceptions table must be created')
  assert.ok(migrationSQL.includes('yield_rule_id'), 'yield_rule_exceptions must reference yield_rules')
  assert.ok(migrationSQL.includes('override_multiplier'), 'yield_rule_exceptions must have override_multiplier column')
  assert.ok(migrationSQL.includes('UNIQUE(yield_rule_id, date)'), 'yield_rule_exceptions must have unique constraint on yield_rule_id and date')
})

test('migration creates occupancy_forecast_cache table', () => {
  assert.ok(migrationSQL.includes('CREATE TABLE IF NOT EXISTS occupancy_forecast_cache'), 'occupancy_forecast_cache table must be created')
  assert.ok(migrationSQL.includes('projected_occupancy_pct'), 'must have projected_occupancy_pct column')
  assert.ok(migrationSQL.includes('projected_revenue'), 'must have projected_revenue column')
  assert.ok(migrationSQL.includes('cached_at'), 'must have cached_at column')
})

// ── RPCs ──────────────────────────────────────────────────────────────────────

test('migration creates get_yield_rules RPC', () => {
  assert.ok(migrationSQL.includes('CREATE OR REPLACE FUNCTION get_yield_rules'), 'get_yield_rules RPC must exist')
})

test('migration creates create_yield_rule RPC', () => {
  assert.ok(migrationSQL.includes('CREATE OR REPLACE FUNCTION create_yield_rule'), 'create_yield_rule RPC must exist')
})

test('migration creates update_yield_rule RPC', () => {
  assert.ok(migrationSQL.includes('CREATE OR REPLACE FUNCTION update_yield_rule'), 'update_yield_rule RPC must exist')
})

test('migration creates delete_yield_rule RPC', () => {
  assert.ok(migrationSQL.includes('CREATE OR REPLACE FUNCTION delete_yield_rule'), 'delete_yield_rule RPC must exist')
})

test('migration creates get_applicable_yield_adjustment RPC', () => {
  assert.ok(migrationSQL.includes('CREATE OR REPLACE FUNCTION get_applicable_yield_adjustment'), 'get_applicable_yield_adjustment RPC must exist')
})

test('migration creates calculate_occupancy_based_rate RPC', () => {
  assert.ok(migrationSQL.includes('CREATE OR REPLACE FUNCTION calculate_occupancy_based_rate'), 'calculate_occupancy_based_rate RPC must exist')
})

test('migration creates get_occupancy_forecast RPC', () => {
  assert.ok(migrationSQL.includes('CREATE OR REPLACE FUNCTION get_occupancy_forecast'), 'get_occupancy_forecast RPC must exist')
})

// ── app_require_lodge_role pattern ────────────────────────────────────────────

test('all RPCs use app_require_lodge_role', () => {
  const rpcNames = [
    'get_yield_rules',
    'create_yield_rule',
    'update_yield_rule',
    'delete_yield_rule',
    'get_applicable_yield_adjustment',
    'calculate_occupancy_based_rate',
    'get_occupancy_forecast'
  ]
  for (const name of rpcNames) {
    const fnStart = migrationSQL.indexOf(`FUNCTION ${name}`)
    const fnEnd = migrationSQL.indexOf('$$;', fnStart + 100)
    const fnBlock = migrationSQL.slice(fnStart, fnEnd + 3)
    assert.ok(fnBlock.includes('app_require_lodge_role'), `${name} must use app_require_lodge_role`)
  }
})

test('mutation RPCs require manager/admin role', () => {
  const mutationRpcs = ['create_yield_rule', 'update_yield_rule', 'delete_yield_rule', 'calculate_occupancy_based_rate']
  for (const name of mutationRpcs) {
    const fnStart = migrationSQL.indexOf(`FUNCTION ${name}`)
    const fnEnd = migrationSQL.indexOf('$$;', fnStart + 100)
    const fnBlock = migrationSQL.slice(fnStart, fnEnd + 3)
    assert.ok(fnBlock.includes("'manager', 'admin'"), `${name} must require manager/admin role`)
  }
})

test('read RPCs allow receptionist role', () => {
  const readRpcs = ['get_yield_rules', 'get_applicable_yield_adjustment', 'get_occupancy_forecast']
  for (const name of readRpcs) {
    const fnStart = migrationSQL.indexOf(`FUNCTION ${name}`)
    const fnEnd = migrationSQL.indexOf('$$;', fnStart + 100)
    const fnBlock = migrationSQL.slice(fnStart, fnEnd + 3)
    assert.ok(fnBlock.includes('receptionist'), `${name} should allow receptionist role`)
  }
})

// ── RLS ───────────────────────────────────────────────────────────────────────

test('migration enables RLS on yield_rules', () => {
  assert.ok(migrationSQL.includes('ALTER TABLE yield_rules ENABLE ROW LEVEL SECURITY'), 'RLS must be enabled on yield_rules')
})

test('migration enables RLS on yield_rule_exceptions', () => {
  assert.ok(migrationSQL.includes('ALTER TABLE yield_rule_exceptions ENABLE ROW LEVEL SECURITY'), 'RLS must be enabled on yield_rule_exceptions')
})

test('migration enables RLS on occupancy_forecast_cache', () => {
  assert.ok(migrationSQL.includes('ALTER TABLE occupancy_forecast_cache ENABLE ROW LEVEL SECURITY'), 'RLS must be enabled on occupancy_forecast_cache')
})

// ── Grants ────────────────────────────────────────────────────────────────────

test('migration grants execute to authenticated on all RPCs', () => {
  const rpcNames = [
    'get_yield_rules(uuid)',
    'create_yield_rule(uuid, text, text, text, jsonb, jsonb, int)',
    'update_yield_rule(uuid, uuid, text, text, text, jsonb, jsonb, int, boolean)',
    'delete_yield_rule(uuid, uuid)',
    'get_applicable_yield_adjustment(uuid, date, numeric)',
    'calculate_occupancy_based_rate(uuid, numeric, date, uuid)',
    'get_occupancy_forecast(uuid, date, date)'
  ]
  for (const sig of rpcNames) {
    assert.ok(migrationSQL.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO authenticated`), `authenticated must have execute on ${sig}`)
    assert.ok(migrationSQL.includes(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role`), `service_role must have execute on ${sig}`)
  }
})

// ── Domain exports ────────────────────────────────────────────────────────────

test('rateCalendar domain exports getYieldRules', () => {
  assert.ok(rateCalendarJsSource.includes('export function getYieldRules'), 'getYieldRules must be exported')
})

test('rateCalendar domain exports createYieldRule', () => {
  assert.ok(rateCalendarJsSource.includes('export function createYieldRule'), 'createYieldRule must be exported')
})

test('rateCalendar domain exports updateYieldRule', () => {
  assert.ok(rateCalendarJsSource.includes('export function updateYieldRule'), 'updateYieldRule must be exported')
})

test('rateCalendar domain exports deleteYieldRule', () => {
  assert.ok(rateCalendarJsSource.includes('export function deleteYieldRule'), 'deleteYieldRule must be exported')
})

test('rateCalendar domain exports getApplicableYieldAdjustment', () => {
  assert.ok(rateCalendarJsSource.includes('export function getApplicableYieldAdjustment'), 'getApplicableYieldAdjustment must be exported')
})

test('rateCalendar domain exports calculateOccupancyBasedRate', () => {
  assert.ok(rateCalendarJsSource.includes('export function calculateOccupancyBasedRate'), 'calculateOccupancyBasedRate must be exported')
})

test('rateCalendar domain exports getOccupancyForecast', () => {
  assert.ok(rateCalendarJsSource.includes('export function getOccupancyForecast'), 'getOccupancyForecast must be exported')
})

test('yield rule functions call dedupePromise for reads', () => {
  assert.ok(rateCalendarJsSource.includes("dedupePromise('yieldRules'"), 'getYieldRules must use dedupePromise')
})

test('existing functions are preserved in rateCalendar', () => {
  assert.ok(rateCalendarJsSource.includes('export function getRateCalendar'), 'existing getRateCalendar must remain')
  assert.ok(rateCalendarJsSource.includes('export function getAllPromoCodes'), 'existing getAllPromoCodes must remain')
  assert.ok(rateCalendarJsSource.includes('export function getAllSeasonLabels'), 'existing getAllSeasonLabels must remain')
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

test('IPC handler for rateCalendar:getYieldRules exists', () => {
  assert.ok(mainIndexSource.includes("ipcMain.handle('rateCalendar:getYieldRules'"), 'getYieldRules IPC handler must exist')
})

test('IPC handler for rateCalendar:createYieldRule exists', () => {
  assert.ok(mainIndexSource.includes("ipcMain.handle('rateCalendar:createYieldRule'"), 'createYieldRule IPC handler must exist')
})

test('IPC handler for rateCalendar:updateYieldRule exists', () => {
  assert.ok(mainIndexSource.includes("ipcMain.handle('rateCalendar:updateYieldRule'"), 'updateYieldRule IPC handler must exist')
})

test('IPC handler for rateCalendar:deleteYieldRule exists', () => {
  assert.ok(mainIndexSource.includes("ipcMain.handle('rateCalendar:deleteYieldRule'"), 'deleteYieldRule IPC handler must exist')
})

test('IPC handler for rateCalendar:getApplicableYieldAdjustment exists', () => {
  assert.ok(mainIndexSource.includes("ipcMain.handle('rateCalendar:getApplicableYieldAdjustment'"), 'getApplicableYieldAdjustment IPC handler must exist')
})

test('IPC handler for rateCalendar:calculateOccupancyBasedRate exists', () => {
  assert.ok(mainIndexSource.includes("ipcMain.handle('rateCalendar:calculateOccupancyBasedRate'"), 'calculateOccupancyBasedRate IPC handler must exist')
})

test('IPC handler for rateCalendar:getOccupancyForecast exists', () => {
  assert.ok(mainIndexSource.includes("ipcMain.handle('rateCalendar:getOccupancyForecast'"), 'getOccupancyForecast IPC handler must exist')
})

test('getYieldRules IPC handler uses requireCapabilityOrDevEnterprisePreview advanced_rates.view', () => {
  const startIdx = mainIndexSource.indexOf("ipcMain.handle('rateCalendar:getYieldRules'")
  const endIdx = mainIndexSource.indexOf('})', startIdx)
  const block = mainIndexSource.slice(startIdx, endIdx)
  assert.ok(block.includes("requireCapabilityOrDevEnterprisePreview('advanced_rates.view')"), 'must use advanced_rates.view capability gate')
})

test('createYieldRule IPC handler uses requireCapability advanced_rates.manage', () => {
  const startIdx = mainIndexSource.indexOf("ipcMain.handle('rateCalendar:createYieldRule'")
  const endIdx = mainIndexSource.indexOf('})', startIdx)
  const block = mainIndexSource.slice(startIdx, endIdx)
  assert.ok(block.includes("requireCapability('advanced_rates.manage')"), 'must use advanced_rates.manage capability gate')
})

test('updateYieldRule IPC handler uses requireCapability advanced_rates.manage', () => {
  const startIdx = mainIndexSource.indexOf("ipcMain.handle('rateCalendar:updateYieldRule'")
  const endIdx = mainIndexSource.indexOf('})', startIdx)
  const block = mainIndexSource.slice(startIdx, endIdx)
  assert.ok(block.includes("requireCapability('advanced_rates.manage')"), 'must use advanced_rates.manage capability gate')
})

test('deleteYieldRule IPC handler uses requireCapability advanced_rates.manage', () => {
  const startIdx = mainIndexSource.indexOf("ipcMain.handle('rateCalendar:deleteYieldRule'")
  const endIdx = mainIndexSource.indexOf('})', startIdx)
  const block = mainIndexSource.slice(startIdx, endIdx)
  assert.ok(block.includes("requireCapability('advanced_rates.manage')"), 'must use advanced_rates.manage capability gate')
})

test('getApplicableYieldAdjustment IPC handler uses requireCapabilityOrDevEnterprisePreview advanced_rates.view', () => {
  const startIdx = mainIndexSource.indexOf("ipcMain.handle('rateCalendar:getApplicableYieldAdjustment'")
  const endIdx = mainIndexSource.indexOf('})', startIdx)
  const block = mainIndexSource.slice(startIdx, endIdx)
  assert.ok(block.includes("requireCapabilityOrDevEnterprisePreview('advanced_rates.view')"), 'must use advanced_rates.view capability gate')
})

test('calculateOccupancyBasedRate IPC handler uses requireCapability advanced_rates.manage', () => {
  const startIdx = mainIndexSource.indexOf("ipcMain.handle('rateCalendar:calculateOccupancyBasedRate'")
  const endIdx = mainIndexSource.indexOf('})', startIdx)
  const block = mainIndexSource.slice(startIdx, endIdx)
  assert.ok(block.includes("requireCapability('advanced_rates.manage')"), 'must use advanced_rates.manage capability gate')
})

test('getOccupancyForecast IPC handler uses requireCapabilityOrDevEnterprisePreview advanced_rates.view', () => {
  const startIdx = mainIndexSource.indexOf("ipcMain.handle('rateCalendar:getOccupancyForecast'")
  const endIdx = mainIndexSource.indexOf('})', startIdx)
  const block = mainIndexSource.slice(startIdx, endIdx)
  assert.ok(block.includes("requireCapabilityOrDevEnterprisePreview('advanced_rates.view')"), 'must use advanced_rates.view capability gate')
})

// ── Preload ───────────────────────────────────────────────────────────────────

test('preload includes getYieldRules in rateCalendar section', () => {
  assert.ok(preloadSource.includes('getYieldRules'), 'preload must expose getYieldRules')
})

test('preload includes createYieldRule in rateCalendar section', () => {
  assert.ok(preloadSource.includes('createYieldRule'), 'preload must expose createYieldRule')
})

test('preload includes updateYieldRule in rateCalendar section', () => {
  assert.ok(preloadSource.includes('updateYieldRule'), 'preload must expose updateYieldRule')
})

test('preload includes deleteYieldRule in rateCalendar section', () => {
  assert.ok(preloadSource.includes('deleteYieldRule'), 'preload must expose deleteYieldRule')
})

test('preload includes getApplicableYieldAdjustment in rateCalendar section', () => {
  assert.ok(preloadSource.includes('getApplicableYieldAdjustment'), 'preload must expose getApplicableYieldAdjustment')
})

test('preload includes calculateOccupancyBasedRate in rateCalendar section', () => {
  assert.ok(preloadSource.includes('calculateOccupancyBasedRate'), 'preload must expose calculateOccupancyBasedRate')
})

test('preload includes getOccupancyForecast in rateCalendar section', () => {
  assert.ok(preloadSource.includes('getOccupancyForecast'), 'preload must expose getOccupancyForecast')
})

test('preload rateCalendar section bridges to correct IPC channels', () => {
  assert.ok(preloadSource.includes("ipcRenderer.invoke('rateCalendar:getYieldRules'"), 'getYieldRules must bridge to rateCalendar:getYieldRules')
  assert.ok(preloadSource.includes("ipcRenderer.invoke('rateCalendar:createYieldRule'"), 'createYieldRule must bridge to rateCalendar:createYieldRule')
  assert.ok(preloadSource.includes("ipcRenderer.invoke('rateCalendar:updateYieldRule'"), 'updateYieldRule must bridge to rateCalendar:updateYieldRule')
  assert.ok(preloadSource.includes("ipcRenderer.invoke('rateCalendar:deleteYieldRule'"), 'deleteYieldRule must bridge to rateCalendar:deleteYieldRule')
  assert.ok(preloadSource.includes("ipcRenderer.invoke('rateCalendar:getApplicableYieldAdjustment'"), 'getApplicableYieldAdjustment must bridge to rateCalendar:getApplicableYieldAdjustment')
  assert.ok(preloadSource.includes("ipcRenderer.invoke('rateCalendar:calculateOccupancyBasedRate'"), 'calculateOccupancyBasedRate must bridge to rateCalendar:calculateOccupancyBasedRate')
  assert.ok(preloadSource.includes("ipcRenderer.invoke('rateCalendar:getOccupancyForecast'"), 'getOccupancyForecast must bridge to rateCalendar:getOccupancyForecast')
})

// ── DEV_ENTERPRISE_PREVIEW_CAPABILITIES ───────────────────────────────────────

test('advanced_rates.view is in DEV_ENTERPRISE_PREVIEW_CAPABILITIES', () => {
  assert.ok(mainIndexSource.includes("'advanced_rates.view'"), 'advanced_rates.view must be in the preview allow-list')
})

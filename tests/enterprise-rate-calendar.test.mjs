import test from 'node:test'
import assert from 'node:assert/strict'

const MODULE_KEYS = ['rate_calendar', 'rate_plans', 'advanced_rates']
const ADDON_KEYS = ['rate_plans', 'advanced_rates']

test('Rate calendar module key exists in module catalog', async () => {
  const { getModuleByKey } = await import('../src/shared/moduleCatalog.js')
  const module = getModuleByKey('rate_calendar')
  assert.ok(module, 'rate_calendar module should exist in catalog')
  assert.equal(module.requiredPlan, 'Enterprise')
  assert.equal(module.isAddon, true)
  assert.equal(module.addonKey, 'advanced_rates')
  assert.ok(module.capabilities.includes('rate_calendar.view'))
  assert.ok(module.capabilities.includes('rate_calendar.manage'))
  assert.ok(module.routes.includes('/rate-calendar'))
})

test('Rate calendar capabilities exist in access control', async () => {
  const { ALL_CAPABILITIES, CAPABILITY_LABELS } = await import('../src/shared/accessControl.js')
  assert.ok(ALL_CAPABILITIES.includes('rate_calendar.manage'), 'rate_calendar.manage should be in ALL_CAPABILITIES')
  assert.ok(CAPABILITY_LABELS['rate_calendar.manage'], 'rate_calendar.manage should have a label')
  assert.ok(ALL_CAPABILITIES.includes('promo_codes.manage'), 'promo_codes.manage should be in ALL_CAPABILITIES')
})

test('Promo codes capability exists in access control', async () => {
  const { ALL_CAPABILITIES } = await import('../src/shared/accessControl.js')
  assert.ok(ALL_CAPABILITIES.includes('promo_codes.manage'))
})

test('Rate calendar module visibility resolves correctly for hotel Enterprise', async () => {
  const { resolveModuleVisibility, MODULE_VISIBILITY_STATES } = await import('../src/shared/moduleCatalog.js')
  assert.equal(resolveModuleVisibility('rate_calendar', 'hotel', 'Enterprise', ['advanced_rates']), MODULE_VISIBILITY_STATES.visible)
  assert.equal(resolveModuleVisibility('rate_calendar', 'hotel', 'Enterprise', []), MODULE_VISIBILITY_STATES.hidden)
  assert.equal(resolveModuleVisibility('rate_calendar', 'lodge', 'Enterprise', ['advanced_rates']), MODULE_VISIBILITY_STATES.hidden)
})

test('Rate calendar module route is /rate-calendar', async () => {
  const { getModuleByKey } = await import('../src/shared/moduleCatalog.js')
  const module = getModuleByKey('rate_calendar')
  assert.ok(module.routes.includes('/rate-calendar'))
})

test('Advanced rates addon includes rate_calendar moduleKey', async () => {
  const { getEnterpriseAddonByKey } = await import('../src/shared/enterpriseAddons.js')
  const addon = getEnterpriseAddonByKey('advanced_rates')
  assert.ok(addon, 'advanced_rates addon should exist')
  assert.ok(addon.moduleKeys.includes('rate_calendar'), 'advanced_rates addon should include rate_calendar moduleKey')
  assert.ok(addon.moduleKeys.includes('advanced_rates'))
})

test('Rate plans module has rate-plans route', async () => {
  const { getModuleByKey } = await import('../src/shared/moduleCatalog.js')
  const module = getModuleByKey('rate_plans')
  assert.ok(module.routes.includes('/rate-plans'))
})

test('Rate calendar domain exports all required functions', { concurrency: false }, async (t) => {
  try {
    const domain = await import('../src/main/domains/rateCalendar.js')
    assert.equal(typeof domain.getRateCalendar, 'function')
    assert.equal(typeof domain.setRateCalendarEntry, 'function')
    assert.equal(typeof domain.setRateCalendarBulk, 'function')
    assert.equal(typeof domain.setRateRestriction, 'function')
    assert.equal(typeof domain.getRateConflicts, 'function')
    assert.equal(typeof domain.getApplicableRate, 'function')
    assert.equal(typeof domain.getAllPromoCodes, 'function')
    assert.equal(typeof domain.createPromoCode, 'function')
    assert.equal(typeof domain.updatePromoCode, 'function')
    assert.equal(typeof domain.deletePromoCode, 'function')
    assert.equal(typeof domain.validatePromoCode, 'function')
    assert.equal(typeof domain.getAllSeasonLabels, 'function')
    assert.equal(typeof domain.createSeasonLabel, 'function')
    assert.equal(typeof domain.updateSeasonLabel, 'function')
    assert.equal(typeof domain.deleteSeasonLabel, 'function')
  } catch (err) {
    if (err.message?.includes('electron')) {
      t.diagnostic(`Skipping: ${err.message}`)
      return
    }
    throw err
  }
})

test('Rate calendar domain functions return promises via dedupePromise', { concurrency: false }, async (t) => {
  try {
    const domain = await import('../src/main/domains/rateCalendar.js')
    const result = domain.getAllPromoCodes()
    assert.ok(result instanceof Promise || result?.then, 'dedupePromise-wrapped functions should return thenable')
  } catch (err) {
    if (err.message?.includes('electron')) {
      t.diagnostic(`Skipping: ${err.message}`)
      return
    }
    throw err
  }
})

test('Revenue manager domain exports all required functions', { concurrency: false }, async (t) => {
  try {
    const domain = await import('../src/main/domains/revenueManager.js')
    assert.equal(typeof domain.getRevenueForecast, 'function')
    assert.equal(typeof domain.upsertForecastEntry, 'function')
    assert.equal(typeof domain.getCompetitorNotes, 'function')
    assert.equal(typeof domain.createCompetitorNote, 'function')
    assert.equal(typeof domain.getDemandEvents, 'function')
    assert.equal(typeof domain.createDemandEvent, 'function')
    assert.equal(typeof domain.getRevenueRecommendations, 'function')
  } catch (err) {
    if (err.message?.includes('electron')) {
      t.diagnostic(`Skipping: ${err.message}`)
      return
    }
    throw err
  }
})

test('SQL migration file exists for rate calendar advanced', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('./supabase/migrations')
  assert.ok(files.some(f => f.includes('20260705110000_rate_calendar_advanced')), 'Rate calendar migration file should exist')
})

test('SQL migration file exists for revenue manager', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('./supabase/migrations')
  assert.ok(files.some(f => f.includes('20260705130500_revenue_manager_addon')), 'Revenue manager migration file should exist')
})

test('Rate calendar migration has all required tables', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705110000_rate_calendar_advanced.sql', 'utf8')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS rate_calendar_entries'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS rate_restrictions'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS promo_codes'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS season_labels'))
})

test('Rate calendar migration has all required RPCs', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705110000_rate_calendar_advanced.sql', 'utf8')
  const rpcs = [
    'set_rate_calendar_entry', 'set_rate_calendar_bulk', 'get_rate_calendar',
    'set_rate_restriction', 'get_applicable_rate', 'get_rate_conflicts',
    'create_promo_code', 'update_promo_code', 'delete_promo_code', 'validate_promo_code',
    'create_season_label', 'update_season_label', 'delete_season_label'
  ]
  for (const rpc of rpcs) {
    assert.ok(sql.includes(rpc), `Migration should contain ${rpc}`)
  }
})

test('Rate calendar migration uses app_require_lodge_role pattern', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705110000_rate_calendar_advanced.sql', 'utf8')
  const count = (sql.match(/app_require_lodge_role/g) || []).length
  assert.ok(count >= 13, `Expected at least 13 app_require_lodge_role calls, got ${count}`)
})

test('Rate calendar migration enables RLS on all tables', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705110000_rate_calendar_advanced.sql', 'utf8')
  assert.ok(sql.includes('ALTER TABLE rate_calendar_entries ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE rate_restrictions ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE season_labels ENABLE ROW LEVEL SECURITY'))
})

test('Rate calendar migration grants execute on all RPCs', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705110000_rate_calendar_advanced.sql', 'utf8')
  const grantCount = (sql.match(/GRANT EXECUTE ON FUNCTION/g) || []).length
  assert.ok(grantCount >= 13, `Expected at least 13 GRANT EXECUTE statements, got ${grantCount}`)
})

test('Revenue manager migration has all required tables', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705130500_revenue_manager_addon.sql', 'utf8')
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS revenue_forecast_entries'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS competitor_notes'))
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS demand_events'))
})

test('Revenue manager migration has all required RPCs', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705130500_revenue_manager_addon.sql', 'utf8')
  const rpcs = [
    'get_revenue_forecast', 'upsert_forecast_entry',
    'get_competitor_notes', 'create_competitor_note',
    'get_demand_events', 'create_demand_event',
    'get_revenue_recommendations'
  ]
  for (const rpc of rpcs) {
    assert.ok(sql.includes(rpc), `Migration should contain ${rpc}`)
  }
})

test('Revenue manager migration enables RLS on all tables', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705130500_revenue_manager_addon.sql', 'utf8')
  assert.ok(sql.includes('ALTER TABLE revenue_forecast_entries ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE competitor_notes ENABLE ROW LEVEL SECURITY'))
  assert.ok(sql.includes('ALTER TABLE demand_events ENABLE ROW LEVEL SECURITY'))
})

test('Preload exposes rateCalendar API', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/preload/index.js', 'utf8')
  assert.ok(content.includes('rateCalendar:'), 'preload should expose rateCalendar API')
  assert.ok(content.includes('promoCodes:'), 'preload should expose promoCodes API')
  assert.ok(content.includes('seasonLabels:'), 'preload should expose seasonLabels API')
  assert.ok(content.includes('revenueManager:'), 'preload should expose revenueManager API')
  assert.ok(content.includes('advancedReports:'), 'preload should expose advancedReports API')
})

test('Preload rateCalendar has expected methods', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/preload/index.js', 'utf8')
  const methods = ['get', 'setEntry', 'setBulk', 'setRestriction', 'getConflicts', 'getApplicableRate']
  for (const method of methods) {
    assert.ok(content.includes(`rateCalendar:${method}`) || content.includes(`${method}:`), `rateCalendar should have ${method} method`)
  }
})

test('Preload promoCodes has expected methods', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/preload/index.js', 'utf8')
  const methods = ['getAll', 'create', 'update', 'delete', 'validate']
  for (const method of methods) {
    assert.ok(content.includes(`promoCodes:${method}`), `promoCodes should have ${method} method`)
  }
})

test('Preload advancedReports has all report methods', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/preload/index.js', 'utf8')
  const methods = ['getOccupancy', 'getPace', 'getPickup', 'getChannelSource', 'getDebtorAging',
    'getRatePerformance', 'getHousekeepingProductivity', 'getRoomDowntime',
    'getGroupPickup', 'getCancellationNoShow', 'getTaxVat', 'getDepositLiability', 'getFolioExceptions']
  for (const method of methods) {
    assert.ok(content.includes(`advancedReports:${method}`), `advancedReports should have ${method} method`)
  }
})

test('Database facade re-exports rateCalendar domain functions', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/database.js', 'utf8')
  assert.ok(content.includes('getRateCalendar'))
  assert.ok(content.includes('setRateCalendarEntry'))
  assert.ok(content.includes('getAllPromoCodes'))
  assert.ok(content.includes('getAllSeasonLabels'))
  assert.ok(content.includes('getRevenueForecast'))
  assert.ok(content.includes('getOccupancy'))
  assert.ok(content.includes('getPace'))
})

test('IPC handlers exist for rateCalendar', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/index.js', 'utf8')
  const handlers = [
    'rateCalendar:get', 'rateCalendar:setEntry', 'rateCalendar:setBulk',
    'rateCalendar:setRestriction', 'rateCalendar:getConflicts', 'rateCalendar:getApplicableRate',
    'promoCodes:getAll', 'promoCodes:create', 'promoCodes:update', 'promoCodes:delete', 'promoCodes:validate',
    'seasonLabels:getAll', 'seasonLabels:create', 'seasonLabels:update', 'seasonLabels:delete',
    'revenueManager:getForecast', 'revenueManager:upsertForecast',
    'revenueManager:getCompetitorNotes', 'revenueManager:createCompetitorNote',
    'revenueManager:getDemandEvents', 'revenueManager:createDemandEvent',
    'revenueManager:getRecommendations'
  ]
  for (const handler of handlers) {
    assert.ok(content.includes(`ipcMain.handle('${handler}'`), `IPC handler for ${handler} should exist`)
  }
})

test('IPC handlers exist for advancedReports', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/index.js', 'utf8')
  const handlers = [
    'advancedReports:getOccupancy', 'advancedReports:getPace', 'advancedReports:getPickup',
    'advancedReports:getChannelSource', 'advancedReports:getDebtorAging',
    'advancedReports:getRatePerformance', 'advancedReports:getHousekeepingProductivity',
    'advancedReports:getRoomDowntime', 'advancedReports:getGroupPickup',
    'advancedReports:getCancellationNoShow', 'advancedReports:getTaxVat',
    'advancedReports:getDepositLiability', 'advancedReports:getFolioExceptions'
  ]
  for (const handler of handlers) {
    assert.ok(content.includes(`ipcMain.handle('${handler}'`), `IPC handler for ${handler} should exist`)
  }
})

test('React RateCalendar component file exists', async () => {
  const fs = await import('fs')
  assert.ok(fs.existsSync('./src/renderer/src/components/RateCalendar.jsx'), 'RateCalendar.jsx should exist')
})

test('React PromoCodes component file exists', async () => {
  const fs = await import('fs')
  assert.ok(fs.existsSync('./src/renderer/src/components/PromoCodes.jsx'), 'PromoCodes.jsx should exist')
})

test('RateCalendar component uses window.api.rateCalendar', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/renderer/src/components/RateCalendar.jsx', 'utf8')
  assert.ok(content.includes('window.api.rateCalendar.get'), 'RateCalendar should use window.api.rateCalendar')
  assert.ok(content.includes('window.api.seasonLabels'), 'RateCalendar should use window.api.seasonLabels')
  assert.ok(content.includes('window.api.promoCodes'), 'RateCalendar should use window.api.promoCodes')
})

test('PromoCodes component uses window.api.promoCodes', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/renderer/src/components/PromoCodes.jsx', 'utf8')
  assert.ok(content.includes('window.api.promoCodes'), 'PromoCodes should use window.api.promoCodes')
})

test('Component file exports default React function', async () => {
  const fs = await import('fs')
  const rc = fs.readFileSync('./src/renderer/src/components/RateCalendar.jsx', 'utf8')
  assert.ok(rc.includes('export default function RateCalendar'), 'RateCalendar should export default function')
  const pc = fs.readFileSync('./src/renderer/src/components/PromoCodes.jsx', 'utf8')
  assert.ok(pc.includes('export default function PromoCodes'), 'PromoCodes should export default function')
})

test('All enterprise rate files are created', async () => {
  const fs = await import('fs')
  const files = [
    './src/main/domains/rateCalendar.js',
    './src/main/domains/revenueManager.js',
    './src/main/domains/advancedReports.js',
    './supabase/migrations/20260705110000_rate_calendar_advanced.sql',
    './supabase/migrations/20260705130500_revenue_manager_addon.sql',
    './src/renderer/src/components/RateCalendar.jsx',
    './src/renderer/src/components/PromoCodes.jsx'
  ]
  for (const file of files) {
    assert.ok(fs.existsSync(file), `${file} should exist`)
  }
})

test('Reactor component files follow existing patterns (uses lucide-react, Modal, useSettings)', async () => {
  const fs = await import('fs')
  const rc = fs.readFileSync('./src/renderer/src/components/RateCalendar.jsx', 'utf8')
  assert.ok(rc.includes('lucide-react'), 'RateCalendar should import from lucide-react')
  assert.ok(rc.includes('./shared/Modal'), 'RateCalendar should import Modal')
  assert.ok(rc.includes('useSettings'), 'RateCalendar should use useSettings')
  const pc = fs.readFileSync('./src/renderer/src/components/PromoCodes.jsx', 'utf8')
  assert.ok(pc.includes('lucide-react'), 'PromoCodes should import from lucide-react')
  assert.ok(pc.includes('./shared/Modal'), 'PromoCodes should import Modal')
})

test('get_applicable_rate RPC returns override priority correctly', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705110000_rate_calendar_advanced.sql', 'utf8')
  assert.ok(sql.includes(`v_source := 'override'`), 'get_applicable_rate should check override first')
  assert.ok(sql.includes(`v_source := 'calendar'`), 'get_applicable_rate should check calendar entries second')
  assert.ok(sql.includes(`v_source := 'rate_plan'`), 'get_applicable_rate should fall back to rate_plans')
})

test('set_rate_calendar_entry upserts with is_override = true', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705110000_rate_calendar_advanced.sql', 'utf8')
  assert.ok(sql.includes('is_override = true'), 'set_rate_calendar_entry should set is_override = true')
  assert.ok(sql.includes('ON CONFLICT'), 'set_rate_calendar_entry should upsert')
})

test('validate_promo_code checks usage limit, validity dates, and room types', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705110000_rate_calendar_advanced.sql', 'utf8')
  assert.ok(sql.includes('usage_count < usage_limit'))
  assert.ok(sql.includes('applies_to_room_types'))
  assert.ok(sql.includes('min_nights'))
})


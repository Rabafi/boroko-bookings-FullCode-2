import test from 'node:test'
import assert from 'node:assert/strict'

const MIGRATION_FILE = '20260705200000_advanced_booking_engine.sql'
const DOMAIN_FILE = 'src/main/domains/bookingEngine.js'

test('Advanced Booking Engine migration file exists', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('./supabase/migrations')
  assert.ok(files.some(f => f.includes(MIGRATION_FILE)), 'Migration file should exist')
})

test('Advanced Booking Engine migration has all required tables', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync(`./supabase/migrations/${MIGRATION_FILE}`, 'utf8')
  assert.ok(sql.includes('create table if not exists public.booking_engine_rules'), 'booking_engine_rules table must be created')
  assert.ok(sql.includes('create table if not exists public.booking_engine_upsells'), 'booking_engine_upsells table must be created')
})

test('Advanced Booking Engine migration has all required RPCs', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync(`./supabase/migrations/${MIGRATION_FILE}`, 'utf8')
  const rpcs = [
    'calculate_booking_price',
    'check_availability_advanced',
    'get_booking_upsells',
    'create_booking_intent',
    'get_booking_engine_rules',
    'create_booking_engine_rule',
    'update_booking_engine_rule',
    'delete_booking_engine_rule',
    'get_booking_upsells_list',
    'create_booking_upsell',
    'update_booking_upsell',
    'delete_booking_upsell'
  ]
  for (const rpc of rpcs) {
    assert.ok(sql.includes(rpc), `Migration should contain ${rpc}`)
  }
})

test('Advanced Booking Engine migration uses app_require_lodge_role pattern', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync(`./supabase/migrations/${MIGRATION_FILE}`, 'utf8')
  const count = (sql.match(/app_require_lodge_role/g) || []).length
  assert.ok(count >= 11, `Expected at least 11 app_require_lodge_role calls, got ${count}`)
})

test('Advanced Booking Engine migration enables RLS on all tables', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync(`./supabase/migrations/${MIGRATION_FILE}`, 'utf8')
  assert.ok(sql.includes('alter table public.booking_engine_rules enable row level security'))
  assert.ok(sql.includes('alter table public.booking_engine_upsells enable row level security'))
})

test('Advanced Booking Engine migration grants execute on all RPCs', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync(`./supabase/migrations/${MIGRATION_FILE}`, 'utf8')
  const grantCount = (sql.match(/grant execute on function/gi) || []).length
  assert.ok(grantCount >= 12, `Expected at least 12 GRANT EXECUTE statements, got ${grantCount}`)
})

test('Advanced Booking Engine migration uses SECURITY DEFINER on all RPCs', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync(`./supabase/migrations/${MIGRATION_FILE}`, 'utf8')
  const securityDefinerCount = (sql.match(/security definer/g) || []).length
  assert.ok(securityDefinerCount >= 12, `Expected at least 12 SECURITY DEFINER declarations, got ${securityDefinerCount}`)
})

test('Advanced Booking Engine migration has valid rule_type check constraint', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync(`./supabase/migrations/${MIGRATION_FILE}`, 'utf8')
  assert.ok(sql.includes("rule_type in ('availability', 'pricing', 'restriction', 'upsell')"))
})

test('Advanced Booking Engine migration has valid upsell_type check constraint', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync(`./supabase/migrations/${MIGRATION_FILE}`, 'utf8')
  assert.ok(sql.includes("upsell_type in ('room_upgrade', 'addon_service', 'package')"))
})

test('Advanced Booking Engine module key exists in module catalog', async () => {
  const { getModuleByKey } = await import('../src/shared/moduleCatalog.js')
  const mod = getModuleByKey('advanced_booking_engine')
  assert.ok(mod, 'advanced_booking_engine module should exist in catalog')
  assert.equal(mod.requiredPlan, 'Enterprise')
  assert.equal(mod.isAddon, true)
  assert.equal(mod.addonKey, 'advanced_booking_engine')
  assert.ok(mod.capabilities.includes('advanced_booking_engine.view'))
  assert.ok(mod.capabilities.includes('advanced_booking_engine.manage'))
  assert.ok(mod.routes.includes('/booking-engine'))
  assert.equal(mod.visibility, 'hotel_only')
  assert.equal(mod.rolloutStatus, 'planned')
})

test('Advanced Booking Engine module visibility resolves correctly', async () => {
  const { resolveModuleVisibility, MODULE_VISIBILITY_STATES } = await import('../src/shared/moduleCatalog.js')
  assert.equal(resolveModuleVisibility('advanced_booking_engine', 'hotel', 'Enterprise', ['advanced_booking_engine']), MODULE_VISIBILITY_STATES.visible)
  assert.equal(resolveModuleVisibility('advanced_booking_engine', 'hotel', 'Enterprise', []), MODULE_VISIBILITY_STATES.hidden)
  assert.equal(resolveModuleVisibility('advanced_booking_engine', 'lodge', 'Enterprise', ['advanced_booking_engine']), MODULE_VISIBILITY_STATES.hidden)
})

test('Advanced Booking Engine capabilities exist in access control', async () => {
  const { ALL_CAPABILITIES, CAPABILITY_LABELS } = await import('../src/shared/accessControl.js')
  assert.ok(ALL_CAPABILITIES.includes('advanced_booking_engine.view'), 'advanced_booking_engine.view should be in ALL_CAPABILITIES')
  assert.ok(ALL_CAPABILITIES.includes('advanced_booking_engine.manage'), 'advanced_booking_engine.manage should be in ALL_CAPABILITIES')
  assert.ok(CAPABILITY_LABELS['advanced_booking_engine.view'], 'advanced_booking_engine.view should have a label')
  assert.ok(CAPABILITY_LABELS['advanced_booking_engine.manage'], 'advanced_booking_engine.manage should have a label')
})

test('Advanced Booking Engine capabilities mapped to feature in FEATURE_REQUIREMENT_MAP', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/shared/accessControl.js', 'utf8')
  assert.ok(content.includes("'advanced_booking_engine.view': 'advanced_booking_engine'"))
  assert.ok(content.includes("'advanced_booking_engine.manage': 'advanced_booking_engine'"))
})

test('Advanced Booking Engine addon exists in enterpriseAddons catalog', async () => {
  const { getEnterpriseAddonByKey } = await import('../src/shared/enterpriseAddons.js')
  const addon = getEnterpriseAddonByKey('advanced_booking_engine')
  assert.ok(addon, 'advanced_booking_engine addon should exist')
  assert.equal(addon.status, 'planned')
  assert.equal(addon.advertise, false)
  assert.ok(addon.moduleKeys.includes('advanced_booking_engine'))
})

test('Advanced Booking Engine addon mapped in entitlementMerge addonFeatureMap', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/shared/entitlementMerge.js', 'utf8')
  assert.ok(content.includes('advanced_booking_engine'), 'entitlementMerge should reference advanced_booking_engine')
})

test('Booking engine domain file exists', async () => {
  const fs = await import('fs')
  assert.ok(fs.existsSync(`./${DOMAIN_FILE}`), 'bookingEngine.js domain file should exist')
})

test('Booking engine domain file exports expected function names', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/domains/bookingEngine.js', 'utf8')
  const fns = [
    'getBookingEngineRules', 'createBookingEngineRule', 'updateBookingEngineRule', 'deleteBookingEngineRule',
    'getBookingUpsellsList', 'createBookingUpsell', 'updateBookingUpsell', 'deleteBookingUpsell',
    'calculateBookingPrice', 'checkBookingAvailability', 'getBookingUpsells', 'createBookingIntent'
  ]
  for (const fn of fns) {
    assert.ok(content.includes(`export ${fn === 'getBookingEngineRules' || fn === 'getBookingUpsellsList' ? 'function' : 'async function'} ${fn}`) || content.includes(`export function ${fn}`), `${fn} should be exported in bookingEngine.js`)
  }
})

test('Booking engine domain uses dedupePromise pattern', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/domains/bookingEngine.js', 'utf8')
  assert.ok(content.includes('dedupePromise('), 'bookingEngine.js should use dedupePromise')
})

test('Database facade re-exports booking engine domain functions', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/database.js', 'utf8')
  const fns = [
    'getBookingEngineRules', 'createBookingEngineRule', 'updateBookingEngineRule', 'deleteBookingEngineRule',
    'getBookingUpsellsList', 'createBookingUpsell', 'updateBookingUpsell', 'deleteBookingUpsell',
    'calculateBookingPrice', 'checkBookingAvailability', 'getBookingUpsells', 'createBookingIntent'
  ]
  for (const fn of fns) {
    assert.ok(content.includes(fn), `database.js should re-export ${fn}`)
  }
})

test('IPC handlers exist for advanced booking engine', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/index.js', 'utf8')
  const handlers = [
    'bookingEngine:calculatePrice', 'bookingEngine:checkAvailability',
    'bookingEngine:getUpsells', 'bookingEngine:createIntent',
    'bookingEngine:getRules', 'bookingEngine:createRule',
    'bookingEngine:updateRule', 'bookingEngine:deleteRule',
    'bookingEngine:getUpsellsList', 'bookingEngine:createUpsell',
    'bookingEngine:updateUpsell', 'bookingEngine:deleteUpsell'
  ]
  for (const handler of handlers) {
    assert.ok(content.includes(`ipcMain.handle('${handler}'`), `IPC handler for ${handler} should exist`)
  }
})

test('IPC handlers use correct capability checks', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/index.js', 'utf8')
  const viewHandlers = [
    'bookingEngine:calculatePrice', 'bookingEngine:checkAvailability',
    'bookingEngine:getUpsells', 'bookingEngine:getRules',
    'bookingEngine:getUpsellsList'
  ]
  const manageHandlers = [
    'bookingEngine:createIntent', 'bookingEngine:createRule',
    'bookingEngine:updateRule', 'bookingEngine:deleteRule',
    'bookingEngine:createUpsell', 'bookingEngine:updateUpsell',
    'bookingEngine:deleteUpsell'
  ]
  for (const handler of viewHandlers) {
    const idx = content.indexOf(`ipcMain.handle('${handler}'`)
    const section = content.slice(idx, idx + 400)
    assert.ok(section.includes('requireCapabilityOrDevEnterprisePreview'), `${handler} should use requireCapabilityOrDevEnterprisePreview`)
  }
  for (const handler of manageHandlers) {
    const idx = content.indexOf(`ipcMain.handle('${handler}'`)
    const section = content.slice(idx, idx + 300)
    assert.ok(section.includes("requireCapability('"), `${handler} should use requireCapability`)
  }
})

test('Preload exposes bookingEngine API', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/preload/index.js', 'utf8')
  assert.ok(content.includes('bookingEngine:'), 'preload should expose bookingEngine API')
})

test('Preload bookingEngine has expected methods', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/preload/index.js', 'utf8')
  const methods = [
    'calculatePrice', 'checkAvailability', 'getUpsells', 'createIntent',
    'getRules', 'createRule', 'updateRule', 'deleteRule',
    'getUpsellsList', 'createUpsell', 'updateUpsell', 'deleteUpsell'
  ]
  for (const method of methods) {
    assert.ok(content.includes(`bookingEngine:${method}`) || content.includes(`${method}:`), `bookingEngine should have ${method} method`)
  }
})

test('Booking engine has a dedicated renderer workspace', async () => {
  const fs = await import('fs')
  const componentPath = './src/renderer/src/components/BookingEngine.jsx'
  assert.ok(fs.existsSync(componentPath), 'BookingEngine.jsx should exist')
  const component = fs.readFileSync(componentPath, 'utf8')
  assert.ok(component.includes('window.api.bookingEngine.getRules'), 'BookingEngine should load rules through preload API')
  assert.ok(component.includes('window.api.bookingEngine.getUpsellsList'), 'BookingEngine should load upsells through preload API')
  assert.ok(component.includes('window.api.bookingEngine.calculatePrice'), 'BookingEngine should preview pricing through preload API')
  assert.ok(component.includes('window.api.bookingEngine.checkAvailability'), 'BookingEngine should preview availability through preload API')
  assert.ok(component.includes('window.api.bookingEngine.getUpsells'), 'BookingEngine should preview eligible upsells through preload API')
  assert.ok(!component.includes('createIntent('), 'BookingEngine renderer preview must not create booking intents implicitly')
})

test('Booking engine route redirects to Rate Plans tab', async () => {
  const fs = await import('fs')
  const app = fs.readFileSync('./src/renderer/src/App.jsx', 'utf8')
  assert.ok(app.includes("const BookingEngine = lazy(() => import('./components/BookingEngine'))"), 'App should lazy-load BookingEngine')
  assert.ok(app.includes("path=\"booking-engine\""), 'booking-engine route should exist')
  assert.ok(app.includes('Navigate to="/rate-plans?tab=booking-engine"'), 'booking-engine should redirect to Rate Plans tab')
})

test('All advanced booking engine files are created', async () => {
  const fs = await import('fs')
  const files = [
    `./supabase/migrations/${MIGRATION_FILE}`,
    `./${DOMAIN_FILE}`,
    './src/renderer/src/components/BookingEngine.jsx',
    './src/main/domains/bookingEngine.js',
    './src/main/database.js',
    './src/main/index.js',
    './src/preload/index.js',
    './src/shared/moduleCatalog.js',
    './src/shared/accessControl.js',
    './src/shared/enterpriseAddons.js',
    './src/shared/entitlementMerge.js'
  ]
  for (const file of files) {
    assert.ok(fs.existsSync(file), `${file} should exist`)
  }
})

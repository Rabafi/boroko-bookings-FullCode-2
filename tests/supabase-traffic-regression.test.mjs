import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('manager PWA deduplicates identical in-flight reads', async () => {
  const runtime = await read('manager-pwa/src/lib/runtime.js')
  assert.match(runtime, /const inFlightQueries = new Map\(\)/)
  assert.match(runtime, /const existingRequest = inFlightQueries\.get\(requestKey\)/)
  assert.match(runtime, /if \(existingRequest\) return existingRequest/)
})

test('manager PWA entitlement uses a bounded cache instead of calling on every consumer', async () => {
  const api = await read('manager-pwa/src/lib/api.js')
  assert.match(api, /const ENTITLEMENT_CACHE_MAX_AGE_MS = 5 \* 60_000/)
  assert.match(api, /key: 'entitlement'/)
  assert.match(api, /maxAgeMs: ENTITLEMENT_CACHE_MAX_AGE_MS/)
  assert.match(api, /forceFresh: options\.forceFresh === true/)
})

test('desktop entitlement requests are cached and concurrent calls are coalesced', async () => {
  const entitlements = await read('src/main/domains/entitlements.js')
  assert.match(entitlements, /const _entitlementRequests = new Map\(\)/)
  assert.match(entitlements, /const ENTITLEMENT_CACHE_TTL_MS = 2 \* 60_000/)
  assert.match(entitlements, /const ENTITLEMENT_RPC_TIMEOUT_MS = 15 \* 1000/)
  assert.match(entitlements, /if \(existingRequest\) return existingRequest/)
  assert.match(entitlements, /options\.forceFresh !== true/)
})

test('high-cost manager pages retain refresh behavior with gentler visible-only polling', async () => {
  const money = await read('manager-pwa/src/pages/Money.jsx')
  const pos = await read('manager-pwa/src/pages/PosSales.jsx')
  assert.match(money, /document\.visibilityState === 'visible'\) load\(true\)/)
  assert.match(money, /2 \* 60_000/)
  assert.match(pos, /document\.visibilityState === 'visible'\) load\(\{ silent: true \}\)/)
  assert.match(pos, /90_000/)
})

test('restaurant desktop startup excludes accommodation cache groups', async () => {
  const refresh = await read('src/main/domains/cacheRefresh.js')
  assert.match(refresh, /const RESTAURANT_CACHE_NAMES = Object\.freeze\(\[/)
  assert.match(refresh, /getRuntimeProductId\(\) === 'hospitality-pos'/)
  const restaurantScope = refresh.match(/const RESTAURANT_CACHE_NAMES = Object\.freeze\(\[([\s\S]*?)\]\);/)?.[1] || ''
  assert.match(restaurantScope, /'pos-orders'/)
  assert.match(restaurantScope, /'inventory-items'/)
  assert.doesNotMatch(restaurantScope, /'bookings'|'rooms'|'conference-bookings'|'pool-day-use'/)
})

test('live POS polling uses server filters, bounded coalescing, and hidden-window guards', async () => {
  const pos = await read('src/main/domains/pos.js')
  const layout = await read('src/renderer/src/components/hospitality-pos/HposLayout.jsx')
  const kitchen = await read('src/renderer/src/components/hospitality-pos/HposKitchen.jsx')
  const display = await read('src/renderer/src/components/POSDisplays.jsx')
  assert.match(pos, /const POS_REMOTE_READ_TTL_MS = 2_500/)
  assert.match(pos, /query = query\.in\('status', ACTIVE_PREP_TICKET_STATUSES\)/)
  assert.match(pos, /\.select\(POS_TICKET_SELECT\)/)
  assert.match(pos, /get_pos_floor_snapshot/)
  assert.match(layout, /getTabs\?\.\(\{ status: 'active' \}\)/)
  assert.match(layout, /document\.visibilityState === 'hidden'/)
  assert.match(kitchen, /createdFrom: start\.toISOString\(\)/)
  assert.match(display, /\{ station, status: 'active' \}/)
})

test('device health writes are change-aware with a bounded heartbeat', async () => {
  const health = await read('src/main/domains/health.js')
  const runtime = await read('manager-pwa/src/lib/runtime.js')
  assert.match(health, /const DEVICE_HEALTH_MAX_HEARTBEAT_MS = 20 \* 60_000/)
  assert.match(health, /reason: 'unchanged'/)
  assert.match(runtime, /const PWA_HEALTH_PUBLISH_MIN_MS = 20 \* 60_000/)
})

test('manager PWA avoids duplicate inbox reads and restaurant accommodation fan-out', async () => {
  const dashboard = await read('manager-pwa/src/pages/Dashboard.jsx')
  const inbox = await read('manager-pwa/src/contexts/InboxContext.jsx')
  const api = await read('manager-pwa/src/lib/api.js')
  const app = await read('manager-pwa/src/App.jsx')
  assert.doesNotMatch(dashboard, /getFinancialActivityFeed|getSupportRequests/)
  assert.match(dashboard, /restaurantMode[\s\S]*getManagerPosSnapshot/)
  assert.match(inbox, /60_000/)
  assert.match(api, /key: `support_requests:\$\{safeLimit\}`/)
  assert.match(api, /maxAgeMs: 60_000/)
  assert.match(app, /if \(restaurantMode\)[\s\S]*inventory_items/)
})

test('database migration caches validated request identity and suppresses unchanged writes', async () => {
  const migration = await read('supabase/migrations/20260716016000_optimize_supabase_io.sql')
  assert.match(migration, /set_config\('app\.lodge_id'/)
  assert.match(migration, /current_setting\('app\.session_valid', true\) = 'true'/)
  assert.match(migration, /language plpgsql\s+stable\s+security definer/)
  assert.doesNotMatch(migration, /select \* into v_settings/i)
  assert.match(migration, /device_health_reports\.reported_at < now\(\) - interval '20 minutes'/)
  assert.match(migration, /create or replace function public\.get_pos_floor_snapshot/)
})

test('lodge access fails closed when no valid session resolves', async () => {
  const migration = await read('supabase/migrations/20260716017000_fail_closed_lodge_access.sql')
  assert.match(migration, /app_is_service_role\(\) is true/i)
  assert.match(migration, /return coalesce\(public\.app_current_lodge_id\(p_token\) = p_lodge_id, false\)/i)
})

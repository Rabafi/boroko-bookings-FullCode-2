import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BAR_BASE_SETUP_STAGE_KEYS,
  getBarModeProfile,
  getHposDockItems,
  getHposMoreItems,
  isBarOnlyBlockedPath
} from '../src/shared/barModeProfile.js'
import { buildCapabilitySnapshot, canAccessCapability } from '../src/shared/accessControl.js'
import { buildCommercialOfferSnapshot } from '../src/shared/commercialPackages.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const barSettings = {
  property_type: 'restaurant',
  operating_profile: { hospitality_mode: 'bar_only' }
}

test('base Bar POS navigation keeps selling simple and includes essential staff and audit controls', () => {
  const routes = getHposDockItems(barSettings).map((item) => item.route)
  assert.deepEqual(routes, [
    '/hpos/pos',
    '/hpos/checks',
    '/hpos/menu',
    '/hpos/stock',
    '/hpos/cash',
    '/hpos/reports'
  ])

  const manageRoutes = getHposMoreItems(barSettings).filter((item) => !item.feature).map((item) => item.route)
  for (const route of ['/hpos/menu', '/hpos/stock', '/hpos/cash', '/hpos/reports', '/staff', '/hpos/team', '/hpos/control', '/hpos/system-health?tab=audit']) {
    assert.ok(manageRoutes.includes(route))
  }
  for (const route of [
    '/hpos/customers',
    '/hpos/business-control',
    '/restaurant/inventory',
    '/restaurant/finance-close',
    '/restaurant/payroll'
  ]) {
    assert.ok(!manageRoutes.includes(route), `${route} must not appear in base Bar POS`)
  }
})

test('add-on workspaces fail closed while base staff shifts remain available', () => {
  for (const route of [
    '/hpos/customers',
    '/hpos/business-control',
    '/restaurant/inventory',
    '/restaurant/finance-close',
    '/restaurant/team-workspace',
    '/restaurant/general-ledger',
    '/restaurant/payroll'
  ]) {
    assert.equal(isBarOnlyBlockedPath(route), true, route)
  }
  assert.equal(isBarOnlyBlockedPath('/hpos/team'), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/control'), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/inventory', ['inventory_advanced']), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/general-ledger', ['restaurant_accounting']), false)
  assert.equal(isBarOnlyBlockedPath('/restaurant/team-workspace', ['workforce_management']), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/customers', ['customer_accounts']), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/reports'), false)
  assert.equal(isBarOnlyBlockedPath('/hpos/cash'), false)
})

test('bar managers can maintain base stock without enabling the advanced inventory add-on', () => {
  const access = buildCapabilitySnapshot({
    role: 'manager',
    features: { inventory: true },
    commercialPackageKey: 'bar_pos'
  })
  assert.equal(canAccessCapability(access, 'inventory.view'), true)
  assert.equal(canAccessCapability(access, 'inventory.manage'), true)

  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  assert.match(stock, /inventory\.createItem/)
  assert.match(stock, /inventory\.adjustStock/)
  assert.match(stock, /crypto\.randomUUID\(\)/)
  assert.match(stock, /Physical count/)
  assert.doesNotMatch(stock, /navigate\(['"]\/restaurant\/inventory/)
})

test('Bar Manage explains the financial boundary of Basic and the add-ons needed for purchases and P&L', () => {
  const manageHub = read('src/renderer/src/components/hospitality-pos/HposManageHub.jsx')
  assert.match(manageHub, /BAR_POS_ADDON_CATALOG/)
  assert.match(manageHub, /Bar POS records sales, simple deliveries and physical counts/)
  assert.match(manageHub, /does not create supplier bills, purchase history, cost-of-sales reporting or a profit-and-loss statement on its own/)
  assert.match(manageHub, /Stock &amp; Purchasing Pro/)
  assert.match(manageHub, /Accounting &amp; Workforce/)
  assert.match(manageHub, /To see purchases and P&amp;L/)
  assert.match(manageHub, /navigate\('\/settings\?tab=license'\)/)
  assert.match(manageHub, /formatCommercialMoney\(addon\.annualPriceBwp\)/)
})

test('bar setup and products stay focused on a fourteen-stage drinks-and-simple-food launch', () => {
  assert.equal(BAR_BASE_SETUP_STAGE_KEYS.length, 14)
  const readiness = read('src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx')
  assert.match(readiness, /const BAR_STAGES/)
  assert.match(readiness, /barOnly \? BAR_STAGES : STAGES/)
  assert.match(readiness, /safe first sale/)
  assert.match(readiness, /staff_accounts/)
  assert.match(readiness, /staff_roles/)
  assert.match(readiness, /staff_pins/)
  assert.match(readiness, /first_completed_shift/)
  assert.match(readiness, /hpos\/system-health\?tab=devices/)

  const products = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  assert.ok(getBarModeProfile(barSettings).defaultProductCategories.includes('Simple Food'))
  assert.match(products, /prepared[- ]portion/i)
  assert.match(products, /!barOnly &&/)
  assert.match(products, /stock_method === ["']recipe["']/)
})

test('bar product stock links support measured pours and fail closed around recipe add-on access', () => {
  const products = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  const posDomain = read('src/main/domains/pos.js')
  assert.match(products, /depletion_qty: ["']1["']/)
  assert.match(products, /Stock units consumed per sale/)
  assert.match(products, /step=["']any["']/)
  assert.match(products, /Number\.isFinite\(depletionQty\).*depletionQty <= 0/)
  assert.match(products, /depletion_qty: isDirect \? depletionQty : null/)
  assert.match(products, /getCommercialFeatureSet/)
  assert.match(products, /recipesEnabled = !barOnly \|\| commercialFeatures\.has\(["']recipes["']\)/)
  assert.match(posDomain, /depletion_qty: data\.inventory_item_id \? normalizePositiveQty\(data\.depletion_qty, 1\) : null/)
})

test('atomic Bar product saves work for established desktop sessions without weakening server checks', () => {
  const productSave = read('supabase/migrations/20260807210000_atomic_bar_product_pack_save.sql')
  const grantRepair = read('supabase/migrations/20260816110000_bar_product_save_custom_session_grant.sql')
  const posDomain = read('src/main/domains/pos.js')

  assert.match(posDomain, /rpc\('save_bar_pos_product_with_packs', \{ payload \}\)/)
  assert.match(productSave, /security definer set search_path=public/)
  assert.match(productSave, /public\.app_get_actor_user_id\(\)/)
  assert.match(productSave, /public\.app_require_lodge_role\(v_lodge_id,array\['manager','admin','super_admin'\]\)/)
  assert.match(productSave, /restaurant_catalog_operations/)
  assert.match(productSave, /payload_hash<>v_payload_hash/)
  assert.match(grantRepair, /revoke all on function public\.save_bar_pos_product_with_packs\(jsonb\) from public, anon, authenticated/i)
  assert.match(grantRepair, /grant execute on function public\.save_bar_pos_product_with_packs\(jsonb\) to anon, authenticated, service_role/i)
})

test('ordinary Bar products do not invoke unavailable pack templates, while pack setup stays Bar-outlet scoped', () => {
  const productSaveRepair = read('supabase/migrations/20260816120000_bar_product_save_skip_unselected_pack_templates.sql')
  const products = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')

  assert.match(productSaveRepair, /if coalesce\(\(v_pack_row->>'enabled'\)::boolean,false\)\s+or exists \(/)
  assert.match(productSaveRepair, /existing_pack\.template_kind='bar_pack'/)
  assert.match(products, /selectedInventoryIsBar/)
  assert.match(products, /can be sold individually/)
  assert.match(products, /assign the stock item to an active Bar outlet/)
  assert.match(stock, /Stock location/)
  assert.match(stock, /Use a Bar location when this item may be sold as a 6-pack, 12-pack or case\./)
})

test('Bar stock uses durable outlet UUIDs and new Bar companies receive one physical Bar outlet', () => {
  const outletMigration = read('supabase/migrations/20260816130000_bar_mode_default_physical_outlet.sql')
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')

  assert.match(outletMigration, /ensure_bar_mode_default_outlet/)
  assert.match(outletMigration, /values \(p_lodge_id, 'Bar', 'beverage', true, v_sort_order\)/)
  assert.match(outletMigration, /after insert or update of property_type, operating_profile on public\.settings/)
  assert.match(outletMigration, /Backfill every existing Bar-mode company once/)
  assert.match(stock, /const isOutletId =/)
  assert.match(stock, /\.filter\(\(outlet\) => isOutletId\(outlet\?\.id\)\)/)
  assert.match(stock, /const durableOutletId = isOutletId\(newItem\.outlet_id\)/)
})

test('a physical Bar outlet receives an outlet-matched immutable catalogue before trading', () => {
  const catalogMigration = read('supabase/migrations/20260816140000_bar_outlet_initial_catalog_snapshot.sql')
  const orderDomain = read('src/main/domains/pos.js')
  const orderContract = read('supabase/migrations/20260618210000_pos_financial_contract_final.sql')

  assert.match(catalogMigration, /ensure_initial_pos_catalog_snapshot/)
  assert.match(catalogMigration, /snapshot\.outlet_id = p_outlet_id/)
  assert.match(catalogMigration, /m\.outlet_id = p_outlet_id or m\.outlet_id is null/)
  assert.match(catalogMigration, /perform public\.ensure_initial_pos_catalog_snapshot\(p_lodge_id, v_bar_outlet_id\)/)
  assert.match(orderDomain, /getActivePosCatalogSnapshot\(data\.outlet_id \|\| null\)/)
  assert.match(orderContract, /v_snapshot\.outlet_id is distinct from v_outlet_id/)
})

test('Bar opening stock, counts, and sales use the same physical stock-location balance', () => {
  const stockRepair = read('supabase/migrations/20260816150000_bar_stock_location_opening_balance_repair.sql')

  assert.match(stockRepair, /ensure_inventory_item_stock_location_balance/)
  assert.match(stockRepair, /restaurant_seed_inventory_item_stock_location_balance/)
  assert.match(stockRepair, /after insert on public\.inventory_items/)
  assert.match(stockRepair, /Opening stock recorded when inventory item was created/)
  assert.match(stockRepair, /public\.restaurant_apply_stock_location_balance\(\s*p_lodge_id, p_item_id, v_stock_location_id, p_delta/)
  assert.match(stockRepair, /Insufficient stock in the selected stock location/)
  assert.match(stockRepair, /Backfill only Bar-mode businesses/)
  assert.match(stockRepair, /insert into public\.restaurant_outlet_stock_locations/)
})

test('base bar sales and day close reuse authoritative shared reporting without table or kitchen blockers', () => {
  const app = read('src/renderer/src/App.jsx')
  assert.match(app, /path="hpos\/reports"/)
  assert.match(app, /<HposReports \/>/)

  const close = read('src/renderer/src/components/restaurant/RestaurantDailyClose.jsx')
  assert.match(close, /barOnly \? Promise\.resolve\(\[\]\)/)
  assert.match(close, /!barOnly &&/)

  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(terminal, /barOnly \? ['"]bartender or cashier['"]/)
  assert.match(terminal, /serving bartender/)
  assert.match(terminal, /paymentBreakdown/)
  assert.match(terminal, /Split payment/)
})

test('expired Bar POS access offers its compatible base package and selectable annual add-ons through the authoritative quote request path', () => {
  const app = read('src/renderer/src/App.jsx')
  const commercialEntitlements = read('src/shared/commercialEntitlements.js')
  assert.match(app, /isCommercialSelectionEligible/)
  assert.match(app, /commercialPackageKey: tier\.commercialPackageKey/)
  assert.match(app, /operatingProfile/)
  assert.match(app, /getCommercialAddonOffers/)
  assert.match(app, /addon\.eligiblePackageKeys\.includes\(tier\.commercialPackageKey\)/)
  assert.match(app, /Optional annual add-ons/)
  assert.match(app, /commercialAddonPriceLabel\(addon\)/)
  assert.match(app, /requested_addons: selectedAddons/)
  assert.match(app, /subscriptionRequests\?\.submit\?\./)
  assert.match(app, /tier\.displayName/)
  assert.match(app, /tier\.salesCopy/)
  assert.match(app, /tier\.includedFeatures\.slice\(0, 5\)/)
  assert.match(app, /commercialPriceLabel\(tier\)/)
  assert.match(app, /sales@tsabonno\.com/)
  assert.doesNotMatch(app, /tier\.modules\.slice/)
  assert.doesNotMatch(app, /catch \{ setSubmitted\(true\) \}/)
  assert.match(commercialEntitlements, /bar_stock_purchasing_pro/)
  assert.match(commercialEntitlements, /bar_accounting_workforce/)
  assert.match(commercialEntitlements, /bar_growth_multi_outlet/)
})

test('Bar annual add-ons are collected in the first annual invoice as well as annual renewal', () => {
  const quote = buildCommercialOfferSnapshot({
    productId: 'hospitality-pos',
    commercialPackageKey: 'bar_pos',
    addonKeys: ['bar_stock_purchasing_pro', 'bar_accounting_workforce', 'bar_growth_multi_outlet'],
    operatingProfile: 'bar_only',
    propertyType: 'restaurant'
  })
  assert.equal(quote.totals.total_due_now, 18500)
  assert.equal(quote.totals.recurring_annual, 18500)
  assert.deepEqual(quote.lines.filter((line) => line.line_type === 'addon').map((line) => line.amount_due_now), [3000, 6000, 5000])

  const migration = read('supabase/migrations/20260816090000_command_central_subscription_truth_hardening.sql')
  assert.match(migration, /v_addon_due_now/)
  assert.match(migration, /v_addon\.billing_basis = 'annual_addon'/)
  assert.match(migration, /first annual term/)
})

test('completed Bar sales return their immutable server-issued receipt identity, including idempotent retries', () => {
  const receiptRepair = read('supabase/migrations/20260816160000_pos_v3_server_receipt_identity.sql')
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  const receipt = read('src/renderer/src/components/shared/POSReceipt.jsx')

  assert.match(receiptRepair, /pg_get_functiondef\('public\.create_pos_order_v3\(jsonb\)'::regprocedure\)/)
  assert.match(receiptRepair, /'receipt_number', \(\s+select o\.receipt_number/)
  assert.match(receiptRepair, /where o\.id = v_order_id\s+and o\.lodge_id = v_lodge_id/)
  assert.match(receiptRepair, /update public\.financial_operation_idempotency fi/)
  assert.match(receiptRepair, /fi\.operation_type = 'create_pos_order_v3'/)
  assert.match(receiptRepair, /fi\.entity_id = o\.id\s+and fi\.lodge_id = o\.lodge_id/)
  assert.match(receiptRepair, /and o\.receipt_number is not null/)
  assert.match(terminal, /receipt_number: result\.receipt_number \|\| null/)
  assert.match(receipt, /RECEIPT NUMBER UNAVAILABLE/)
  assert.match(receipt, /Printing is blocked until the sale is refreshed or resolved/)
})

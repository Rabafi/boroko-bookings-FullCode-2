import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findUnmetModifierGroups,
  isModifierGroupApplicable,
  selectionsInModifierGroup,
  validateSaleModifierRequirements,
} from '../src/shared/modifierRequirements.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const migrations = (name) => read(`supabase/migrations/${name}`)

const GROUPS = [
  {
    id: 'g-temp',
    name: 'Steak temperature',
    active: true,
    applies_to_categories: ['Mains'],
    min_selections: 1,
    max_selections: 1,
    options: [
      { id: 'o-rare', name: 'Rare', price_delta: 0 },
      { id: 'o-well', name: 'Well done', price_delta: 0 },
    ],
  },
  {
    id: 'g-mixer',
    name: 'Mixer',
    active: true,
    applies_to_categories: [],
    min_selections: 0,
    max_selections: 2,
    options: [{ id: 'o-soda', name: 'Soda', price_delta: 5 }],
  },
  {
    id: 'g-off',
    name: 'Retired',
    active: false,
    applies_to_categories: [],
    min_selections: 1,
    max_selections: 1,
    options: [{ id: 'o-x', name: 'X', price_delta: 0 }],
  },
]

test('modifier applicability matches the Till contract', () => {
  assert.equal(isModifierGroupApplicable(GROUPS[0], 'Mains'), true)
  assert.equal(isModifierGroupApplicable(GROUPS[0], 'mains'), true)
  assert.equal(isModifierGroupApplicable(GROUPS[0], 'Drinks'), false)
  assert.equal(isModifierGroupApplicable(GROUPS[1], 'Anything'), true)
  assert.equal(isModifierGroupApplicable(GROUPS[2], 'Anything'), false)
  assert.equal(isModifierGroupApplicable(null, 'Mains'), false)
})

test('unmet minimums are found per line without guessing', () => {
  const bare = { item_name: 'Steak', category: 'Mains', modifiers: [] };
  const unmet = findUnmetModifierGroups(bare, GROUPS)
  assert.equal(unmet.length, 1)
  assert.equal(unmet[0].name, 'Steak temperature')
  const filled = {
    ...bare,
    modifiers: [{ id: 'o-rare', group_id: 'g-temp', name: 'Rare', price_delta: 0 }],
  };
  assert.deepEqual(findUnmetModifierGroups(filled, GROUPS), [])
  // Optional groups never block, inactive groups never apply.
  assert.deepEqual(findUnmetModifierGroups({ ...bare, category: 'Drinks', modifiers: [] }, GROUPS), [])
})

test('unknown applicability fails closed instead of passing', () => {
  const lines = [{ item_name: 'Steak', category: 'Mains', modifiers: [] }]
  const unknown = validateSaleModifierRequirements(lines, GROUPS, false)
  assert.equal(unknown.ok, false)
  assert.equal(unknown.known, false)
  const blocked = validateSaleModifierRequirements(lines, GROUPS, true)
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /Complete required choices: Steak temperature/)
  const ok = validateSaleModifierRequirements(
    [{ ...lines[0], modifiers: [{ id: 'o-rare', group_id: 'g-temp' }] }],
    GROUPS,
    true,
  )
  assert.equal(ok.ok, true)
  assert.equal(selectionsInModifierGroup([{ id: 'o-soda' }], GROUPS[1]).length, 1)
})

test('atomic product+stock migration keeps one-transaction guarantees', () => {
  const sql = migrations('20260909000000_bar_atomic_product_with_stock.sql')
  assert.match(sql, /create or replace function public\.save_bar_product_with_stock\(payload jsonb\)/)
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('bar-catalog:'/)
  assert.match(sql, /payload_hash<>v_payload_hash[\s\S]{0,120}23505/)
  assert.match(sql, /request_payload jsonb/)
  assert.match(sql, /entity_ids jsonb/)
  // Expected-version conflict checks for concurrent edits.
  assert.match(sql, /expected_menu_version/)
  assert.match(sql, /expected_stock_version/)
  assert.match(sql, /changed underneath this edit/)
  // Early outlet/pack validation before any mutation.
  assert.match(sql, /Packs require the stock item to sit in an active Bar outlet/)
  // Barcode conflicts name the existing record with a recovery hint.
  assert.match(sql, /Use the existing product instead/)
  // Wizard stock skips the auto-menu sync by design (documented).
  assert.match(sql, /No sync_inventory_item_to_pos here/)
  // Publication jobs are created inside the same transaction.
  assert.match(sql, /insert into public\.catalog_publication_jobs/)
  assert.match(sql, /nextval\('public\.catalog_publication_version_seq'\)/)
  // Edit versions are mandatory and checked under row locks.
  assert.match(sql, /Editing a product requires its loaded version/)
  assert.match(sql, /Linking stock requires its loaded version/)
  assert.match(sql, /for update;/)
  // Disabled packs that do not exist are skipped (no spurious outlet
  // failures); nested auto-menu singles minted mid-transaction are removed.
  assert.match(sql, /v_pack_exists/)
  assert.match(sql, /coalesce\(auto_from_inventory,false\)=true/)
  // Opening stock carries an audited ledger movement, exactly once.
  assert.match(sql, /movement_type, quantity/)
  assert.match(sql, /'opening_stock'/)
  // Operator outlet authorization is enforced server-side.
  assert.match(sql, /app_require_pos_outlet_access/)
  assert.match(sql, /grant execute on function public\.save_bar_product_with_stock\(jsonb\) to authenticated,service_role/)
  // Desktop/POS clients call via the anon key (session is validated
  // server-side inside the RPC), so the follow-up migration must re-grant
  // anon execute after the original migration revoked it.
  const grants = migrations('20260910000000_fix_save_bar_product_with_stock_grants.sql')
  assert.match(grants, /grant execute on function public\.save_bar_product_with_stock\(jsonb\) to anon,\s*authenticated,\s*service_role/)
})

test('publication worker contract uses token plus unexpired lease', () => {
  const sql = migrations('20260909010000_catalog_publication_jobs.sql')
  assert.match(sql, /create or replace function public\.claim_catalog_publication_job/)
  assert.match(sql, /create or replace function public\.complete_catalog_publication_job/)
  assert.match(sql, /create or replace function public\.fail_catalog_publication_job/)
  assert.doesNotMatch(sql, /fail_catalog_publication_job\(uuid,uuid,text\) from/)
  // Atomic claim of pending rows or expired claims, highest version first.
  assert.match(sql, /state='pending' or \(state='claimed' and lease_expires_at < now\(\)\)/)
  assert.match(sql, /for update skip locked/)
  assert.match(sql, /order by version desc/)
  // Completion requires BOTH token and unexpired lease.
  assert.match(sql, /claim_token=p_claim_token/)
  assert.match(sql, /lease_expires_at > now\(\)/)
  // Older versions never overwrite newer catalogs.
  assert.match(sql, /superseded/)
  assert.match(sql, /applied_version/)
  // Tenant and outlet access enforced server-side.
  assert.match(sql, /app_require_lodge_role/)
  assert.match(sql, /app_require_pos_outlet_access/)
})

test('modifier trigger is narrow and reversal-safe', () => {
  const sql = migrations('20260909020000_pos_modifier_requirements.sql')
  assert.match(sql, /before insert on public\.pos_order_items/)
  assert.match(sql, /for each row execute function public\.enforce_pos_modifier_requirements/)
  assert.match(sql, /coalesce\(NEW\.quantity, 0\) <= 0/)
  // Malformed values are rejected, not exempted.
  assert.match(sql, /Sale line modifiers must be a JSON array/)
  assert.match(sql, /Held tab items must be a JSON array/)
  assert.match(sql, /Held tab line modifiers must be a JSON array/)
  // Distinct attributed selections are counted (no per-option overcount).
  assert.match(sql, /select count\(\*\) into v_selected/)
  assert.match(sql, /Complete required choices/)
  assert.match(sql, /errcode='P0001'/)
  // Authoritative tab-save coverage for every holder, not just checkout.
  // Deliberately INSERT-only: server transfer/split rewrites of
  // pre-existing tabs must not be blocked by later requirements.
  assert.match(sql, /before insert on public\.pos_tabs/)
  assert.match(sql, /for each row execute function public\.enforce_pos_tab_modifier_requirements/)
})

test('stock-readiness read discloses outcome only', () => {
  const sql = migrations('20260909030000_pos_menu_stock_readiness.sql')
  assert.match(sql, /create or replace function public\.get_pos_menu_stock_readiness/)
  assert.match(sql, /_pos_menu_item_has_stock_recipe\(mi\.lodge_id, mi\.id\)/)
  assert.match(sql, /'direct'|'recipe'|'non_stock'|'conflict'|'missing'/)
  assert.match(sql, /grant execute on function public\.get_pos_menu_stock_readiness\(uuid\) to authenticated,service_role/)
})

test('bar read RPCs carry the desktop anon grant', () => {
  // The desktop data plane authenticates as the anon DB role (anon key +
  // app-session header). Without anon EXECUTE, every Till refresh failed with
  // `permission denied for function` while anon-granted sibling RPCs worked.
  const sql = migrations('20260909050000_bar_read_rpc_anon_grants.sql')
  assert.match(sql, /grant execute on function public\.get_pos_menu_stock_readiness\(uuid\) to anon/)
  assert.match(sql, /grant execute on function public\.get_bar_stock_aging\(uuid, uuid\) to anon/)
})

test('intermediate pack-loop patch migrations are fresh-chain tolerant', () => {
  // These surgical DO patches targeted live-drift shapes; on fresh chains
  // their anchors can be absent, so a missing shape must skip with a notice
  // (never raise) — 20260910030000/040000 redeploys the authoritative full
  // body afterwards, so every chain converges to the same final function.
  for (const name of [
    '20260910010000_fix_save_bar_product_pack_loop.sql',
    '20260910020000_fix_save_bar_product_pack_index_loop.sql',
  ]) {
    const sql = migrations(name)
    assert.match(sql, /raise notice '[^']*superseded by 20260910030000/)
    assert.doesNotMatch(sql, /raise exception 'Pack loop already patched/)
    assert.doesNotMatch(sql, /raise exception 'declaration block shape not found/)
    assert.doesNotMatch(sql, /raise exception 'loop shapes not found/)
  }
})

test('product delete delists orphaned stock and preserves movement history', () => {
  const sql = migrations('20260911000000_bar_product_delete_delists_stock.sql')
  // Delist is a flag flip plus an audit entry, never a movement erase.
  assert.match(sql, /set is_active = false, updated_at = now\(\)/)
  assert.match(sql, /stock_delisted_with_product_delete/)
  assert.match(sql, /'movements_preserved', true/)
  // Delist fires only when no remaining reference keeps the stock in service:
  // any sellable row (any template kind, archived included), legacy menu_items,
  // recipe ingredients, prep ingredients and prep outputs.
  assert.match(sql, /from public\.pos_menu_items\s+where lodge_id = p_lodge_id and inventory_item_id = v_inventory_item_id/)
  assert.match(sql, /from public\.menu_items\s+where lodge_id = p_lodge_id and inventory_item_id = v_inventory_item_id/)
  assert.match(sql, /from public\.restaurant_recipe_ingredients\s+where lodge_id = p_lodge_id and inventory_item_id = v_inventory_item_id/)
  assert.match(sql, /restaurant_prep_item_ingredients pi\s+join public\.restaurant_prep_items p on p\.id = pi\.prep_item_id/)
  assert.match(sql, /p\.produced_inventory_item_id = v_inventory_item_id/)
  // Replay idempotency: an already-deleted row is success, not dead-letter.
  assert.match(sql, /'already_deleted', true/)
  // Opening stock exactly once: the log trigger is the only writer; the
  // wizard contract and the location seed no longer insert movements.
  assert.doesNotMatch(sql, /insert into public\.inventory_movements/)
  assert.match(sql, /Opening stock is recorded exactly once by the inventory_items AFTER/)
  assert.match(sql, /ensure_inventory_item_stock_location_balance\(new\.lodge_id, new\.id\)/)
  // Auto-menu sync must never resurrect sellables for delisted stock.
  assert.match(sql, /coalesce\(v_item\.is_active, true\) is false/)
  // Delisted names are reusable: the stock duplicate-name guard excludes
  // inactive items so the product can be re-created with the same name.
  assert.match(sql, /and coalesce\(is_active, true\)/)
  // The only movement DELETEs are the two provable-duplicate dedup rules.
  assert.equal([...sql.matchAll(/delete from public\.inventory_movements/g)].length, 2)
  assert.match(sql, /m\.notes = 'Opening stock recorded when the product was created'/)
  assert.match(sql, /m\.notes = 'Opening stock'/)
  // Grants survive the re-created function.
  assert.match(sql, /grant execute on function public\.delete_pos_menu_item\(uuid, uuid\) to anon, authenticated, service_role/)
})

test('delisted stock is hidden from operational lists across surfaces', () => {
  // Domain passes the server outcome flags through so the UI can report the
  // delist result verbatim.
  const domain = read('src/main/domains/pos.js')
  assert.match(domain, /return \{ \.\.\.result, success: true \};/)
  const menu = read('src/renderer/src/components/hospitality-pos/HposMenu.jsx')
  assert.match(menu, /result\?\.stock_delisted/)
  assert.match(menu, /Movement history is preserved for audit\./)
  assert.match(menu, /setInventoryItems\(\s*\(Array\.isArray\(inventoryRows\) \? inventoryRows : \[\]\)\.filter\(\s*\(row\) => row\?\.is_active !== false,/)
  const wizard = read('src/renderer/src/components/hospitality-pos/HposProductWizard.jsx')
  assert.match(wizard, /\(Array\.isArray\(stock\) \? stock : \[\]\)\.filter\(\(row\) => row\?\.is_active !== false\)/)
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  assert.match(stock, /const isActive = \(item\) => item\?\.is_active !== false/)
  const inventoryPage = read('src/renderer/src/components/Inventory.jsx')
  assert.match(inventoryPage, /if \(i\.is_active === false\) return false/)
  const inventoryDomain = read('src/main/domains/inventory.js')
  assert.match(inventoryDomain, /!item\?\.outlet_id && item\?\.is_active !== false/)
})

test('duplicate-name guard blocks cross-key duplicate products before any mutation', () => {
  // The retry-storm incident: distinct operation keys minted several
  // same-named products. Key-based dedupe cannot see cross-key duplicates,
  // so the guard must fail closed on the natural name before mutations.
  const sql = migrations('20260910040000_bar_product_duplicate_name_guard.sql')
  // Product guard: lodge-wide, case/space-insensitive, derived pack rows
  // excluded (their names are generated), edits exclude their own row.
  assert.match(
    sql,
    /raise exception 'A product named "%" already exists\. Use the existing product instead\.', btrim\(v_product->>'name'\) using errcode='23505';/,
  )
  assert.match(sql, /lower\(btrim\(name\)\) = lower\(btrim\(v_product->>'name'\)\)/)
  assert.match(sql, /coalesce\(template_kind,''\) <> 'bar_pack'/)
  assert.match(sql, /\(v_menu_item_id is null or id <> v_menu_item_id\)/)
  // Stock guard: same lodge + same stock location (outlet, or unassigned).
  assert.match(
    sql,
    /raise exception 'A stock item named "%" already exists in this stock location\. Use the existing stock item instead\.', btrim\(v_stock->>'name'\) using errcode='23505';/,
  )
  assert.match(sql, /outlet_id is not distinct from v_outlet_id/)
  // Same-key replays still return the recorded result before the guards run.
  assert.match(sql, /return v_existing\.result \|\| jsonb_build_object\('replayed',true\)/)
  // Grants survive the re-created function.
  assert.match(sql, /grant execute on function public\.save_bar_product_with_stock\(jsonb\) to anon, authenticated, service_role/)
})

test('duplicate-name refusals are terminal and resolved-elsewhere across surfaces', () => {
  // Domain dispatch must classify SQLSTATE-coded refusals as terminal so the
  // stored request stops re-dispatching (previously they stayed retryable
  // unknown and the retry storm minted duplicates under fresh keys).
  const domain = read('src/main/domains/pos.js')
  assert.match(domain, /import\s*\{\s*isDefinitiveProductRejection,\s*isMissingRpcError\s*\}\s*from\s*'\.\.\/\.\.\/shared\/productRequest\.js'/)
  assert.match(domain, /if \(isDefinitiveProductRejection\(error\)\) return \{ transported: true, rejected: true, error \};/)
  const shared = read('src/shared/productRequest.js')
  assert.match(shared, /export function isDefinitiveProductRejection/)
  assert.match(shared, /code === "22023" \|\| code === "23505"/)
  // Queue replay: a duplicate-name refusal means another key already created
  // the product server-side, so the queued item is resolved (consumed), not
  // dead-lettered into an unfailing retry loop. Barcode/operation-key
  // conflicts use different message shapes and stay reviewable.
  const infrastructure = read('src/main/domains/infrastructure.js')
  assert.match(infrastructure, /item\?\.table === 'save_bar_product_with_stock' &&/)
  assert.match(infrastructure, /\^A \(\?:product\|stock item\) named /i)
  // The refusal must not match the generic already-exists tail (barcode
  // conflicts also end with "Use the existing product instead.").
  assert.doesNotMatch(infrastructure, /Use the existing product instead\.\?\?\)\{0,\}\s*return true/)
})

test('Bar System Health exposes clear-with-review for failed queue items', () => {
  // Operators had no way to clear failed items on the Bar surface while the
  // admin panel had one; the queue desk must offer the same recovery path.
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx')
  assert.match(health, /const clearFailedItems = async \(row = null\) => \{/)
  assert.match(health, /window\.api\?\.sync\?\.clearFailed\?\.\(row \? ids : undefined\)/)
  assert.match(health, /rows\.some\(\(entry\) => entry\?\.isFinancial\)/)
  assert.match(health, /window\.confirm\(/)
  assert.match(health, /Clear all failed/)
  assert.match(health, /clearFailedItems\(row\)/)
  const preload = read('src/preload/index.js')
  assert.match(preload, /clearFailed: \(queueIds\) => invoke\('sync:clearFailed', queueIds\)/)
  const main = read('src/main/index.js')
  assert.match(main, /sync:clearFailed/)
})

test('domain and IPC wire the new contracts with dual capabilities', () => {
  const domain = read('src/main/domains/pos.js')
  assert.match(domain, /export async function saveBarProductWithStock/)
  assert.match(domain, /export async function retryProductRequest/)
  assert.match(domain, /export function getProductRequestStatus/)
  assert.match(domain, /export async function recoverPendingProductRequests/)
  assert.match(domain, /export async function processPendingPublicationJobs/)
  assert.match(domain, /export async function getMenuStockReadiness/)
  // Missing-backend classification must resolve at runtime: the readiness
  // error path and the product-save transport both call isMissingRpcError,
  // which lives in the shared product-request helpers. A bare reference
  // threw ReferenceError on every RPC error and masked the graceful
  // backend-update-required fallback.
  assert.match(domain, /import\s*\{\s*(?:isDefinitiveProductRejection,\s*)?isMissingRpcError(?:,\s*isDefinitiveProductRejection)?\s*\}\s*from\s*['"]\.\.\/\.\.\/shared\/productRequest\.js['"]/)
  assert.match(domain, /backend-update-required/)
  assert.match(domain, /const online = await checkOnline\(\)\.catch\(\(\) => false\)/)
  assert.match(domain, /export function assertSaleModifierRequirements/)
  assert.match(domain, /createProductSaveFlow/)
  assert.match(domain, /runPublicationSweep/)
  assert.match(domain, /product-requests/)
  assert.match(domain, /upsertLocalInventoryMovement/)
  // Replays reuse journalled bytes: changed configuration can never block
  // committed work at the domain layer.
  assert.match(domain, /if \(!attemptResolution\.reused\) assertSaleModifierRequirements/)
  const main = read('src/main/index.js')
  assert.match(main, /pos:saveBarProductWithStock/)
  assert.match(main, /requireCapability\('pos\.menu_manage'\)/)
  assert.match(main, /requireCapability\('inventory\.manage'\)/)
  assert.match(main, /pos:getMenuStockReadiness/)
  assert.match(main, /catalog:processPendingPublications/)
  const preload = read('src/preload/index.js')
  assert.match(preload, /saveBarProductWithStock/)
  assert.match(preload, /getMenuStockReadiness/)
  assert.match(preload, /processPendingPublications/)
  const database = read('src/main/database.js')
  assert.match(database, /saveBarProductWithStock,/)
  assert.match(database, /processPendingPublicationJobs,/)
  assert.match(database, /getMenuStockReadiness,/)
})

test('Till enforces readiness and requirements before Hold and Pay', () => {
  const source = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')
  assert.match(source, /getMenuStockReadiness/)
  assert.match(source, /canUseBarCommercialFeature\("recipes"\)/)
  assert.match(source, /getStockIssue/)
  assert.match(source, /Refresh required/)
  assert.match(source, /modifiersReady/)
  assert.match(source, /validateSaleModifierRequirements\(cart, modifierGroups, modifiersReady === "ready"\)/)
  assert.match(source, /holdModifierCheck/)
  assert.match(source, /payModifierCheck/)
  assert.match(source, /refreshReadiness/)
})

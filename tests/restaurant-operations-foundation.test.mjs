import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const posDomain = await readFile(new URL('../src/main/domains/pos.js', import.meta.url), 'utf8')
const preload = await readFile(new URL('../src/preload/index.js', import.meta.url), 'utf8')
const mainIndex = await readFile(new URL('../src/main/index.js', import.meta.url), 'utf8')
const posUi = await readFile(new URL('../src/renderer/src/components/POS.jsx', import.meta.url), 'utf8')
const posContractSql = await readFile(new URL('../supabase/migrations/20260618210000_pos_financial_contract_final.sql', import.meta.url), 'utf8')
const legacyPosContractSql = await readFile(new URL('../supabase/migrations/20260612193000_legacy_pos_database_contract.sql', import.meta.url), 'utf8')
const idempotencySql = await readFile(new URL('../supabase/migrations/20260618130000_financial_mutation_idempotency_and_booking_audit.sql', import.meta.url), 'utf8')
const phase2HardeningSql = await readFile(new URL('../supabase/migrations/20260708120000_restaurant_phase2_operations_hardening.sql', import.meta.url), 'utf8')
const phase3RoleHardeningSql = await readFile(new URL('../supabase/migrations/20260708190000_restaurant_phase3_role_hardening.sql', import.meta.url), 'utf8')
const combinedPosSql = [posContractSql, legacyPosContractSql, idempotencySql, phase2HardeningSql].join('\n')

test('Phase 2 table operations are exposed through preload and IPC', () => {
  for (const method of [
    'getTables',
    'saveTable',
    'deleteTable',
    'getTablesWithStatus',
    'getActiveTableTab',
    'openTableSession',
    'overrideTableTab',
    'splitBillByItems'
  ]) {
    assert.match(preload, new RegExp(`${method}: \\(`), `preload must expose pos.${method}`)
  }

  for (const channel of [
    'pos:getTables',
    'pos:saveTable',
    'pos:deleteTable',
    'pos:getTablesWithStatus',
    'pos:getActiveTableTab',
    'pos:openTableSession',
    'pos:overrideTableTab',
    'pos:splitBillByItems'
  ]) {
    assert.match(mainIndex, new RegExp(`ipcMain\\.handle\\('${channel}'`), `${channel} IPC handler must exist`)
  }
})

test('Phase 2 modifiers are present in order payload and setup workflow', () => {
  assert.match(preload, /getModifierGroups: \(\) => ipcRenderer\.invoke\('pos:getModifierGroups'\)/)
  assert.match(preload, /saveModifierGroup: \(data\) => ipcRenderer\.invoke\('pos:saveModifierGroup', data\)/)
  assert.match(posUi, /modifier_option_ids/)
  assert.match(posUi, /Modifiers & Instructions/)
  assert.match(posUi, /Kitchen\/bar instruction/)
  assert.match(combinedPosSql, /create or replace function public\.upsert_pos_modifier_groups\(payload jsonb\)/i)
  assert.match(combinedPosSql, /min_selections integer not null default 0/i)
  assert.match(combinedPosSql, /max_selections integer not null default 0/i)
  assert.match(combinedPosSql, /from public\.pos_modifier_groups/i)
})

test('Phase 2 kitchen and bar routing uses prep tickets and station status updates', () => {
  assert.match(preload, /getTickets: \(filters\) => ipcRenderer\.invoke\('pos:getTickets', filters\)/)
  assert.match(preload, /updateTicketStatus: \(id, status\) => ipcRenderer\.invoke\('pos:updateTicketStatus', id, status\)/)
  assert.match(mainIndex, /ipcMain\.handle\('pos:getTickets'/)
  assert.match(mainIndex, /ipcMain\.handle\('pos:updateTicketStatus'/)
  assert.match(posUi, /Open Kitchen Screen/)
  assert.match(posUi, /Open Bar Screen/)
  assert.match(combinedPosSql, /insert into public\.pos_prep_tickets/i)
  assert.match(combinedPosSql, /create or replace function public\.update_pos_prep_ticket_status/i)
})

test('Phase 2 manager approvals and cash-up stay server-authoritative', () => {
  assert.match(preload, /approveVoidWithPin: \(data\) => ipcRenderer\.invoke\('pos:approveVoidWithPin', data\)/)
  assert.match(preload, /approveDiscountWithPin: \(data\) => ipcRenderer\.invoke\('pos:approveDiscountWithPin', data\)/)
  assert.match(preload, /createPartialReturnWithPin: \(data\) => ipcRenderer\.invoke\('pos:createPartialReturnWithPin', data\)/)
  assert.match(preload, /createCashup: \(data\) => ipcRenderer\.invoke\('pos:createCashup', data\)/)
  assert.match(combinedPosSql, /create or replace function public\.approve_pos_void_with_pin\(payload jsonb\)/i)
  assert.match(combinedPosSql, /create or replace function public\.approve_pos_discount_with_pin\(payload jsonb\)/i)
  assert.match(combinedPosSql, /_pos_resolve_pin_internal\(v_lodge_id, v_pin, 'pos\.discount'/i)
  assert.match(combinedPosSql, /create or replace function public\.finalize_pos_shift_cashup_v2\(payload jsonb\)/i)
  assert.match(combinedPosSql, /financial_operation_idempotency/i)
  assert.match(combinedPosSql, /financial_audit_log/i)
})

test('Phase 2 UI keeps table service optional and direct counter sales available', () => {
  assert.match(posUi, /const \[serviceMode, setServiceMode\]/)
  assert.match(posUi, /mode === 'takeaway' \? 'Quick' : mode === 'table' \? 'Table' : mode === 'delivery' \? 'Delivery' : 'Room'/)
  assert.match(posUi, /selectTable/)
  assert.match(posUi, /runTableOverride/)
})

test('Phase 2 bill split is implemented with split-by-items workflow', () => {
  assert.match(posDomain, /export async function splitBillByItems/)
  assert.match(posDomain, /source_tab_id/)
  assert.match(posDomain, /item_indices/)
  assert.match(posDomain, /existingTarget/)
  assert.match(posDomain, /target_tab/)
  assert.match(posUi, /splitModal/)
  assert.match(posUi, /splitItemIndices/)
  assert.match(posUi, /openSplitModal/)
  assert.match(posUi, /executeSplitBill/)
  assert.match(posUi, /Split.*Item/)
})

test('Phase 2 manager-approved discounts require PIN verification', () => {
  const discountApprovalBody = posDomain.slice(
    posDomain.indexOf('export async function approvePosDiscountWithPin'),
    posDomain.indexOf('function summarizeCashupOrders')
  )
  assert.match(posDomain, /export async function approvePosDiscountWithPin/)
  assert.match(posDomain, /discount_type/)
  assert.match(posDomain, /discount_value/)
  assert.doesNotMatch(discountApprovalBody, /pos:discount_approval_pending/)
  assert.doesNotMatch(discountApprovalBody, /provisional: true/)
  assert.match(posUi, /discountApprovalModal/)
  assert.match(posUi, /discountApprovalPin/)
  assert.match(posUi, /submitDiscountApproval/)
  assert.match(posUi, /pendingDiscountApprovalRef/)
  assert.doesNotMatch(posUi, /React\./, 'POS.jsx imports hooks directly and must not reference a missing React namespace')
})

test('Phase 2 modifier groups support category scoping and min/max selections', () => {
  assert.match(posDomain, /applies_to_categories/)
  assert.match(posDomain, /min_selections/)
  assert.match(posDomain, /max_selections/)
  assert.match(posUi, /applies_to_categories/)
  assert.match(posUi, /min_selections/)
  assert.match(posUi, /max_selections/)
  assert.match(posUi, /groupSelections/)
  assert.match(posUi, /showMinWarning/)
  assert.match(posUi, /showMaxWarning/)
})

test('Phase 3 recipe CRUD is exposed through preload and IPC', () => {
  for (const method of [
    'getRecipes',
    'saveRecipe',
    'deleteRecipe'
  ]) {
    assert.match(preload, new RegExp(`${method}: \\(`), `preload must expose pos.${method}`)
  }

  for (const channel of [
    'pos:getRecipes',
    'pos:saveRecipe',
    'pos:deleteRecipe'
  ]) {
    assert.match(mainIndex, new RegExp(`ipcMain\\.handle\\('${channel}'`), `${channel} IPC handler must exist`)
  }
})

test('Phase 3 recipe domain functions exist in pos.js', () => {
  assert.match(posDomain, /export async function getPosRecipes/)
  assert.match(posDomain, /export async function savePosRecipe/)
  assert.match(posDomain, /export async function deletePosRecipe/)
  assert.match(posDomain, /export async function recordRecipeStockDepletion/)
  assert.match(posDomain, /upsert_restaurant_recipe/)
  assert.match(posDomain, /get_restaurant_recipes/)
  assert.match(posDomain, /record_recipe_stock_depletion/)
})

test('Phase 3 recipe management UI exists in POS.jsx', () => {
  assert.match(posUi, /recipes/)
  assert.match(posUi, /recipeForm/)
  assert.match(posUi, /recipeModal/)
  assert.match(posUi, /editingRecipe/)
  assert.match(posUi, /recipeSaving/)
  assert.match(posUi, /Ingredients/)
  assert.match(posUi, /waste_percent/)
})

test('Phase 3 recipe stock depletion is wired into order creation', () => {
  assert.match(posDomain, /recordRecipeStockDepletion/)
  assert.match(posDomain, /record_recipe_stock_depletion/)
})

test('Phase 3 recipe depletion is synchronous on online path', () => {
  // Depletion must be awaited, not fire-and-forget
  const orderCreateBody = posDomain.slice(
    posDomain.indexOf('export async function createPosOrder'),
    posDomain.indexOf('export async function voidPosOrder')
  )
  assert.match(orderCreateBody, /await recordRecipeStockDepletion/, 'online depletion must be awaited')
  assert.doesNotMatch(orderCreateBody, /recordRecipeStockDepletion\(.*\)\.catch/, 'must not be fire-and-forget')
})

test('Phase 3 recipe depletion is queued for offline with depends_on', () => {
  // Offline path must queue recipe depletion as dependent on order
  const orderCreateBody = posDomain.slice(
    posDomain.indexOf('export async function createPosOrder'),
    posDomain.indexOf('export async function voidPosOrder')
  )
  assert.match(orderCreateBody, /pos-recipe-depletion-\$\{id\}/, 'offline queue id must include order id')
  assert.match(orderCreateBody, /_depends_on: `pos-order-\$\{id\}`/, 'must depend on order completion')
})

test('Phase 3 recipe depletion throws on failure', () => {
  // Function must throw, not return error silently
  const depletionFnStart = posDomain.indexOf('export async function recordRecipeStockDepletion')
  const depletionFnEnd = posDomain.indexOf('export async function', depletionFnStart + 10)
  const depletionBody = posDomain.slice(depletionFnStart, depletionFnEnd > 0 ? depletionFnEnd : undefined)
  assert.match(depletionBody, /throw error/, 'must throw on failure')
  assert.doesNotMatch(depletionBody, /return \{ success: false/, 'must not swallow errors')
})

test('Phase 3 SQL has unique guard on recipe stock movements', async () => {
  const phase3Sql = await readFile(new URL('../supabase/migrations/20260708140000_restaurant_phase3_recipes.sql', import.meta.url), 'utf8')
  assert.match(phase3Sql, /restaurant_recipe_stock_movements_dedup_idx/, 'unique dedup index must exist')
  assert.match(phase3Sql, /restaurant_recipe_stock_movements.*lodge_id.*order_id.*order_item_id.*inventory_item_id.*recipe_version/, 'must cover lodge+order+item+ingredient+version')
})

test('Phase 3 SQL recipe depletion is idempotent', async () => {
  const phase3Sql = await readFile(new URL('../supabase/migrations/20260708140000_restaurant_phase3_recipes.sql', import.meta.url), 'utf8')
  // Must check for existing movement before inserting
  assert.match(phase3Sql, /v_existing_count/, 'must check for existing movements')
  assert.match(phase3Sql, /if v_existing_count > 0 then/, 'must skip when already depleted')
  assert.match(phase3Sql, /v_skipped_count/, 'must track skipped movements')
})

test('Phase 3 SQL recipe RPCs have explicit lodge role guards', () => {
  for (const functionName of ['record_recipe_stock_depletion', 'get_restaurant_recipes']) {
    const start = phase3RoleHardeningSql.indexOf(`function public.${functionName}`)
    assert.notEqual(start, -1, `${functionName} hardening function must exist`)
    const nextFunction = phase3RoleHardeningSql.indexOf('create or replace function public.', start + 1)
    const body = phase3RoleHardeningSql.slice(start, nextFunction > 0 ? nextFunction : undefined)
    assert.match(body, /app_require_lodge_role/, `${functionName} must require a lodge role`)
  }
})

test('Phase 3 SQL stock movement rows are traceable to order and recipe', async () => {
  const phase3Sql = await readFile(new URL('../supabase/migrations/20260708140000_restaurant_phase3_recipes.sql', import.meta.url), 'utf8')
  // Movement table must have all traceability columns
  assert.match(phase3Sql, /order_id uuid/, 'must have order_id')
  assert.match(phase3Sql, /order_item_id uuid/, 'must have order_item_id')
  assert.match(phase3Sql, /recipe_id uuid/, 'must have recipe_id')
  assert.match(phase3Sql, /recipe_version integer/, 'must have recipe_version')
  assert.match(phase3Sql, /inventory_item_id uuid/, 'must have inventory_item_id')
})

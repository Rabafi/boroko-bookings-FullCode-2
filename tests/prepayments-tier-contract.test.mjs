import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  COMMERCIAL_PRODUCT_IDS,
  getCommercialEntitlementKeys,
  getCommercialOffer
} from '../src/shared/commercialEntitlements.js'
import { buildCapabilitySnapshot } from '../src/shared/accessControl.js'
import {
  getModuleByKey,
  resolveModuleVisibility,
  MODULE_VISIBILITY_STATES
} from '../src/shared/moduleCatalog.js'
import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'

const root = process.cwd()
const read = (file) => readFileSync(resolve(root, file), 'utf8')
const migrations = readdirSync(resolve(root, 'supabase/migrations'))
  .filter((file) => file.endsWith('.sql'))
  .map((file) => ({ file, source: read(`supabase/migrations/${file}`) }))
const migrationSource = migrations.map(({ source }) => source).join('\n')

const PRODUCT = COMMERCIAL_PRODUCT_IDS.LODGE_CAMP
const STARTER = 'starter'
const STANDARD = 'standard'
const PRO = 'pro'
const BASIC_FEATURE = 'prepayments_basic'
const MANAGEMENT_FEATURE = 'prepayments_management'
const ADVANCED_FEATURE = 'prepayments_advanced'

const desktopPrepayments = read('src/renderer/src/components/Prepayments.jsx')
const desktopNavSource = read('src/renderer/src/navigation/desktopNav.js')
const appSource = read('src/renderer/src/App.jsx')
const accessSource = read('src/shared/accessControl.js')
const commercialSource = read('src/shared/commercialEntitlements.js')
const subscriptionSource = read('src/shared/subscriptionPlans.js')
const moduleSource = read('src/shared/moduleCatalog.js')
const preloadSource = read('src/preload/index.js')
const mainSource = read('src/main/index.js')
const databaseSource = read('src/main/database.js')
const creditDomain = read('src/main/domains/customerCredit.js')
const syncQueueSource = read('src/shared/syncQueue.js')
const syncDomain = read('src/main/domains/syncShared.js')
const pwaPrepayments = read('manager-pwa/src/pages/Prepayments.jsx')
const pwaApp = read('manager-pwa/src/App.jsx')
const pwaApi = read('manager-pwa/src/lib/api.js')

function handlerBody(source, channel) {
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = source.match(new RegExp(`ipcMain\\.handle\\('${escaped}'[\\s\\S]*?(?=\\n\\s*ipcMain\\.handle\\(|\\n\\s*// --|$)`))
  assert.ok(match, `missing IPC handler ${channel}`)
  return match[0]
}

function migrationFunction(source, functionName) {
  const start = source.indexOf(`create or replace function public.${functionName}`)
  assert.ok(start >= 0, `missing migration function ${functionName}`)
  const body = source.slice(start)
  const next = body.search(/\ncreate or replace function public\./i)
  return body.slice(0, next >= 0 ? next : body.length)
}

function featureKeys(packageKey) {
  return new Set(getCommercialEntitlementKeys({
    productId: PRODUCT,
    commercialPackageKey: packageKey
  }))
}

test('Starter exposes the basic prepayment contract and keeps advanced tools out', () => {
  const starter = featureKeys(STARTER)
  const standard = featureKeys(STANDARD)
  const pro = featureKeys(PRO)

  assert.equal(starter.has(BASIC_FEATURE), true, 'Starter must include basic Prepayments')
  assert.equal(standard.has(BASIC_FEATURE), true, 'Standard must retain basic Prepayments')
  assert.equal(pro.has(BASIC_FEATURE), true, 'Pro must retain basic Prepayments')

  assert.equal(starter.has(MANAGEMENT_FEATURE), false, 'Starter must not include management-only prepayment tools')
  assert.equal(starter.has(ADVANCED_FEATURE), false, 'Starter must not include advanced prepayment tools')
  assert.equal(standard.has(MANAGEMENT_FEATURE), true, 'Standard must include prepayment management')
  assert.equal(standard.has(ADVANCED_FEATURE), false, 'Standard must not include Pro-only prepayment tools')
  assert.equal(pro.has(MANAGEMENT_FEATURE), true, 'Pro must retain Standard prepayment management')
  assert.equal(pro.has(ADVANCED_FEATURE), true, 'Pro must include advanced prepayment tools')

  const hotelCore = new Set(getCommercialEntitlementKeys({
    productId: COMMERCIAL_PRODUCT_IDS.HOTEL,
    commercialPackageKey: 'hotel_core'
  }))
  assert.equal(hotelCore.has(BASIC_FEATURE), true, 'Hotel Core must include basic Prepayments')
  assert.equal(hotelCore.has(MANAGEMENT_FEATURE), true, 'Hotel Core must include Prepayments management')
  assert.equal(hotelCore.has(ADVANCED_FEATURE), true, 'Hotel Core must include advanced Prepayments')
  for (const posPackage of ['bar_pos', 'restaurant_service', 'restaurant_control', 'restaurant_growth']) {
    const posFeatures = new Set(getCommercialEntitlementKeys({
      productId: COMMERCIAL_PRODUCT_IDS.HOSPITALITY_POS,
      commercialPackageKey: posPackage
    }))
    assert.equal(posFeatures.has(BASIC_FEATURE), false, `${posPackage} must not inherit lodging Prepayments`)
    assert.equal(posFeatures.has(MANAGEMENT_FEATURE), false, `${posPackage} must not inherit Prepayments management`)
    assert.equal(posFeatures.has(ADVANCED_FEATURE), false, `${posPackage} must not inherit advanced Prepayments`)
  }

  const starterOffer = getCommercialOffer(PRODUCT, STARTER)
  assert.ok(starterOffer)
  assert.ok(starterOffer.includedFeatures.includes(BASIC_FEATURE))
  assert.match(commercialSource, /prepayments_management/)
  assert.match(commercialSource, /prepayments_advanced/)
  assert.match(subscriptionSource, /prepayments_management/)
  assert.match(subscriptionSource, /prepayments_advanced/)
})

test('Prepayments module, route, package catalogue, and navigation stay one consistent contract', () => {
  const module = getModuleByKey(BASIC_FEATURE)
  assert.ok(module, 'module catalog must contain the basic Prepayments module')
  assert.equal(module.requiredPlan, 'Starter')
  assert.deepEqual(module.routes, ['/prepayments'])
  assert.ok(module.capabilities.includes('invoices.view') || module.capabilities.includes('prepayments.view'))

  assert.equal(resolveModuleVisibility(BASIC_FEATURE, 'lodge', 'Starter'), MODULE_VISIBILITY_STATES.visible)
  assert.equal(resolveModuleVisibility(BASIC_FEATURE, 'lodge', 'Standard'), MODULE_VISIBILITY_STATES.visible)
  assert.equal(resolveModuleVisibility(BASIC_FEATURE, 'lodge', 'Pro'), MODULE_VISIBILITY_STATES.visible)

  const access = { allowedByRole: {
    'invoices.view': true,
    'payments.record': true,
    'payments.refund': true,
    'prepayments.view': true,
    'prepayments.receive': true,
    'prepayments.allocate': true,
    'prepayments.refund': true,
    'prepayments.reverse': true
  } }
  const nav = getDesktopNavItems('lodge', access, 'lodge', 'Starter', [], null, PRODUCT)
  const prepaymentsNav = nav.find((item) => item.to === '/prepayments')
  assert.ok(prepaymentsNav, 'Starter navigation must show Prepayments')
  assert.equal(prepaymentsNav.moduleKey, BASIC_FEATURE)
  assert.equal(prepaymentsNav.feature, BASIC_FEATURE)
  assert.equal(prepaymentsNav.tier, 'Starter')
  assert.ok(prepaymentsNav.capability, 'Prepayments nav must be capability-gated')
  assert.match(desktopNavSource, /moduleKey:\s*['"]prepayments_basic['"]/)
  assert.match(appSource, /path=["']prepayments["']/)
  assert.match(moduleSource, /key:\s*['"]prepayments_basic['"][\s\S]{0,700}routes:\s*\[['"]\/prepayments['"]\]/)
})

test('Starter supports read, receive, receipt, and allocation while Standard/Pro expose management depth by tier', () => {
  assert.match(desktopPrepayments, /customerCredit\.getSummary/)
  assert.match(desktopPrepayments, /customerCredit\.getBalance/)
  assert.match(desktopPrepayments, /customerCredit\.getHistory/)
  assert.match(desktopPrepayments, /customerCredit\.record/)
  assert.match(desktopPrepayments, /customerCredit\.applyToBooking/)
  assert.match(desktopPrepayments, /receipts\.(?:printCurrent|savePDF)/)
  assert.match(desktopPrepayments, /does not reserve accommodation or guarantee room availability/i)
  assert.match(desktopPrepayments, /Open receipt/)

  assert.match(accessSource, /prepayments_management/)
  assert.match(accessSource, /prepayments_advanced/)
  assert.match(moduleSource, /key:\s*['"]prepayments_management['"][\s\S]{0,500}requiredPlan:\s*['"]Standard['"]/)
  assert.match(moduleSource, /key:\s*['"]prepayments_advanced['"][\s\S]{0,500}requiredPlan:\s*['"]Pro['"]/)
  assert.match(desktopNavSource, /tier:\s*['"]Standard['"]/)
  assert.match(desktopNavSource, /tier:\s*['"]Pro['"]/)
})

test('role and capability checks fail closed at the direct IPC boundary', () => {
  const readChannels = ['customerCredit:getBalance', 'customerCredit:getHistory', 'customerCredit:getSummary']
  for (const channel of readChannels) {
    const body = handlerBody(mainSource, channel)
    assert.match(body, /requireCapability\(['"](?:invoices\.view|prepayments\.view)['"]\)/)
    assert.match(body, /db\.getCustomerCredit(?:Balance|History|Summary)/)
  }

  for (const channel of ['customerCredit:record', 'customerCredit:applyToBooking']) {
    const body = handlerBody(mainSource, channel)
    assert.match(body, /requireCapability\(['"](?:payments\.record|prepayments\.receive|prepayments\.allocate)['"]\)/)
    assert.match(body, /db\.(?:recordCustomerCredit|applyCustomerCreditToBooking)/)
  }

  for (const channel of ['customerCredit:refund', 'customerCredit:reverse']) {
    const body = handlerBody(mainSource, channel)
    assert.match(body, /requireCapability\(['"](?:payments\.refund|prepayments\.refund|prepayments\.reverse)['"]\)/)
    assert.match(body, /db\.(?:refundCustomerCredit|reverseCustomerCreditEntry)/)
  }

  assert.match(preloadSource, /record:\s*\(data\)\s*=>\s*invoke\(['"]customerCredit:record['"]\s*,\s*data\)/)
  assert.match(preloadSource, /refund:\s*\(data\)\s*=>\s*invoke\(['"]customerCredit:refund['"]\s*,\s*data\)/)
  assert.match(databaseSource, /recordCustomerCredit/)
  assert.match(databaseSource, /refundCustomerCredit/)

  const tierMigration = migrations.find(({ file }) => file.includes('prepayments_tier_controls'))?.source || ''
  assert.ok(tierMigration, 'tier capability migration must be present')
  const featureMap = tierMigration.match(/v_feature\s*:=\s*case[\s\S]*?else\s+null\s*end;/i)?.[0] || ''
  assert.match(featureMap, /prepayments\.view['"]?\s+then\s+'prepayments_basic'/i)
  assert.match(featureMap, /prepayments\.receive['"]?\s+then\s+'prepayments_basic'/i)
  assert.match(featureMap, /when p_capability (?:=\s*'prepayments\.allocate'|in\s*\([^)]*'prepayments\.allocate'[^)]*\))\s+then\s+'prepayments_basic'/i)
  assert.match(featureMap, /prepayments\.(?:refund|reverse)[\s\S]{0,120}then\s+'prepayments_basic'/i)
  assert.match(featureMap, /prepayments\.(?:reconcile|export)[\s\S]{0,120}then\s+'prepayments_management'/i)
  assert.match(featureMap, /prepayments\.(?:age|match|configure)[\s\S]{0,120}then\s+'prepayments_advanced'/i)
})

test('downgrade retains confirmed prepayment reads and never turns a locked module into a destructive reset', () => {
  assert.equal(resolveModuleVisibility(BASIC_FEATURE, 'lodge', 'Starter'), MODULE_VISIBILITY_STATES.visible)
  assert.equal(resolveModuleVisibility(BASIC_FEATURE, 'lodge', 'Standard'), MODULE_VISIBILITY_STATES.visible)
  assert.equal(resolveModuleVisibility(BASIC_FEATURE, 'lodge', 'Pro'), MODULE_VISIBILITY_STATES.visible)
  assert.match(moduleSource, /requiredPlan:\s*['"]Starter['"][\s\S]{0,700}key:\s*['"]prepayments_basic['"]|key:\s*['"]prepayments_basic['"][\s\S]{0,700}requiredPlan:\s*['"]Starter['"]/)
  assert.match(migrationSource, /downgrade|entitlement|prepayments/i)
  assert.doesNotMatch(migrationSource, /delete\s+from\s+public\.customer_credit_ledger[\s\S]{0,120}(?:downgrade|entitlement)/i)
})

test('refunds and reversals require a reason, authenticated authorization, and one compensating ledger effect', () => {
  const refundBody = handlerBody(mainSource, 'customerCredit:refund')
  const reverseBody = handlerBody(mainSource, 'customerCredit:reverse')
  assert.match(refundBody, /payments\.refund|prepayments\.refund/)
  assert.match(reverseBody, /payments\.refund|prepayments\.reverse/)
  assert.match(desktopPrepayments, /refund/i)
  assert.match(desktopPrepayments, /reason|notes/i)
  assert.match(desktopPrepayments, /prompt\(['"]Reason for reversing this entry/i)
  assert.match(desktopPrepayments, /Reason[\s\S]{0,220}textarea[^>]*required/i)

  const refundSql = migrationSource.match(/(?:create|replace)\s+function\s+public\.refund_customer_credit[\s\S]*?(?=\n(?:create|alter|revoke|grant)\s)/i)?.[0] || ''
  const reverseSql = migrationSource.match(/(?:create|replace)\s+function\s+public\.reverse_customer_credit_entry[\s\S]*?(?=\n(?:create|alter|revoke|grant)\s)/i)?.[0] || ''
  assert.match(refundSql, /app_require_lodge_role|manager|admin|super_admin/i)
  assert.match(reverseSql, /app_require_lodge_role|manager|admin|super_admin/i)
  const tierMigration = migrations.find(({ file }) => file.includes('prepayments_tier_controls'))?.source || ''
  assert.match(tierMigration, /create or replace function public\._prepayments_require_reason[\s\S]{0,500}nullif\(btrim\(coalesce\(p_reason/i)
  assert.match(tierMigration, /refund_customer_credit[^\n]*[\s\S]{0,500}prepayments\.refund[^\n]*[\s\S]{0,120}['"]refund['"]/i)
  assert.match(tierMigration, /reverse_customer_credit_entry[^\n]*[\s\S]{0,500}prepayments\.reverse[^\n]*[\s\S]{0,120}['"]reverse['"]/i)
  assert.match(tierMigration, /v_guard[\s\S]{0,500}_prepayments_require_reason\(p_notes/i)
  assert.match(reverseSql, /reversal_(?:in|out)|reverses_entry_id/i)
  assert.match(reverseSql, /already been reversed|cannot be reversed/i)
})

test('financial mutations use authoritative RPCs, stable idempotency, ledger entries, and audit evidence', () => {
  for (const rpc of [
    'record_customer_credit',
    'apply_customer_credit_to_booking',
    'refund_customer_credit',
    'reverse_customer_credit_entry'
  ]) {
    assert.match(creditDomain, new RegExp(`\\.rpc\\(['"]${rpc}['"]`), `${rpc} must be invoked through Supabase RPC`)
    assert.match(syncQueueSource, new RegExp(`['"]${rpc}['"]`), `${rpc} must be a known financial queue operation`)
  }
  assert.match(syncDomain, /record_customer_credit/, 'customer-credit receipt replay must be handled')
  assert.doesNotMatch(creditDomain, /from\(['"]customer_credit_ledger['"]\)\.(?:insert|update|delete)/)
  assert.match(creditDomain, /idempotencyKey/)
  assert.match(creditDomain, /p_idempotency_key:\s*idempotencyKey/)
  assert.match(creditDomain, /queueOperation\(['"]rpc['"]/)
  assert.match(migrationSource, /customer_credit_ledger/)
  assert.match(migrationSource, /_claim_financial_operation|financial_operation_idempotency/)
  assert.match(migrationSource, /financial_audit_log/)
  assert.match(migrationSource, /customer_credit_(?:received|allocated|refunded|reversed)/)
})

test('tier migration backfills entitlements without rewriting license or commercial identity', () => {
  const tierMigration = migrations.find(({ file }) => file.includes('prepayments_tier_controls'))?.source || ''
  assert.ok(tierMigration, 'tier capability migration must be present')

  // Legacy accommodation rows may be inspected to infer a package, but the
  // migration must never normalize the source license/product identity.
  assert.match(tierMigration, /with eligible_licen[cs]es[\s\S]{0,2500}from public\.licenses/i)
  assert.match(tierMigration, /left join public\.settings/i)
  assert.match(tierMigration, /insert into public\.lodge_features/i)
  assert.doesNotMatch(tierMigration, /\bupdate\s+public\.licenses\b/i)
  assert.doesNotMatch(tierMigration, /\bdelete\s+from\s+public\.licenses\b/i)
  assert.doesNotMatch(tierMigration, /\binsert\s+into\s+public\.licenses\b/i)
  assert.doesNotMatch(tierMigration, /\bset\s+(?:product_id|commercial_package_key|subscription_plan)\s*=/i)

  // Catalog feature materialization is allowed, but must not mutate the
  // commercial identity fields used to determine the package itself.
  const catalogUpdate = tierMigration.match(/\bupdate\s+public\.commercial_package_prices[\s\S]*?(?=\n(?:insert|with|create|alter|revoke|grant)\b)/i)?.[0] || ''
  assert.match(catalogUpdate, /set\s+included_features\s*=/i)
  assert.doesNotMatch(catalogUpdate, /set[\s\S]{0,300}\b(?:product_id|commercial_package_key|subscription_plan)\s*=/i)
})

test('Standard export is authoritative, cancellation-safe, and spreadsheet-safe', () => {
  const exportHandler = handlerBody(mainSource, 'prepayments:export')
  assert.match(exportHandler, /requireCapability\(['"]prepayments\.export['"]\)/)
  assert.match(exportHandler, /db\.exportPrepayments\(/)
  assert.match(exportHandler, /dialog\.showSaveDialog\(/)
  assert.match(exportHandler, /buildPrepaymentExportCsv\(/)
  assert.match(exportHandler, /fs\.writeFileSync\(/)

  const cancelStart = exportHandler.search(/if\s*\(\s*result\.canceled\s*\|\|\s*!result\.filePath\s*\)/)
  const writeStart = exportHandler.indexOf('fs.writeFileSync')
  assert.ok(cancelStart >= 0, 'export must branch on save-dialog cancellation')
  assert.ok(writeStart > cancelStart, 'export must not write before cancellation is handled')
  const cancelBlock = exportHandler.slice(cancelStart, writeStart)
  assert.match(cancelBlock, /success\s*:\s*false/)
  assert.match(cancelBlock, /canceled\s*:\s*true/)

  assert.match(mainSource, /function safePrepaymentCsvCell/)
  assert.ok(mainSource.includes('/^[=+\\-@]/'), 'prepayment text cells must neutralize spreadsheet formula prefixes')
  assert.match(mainSource, /key\s*===\s*['"]amount['"]\s*\?\s*csvCell\(value\)\s*:\s*safePrepaymentCsvCell\(value\)/)
})

test('Pro saved thresholds feed server-side ageing, matching, portfolio alerts, and the UI output', () => {
  const tierMigration = migrations.find(({ file }) => file.includes('prepayments_tier_controls'))?.source || ''
  assert.ok(tierMigration, 'tier capability migration must be present')
  const configRpc = migrationFunction(tierMigration, 'set_prepayment_config')
  const agingRpc = migrationFunction(tierMigration, 'get_prepayment_aging')
  const matchingRpc = migrationFunction(tierMigration, 'get_prepayment_matching_suggestions')
  const portfolioRpc = migrationFunction(tierMigration, 'get_prepayment_portfolio')

  assert.match(configRpc, /prepayment_configuration/)
  assert.match(configRpc, /aging_threshold_days/)
  assert.match(configRpc, /suggestion_window_days/)
  assert.match(configRpc, /matching_tolerance/)
  assert.match(configRpc, /prepayment_configuration_audit|financial_audit_log/)
  assert.match(agingRpc, /prepayment_configuration/)
  assert.match(agingRpc, /aging_threshold_days/)
  assert.match(agingRpc, /alerts/)
  assert.match(matchingRpc, /prepayment_configuration/)
  assert.match(matchingRpc, /suggestion_window_days/)
  assert.match(matchingRpc, /matching_tolerance/)
  assert.match(matchingRpc, /alerts/)
  assert.match(portfolioRpc, /prepayment_configuration/)
  assert.match(portfolioRpc, /aging_threshold_days/)
  assert.match(portfolioRpc, /alerts/)

  // The DB contract currently persists exactly three ordered thresholds; the
  // operator form must not advertise values that the authoritative RPC rejects.
  assert.match(desktopPrepayments, /thresholds\.length\s*!==\s*3|exactly\s+three|three\s+ascending/i)
  assert.match(desktopPrepayments, /getAging|prepayments\.getAging/)
  assert.match(desktopPrepayments, /getMatchingSuggestions|prepayments\.getMatchingSuggestions/)
  assert.match(desktopPrepayments, /getConfig|prepayments\.getConfig/)
})

test('Pro UI renders server alert output and handles the authoritative export result', () => {
  assert.match(desktopPrepayments, /window\.api\.prepayments\.export\(/)
  assert.match(desktopPrepayments, /result\?\.(?:canceled|cancelled)/)
  assert.match(desktopPrepayments, /setExportResult\(result\)/)
  assert.match(desktopPrepayments, /fileName|filename/)
  assert.match(desktopPrepayments, /serverResponseRows\(agingData\?\.alerts\)|alertRows/)
  assert.match(desktopPrepayments, /Server-derived alerts/i)
  assert.match(desktopPrepayments, /alertRows\.map\(/)
})

test('prepayment PDF receipts preserve null amounts and pending or unavailable balance state', () => {
  const receiptStart = mainSource.indexOf('function buildPrepaymentReceiptPdfHtml')
  const receiptEnd = mainSource.indexOf('function buildPurchaseOrderPdfHtml', receiptStart)
  assert.ok(receiptStart >= 0 && receiptEnd > receiptStart, 'main process must expose the prepayment receipt builder')
  const receiptBuilder = mainSource.slice(receiptStart, receiptEnd)

  assert.match(receiptBuilder, /balanceState/)
  assert.match(receiptBuilder, /Pending server confirmation/i)
  assert.match(receiptBuilder, /unavailable|Unavailable/i)
  assert.doesNotMatch(receiptBuilder, /Number\(value\s*\|\|\s*0\)/)
  assert.doesNotMatch(receiptBuilder, /Number\(receipt\.(?:amount|balance)\s*\|\|\s*0\)/)
})

test('receive and refund operation UUIDs are created once at UI intent and reused through IPC, domain, and queue', () => {
  assert.match(desktopPrepayments, /crypto\.randomUUID\(\)|randomUUID\(\)|operationId|idempotencyKey/)
  assert.match(desktopPrepayments, /customerCredit\.record\([\s\S]{0,700}(?:idempotencyKey|operationId)/)
  assert.match(desktopPrepayments, /customerCredit\.refund\([\s\S]{0,700}(?:idempotencyKey|operationId)/)

  const receiveStart = creditDomain.indexOf('export async function recordCustomerCredit')
  const receiveEnd = creditDomain.indexOf('export async function applyCustomerCreditToBooking')
  const receiveBody = creditDomain.slice(receiveStart, receiveEnd)
  const refundStart = creditDomain.indexOf('export async function refundCustomerCredit')
  const refundEnd = creditDomain.indexOf('export async function reverseCustomerCreditEntry')
  const refundBody = creditDomain.slice(refundStart, refundEnd)
  assert.match(receiveBody, /callerIdempotencyKey|idempotencyKey/)
  assert.match(refundBody, /callerIdempotencyKey|idempotencyKey/)
  assert.match(receiveBody, /p_idempotency_key:\s*idempotencyKey/)
  assert.match(refundBody, /p_idempotency_key:\s*idempotencyKey/)
  assert.match(receiveBody, /queueOperation\(['"]rpc['"],\s*['"]record_customer_credit['"]/)
  assert.match(refundBody, /queueOperation\(['"]rpc['"],\s*['"]refund_customer_credit['"]/)
  assert.doesNotMatch(receiveBody, /idempotencyKey\s*=\s*[^\n]*Date\.now\(\)/)
  assert.doesNotMatch(refundBody, /idempotencyKey\s*=\s*[^\n]*Date\.now\(\)/)
})

test('remote read failures remain unavailable, not certified zero or empty', () => {
  const balanceStart = creditDomain.indexOf('export async function getCustomerCreditBalance')
  const balanceEnd = creditDomain.indexOf('export async function getCustomerCreditHistory')
  const balanceBody = creditDomain.slice(balanceStart, balanceEnd)
  const summaryStart = creditDomain.indexOf('export async function getCustomerCreditSummary')
  const summaryEnd = creditDomain.indexOf('export async function recordCustomerCredit')
  const summaryBody = creditDomain.slice(summaryStart, summaryEnd)

  const balanceCatch = balanceBody.match(/catch\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/)?.[0] || ''
  const summaryCatch = summaryBody.match(/catch\s*\([^)]*\)\s*\{[\s\S]*?\n\s*\}/)?.[0] || ''
  assert.doesNotMatch(balanceCatch, /return\s*\{\s*success:\s*true,\s*balance:\s*0/)
  assert.doesNotMatch(summaryCatch, /return\s*\[\]/)
  assert.match(balanceBody, /success:\s*false|unavailable|error|throw/i)
  assert.match(summaryBody, /success:\s*false|unavailable|error|throw/i)
  assert.match(desktopPrepayments, /Could not load|unavailable|Unavailable|error/i)
  assert.match(pwaPrepayments, /Could not load|unavailable|Unavailable|error/i)
  assert.match(desktopPrepayments, /amountLabel|summaryBalanceLabel|Pending confirmation|Unavailable/i)
  assert.doesNotMatch(desktopPrepayments, /money\(currency,\s*balance\)/)
  assert.doesNotMatch(desktopPrepayments, /money\(currency,\s*customer\.credit\?\.balance\s*\|\|\s*0\)/)
})

test('offline allocation is a pending local estimate and never authors payment_status', () => {
  const allocationStart = creditDomain.indexOf('export async function applyCustomerCreditToBooking')
  const allocationEnd = creditDomain.indexOf('export async function refundCustomerCredit')
  const allocationBody = creditDomain.slice(allocationStart, allocationEnd)
  const offlineStart = allocationBody.indexOf('if (!state.isOnline)')
  const onlineStart = allocationBody.indexOf('const { data: result')
  const offlineBody = allocationBody.slice(offlineStart, onlineStart > offlineStart ? onlineStart : undefined)

  assert.match(offlineBody, /_pending_payment|_financial_estimate|pending/i)
  assert.doesNotMatch(offlineBody, /payment_status\s*:/)
  assert.doesNotMatch(offlineBody, /payment_status\s*=/)
  assert.doesNotMatch(desktopPrepayments, /payment_status\s*[:=]/)
})

test('matching suggestions are read-only and Manager PWA remains read-only for prepayments', () => {
  assert.match(pwaApp, /path=["']\/prepayments["'][\s\S]{0,300}prepayments\.view/)
  assert.match(pwaPrepayments, /getCustomerCreditSummaryPwa/)
  assert.match(pwaApi, /getCustomerCreditSummaryPwa[\s\S]{0,240}assertCapability\('prepayments\.view'[\s\S]{0,60}\)/)
  assert.match(pwaApi, /get_customer_credit_summary|get_prepayment_portfolio/)
  assert.doesNotMatch(pwaPrepayments, /(?:customerCredit|supabase)\.(?:record|apply|refund|reverse)|(?:record|apply|refund|reverse)_customer_credit/)
  assert.doesNotMatch(desktopPrepayments, /reduce\(\s*\(sum[^)]*\)[\s\S]{0,100}(?:balance|amount_paid|payment)/i)
  assert.doesNotMatch(pwaPrepayments, /reduce\(\s*\(sum[^)]*\)[\s\S]{0,100}(?:balance|available_balance)/)

  const tierMigration = migrations.find(({ file }) => file.includes('prepayments_tier_controls'))?.source || ''
  const suggestionRpc = tierMigration.match(/create or replace function public\.get_prepayment_matching_suggestions[\s\S]*?(?=\ncreate or replace function|\nrevoke all on function|\n--)/i)?.[0] || ''
  assert.match(suggestionRpc, /read_only['"]?\s*,\s*true/i)
  assert.match(suggestionRpc, /auto_mutation['"]?\s*,\s*false/i)
  assert.doesNotMatch(suggestionRpc, /\b(?:insert|update|delete)\s+(?:into\s+)?public\./i)
})

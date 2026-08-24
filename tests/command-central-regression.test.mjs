import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { inferLicenseProductId } from '../src/main/domains/licenseAssignmentCompatibility.js'
import {
  COMMAND_CENTRAL_CAPABILITIES,
  assertCommandCentralTarget,
  assertMasterAdmin,
  createActorBoundElevationGate,
  createLoginFailureLimiter,
  getSessionMaxAgeMs,
  MASTER_ADMIN_SESSION_MAX_AGE_MS
} from '../src/main/commandCentralAuthorization.js'
import { buildCapabilitySnapshot } from '../src/shared/accessControl.js'

test('Command Central capabilities are present in a master-admin snapshot', () => {
  const master = buildCapabilitySnapshot({ isMasterAdmin: true })
  for (const capability of COMMAND_CENTRAL_CAPABILITIES) {
    assert.equal(master.capabilities[capability], true)
  }
})

test('master-admin guard rejects lodge-level super admins', () => {
  assert.throws(
    () => assertMasterAdmin({ id: 'user-1', role: 'super_admin', isMasterAdmin: false }),
    /master administrator/i
  )
  assert.equal(assertMasterAdmin({ id: 'master-1', isMasterAdmin: true }).id, 'master-1')
})

test('Command Central target guard rejects ambiguous renderer targets', () => {
  const id = 'dc878dfa-5cd4-49ff-9d6e-891ad37feb7a'
  assert.equal(assertCommandCentralTarget(id), id)
  assert.throws(() => assertCommandCentralTarget(''), /valid target company/i)
  assert.throws(() => assertCommandCentralTarget('not-a-lodge'), /valid target company/i)
})

test('commercial billing remains a separate service-role-only ledger with retry-safe operations', () => {
  const foundation = fs.readFileSync(new URL('../supabase/migrations/20260721150000_command_central_control_plane_foundation.sql', import.meta.url), 'utf8')
  const billing = fs.readFileSync(new URL('../supabase/migrations/20260721151000_command_central_commercial_billing.sql', import.meta.url), 'utf8')
  assert.match(foundation, /create table if not exists public\.commercial_invoices/i)
  assert.match(foundation, /create table if not exists public\.commercial_payments/i)
  assert.match(billing, /command_central_claim_operation/i)
  assert.match(billing, /commercial_pricing_snapshot/i)
  assert.match(billing, /revoke all on function public\.admin_generate_commercial_invoice/i)
  assert.doesNotMatch(billing, /public\.invoices/i)
})

test('lodge support requests cannot trust a renderer-supplied company target', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  const handlerStart = ipc.indexOf("ipcMain.handle('admin:createSupportTicket'")
  const handlerEnd = ipc.indexOf("ipcMain.handle('admin:updateSupportTicket'", handlerStart)
  const handler = ipc.slice(handlerStart, handlerEnd)
  assert.match(handler, /lodge_id: user\?\.lodge_id \|\| activeProfile\?\.lodge_id/i)
  assert.match(handler, /if \(!ticketData\.lodge_id\) throw new Error/i)
})

test('company lifecycle uses the governed service-role contract, not legacy direct archive IPC', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  const lifecycle = fs.readFileSync(new URL('../supabase/migrations/20260721152000_command_central_company_lifecycle.sql', import.meta.url), 'utf8')
  assert.match(ipc, /admin:applyCompanyLifecycle/)
  assert.match(ipc, /Use the governed company lifecycle workflow with a recorded reason/)
  assert.match(lifecycle, /for update/)
  assert.match(lifecycle, /command_central_claim_operation/)
  assert.match(lifecycle, /v_operation_id is null or v_lodge_id is null/i)
  assert.match(lifecycle, /company_lifecycle_requests/)
  assert.match(lifecycle, /when others[\s\S]*command_central_fail_operation/i)
  assert.match(lifecycle, /revoke all on function public\.admin_apply_company_lifecycle/i)
})

test('company archive revokes active access and restore uses captured state', () => {
  const lifecycle = fs.readFileSync(new URL('../supabase/migrations/20260721160000_command_central_company_access_revocation.sql', import.meta.url), 'utf8')
  assert.match(lifecycle, /command_central_lifecycle_user_snapshots/i)
  assert.match(lifecycle, /command_central_lifecycle_license_snapshots/i)
  assert.match(lifecycle, /update public\.app_sessions set revoked_at/i)
  assert.match(lifecycle, /status = 'inactive'/i)
  assert.match(lifecycle, /offline_lease_days = 0/i)
  assert.match(lifecycle, /restore.*from snapshot|snapshots/i)
})

test('release control is product-scoped and an update-gate failure is not a false no-update result', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260721153000_product_scoped_release_control.sql', import.meta.url), 'utf8')
  const taskCenter = fs.readFileSync(new URL('../src/main/domains/taskcenter.js', import.meta.url), 'utf8')
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  assert.match(migration, /app_check_product_update_availability/i)
  assert.match(migration, /where product_id = p_product_id/i)
  assert.match(taskCenter, /p_product_id: getRuntimeProductId\(\)/)
  const handler = ipc.slice(ipc.indexOf("ipcMain.handle('admin:checkUpdateAvailability'"), ipc.indexOf("ipcMain.handle('admin:getReleases'"))
  assert.match(handler, /ok: false/)
})

test('subscription assignment is governed by a stable operation and audit envelope', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260721154000_governed_commercial_subscription_assignment.sql', import.meta.url), 'utf8')
  const domain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  assert.match(migration, /admin_governed_assign_commercial_subscription/i)
  assert.match(migration, /command_central_claim_operation/i)
  assert.match(migration, /command_central_audit_events/i)
  assert.match(migration, /v_operation_id is null or v_lodge_id is null/i)
  assert.match(migration, /when others[\s\S]*command_central_fail_operation/i)
  assert.match(domain, /admin_governed_assign_commercial_subscription/i)
  assert.match(domain, /stable operation ID is required/i)
})

test('multi-product licensing keeps assignments and add-ons product-scoped', () => {
  const component = fs.readFileSync(new URL('../src/renderer/src/components/LicensingWorkbench.jsx', import.meta.url), 'utf8')
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260721157000_command_central_product_assignment_integrity.sql', import.meta.url), 'utf8')
  assert.match(component, /function assignmentKey\(lodgeId, productId\)/)
  assert.match(component, /assignmentKey\(license\.lodge_id, license\.product_id/)
  assert.match(component, /selected_addon_keys: form\.selected_addon_keys/)
  assert.match(component, /getCommercialAddonOffers/)
  assert.match(migration, /licenses_active_lodge_product_unique/i)
  assert.doesNotMatch(migration, /coalesce\(issued_at, created_at/i)
  assert.match(migration, /where lodge_id = v_lodge_id and product_id = v_product_id/i)
  assert.match(migration, /selected_addon_keys/i)
})

test('legacy and trial assignments remain visible in the product-scoped licensing desk', () => {
  const component = fs.readFileSync(new URL('../src/renderer/src/components/LicensingWorkbench.jsx', import.meta.url), 'utf8')
  const domain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  assert.match(component, /return 'Trial'/)
  assert.match(component, /Migrate assignment/)
  assert.match(component, /existing && !existing\._product_inferred/)
  assert.match(domain, /LICENSE_PRODUCT_COMPAT_SELECT/)
  assert.match(domain, /product_id: inferLicenseProductId\(company, entitlement\)/)
  assert.match(domain, /activeByAssignment/)
  assert.equal(inferLicenseProductId({ property_type: 'restaurant' }, { business_type: 'lodge' }), 'hospitality-pos')
  assert.equal(inferLicenseProductId({ property_type: 'hotel' }, null), 'hotel')
  assert.equal(inferLicenseProductId({ property_type: 'hotel' }, { product_id: 'lodge-camp' }), 'lodge-camp')
})

test('subscription request activation uses the governed operation wrapper', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260721161000_governed_subscription_request_activation.sql', import.meta.url), 'utf8')
  const domain = fs.readFileSync(new URL('../src/main/domains/subscriptionRequests.js', import.meta.url), 'utf8')
  const component = fs.readFileSync(new URL('../src/renderer/src/components/SubscriptionRequests.jsx', import.meta.url), 'utf8')
  assert.match(migration, /admin_governed_activate_subscription_request/i)
  assert.match(migration, /command_central_claim_operation/i)
  assert.match(migration, /update_subscription_contract/i)
  assert.match(migration, /activate_subscription_request/i)
  assert.match(domain, /admin_governed_activate_subscription_request/i)
  assert.doesNotMatch(domain, /from\('licenses'\)\.update/i)
  assert.doesNotMatch(domain, /from\('lodge_features'\)\.upsert/i)
  assert.match(component, /operation_id: crypto\.randomUUID\(\)/i)
})

test('Command Central subscription activation has an exact target, fresh operator identity, and no pre-approval bypass', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  const component = fs.readFileSync(new URL('../src/renderer/src/components/SubscriptionRequests.jsx', import.meta.url), 'utf8')
  const workbench = fs.readFileSync(new URL('../src/renderer/src/components/LicensingWorkbench.jsx', import.meta.url), 'utf8')
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260816090000_command_central_subscription_truth_hardening.sql', import.meta.url), 'utf8')
  const activationHandler = ipc.slice(ipc.indexOf("ipcMain.handle('subscriptionRequests:activate'"), ipc.indexOf('ipcMain.handle(', ipc.indexOf("ipcMain.handle('subscriptionRequests:activate'") + 20))

  assert.match(activationHandler, /requireFreshCommandCentralReauth/)
  assert.match(activationHandler, /actor_id: admin\.id/)
  assert.match(activationHandler, /actor_email: admin\.email/)
  assert.match(component, /isActivationTargetLicense/)
  assert.match(component, /Select matching active license/)
  assert.match(component, /DarkConfirmDialog/)
  assert.match(component, /Activate approved subscription\?/)
  assert.match(workbench, /getEligibleCommercialOffers/)
  assert.match(workbench, /getEligibleCommercialAddons/)
  assert.match(workbench, /getCompanyOperatingProfile/)
  assert.match(migration, /drop function if exists public\.activate_subscription_request\(uuid\)/i)
  assert.match(migration, /v_request\.status <> 'approved'/)
  assert.doesNotMatch(migration, /approved', 'payment_under_review/)
  assert.match(migration, /predates annual add-on billing correction/)
})

test('Command Central subscription PDFs preserve itemised due-now and annual-renewal evidence', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  const pdfRenderer = ipc.slice(ipc.indexOf('function buildSubscriptionRequestDocumentPdfHtml'), ipc.indexOf('function buildDetailedReportPdfHtml'))
  assert.match(pdfRenderer, /Itemised Commercial Charges/)
  assert.match(pdfRenderer, /pricing\.lines/)
  assert.match(pdfRenderer, /Annual renewal/)
  assert.match(pdfRenderer, /Bar POS annual bundles include their first annual term/)
})

test('Finance Office uses commercial ledger reads and governed payment allocation', () => {
  const component = fs.readFileSync(new URL('../src/renderer/src/components/AdminCentral.jsx', import.meta.url), 'utf8')
  const domain = fs.readFileSync(new URL('../src/main/domains/commercialBilling.js', import.meta.url), 'utf8')
  assert.match(component, /getCommercialInvoices/)
  assert.match(component, /recordCommercialPayment/)
  assert.match(component, /Record governed payment/)
  assert.doesNotMatch(component, /window\.api\.admin\.createInvoice/)
  assert.doesNotMatch(component, /window\.api\.admin\.updateInvoice/)
  assert.doesNotMatch(component, /window\.api\.admin\.deleteInvoice/)
  assert.match(domain, /admin_record_commercial_payment/)
})

test('global Command Central reads and subscription requests require the master control-plane boundary', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  for (const channel of [
    'admin:getCompanies',
    'admin:getLicenses',
    'admin:getActivityLogs',
    'admin:getAuditSummary',
    'admin:getSupportTickets',
    'admin:getCompanyUsers',
    'subscriptionRequests:getAll',
    'subscriptionRequests:getById'
  ]) {
    const start = ipc.indexOf(`ipcMain.handle('${channel}'`)
    const end = ipc.indexOf('ipcMain.handle(', start + 20)
    assert.notEqual(start, -1, `${channel} handler is missing`)
    assert.match(ipc.slice(start, end === -1 ? undefined : end), /requireMasterAdmin\(\)/)
  }
  assert.match(ipc, /if \(user\?\.isMasterAdmin === true\) return/)
})

test('both desktop updater clients use the public product-scoped update gate', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260721153000_product_scoped_release_control.sql', import.meta.url), 'utf8')
  const legacy = fs.readFileSync(new URL('../legacy-pos/src/main/index.js', import.meta.url), 'utf8')
  assert.match(migration, /grant execute on function public\.app_check_product_update_availability\(text, text, text\) to anon, authenticated, service_role/i)
  assert.match(legacy, /app_check_product_update_availability/)
  assert.match(legacy, /p_product_id: LEGACY_POS_PRODUCT_ID/)
  assert.doesNotMatch(legacy, /app_check_update_availability'/)
})

test('feature overrides fail closed when their authoritative RPC is unavailable', () => {
  const domain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  const featureSection = domain.slice(domain.indexOf('export async function setLodgeFeature'), domain.indexOf('export async function getAllLodgeFeatures'))
  assert.match(featureSection, /No feature change was made/i)
  assert.doesNotMatch(featureSection, /from\('lodge_features'\)\.[\s\S]{0,100}upsert/i)
  assert.doesNotMatch(featureSection, /from\('lodge_features'\)\.[\s\S]{0,100}delete/i)
})

test('release readers propagate unavailable control-plane data instead of returning an empty release list', () => {
  const adminDomain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  const taskCenter = fs.readFileSync(new URL('../src/main/domains/taskcenter.js', import.meta.url), 'utf8')
  assert.match(adminDomain, /getScheduledReleases\(\)[\s\S]{0,300}throw new Error\(error\.message\)/)
  const releases = taskCenter.slice(taskCenter.indexOf('export async function getReleases'), taskCenter.indexOf('// ── Cross-Surface Intelligence'))
  assert.match(releases, /throw new Error\(error\.message\)/)
  assert.doesNotMatch(releases, /console\.error\('\[TaskCenter\] getReleases error/)
})

test('Companies desk does not fan out a stats query to every company on initial load', () => {
  const component = fs.readFileSync(new URL('../src/renderer/src/components/AdminCentral.jsx', import.meta.url), 'utf8')
  assert.match(component, /Usage signals load when a company is opened/i)
  assert.doesNotMatch(component, /const targets = visibleCompaniesBase\.filter\(\(company\) => !usageStatsByLodge/)
})

test('company statistics fail visibly instead of converting failed queries into zero activity', () => {
  const domain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  const component = fs.readFileSync(new URL('../src/renderer/src/components/AdminCentral.jsx', import.meta.url), 'utf8')
  const statsDomain = domain.slice(domain.indexOf('export async function getCompanyStats'), domain.indexOf('// ─── ADMIN: Licenses'))
  assert.match(statsDomain, /queryFailures/)
  assert.match(statsDomain, /Company statistics are unavailable/)
  assert.match(component, /Live statistics unavailable/)
  assert.match(component, /statsError \? 'Unavailable'/)
})

test('sensitive Command Central mutations require an actor-bound fresh reauthentication', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  const preload = fs.readFileSync(new URL('../src/preload/index.js', import.meta.url), 'utf8')
  const component = fs.readFileSync(new URL('../src/renderer/src/components/AdminCentral.jsx', import.meta.url), 'utf8')
  let clock = 1_000
  const gate = createActorBoundElevationGate({ ttlMs: 100, now: () => clock })
  assert.throws(() => gate.assertFresh('master-a'), /Re-authenticate Command Central/)
  assert.deepEqual(gate.grant('master-a'), { verified: true, expiresAt: 1_100 })
  assert.equal(gate.assertFresh('master-a'), true)
  assert.throws(() => gate.assertFresh('master-b'), /Re-authenticate Command Central/)
  gate.grant('master-a')
  clock = 1_100
  assert.throws(() => gate.assertFresh('master-a'), /Re-authenticate Command Central/)
  assert.match(ipc, /createActorBoundElevationGate/)
  for (const channel of [
    'admin:assignCommercialSubscription',
    'admin:createRelease',
    'admin:applyCompanyLifecycle',
    'admin:resetCompanyUserPassword',
    'admin:updateCompanyUserPwaAccess',
    'admin:deleteInvoice',
    'admin:createExpense',
    'admin:createBroadcast',
    'admin:updateSupportTicket',
    'admin:upsertNotificationRule',
    'admin:sendInvoiceEmail',
    'admin:createNotification',
    'admin:bulkUpdateStatus',
    'admin:bulkDelete',
    'admin:pushUpdateNotification'
  ]) {
    const start = ipc.indexOf(`ipcMain.handle('${channel}'`)
    const end = ipc.indexOf('ipcMain.handle(', start + 20)
    assert.notEqual(start, -1, `${channel} handler is missing`)
    assert.match(ipc.slice(start, end === -1 ? undefined : end), /requireFreshCommandCentralReauth/)
  }
  assert.match(preload, /getCommandCentralReauthStatus/)
  assert.match(preload, /reauthenticateCommandCentral/)
  assert.match(component, /Unlock changes/)
  assert.match(component, /High-risk changes remain unlocked for 10 minutes/)
})

test('sync queue failures are not reported as a healthy empty fleet', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  const start = ipc.indexOf("ipcMain.handle('admin:getSyncQueueStatus'")
  const end = ipc.indexOf('ipcMain.handle(', start + 20)
  const handler = ipc.slice(start, end)
  assert.match(handler, /ok: false/)
  assert.match(handler, /stale_count: null/)
  assert.doesNotMatch(handler, /ok: true, devices: \[\], stale_count: 0/)
})

test('Command Central diagnostics propagate service failures and retain evidence metadata', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  const health = fs.readFileSync(new URL('../src/renderer/src/components/SystemHealth.jsx', import.meta.url), 'utf8')
  for (const channel of [
    'admin:getSupportTickets',
    'admin:getActivityLogs',
    'admin:getNotifications',
    'admin:getNotificationRules',
    'admin:getFleetHealthRollup',
    'admin:getFleetHealthSummary',
    'admin:getBroadcasts',
    'admin:getExpenses',
    'admin:getLodgeFeatures',
    'admin:getInvoices',
    'admin:getInvoicesByLodge',
    'admin:getInvoiceSummary',
    'admin:getCompanyUsers'
  ]) {
    const start = ipc.indexOf(`ipcMain.handle('${channel}'`)
    const end = ipc.indexOf('ipcMain.handle(', start + 20)
    const handler = ipc.slice(start, end)
    assert.match(handler, /throw new Error/)
    assert.doesNotMatch(handler, /catch[^\n]*return \[\]|catch[^\n]*return null/)
  }
  assert.match(health, /checkedAt: new Date\(\)\.toISOString\(\)/)
  assert.match(health, /source: check\.method/)
  assert.match(health, /rowCount/)
  assert.match(health, /record\{result\.rowCount === 1/)
})

test('diagnostic history is service-role-only and stores sanitized bounded evidence', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260721155000_command_central_health_history.sql', import.meta.url), 'utf8')
  const domain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  const health = fs.readFileSync(new URL('../src/renderer/src/components/SystemHealth.jsx', import.meta.url), 'utf8')
  assert.match(migration, /create table if not exists public\.command_central_health_runs/i)
  assert.match(migration, /pg_column_size[\s\S]{0,100}> 200000/i)
  assert.match(migration, /jsonb_strip_nulls\(jsonb_build_object/i)
  assert.match(migration, /left\(item->>'error_message', 500\)/i)
  assert.match(migration, /revoke all on function public\.admin_record_command_central_health_run[\s\S]*from public, anon, authenticated/i)
  assert.match(migration, /grant execute on function public\.admin_record_command_central_health_run[\s\S]*to service_role/i)
  assert.match(domain, /admin_record_command_central_health_run/)
  assert.match(health, /recordCommandCentralHealthRun/)
  assert.match(health, /listCommandCentralHealthRuns/)
  assert.match(health, /Recent diagnostic runs/)
  assert.match(health, /History unavailable/)
})

test('audit explorer reads fail closed instead of falling back to unrelated activity rows', () => {
  const domain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260721159000_command_central_audit_read_model.sql', import.meta.url), 'utf8')
  const component = fs.readFileSync(new URL('../src/renderer/src/components/AdminCentral.jsx', import.meta.url), 'utf8')
  const audit = domain.slice(domain.indexOf('export async function getActivityLogs'), domain.indexOf('// ─── ADMIN: COMPANY STATS'))
  const writer = domain.slice(domain.indexOf('export async function logAdminActivity'), domain.indexOf('export async function getActivityLogs'))
  assert.match(audit, /audit history requires an online connection/)
  assert.match(audit, /if \(error\) throw new Error\(error\.message\)/)
  assert.doesNotMatch(audit, /from\('activity_logs'\)/)
  assert.match(audit, /get_command_central_audit_log/)
  assert.doesNotMatch(audit, /if \(error\) return \[\]/)
  assert.match(writer, /const \{ error \} = await state\.adminDb\.rpc\('log_admin_audit'/)
  assert.match(writer, /recorded: false/)
  assert.doesNotMatch(writer, /\.then\(\(\) => \{\}\)\.catch\(\(\) => \{\}\)/)
  assert.match(migration, /get_command_central_audit_log/)
  assert.match(migration, /command_central_audit_events/)
  assert.match(migration, /revoke execute on function public\.log_admin_audit[\s\S]*from authenticated/i)
  const explorer = component.slice(component.indexOf('function ActivityLog'), component.indexOf('// ════════════════════════════════════════════════════════════════════\n// SECTION: Email'))
  assert.match(explorer, /Promise\.allSettled/)
  assert.match(explorer, /Audit history could not be verified/)
  assert.doesNotMatch(explorer, /getActivityLogs\([^\n]*\.catch\(\(\) => \[\]\)/)
  const support = component.slice(component.indexOf('function SupportTickets'), component.indexOf('// ════════════════════════════════════════════════════════════════════\n// SECTION: Activity Log'))
  assert.match(support, /Support tickets could not be verified/)
  assert.doesNotMatch(support, /getSupportTickets\([^\n]*\.catch\(\(\) => \[\]\)/)
  const featureFlags = component.slice(component.indexOf('function FeatureFlags'), component.indexOf('function Broadcasts'))
  assert.match(featureFlags, /Feature overrides could not be verified/)
  assert.match(featureFlags, /Reload authoritative feature overrides before saving/)
  assert.doesNotMatch(featureFlags, /getLodgeFeatures\([^\n]*\.catch\(\(\) => \[\]\)/)
  const broadcasts = component.slice(component.indexOf('function Broadcasts'), component.indexOf('function SupportTickets'))
  assert.match(broadcasts, /Announcements could not be verified/)
  assert.doesNotMatch(broadcasts, /getBroadcasts\(\)\.catch\(\(\) => \[\]\)/)
  assert.match(component, /Company users could not be verified/)
  assert.doesNotMatch(component, /getCompanyUsers\(targetLodgeId\)\.catch\(\(\) => \[\]\)/)
})

test('support and governed assignment compatibility matches the linked control-plane schema', () => {
  const domain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  const repair = fs.readFileSync(new URL('../supabase/migrations/20260721163000_command_central_audit_dependency_repair.sql', import.meta.url), 'utf8')
  const support = domain.slice(domain.indexOf('export async function getSupportTickets'), domain.indexOf('export async function createSupportTicket'))
  assert.doesNotMatch(support, /updated_at, messages/)
  assert.match(repair, /create table if not exists public\.command_central_audit_events/i)
  assert.match(repair, /command_central_complete_operation/i)
  assert.match(repair, /command_central_fail_operation/i)
})

test('company settings edits use the governed operation and audit contract', () => {
  const migration = fs.readFileSync(new URL('../supabase/migrations/20260721156000_governed_company_settings_update.sql', import.meta.url), 'utf8')
  const domain = fs.readFileSync(new URL('../src/main/domains/admin.js', import.meta.url), 'utf8')
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  assert.match(migration, /admin_update_company_settings/i)
  assert.match(migration, /command_central_claim_operation/i)
  assert.match(migration, /for update/i)
  assert.match(migration, /STALE_VERSION/i)
  assert.match(migration, /command_central_complete_operation/i)
  assert.match(migration, /company_settings\.updated/i)
  assert.match(migration, /when others[\s\S]*command_central_fail_operation/i)
  assert.match(migration, /revoke all on function public\.admin_update_company_settings/i)
  const update = domain.slice(domain.indexOf('export async function updateCompany'), domain.indexOf('export async function archiveCompany'))
  assert.match(update, /admin_update_company_settings/)
  assert.doesNotMatch(update, /from\('settings'\)\.update/)
  const handler = ipc.slice(ipc.indexOf("ipcMain.handle('admin:updateCompany'"), ipc.indexOf("ipcMain.handle('admin:archiveCompany'"))
  assert.match(handler, /requireFreshCommandCentralReauth/)
  assert.match(handler, /crypto\.randomUUID\(\)/)
  assert.match(handler, /reason\.length < 8/)
  assert.doesNotMatch(handler, /Command Central company settings maintenance/)
  assert.match(update, /reason.*length < 8/)
})

test('legacy license write channels cannot bypass the governed subscription workflow', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  for (const channel of [
    'admin:createLicense',
    'admin:issueSubscriptionContract',
    'admin:updateLicense',
    'admin:deleteLicense',
    'admin:updateLicenseBilling'
  ]) {
    const start = ipc.indexOf(`ipcMain.handle('${channel}'`)
    const end = ipc.indexOf('ipcMain.handle(', start + 20)
    assert.notEqual(start, -1, `${channel} compatibility handler is missing`)
    const handler = ipc.slice(start, end === -1 ? undefined : end)
    assert.match(handler, /success: false/)
    assert.doesNotMatch(handler, /db\.(createLicense|issueSubscriptionContract|updateLicense|deleteLicense|updateLicenseBilling)/)
  }
  const assignment = ipc.slice(ipc.indexOf("ipcMain.handle('admin:assignCommercialSubscription'"), ipc.indexOf("ipcMain.handle('admin:issueSubscriptionContract'"))
  assert.match(assignment, /requireFreshCommandCentralReauth/)
})

test('Command Central bookkeeping does not invent invoice numbers or empty financial reads on service failure', () => {
  const finance = fs.readFileSync(new URL('../src/main/domains/finance.js', import.meta.url), 'utf8')
  const commercial = fs.readFileSync(new URL('../src/main/domains/commercialBilling.js', import.meta.url), 'utf8')
  const billingRead = fs.readFileSync(new URL('../supabase/migrations/20260721158000_command_central_commercial_billing_read_model.sql', import.meta.url), 'utf8')
  const component = fs.readFileSync(new URL('../src/renderer/src/components/AdminCentral.jsx', import.meta.url), 'utf8')
  assert.match(finance, /atomic invoice-number service is unavailable/i)
  assert.match(finance, /Failed to load invoices:/i)
  assert.match(finance, /Failed to load invoice summary:/i)
  const bookkeeping = component.slice(component.indexOf('function Bookkeeping'), component.indexOf('function SectionTabs'))
  assert.match(bookkeeping, /Promise\.allSettled/)
  assert.match(bookkeeping, /Authoritative bookkeeping data is unavailable/)
  assert.doesNotMatch(bookkeeping, /getInvoices\(\{\}\)\.catch\(\(\) => \[\]\)/)
  assert.match(bookkeeping, /getCommercialInvoices\(\{\}\)/)
  assert.doesNotMatch(bookkeeping, /window\.api\.admin\.createInvoice/)
  assert.match(commercial, /admin_list_commercial_invoices/)
  assert.match(commercial, /admin_get_commercial_billing_summary/)
  assert.match(billingRead, /commercial_invoice_account_period_unique/i)
  assert.match(billingRead, /billing_period/i)
})

test('master-admin login limiter locks repeated failures and resets successful identities', () => {
  let clock = 5_000
  const limiter = createLoginFailureLimiter({ maxFailures: 3, windowMs: 1_000, lockMs: 2_000, now: () => clock })
  assert.equal(limiter.recordFailure('ADMIN@EXAMPLE.COM').blocked, false)
  assert.equal(limiter.recordFailure('admin@example.com').blocked, false)
  const locked = limiter.recordFailure(' admin@example.com ')
  assert.equal(locked.blocked, true)
  assert.equal(locked.retryAfterMs, 2_000)
  assert.equal(limiter.get('another@example.com').blocked, false)
  clock += 2_000
  assert.equal(limiter.get('admin@example.com').blocked, false)
  limiter.recordFailure('admin@example.com')
  limiter.clear('admin@example.com')
  assert.equal(limiter.get('admin@example.com').failures, 0)
})

test('master-admin sessions use a short online control-plane lifetime', () => {
  assert.equal(MASTER_ADMIN_SESSION_MAX_AGE_MS, 4 * 60 * 60 * 1000)
  assert.equal(getSessionMaxAgeMs({ isMasterAdmin: true }), MASTER_ADMIN_SESSION_MAX_AGE_MS)
  assert.equal(getSessionMaxAgeMs({ isMasterAdmin: true }, { trustedUnlock: true }), MASTER_ADMIN_SESSION_MAX_AGE_MS)
  assert.ok(getSessionMaxAgeMs({ isMasterAdmin: false }, { trustedUnlock: true }) > MASTER_ADMIN_SESSION_MAX_AGE_MS)
  const authSession = fs.readFileSync(new URL('../src/main/domains/authSession.js', import.meta.url), 'utf8')
  assert.match(authSession, /if \(session\?\.isMasterAdmin\) return false/)
  assert.match(authSession, /password && !record\.isMasterAdmin/)
  assert.match(authSession, /forgetTrustedSession \|\| wasMasterAdmin/)
})

test('Implementation and add-on administration requires an explicit tenant target', () => {
  const ipc = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
  const component = fs.readFileSync(new URL('../src/renderer/src/components/AdminCentral.jsx', import.meta.url), 'utf8')
  const workflow = fs.readFileSync(new URL('../src/main/domains/enterpriseOperations.js', import.meta.url), 'utf8')
  const payments = fs.readFileSync(new URL('../src/main/domains/payments.js', import.meta.url), 'utf8')
  assert.match(component, /Select a company before loading or changing implementation data/)
  assert.match(component, /ImplementationAddons companies=\{companies\}/)
  assert.match(component, /PaymentGatewayConfig lodgeId=\{selectedLodgeId\}/)
  assert.match(ipc, /payments:getProviderConfig'[\s\S]{0,300}assertCommandCentralTarget\(lodgeId\)/)
  assert.match(ipc, /enterpriseOperations:upsertRecord'[\s\S]{0,220}requireFreshCommandCentralReauth/)
  assert.match(workflow, /`\$\{CACHE_KEY\}:\$\{lodgeId\}:\$\{workflowKey\}`/)
  assert.match(workflow, /if \(lodgeIdArg\) throw error/)
  assert.match(payments, /payment-dashboard:\$\{currentLodgeId\}/)
  assert.match(payments, /if \(lodgeIdArg\) throw error/)
})

test('Command Central heavy workspaces are lazy-loaded instead of inflating the initial console chunk', () => {
  const component = fs.readFileSync(new URL('../src/renderer/src/components/AdminCentral.jsx', import.meta.url), 'utf8')
  assert.match(component, /const LicensingWorkbench = lazy\(\(\) => import\('\.\/LicensingWorkbench'\)\)/)
  assert.match(component, /const SystemHealth = lazy\(\(\) => import\('\.\/SystemHealth'\)\)/)
  assert.match(component, /<Suspense fallback=/)
})

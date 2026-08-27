import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isCommercialFeatureIncluded } from '../src/shared/commercialAccess.js'
import { getCommercialOffer } from '../src/shared/commercialEntitlements.js'
import { getPlanFeatureMap } from '../src/main/domains/subscriptionState.js'

const read = (file) => fs.readFileSync(file, 'utf8')
const domain = read('src/main/domains/starterBackup.js')
const main = read('src/main/index.js')
const preload = read('src/preload/index.js')
const database = read('src/main/database.js')
const ui = read('src/renderer/src/components/StarterBackup.jsx')
const app = read('src/renderer/src/App.jsx')
const nav = read('src/renderer/src/navigation/desktopNav.js')
const access = read('src/shared/accessControl.js')
const commercial = read('src/shared/commercialEntitlements.js')
const plans = read('src/shared/subscriptionPlans.js')
const catalog = read('src/shared/moduleCatalog.js')
const identity = read('src/shared/productIdentity.js')
const subscriptionState = read('src/main/domains/subscriptionState.js')
const entitlementMigration = read('supabase/migrations/20260824065000_starter_backup_entitlement.sql')

test('Starter backup is a customer-owned, support-led JSON core-data artifact', () => {
  assert.match(domain, /tsa-bonno-starter-backup\/v1/)
  for (const table of ['settings', 'rooms', 'customers', 'bookings', 'quotations', 'signed_payment_ledger', 'maintenance']) {
    assert.match(domain, new RegExp(`key: '${table}'`))
  }
  assert.match(domain, /restore_mode: 'support-led'/)
  assert.match(domain, /live_restore_available: false/)
  assert.match(domain, /Customer-owned JSON export/)
  assert.match(domain, /contains_personal_data: true/)
  assert.match(domain, /Treat this file as confidential/)
  assert.match(domain, /delete safe\.lodge_mesh_secret/)
  assert.match(domain, /delete safe\.idempotency_key/)
  assert.match(domain, /Connection secrets and payment idempotency keys are intentionally excluded/)
  assert.match(domain, /sha256/)
})

test('Starter backup refuses ambiguous lodge scope and exposes completeness evidence', () => {
  assert.match(domain, /Choose an active lodge profile before creating a Starter backup/)
  assert.match(domain, /returned \$\{foreignRows\} record\(s\) from another lodge/)
  assert.match(domain, /Server \$\{spec\.key\} read failed/)
  assert.doesNotMatch(domain, /getAllCustomers\(\)/)
  assert.match(domain, /complete: warnings.length === 0/)
  assert.match(domain, /not server-confirmed/)
  assert.match(domain, /offline when this package was created/)
})

test('Starter backup writes atomically and does not claim success after a write failure', () => {
  assert.match(domain, /writeFileSync\(temporaryPath, bytes, \{ flag: 'wx' \}\)/)
  assert.match(domain, /renameSync\(temporaryPath, filePath\)/)
  assert.match(domain, /Starter backup could not be written/)
  assert.match(domain, /fileName: path\.basename\(target\)/)
  assert.doesNotMatch(domain, /filePath: target/)
  assert.match(main, /ipcMain\.handle\('backup:starterExport'/)
  assert.match(main, /backup\.starter_export/)
  assert.match(main, /No success is claimed/)
})

test('Starter backup bridge is separate from Standard managed backup controls', () => {
  assert.match(preload, /starterExport: \(options\) => invoke\('backup:starterExport', options\)/)
  assert.match(database, /writeStarterBackupToPath/)
  assert.match(main, /showSaveDialog/)
  assert.match(main, /Starter core-data backup/)
  assert.match(main, /backup:chooseTargetFolder/)
  assert.match(main, /backup:runManagedNow/)
  assert.match(main, /backup:previewRestore/)
  assert.match(main, /const stripRecoveryIpcData = \(value\) =>/)
  assert.match(main, /return stripRecoveryIpcData\(verification\)/)
  assert.match(main, /writeStarterBackupPackageBytes\(target, sourceBytes\)/)
  assert.doesNotMatch(domain, /Legacy contract marker/)
  assert.doesNotMatch(preload, /Compatibility marker/)
})

test('Starter backup UI uses simple recovery language and remains path-safe', () => {
  assert.match(ui, /window\.api\?\.backup\?\.starterExport/)
  assert.match(ui, /Back up your lodge data/)
  assert.match(ui, /Safe and read-only/)
  assert.match(ui, /guest and payment records/)
  assert.match(ui, /SHA-256 fingerprint/)
  assert.match(ui, /Included records/)
  assert.match(ui, /Data included:/)
  assert.match(ui, /never restores or overwrites live lodge data/)
  assert.doesNotMatch(ui, /backupDir|filePath|target_dir/)
})

test('Starter backup hides duplicate creation actions after any file is saved', () => {
  assert.match(ui, /result\?\.success === true \|\| result\?\.fileWritten === true/)
  assert.match(ui, /!backupSaved &&/)
  assert.match(ui, /Create a new backup/)
  assert.match(ui, /setResult\(null\)/)
  assert.match(ui, /setPassphrase\(''\)/)
})

test('Starter backup can return to verification from the saved local history', () => {
  assert.match(ui, /history\?\.history\?\.\[0\]/)
  assert.match(ui, /setResult\(\{ \.\.\.latest, success: true, verified: false \}\)/)
  assert.match(ui, /Check last backup/)
  assert.match(ui, /Enter the backup passphrase, then select Check backup\./)
})

test('Starter backup passphrase fields have an explicit visibility toggle', () => {
  assert.match(ui, /type=\{visible \? 'text' : 'password'\}/)
  assert.match(ui, /Show passphrase/)
  assert.match(ui, /Hide passphrase/)
  assert.match(ui, /aria-pressed=\{visible\}/)
  assert.match(ui, /Backup checked and ready\./)
})

test('Starter backup automatically checks a new file and progressively discloses advanced actions', () => {
  assert.match(ui, /starterVerify\?\.\(\{/)
  assert.match(ui, /setResult\(\{ \.\.\.next, verified: true \}\)/)
  assert.match(ui, /Backup checked and ready/)
  assert.match(ui, /Save second copy/)
  assert.match(ui, /More options/)
  assert.match(ui, /Check backup again/)
  assert.match(ui, /Test recovery/)
})

test('Starter backup stops at the pagination ceiling instead of certifying a truncated export', () => {
  assert.match(domain, /MAX_ROWS_PER_TABLE = 100000/)
  assert.match(domain, /from \+ page\.length >= MAX_ROWS_PER_TABLE/)
  assert.match(domain, /more than \$\{MAX_ROWS_PER_TABLE\.toLocaleString\(\)\} records/)
  assert.match(domain, /ask support for a managed export/)
})

test('Starter backup is wired as a Lodge Starter route without widening Standard data management', () => {
  assert.match(app, /StarterBackup = lazy\(\(\) => import\('\.\/components\/StarterBackup'\)\)/)
  assert.match(app, /path="starter-backup"[\s\S]*backup\.starter_export[\s\S]*feature="starter_backup"/)
  assert.match(nav, /to: '\/starter-backup'[\s\S]*feature: 'starter_backup'[\s\S]*capability: 'backup\.starter_export'/)
  assert.match(identity, /'starter-backup'/)
  assert.match(access, /starter_backup: 'Starter backup'/)
  assert.match(access, /'backup\.starter_export': 'starter_backup'/)
  assert.match(commercial, /'basic_reports', 'starter_backup'/)
  assert.match(commercial, /'starter_backup_automation'/)
  assert.doesNotMatch(commercial, /'basic_reports', 'starter_backup', 'staff_basic'/)
  assert.match(plans, /starter_backup: 'Starter'/)
  assert.match(catalog, /key: 'starter_backup'[\s\S]*routes: \['\/starter-backup'\][\s\S]*backup\.starter_export/)
  assert.match(subscriptionState, /'basic_reports', 'starter_backup'/)
  assert.match(subscriptionState, /starter_backup_automation/)
})

test('Starter backup entitlement migration covers higher accommodation packages and excludes POS', () => {
  assert.match(entitlementMigration, /product_id = 'lodge-camp'/)
  assert.match(entitlementMigration, /commercial_package_key in \('starter', 'standard', 'pro'\)/)
  assert.match(entitlementMigration, /product_id = 'hotel'/)
  assert.match(entitlementMigration, /commercial_package_key = 'hotel_core'/)
  assert.match(entitlementMigration, /included_features[\s\S]*starter_backup/)
  assert.match(entitlementMigration, /commercial_package_entitlements/)
  assert.match(entitlementMigration, /on conflict \(catalog_version_id, product_id, commercial_package_key, feature_key\)/i)
  assert.doesNotMatch(entitlementMigration, /hospitality-pos|bar_pos|restaurant/i)
})

test('Starter backup IPC fails closed for Hospitality POS while accommodation packages retain access', () => {
  const handler = main.match(/ipcMain\.handle\('backup:starterExport',[\s\S]*?\n  \}\)/)?.[0] || ''
  assert.match(handler, /requireCapability\('backup\.starter_export'\)/)
  assert.match(handler, /BUILD_PRODUCT_ID === 'hospitality-pos'/)
  assert.match(handler, /requireCommercialFeature\([\s\S]*?'starter_backup'/)
  assert.match(handler, /Starter backup is available only in LodgingOS and HotelOS/)

  for (const packageKey of ['bar_pos', 'restaurant_service', 'restaurant_control', 'restaurant_growth']) {
    assert.equal(
      isCommercialFeatureIncluded('hospitality-pos', packageKey, 'starter_backup'),
      false,
      `${packageKey} must not expose the accommodation backup contract`
    )
  }

  assert.ok(getCommercialOffer('lodge-camp', 'starter').includedFeatures.includes('starter_backup'))
  assert.ok(getCommercialOffer('lodge-camp', 'standard').includedFeatures.includes('starter_backup'))
  assert.ok(getCommercialOffer('lodge-camp', 'pro').includedFeatures.includes('starter_backup'))
  assert.ok(getCommercialOffer('hotel', 'hotel_core').includedFeatures.includes('starter_backup'))
})

test('offline plan fallback keeps accommodation backup available but does not replace the product boundary', () => {
  for (const plan of ['Starter', 'Standard', 'Pro', 'Enterprise']) {
    assert.equal(getPlanFeatureMap(plan).starter_backup, true)
  }
  assert.equal(getPlanFeatureMap('Starter', { expired: true }).starter_backup, false)
  assert.match(main, /BUILD_PRODUCT_ID === 'hospitality-pos'/)
})

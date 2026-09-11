import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'
import {
  HOTEL_NAV_GROUPS,
  HOTEL_MORE_ITEMS,
  getHotelSearchItems,
  annotateHotelNavItem
} from '../src/renderer/src/components/hotel/hotelNav.js'

const read = (file) => fs.readFileSync(file, 'utf8')
const app = read('src/renderer/src/App.jsx')
const dataManagement = read('src/renderer/src/components/DataManagement.jsx')
const starterBackup = read('src/renderer/src/components/StarterBackup.jsx')

const access = {
  allowedByRole: {
    'backup.starter_export': true,
    'data.import': true
  }
}
const backupOnlyAccess = {
  allowedByRole: { 'backup.starter_export': true }
}

const pathsForPlan = (plan) => getDesktopNavItems(
  'lodge',
  access,
  'lodge',
  plan,
  [],
  null,
  'lodge-camp'
).map((item) => item.to)

test('Lodge tier navigation exposes one backup entry per plan', () => {
  assert.ok(pathsForPlan('Starter').includes('/starter-backup'))
  assert.equal(pathsForPlan('Starter').includes('/data-management'), false)

  for (const plan of ['Standard', 'Pro']) {
    const paths = pathsForPlan(plan)
    assert.equal(paths.includes('/starter-backup'), false, `${plan} should not duplicate Core Data Backup in the rail`)
    assert.equal(paths.filter((path) => path === '/data-management').length, 1, `${plan} should expose one Data Management entry`)
  }

  for (const plan of ['Standard', 'Pro']) {
    assert.ok(
      getDesktopNavItems('lodge', backupOnlyAccess, 'lodge', plan, [], null, 'lodge-camp').some((item) => item.to === '/data-management'),
      `${plan} Finance access should retain the Data Management entry for Core Data Backup`
    )
  }
})

test('Data Management embeds Core Data Backup while preserving the compatible route', () => {
  assert.match(app, /path="starter-backup"[\s\S]*backup\.starter_export[\s\S]*feature="starter_backup"/)
  assert.match(dataManagement, /import StarterBackup from '\.\/StarterBackup'/)
  assert.match(dataManagement, /data-testid="core-data-backup-section"/)
  assert.match(dataManagement, /<StarterBackup embedded \/>/)
  assert.match(dataManagement, /data\.import/)
  assert.match(dataManagement, /backup\.manage/)
  assert.match(dataManagement, /backup\.starter_export/)
  assert.match(starterBackup, /Core Data Backup/)
  assert.match(starterBackup, /Back up your property data/)
  assert.doesNotMatch(starterBackup, /live lodge data/)
})

test('Hotel Core navigation discovers Data Management and role-aware Guest Deposits', () => {
  const reservations = HOTEL_NAV_GROUPS.find((group) => group.name === 'Reservations')
  const deposits = reservations.items.find((item) => item.to === '/prepayments')
  assert.deepEqual(
    { feature: deposits.feature, moduleKey: deposits.moduleKey, capability: deposits.capability },
    { feature: 'prepayments_basic', moduleKey: 'prepayments_basic', capability: 'prepayments.view' }
  )

  const dataItem = HOTEL_MORE_ITEMS.find((item) => item.to === '/data-management')
  assert.equal(dataItem.label, 'Data Management')
  assert.equal(dataItem.moduleKey, 'import')
  assert.deepEqual(dataItem.capabilityAny, ['data.import', 'backup.starter_export'])

  const lockContext = {
    features: { prepayments_basic: true, import: true },
    allowedByRole: { 'prepayments.view': true, 'data.import': true }
  }
  const search = getHotelSearchItems(lockContext)
  assert.ok(search.some((item) => item.to === '/data-management' && item.label === 'Data Management'))
  assert.equal(search.some((item) => item.to === '/starter-backup'), false)
  assert.ok(getHotelSearchItems({
    features: { import: true },
    allowedByRole: { 'backup.starter_export': true }
  }).some((item) => item.to === '/data-management'), 'Hotel Finance access should retain Data Management for Core Data Backup')

  const blocked = annotateHotelNavItem(deposits, {
    features: { prepayments_basic: true },
    allowedByRole: { 'prepayments.view': false }
  })
  assert.equal(blocked.isLocked, false)
  assert.equal(blocked.isRoleBlocked, true)
})

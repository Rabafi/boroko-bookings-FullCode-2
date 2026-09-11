import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const staffPage = readFileSync('src/renderer/src/components/Staff.jsx', 'utf8')
const panel = readFileSync('src/renderer/src/components/shared/StaffProductivityPanel.jsx', 'utf8')
const main = readFileSync('src/main/index.js', 'utf8')
const migration = readFileSync('supabase/migrations/20260908020000_lodge_starter_productivity_dashboard.sql', 'utf8')
const moduleCatalog = readFileSync('src/shared/moduleCatalog.js', 'utf8')
const planMap = readFileSync('src/main/domains/subscriptionState.js', 'utf8')
const staffOperations = readFileSync('src/renderer/src/components/hotel/StaffOperations.jsx', 'utf8')
const appRoutes = readFileSync('src/renderer/src/App.jsx', 'utf8')

describe('Lodge Starter staff performance (embedded in Staff)', () => {
  it('embeds a Performance tab inside Staff for the lodging app only', () => {
    assert.match(staffPage, /IS_LODGE_APP/)
    assert.match(staffPage, /getProductDefinition\(getRuntimeProductId\(\)\)\.id === 'lodge-camp'/)
    assert.match(staffPage, /showPerformanceTab/)
    assert.match(staffPage, /StaffProductivityPanel/)
    assert.match(staffPage, /key: 'performance'/)
    // Starter forces the staff tab today; performance must survive that gate.
    assert.match(staffPage, /tabParam === 'performance' && showPerformanceTab/)
  })

  it('keeps the panel read-only, date-filtered, and vocabulary-aware', () => {
    assert.match(panel, /getUiVocabulary/)
    assert.match(panel, /getStaffProductivityDashboard\(from, to\)/)
    assert.match(panel, /result && result\.success === false/)
    assert.match(panel, /from > to/)
    assert.match(panel, /rollupStaffProductivity/)
    assert.match(panel, /vocab\.nounTitle/)
    assert.match(panel, /Read-only/)
  })

  it('opens only the dashboard read on IPC; the RPC still enforces product gating', () => {
    assert.match(main, /staffOperations:getStaffProductivityDashboard/)
    assert.match(main, /requireCapability\('workforce_scheduling\.view'\)/)
    assert.match(main, /requireCapability\('staff\.view'\)/)
    assert.match(main, /return await db\.getStaffProductivityDashboard\(startDate, endDate\)/)
  })

  it('lets lodge-camp read via staff_basic but keeps other products on workforce_management', () => {
    assert.match(migration, /if v_product = 'lodge-camp' then/)
    assert.match(migration, /if not \(v_workforce or v_staff_basic\) then/)
    assert.match(migration, /elsif not v_workforce then/)
    assert.match(migration, /app_lodge_access\(p_lodge_id\)/)
    assert.match(migration, /'manager', 'admin', 'super_admin', 'receptionist', 'operations'/)
    assert.match(migration, /grant execute on function public\.get_staff_productivity_dashboard\(uuid, date, date\) to authenticated/)
  })

  it('leaves Hotel/POS entitlement and the Workforce route untouched', () => {
    assert.match(moduleCatalog, /key: 'workforce_management'/)
    assert.match(moduleCatalog, /visibility: 'hotel_only'/)
    assert.match(planMap, /workforce_management: false/)
    assert.match(appRoutes, /path="workforce" element=\{<UpgradeWall feature="workforce_management">/)
    assert.match(staffOperations, /options\.productivityStartDate/)
    assert.match(staffOperations, /options\.productivityEndDate/)
  })
})

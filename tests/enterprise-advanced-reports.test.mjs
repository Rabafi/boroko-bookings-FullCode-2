import test from 'node:test'
import assert from 'node:assert/strict'

test('Advanced reports capability exists in access control', async () => {
  const { ALL_CAPABILITIES, CAPABILITY_LABELS } = await import('../src/shared/accessControl.js')
  assert.ok(ALL_CAPABILITIES.includes('advanced_reports.view'), 'advanced_reports.view should be in ALL_CAPABILITIES')
  assert.ok(CAPABILITY_LABELS['advanced_reports.view'], 'advanced_reports.view should have a label')
  assert.ok(ALL_CAPABILITIES.includes('reports.export'), 'reports.export should be in ALL_CAPABILITIES')
})

test('Revenue manager capability exists in access control', async () => {
  const { ALL_CAPABILITIES } = await import('../src/shared/accessControl.js')
  assert.ok(ALL_CAPABILITIES.includes('revenue_manager.view'))
})

test('Advanced reports domain exports all required functions', { concurrency: false }, async (t) => {
  try {
    const domain = await import('../src/main/domains/advancedReports.js')
    assert.equal(typeof domain.getOccupancy, 'function')
    assert.equal(typeof domain.getPace, 'function')
    assert.equal(typeof domain.getPickup, 'function')
    assert.equal(typeof domain.getChannelSource, 'function')
    assert.equal(typeof domain.getDebtorAging, 'function')
    assert.equal(typeof domain.getRatePerformance, 'function')
    assert.equal(typeof domain.getHousekeepingProductivity, 'function')
    assert.equal(typeof domain.getRoomDowntime, 'function')
    assert.equal(typeof domain.getGroupPickup, 'function')
    assert.equal(typeof domain.getCancellationNoShow, 'function')
    assert.equal(typeof domain.getTaxVat, 'function')
    assert.equal(typeof domain.getDepositLiability, 'function')
    assert.equal(typeof domain.getFolioExceptions, 'function')
  } catch (err) {
    if (err.message?.includes('electron')) {
      t.diagnostic(`Skipping: ${err.message}`)
      return
    }
    throw err
  }
})

test('All advanced reports functions return { data, error } shape', { concurrency: false }, async (t) => {
  try {
    const domain = await import('../src/main/domains/advancedReports.js')
    const fns = [
    domain.getOccupancy,
    domain.getPace,
    domain.getPickup,
    domain.getChannelSource,
    domain.getDebtorAging,
    domain.getRatePerformance,
    domain.getHousekeepingProductivity,
    domain.getRoomDowntime,
    domain.getGroupPickup,
    domain.getCancellationNoShow,
    domain.getTaxVat,
    domain.getDepositLiability,
    domain.getFolioExceptions
  ]
  for (const fn of fns) {
    const fnStr = fn.toString()
    assert.ok(fnStr.includes('data') || fnStr.includes('callReportRpc'), `${fn.name || 'fn'} should return data/error pattern`)
  }
  } catch (err) {
    if (err.message?.includes('electron')) {
      t.diagnostic(`Skipping: ${err.message}`)
      return
    }
    throw err
  }
})

test('Advanced reports function uses dedupePromise', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/domains/advancedReports.js', 'utf8')
  const dedupeCount = (content.match(/dedupePromise/g) || []).length
  assert.ok(dedupeCount >= 13, `Expected at least 13 dedupePromise usages, got ${dedupeCount}`)
})

test('SQL migration file exists for advanced reports', async () => {
  const fs = await import('fs')
  const files = fs.readdirSync('./supabase/migrations')
  assert.ok(files.some(f => f.includes('20260705150000_advanced_reports')), 'Advanced reports migration file should exist')
})

test('Advanced reports migration has all required RPCs', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  const rpcs = [
    'get_occupancy_report', 'get_pace_report', 'get_pickup_report',
    'get_channel_source_report', 'get_debtor_aging_detail', 'get_rate_performance_report',
    'get_housekeeping_productivity', 'get_room_downtime_report', 'get_group_pickup_report',
    'get_cancellation_no_show_report', 'get_tax_vat_report', 'get_deposit_liability_report',
    'get_folio_exception_report'
  ]
  for (const rpc of rpcs) {
    assert.ok(sql.includes(rpc), `Migration should contain ${rpc}`)
  }
})

test('Advanced reports migration uses app_require_lodge_role pattern', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  const count = (sql.match(/app_require_lodge_role/g) || []).length
  assert.ok(count >= 13, `Expected at least 13 app_require_lodge_role calls, got ${count}`)
})

test('Advanced reports migration uses SECURITY DEFINER', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  const count = (sql.match(/SECURITY DEFINER/g) || []).length
  assert.ok(count >= 13, `Expected at least 13 SECURITY DEFINER uses, got ${count}`)
})

test('Advanced reports migration grants execute to authenticated and service_role', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  const grantCount = (sql.match(/GRANT EXECUTE ON FUNCTION/g) || []).length
  assert.ok(grantCount >= 13, `Expected at least 13 GRANT EXECUTE statements, got ${grantCount}`)
})

test('All advanced reports RPCs include lodge_id parameter', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  const rpcs = [
    'get_occupancy_report', 'get_pace_report', 'get_pickup_report',
    'get_channel_source_report', 'get_debtor_aging_detail', 'get_rate_performance_report',
    'get_housekeeping_productivity', 'get_room_downtime_report', 'get_group_pickup_report',
    'get_cancellation_no_show_report', 'get_tax_vat_report', 'get_deposit_liability_report',
    'get_folio_exception_report'
  ]
  for (const rpc of rpcs) {
    const idx = sql.indexOf(rpc)
    const block = sql.slice(idx, idx + 500)
    assert.ok(block.includes('p_lodge_id'), `${rpc} should have p_lodge_id parameter`)
  }
})

test('Occupancy report returns daily and summary structure', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('daily') && sql.includes('summary'), 'Occupancy report should return daily and summary')
  assert.ok(sql.includes('total_room_nights') && sql.includes('occupied_room_nights'), 'Occupancy summary should include room night counts')
})

test('Pace report compares this year vs last year', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('this_year') && sql.includes('last_year'), 'Pace report should compare TY vs LY')
  assert.ok(sql.includes('pace_change_pct'), 'Pace report should include change percentage')
})

test('Debtor aging report has aging buckets', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('days_1_30') && sql.includes('days_31_60') && sql.includes('days_61_90') && sql.includes('days_91_plus'))
  assert.ok(sql.includes('corporate_account_id'), 'Debtor aging should include corporate account breakdown')
})

test('Cancellation/no-show report has daily breakdown and summary', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('cancellation_rate') && sql.includes('no_show_rate'))
})

test('Deposit liability report has breakdown of deposits', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('deposit_amount') && sql.includes('total_deposits_collected') && sql.includes('outstanding_liability'))
})

test('Folio exception report shows unallocated charges', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('unallocated_amount') && sql.includes('charges_total'))
})

test('Tax/VAT report includes both booking and POS tax', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('booking_tax') && sql.includes('pos_tax') && sql.includes('total_tax_collected'))
})

test('Rate performance report compares vs BAR rate', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('bar_rate') && sql.includes('premium_pct') && sql.includes('avg_rate'))
})

test('Housekeeping productivity report groups by attendant', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('rooms_cleaned') && sql.includes('attendant'))
})

test('Room downtime report shows maintenance days per room', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('maintenance_days') && sql.includes('total_downtime_cost'))
})

test('Group pickup report shows pickup percentage', async () => {
  const fs = await import('fs')
  const sql = fs.readFileSync('./supabase/migrations/20260705150000_advanced_reports.sql', 'utf8')
  assert.ok(sql.includes('pickup_pct') && sql.includes('picked_up') && sql.includes('blocked_rooms'))
})

test('AdvancedReports React component file exists', async () => {
  const fs = await import('fs')
  assert.ok(fs.existsSync('./src/renderer/src/components/AdvancedReports.jsx'), 'AdvancedReports.jsx should exist')
})

test('AdvancedReports component uses window.api.advancedReports', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/renderer/src/components/AdvancedReports.jsx', 'utf8')
  assert.ok(content.includes('window.api.advancedReports'), 'AdvancedReports should use window.api.advancedReports')
})

test('AdvancedReports component exports default function', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/renderer/src/components/AdvancedReports.jsx', 'utf8')
  assert.ok(content.includes('export default function AdvancedReports'), 'AdvancedReports should export default function')
})

test('AdvancedReports component has all report types defined', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/renderer/src/components/AdvancedReports.jsx', 'utf8')
  const reports = [
    'occupancy', 'pace', 'pickup', 'channelSource', 'debtorAging',
    'ratePerformance', 'housekeepingProductivity', 'roomDowntime',
    'groupPickup', 'cancellationNoShow', 'taxVat', 'depositLiability', 'folioExceptions'
  ]
  for (const report of reports) {
    assert.ok(content.includes(report), `AdvancedReports should include ${report} report type`)
  }
})

test('All enterprise files are created for advanced reports feature', async () => {
  const fs = await import('fs')
  const files = [
    './src/main/domains/advancedReports.js',
    './supabase/migrations/20260705150000_advanced_reports.sql',
    './src/renderer/src/components/AdvancedReports.jsx'
  ]
  for (const file of files) {
    assert.ok(fs.existsSync(file), `${file} should exist`)
  }
})

test('Database facade re-exports advancedReports functions', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/database.js', 'utf8')
  assert.ok(content.includes('getOccupancy'))
  assert.ok(content.includes('getPace'))
  assert.ok(content.includes('getPickup'))
  assert.ok(content.includes('getDebtorAging'))
  assert.ok(content.includes('getFolioExceptions'))
})

test('Preload has advancedReports and revenueManager sections', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/preload/index.js', 'utf8')
  assert.ok(content.includes('revenueManager:'), 'revenueManager section exists')
  assert.ok(content.includes('advancedReports:'), 'advancedReports section exists')
})

test('Advanced reports IPC handlers return { data, error } on failure', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/index.js', 'utf8')
  const handlers = [
    'advancedReports:getOccupancy', 'advancedReports:getPace', 'advancedReports:getPickup',
    'advancedReports:getChannelSource', 'advancedReports:getDebtorAging',
    'advancedReports:getRatePerformance', 'advancedReports:getHousekeepingProductivity',
    'advancedReports:getRoomDowntime', 'advancedReports:getGroupPickup',
    'advancedReports:getCancellationNoShow', 'advancedReports:getTaxVat',
    'advancedReports:getDepositLiability', 'advancedReports:getFolioExceptions'
  ]
  for (const handler of handlers) {
    const idx = content.indexOf(`ipcMain.handle('${handler}'`)
    const block = content.slice(idx, idx + 500)
    assert.ok(block.includes('return { data: null, error:'), `${handler} should return error object on failure`)
  }
})

test('Revenue manager IPC handlers use requireCapabilityOrDevEnterprisePreview for reads', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/index.js', 'utf8')
  assert.ok(content.includes("requireCapabilityOrDevEnterprisePreview('revenue_manager.view')"))
})

test('All advanced functions follow report pattern with callReportRpc', async () => {
  const fs = await import('fs')
  const content = fs.readFileSync('./src/main/domains/advancedReports.js', 'utf8')
  const callRpcCount = (content.match(/callReportRpc/g) || []).length
  assert.ok(callRpcCount >= 13, `Expected at least 13 callReportRpc calls, got ${callRpcCount}`)
})

test('Module catalog is consistent after amendments', async () => {
  const { MODULE_CATALOG } = await import('../src/shared/moduleCatalog.js')
  for (const module of MODULE_CATALOG) {
    assert.ok(module.key, `Module missing key: ${JSON.stringify(module)}`)
    assert.ok(module.label, `Module ${module.key} missing label`)
    assert.ok(module.description, `Module ${module.key} missing description`)
    assert.ok(module.category, `Module ${module.key} missing category`)
    assert.ok(module.requiredPlan, `Module ${module.key} missing requiredPlan`)
    assert.ok(Array.isArray(module.allowedPropertyTypes), `Module ${module.key} allowedPropertyTypes is not array`)
    assert.ok(Array.isArray(module.routes), `Module ${module.key} routes is not array`)
    assert.ok(Array.isArray(module.capabilities), `Module ${module.key} capabilities is not array`)
  }
})

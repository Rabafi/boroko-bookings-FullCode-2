/**
 * Phase 4 — Hotel documents + reports contract.
 * Proves: no production mock KPI strings, RPC-backed document/report paths,
 * publish online-only, estimates labelled on hotel KPIs.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

const documentSystemJs = read('src/main/domains/documentSystem.js')
const advancedReportsJs = read('src/main/domains/advancedReports.js')
const hotelJs = read('src/main/domains/hotel.js')
const documentSystemJsx = read('src/renderer/src/components/DocumentSystem.jsx')
const hotelKpisJsx = read('src/renderer/src/components/HotelKpis.jsx')
const advancedReportsJsx = read('src/renderer/src/components/AdvancedReports.jsx')
const offlineMatrix = read('docs/OFFLINE_MATRIX.md')

const MOCK_STRINGS = [
  'sample data',
  'Sample Data',
  'mock KPI',
  'mockKpi',
  'hardcoded KPI',
  'demo occupancy',
  'placeholder revenue',
  'Lorem ipsum',
  'fake revenue',
  'MOCK_OCCUPANCY'
]

test('document system mutations call authoritative RPCs', () => {
  for (const rpc of [
    'create_document_template',
    'update_document_template',
    'delete_document_template',
    'render_document',
    'publish_document',
    'get_document_history',
    'get_document_dashboard'
  ]) {
    assert.ok(documentSystemJs.includes(`'${rpc}'`) || documentSystemJs.includes(`"${rpc}"`), `must call ${rpc}`)
  }
  assert.ok(documentSystemJs.includes('callDocumentRpc'), 'central RPC helper required')
  assert.ok(documentSystemJs.includes("data?.success === false") || documentSystemJs.includes('success === false'),
    'must reject RPC success:false')
})

test('document publish is online-only and not queued', () => {
  assert.ok(documentSystemJs.includes('requireOnline'), 'online gate helper required')
  assert.ok(documentSystemJs.includes("requireOnline('Publish document')") || documentSystemJs.includes('Publish document'),
    'publish must require online')
  assert.ok(!documentSystemJs.includes('queueOperation'), 'document system must not queue financial publish/render')
  assert.ok(offlineMatrix.includes('publishDocument') && offlineMatrix.includes('online_only'),
    'offline matrix must classify publish as online_only')
})

test('document types cover hotel ops types allowed by schema', () => {
  const types = [
    'folio',
    'invoice',
    'registration_card',
    'statement',
    'receipt',
    'contract',
    'cancellation_note'
  ]
  for (const t of types) {
    assert.ok(documentSystemJs.includes(`'${t}'`), `domain must allow ${t}`)
    assert.ok(documentSystemJsx.includes(`'${t}'`), `UI must offer ${t}`)
  }
  // Quotation is a subject type for render, not a document_templates.check value
  assert.ok(documentSystemJsx.includes("value=\"quotation\""), 'render subject may be quotation')
  assert.ok(!documentSystemJs.includes("'quotation'") || documentSystemJs.includes('HOTEL_DOCUMENT_TYPES'),
    'quotation is not a template document_type unless schema expands')
})

test('DocumentSystem UI never shows success without RPC success', () => {
  assert.ok(documentSystemJsx.includes('assertRpcSuccess'), 'UI must assert RPC success before toast')
  assert.ok(documentSystemJsx.includes('success === false'), 'UI checks success false')
  assert.ok(documentSystemJsx.includes('setSuccess'), 'success path exists')
  // Success toasts only after assertRpcSuccess
  const saveIdx = documentSystemJsx.indexOf('handleSave')
  const saveBlock = documentSystemJsx.slice(saveIdx, saveIdx + 900)
  assert.ok(saveBlock.includes('assertRpcSuccess'), 'save asserts success')
  const publishIdx = documentSystemJsx.indexOf('handlePublish')
  const publishBlock = documentSystemJsx.slice(publishIdx, publishIdx + 700)
  assert.ok(publishBlock.includes('assertRpcSuccess'), 'publish asserts success')
  const renderIdx = documentSystemJsx.indexOf('handleRender')
  const renderBlock = documentSystemJsx.slice(renderIdx, renderIdx + 700)
  assert.ok(renderBlock.includes('assertRpcSuccess'), 'render asserts success')
})

test('production document/report UI has no mock sample KPI strings', () => {
  for (const [name, src] of [
    ['DocumentSystem.jsx', documentSystemJsx],
    ['HotelKpis.jsx', hotelKpisJsx],
    ['AdvancedReports.jsx', advancedReportsJsx],
    ['documentSystem.js', documentSystemJs],
    ['advancedReports.js', advancedReportsJs],
    ['hotel.js KPIs', hotelJs]
  ]) {
    for (const bad of MOCK_STRINGS) {
      assert.ok(!src.includes(bad), `${name} must not contain mock string: ${bad}`)
    }
  }
})

test('hotel KPIs label estimates vs authoritative', () => {
  assert.ok(hotelJs.includes('getHotelKpis') || hotelJs.includes('_getHotelKpis'), 'KPI export present')
  assert.ok(hotelJs.includes('booking_cache_estimate'), 'KPI source labelled as cache estimate')
  assert.ok(hotelJs.includes("authority: 'estimate'") || hotelJs.includes('authority: "estimate"'),
    'authority estimate flag')
  assert.ok(hotelKpisJsx.includes('est.') || hotelKpisJsx.includes('estimate'), 'UI labels estimates')
  assert.ok(hotelKpisJsx.includes('kpiSource') || hotelKpisJsx.includes('booking_cache_estimate') || hotelKpisJsx.includes('estimate'),
    'UI surfaces estimate source')
  assert.ok(hotelKpisJsx.includes('advanced reports') || hotelKpisJsx.includes('Enterprise'),
    'UI points operators to ledger-derived enterprise reports')
})

test('advancedReports desktop calls occupancy/ADR/debtor RPCs with live param names', () => {
  const rpcs = [
    'get_occupancy_report',
    'get_rate_performance_report',
    'get_debtor_aging_detail',
    'get_deposit_liability_report',
    'get_folio_exception_report',
    'get_channel_source_report',
    'get_pace_report',
    'get_pickup_report',
    'get_cancellation_no_show_report'
  ]
  for (const rpc of rpcs) {
    assert.ok(advancedReportsJs.includes(`'${rpc}'`), `advancedReports must call ${rpc}`)
  }
  // Live post-repair signatures use p_from / p_to
  assert.ok(advancedReportsJs.includes('p_from'), 'must pass p_from')
  assert.ok(advancedReportsJs.includes('p_to'), 'must pass p_to')
  assert.ok(!advancedReportsJs.includes('p_start_date'), 'must not use retired p_start_date name')
  assert.ok(advancedReportsJs.includes('ledger_derived') || advancedReportsJs.includes('authority'),
    'must tag report authority')
  assert.ok(advancedReportsJs.includes('Online connection required'), 'online-only reads')
})

test('AdvancedReports UI surfaces RPC errors and never invents KPI rows', () => {
  assert.ok(advancedReportsJsx.includes('result?.error') || advancedReportsJsx.includes('result.error'),
    'UI checks domain error field')
  assert.ok(advancedReportsJsx.includes('ledger_derived') || advancedReportsJsx.includes('authority'),
    'UI shows authority banner path')
  assert.ok(
    advancedReportsJsx.includes('does not invent') || advancedReportsJsx.includes('fabricated sample'),
    'UI documents that numbers are not client-invented'
  )
  assert.ok(advancedReportsJsx.includes('window.api.advancedReports'), 'uses preload advancedReports API')
})

test('report restore migration restores ledger-derived occupancy/ADR/debtor RPCs', () => {
  const migrations = readdirSync(resolve(root, 'supabase/migrations'))
  const restore = migrations.find((f) => f.includes('hotel_reports_ledger_restore'))
  assert.ok(restore, 'expected hotel_reports_ledger_restore migration')
  const sql = read(`supabase/migrations/${restore}`)
  for (const fn of [
    'get_occupancy_report',
    'get_rate_performance_report',
    'get_debtor_aging_detail',
    'get_deposit_liability_report',
    'get_folio_exception_report'
  ]) {
    assert.ok(sql.includes(fn), `migration must define ${fn}`)
  }
  assert.ok(sql.includes('p_from') && sql.includes('p_to'), 'date-range params p_from/p_to')
  assert.ok(sql.includes('adr') || sql.includes('ADR') || sql.includes("'adr'"), 'ADR in occupancy/rate summary')
  assert.ok(sql.includes('revpar') || sql.includes('RevPAR') || sql.includes("'revpar'"), 'RevPAR in summary')
  assert.ok(sql.includes('booking_ledger_derived') || sql.includes('authority'), 'authority tags in RPC payload')
  // Must not reintroduce hard-coded sample numbers as fake KPI constants
  assert.ok(!sql.includes('sample_occupancy') && !sql.includes('MOCK_'), 'no mock constants in SQL')
})

test('document system migration still defines template CRUD + publish RPCs', () => {
  const sql = read('supabase/migrations/20260705140000_document_system_full.sql')
  for (const fn of [
    'create_document_template',
    'update_document_template',
    'delete_document_template',
    'render_document',
    'publish_document'
  ]) {
    assert.ok(sql.includes(fn), `document migration must define ${fn}`)
  }
  assert.ok(sql.includes("status = 'final'"), 'publish transitions draft → final')
})

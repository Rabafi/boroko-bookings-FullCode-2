// V04 decision-contract tests: the REAL shared tab-access module plus the
// component wiring that the browser suite exercises end to end.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  WORKSPACE_TAB_CAPABILITIES,
  getTabCapabilities,
  getTabDecision,
  getVisibleWorkspaceTabs,
  resolveWorkspaceTab,
  sanitizeOutletScope
} from '../src/shared/workspaceTabAccess.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

const financeTabs = [
  { key: 'overview', feature: 'reports' },
  { key: 'cashups', feature: 'pos' },
  { key: 'sales', feature: 'reports' },
  { key: 'settlements', feature: 'reports' },
  { key: 'customer-funds', feature: 'pos' },
  { key: 'expenses', feature: 'expenses' },
  { key: 'tips', feature: 'staff' },
  { key: 'daily-close', feature: 'reports' },
  { key: 'owner-review', feature: 'reports' }
]
const cashierNoReports = { capabilities: { 'pos.cashup': true, 'pos.manage': true } }
const allFeaturesOn = { reports: true, pos: true, expenses: true, staff: true }

test('every finance tab resolves a read capability', () => {
  for (const tab of financeTabs) {
    const caps = getTabCapabilities('finance', tab)
    assert.ok(caps.length > 0, `finance:${tab.key} must name a read capability`)
  }
  assert.deepEqual(getTabCapabilities('finance', { key: 'expenses', feature: 'expenses' }), ['expenses.view'])
})

test('commercial force-off denies even when broad flags stay true', () => {
  const decision = getTabDecision('finance', { key: 'sales', feature: 'reports' }, {
    access: { capabilities: { 'reports.view': true } },
    features: { reports: false, pos: true }
  })
  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'commercial')
})

test('denied tab capability hides the tab without mounting rights', () => {
  const decision = getTabDecision('finance', { key: 'expenses', feature: 'expenses' }, {
    access: cashierNoReports,
    features: allFeaturesOn
  })
  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'capability')
  const allowed = getTabDecision('finance', { key: 'cashups', feature: 'pos' }, {
    access: cashierNoReports,
    features: allFeaturesOn
  })
  assert.equal(allowed.allowed, true)
})

test('missing capability context fails closed for protected tabs', () => {
  assert.equal(
    getTabDecision('finance', { key: 'sales', feature: 'reports' }, { access: null, features: allFeaturesOn }).allowed,
    false
  )
  // An empty snapshot is a context with nothing granted; only a missing
  // snapshot reports the context itself as the problem.
  assert.equal(
    getTabDecision('finance', { key: 'sales', feature: 'reports' }, { access: {}, features: allFeaturesOn }).reason,
    'capability'
  )
  assert.equal(
    getTabDecision('finance', { key: 'sales', feature: 'reports' }, { features: allFeaturesOn }).reason,
    'no-capability-context'
  )
  // Unprotected tabs (no capability entry) still render without a snapshot.
  assert.equal(getTabDecision('menu', { key: 'menu', feature: 'pos' }, { access: null, features: {} }).allowed, true)
})

test('tampered ?tab= resolves to denial, never the protected tab', () => {
  const resolved = resolveWorkspaceTab('finance', financeTabs, 'expenses', 'overview', {
    access: cashierNoReports,
    features: allFeaturesOn
  })
  assert.equal(resolved.tab, null)
  assert.equal(resolved.denied.tab.key, 'expenses')
  assert.equal(resolved.denied.reason, 'capability')
  // Navigation and resolution share one visible set.
  assert.deepEqual(resolved.visible.map((tab) => tab.key).sort(), ['cashups', 'customer-funds'])
  const unknown = resolveWorkspaceTab('finance', financeTabs, 'nope', 'overview', {
    access: cashierNoReports,
    features: allFeaturesOn
  })
  assert.equal(unknown.tab.key, 'cashups')
  assert.equal(unknown.denied, null)
  const empty = resolveWorkspaceTab('finance', financeTabs, null, null, { access: {}, features: allFeaturesOn })
  assert.equal(empty.tab, null)
  assert.equal(empty.visible.length, 0)
})

test('outlet scope is sanitized before use', () => {
  assert.equal(sanitizeOutletScope('out-9'), 'out-9')
  assert.equal(sanitizeOutletScope('  out-9  '), 'out-9')
  assert.equal(sanitizeOutletScope('out/../../etc'), null)
  assert.equal(sanitizeOutletScope(''), null)
  assert.equal(sanitizeOutletScope(null), null)
  assert.equal(sanitizeOutletScope('x'.repeat(65)), null)
})

test('standalone Bar workspace uses the shared decision contract', () => {
  const workspace = read('src/renderer/src/components/restaurant/RestaurantWorkspace.jsx')
  assert.match(workspace, /getVisibleWorkspaceTabs\(workspace, nextDefinition\.tabs, tabAccessContext\)/)
  assert.match(workspace, /resolveWorkspaceTab\(workspace, candidates, requestedTab, defaultTab, tabAccessContext\)/)
  assert.match(workspace, /WorkspaceTabDenied/)
  assert.match(workspace, /effectiveOutletId/)
  assert.match(workspace, /sanitizeOutletScope\(searchParams\.get\('outlet'\)\)/)
})

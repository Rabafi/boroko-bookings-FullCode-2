import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const modernWorkspace = join(root, 'src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx')
const modifierManager = join(root, 'src/renderer/src/components/hospitality-pos/BarLocalModifierManager.jsx')
const adminPanel = join(root, 'src/renderer/src/components/hospitality-pos/BarLocalAdminPanel.jsx')

function hookHarnessSource() {
  return `
import { createRequire } from 'node:module'
const requireFromRoot = createRequire(${JSON.stringify(join(root, 'package.json'))})
const React = requireFromRoot('react')
const jsxRuntime = requireFromRoot('react/jsx-runtime')
const KEY = Symbol.for('bar-local.renderer-recovery.hooks')

function state() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = { cells: [], cursor: 0, effects: [], effectDeps: {}, memo: {}, cleanups: {}, dirty: false }
  }
  return globalThis[KEY]
}

function sameDeps(previous, next) {
  if (!previous || !next) return false
  return previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]))
}

export const Fragment = jsxRuntime.Fragment
export const createElement = React.createElement
export const jsx = jsxRuntime.jsx
export const jsxs = jsxRuntime.jsxs
export const jsxDEV = jsxRuntime.jsxDEV

export function useState(initial) {
  const hooks = state()
  const index = hooks.cursor++
  if (!(index in hooks.cells)) hooks.cells[index] = typeof initial === 'function' ? initial() : initial
  const set = (value) => {
    const next = typeof value === 'function' ? value(hooks.cells[index]) : value
    if (Object.is(next, hooks.cells[index])) return
    hooks.cells[index] = next
    hooks.dirty = true
  }
  return [hooks.cells[index], set]
}

export function useRef(initial) {
  const hooks = state()
  const index = hooks.cursor++
  if (!(index in hooks.cells)) hooks.cells[index] = { current: initial }
  return hooks.cells[index]
}

export function useEffect(effect, deps) {
  const hooks = state()
  const index = hooks.cursor++
  if (sameDeps(hooks.effectDeps[index], deps)) return
  hooks.effectDeps[index] = deps
  hooks.effects.push({ index, effect })
}

export function useCallback(callback, deps) {
  const hooks = state()
  const index = hooks.cursor++
  if (!sameDeps(hooks.memo[index]?.deps, deps)) hooks.memo[index] = { deps, value: callback }
  return hooks.memo[index].value
}

export function useMemo(factory, deps) {
  const hooks = state()
  const index = hooks.cursor++
  if (!sameDeps(hooks.memo[index]?.deps, deps)) hooks.memo[index] = { deps, value: factory() }
  return hooks.memo[index].value
}

export function __resetHooks() {
  globalThis[KEY] = { cells: [], cursor: 0, effects: [], effectDeps: {}, memo: {}, cleanups: {}, dirty: false }
}

export function __beginRender() {
  const hooks = state()
  hooks.cursor = 0
  hooks.effects = []
}

export function __runEffects() {
  const hooks = state()
  const effects = hooks.effects
  hooks.effects = []
  for (const { index, effect } of effects) {
    const previous = hooks.cleanups[index]
    if (typeof previous === 'function') previous()
    const cleanup = effect()
    hooks.cleanups[index] = typeof cleanup === 'function' ? cleanup : undefined
  }
}

export function __isDirty() { return state().dirty }
export function __clearDirty() { state().dirty = false }
export function __dispose() {
  const hooks = state()
  for (const cleanup of Object.values(hooks.cleanups)) {
    if (typeof cleanup === 'function') cleanup()
  }
  hooks.cleanups = {}
}
`
}

async function bundleModernWorkspace(temp, shimPath) {
  await build({
    entryPoints: { modern: modernWorkspace, modifierManager, adminPanel },
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    outdir: temp,
    outExtension: { '.js': '.mjs' },
    plugins: [{
      name: 'bar-local-hook-harness',
      setup(builder) {
        builder.onResolve({ filter: /^react$/ }, () => ({ path: shimPath }))
        builder.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: shimPath }))
      }
    }],
    logLevel: 'silent'
  })
  const modern = await import(pathToFileURL(join(temp, 'modern.mjs')).href)
  const admin = await import(pathToFileURL(join(temp, 'adminPanel.mjs')).href)
  return { ...modern, adminPanel: admin.default }
}

test('local modifier manager exposes versioned group/option editors and product assignment controls', async () => {
  const temp = mkdtempSync(join(root, 'node_modules', '.bar-local-modifier-test-'))
  const shimPath = join(temp, 'react-shim.mjs')
  writeFileSync(shimPath, hookHarnessSource())
  try {
    await bundleModernWorkspace(temp, shimPath)
    const { default: ModifierManager } = await import(pathToFileURL(join(temp, 'modifierManager.mjs')).href)
    const harness = await import(pathToFileURL(shimPath).href)
    harness.__resetHooks()
    harness.__beginRender()
    const html = renderToString(React.createElement(ModifierManager, {
      config: {
        groups: [{ modifier_group_id: 'group-1', code: 'SIZE', name: 'Size', required: true, min_selections: 1, max_selections: 1, active: true, version: 2,
          options: [{ modifier_option_id: 'option-1', code: 'LARGE', name: 'Large', price_delta: '2.00', active: true, version: 3 }] }],
        promotions: [{ promotion_id: 'promotion-1', code: 'HAPPYHOUR', name: 'Happy hour', discount_type: 'percent', percent: '10.0000', amount: '0.00', minimum_subtotal: '5.00', scope: 'all', active: true, version: 2 }],
        products: [
          { product_id: 'product-1', sku: 'DRINK-1', name: 'Drink', version: 0, groups: [], recipe_version: 2, recipe_lines: [{ ingredient_product_id: 'ingredient-1', quantity: '0.500000', unit_cost: '0.75' }] },
          { product_id: 'ingredient-1', sku: 'ING-1', name: 'Ingredient', version: 0, groups: [], recipe_version: 0, recipe_lines: [] }
        ]
      },
      busy: false,
      blocked: false,
      onCommand: async () => ({ outcome: 'committed_local' })
    }))
    assert.match(html, /Existing group/)
    assert.match(html, /Add option/)
    assert.match(html, /Assign groups to product/)
    assert.match(html, /Recipe and ingredient costs/)
    assert.match(html, /Ingredient/)
    assert.match(html, /Menu product/)
    assert.match(html, /Promotions/)
    assert.match(html, /Save promotion/)
    assert.match(html, /Price change/)
    assert.match(html, /version guard/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Modern and Legacy cashier code paths submit a code using a scoped active-promotion snapshot', () => {
  const modernSource = readFileSync(modernWorkspace, 'utf8')
  const legacySource = readFileSync(join(root, 'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx'), 'utf8')
  for (const source of [modernSource, legacySource]) {
    assert.match(source, /query\('menu\.promotions', \{\}\)/)
    assert.match(source, /promotion_code: code/)
    assert.match(source, /Estimated cash due|Estimated amount/)
  }
})

test('Modern local staff changes clear prior session data before showing the next operator workspace', () => {
  const source = readFileSync(modernWorkspace, 'utf8')
  const clearStart = source.indexOf('const clearSessionWorkspace = () => {')
  const clearEnd = source.indexOf('\n  }', clearStart)
  assert.ok(clearStart >= 0 && clearEnd > clearStart, 'session workspace reset helper is required')
  const clear = source.slice(clearStart, clearEnd)
  for (const state of [
    'setCatalogue([])', 'setCustomers([])', 'setSales([])', 'setAuditRows([])',
    'setSupportReports([])', 'setStaffRows([])', 'setReport(null)', 'setLastReceipt(null)',
    'setOpenTabs([])', 'setStockLotRows([])', 'setCashupSummary(null)', 'setMenuDraft({',
    'setStockDraft({', 'setDiscountApprovalPin(\'\')', 'setReturnApprovalPin(\'\')',
    'setCashupApprovalBusy(false)', 'setSupportReportsLoading(false)', 'setAuditLoading(false)'
  ]) assert.ok(clear.includes(state), `staff transition must clear ${state}`)
  assert.match(clear, /workspaceGeneration\.current \+= 1/, 'new session invalidates any previous in-flight workspace query')
  for (const method of ['const searchAudit = async', 'const loadSupportReports = async']) {
    const start = source.indexOf(method)
    const end = source.indexOf('\n  }', start)
    assert.match(source.slice(start, end), /generation !== workspaceGeneration\.current/, `${method} must discard responses from an earlier staff session`)
  }
  const loginStart = source.indexOf('const login = async')
  const loginEnd = source.indexOf('\n  }', loginStart)
  assert.ok(source.slice(loginStart, loginEnd).indexOf('clearSessionWorkspace()') < source.slice(loginStart, loginEnd).indexOf('setSession(result.session)'), 'new session must be installed only after old private state is cleared')
  const logoutStart = source.indexOf('const logout = async')
  const logoutEnd = source.indexOf('\n  }', logoutStart)
  const logout = source.slice(logoutStart, logoutEnd)
  assert.ok(logout.indexOf('await window.api.barLocal.logout()') < logout.indexOf('clearSessionWorkspace()'), 'private state clears only after authority logout is confirmed')
})

test('Modern and Legacy local cashiers poll catalogue changes and block stale-cart commits until a full snapshot succeeds', () => {
  const modern = readFileSync(modernWorkspace, 'utf8')
  const legacy = readFileSync(join(root, 'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx'), 'utf8')
  assert.match(modern, /getCatalogueSnapshot\(\)/)
  assert.match(modern, /catalogueSyncError/)
  assert.match(modern, /shared local menu changed\. Your unsent cart was cleared/)
  assert.match(modern, /Boolean\(catalogueSyncError\).*commitSale/s)
  assert.match(legacy, /barLocal\.events\(catalogueEventCursor\.current, 200\)/)
  assert.match(legacy, /retention_floor_sequence/)
  assert.match(legacy, /loadCompleteCatalogue\(authority\)/)
  assert.match(legacy, /Boolean\(catalogueSyncError\).*commitSale/s)
  assert.match(legacy, /catalogueEventCursor\.current = Math\.max\(menu\.snapshot_watermark, replayCursor\)/)
})

test('Modern setup offers saved provisioning recovery and hides new setup forms while recovery is pending', () => {
  const app = readFileSync(join(root, 'src/renderer/src/App.jsx'), 'utf8')
  assert.match(app, /Resume saved \$\{currentAuthority\.provisioning_recovery\.kind/)
  assert.match(app, /currentAuthority\?\.provisioning_recovery\?\.pending/)
  assert.ok(app.includes('!currentAuthority?.provisioning_recovery?.pending && <>'))
  assert.match(app, /resumeProvisioning\(\)/)
})

test('Modern and Legacy local Settings expose service-enforced discount threshold and maximum controls', () => {
  const modernSource = readFileSync(modernWorkspace, 'utf8')
  const legacySource = readFileSync(join(root, 'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx'), 'utf8')
  const policySource = readFileSync(join(root, 'src/renderer/src/components/hospitality-pos/BarLocalDiscountPolicy.jsx'), 'utf8')
  for (const source of [modernSource, legacySource]) {
    assert.match(source, /BarLocalDiscountPolicy policy=\{discountPolicy\}/)
    assert.match(source, /canManageSettings && <BarLocalDiscountPolicy/)
  }
  assert.match(policySource, /settings\.update/)
  assert.match(policySource, /discount_approval_threshold_percent/)
  assert.match(policySource, /discount_max_percent/)
  assert.match(policySource, /approval > maximum/)
})

async function settle() {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.resolve()
  }
}

async function renderModernWithEffects(Component, props, harness) {
  harness.__resetHooks()
  let html = ''
  for (let pass = 0; pass < 25; pass += 1) {
    harness.__beginRender()
    html = renderToString(React.createElement(Component, props))
    harness.__runEffects()
    await settle()
    if (!harness.__isDirty()) break
    harness.__clearDirty()
  }
  return html
}

const baselineWindow = globalThis.window

function withBrowserBridge(bridge) {
  globalThis.window = {
    api: { barLocal: bridge },
    setInterval: () => 1,
    clearInterval: () => {}
  }
  // Restore the process baseline, not "whatever was current when this test
  // started". If a test ends early, its late cleanup must never install a stale
  // bridge over a later test's window.
  return () => { globalThis.window = baselineWindow }
}

function signedInStatus() {
  return {
    session: {
      staff: { display_name: 'Counter staff', capabilities: ['pos.sell'] },
      outlet_id: 'outlet-test'
    }
  }
}

test('Modern and Legacy local Bar workspaces render signed-out login without touching the browser bridge', async () => {
  const temp = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.renderer-'))
  try {
    const result = await build({
      entryPoints: {
        modern: modernWorkspace,
        legacy: join(root, 'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx')
      },
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      jsx: 'automatic',
      outdir: temp,
      outExtension: { '.js': '.mjs' },
      logLevel: 'silent'
    })
    assert.equal(result.errors.length, 0)
    const [{ default: Modern }, { default: Legacy }] = await Promise.all([
      import(pathToFileURL(join(temp, 'modern.mjs')).href),
      import(pathToFileURL(join(temp, 'legacy.mjs')).href)
    ])
    const modern = renderToString(React.createElement(Modern, { status: { session: null }, onLogout() {} }))
    const legacy = renderToString(React.createElement(Legacy, { authority: { outlet_id: 'outlet-test' } }))
    assert.match(modern, /Local staff sign in/)
    assert.match(legacy, /Local staff sign in/)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Modern recovery keeps an unknown intent visible and blocks sign-out when the catalogue refresh fails', async () => {
  const temp = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.renderer-'))
  const restoreBridge = withBrowserBridge({
    refreshReadiness: async () => ({ ready: true, blockers: [] }),
    getCatalogueSnapshot: async () => { throw new Error('catalogue snapshot unavailable') },
    query: async () => ({ data: null }),
    getOpenIntents: async () => ([{
      operation_id: 'op-unknown-1',
      command: 'sale.commit',
      state: 'unknown',
      created_at: '2026-10-20T00:00:00Z'
    }]),
    logout: async () => ({ ok: true })
  })
  try {
    const shimPath = join(temp, 'react-hook-harness.mjs')
    writeFileSync(shimPath, hookHarnessSource())
    const harness = await import(pathToFileURL(shimPath).href)
    const { default: Modern } = await bundleModernWorkspace(temp, shimPath)
    let html = ''
    try {
      html = await renderModernWithEffects(Modern, { status: signedInStatus(), onLogout() {} }, harness)
    } finally {
      harness.__dispose()
    }

    const text = html.replace(/<!--.*?-->/g, '')
    assert.match(text, /catalogue snapshot unavailable/)
    assert.match(text, /Saved operation/)
    assert.match(text, /op-unknown-1/)
    assert.match(text, /sale\.commit/)
    assert.match(text, /Retry the exact same operation ID/)
    assert.match(text, /ask a manager to recover operation op-unknown-1/)
    assert.match(text, /original basket and operation ID are preserved/)
    assert.match(text, /Check saved operation status/)
    assert.match(text, /New operations, panel changes, cart edits and sign-out stay paused/)
    const signOut = html.match(/<button[^>]*>Sign out<\/button>/)?.[0] ?? ''
    assert.match(signOut, /disabled/)
    const commitSale = html.match(/<button[^>]*>Commit sale<\/button>/)?.[0] ?? ''
    assert.match(commitSale, /disabled/)
    const counterTab = html.match(/<button[^>]*>Counter<\/button>/)?.[0] ?? ''
    assert.match(counterTab, /disabled/)
  } finally {
    restoreBridge()
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Modern administration panel shows authoritative status and guards destructive actions', async () => {
  const temp = mkdtempSync(join(root, 'node_modules', '.bar-local-admin-test-'))
  const shimPath = join(temp, 'react-shim.mjs')
  writeFileSync(shimPath, hookHarnessSource())
  const restoreBridge = withBrowserBridge({
    // The admin panel reads the committed profile (including whether this
    // authority is practice mode) before loading the rest of its status.
    getStatus: async () => ({ training: false, authority_mode: 'bar_local', configured: true }),
    adminRecoveryStatus: async () => ({ recovery: { archive: { enabled: true }, copy_destination: null, packages: [] } }),
    adminStatus: async () => ({ status: { network: { role: 'single_host' }, database: { database: 'local-bar-test' }, update: { schema_migration: '0050_commit_durability_guard.sql', contract_version: 1 } } }),
    adminBackups: async () => ({ packages: [{ file_name: 'bar-2026-10-20.dump', created_at: '2026-10-20T10:00:00.000Z', bytes: 4096, verified: true }] }),
    adminRunBackup: async () => ({ ok: true }),
    adminVerifyBackup: async () => ({ ok: true }),
    adminReplicationStatus: async () => ({ role: 'single_host', durability: 'full', status: 'healthy', lag_commits: 0 }),
    adminSetDurability: async () => ({ ok: true }),
    adminSwitchover: async () => ({ ok: true }),
    adminUpdateStatus: async () => ({
      service_version: '1.5.7', schema_migration: '0074', status: 'idle', apply_enabled: false,
      inbox_dir: 'C:\\ProgramData\\TsaBonno\\updates\\inbox', inbox: [{ package: 'signed-release-1.5.8', version: '1.5.8', manifest_present: true }],
      trust: { configured: true, key_id: 'release-key-1' }, staged_state: 'none',
      message: 'No verified package is staged.', staged_message: 'No verified package is staged.'
    }),
    adminCloudSyncStatus: async () => ({
      ok: true,
      command: 'cloud-sync-status',
      status: {
        available: true,
        transport: 'disabled',
        signing_secret_configured: false,
        configured: true,
        enabled: false,
        pending_events: 4,
        prepared_batches: 1,
        failed_batches: 0,
        acknowledged_watermark: 12,
        last_check_at: '2026-10-27T10:00:00.000Z',
        last_success_at: null,
        last_error_code: null,
        last_error_message: null,
        last_final_sync_at: null,
        last_final_sync_state: null,
        next_due_at: null,
        receiver_url: null,
        schedule_mode: 'fifteen_minutes',
        daily_at: '23:30',
        batch_limit: 200,
        signing_key_id: null,
        latest_batch: null
      }
    }),
    adminCloudSyncConfig: async () => ({ ok: true, command: 'cloud-sync-config', status: { available: true, transport: 'disabled', signing_secret_configured: false, configured: true, enabled: false } }),
    adminCloudSyncRun: async () => ({ ok: false, command: 'cloud-sync-run', status: 'disabled', transport: 'disabled', uploaded_batches: 0, final: false, final_state: 'disabled' }),
    query: async (name) => {
      assert.equal(name, 'loyalty.programs.list')
      return { complete: true, data: [], scope: { business_id: 'business-1', outlet_id: 'outlet-1' }, unavailable: [] }
    }
  })
  try {
    const { adminPanel: Admin } = await bundleModernWorkspace(temp, shimPath)
    const harness = await import(pathToFileURL(shimPath).href)
    let html = ''
    try {
      html = await renderModernWithEffects(Admin, { blocked: false, onError() {}, onNotice() {} }, harness)
    } finally {
      // The recovery panel starts a live poll interval; dispose its effects
      // before restoring the bridge so the test process can exit.
      harness.__dispose()
    }
    const text = html.replace(/<!--.*?-->/g, '')
    assert.match(text, /Local authority administration/)
    assert.match(text, /local-bar-test/)
    assert.match(text, /single_host/)
    assert.match(text, /bar-2026-10-20\.dump/)
    assert.match(text, /4\.0 KiB/)
    assert.match(text, /1\.5\.7/)
    assert.match(text, /Offline service update/)
    assert.match(text, /signed-release-1\.5\.8/)
    assert.match(text, /Choose offline package folder/)
    assert.match(text, /Verify and stage/)
    assert.match(text, /APPLY_UPDATE/)
    assert.match(text, /Cloud synchronisation/)
    assert.match(text, /Cloud upload is disabled in this Bar server configuration/)
    assert.match(text, /Sync now/)
    assert.match(text, /Leave the receiver URL and signing key identifier blank/)
    assert.match(text, /Set durability/)
    const switchover = html.match(/<button[^>]*>Confirm switchover<\/button>/)?.[0] ?? ''
    assert.match(switchover, / disabled=""/)
    const runBackup = html.match(/<button[^>]*>Run backup<\/button>/)?.[0] ?? ''
    assert.doesNotMatch(runBackup, / disabled=""/)
  } finally {
    restoreBridge()
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Modern startup fences financial controls until the saved-operation journal has been checked', async () => {
  const temp = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.renderer-'))
  const restoreBridge = withBrowserBridge({
    refreshReadiness: async () => ({ ready: true, blockers: [] }),
    getCatalogueSnapshot: async () => ({ complete: true, unavailable: [], products: [] }),
    query: async () => ({ data: null }),
    getOpenIntents: () => new Promise(() => {}),
    logout: async () => ({ ok: true })
  })
  try {
    const shimPath = join(temp, 'react-hook-harness.mjs')
    writeFileSync(shimPath, hookHarnessSource())
    const harness = await import(pathToFileURL(shimPath).href)
    const { default: Modern } = await bundleModernWorkspace(temp, shimPath)
    let html = ''
    try {
      html = await renderModernWithEffects(Modern, { status: signedInStatus(), onLogout() {} }, harness)
    } finally {
      harness.__dispose()
    }

    const text = html.replace(/<!--.*?-->/g, '')
    assert.match(text, /Saved local operations are being checked after sign-in/)
    assert.match(text, /stay paused until the operation journal has been verified/)
    const signOut = html.match(/<button[^>]*>Sign out<\/button>/)?.[0] ?? ''
    assert.match(signOut, /disabled/)
    const counterTab = html.match(/<button[^>]*>Counter<\/button>/)?.[0] ?? ''
    assert.match(counterTab, /disabled/)
  } finally {
    restoreBridge()
    rmSync(temp, { recursive: true, force: true })
  }
})

test('Modern recovery retries the durable operation id and resolves only through authoritative status', () => {
  const source = readFileSync(modernWorkspace, 'utf8')
  assert.match(source, /const commandBlocked = busy \|\| Boolean\(pending\) \|\| intentsFenced/)
  assert.match(source, /retryOperation\(operationId\)/)
  assert.match(source, /getOperation\(pending\.id\)/)
  assert.match(source, /operation\?\.status === 'committed'/)
  assert.match(source, /operation\?\.status === 'refused'/)
  assert.match(source, /A saved operation is dismissed only when the local authority confirms it was committed or terminally refused/)
  assert.doesNotMatch(source, /setPending\(\{ id: crypto\.randomUUID/)
})

test('Modern recovery fails closed when the saved intent journal cannot be checked', async () => {
  const temp = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.renderer-'))
  const restoreBridge = withBrowserBridge({
    refreshReadiness: async () => ({ ready: true, blockers: [] }),
    getCatalogueSnapshot: async () => ({ complete: true, unavailable: [], products: [] }),
    query: async () => ({ data: null }),
    getOpenIntents: async () => { throw new Error('intent journal unavailable') },
    logout: async () => ({ ok: true })
  })
  try {
    const shimPath = join(temp, 'react-hook-harness.mjs')
    writeFileSync(shimPath, hookHarnessSource())
    const harness = await import(pathToFileURL(shimPath).href)
    const { default: Modern } = await bundleModernWorkspace(temp, shimPath)
    let html = ''
    try {
      html = await renderModernWithEffects(Modern, { status: signedInStatus(), onLogout() {} }, harness)
    } finally {
      harness.__dispose()
    }

    const text = html.replace(/<!--.*?-->/g, '')
    assert.match(text, /Saved local operations could not be checked: intent journal unavailable/)
    assert.match(text, /Sign-out stays paused/)
    const signOut = html.match(/<button[^>]*>Sign out<\/button>/)?.[0] ?? ''
    assert.match(signOut, /disabled/)
    assert.match(html, /Recheck saved operations/)
  } finally {
    restoreBridge()
    rmSync(temp, { recursive: true, force: true })
  }
})


test('owner sign-in retains the committed setup identity and recovery guidance', async () => {
  const temp = mkdtempSync(join(root, 'node_modules', '.bar-local-owner-recovery-'))
  const shimPath = join(temp, 'react-shim.mjs')
  writeFileSync(shimPath, hookHarnessSource())
  try {
    const { default: Workspace } = await bundleModernWorkspace(temp, shimPath)
    const hooks = await import(pathToFileURL(shimPath).href)
    hooks.__resetHooks()
    hooks.__beginRender()
    const html = renderToString(Workspace({ status: {}, onLogout() {}, initialStaffId: 'owner-123', initialLoginNotice: 'Your Bar was created. Sign in with the owner PIN.' }))
    assert.match(html, /owner-123/)
    assert.match(html, /Your Bar was created/)
    assert.match(html, /Local staff sign in/)
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

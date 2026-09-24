import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const terminal = () => read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx')

test('fresh basket input retires a stale sale error', () => {
  const source = terminal()
  // A server stock refusal from an earlier Pay must not survive Clear and
  // block the next basket: every basket mutation clears the sale error while
  // uncertain-attempt recovery state stays untouched.
  for (const marker of [
    'const updateQty = useCallback((id, qty) => {',
    'const setQty = useCallback((id, raw) => {',
    'const removeLine = useCallback((id) => {',
  ]) {
    const at = source.indexOf(marker)
    assert.ok(at >= 0, `missing ${marker}`)
    assert.ok(
      source.slice(at, at + 220).includes('setSubmitError("")'),
      `stale error not cleared in ${marker}`,
    )
  }
  // Destructive confirms are in-app dialogs (styled, Escape-dismissible,
  // SR-announced) — never window.confirm browser chrome. Title and message
  // are separate ConfirmDialog props rather than one concatenated sentence.
  assert.match(source, /setPendingConfirm\("clear"\)/)
  assert.match(source, /title=\{pendingConfirm === "clear" \? "Clear this sale\?" :/)
  assert.match(source, /"All unpaid lines will be removed\."/)
  assert.doesNotMatch(source, /window\.confirm\("Clear this sale/)
  const clearAt = source.indexOf('const applyClearCart = useCallback')
  assert.ok(clearAt >= 0, 'applyClearCart must own the actual clear')
  assert.ok(source.slice(clearAt, clearAt + 320).includes('setSubmitError("")'))
  // addToCart clears first, then still reports a fresh stock block.
  const addAt = source.indexOf('const addToCart = useCallback')
  const addBlock = source.slice(addAt, addAt + 1200)
  assert.ok(addBlock.includes('setSubmitError("")'))
  assert.ok(addBlock.includes('needs stock setup before it can be sold'))
})

test('Same again rebuilds the last sale from the live catalog', () => {
  const source = terminal()
  assert.match(source, /Same again/)
  assert.match(source, /reorderLastSale/)
  assert.match(source, /No previous sale on this terminal yet\./)
  // Unavailable lines are skipped and reported, never failing the round.
  assert.match(source, /unavailable/)
  assert.match(source, /Last sale items are unavailable now/)
})

test('blocked Till cards show their reason on the card, not only to readers', () => {
  const source = terminal()
  assert.match(source, /\{blocked && \(/)
  assert.match(source, /\{unavailableLabel\}/)
})

test('recovery banner collapses to one line but never dismisses', () => {
  const source = terminal()
  assert.match(source, /recoveryCollapsed/)
  assert.match(source, /Earlier sale needs checking — tap for details\./)
  assert.match(source, /Show earlier sale details/)
  // Pay stays bound to the original attempt: collapse is visual only.
  assert.match(source, /Retry this exact attempt/)
})

test('offline reads fail fast to cache and errors read human', () => {
  const connectivity = read('src/main/domains/connectivity.js')
  assert.match(connectivity, /withNetworkTimeout/)
  assert.match(connectivity, /NETWORK_READ_TIMEOUT_MS/)
  const pos = read('src/main/domains/pos.js')
  assert.match(pos, /withNetworkTimeout\(\s*\n?\s*state\.supabase\.rpc\('pos_get_safe_staff'/)
  assert.match(pos, /Unlock Till must never wait on a dead network/)
  // The preload bridge stays a dumb pipe (pinned by production guardrails);
  // human wording lives in a shared helper applied at display points.
  const preload = read('src/preload/index.js')
  assert.match(preload, /const invoke = \(channel, \.\.\.args\) => ipcRenderer\.invoke\(channel, \.\.\.args\)/)
  assert.doesNotMatch(preload, /cleanInvokeError/)
  const helper = read('src/shared/transportErrors.js')
  assert.match(helper, /Error invoking remote method/)
  const stock = read('src/renderer/src/components/hospitality-pos/HposStock.jsx')
  assert.match(stock, /transportErrorMessage/)
})

test('finished stock is automatic: no manual eye switch anywhere on the Till', () => {
  const source = terminal()
  assert.doesNotMatch(source, /toggleTillAvailability/)
  assert.doesNotMatch(source, /onToggleAvailability/)
  assert.doesNotMatch(source, /canManageTillMenu/)
  assert.doesNotMatch(source, /Mark \$\{item\.name\} sold out/)
})

test('zero-stock items grey out and refuse over-selling', () => {
  const source = terminal()
  assert.match(source, /salesLeftForCount/)
  assert.match(source, /onHandRefusal/)
  assert.match(source, /isFinishedStock/)
  assert.match(source, /Finished — out of stock/)
  assert.match(source, /is finished — out of stock\. Receive stock first\./)
  assert.match(source, /Only \$\{left\} \$\{itemName \|\| "product"\} left in stock\./)
  assert.match(source, /finishedStock=\{isFinishedStock\(item\)\}/)
  assert.match(source, /product_finished/)
  // Pool tables are box cash and ignore counts entirely, even a table
  // product created long ago with a stock link.
  assert.match(source, /if \(isPoolCategory\(category\)\) return null;/)
  assert.match(source, /if \(isPoolCategory\(item\?\.category\)\) return false;/)
  // Counts refresh quietly after every sale so the next basket sees them.
  assert.match(source, /refreshReadiness\(\{ silent: true \}\)/)
})

test('Pool night adds every table in one tap', () => {
  const source = terminal()
  assert.match(source, /poolNightProducts/)
  assert.match(source, /startPoolNight/)
  assert.match(source, /Pool night/)
  assert.match(source, /No pool tables found\. Add Pool Table 1 in Products first\./)
})

test('low-stock badges load idle and never block selling', () => {
  const source = terminal()
  assert.match(source, /lowStockMap/)
  assert.match(source, /window\.api\?\.inventory\?\.getLowStock\?\.\(\)/)
  assert.match(source, /Only \{lowStock\.qty\} \{lowStock\.unit\} left/)
  assert.match(source, /requestIdleCallback/)
})

test('readiness migration only adds counts: no grant, revoke, drop or data change', () => {
  const sql = read('supabase/migrations/20260913000000_bar_readiness_on_hand.sql')
  assert.match(sql, /create or replace function public\.get_pos_menu_stock_readiness\(p_lodge_id uuid\)/)
  assert.match(sql, /on_hand/)
  assert.match(sql, /stock_unit/)
  assert.match(sql, /inventory_items\.current_stock|ii\.current_stock/)
  assert.doesNotMatch(sql, /\n\s*revoke\s/i)
  assert.doesNotMatch(sql, /\n\s*grant\s/i)
  assert.doesNotMatch(sql, /drop function/i)
  assert.doesNotMatch(sql, /\n\s*(insert into|update |delete from) public\./i)
  // Same callers, same roles, same hardening.
  assert.match(sql, /app_require_lodge_role\(p_lodge_id, array\['manager','admin','super_admin','cashier'\]\)/)
  assert.match(sql, /security definer set search_path=public/)
})

test('readiness counts travel with ready and stale states', async () => {
  const { resolveReadinessState } = await import('../src/shared/tillBasketRecovery.js')
  const rows = [
    { menu_item_id: 'm1', readiness: 'direct', on_hand: 4, stock_unit: 'bottle' },
    { menu_item_id: 'm2', readiness: 'recipe' },
    // Server nulls (non-stock/tray food/pool) must never read as zero stock.
    { menu_item_id: 'm3', readiness: 'non_stock', on_hand: null, stock_unit: null },
    { menu_item_id: 'm4', readiness: 'direct', on_hand: 0, stock_unit: 'can' },
  ]
  const fresh = resolveReadinessState({ success: true, rows }, null)
  assert.equal(fresh.map.get('m1'), 'direct')
  assert.deepEqual(fresh.counts.get('m1'), { qty: 4, unit: 'bottle' })
  assert.equal(fresh.counts.has('m2'), false)
  assert.equal(fresh.counts.has('m3'), false)
  assert.deepEqual(fresh.counts.get('m4'), { qty: 0, unit: 'can' })
  const stale = resolveReadinessState({ success: false }, { at: Date.now() - 1000, rows })
  assert.equal(stale.status, 'stale')
  assert.deepEqual(stale.counts.get('m1'), { qty: 4, unit: 'bottle' })
  assert.equal(stale.counts.has('m3'), false)
  const failed = resolveReadinessState({ success: false }, null)
  assert.equal(failed.counts.size, 0)
})

test('transport error helper strips the Electron prefix and keeps codes', async () => {
  const { cleanTransportError, transportErrorMessage } = await import('../src/shared/transportErrors.js')
  const prefixed = new Error("Error invoking remote method 'inventory:getItems': Stock list timed out.")
  prefixed.code = 'network_read_timeout'
  const stripped = cleanTransportError(prefixed)
  assert.equal(stripped.message, 'Stock list timed out.')
  assert.equal(stripped.code, 'network_read_timeout')
  assert.equal(transportErrorMessage(null, 'Fallback'), 'Fallback')
  assert.equal(transportErrorMessage(new Error('Plain message')), 'Plain message')
})

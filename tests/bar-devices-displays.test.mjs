import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Bar Devices panel discovers printers, configures ESC/POS + drawer, and surfaces the card machine', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  // Printer discovery (shares the lodge receipts:listPrinters contract)
  assert.match(health, /listPrinters/, 'Devices must enumerate Windows printers on this PC');
  assert.match(health, /Detected printers on this PC/, 'Devices must show detected-printer guidance');
  assert.match(health, /hpos-printer-list/, 'Printer entry must offer detected names');
  // ESC/POS target (previously selectable with nowhere to configure it)
  assert.match(health, /escpos_network_host/, 'Devices must configure the ESC/POS host');
  assert.match(health, /escpos_printer_path/, 'Devices must configure the ESC/POS path/share');
  assert.match(health, /Needs ESC\/POS target/, 'Readiness must flag a missing ESC/POS target');
  // Cash drawer detail
  assert.match(health, /cash_drawer_open_timing/, 'Devices must configure drawer timing');
  assert.match(health, /cash_drawer_pin/, 'Devices must configure the drawer pin');
  assert.match(health, /cash_drawer_pulse_on_ms/, 'Devices must configure drawer pulse timing');
  assert.match(health, /Test drawer/, 'Devices must offer a drawer test');
  // Card / swipe machine surfaced (same backend contract as the lodge app)
  assert.match(health, /Card machine \(swipe terminal\)/, 'Devices must surface the card machine panel');
  assert.match(health, /payment_terminal_provider/, 'Devices must capture the terminal provider');
  assert.match(health, /payment_terminal_mode/, 'Devices must capture the terminal mode');
  assert.match(health, /payment_terminal_bridge_url/, 'Devices must capture the bridge URL for bridge modes');
  assert.match(health, /Manual — charge on the machine/, 'Manual mode must stay the default path');
});

test('Bar Devices panel adds readiness, test-all, scanner freshness, and display guidance', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  assert.match(health, /Device readiness/, 'Devices must show a readiness strip');
  assert.match(health, /Test all devices/, 'Devices must offer one-click testing');
  assert.match(health, /testAllDevices/, 'Test-all must run receipt, drawer, terminal, scanner, and display checks');
  assert.match(health, /re-verify/, 'Stale scanner verification must prompt re-verification');
  assert.match(health, /Advanced scanner timing/, 'Scanner timing must collapse behind Advanced');
  // Existing scanner contract strings stay put for the barcode suite
  assert.match(health, /Verify scanner input/);
  assert.match(health, /Minimum characters/);
  assert.match(health, /Inter-key limit/);
  assert.match(health, /Prefix \(optional\)/);
  assert.match(health, /Confirm captured barcode/);
  assert.match(health, /customer_display_enabled/, 'Devices must toggle the customer display');
  assert.match(health, /Open full screen/, 'Devices must offer windowed vs full-screen');
  assert.match(health, /guest-facing monitor/, 'Devices must guide single vs multi-monitor setups');
});

test('Bar Till can send the total to a bridged card machine without losing the manual path', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  assert.match(terminal, /Send .* to card machine/, 'Till must offer to send the total when a bridge is ready');
  assert.match(terminal, /sendPaymentTerminalTotal/, 'Till must reuse the lodge terminal-bridge contract');
  assert.match(terminal, /terminalBridgeReady/, 'Till must gate the send button on provider + bridge URL');
  assert.match(terminal, /Manual card machine/, 'Till must keep manual-mode guidance with the approval-code fallback');
  assert.match(terminal, /Terminal approval code/, 'Manual approval-code entry must remain');
  assert.doesNotMatch(terminal, /sendPaymentTerminalTotal\(\{[^}]*autoSubmit/, 'Terminal send must not auto-submit the sale');
});

test('Lodge/hotel POS keeps full device controls and gains scanner + test-all parity', () => {
  const pos = read('src/renderer/src/components/POS.jsx');
  assert.match(pos, /payment_terminal_provider/, 'Lodge/hotel keeps the card terminal provider field');
  assert.match(pos, /escpos_network_host/, 'Lodge/hotel keeps the ESC/POS target fields');
  assert.match(pos, /Barcode scanner/, 'Lodge/hotel surfaces scanner settings alongside the terminal listener');
  assert.match(pos, /barcode_scanner_enabled/, 'Lodge/hotel scanner settings share the Bar hardware contract');
  assert.match(pos, /scanner_last_verified_at/, 'Lodge/hotel shows shared scanner verification state');
  assert.match(pos, /Test all devices/, 'Lodge/hotel offers the same one-click device test');
  assert.match(pos, /Send Total to Card Machine/, 'Lodge/hotel Till keeps the send-total control the Bar now mirrors');
});

test('Shared hardware backend still normalizes every surfaced field and stays manual-first', () => {
  const adapter = read('src/main/hardware/posHardwareAdapter.js');
  for (const field of [
    'receipt_printer_name',
    'escpos_network_host',
    'cash_drawer_open_timing',
    'payment_terminal_provider',
    'payment_terminal_mode',
    'payment_terminal_bridge_url',
    'barcode_scanner_enabled',
    'customer_display_enabled',
  ]) {
    assert.ok(adapter.includes(field), `Backend must normalize ${field}`);
  }
  assert.match(adapter, /manual.*Charge the card machine manually/, 'Backend must stay manual-first for card machines');
});

test('Customer display pins survive restart and can auto-open on its monitor', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  const adapter = read('src/main/hardware/posHardwareAdapter.js');
  const domain = read('src/main/domains/pos.js');
  const main = read('src/main/index.js');
  const pos = read('src/renderer/src/components/POS.jsx');
  for (const field of ['display_customer_display_id', 'display_bar_display_id', 'display_kitchen_display_id', 'display_customer_auto_open']) {
    assert.ok(adapter.includes(field), `Adapter must persist ${field}`);
    assert.ok(domain.includes(field), `Domain read must return ${field}`);
  }
  assert.match(health, /Pin screens to monitors/, 'Bar Devices must pin each screen to a monitor');
  assert.match(health, /Reopen pinned/, 'Bar Devices must reopen pinned screens in one tap');
  assert.match(health, /Open customer display on startup/, 'Bar Devices must offer startup auto-open');
  assert.match(health, /Pinned screen not detected/, 'Bar Devices must warn when a pinned monitor is unplugged');
  assert.match(main, /display_customer_auto_open/, 'Boot must gate auto-open on the saved opt-in');
  assert.match(main, /display_auto_open/, 'Boot auto-open must leave an audit trail');
  assert.match(pos, /displayPinsSeededRef/, 'Lodge/hotel must reseed monitor choices from saved pins');
  assert.match(pos, /Pinned — reopens here after restart/, 'Lodge/hotel must confirm a pin survives restart');
  assert.match(pos, /display_customer_auto_open/, 'Lodge/hotel must share the startup auto-open toggle');
});

test('Device setup reads as numbered steps with plug-where guidance', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  assert.match(health, /setupSteps/, 'Devices must compute ordered setup steps');
  assert.match(health, /What plugs in where/, 'Devices must say what plugs in where');
  assert.match(health, /drawer cable plugs into the receipt printer/, 'Drawer guidance must name the printer passthrough');
});

test('Network printers can be found without typing addresses, safely', () => {
  const adapter = read('src/main/hardware/posHardwareAdapter.js');
  const main = read('src/main/index.js');
  const preload = read('src/preload/index.js');
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  assert.match(adapter, /export async function scanNetworkPrinters/, 'Adapter must offer a network printer scan');
  assert.match(adapter, /no bytes are ever sent/, 'Scan must be connect-only so nothing prints');
  assert.match(main, /pos:scanNetworkPrinters/, 'Main must expose the scan behind setup access');
  assert.match(preload, /scanNetworkPrinters/, 'Preload must forward the scan');
  assert.match(health, /Find printers on the network/, 'Devices must offer the scan');
  assert.match(health, /print a test before saving/, 'Scan results must demand a test print before trust');
});

test('No-sale drawer opening needs a written reason and cash-up access', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  assert.match(health, /Open drawer \(no sale\)/, 'Devices must offer a no-sale drawer opening');
  assert.match(health, /Type a reason first/, 'No-sale opening must require a reason');
  assert.match(health, /pos\.cashup/, 'No-sale opening must stay behind cash-up access');
});

test('Scanner verification names the product and beeps good vs bad', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  const sound = read('src/shared/tillSound.js');
  assert.match(health, /getMenuItems/, 'Verify must look the barcode up in the menu');
  assert.match(health, /belongs to:/, 'Verify must show which product the barcode belongs to');
  assert.match(sound, /playScanBeep/, 'Sound module must offer a scan earcon');
  assert.match(health, /playScanBeep/, 'Verify must beep good vs bad');
});

test('Morning check looks without touching, daily checks cover open and close', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  assert.match(health, /Run morning check/, 'Devices must offer a morning check');
  assert.match(health, /no test prints, no drawer kicks/, 'Morning check must be read-only');
  assert.match(health, /Daily checks/, 'System Health must have a Daily checks tab');
  assert.match(health, /Open the bar/, 'Daily checks must cover opening');
  assert.match(health, /Close the bar/, 'Daily checks must cover closing');
  assert.match(health, /Card machine total/, 'Close must compare card machine vs report totals');
  assert.match(health, /your own notes on this computer/, 'Card compare boxes must not pose as books');
  assert.match(health, /First day with the till/, 'Devices must include a first-day guide');
  assert.match(health, /Send problem to support/, 'Issues must offer one-tap help');
  assert.match(health, /Never type PINs, passwords, or card numbers/, 'Help must warn against secrets');
});

test('Till display feed is declared after the totals it reads (no render crash)', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  const totalsAt = terminal.indexOf('const total = subtotal - promotionDiscount + tax + tipTotal;');
  const feedAt = terminal.indexOf('Feed the guest-facing screen live');
  assert.ok(totalsAt >= 0, 'Till totals must exist');
  assert.ok(feedAt > totalsAt, 'Display feed effect must sit below the totals or every Sell render crashes');
});

test('Recovery screen reports the full error, not just a reload prompt', () => {
  const boundary = read('src/renderer/src/components/AppErrorBoundary.jsx');
  assert.match(boundary, /componentStack/, 'Recovery must capture the component trail');
  assert.match(boundary, /error\?\.stack/, 'Recovery must capture the JS stack');
  assert.match(boundary, /window\.location\?\.hash/, 'Recovery must capture the route');
  assert.match(boundary, /logRendererError/, 'Recovery must persist the report to renderer-errors.log');
  assert.match(boundary, /Copy full error report/, 'Recovery must offer one-tap copy of the full report');
  assert.match(boundary, /Reload App/, 'Recovery must keep the reload escape');
});

test('Till reprint stays visible mid-sale and never re-charges', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  assert.match(terminal, /reprintLastReceipt/, 'Till must share one reprint path');
  assert.match(terminal, /lastReceipt && !showPayment && cart\.length > 0/, 'Reprint must stay visible with a non-empty basket (the empty-state button alone vanishes on first add)');
  assert.match(terminal, /autoPrint: false/, 'Reprint must open the recorded receipt without auto-printing or re-submitting payment');
  assert.doesNotMatch(terminal, /bb-accent-gradient/, 'Reprint must not use the undefined gradient token that rendered white-on-white and invisible');
});

test('My sales and Sales history can print any receipt', () => {
  const mine = read('src/renderer/src/components/hospitality-pos/HposMySales.jsx');
  const history = read('src/renderer/src/components/hospitality-pos/HposReports.jsx');
  const receipt = read('src/renderer/src/components/shared/POSReceipt.jsx');
  const css = read('src/renderer/src/styles/hospitality-pos.css');
  for (const [name, source] of [['My sales', mine], ['Sales history', history]]) {
    assert.match(source, /POSReceipt/, `${name} must open the shared receipt modal`);
    assert.match(source, /Print receipt/, `${name} must offer receipt printing from its detail view`);
    assert.match(source, /printOrder && <POSReceipt order=\{printOrder\}/, `${name} must print the selected order without inventing a new one`);
    assert.match(source, /-row-print/, `${name} must offer a far-right print action on every listed receipt row`);
    assert.match(source, /setPrintOrder\(order\)/, `${name} row print must open that row's own receipt`);
  }
  assert.match(receipt, /z-\[1100\]/, 'Receipt modal must sit above app modal backdrops (z-1000) instead of opening behind void cards');
  assert.match(css, /hpos-my-sales-row-print/, 'My sales rows need print-action styling');
  assert.match(css, /hpos-report-ledger-row--with-action/, 'History rows need an action column for print');
  assert.match(css, /hpos-report-ledger-row-print\{[^}]*border:0/, 'History print stays a compact borderless icon on the same line');
  assert.match(css, /hpos-report-ledger-head--with-action,\.hpos-report-ledger-row--with-action\{min-width:0\}/, 'History rows must not force horizontal scrolling');
  assert.match(css, /hpos-money-ledger\{overflow-x:visible\}/, 'History ledger must not scroll sideways on small screens');
});

test('Sales history leads with the newest transaction and offers sort choice', () => {
  const history = read('src/renderer/src/components/hospitality-pos/HposReports.jsx');
  assert.match(history, /useState\('newest'\)/, 'History must default to newest first');
  assert.match(history, /Newest first/, 'History must offer newest-first ordering');
  assert.match(history, /Oldest first/, 'History must offer oldest-first ordering');
  assert.match(history, /Highest total/, 'History must offer highest-total ordering');
  assert.match(history, /Lowest total/, 'History must offer lowest-total ordering');
  assert.match(history, /orderRecency\(right\) - orderRecency\(left\)/, 'Default order must be newest first');
  assert.match(history, /\[correctionMode, readCompleteness\.complete, rows, serverControls\]/, 'Money metrics must keep reading unsorted rows — sorting stays display-only');
});

test('Till basket visibility is declared after the payment state it reads (no render crash)', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  const showPaymentAt = terminal.indexOf('const [showPayment,');
  const basketAt = terminal.indexOf('const basketVisible =');
  assert.ok(showPaymentAt >= 0, 'Till payment state must exist');
  assert.ok(basketAt > showPaymentAt, 'basketVisible must sit below showPayment or every Till render crashes to recovery');
  assert.equal(terminal.indexOf('showPayment'), showPaymentAt + 'const ['.length, 'no executable line may read showPayment before its declaration');
  assert.equal(terminal.indexOf('basketVisible'), basketAt + 'const '.length, 'no executable line may read basketVisible before its declaration');
});

test('Till IPC calls resolve empty instead of throwing on a missing binding', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  const checks = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx');
  const displays = read('src/renderer/src/components/POSDisplays.jsx');
  for (const [name, source] of [['Till', terminal], ['Health', health], ['OpenChecks', checks], ['Displays', displays]]) {
    assert.doesNotMatch(source, /window[.]api[?][.][a-z]+[?][.][a-zA-Z]+[?][.][(][)][.]then/, `${name} must wrap optional IPC calls so a missing binding resolves instead of throwing`);
  }
  assert.match(terminal, /Promise[.]resolve[(]window[.]api[?][.]pos[?][.]getUnconfirmedPosUsage[?][.][(][)][)]/, 'Till usage read must be missing-binding safe');
  assert.match(terminal, /Promise[.]resolve[(]window[.]api[?][.]mesh[?][.]lockTab[?][.][(]/, 'Settle lock must be missing-binding safe');
});

test('Till never sticks in loading and always sells on last-known stock', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  assert.match(terminal, /stockReadiness\.status !== "loading"/, 'Watchdog must watch the loading state');
  assert.match(terminal, /Stock check timed out/, 'Watchdog must fail loudly with recourse');
  assert.match(terminal, /buildLocalFallback/, 'Till must build fallback counts from the local stock cache');
  assert.match(terminal, /Selling on this till's last known stock/, 'Fallback mode must say so on screen');
  assert.match(terminal, /"local"/, 'Local fallback must be a first-class readiness state');
});

test('Bar Till feeds the guest screen live and leaves change due behind', () => {
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  const displays = read('src/renderer/src/components/POSDisplays.jsx');
  const receipt = read('src/renderer/src/components/shared/POSReceipt.jsx');
  assert.match(terminal, /updateCustomerDisplay/, 'Till must push its basket to the customer display');
  assert.match(terminal, /Thank you — please take your change/, 'Cash sales must leave change due on the guest screen');
  assert.match(displays, /display_welcome_message/, 'Guest screen must render the saved welcome message');
  assert.match(displays, /Change due/, 'Guest screen must render change due big');
  assert.match(terminal, /Reprint last receipt \(lost slip\?\)/, 'Reprint must be big and obvious');
  assert.match(terminal, /power may have gone off/, 'Interrupted baskets must reassure about power cuts');
  assert.match(receipt, /Please close the cash drawer/, 'Cash receipts must nudge the drawer shut');
  assert.match(receipt, /print:hidden">Please close the cash drawer/, 'The drawer nudge is screen-only and must never print on the customer copy');
});

test('Manual drawer (no printer) quiets warnings but never kicks', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  const adapter = read('src/main/hardware/posHardwareAdapter.js');
  const domain = read('src/main/domains/pos.js');
  const pos = read('src/renderer/src/components/POS.jsx');
  assert.ok(adapter.includes('cash_drawer_manual'), 'Adapter must persist the manual-drawer flag');
  assert.ok(domain.includes('cash_drawer_manual'), 'Domain read must return the manual-drawer flag');
  assert.match(adapter, /manual \(key open\)/, 'Electronic kicks must refuse in manual mode');
  assert.match(health, /Manual drawer \(no printer\)/, 'Bar Devices must offer the manual drawer');
  assert.match(health, /Manual drawer — key open/, 'Readiness must show the manual drawer as ready');
  assert.match(health, /Money routines keep working/, 'Manual drawer must promise the money routines keep working');
  assert.match(pos, /Manual drawer \(no printer\)/, 'Lodge/hotel must share the manual drawer');
  assert.match(pos, /manual drawer — no kick test/, 'Lodge/hotel test-all must skip the kick for manual drawers');
});

test('Bank-terminal setup is guided with a technician message contract', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  assert.match(health, /hpos-terminal-providers/, 'Provider entry must suggest known banks');
  assert.match(health, /type the amount into the bank machine/, 'Manual copy must describe the bank-machine flow');
  assert.match(health, /Bank technician\? See exactly what the Till sends/, 'Devices must document the bridge message');
  assert.match(health, /"type": "sale"/, 'Technician docs must show the sale message');
  assert.match(health, /"approved": true/, 'Technician docs must show the expected approval reply');
});

test('Two tills share stock counts: unsent sales subtract on both tills', () => {
  const domain = read('src/main/domains/pos.js');
  const database = read('src/main/database.js');
  const main = read('src/main/index.js');
  const preload = read('src/preload/index.js');
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  assert.match(domain, /export function getUnconfirmedPosUsage/, 'Domain must expose unconfirmed usage');
  assert.match(domain, /create_pos_return_v3/, 'Usage must hand returns back best-effort');
  assert.match(domain, /approve_pos_void_with_pin/, 'Usage must hand voids back best-effort');
  assert.match(database, /getUnconfirmedPosUsage/, 'Facade must expose the usage read');
  assert.match(main, /pos:getUnconfirmedPosUsage/, 'Main must serve usage behind Till access');
  assert.match(preload, /getUnconfirmedPosUsage/, 'Preload must forward the usage read');
  assert.match(terminal, /applyPendingUsage/, 'Till must subtract unsent sales from its counts');
  assert.match(terminal, /lastQueueMergeAt/, 'Till must refresh only on real mesh merges');
  assert.match(terminal, /from the other till.*counts play it safe until they send/, 'Till must show the other-till freshness chip');
});

test('One tab, one settlement: mesh tab holds across tills', () => {
  const locks = read('src/main/domains/mesh/meshLocks.js');
  const main = read('src/main/index.js');
  const preload = read('src/preload/index.js');
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  const checks = read('src/renderer/src/components/hospitality-pos/HposOpenChecks.jsx');
  assert.match(locks, /createTabLock/, 'Mesh must offer tab-settlement locks');
  assert.match(locks, /releaseTabLock/, 'Mesh must release tab-settlement locks');
  assert.match(locks, /resourceKind.*pos-tab/, 'Tab locks must ride the existing lock broadcast');
  assert.match(main, /mesh:lockTab/, 'Main must serve tab locks to Till operators');
  assert.match(main, /mesh:unlockTab/, 'Main must serve tab unlocks to Till operators');
  assert.match(preload, /lockTab/, 'Preload must forward tab locks');
  assert.match(terminal, /being settled on the other till/, 'Till Pay must wait when the other till settles');
  assert.match(checks, /Settling on the other till/, 'Open Tabs must badge a settling tab and hold Settle');
});

test('Long-offline tills share tabs, shifts, menu, promos, and stock receipts', () => {
  const merge = read('src/main/domains/mesh/meshQueueMerge.js');
  assert.match(merge, /applyImportedTabCacheEffects/, 'Mesh must land peer tabs in the local tab list');
  assert.match(merge, /applyImportedShiftCacheEffects/, 'Mesh must land peer shift opens in the local shift list');
  assert.match(merge, /applyImportedMenuCacheEffects/, 'Mesh must land peer menu writes in the selling list');
  assert.match(merge, /applyImportedModifierPromotionEffects/, 'Mesh must land peer modifier and promotion lists');
  assert.match(merge, /applyImportedStockReceiptEffects/, 'Mesh must land peer deliveries and counts in stock');
  assert.match(merge, /create_pos_menu_item_offline/, 'Offline product creates must be mesh-shareable');
  assert.match(merge, /update_pos_menu_item_offline/, 'Offline product updates must be mesh-shareable');
  assert.match(merge, /raw staff PINs/, 'Clock operations must stay off the mesh: raw PINs never travel');
  const usage = read('src/main/domains/pos.js');
  assert.match(usage, /post_bar_simple_delivery/, 'Till counts must include deliveries received on either till');
});

test('Weeded mesh contract: drawer opens, pack/product writes, checklists flow; PIN work never does', () => {
  const merge = read('src/main/domains/mesh/meshQueueMerge.js');
  for (const table of [
    'open_pos_drawer_period',
    'set_bar_pos_pack_template_offline',
    'save_bar_pos_product_with_packs_offline',
    'create_daily_checklist',
    'create_bar_checklist_from_template',
    'complete_checklist_item',
  ]) {
    assert.ok(merge.includes(`'${table}'`), `${table} must be mesh-shareable`);
  }
  assert.match(merge, /applyImportedDrawerOpenEffects/, 'Peer drawer opens must land in the drawer list');
  assert.match(merge, /applyImportedProductPackEffects/, 'Peer pack/product writes must land in the selling list');
  assert.match(merge, /applyImportedChecklistEffects/, 'Peer checklists and check-offs must land visibly');
  assert.match(merge, /must not carry PIN material/, 'Drawer opens carrying PINs must be quarantined, not merged');
  for (const table of [
    'clock_in_staff_offline',
    'clock_out_staff_offline',
    'clock_in_staff_with_attendance_pin_offline',
    'record_pos_cash_movement',
    'record_pos_cash_count',
    'submit_pos_drawer_period_cashup',
    'review_pos_drawer_period_cashup',
    'review_pos_cashup_submission_offline',
    'activate_shared_till_operator_offline',
    'submit_pos_shift_cashup_with_attendance_pin',
  ]) {
    assert.ok(!merge.includes(`'${table}'`), `${table} carries PINs and must stay off the mesh`);
  }
});

test('Team visibility travels without credentials: sanitized state sync, never replay', () => {
  const stateSync = read('src/main/domains/mesh/meshStateSync.js');
  const server = read('src/main/domains/mesh/meshServer.js');
  const merge = read('src/main/domains/mesh/meshQueueMerge.js');
  const meshState = read('src/main/domains/mesh/meshState.js');
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  assert.match(stateSync, /buildTeamStateSnapshot/, 'State sync must build snapshots');
  assert.match(stateSync, /validateTeamStateSnapshot/, 'State sync must validate snapshots');
  assert.match(stateSync, /applyTeamStateSnapshot/, 'State sync must merge snapshots');
  for (const key of ['pin', 'password', 'manager_pin', 'approval_pin', 'secret', 'token']) {
    assert.ok(stateSync.includes(key), `Sanitizer must name ${key}`);
  }
  assert.match(stateSync, /refused|refuse/, 'Credential-carrying snapshots must be refused');
  assert.match(stateSync, /never overwrites|never overwrite|Additive-only/i, 'Merge must be additive-only');
  assert.match(stateSync, /never.*replay|replay/i, 'State rows must never enter replay');
  assert.match(server, /\/mesh\/state\/team/, 'Server must serve the team snapshot route');
  assert.match(merge, /\/mesh\/state\/team/, 'Queue sync must pull team state per peer');
  assert.match(merge, /lastTeamSync/, 'Merge must record team sync health');
  assert.match(meshState, /lastTeamSync/, 'Diagnostics must expose team sync health');
  assert.match(health, /Team state \(who is in shift/, 'Bar mesh screen must show team sharing honestly');
});

test('Bar surfaces the same Local Mesh screen as the lodge app', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  const lodge = read('src/renderer/src/components/SystemHealthPanel.jsx');
  assert.match(lodge, /Local Mesh/, 'Lodge baseline: Local Mesh screen exists');
  assert.match(health, /Other tills on this network/, 'Bar must show the mesh screen in Bar words');
  assert.match(health, /mesh:getDiagnostics|mesh\?\.getDiagnostics/, 'Bar mesh screen must read diagnostics');
  assert.match(health, /Connect till/, 'Bar mesh screen must connect by address');
  assert.match(health, /Tab holds/, 'Bar mesh screen must show tab holds, not room holds');
  assert.match(health, /onConflictDetected/, 'Bar must surface mesh disagreements for manager review');
});

test('Audit fixes: pinned auto-open, honest drawer, manual notice, steady terminal id', () => {
  const health = read('src/renderer/src/components/hospitality-pos/HposSystemHealth.jsx');
  const main = read('src/main/index.js');
  const terminal = read('src/renderer/src/components/hospitality-pos/HposTerminal.jsx');
  assert.match(main, /hardware[.]display_customer_display_id/, 'Boot auto-open must read the pinned monitor');
  assert.match(main, /displayId: pinnedId/, 'Boot auto-open must open on the pinned monitor');
  assert.doesNotMatch(health, /receipt_print_mode !== 'escpos'/, 'Drawer readiness must not pass on Windows-printer mode alone');
  assert.match(health, /result[?][.](manual|success)/, 'Card test must handle manual mode');
  assert.match(health, /nothing to test/, 'Manual card test must say so calmly, not error');
  assert.match(health, /customer_display_enabled === true/, 'Display toggle must match the backend default');
  assert.match(terminal, /terminalRequestRef/, 'Till must keep one steady bridge reference per payment');
  assert.match(terminal, /request_id: requestId/, 'Till must send the steady reference, not mint per click');
  assert.match(health, /set up, not proven/, 'Test-all must label unverified Windows printing honestly');
  assert.match(health, /freshly loaded settings/, 'Pinning must save onto fresh settings, not half-typed edits');
});

test('Lodge/hotel shares the guest-screen welcome message', () => {
  const pos = read('src/renderer/src/components/POS.jsx');
  const adapter = read('src/main/hardware/posHardwareAdapter.js');
  const domain = read('src/main/domains/pos.js');
  assert.ok(adapter.includes('display_welcome_message'), 'Adapter must persist the welcome message');
  assert.ok(domain.includes('display_welcome_message'), 'Domain read must return the welcome message');
  assert.match(pos, /display_welcome_message/, 'Lodge/hotel setup must edit the same welcome message');
});

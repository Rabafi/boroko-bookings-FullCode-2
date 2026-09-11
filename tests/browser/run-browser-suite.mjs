// Playwright behavioral suite for the REAL HposOpenChecks recovery flows
// and the REAL RestaurantWorkspace per-tab gating. Mocked window.api and
// synthetic fixtures; external requests blocked. Exits nonzero on failure.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(dir, '..', '..');
const require = createRequire(path.join(root, 'package.json'));
const { build } = require('esbuild');
const { chromium } = require('playwright');

const K1 = '11111111-1111-4111-8111-111111111111';
const K2 = '22222222-2222-4222-8222-222222222222';

await build({
  entryPoints: [path.join(dir, 'hpos-harness.jsx')],
  bundle: true,
  outfile: path.join(dir, 'hpos-harness.bundle.js'),
  jsx: 'automatic',
  nodePaths: [path.join(root, 'node_modules')],
  define: { 'process.env.NODE_ENV': '"development"' },
  loader: { '.png': 'dataurl', '.svg': 'dataurl' },
  logLevel: 'warning'
});
const bundleCss = path.join(dir, 'hpos-harness.bundle.css');
const server = createServer((req, res) => {
  if (req.url.startsWith('/hpos-harness.bundle.js')) {
    res.setHeader('content-type', 'text/javascript');
    res.end(readFileSync(path.join(dir, 'hpos-harness.bundle.js')));
  } else if (req.url.startsWith('/hpos-harness.bundle.css') && existsSync(bundleCss)) {
    res.setHeader('content-type', 'text/css');
    res.end(readFileSync(bundleCss));
  } else {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><head></head><body><div id="root"></div><script src="/hpos-harness.bundle.js"></script></body></html>');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
const browser = await chromium.launch({ headless: true });
async function scenario(name, fn) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(9000);
    await page.route('**/*', (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
    page.on('pageerror', (e) => { throw new Error(`page error in ${name}: ${e.message}`); });
    await fn(page);
    results.push(`ok - ${name}`);
  } catch (error) {
    results.push(`FAIL - ${name}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await context.close();
  }
}

const calls = (page) => page.evaluate(() => window.__calls);
const apiCalls = (page) => page.evaluate(() => window.__apiCalls);
const pendingKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('hpos:pending-tab-op:')));
const text = (page) => page.locator('body').innerText();

// R1: saved 3-way unknown split, reopened 2-way form — Check status replays 3-way.
await scenario('R1 split check-status replays the saved original', async (page) => {
  await page.goto(`${base}/?suite=recovery&scenario=split-unknown-replay&script=unknown`);
  await page.getByText('Audit Tab').first().waitFor();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  assert.equal(await page.locator('input[type="number"]').inputValue(), '2');
  await page.getByTestId('split-recovery-panel').getByRole('button', { name: 'Check status' }).click();
  await page.waitForFunction(() => window.__calls.length === 1);
  const [call] = await calls(page);
  assert.equal(call.split_count, 3);
  assert.equal(call.source_tab_version, 4);
  assert.equal(call.idempotency_key, K1);
  assert.equal(call.is_replay, true);
  assert.match(await text(page), /Outcome not confirmed/);
  assert.equal(await page.getByRole('button', { name: 'Start corrected attempt' }).count(), 0);
  assert.deepEqual(await pendingKeys(page), [`hpos:pending-tab-op:split:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`]);
});

// R2: fresh terminal rejection offers correction under a new key.
await scenario('R2 rejected split corrects under a new key', async (page) => {
  await page.goto(`${base}/?suite=recovery&scenario=split-fresh&script=reject-terminal&seed=0`);
  await page.getByText('Audit Tab').first().waitFor();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByTestId('split-recovery-panel').waitFor({ state: 'detached' }).catch(() => {});
  await page.getByRole('button', { name: 'Split checks' }).click();
  await page.waitForFunction(() => window.__calls.length === 1);
  assert.match(await text(page), /No split was posted/);
  assert.equal(await page.getByRole('button', { name: 'Start corrected attempt' }).count(), 1);
  await page.locator('input[type="number"]').fill('3');
  await page.getByRole('button', { name: 'Start corrected attempt' }).click();
  await page.waitForFunction(() => window.__calls.length === 2);
  const [first, second] = await calls(page);
  assert.notEqual(second.idempotency_key, first.idempotency_key);
  assert.equal(second.split_count, 3);
});

// R3: transfer replay uses saved target/notes/version without form input.
await scenario('R3 transfer check-status replays saved target and notes', async (page) => {
  await page.goto(`${base}/?suite=recovery&scenario=transfer-replay&script=unknown`);
  await page.getByText('Audit Tab').first().waitFor();
  await page.getByRole('button', { name: 'Transfer waiter' }).first().click();
  await page.getByTestId('transfer-recovery-panel').waitFor();
  await page.getByTestId('transfer-recovery-panel').getByRole('button', { name: 'Check status' }).click();
  await page.waitForFunction(() => window.__calls.length === 1);
  const [call] = await calls(page);
  assert.equal(call.target_waiter_id, 'waiter-2');
  assert.equal(call.target_shift_id, 'shift-2');
  assert.equal(call.expected_tab_version, 5);
  assert.equal(call.notes, 'handover note');
  assert.equal(call.operation_id, K2);
  assert.equal(call.is_replay, true);
  assert.match(await text(page), /Outcome not confirmed/);
});

// R4: tab gone from the active list still resolves through the inbox.
await scenario('R4 inbox replays for a closed source tab', async (page) => {
  await page.goto(`${base}/?suite=recovery&scenario=inbox-gone-tab&script=commit`);
  await page.getByTestId('recovery-inbox').waitFor();
  assert.match(await text(page), /Unresolved operations \(1\)/);
  await page.getByTestId('recovery-inbox').getByRole('button', { name: 'Check status' }).click();
  await page.waitForFunction(() => window.__calls.length === 1);
  const [call] = await calls(page);
  assert.equal(call.idempotency_key, K1);
  assert.equal(call.split_count, 3);
  await page.getByTestId('recovery-inbox').waitFor({ state: 'detached' });
});

// R5: lost ownership keeps replay available to the originator via inbox.
await scenario('R5 inbox replays after ownership change', async (page) => {
  await page.goto(`${base}/?suite=recovery&scenario=ownership-lost&script=unknown`);
  await page.getByText('Audit Tab').first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Split', exact: true }).isDisabled(), true);
  await page.getByTestId('recovery-inbox').waitFor();
  await page.getByTestId('recovery-inbox').getByRole('button', { name: 'Check status' }).click();
  await page.waitForFunction(() => window.__calls.length === 1);
  const [call] = await calls(page);
  assert.equal(call.idempotency_key, K1);
});

// R6: foreign-tenant envelopes never surface in this tenant's inbox.
await scenario('R6 inbox isolates tenants', async (page) => {
  await page.goto(`${base}/?suite=recovery&scenario=foreign-tenant&script=unknown`);
  await page.getByTestId('recovery-inbox').waitFor();
  assert.match(await text(page), /Unresolved operations \(1\)/);
});

// F1: denied expenses tab renders denial, mounts nothing, calls nothing.
await scenario('F1 denied finance tab never mounts', async (page) => {
  await page.goto(`${base}/?suite=finance&tab=expenses&caps=pos.cashup,pos.manage&features=reports,pos,expenses,staff`);
  await page.getByTestId('workspace-tab-denied').waitFor();
  assert.match(await text(page), /Role permission required/);
  assert.equal(await page.getByText('Operating expenses').count(), 0);
  const nav = await page.getByRole('tablist').innerText();
  assert.doesNotMatch(nav, /Expenses/);
  assert.match(nav, /Cash-ups/);
  const reads = (await apiCalls(page)).filter((c) => /^(expenses|reports|inventory|users)\./.test(c));
  assert.deepEqual(reads, []);
});

// F2: allowed cashups tab mounts and reads through its own contract.
await scenario('F2 allowed finance tab mounts and reads', async (page) => {
  await page.goto(`${base}/?suite=finance&tab=cashups&caps=pos.cashup,pos.manage&features=reports,pos,expenses,staff`);
  await page.waitForTimeout(800);
  assert.equal(await page.getByTestId('workspace-tab-denied').count(), 0);
  const reads = await apiCalls(page);
  assert.ok(reads.some((c) => c.startsWith('pos.')), `expected a pos.* read, got ${JSON.stringify(reads)}`);
  assert.ok(!reads.some((c) => c.startsWith('expenses.')));
});

// F3: outlet scope from the URL survives tab switches.
await scenario('F3 outlet scope retained from URL', async (page) => {
  await page.goto(`${base}/?suite=finance&tab=cashups&outlet=out-9&caps=pos.cashup,pos.manage&features=reports,pos,expenses,staff`);
  await page.waitForTimeout(800);
  const hrefs = await page.getByRole('tablist').locator('a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  assert.ok(hrefs.length > 0);
  assert.ok(hrefs.every((h) => h.includes('outlet=out-9')), `outlet scope lost: ${JSON.stringify(hrefs)}`);
});

// F4: no accessible tabs renders an explicit access state with zero calls.
await scenario('F4 empty access renders an access state', async (page) => {
  await page.goto(`${base}/?suite=finance&tab=overview&caps=&features=reports,pos,expenses,staff`);
  await page.getByTestId('workspace-tab-denied').waitFor();
  assert.deepEqual(await apiCalls(page), []);
});

// X1: F1 — concurrent preparation change between review and approval
// cannot be approved; the confirmation clears and renewed review is required.
await scenario('X1 drifted evidence blocks approval without mutation', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  assert.match(await text(page), /Review recorded for batch batch-1/);
  // Concurrent re-preparation (H1 -> H2) lands before the approval click.
  await page.evaluate(() => window.__driftBatch('batch-1'));
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForTimeout(600);
  assert.match(await text(page), /changed since review/);
  assert.match(await text(page), /Nothing was submitted/);
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover')), []);
  const row = await page.evaluate(() => window.__batchRow('batch-1'));
  assert.equal(row.status, 'prepared');
  // The refreshed H2 evidence is shown and needs its own review.
  assert.match(await text(page), /hashH2changed99/);
  // Approving again without renewed review stays blocked (button disabled).
  assert.equal(await page.getByRole('button', { name: 'Approve cutover batch' }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover')), []);
  // Renewed review of H2 approves under the different authorized actor.
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForFunction(() => window.__calls.some((c) => c.op === 'approveCutover'));
  const [approve] = await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover'));
  assert.equal(approve.args.expectedOpeningPayloadHash, 'hashH2changed999');
  assert.match(await text(page), /approved for the reviewed evidence/);
});

// X1b: F1 — server backstop rejects a race between preflight and mutation.
await scenario('X1b preflight-to-mutation race is rejected server-side', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&driftOnApprove=1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForTimeout(600);
  // The server rejected the stale hash; the UI cleared the confirmation and
  // reloaded instead of treating anything as approved.
  assert.match(await text(page), /does not match the prepared batch/);
  assert.match(await text(page), /Outcome not confirmed/);
  assert.match(await text(page), /confirm review of the current evidence/i);
  const row = await page.evaluate(() => window.__batchRow('batch-1'));
  assert.equal(row.status, 'prepared');
});

// X1c: F1 — a batch with no opening hash cannot form review evidence.
await scenario('X1c missing opening hash cannot be reviewed or approved', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-nohash&actor=b`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  assert.match(await text(page), /evidence is incomplete/);
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover')), []);
});

// W0: without management access every lifecycle action stays disabled;
// suspension is reasoned and history-preserving for managers.
await scenario('W0 lifecycle gating and reasoned suspension', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&manage=0`);
  await page.getByText('Accounting activation').first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Prepare cutover batch' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Activate Accounting' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Suspend Accounting posting' }).isDisabled(), true);
  assert.match(await text(page), /management access/);
  const ops = await page.evaluate(() => window.__calls.map((c) => c.op));
  assert.ok(ops.every((op) => ['getReadiness', 'getAccounts', 'getCutoverBatches', 'getCutoverBatch'].includes(op)), `only reads allowed, saw ${JSON.stringify(ops)}`);

  await page.goto(`${base}/?suite=accounting&script=w-applied&actor=b`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByRole('button', { name: 'Suspend Accounting posting' }).click();
  assert.match(await text(page), /at least 8 characters/);
  await page.getByLabel(/Suspension reason/).fill('Pilot pause pending owner review.');
  await page.getByRole('button', { name: 'Suspend Accounting posting' }).click();
  await page.waitForFunction(() => window.__calls.some((c) => c.op === 'suspendAccounting'));
  const [call] = await page.evaluate(() => window.__calls.filter((c) => c.op === 'suspendAccounting'));
  assert.equal(call.args, 'Pilot pause pending owner review.');
  assert.match(await text(page), /retained/);
});

// W0b: valid no-history/no-batch activation path remains.
await scenario('W0b no-batch activation path remains', async (page) => {
  const state = encodeURIComponent(JSON.stringify({ lodge_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'active', active: true, effective_from: '2026-09-01', policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'v-test', historical_cutover_batch_id: null }));
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&activationState=${state}`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Configuration version/).fill('v-test');
  await page.getByLabel(/Effective from/).fill('2026-09-01');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Activate Accounting' }).click();
  await page.waitForFunction(() => window.__calls.some((c) => c.op === 'activateAccounting'));
  const [call] = await page.evaluate(() => window.__calls.filter((c) => c.op === 'activateAccounting'));
  assert.equal(call.args.cutoverBatchId, null);
  assert.match(await text(page), /Activation state now shows/);
});

// W1: A prepares; A cannot approve; B signs in afresh, retrieves and approves.
await scenario('W1 maker/checker across reviewer sessions', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=a`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /Prepared by/);
  // Self-approval is disabled in the UI for the preparer.
  assert.equal(await page.getByRole('button', { name: 'Approve cutover batch' }).isDisabled(), true);
  assert.match(await text(page), /different authorised reviewer must approve/);
  // Fresh reviewer session: same batch retrieved without preparing again.
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /Opening balances \(1\)/);
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  // Notes alone do not authorize approval: the button stays disabled until
  // the reviewer explicitly confirms the displayed evidence.
  assert.equal(await page.getByRole('button', { name: 'Approve cutover batch' }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover')), []);
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  assert.match(await text(page), /Review recorded for batch batch-1/);
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForFunction(() => window.__calls.some((c) => c.op === 'approveCutover'));
  const [approve] = await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover'));
  assert.equal(approve.args.batchId, 'batch-1');
  assert.equal(approve.args.reviewNotes, 'Verified 1500 against August exports.');
  assert.equal(approve.args.expectedOpeningPayloadHash, 'hashabc123456');
  assert.equal(approve.actor, 'user-bbbb');
  assert.match(await text(page), /recorded separately/);
  const prepares = await page.evaluate(() => window.__calls.filter((c) => c.op === 'prepareCutover'));
  assert.equal(prepares.length, 0);
});

// W1b: read-only and wrong-tenant calls fail without disclosure.
await scenario('W1b read-only and wrong-tenant batch access fails closed', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-foreign&actor=b&manage=0`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-x');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.getByTestId('cutover-batch-detail').count(), 0);
  assert.match(await text(page), /No batch loaded/);
  const direct = await page.evaluate(() => window.api.restaurantAccountingV2.invoke('getCutoverBatch', 'batch-x'));
  assert.deepEqual(direct, { success: true, data: null });
});

// W2: missing batch, read failures, and stale async responses.
await scenario('W2 missing, failed, and stale batch reads stay safe', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&fail=read`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('no-such-batch');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.waitForTimeout(600);
  assert.equal(await page.getByTestId('cutover-batch-detail').count(), 0);
  const mutations = await page.evaluate(() => window.__calls.filter((c) => !['getReadiness', 'getAccounts', 'getCutoverBatches', 'getCutoverBatch'].includes(c.op)));
  assert.deepEqual(mutations, []);
  // Stale async: slow first read loses to the second selection.
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&slowFirst=1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.waitForFunction(() => window.__calls.some((c) => c.op === 'getCutoverBatches'));
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  const reload = page.getByRole('button', { name: 'Reload batch' });
  await reload.click();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await reload.click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /batch-1/);
});

// W3: prepared cannot apply; approved applies once; replay returns stored refs.
await scenario('W3 explicit apply with replay semantics', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&slowApply=1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.equal(await page.getByTestId('cutover-apply-section').count(), 0);
  const directPrepared = await page.evaluate(() => window.api.restaurantAccountingV2.invoke('applyCutover', 'batch-1'));
  assert.equal(directPrepared.success, false);
  // Approve first (reviewer B, prepared by A): confirm review, then approve.
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.getByTestId('cutover-apply-section').waitFor();
  // Double-click dispatches once (per-batch single flight). The earlier
  // direct probe call is excluded by counting from here.
  const beforeApply = await page.evaluate(() => window.__calls.filter((c) => c.op === 'applyCutover').length);
  await page.getByRole('button', { name: 'Apply opening balances' }).dblclick();
  await page.waitForFunction((before) => window.__calls.filter((c) => c.op === 'applyCutover').length > before, beforeApply);
  await page.getByText(/posting references recorded|stored posting references/).first().waitFor();
  const applies = await page.evaluate(() => window.__calls.filter((c) => c.op === 'applyCutover'));
  assert.equal(applies.length - beforeApply, 1);
  // Applied replay returns the stored references without reposting.
  const replay = await page.evaluate(() => window.api.restaurantAccountingV2.invoke('applyCutover', 'batch-1'));
  assert.equal(replay.data.status, 'applied');
  assert.equal(replay.data.replayed, true);
  assert.deepEqual(replay.data.opening_postings, [{ account_id: 'a1', idempotency_key: 'cutover:batch-1:opening:a1' }]);
});

// W4: approved-but-unapplied cannot activate; applied can; no-batch path works.
await scenario('W4 activation requires applied state', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-approved&actor=b`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  const state = encodeURIComponent(JSON.stringify({ lodge_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'draft', active: false, effective_from: null, policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'v-test', historical_cutover_batch_id: null }));
  await page.goto(`${base}/?suite=accounting&script=w-approved&actor=b&activationState=${state}`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Configuration version/).fill('v-test');
  await page.getByLabel(/Cutover batch id/).fill('batch-1');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Activate Accounting' }).click();
  assert.match(await text(page), /not applied/);
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'activateAccounting')), []);
  // Apply, then the same request succeeds.
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-apply-section').waitFor();
  await page.getByRole('button', { name: 'Apply opening balances' }).click();
  await page.waitForFunction(() => window.__calls.some((c) => c.op === 'applyCutover'));
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Activate Accounting' }).click();
  await page.waitForFunction(() => window.__calls.some((c) => c.op === 'activateAccounting'));
  const [call] = await page.evaluate(() => window.__calls.filter((c) => c.op === 'activateAccounting'));
  assert.equal(call.args.cutoverBatchId, 'batch-1');
});

// W5: exact-tuple readback matrix after an uncertain activation.
await scenario('W5 activation readback reconciles the full tuple', async (page) => {
  const base3 = (extra) => `${base}/?suite=accounting&script=w-applied&actor=b${extra}`;
  // Exact match confirms current state (worded as state, not as request proof).
  const exact = encodeURIComponent(JSON.stringify({ lodge_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'active', active: true, effective_from: '2026-09-01', policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'v-test', historical_cutover_batch_id: 'batch-1' }));
  await page.goto(base3(`&activate=timeout-once&activationState=${exact}`));
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Configuration version/).fill('v-test');
  await page.getByLabel(/Cutover batch id/).fill('batch-1');
  await page.getByRole('checkbox').check();
  await page.getByLabel(/Effective from/).fill('2026-09-01');
  await page.getByRole('button', { name: 'Activate Accounting' }).click();
  await page.waitForFunction(() => window.__calls.filter((c) => c.op === 'activateAccounting').length === 1);
  await page.waitForTimeout(600);
  const activates = await page.evaluate(() => window.__calls.filter((c) => c.op === 'activateAccounting'));
  assert.equal(activates.length, 1);
  assert.match(await text(page), /Activation state now shows/);
  assert.doesNotMatch(await text(page), /your request succeeded|request was accepted/);
  // Different date does not confirm and resets approval.
  const different = encodeURIComponent(JSON.stringify({ lodge_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'active', active: true, effective_from: '2026-08-01', policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'v-test', historical_cutover_batch_id: 'batch-1' }));
  await page.goto(base3(`&activate=timeout-once&activationState=${different}`));
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Configuration version/).fill('v-test');
  await page.getByLabel(/Cutover batch id/).fill('batch-1');
  await page.getByRole('checkbox').check();
  await page.getByLabel(/Effective from/).fill('2026-09-01');
  await page.getByRole('button', { name: 'Activate Accounting' }).click();
  await page.waitForFunction(() => window.__calls.filter((c) => c.op === 'activateAccounting').length === 1);
  await page.waitForTimeout(600);
  assert.match(await text(page), /different arguments/);
  assert.match(await text(page), /effective date/);
  assert.equal(await page.getByRole('checkbox').isChecked(), false);
});

// W6: explicit rejection, malformed success, failed readback, in-flight edits.
await scenario('W6 rejection and malformed responses never falsely confirm', async (page) => {
  const prior = encodeURIComponent(JSON.stringify({ lodge_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'active', active: true, effective_from: '2026-08-01', policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'v-old', historical_cutover_batch_id: null }));
  await page.goto(`${base}/?suite=accounting&script=w-applied&actor=b&activate=reject&activationState=${prior}`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Configuration version/).fill('v-test');
  await page.getByRole('checkbox').check();
  // In-flight edit during the pending request must not change reconciliation.
  const clicked = page.getByRole('button', { name: 'Activate Accounting' }).click();
  await page.getByLabel(/Configuration version/).fill('v-edited-mid-flight');
  await clicked;
  await page.waitForTimeout(600);
  assert.match(await text(page), /different arguments/);
  assert.doesNotMatch(await text(page), /Activation state now shows/);
  // Malformed success cannot produce a success notice either.
  await page.goto(`${base}/?suite=accounting&script=w-applied&actor=b&activate=malformed&activationState=${prior}`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Configuration version/).fill('v-test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Activate Accounting' }).click();
  await page.waitForTimeout(600);
  assert.doesNotMatch(await text(page), /Accounting is active from/);
  // Failed readback stays unknown without secrets in copy.
  await page.goto(`${base}/?suite=accounting&script=w-applied&actor=b&activate=timeout-once&stateFail=1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Configuration version/).fill('v-test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Activate Accounting' }).click();
  await page.waitForTimeout(800);
  assert.match(await text(page), /Outcome not confirmed|unreadable/i);
});

// W7: empty missing-requirements with other blockers never says all clear.
await scenario('W7 readiness lists every blocker', async (page) => {
  const readiness = encodeURIComponent(JSON.stringify({ active: false, ready: false, status: 'draft', policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'x', missing_requirements: [], unposted_expenses: 2, blocking_exceptions: 1 }));
  await page.goto(`${base}/?suite=accounting&script=w-approved&actor=b&readiness=${readiness}`);
  await page.getByText('Accounting activation').first().waitFor();
  assert.doesNotMatch(await text(page), /All readiness checks pass/);
  assert.match(await text(page), /2 unposted expenses/);
  assert.match(await text(page), /1 blocking reconciliation exceptions/);
});

// X2: F2 — a future-effective (scheduled) row never announces activation.
await scenario('X2 scheduled activation state never confirms', async (page) => {
  const scheduled = encodeURIComponent(JSON.stringify({ lodge_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'active', active: false, effective_from: '2026-10-01', policy_version: 'bar-accounting-financial-truth-v1', configuration_version: 'v-test', historical_cutover_batch_id: null }));
  await page.goto(`${base}/?suite=accounting&script=w-applied&actor=b&activate=timeout-once&activationState=${scheduled}`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Configuration version/).fill('v-test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Activate Accounting' }).click();
  await page.waitForTimeout(800);
  assert.doesNotMatch(await text(page), /Activation state now shows/);
  assert.match(await text(page), /scheduled, not yet active/);
});

// X3: F3 — direct URL batch loads on mount, survives reload, and follows
// back/forward navigation without preparing anything.
await scenario('X3 direct URL batch restores across reload and navigation', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&batch=batch-1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /batch-1/);
  const lookups = await page.evaluate(() => window.__calls.filter((c) => c.op === 'getCutoverBatch'));
  assert.ok(lookups.length >= 1, 'direct URL triggered an authorized detail load');
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'prepareCutover')), []);
  await page.reload();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /batch-1/);
});

// X3b: F3 — back/forward navigation resolves the proper authorized batch.
await scenario('X3b back and forward navigation resolve the right batch', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-two&actor=b&batch=batch-1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /batch-1/);
  await page.goto(`${base}/?suite=accounting&script=w-two&actor=b&batch=batch-2`);
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /batch-2/);
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('[data-testid="cutover-batch-detail"]')?.innerText.includes('batch-1'));
  const ids = await page.evaluate(() => window.__calls.filter((c) => c.op === 'getCutoverBatch').map((c) => c.args));
  assert.ok(ids.includes('batch-1'), `batch-1 re-resolved after back, saw ${JSON.stringify(ids)}`);
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('[data-testid="cutover-batch-detail"]')?.innerText.includes('batch-2'));
});

// X3c: F3 — a session change during a delayed read never shows stale data
// and reloads the URL batch under the new session.
await scenario('X3c session change invalidates in-flight reads', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=a&batch=batch-1&slowFirst=1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.evaluate(() => window.__switchActor('b'));
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /batch-1/);
  const detailReads = await page.evaluate(() => window.__calls.filter((c) => c.op === 'getCutoverBatch'));
  assert.ok(detailReads.some((c) => c.actor === 'user-bbbb'), 'URL batch reloaded under the new session');
  assert.match(await text(page), /Reviewer B/);
});

// X4: F4 — malformed, lying, and null-detail apply outcomes never announce applied.
await scenario('X4 unconfirmed apply outcomes never announce applied', async (page) => {
  for (const behavior of ['malformed', 'lying-success', 'null-detail']) {
    await page.goto(`${base}/?suite=accounting&script=w-approved&actor=b&applyBehavior=${behavior}`);
    await page.getByText('Accounting activation').first().waitFor();
    await page.getByLabel(/Or batch ID/).fill('batch-1');
    await page.getByRole('button', { name: 'Reload batch' }).click();
    await page.getByTestId('cutover-apply-section').waitFor();
    await page.getByRole('button', { name: 'Apply opening balances' }).click();
    await page.waitForTimeout(700);
    const body = await text(page);
    assert.match(body, /Outcome not confirmed/, `${behavior} stays unconfirmed`);
    assert.doesNotMatch(body, /posting references recorded/, `${behavior} announces nothing applied`);
  }
});

// X4b: F4 — timeout-after-commit confirms only via readback evidence.
await scenario('X4b timeout-after-commit confirms via readback only', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-approved&actor=b&applyBehavior=timeout-once`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-apply-section').waitFor();
  await page.getByRole('button', { name: 'Apply opening balances' }).click();
  await page.waitForTimeout(700);
  assert.match(await text(page), /resolved by reading back the same batch/);
  assert.doesNotMatch(await text(page), /Outcome not confirmed/);
});

// Y1: G1 — a source-only re-preparation (opening hash unchanged) between
// preflight and mutation is rejected atomically; the batch stays prepared.
await scenario('Y1 source-only race cannot commit unreviewed evidence', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&driftSourceOnly=1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForTimeout(700);
  // The opening hash still matched, but the reviewed source/preparer did
  // not: exactly one mutation was attempted and rejected, nothing committed.
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover').length), 1);
  assert.match(await text(page), /Source-manifest evidence does not match/);
  assert.match(await text(page), /Outcome not confirmed/);
  assert.doesNotMatch(await text(page), /approved for the reviewed evidence/);
  const row = await page.evaluate(() => window.__batchRow('batch-1'));
  assert.equal(row.status, 'prepared');
  assert.equal(row.opening_payload_hash, 'hashabc123456');
});

// Y2: G4 — approval success notices require authoritative matching
// evidence; lying, malformed, and lost responses are handled safely.
await scenario('Y2 approval notices require authoritative matching evidence', async (page) => {
  // Lying success (prepared readback): unconfirmed, batch retained.
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&approveBehavior=lying`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForTimeout(700);
  assert.match(await text(page), /Outcome not confirmed/);
  assert.doesNotMatch(await text(page), /approved for the reviewed evidence/);
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover').length), 1);
  // Malformed response with prepared readback: unconfirmed as well.
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&approveBehavior=malformed`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForTimeout(700);
  assert.match(await text(page), /Outcome not confirmed/);
  assert.doesNotMatch(await text(page), /approved for the reviewed evidence/);
  // Lost response with confirmed same evidence: success via readback.
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b&approveBehavior=timeout-once`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForTimeout(700);
  assert.match(await text(page), /approved for the reviewed evidence/);
  assert.match(await text(page), /resolved by reading back the same batch/);
  assert.doesNotMatch(await text(page), /Outcome not confirmed/);
});

// Y3: production HashRouter parity — a cold hash URL resolves the batch,
// and reload keeps it, without preparing anything.
await scenario('Y3 hash-router cold URL restores the authorized batch', async (page) => {
  await page.goto(`${base}/?suite=accounting&router=hash&script=w-prepared&actor=b#/restaurant/accounting-setup?batch=batch-1`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /batch-1/);
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'prepareCutover')), []);
  await page.reload();
  await page.getByTestId('cutover-batch-detail').waitFor();
  assert.match(await text(page), /batch-1/);
});

// Z1: H3 — rejection followed by a later differently prepared approval:
// the original review is never confirmed by the new revision's approval.
await scenario('Z1 later revision approval does not confirm the old review', async (page) => {
  await page.goto(`${base}/?suite=accounting&script=w-prepared&actor=b`);
  await page.getByText('Accounting activation').first().waitFor();
  await page.getByLabel(/Or batch ID/).fill('batch-1');
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.getByLabel(/Independent review notes/).fill('Verified 1500 against August exports.');
  await page.getByRole('button', { name: 'Confirm review of displayed evidence' }).click();
  // Concurrent re-preparation lands first: the reviewer's approval attempt
  // is blocked at preflight with no mutation.
  await page.evaluate(() => window.__driftBatch('batch-1'));
  await page.getByRole('button', { name: 'Approve cutover batch' }).click();
  await page.waitForTimeout(600);
  assert.match(await text(page), /Nothing was submitted/);
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.op === 'approveCutover')), []);
  // Another authorized reviewer approves the NEW revision out of band.
  const band = await page.evaluate(() => window.__approveRow('batch-1'));
  assert.equal(band.success, true);
  await page.getByRole('button', { name: 'Reload batch' }).click();
  await page.getByTestId('cutover-batch-detail').waitFor();
  await page.waitForTimeout(400);
  // The batch is approved, yet the original review claims nothing: no
  // success notice, and approval stays disabled without renewed review.
  assert.match(await text(page), /Approved by/);
  assert.doesNotMatch(await text(page), /approved for the reviewed evidence/);
  assert.equal(await page.getByRole('button', { name: 'Approve cutover batch' }).count(), 0);
});

await new Promise((r) => server.close(r));
await browser.close();
for (const line of results) console.log(line);
if (process.exitCode) throw new Error('browser suite failed');
console.log('browser suite passed');

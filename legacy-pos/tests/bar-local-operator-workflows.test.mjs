import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  addTenderRow,
  centsToMoney,
  evaluateTenders,
  makeTenderRow,
  moneyToCents,
  removeTenderRow,
  updateTenderRow
} from '../src/renderer/src/components/bar-local/tenderMath.js';

const root = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(join(root, '../src/renderer/src/screens/BarLocalWorkspace.jsx'), 'utf8');
const operations = readFileSync(join(root, '../src/renderer/src/components/BarLocalOperationsPanel.jsx'), 'utf8');
const tenderEditor = readFileSync(join(root, '../src/renderer/src/components/bar-local/BarLocalTenderEditor.jsx'), 'utf8');

test('legacy tender money conversion round-trips exact minor units', () => {
  assert.equal(moneyToCents('11.46'), 1146);
  assert.equal(moneyToCents('0'), 0);
  assert.equal(moneyToCents('1.005'), null);
  assert.equal(moneyToCents('-1.00'), null);
  assert.equal(centsToMoney(1146), '11.46');
  assert.equal(centsToMoney(0), '0.00');
});

test('legacy sale and tab tenders must balance exactly with split non-cash evidence', () => {
  const exact = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow()] });
  assert.equal(exact.error, '');
  assert.deepEqual(exact.tenders, [{ method: 'cash', amount: '25.00', tendered: '25.00', provider_status: 'not_applicable' }]);

  const split = evaluateTenders({
    totalCents: 2500,
    rows: [
      makeTenderRow({ method: 'cash', amount: '10.00', tendered: '20.00' }),
      makeTenderRow({ method: 'card', amount: '15.00', reference: 'AUTH-1', provider_status: 'locally_asserted' })
    ]
  });
  assert.equal(split.error, '');
  assert.equal(split.changeCents, 1000);
  assert.deepEqual(split.tenders, [
    { method: 'cash', amount: '10.00', tendered: '20.00', provider_status: 'not_applicable' },
    { method: 'card', amount: '15.00', provider_status: 'locally_asserted', reference: 'AUTH-1' }
  ]);

  const short = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'cash', amount: '10.00' })] });
  assert.match(short.error, /short by 15\.00/);
  const excess = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'card', amount: '30.00', reference: 'A', provider_status: 'locally_asserted' })] });
  assert.match(excess.error, /exceed the amount due/);
});

test('Legacy client rejects provider-confirmed tenders without a trusted integration', () => {
  const result = evaluateTenders({ totalCents: 2500, rows: [
    makeTenderRow({ method: 'card', amount: '25.00', reference: 'AUTH-1', provider_status: 'provider_confirmed' })
  ] });
  assert.match(result.error, /provider confirmation is unavailable/);
  assert.deepEqual(result.tenders, []);
});

test('Legacy local customer panel exposes authority-backed loyalty operations with no cached balance', () => {
  assert.match(operations, /loyalty\.account\.enrol/);
  assert.match(operations, /loyalty\.points\.earn/);
  assert.match(operations, /loyalty\.points\.redeem/);
  assert.match(operations, /Committed local sale UUID/);
  assert.match(operations, /local authority rechecks balance and programme rules when the operation commits/);
  assert.match(operations, /points: Number\(loyaltyDraft\.points\)/);
});

test('Legacy local tender evaluator refuses room charges with the hotel-authority boundary', () => {
  const result = evaluateTenders({ totalCents: 2500, rows: [makeTenderRow({ method: 'room_charge', amount: '25.00', reference: 'ROOM-1' })] });
  assert.match(result.error, /unavailable in local Bar.*hotel authority/);
  assert.deepEqual(result.tenders, []);
});

test('Legacy tender editor labels external status locally and offers no provider-confirmed control', () => {
  assert.match(tenderEditor, /Recorded locally only/);
  assert.match(tenderEditor, /cannot verify provider authorisation or settlement/);
  assert.doesNotMatch(tenderEditor, /value="provider_confirmed"/);
  assert.match(tenderEditor, /value="room_charge" disabled/);
  assert.match(tenderEditor, /Room charges require the hotel authority/);
});

test('legacy store credit and voucher tenders carry customer and voucher identifiers', () => {
  const credit = evaluateTenders({ totalCents: 5000, rows: [makeTenderRow({ method: 'customer_credit', amount: '50.00', customer_id: '11111111-1111-4111-8111-111111111111' })] });
  assert.equal(credit.error, '');
  assert.equal(credit.tenders[0].customer_id, '11111111-1111-4111-8111-111111111111');

  const voucher = evaluateTenders({ totalCents: 5000, rows: [makeTenderRow({ method: 'voucher', amount: '50.00', voucher_code: ' abc123 ' })] });
  assert.equal(voucher.error, '');
  assert.equal(voucher.tenders[0].voucher_code, 'ABC123');
  assert.match(evaluateTenders({ totalCents: 5000, rows: [makeTenderRow({ method: 'voucher', amount: '50.00' })] }).error, /voucher code/);
});

test('legacy tender rows are bounded and preserve a single row', () => {
  assert.equal(removeTenderRow([makeTenderRow()], 'missing').length, 1);
  const id = 'row-1';
  const updated = updateTenderRow([makeTenderRow({ id, amount: '1.00' })], id, { amount: '2.00' });
  assert.equal(updated[0].amount, '2.00');
  assert.equal(addTenderRow([]).length, 1);
  assert.equal(addTenderRow(Array.from({ length: 20 }, () => makeTenderRow())).length, 20);
});

test('legacy sale commit uses evaluated tenders instead of a hardcoded cash tender', () => {
  assert.doesNotMatch(workspace, /tenders: \[\{ method: 'cash', amount: formatBarLocalMoney\(total\)/);
  assert.doesNotMatch(workspace, /Settle tab with cash/);
  assert.match(workspace, /tenders: saleTenderEvaluation\.tenders/);
  assert.match(workspace, /BarLocalTenderEditor totalCents=\{saleTotalCents \?\? 0\}/);
  assert.match(workspace, /tenders: evaluation\.tenders/);
  assert.match(workspace, /saleTenderEvaluation\.error/);
});

test('legacy tab transfer, split, merge and settle use manager approval and registry payloads', () => {
  assert.match(workspace, /approveAndRunTabCommand\('tab\.transfer', \{/);
  assert.match(workspace, /target_staff_id: tabTransferDraft\.target_staff_id/);
  assert.match(workspace, /expected_version: selectedTab\.version/);
  assert.match(workspace, /approveAndRunTabCommand\('tab\.split', \{/);
  assert.match(workspace, /source_tab_id: selectedTab\.tab_id/);
  assert.match(workspace, /line_ids: tabSplitSelection/);
  assert.match(workspace, /approveAndRunTabCommand\('tab\.merge', \{/);
  assert.match(workspace, /source_expected_version: selectedTab\.version/);
  assert.match(workspace, /target_expected_version: target\.version/);
  assert.match(workspace, /requestApproval\(command, payload, pin, \{ operationId \}\)/);
  assert.match(workspace, /command === 'tab\.settle'\) return 'Tab settled/);
});

test('legacy stock operations are exposed through the operations panel with approvals and reasons', () => {
  assert.match(operations, /run\('stock\.receive'/);
  assert.match(operations, /approveAndRun\('stock\.adjust'/);
  assert.match(operations, /run\('stock\.stocktake'/);
  assert.match(operations, /approveAndRun\('stock\.lot\.waste'/);
  assert.match(operations, /expected_version: lot\.version/);
  assert.match(operations, /approveAndRun\('stock\.lot\.release'/);
  assert.match(operations, /run\('stock\.transfer'/);
  assert.match(operations, /SIGNED_QUANTITY_SIX/);
  assert.match(operations, /counted_quantity: stockForm\.counted_quantity\.trim\(\)/);
  assert.match(operations, /to_outlet_id: stockForm\.to_outlet_id\.trim\(\)/);
  assert.match(operations, /reason: stockForm\.reason\.trim\(\)/);
  assert.match(workspace, /<BarLocalOperationsPanel section="stock"/);
  assert.doesNotMatch(workspace, /const receiveStock = \(event\)/);
});

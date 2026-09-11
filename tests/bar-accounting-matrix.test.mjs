// Accounting authorization matrix invariants, derived from live source every
// run: IPC map x domain exports x migration definitions. Guards against
// silent grant widening, unsigned functions, anon access, and unmapped paths.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const indexJs = read('src/main/index.js');
const mapBody = indexJs.slice(
  indexJs.indexOf('const restaurantAccountingV2Operations = {'),
  indexJs.indexOf("}\n  ipcMain.handle('restaurantAccountingV2:invoke'")
);
const ops = [...mapBody.matchAll(/^\s*(\w+): \['([a-z_.]+)', db\.(\w+)\],?/gm)]
  .map((m) => ({ operation: m[1], capability: m[2], domainFn: m[3] }));

const domain = read('src/main/domains/restaurantAccountingV2.js');
const domainRpc = {};
for (const m of domain.matchAll(/export const (\w+)\s*=[\s\S]{0,400}?rpc\('([a-z0-9_]+)'/g)) domainRpc[m[1]] = m[2];
for (const m of domain.matchAll(/export const (\w+)\s*=\s*(\([^)]*\)\s*=>)?\s*([\s\S]{0,1200}?);/g)) {
  if (!domainRpc[m[1]]) {
    const rpc = m[3].match(/rpc\('([a-z0-9_]+)'/);
    if (rpc) domainRpc[m[1]] = rpc[1];
  }
}

const migFiles = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const migSql = migFiles.map((f) => read(path.join('supabase', 'migrations', f))).join('\n');

function latestDefBody(rpc) {
  const re = new RegExp(`create or replace function public\\.${esc(rpc)}\\s*\\(`, 'gi');
  let last = null;
  let m;
  while ((m = re.exec(migSql)) !== null) {
    const tail = migSql.slice(m.index);
    const end = tail.search(/\n\$\$;/);
    last = end > 0 ? tail.slice(0, end) : tail.slice(0, 20000);
  }
  return last;
}

function rpcGrantLines(rpc) {
  const re = new RegExp(`(grant|revoke)\\s+execute\\s+on\\s+function\\s+public\\.${esc(rpc)}\\s*\\([^)]*\\)\\s+([^;]+);`, 'gi');
  const rows = [];
  let m;
  while ((m = re.exec(migSql)) !== null) rows.push(`${m[1]}:${m[2].trim()}`);
  return rows;
}

test('every IPC operation maps to a real domain RPC with a migration definition', () => {
  assert.ok(ops.length >= 90, `expected the full V2 map, found ${ops.length}`);
  const missing = ops.filter((op) => !domainRpc[op.domainFn] || !latestDefBody(domainRpc[op.domainFn]));
  assert.deepEqual(missing.map((op) => op.operation), []);
});

test('cutover read/apply lifecycle stays on reviewed capabilities', () => {
  const byOp = Object.fromEntries(ops.map((op) => [op.operation, op.capability]));
  assert.equal(byOp.getCutoverBatches, 'accounting.read');
  assert.equal(byOp.getCutoverBatch, 'accounting.read');
  assert.equal(byOp.getActivationState, 'accounting.read');
  assert.equal(byOp.prepareHistoricalCutover, 'accounting.manage');
  assert.equal(byOp.approveCutover, 'accounting.manage');
  assert.equal(byOp.applyCutover, 'accounting.manage');
});

test('lifecycle capabilities stay reconciled (read/manage/close, nothing invented)', () => {
  const byOp = Object.fromEntries(ops.map((op) => [op.operation, op.capability]));
  assert.equal(byOp.getReadiness, 'accounting.read');
  assert.equal(byOp.activateAccounting, 'accounting.manage');
  assert.equal(byOp.suspendAccounting, 'accounting.manage');
  assert.equal(byOp.preparePeriodClose, 'accounting.close');
  assert.equal(byOp.approvePeriodClose, 'accounting.close');
  assert.equal(byOp.reopenPeriodClose, 'accounting.close');
  const allowed = new Set(['accounting.read', 'accounting.manage', 'accounting.export', 'accounting.ap_pay',
    'accounting.bank_approve', 'accounting.tax_file', 'accounting.payroll_view', 'accounting.payroll_manage',
    'accounting.payroll_export', 'accounting.close']);
  for (const op of ops) assert.ok(allowed.has(op.capability), `${op.operation} uses a reviewed capability, found ${op.capability}`);
});

test('every mapped RPC is SECURITY DEFINER with a hardened search_path', () => {
  const offenders = [];
  for (const op of ops) {
    const body = latestDefBody(domainRpc[op.domainFn]);
    const header = body.slice(0, 1200);
    if (!/security definer/i.test(header) || !/set\s+search_path/i.test(header)) offenders.push(op.operation);
  }
  assert.deepEqual(offenders, []);
});

test('no mapped RPC is ever granted to anon', () => {
  const offenders = [];
  for (const op of ops) {
    const lines = rpcGrantLines(domainRpc[op.domainFn]);
    if (lines.some((line) => /^grant/i.test(line) && /(^|[\s,])anon([\s,]|$)/i.test(line))) offenders.push(op.operation);
  }
  assert.deepEqual(offenders, []);
});

test('invoke handler gates every operation on its capability and rejects unknown operations', () => {
  const handlerIdx = indexJs.indexOf("ipcMain.handle('restaurantAccountingV2:invoke'");
  const handler = indexJs.slice(handlerIdx, handlerIdx + 800);
  assert.match(handler, /if \(!contract\) throw new Error\('Unsupported Restaurant Accounting operation'\)/);
  assert.match(handler, /await requireCapability\(capability\)/);
});

test('orphan domain exports stay exactly the reviewed set', () => {
  const used = new Set(ops.map((op) => op.domainFn));
  const orphans = Object.keys(domainRpc).filter((f) => !used.has(f)).sort();
  const reviewed = [
    'completeRestaurantReportRunV2', 'failRestaurantReportRunV2', 'getLodgeOperationalReportExportV2',
    'getPosFinancialReportExportV2', 'getRestaurantApExportV2', 'getRestaurantBankExportV2',
    'getRestaurantBudgetExportV2', 'getRestaurantChartExportV2', 'getRestaurantLedgerReportExportV2',
    'getRestaurantPayrollExportV2', 'getRestaurantStatementsExportV2', 'getRestaurantTaxExportV2',
    'getStarterBasicReport', 'importRestaurantBankStatementV2', 'proposeRestaurantBankMatchesV2',
    'recordAccountingExportArtifactV3', 'recordReportArtifactResult', 'reviewRestaurantBankMatchV2',
    'startRestaurantReportRunV2'
  ].sort();
  assert.deepEqual(orphans, reviewed);
});

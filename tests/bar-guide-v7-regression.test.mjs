import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { runApReloadRuntimeProof } from '../docs/bar-manual/build/remediation-candidate-2026-10-08-v7/evidence/verify_ap_reload_runtime.mjs'
import { runSharedTillDomainProof } from '../docs/bar-manual/build/remediation-candidate-2026-10-08-v7/evidence/verify_shared_till_domain.mjs'

const root = process.cwd()
const buildDir = path.join(root, 'docs/bar-manual/build')
const v6 = path.join(buildDir, 'remediation-candidate-2026-10-08-v6')
const v7 = path.join(buildDir, 'remediation-candidate-2026-10-08-v7')
const evidence = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-v7-regression-evidence-'))
process.once('exit', () => fs.rmSync(evidence, { recursive: true, force: true }))
const verifier = path.join(evidence, 'verify_v7_candidate.py')
fs.copyFileSync(path.join(v7, 'evidence/verify_v7_candidate.py'), verifier)
const manualName = 'Tsa-Bonno-Bar-Customer-Manual.pdf'
const quickName = 'Tsa-Bonno-Bar-Quick-Start.pdf'
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()

function createDisposableV7ProofRoot() {
  const copyRoot = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-v7-runtime-root-'))
  fs.mkdirSync(path.join(copyRoot, 'tmp'), { recursive: true })
  fs.cpSync(path.join(root, 'src'), path.join(copyRoot, 'src'), { recursive: true })
  const migrations = [
    '20260715026000_restaurant_shared_till_requires_attendance.sql',
    '20260816200000_bar_offline_continuity.sql',
    '20260820180000_pos_tab_assigned_waiter_ownership.sql',
    '20260914000000_fix_offline_till_proof_remap.sql'
  ]
  for (const name of migrations) {
    const from = path.join(root, 'supabase/migrations', name)
    const to = path.join(copyRoot, 'supabase/migrations', name)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
  }
  const fromEvidence = path.join(v7, 'evidence')
  const toEvidence = path.join(copyRoot, 'docs/bar-manual/build/remediation-candidate-2026-10-08-v7/evidence')
  fs.mkdirSync(toEvidence, { recursive: true })
  for (const name of ['ap-guide-fixture.jsx', 'app-context-fixture.jsx', 'build_ap_guide_bundle.mjs', 'verify_ap_reload_runtime.mjs', 'verify_shared_till_domain.mjs']) {
    fs.copyFileSync(path.join(fromEvidence, name), path.join(toEvidence, name))
  }
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(copyRoot, 'node_modules'), 'junction')
  return copyRoot
}

function buildScratchCandidate(tempRoot) {
  const clone = path.join(tempRoot, 'candidate-source')
  fs.mkdirSync(path.join(clone, 'content'), { recursive: true })
  fs.cpSync(path.join(v7, 'content'), path.join(clone, 'content'), { recursive: true })
  fs.cpSync(path.join(v7, 'screenshots'), path.join(clone, 'screenshots'), { recursive: true })
  fs.copyFileSync(path.join(v7, 'build_candidate.py'), path.join(clone, 'build_candidate.py'))
  fs.mkdirSync(path.join(clone, 'evidence'), { recursive: true })
  const script = String.raw`
import importlib.util, json, sys
from pathlib import Path
builder_path, clone_path = map(Path, sys.argv[1:3])
spec = importlib.util.spec_from_file_location('bar_v7_scratch_builder', builder_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
clone = clone_path.resolve()
module.HERE = clone
module.CONTENT = clone / 'content' / 'candidate-content.json'
data = json.loads(module.CONTENT.read_text(encoding='utf-8'))
manual, quick = module.build(data, clone / 'pdf')
print(json.dumps({'manual': str(manual), 'quick_start': str(quick), 'candidate_root': str(clone)}))
`
  const built = JSON.parse(execFileSync('python', ['-c', script, path.join(v7, 'build_candidate.py'), clone], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }))
  const retained = path.join(evidence, 'scratch-v7')
  fs.mkdirSync(path.join(retained, 'pdf'), { recursive: true })
  fs.copyFileSync(built.manual, path.join(retained, 'pdf', manualName))
  fs.copyFileSync(built.quick_start, path.join(retained, 'pdf', quickName))
  fs.writeFileSync(path.join(retained, 'source-build.json'), JSON.stringify({ command: 'isolated import of v7 candidate builder; exact v7 content and screenshots copied to a disposable source clone under tmp', build: built }, null, 2) + '\n')
  return { manual: path.join(retained, 'pdf', manualName), quick: path.join(retained, 'pdf', quickName), retained }
}

function verify(label, pair, candidate, expected, reportPath) {
  const args = [verifier, '--manual', pair.manual, '--quick', pair.quick, '--candidate-dir', candidate, '--expect', expected, '--report', reportPath]
  const result = spawnSync('python', args, { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  assert.equal(result.status, expected === 'green' ? 0 : 0, `${label}: ${result.stdout}\n${result.stderr}`)
  const report = JSON.parse(result.stdout)
  if (expected === 'red') assert.equal(report.red_evidence_validated, true, `${label}: intended v6 defects must remain red`)
  else assert.deepEqual(report.failed, [], `${label}: ${JSON.stringify(report.failed)}`)
  return report
}

test('v7 supplier statement route behavior uses the actual component with fictional read-only fixtures', async () => {
  const proofRoot = createDisposableV7ProofRoot()
  try { const report = await runApReloadRuntimeProof(proofRoot); assert.deepEqual(Object.values(report.assertions), Object.values(report.assertions).map(() => true)) } finally { fs.rmSync(proofRoot, { recursive: true, force: true }) }
})

test('v7 shared Till activation uses the actual offline domain function and reuses the open shift', async () => {
  const proofRoot = createDisposableV7ProofRoot()
  let report
  try { report = await runSharedTillDomainProof(proofRoot) } finally { fs.rmSync(proofRoot, { recursive: true, force: true }) }
  assert.equal(report.assertions.repeated_activation_returns_same_open_shift, true)
  assert.equal(report.assertions.duplicate_queue_operation_prevented, true)
  assert.equal(report.local_sql_contract.deployed, false)
})

test('v7 semantic regressions are red on exact v6 PDFs and green on scratch and final v7 PDFs', (t) => {
  const v6Manual = path.join(v6, 'pdf', manualName)
  const v6Quick = path.join(v6, 'pdf', quickName)
  const v7Manual = path.join(v7, 'pdf', manualName)
  const v7Quick = path.join(v7, 'pdf', quickName)
  assert.equal(hash(v6Manual), 'DAEC71C2133E1A2AEA9193B67592C027C0CFF4ECA5969E7D917AE9DE1CEBAA5C', 'protected exact-v6 manual hash')
  assert.equal(hash(v6Quick), '8E4FFF647D80D8159E2EA1DD714F4D238EE08FFA97CC9A04BD5FD5A3614B3C9F', 'protected exact-v6 quick-start hash')
  const tempRoot = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-v7-red-green-'))
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }))
  const v7Clone = path.join(tempRoot, 'candidate-v7')
  fs.cpSync(v7, v7Clone, { recursive: true })
  const v6Red = verify('exact v6 PDFs', { manual: v6Manual, quick: v6Quick }, v6, 'red', path.join(evidence, 'exact-v6-red-evidence.json'))
  for (const expected of [
    'shared route removes prior My shift prerequisite',
    'supplier list includes saved draft/submitted suppliers without recognizing them',
    'Reconciled is described as internal AP control comparison',
    'Refresh limitation and leave/reopen route behavior are explicit'
  ]) assert.ok(v6Red.failed.includes(expected), `exact v6 must fail intended correction: ${expected}`)
  const scratch = buildScratchCandidate(tempRoot)
  const scratchGreen = verify('scratch v7 PDFs', scratch, v7, 'green', path.join(evidence, 'scratch-v7-green-evidence.json'))
  const finalGreen = verify('final v7 PDFs', { manual: path.join(v7Clone, 'pdf', manualName), quick: path.join(v7Clone, 'pdf', quickName) }, v7Clone, 'green', path.join(evidence, 'final-v7-green-evidence.json'))
  assert.equal(scratchGreen.candidate_task_count, 123)
  assert.equal(finalGreen.candidate_task_count, 123)
  assert.equal(scratchGreen.manual.pages, finalGreen.manual.pages, 'scratch and final manual pagination match')
  assert.equal(scratchGreen.quick_start.pages, finalGreen.quick_start.pages, 'scratch and final quick-start pagination match')
  assert.notEqual(hash(v7Manual), hash(v6Manual), 'v7 manual is a new candidate pair')
  assert.notEqual(hash(v7Quick), hash(v6Quick), 'v7 quick-start is a new candidate pair')
})

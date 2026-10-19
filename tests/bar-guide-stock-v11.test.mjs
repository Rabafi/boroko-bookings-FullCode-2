import assert from 'node:assert/strict'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { buildBarGuideProgressScratch } from './helpers/build-bar-guide-progress-scratch-v11.mjs'

const root = process.cwd()
const checker = path.join(root, 'tests', 'bar-guide-stock-v11-regression.py')
const v10 = path.join(root, 'docs', 'bar-manual', 'build', 'remediation-candidate-2026-10-09-v10', 'pdf')
const draft = path.join(root, 'docs', 'audits', '2026-10-09', 'bar-v10-continuation', 'draft-v11-semantic-review-01')


function check(mode, pdfDir) {
  return spawnSync('python', [checker, '--mode', mode, '--pdf-dir', pdfDir], { cwd: root, encoding: 'utf8', timeout: 120000 })
}

test('source-derived stock guidance is red on exact v10 and green in scratch/current rendered draft PDFs', () => {
  const scratch = path.join(buildBarGuideProgressScratch(), 'pdf')
  const red = check('red', v10)
  assert.equal(red.error, undefined, red.error?.message)
  assert.equal(red.status, 0, `v10 must fail the guide contract as an expected red baseline: ${red.stdout}\n${red.stderr}`)
  assert.match(red.stdout, /EXPECTED_RED_V10/)
  assert.match(red.stdout, /Count All includes every listed item in that outlet/)

  for (const [label, directory] of [['scratch-built', scratch], ['current draft', path.join(draft, 'pdf')]]) {
    const green = check('green', directory)
    assert.equal(green.error, undefined, green.error?.message)
    assert.equal(green.status, 0, `${label} PDF contract failed: ${green.stdout}\n${green.stderr}`)
    assert.match(green.stdout, /PASS_DRAFT_RENDER/)
    assert.match(green.stdout, /"BAR-DOC-047"/)
    assert.match(green.stdout, /"BAR-DOC-050"/)
  }
})

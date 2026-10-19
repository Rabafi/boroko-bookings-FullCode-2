import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'

const root = process.cwd()
const continuation = path.join(root, 'docs', 'audits', '2026-10-12', 'bar-v11-continuation')
const v12 = path.join(continuation, 'draft-v12-receipt-recovery-01')
const v13 = path.join(continuation, 'draft-v13-reservation-scope-01')
const preFixV13 = path.join(v13, 'scratch', 'pre-fix-v13-red-baseline')
const names = ['Tsa-Bonno-Bar-Customer-Manual.pdf', 'Tsa-Bonno-Bar-Quick-Start.pdf']
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()

const pdfContract = String.raw`
import json, re, sys
from pypdf import PdfReader

manual = PdfReader(sys.argv[1])
quick = PdfReader(sys.argv[2])
def normalized(reader):
    return [re.sub(r"\s+", " ", page.extract_text() or "").strip() for page in reader.pages]
def outline_rows(reader):
    rows = []
    def visit(items):
        for item in items:
            if isinstance(item, list):
                visit(item)
            elif hasattr(item, "title"):
                rows.append((item.title, reader.get_destination_page_number(item)))
    visit(reader.outline)
    return rows
manual_pages = normalized(manual)
all_manual = " ".join(manual_pages)
task = next(((title, page) for title, page in outline_rows(manual) if title.startswith("BAR-DOC-099 - ")), None)
assert task, "BAR-DOC-099 bookmark must exist"
task_text = manual_pages[task[1]]
checks = {
    "task_bookmark_present": True,
    "bar_growth_addon_is_vouchers_not_table_booking": "Growth & Multi-Outlet adds vouchers, not table bookings" in task_text,
    "visible_policy_form_must_not_be_changed_or_saved": "If a Reservation policy form appears, do not change or save it" in task_text,
    "visible_reservations_screen_must_not_be_used_or_left_open": "If a Reservations screen appears, do not use it; leave the screen" in task_text,
    "bar_packages_exclude_table_bookings_and_reservation_waitlist": "Bar packages do not include table bookings or a reservation waitlist" in task_text,
    "policy_form_does_not_create_bookings_or_waitlist": "does not create bookings or a waitlist" in task_text,
    "provider_escalation_for_misplaced_control": "ask your POS provider why it is shown" in task_text,
    "stale_policy_not_workflow_claim_absent": "Reservation policy is not a Bar reservation workflow." not in all_manual,
    "manual_revision_13_metadata": "candidate.13-draft" in str(manual.metadata.get("/Subject", "")),
    "quick_start_revision_13_metadata": "candidate.13-draft" in str(quick.metadata.get("/Subject", "")),
    "quick_start_has_six_pages": len(quick.pages) == 6,
}
print(json.dumps({"manual_pages": len(manual.pages), "quick_start_pages": len(quick.pages), "task_page": task[1] + 1, "checks": checks, "passed": all(checks.values())}, sort_keys=True))
`

function verifyPair(label, manual, quick) {
  const stdout = execFileSync('python', ['-c', pdfContract, manual, quick], { cwd: root, encoding: 'utf8' })
  const report = JSON.parse(stdout)
  return { label, ...report }
}

test('Reservation screen exit guidance is red on exact v12 and pre-fix v13, then green in scratch and final v13 PDFs', (t) => {
  const v12Manual = path.join(v12, 'pdf', names[0])
  const v12Quick = path.join(v12, 'pdf', names[1])
  const v13Manual = path.join(v13, 'pdf', names[0])
  const v13Quick = path.join(v13, 'pdf', names[1])
  const oldV13Manual = path.join(preFixV13, names[0])
  const oldV13Quick = path.join(preFixV13, names[1])
  assert.equal(hash(v12Manual), '21102463AA7ECC75143D47033E58341F99F0BA7F84431E4C63B0CDFDD0064795', 'v12 manual is the exact preserved red baseline')
  assert.equal(hash(v12Quick), 'DD07F37F6C9D74C62F2C091C107E84544804F9542D0D6900B69B547FBAD20CDB', 'v12 Quick Start is the exact preserved baseline')

  const tempRoot = fs.mkdtempSync(path.join(root, 'tmp', 'bar-guide-v13-reservation-scope-'))
  const safeRoot = path.resolve(root, 'tmp') + path.sep
  const resolvedTemp = path.resolve(tempRoot)
  assert.ok(resolvedTemp.startsWith(safeRoot), 'temporary candidate copy stays inside workspace tmp')
  t.after(() => fs.rmSync(resolvedTemp, { recursive: true, force: true }))

  const v12Red = verifyPair('exact-v12-red', v12Manual, v12Quick)
  assert.equal(v12Red.passed, false)
  assert.equal(v12Red.checks.visible_policy_form_must_not_be_changed_or_saved, false)
  assert.equal(v12Red.checks.visible_reservations_screen_must_not_be_used_or_left_open, false)
  assert.equal(v12Red.checks.bar_packages_exclude_table_bookings_and_reservation_waitlist, false)
  assert.equal(v12Red.checks.stale_policy_not_workflow_claim_absent, false)
  assert.equal(hash(oldV13Manual), 'DAC112A1984711BC62A18FC42716E09FBCDA57D92A177F1D40D277D22369CFC1', 'pre-fix v13 is preserved as an exact red control')
  assert.equal(hash(oldV13Quick), 'C859CE6337DE2370CCB7FAD872536B5F837E10170771A0DB05FE1771D3F51ECA', 'pre-fix v13 Quick Start is preserved unchanged')
  const preFixV13Red = verifyPair('pre-fix-v13-red', oldV13Manual, oldV13Quick)
  assert.equal(preFixV13Red.passed, false)
  assert.equal(preFixV13Red.checks.visible_policy_form_must_not_be_changed_or_saved, false)
  assert.equal(preFixV13Red.checks.visible_reservations_screen_must_not_be_used_or_left_open, false)

  const scratchCandidate = path.join(tempRoot, 'candidate-v13')
  fs.mkdirSync(path.join(scratchCandidate, 'content'), { recursive: true })
  fs.cpSync(path.join(v13, 'build_candidate.py'), path.join(scratchCandidate, 'build_candidate.py'))
  fs.cpSync(path.join(v13, 'task-page-ranges.csv'), path.join(scratchCandidate, 'task-page-ranges.csv'))
  for (const sourceName of ['candidate-content.json', 'manual-source.md', 'quick-start-source.md']) {
    fs.cpSync(path.join(v13, 'content', sourceName), path.join(scratchCandidate, 'content', sourceName))
  }
  fs.cpSync(path.join(v13, 'screenshots'), path.join(scratchCandidate, 'screenshots'), { recursive: true })
  const scratchOutput = path.join(scratchCandidate, 'scratch-pdfs')
  execFileSync('python', [path.join(scratchCandidate, 'build_candidate.py'), '--output-dir', scratchOutput], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const scratchGreen = verifyPair('scratch-v13-green', path.join(scratchOutput, names[0]), path.join(scratchOutput, names[1]))
  const finalGreen = verifyPair('exact-v13-final-green', v13Manual, v13Quick)
  for (const report of [scratchGreen, finalGreen]) {
    assert.equal(report.passed, true, `${report.label}: ${JSON.stringify(report.checks)}`)
    assert.ok(Object.values(report.checks).every(Boolean))
    assert.equal(report.manual_pages, 89)
    assert.equal(report.quick_start_pages, 6)
    assert.equal(report.task_page, 77)
  }
  assert.equal(hash(v13Manual), 'F7A7049C2A12088E2870199899B80E82040738B4A0B8956347C980B22FCABEF2', 'the exact final v13 manual has the reviewed text and hash')
  assert.equal(hash(v13Quick), 'C859CE6337DE2370CCB7FAD872536B5F837E10170771A0DB05FE1771D3F51ECA', 'the exact final v13 Quick Start has the reviewed hash')
  assert.equal(hash(path.join(scratchOutput, names[0])), hash(v13Manual), 'scratch manual bytes match final v13 manual')
  assert.equal(hash(path.join(scratchOutput, names[1])), hash(v13Quick), 'scratch Quick Start bytes match final v13 Quick Start')
  t.diagnostic(JSON.stringify({ v12Red, preFixV13Red, scratchGreen, finalGreen }, null, 2))
})

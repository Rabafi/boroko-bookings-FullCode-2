# Candidate v2 QA report — Tsa Bonno Bar customer manual and quick-start

Review date: 06 October 2026  
Product: hospitality-pos 1.5.7  
Operating mode: Bar  
Candidate state: **awaiting content and visual approval; not promoted**

## Exact candidate pair

| Document | Candidate revision | Pages | SHA-256 |
|---|---|---:|---|
| Bar customer manual | bar-manual-2026.10.06-candidate.2 | 56 | BCBF6AF4589E679F4571D6F8FC6054153262E349ED861C0427195689E08D7058 |
| Bar quick-start | bar-quick-start-2026.10.06-candidate.2 | 5 | 20D8FE253D12489713DA196A060D9F0EA8BA84E1200A804DD4413F779707C435 |

The adjacent candidate manifest records the same hashes, revision/date metadata, page counts and awaiting-content-and-visual-approval state. Candidate v1 remains unchanged at manual 0CA570448B39C26795F036910D8B47E07F32FD2EED3CF728A467E41A65DC1BE5 and quick-start 51797905D69DD5D46C57E99C61D712340E03E5F583835C666D029FDFDB9423C4.

## Corrections and evidence

- **GUIDE-01:** Manual p. 56 and quick-start p. 5 now distinguish signed-peer identity quarantine from ordinary replay failure. Actual isolated signed-peer merge/store/diagnostic output feeds S27/S28. The original remains under Waiting for confirmation, the changed incoming peer copy is quarantined, a Network note persists, and this path creates no Failed operations row or quarantine Retry/Clear controls. The guide states that normal sync/replay is not automatically paused. Ordinary replay failures retain the distinct Failed operations manager Retry/Clear procedure. Manager investigation is Manage > System Health > Sync & queue > Other tills on this network; App issues > Send problem to support sends a device status summary.
- **GUIDE-02:** Manual pp. 19 and 42 describe the current cashier My sales and authorized manager/finance Sales row/detail printing routes. S18/S29 show the saved POS Receipt overlay reached through those respective paths. Behavioral tests invoke the print bridge for row and detail from both paths and observe no sale, payment, void, return/refund or inventory mutation. These component tests do not certify physical printer acceptance. If printing fails, the guides direct staff to use the same saved receipt and never collect payment again.
- **GUIDE-03:** Cover and embedded metadata use review date 06 October 2026 and candidate revision .candidate.2; quick-start is five pages. Manual contents point to current chapter starts A4/B5/C13/D21/E33/F38/G44/H51 and identity recovery p. 56. Manual p. 55 and quick-start p. 4 link to the dedicated p. 56/p. 5 procedures. Both recovery headings are bookmarked. Visual QA found and fixed a stranded “Customer display” heading at the foot of p. 19; it now starts p. 20.

Both exact final-hash PDFs were rendered with Poppler at 120 DPI into the non-overwriting `rendered/adversarial-v2/` directory: all 56 manual and 5 quick-start pages. The 14 manual contact sheets and one quick-start contact sheet in `contact-sheets/adversarial-v2/` were surveyed. Full-size checks covered manual pp. 19–20, 42 and 55–56, quick-start pp. 1, 4–5, and raw S18/S27/S28/S29. The receipt overlays show the saved receipt and print control; the mesh captures show one original pending operation and a separate persistent Network note. The verifier counts the actual render/contact-sheet files and checks A4 page dimensions, searchable non-empty pages, exact candidate hashes, visible and embedded date/revision metadata, page counts, contents references, bookmark destinations, and raw/annotated screenshot inventories (29 each). It also hashes the official manifest, v1, canonical and packaged copies against their preserved values.

## Test and build results

| Command / check | Result |
|---|---|
| npm run test:bar-guide-behavior | **PASS** 5/5 final; covers signed-peer vs ordinary replay UI states, cashier/manager row and detail receipt paths with no business mutation, live candidate-builder regeneration, and candidate PDF structure/refs/bookmarks |
| Red-before-fix regressions | **Expected FAIL** with the exact stale urgent-recovery manuscript paragraph restored temporarily; a finally block restored the corrected manuscript. A separate pre-rebuild artifact regression also caught the p. 19 orphan (3 pass, 1 fail), which was fixed before candidate v2 render. |
| npm run test:mesh-multi-room | **PASS** 6/6; final re-review run |
| npm run build:hospitality-pos | **PASS**; product build completed |
| npm run test:bar-guides | **FAIL** 11/12: canonical manual actual 91BFD9812685939F780B60C273231515A91EE13930C8E08C9E9EE9D725437308 differs from unchanged official manifest 682AB70A868C706B9AB0DDE18A1272F40791B968B91963F62D481B6FD79C3356. No approved assets were changed. |
| npm run test:bar | **FAIL** 695 pass, 2 fail, 5 skipped (702 total), final review run. The official manifest assertion reports the manual checksum mismatch first; direct hash verification also finds the canonical quick-start mismatch. The other failure is the missing configured Playwright Chromium headless-shell executable. Five skips remain skips. |
| Targeted screenshot captures | **PASS** for real S27/S28 identity evidence and current cashier/manager receipt captures. The separate full sequence capture timed out at its Sell-screen wait; it is not reported as passing. |
| PDF structure, metadata, hashes, contents, bookmarks and fresh render inventory | **PASS**, recorded in evidence/pdf-structure-check.json and candidate-v2-structure-final.log; actual inventory is 56/5 rendered pages and 15 contact sheets |

The raw logs are in docs/bar-manual/build/remediation-candidate-2026-10-06-v2/evidence/, including the exact red-before-fix manuscript regression, the red stale-builder regression and final 5/5 green behavior run, candidate-v2-structure-final.log, and builder-reproducibility-after-fix.log. The scratch builder run reproduces both documents’ full extracted page text, bookmarks and date/revision subject; its creation timestamps vary, so scratch byte hashes differ while the reviewed candidate files and manifest hashes remain unchanged. The verifier additionally confirms v1 (0CA57044…1BE5 / 51797905…23C4), canonical/package (91BFD981…7308 / 1ADB0A01…2D73), and official-manifest SHA (1BD37B47…15E8) are preserved. The verifier confirms the candidate PDF hashes and freshly rendered 56/5 page and 15 contact-sheet inventory. The unrelated duplicate lost_found.manage bundler warning appears in UI capture/build/test output; it did not fail the affected product build or focused mesh test.

## Manual impact and release boundary

Manual update is **required** for the Bar recovery and receipt workflows. The approved manifest still identifies the 09 September 2026 pair. Existing canonical output/pdf and local unpacked package files retain their pre-candidate hashes; candidate v2 has not been copied to either location and the package has not been rebuilt with the candidate. Content/visual approval and ordinary authenticated cashier offline open/save acceptance remain pending. Physical printer acceptance is not claimed. Disposable SQL proof and runtime advisory review remain separate release gates. No production deployment, publication or customer communication occurred.

## 2026-10-08 Accounting export completeness candidate v6

| Check | Result |
|---|---|
| Candidate pair hashes and page counts | PASS — manual 69 pages, 0f3616fd570116a35f0b8ecf2c1e5a7a0508e10f19cec12bae446d66149cff43; Quick Start 5 pages, 541f64c32d3abe46dca13747e3c21fc85d8e7b336307c674e29d5938c297c880 |
| Candidate task and contents placement | PASS — BAR-DOC-123 appears in contents and continues across pages 56–57; continuation has one contextual S30 screenshot and an explicit incomplete sample caption |
| Quick Start references | PASS — Part 11 manual pages 62–65; task refs 20, 24, 64, 63, 65. Procedure body unchanged. |
| Full final-hash render inventory | PASS — 69 manual pages, 5 Quick Start pages, 7 contact sheets; all candidate pages A4 |
| Visual review | PASS for candidate page 57 and Quick Start page 5; contact sheets and changed/downstream page flow reviewed |
| Candidate structural/content validator | PASS — see docs/audits/2026-10-07/accounting-remediation/evidence/bar-guide-candidate-qa.json |
| npm run test:bar-guide-behavior | PASS — 7/7 |
| npm run test:bar-guides | FAIL — 11/12; sole failure is canonical manual SHA 91BFD981…7308 vs official manifest 682AB70A…C3356. The existing Quick Start canonical/package SHA 1ADB0A01…2D73 also differs from manifest DE66637B…C350B. |
| Ordinary cashier packaged offline guide flow | PARTIAL — direct real package/preload IPC opened and saved both candidate PDFs offline and verified hashes; Help & guides menu did not render in the fixture, and the pair is not the currently approved pair. |

Candidate v6 is isolated and awaiting content/visual approval. The official manifest and canonical PDFs remain unchanged. No signed installer, publication, or customer distribution was produced.

## 2026-10-09 S00 splash refresh for per-product splash themes

| Check | Result |
|---|---|
| S00 source-asset refresh | PASS - `assets/screenshots/raw/00-first-launch-splash.png` and `00-first-launch-splash-annotated.png` recaptured from the real `buildSplashHtml('hospitality-pos')` template via `docs/bar-manual/build/capture_splash_s00.mjs`; plum `#2f222a → #211920` background with terracotta progress, packaged light logo bytes verified embedded, 444x420 preserved, badges 1/2 on the same wordmark/title elements |
| Recapture determinism | PASS - two consecutive runs byte-identical (pinned entrance end-state, pinned sweep/dots phase, compositor settle) |
| Regression tests | PASS - `tests/product-splash-themes.test.mjs` 2/2, `tests/production-guardrails.test.mjs` ok |
| Adjacent-asset isolation | PASS - only the two S00 files differ; an import side effect that rewrote every annotated file was reverted and the annotator CLI loop is now import-safe |
| Manifest / PDFs / packaging | UNCHANGED - `document-manifest.json` checksums PDFs only, so `test:bar-guides` is unaffected; no candidate PDF was rebuilt, approved, or repackaged — S00 flows into the next manual candidate build |

Scope note: S00 is the only manual asset depicting the splash. `screenshots.csv` (build 1.5.7, color-neutral caption), `evidence.md`, `coverage.csv`, and the manuscript carry no stale color claims, so no text changes were needed.


## 2026-10-12 — General ledger replay and trial-balance follow-up

Manual impact is Required. The replay notice now uses the actual raw RPC response as well as legacy envelopes. The paged journal response supplies no trial balance; the renderer now reads authoritative balances separately and refuses to describe missing totals as zero. The customer wording and exact remaining candidate/release work are in remediation-impact-2026-10-12-ledger-verification.md. Candidate v10, canonical PDFs, manifest and packaged guide pair are preserved. The attempt10 replay screenshot is diagnostic evidence only because it still shows the old zero-balance bug; final corrected captures are being verified in attempt11. No human guide acceptance, PDF promotion or offline packaged-menu acceptance is implied.

### Final 2026-10-12 ledger evidence

Attempt11 passed and its raw screenshots were visually inspected: electron-pos-to-gl-posted-journal-20261012-attempt11.png shows the retained receipt R-0001 journal with BWP 12.34 cash debit / revenue credit; electron-pos-to-gl-post-retry-20261012-attempt11.png shows the duplicate notice in the viewport and verified BWP 2,833.68 trial-balance totals. Both live in docs/audits/2026-10-08/accounting-independent-review/evidence/. Maintained rendered gate passed; focused checks passed 50/50. Final customer wording is authored in remediation-impact-2026-10-12-ledger-verification.md. Incorporation/annotation/rebuild/review and existing human approval/package/offline guide gates remain pending; no approved PDF, manifest or package was changed.

## 2026-10-12 — candidate v11 exact-pair review and maintained behavior result

BAR-DOC-082 now incorporates the verified attempt11 replay/Trial balance guidance. The final unapproved candidate pair is Manual (84 pages, SHA-256 E8EEA0C2295DEC9AF57621E6AECFEC18CF7E90DB7E8CF0CA2B4F1527EBBCA145) and Quick Start (5 pages, SHA-256 58917A6F0AFAF2518DB12F24CF6A460EE6F3BC562F1047B260F075ADE092BA0B). Exact structural and page-count evidence is in docs/bar-manual/build/remediation-candidate-2026-10-12-v11/evidence/pdf-verification-v11-final.json. Internal visual review of all pages is in evidence/visual-review-20261012.md. The first v11 cover's revision-10 label was corrected before this final pair was rebuilt.

The maintained npm run test:bar-guide-behavior result is 38 total, 34 passed, 4 failed, 0 skipped, exit 1. The failures are: a simulated journal recovery test stopped because its mock account list was empty; two scratch-document assertions saw a six-page Quick Start where that separate draft expects five; and a modifier component fixture observed NaN for one price and omitted a second option. Exact details are in evidence/test-bar-guide-behavior-20261012-result.md. This is a failed mocked/component-and-PDF gate, not real operator acceptance.

Approval remains open. V8R2-03, V10-SCOPE-01, V9-02 owner/cashier/bartender usability, four behavior failures, official manifest approval, package parity, released-binary applicability, and ordinary cashier visible offline open/save for both approved PDFs remain open. No official guide, manifest, package or installer was changed; no candidate was approved or promoted. Universal ledger source coverage remains unknown and fail-closed.


## 2026-10-12 - candidate v11 maintained behavior follow-up

Superseding the earlier candidate v11 failure status: npm run test:bar-guide-behavior passes 39 tests, 0 failures, 0 skipped, exit 0. The prior 34/38 report and red journal mock reproduction remain preserved. Repairs are limited to the test fixture/mock and candidate-only scratch PDF builder guard; no Bar runtime behavior changed in this follow-up. Exact v11 hashes and BAR-DOC-082 screenshot/coverage rows remain unchanged.

Classification: mocked renderer/component plus generated scratch-PDF regression. Not real Electron, RPC, released binary, cashier usability or offline package evidence. V8R2-03, V10-SCOPE-01, V9-02, independent approval, official manifest/package parity and ordinary cashier offline Help & guides remain open.

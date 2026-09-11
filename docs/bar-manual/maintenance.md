# Bar manual maintenance guide

The Bar manual is a release artifact, not a one-time brochure. Keep the instructions, screenshots, quick-start, evidence and packaged copies aligned with the Bar application that customers receive.

## When a change requires a documentation review

Every change that affects a customer’s Bar setup, navigation, visible controls, permissions, daily workflow, financial or stock behavior, recovery guidance, supported equipment or available feature requires a manual-impact assessment. This includes changes to:

- navigation, button names, forms, statuses, warnings or error messages;
- installation, sign-in, configuration, staff access, PINs or outlet scope;
- selling, payments, receipts, tabs, splits, transfers, corrections or cash-up;
- products, prices, packs, deliveries, counts, units, availability or variance;
- offline operation, pending work, retries, reconnect behavior or recovery screens;
- printer, scanner, drawer, display, backup, export, System Health or support flows;
- customer-facing optional packages and their setup or permissions; and
- screenshots whose appearance or demonstrated behavior is no longer representative.

A backend-only fix still needs a review when it changes what the customer should do or expect. An internal refactor with no customer-facing effect may be marked **Not required** with a short reason. Do not copy instructions from Restaurant mode, Legacy POS, LodgingOS, HotelOS or the Manager PWA without current Bar evidence.

## Change assessment

Use this short record in the pull request or change note:

```text
Bar manual impact:
- Required / Not required
- Affected tasks or sections:
- Screenshots affected:
- Quick-start affected:
- Verification performed:
- Reason if no update is required:
```

When impact is required, completion means:

1. Update the customer instructions and the quick-start when opening, selling, closing or urgent recovery is affected.
2. Verify exact visible controls, permissions, package access and outcomes against the changed Bar build.
3. Recapture affected screens with safe fictional demonstration data; preserve the raw capture.
4. Produce numbered annotated derivatives with a caption that describes the visible state.
5. Rebuild both PDFs from the shared layout source.
6. Inspect every changed page and downstream pagination, including contents, bookmarks, links, captions and screenshot placement.
7. Update `coverage.csv`, `evidence.md`, `screenshots.csv` and `qa-report.md`.
8. Verify the approved PDFs and manifest checksums before packaging.

Automated checks support this process. They cannot certify that a screenshot matches its caption or that a novice will understand a page; those require visual review.

## Version and approval tracking

Keep the app version and document revision distinct. Record both in `document-manifest.json`:

- `appVersion` and `supportedVersionRange` identify the Bar build the guides apply to.
- Each document has its own `revision`, filename and SHA-256 checksum.
- `reviewDate` records the last content review.
- The manifest is updated only after the PDFs are approved. A newly generated PDF is not automatically approved for packaging.

The current canonical artifacts are:

- `output/pdf/Tsa-Bonno-Bar-Customer-Manual.pdf`
- `output/pdf/Tsa-Bonno-Bar-Quick-Start.pdf`
- `docs/bar-manual/document-manifest.json`

## Authoring and capture workflow

1. Read `AGENTS.md`, `PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, `docs/SHIP_READY_RUNBOOK.md`, `docs/BAR_CAPABILITY_ACCEPTANCE_MATRIX.md`, `docs/BAR_TAB_RECOVERY_CONTRACT.md`, `docs/BAR_RELEASE_ACCEPTANCE.md` and the current Accounting evidence.
2. Confirm the target is `hospitality-pos` in Bar operating mode, then record build, OS, review date, packages and role.
3. Verify cashier/bartender, manager, stock and finance journeys. Record the exact route for opening a shift, Till unlock, sale, own-sale history, correction, tab and cash-up.
4. Investigate split, transfer and settlement recovery independently. Use the actual status screen and control for each operation.
5. Capture affected workflows in the isolated harness. Never use customer data, PINs, payment details or production credentials.
6. Check text inside every screenshot, not only searchable PDF text. Remove internal implementation explanations by cropping to the real task controls; do not digitally rewrite application copy.
7. Keep each screenshot beside the task it illustrates. Use a contextual crop when a full desktop view makes controls too small.
8. Build and inspect the manual and quick-start. If pagination changes, re-check all later page references and printed contents numbers.

Useful commands from the repository root:

```powershell
python -m py_compile docs/bar-manual/build/build_manual.py
python docs/bar-manual/build/build_manual.py
node docs/bar-manual/build/capture_screenshots.mjs
node docs/bar-manual/build/capture_verified_scenarios.mjs
node docs/bar-manual/build/annotate_screenshots.mjs
python docs/bar-manual/build/pdf_check.py
npm run test:bar-guides
```

Render the final PDFs into a new directory and count only the direct page images:

```powershell
$render = 'docs/bar-manual/build/rendered-final-pass'
if (Test-Path -LiteralPath $render) { Remove-Item -LiteralPath $render -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$render/manual", "$render/quick"
pdftoppm -png -r 120 output/pdf/Tsa-Bonno-Bar-Customer-Manual.pdf "$render/manual/page"
pdftoppm -png -r 120 output/pdf/Tsa-Bonno-Bar-Quick-Start.pdf "$render/quick/page"
(Get-ChildItem "$render/manual" -Filter '*.png').Count
(Get-ChildItem "$render/quick" -Filter '*.png').Count
```

Inspect every rendered page at readable size. At minimum, inspect the cover, contents, every screenshot and annotation, every procedure/result/recovery group, tables, troubleshooting and the printable cards. Check the PDF itself for searchability, page size, bookmarks, internal links, embedded fonts, metadata, security and the absence of unintended blank pages.

## Packaging and offline verification

The Bar builder packages the approved PDFs from `output/pdf/` into the external resource directory `resources/bar-guides/`, together with the manifest. `HposLayout.jsx` renders `HposNav.jsx`; its Bar-only top-right profile menu opens the Help & guides panel. The renderer requests only `bar-manual` or `bar-quick-start`; preload forwards the fixed identifier; the main process resolves the allowlisted packaged resource and performs the native open or Save dialog operation.

Before release:

1. Run `npm run test:bar-guides` and confirm both approved checksums match the manifest.
2. Build `hospitality-pos` with its product-specific builder configuration.
3. Inspect the packaged `resources/bar-guides/` directory for both PDFs and `document-manifest.json`.
4. With network access disabled, sign in as an ordinary Bar cashier and open the Bar shell top-right profile menu and choose **Help & guides**.
5. Open each guide, save each guide to a temporary destination, cancel a Save dialog once, and open the saved copies.
6. Confirm a missing resource or viewer failure produces an actionable message and leaves Save PDF available.
7. Confirm unknown guide IDs and arbitrary renderer paths are rejected by the IPC contract.
8. Record repository implementation, packaged-app testing, and release publication separately in the QA and release evidence.

An app update must replace the bundled guides with the approved pair for that app release. Customer-saved copies are never modified.

## Safety boundaries

Do not put internal signing, deployment, Accounting activation mechanics, implementation contracts, database repair, private support details or unrelated product instructions in the customer PDFs. Never advise deleting queues, clearing application data, editing the database or creating a new payment attempt after an uncertain financial operation.


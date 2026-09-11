# Bar Release Acceptance

Date: 2026-09-09
Scope: `hospitality-pos` desktop product in Bar operating mode.

This record separates repository implementation, packaged-app testing and release publication. The customer manual is written for the signed application and assumes Accounting & Workforce is available when the PDF is used. Provider-controlled Accounting activation mechanics are not part of the customer guide.

## Repository implementation

- [x] `docs/bar-manual/maintenance.md` defines manual-impact triggers, authoring, approval, packaging and offline verification.
- [x] `AGENTS.md` requires an explicit Bar manual-impact decision for relevant changes.
- [x] `.github/pull_request_template.md` captures affected tasks, screenshots, quick-start and verification.
- [x] `docs/bar-manual/document-manifest.json` records app version 1.5.7, Bar mode, document revisions, review date, filenames and SHA-256 checksums.
- [x] `apps/hospitality-pos/electron-builder.json` packages only the approved Bar PDFs and manifest as `resources/bar-guides/`.
- [x] `HposLayout` renders `HposNav`, whose Bar-only top-right profile menu exposes `Help & guides` to ordinary authenticated Bar users, including cashiers.
- [x] Preload exposes fixed `bar-manual` and `bar-quick-start` identifiers only.
- [x] Main-process handlers allowlist the identifiers, open through the local PDF viewer, and save through the native Save dialog without connectivity or operational mutations.
- [x] `npm run test:bar-guides` passes 12/12 executable manifest, checksum, packaging, path-rejection, actual Hpos navigation and IPC handler checks.

## Packaged-app testing

Status: **local directory-package resource verification completed; packaged UI offline smoke remains open**.

Completed in this repository pass:

- The approved manual is 55 pages and the quick-start is 4 pages; their final SHA-256 values are recorded in `docs/bar-manual/document-manifest.json`.
- `dist/hospitality-pos/win-unpacked/resources/bar-guides/` contains both approved PDFs and `document-manifest.json`;
- packaged PDF SHA-256 checksums match the approved manifest;
- the product build contains the preload bridge, renderer Help & guides panel and main-process handlers;
- the 12/12 contract test covers fixed identifiers, path rejection, both document IDs, successful open/save, cancellation, copy failure, open failure, missing resources and the actual Hpos navigation wiring.

Not completed in this repository pass: a cashier opening and saving both guides through the installed packaged UI while offline. The Windows Computer Use helper failed during initialization with `helper_unknown_error: apply deny-read ACLs`, and a direct Playwright launch of the `win-unpacked` executable also failed before a window opened, so no UI result is claimed. Before rollout, record:

- an ordinary authenticated cashier can find the Bar top-right profile menu → Help & guides;
- both PDFs open while network access is disabled;
- both PDFs save to a customer-selected destination while offline;
- saved files open and their revision matches the displayed manifest;
- missing resource, viewer failure and copy failure are handled safely;
- an update installs the intended guide pair and preserves customer-saved copies;
- Restaurant, LodgingOS, HotelOS and Manager PWA packages are unaffected.

## Release publication

Status: **not performed here**. A signed published installer, release-feed upload and installed-artifact smoke must be recorded separately. Do not infer publication from source tests or a local unsigned build.

## Focused commands

```powershell
npm run test:bar-guides
npm run build:hospitality-pos
npm run test:bar
```

The broader rollout gates remain in `docs/SHIP_READY_RUNBOOK.md`, including financial-truth, disposable-database, migration parity, installer signing, clean-install, upgrade, offline/restore and hardware checks. Documentation delivery does not waive those gates.




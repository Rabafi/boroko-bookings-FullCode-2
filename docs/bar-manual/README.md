# Tsa Bonno Bar manual source package

This package builds the customer manual for the `hospitality-pos` desktop product in Bar operating mode, documented version **1.5.7**, reviewed 09 September 2026. The customer-facing PDF assumes the application is signed for use and that Accounting & Workforce is available when the PDF is used; Accounting activation mechanics remain provider-controlled and are not included in the customer guide.

## Canonical artifacts

The editable customer manuscript is `manuscript.md`. Evidence and coverage are maintained in `evidence.md`, `coverage.csv` and `screenshots.csv`. Raw and annotated screenshots live under `assets/screenshots/`; artwork and prompts are under `assets/artwork/` and `image-prompts.md`.

The approved release pair is:

- `output/pdf/Tsa-Bonno-Bar-Customer-Manual.pdf`
- `output/pdf/Tsa-Bonno-Bar-Quick-Start.pdf`

`document-manifest.json` records the distinct document revisions, applicable app version, review date, packaged filenames and SHA-256 checksums. Update it only after approving the rebuilt PDFs. The Bar package takes the pair from `output/pdf/` and places them in the packaged app at `resources/bar-guides/`; it also packages the manifest beside them. Customers do not need repository access or internet access to open or save these guides.

In the running Bar application, ordinary authenticated users open the top-right profile menu in the Bar shell and choose **Help & guides**. The panel offers **Open manual**, **Open quick-start** and **Save PDF**. The entry is implemented in HposLayout.jsx / HposNav.jsx; it is not the generic Restaurant layout.

## Build

From the repository root:

```powershell
python docs/bar-manual/build/build_manual.py
```

Outputs:

- `output/pdf/Tsa-Bonno-Bar-Customer-Manual.pdf` — current approved manual.
- `output/pdf/Tsa-Bonno-Bar-Quick-Start.pdf` — current approved four-page quick-start.

The layout source uses ReportLab, the real Tsa Bonno logo, A4 templates, PDF bookmarks, internal contents links and searchable text. The build does not run on customer machines.

For the packaging and checksum gate:

```powershell
npm run test:bar-guides
```

## Re-capture the verified screens

Use the isolated component harness with fictional Main Bar data. It does not connect to production data.

```powershell
node docs/bar-manual/build/capture_screenshots.mjs
node docs/bar-manual/build/capture_verified_scenarios.mjs
node docs/bar-manual/build/annotate_screenshots.mjs
```

The harness renders the current Bar components and validates visible screen text before saving screenshots. Raw captures are kept in `assets/screenshots/raw/`; numbered derivatives are in `assets/screenshots/annotated/`. Obsolete captures are preserved in archive folders and are not used by the PDFs.

Inspect text inside screenshots as well as extracted PDF text. Never digitally rewrite application copy; use an honest task-focused crop when an interface contains internal implementation text outside the controls needed for the customer task.

## Render and inspect

```powershell
$render = 'docs/bar-manual/build/rendered-final-pass'
if (Test-Path -LiteralPath $render) { Remove-Item -LiteralPath $render -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$render/manual", "$render/quick"
pdftoppm -png -r 120 output/pdf/Tsa-Bonno-Bar-Customer-Manual.pdf "$render/manual/page"
pdftoppm -png -r 120 output/pdf/Tsa-Bonno-Bar-Quick-Start.pdf "$render/quick/page"
```

Inspect every rendered page for clipping, overlap, broken glyphs, orphan headings, screenshot legibility, page numbers, table flow and useful whitespace. Check text extraction, bookmarks, internal links, font resources, A4 dimensions and file size with `pypdf` and `pdfinfo`. ReportLab output is searchable and bookmarked but is not tagged; accessibility certification is not claimed.

## Source files

- `manuscript.md` — customer-facing editable manuscript.
- `evidence.md` — source/runtime/screenshot evidence register.
- `coverage.csv` — required-workflow coverage mapped to final pages.
- `screenshots.csv` — screenshot build, role, package, workflow, method and caption register.
- `image-prompts.md` — prompts for the editorial artwork.
- `maintenance.md` — update, approval, packaging and verification instructions.
- `document-manifest.json` — approved-document applicability and checksum manifest.
- `qa-report.md` — this revision’s actual build, link, render and visual QA results.

When the product changes, make the impact decision, update the version/date and affected customer copy, recapture affected screens, rebuild both PDFs, rerender every page, update the evidence registers and refresh the manifest only after approval. Keep other product modes out of this package.


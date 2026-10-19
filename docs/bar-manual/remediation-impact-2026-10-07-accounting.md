# Bar manual impact: Accounting export completeness remediation

Assessment date: 2026-10-08
Decision: **Required**

The Accounting export controls, default export permissions, completeness refusal, server reason codes, and recovery guidance affect Bar users with the Accounting & Workforce add-on. The customer manual therefore needs an update before release.

## Customer-facing change

Candidate task BAR-DOC-123, “Export complete AP, bank and tax reports safely,” explains how to select the intended lodge, cutoff, and packet/return; how to use the on-screen reason code to resolve the named source or approval issue through the existing workflow; and how to refresh and retry the same scope. It cautions users against creating substitute financial records, treating zero totals as proof of completeness, or interpreting dataset completeness as an external payment, bank statement, supplier confirmation, statutory filing, or professional tax review.

The existing journal recovery wording was updated to preserve the same operation through an uncertain response and require the normal independent approval path. It does not tell operators to change an operation key or bypass a blocked source.

## Files and visual evidence

- Isolated candidate source and outputs: docs/bar-manual/build/remediation-candidate-2026-10-07-accounting-v1/
- New screenshot: S30, raw and annotated files in docs/bar-manual/assets/screenshots/.
- Coverage: H5, candidate pages 56–57.
- Candidate manual: 69 pages, SHA-256 0f3616fd570116a35f0b8ecf2c1e5a7a0508e10f19cec12bae446d66149cff43.
- Candidate Quick Start: 5 pages, SHA-256 541f64c32d3abe46dca13747e3c21fc85d8e7b336307c674e29d5938c297c880.
- The Quick Start procedure was not changed; its manual page references were updated after pagination changed. Part 11 now points to pages 62–65 and task references were refreshed.
- The screenshot is a fictional Accounts Payable screen with zero recognized bills. Its caption says that the sample does not demonstrate a complete export.

## Verification and approval status

The final-hash candidate pair was rendered in full (69 manual pages and 5 Quick Start pages; 7 contact sheets). The new manual continuation page and the final Quick Start page were visually inspected. Candidate structural and content QA passed. The live packaged test used the candidate pair and confirmed that an authenticated disposable cashier could open and save both PDFs offline through the real packaged preload/IPC path, with matching hashes.

The Help & guides menu was not rendered in the cashier fixture, so visible-menu acceptance is still open. The official pair does not match the current manifest: manual manifest 682AB70A868C706B9AB0DDE18A1272F40791B968B91963F62D481B6FD79C3356 vs current canonical/package 91BFD9812685939F780B60C273231515A91EE13930C8E08C9E9EE9D725437308; Quick Start manifest DE66637B4C8D2E1A44F1F8E2943D9A88C3784838F317B0C55E2F6434AE0C350B vs current canonical/package 1ADB0A01A7831D9384130BC5C8F263DE30C110DCAD17E4133A66A3A543682D73.

The candidate is pending exact-pair content/visual approval. No candidate was copied over the canonical PDFs or official manifest. The test package was unsigned and was not published. The current package is not approved for release until the approved pair, manifest, package hashes, and ordinary cashier menu flow are verified together.
## 2026-10-08 candidate/package revalidation (supersedes the earlier 69-page candidate details)

The current candidate-only guide pair is docs/bar-manual/build/remediation-candidate-2026-10-08-v6/ and is described by its candidate-manifest.json:

- Manual: 71 pages; SHA-256 DAEC71C2133E1A2AEA9193B67592C027C0CFF4ECA5969E7D917AE9DE1CEBAA5C; 3,413,450 bytes.
- Quick Start: 5 pages; SHA-256 8E4FFF647D80D8159E2EA1DD714F4D238EE08FFA97CC9A04BD5FD5A3614B3C9F; 86,183 bytes.
- Candidate QA reports 19/19 content checks, full 71/5 page rendering and visual review with no clipping/overlap, 123/123 task rows and valid page ranges. The manifest still records seven inherited screenshots without individual capture records and four fictional v6 isolated captures; these provenance gaps remain open for approval.

The exact current pair passed offline open/save through the actual win-unpacked Electron preload/IPC path as an authenticated synthetic cashier. Both files saved byte-for-byte with the candidate hashes. Evidence: docs/audits/2026-10-07/accounting-remediation/evidence/bar-guide-latest-ipc-acceptance.json. The package’s candidate resources and manifest were temporarily staged for that test and restored byte-for-byte afterward; no installer was built or published.

A separate visible Help & guides attempt stopped before the panel opened because the isolated fixture did not render the profile selector. Evidence: bar-guide-latest-offline-acceptance.json (passed=false; cashier row, settings, Auth user and profile cleanup all passed). Therefore this is real packaged preload/IPC evidence, not visible-menu acceptance. Ordinary cashier menu open/save against the exact pair remains required.

Approval and publication stay false. No current candidate was copied to output/pdf, the approved manifest, or a persistent package. npm run test:bar-guides remains 11/12: the canonical manual is SHA-256 91BFD9812685939F780B60C273231515A91EE13930C8E08C9E9EE9D725437308 while the official manifest expects 682AB70A868C706B9AB0DDE18A1272F40791B968B91963F62D481B6FD79C3356; the canonical Quick Start is 1ADB0A01A7831D9384130BC5C8F263DE30C110DCAD17E4133A66A3A543682D73 while the manifest expects DE66637B4C8D2E1A44F1F8E2943D9A88C3784838F317B0C55E2F6434AE0C350B. The approved pair cannot be promoted until owner content/visual approval, provenance dispositions, manifest parity, and visible-menu acceptance are complete.

## 2026-10-09 — candidate v9 and settled-receipt void guard

Assessment: **Required; candidate-only; approval pending.** The Sales report now hides both void submission controls when the selected receipt has status `settled`, matching BAR-DOC-037. A separately supported return workflow is not verified; operators are told to stop and ask an authorised manager/provider. The candidate content and exact-PDF verifier were updated to state this observed behavior. No Quick Start wording or page references changed.

- Exact candidate pair: manual 82 pages, SHA-256 `44034C7C5A57AE98DC0EE7F0DE3E909A571E171AFA285DFCDC5D8753BF4BACF7`; Quick Start 5 pages, SHA-256 `5A7CF95C8B9D80AEC372B8A3A9DEF439B7C935F0E19C2178A7160AB4B6F00458`.
- Exact-PDF verification: 127 task spans/bookmarks, 287 resolving manual links, five Quick Start bookmarks, task references intact; all v9 verifier checks pass. Candidate-specific focused renderer/PDF suite: 8 passed, 0 failed, 0 skipped using fictional in-memory bridges. This is not real Electron, RPC, customer role, package, or offline-menu acceptance.
- Visual QA rendered manual pp. 28–29, p. 76, and Quick Start p. 5 at 110 dpi. The procedure continuation, recovery screenshots, page numbers, and quick-reference text have no clipping or pagination defects. Evidence renders are retained under the v9 candidate evidence folder.
- The prior v9 exact PDFs were copied to `evidence/pre-settled-guard-v9-pair/` before rebuilding; v8-review2 PDFs remain hash-identical.
- Owner/content/visual approval of the exact v9 pair is **pending**. Canonical PDFs and the official manifest remain unchanged. The official guide hash gate, approved manifest/package parity, ordinary cashier visible Help & guides offline open/save, and installer publication remain separate and unresolved. No installer was published.
## 2026-10-09 bank packet ordering manual impact

Decision for migration 20261009030000_restaurant_bank_packet_reader_ordinal_order: no additional customer procedure or screenshot is required for this backend-only correction. It preserves imported statement row order in packet reads and fails closed when a legacy order cannot be proven; it adds no visible control, permission, or recovery step. The prior Accounting export manual-impact decision remains Required. The latest candidate already instructs operators to compare the imported order with the original statement and inspect the completed packet/export.

Latest exact candidate pair: docs/bar-manual/build/remediation-candidate-2026-10-09-v10/ — manual 84 pages, SHA-256 AAC263DDCD914136E416AC0DBDDC85D417D9D028A8EA6BF203092884B8B4FED6; Quick Start 5 pages, SHA-256 7C9FEE67CE801576280640627C0C963C29EDEF727DF41250F98EDC3A45BBAAF0. Exact-pair checks are in evidence/exact-v10-green.json.

The pair remains candidate-only, unapproved and not approval-ready while V8R2-03 and V10-SCOPE-01 remain open (candidate-manifest.json and finding-closure.csv). This impact assessment is not approval. The official manifest, canonical PDFs and package were not changed. Exact approved-package parity and ordinary cashier visible offline Help & guides acceptance remain open; no installer was published.

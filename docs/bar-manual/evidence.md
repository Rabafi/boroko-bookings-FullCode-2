# Evidence register

Documented version: **1.5.7**  
Review date: **06 October 2026**  
Operating mode: **Bar**  
Operating system documented: **Windows desktop**  
Included packages assumed for customer use: **Stock & Purchasing Pro, Accounting & Workforce, Growth & Multi-outlet**  
Demonstration outlet: **Main Bar with fictional data**

## Role journey verification

| Role | Opening / Till | Sale / receipts | Corrections | Tabs | Cash-up |
|---|---|---|---|---|---|
| Cashier / bartender | **My shift** → **Start your shift** → **Start my shift**; the shared Till dialog asks **Who is taking this order?**, **Staff PIN**, **Unlock Till** | **Sell**; **My sales** shows the cashier’s own PIN-verified history; a saved row or receipt detail opens the shared **POS Receipt** overlay with **Print receipt** | **My shift** → **Request sale correction**; the operator completes **Reason and detail** and asks an approver to enter **Authorised approver PIN** and choose **Ask approver to confirm** | **Open tabs** → **Resume tab →**; split/transfer controls are in the tab detail | **My Cash-up** → **Submit cash-up for review**; the operator sees **Awaiting review** or **Returned for correction** |
| Manager / supervisor | **Manage** → **Shifts & cashiers** for staff/attendance; manager can use the same **My shift** route where assigned | **Sales** (authorized manager or finance access) → matching receipt row or **Open receipt …** detail → shared **POS Receipt** overlay → **Print receipt** | **Sales** → receipt detail; the manager uses the visible approval/void control and Manager PIN where the correction is authorised | **Open tabs** for tab ownership, split, transfer and recovery | **Cash & close** → **Refresh** → review **Expected cash**, **Counted cash**, **Variance** and **Cash-up evidence** → **Return for correction** or **Approve & close shift** |
| Stock user | Not a stock-user responsibility unless the role is also assigned a till | **Products** and **Stock**; no payment or cash-up route is assumed from stock permission alone | No correction route unless separately granted | No tab route is assumed from stock permission alone | No cash-up route is assumed from stock permission alone |
| Finance user | Not a till-opening responsibility unless separately assigned | **Sales** for tender and exception evidence; the included **Accounting & Workforce** destinations cover expenses, supplier bills, ledger, reconciliation, payroll and statements | Approval depends on the assigned correction capability and Manager PIN; package access alone is not approval | No tab route is assumed from finance permission alone | **Cash & close** when review permission is assigned; otherwise the finance user receives the approved evidence rather than taking over a cashier’s submission |

These routes are written from the current visible Bar components and role fixtures. The signed-product assumption and included Accounting & Workforce package are recorded above; activation mechanics remain outside the customer guide. A package, role permission and outlet assignment are separate checks. A visible destination is not proof that every action inside it is allowed.

## Workflow evidence

| Workflow | Build / role / package | Source evidence | Runtime verification | Screenshots | Remaining gaps |
|---|---|---|---|---|---|
| Product identity and first launch | 1.5.7 / manager / base Bar | first-launch component, product identity and Bar layout | isolated first-launch capture with fictional state | S00 | provider supplies the signed installer and final supported OS/hardware list |
| Workspace and counter sale | 1.5.7 / cashier / base Bar | HposLayout and HposTerminal | cashier fixture with populated basket, tender controls and completed receipt response | S01, S09, S17 | physical payment terminal and receipt printer need site acceptance |
| Shift opening and Till unlock | 1.5.7 / cashier / base Bar | HposMyShift and HposTillOperatorDialog | Start my shift and Unlock Till states rendered with fictional Mpho K. | S07, S08 | customer staff accounts and local PIN policy are site-specific |
| Own sales and receipt detail | 1.5.7 / cashier / base Bar | HposMySales, HposReports and POSReceipt | cashier historical My sales row and detail print routes open the shared POS Receipt overlay; historical row/detail routes tested with the print bridge and zero business mutations | S17, S18 | physical printer acceptance remains site-specific and is not claimed by component tests |
| Sale-correction request and approval boundary | 1.5.7 / cashier and manager / base Bar | HposReports correction mode, receipt detail and correction contract | cashier request screen rendered; manager controls inspected in Sales detail source | S10, S19 | live approval with customer staff accounts remains site acceptance |
| Open tabs, split and transfer | 1.5.7 / manager / base Bar | HposOpenChecks and tab mutation contracts | populated tab fixture; split and transfer dialogs captured as enlarged crops | S05, S13, S14 | live two-terminal concurrency remains site acceptance |
| Settlement uncertainty | 1.5.7 / operator / base Bar | HposTerminal pending envelope and original-attempt controls | settlement recovery route inspected separately from Open tabs recovery | none | no separate settlement-uncertainty screen was asserted in the Open tabs unresolved list |
| Split/transfer recovery | 1.5.7 / manager / base Bar | HposOpenChecks recovery panel and tab recovery contract | recovery harness shows Unresolved operations, Check status, Retry original and corrected-attempt choices | S15 | live outage/restart drill remains site acceptance |
| Products and availability | 1.5.7 / manager / base Bar | HposMenu and product data contract | populated Products fixture | S02, S20 | final catalogue and price approval are business-owned |
| Stock delivery and counts | 1.5.7 / stock manager / base Bar | HposStock and stock-state helpers | delivery, product edit and individual count forms rendered; explicit zero and Count All labels inspected | S03, S20, S21, S22, S26 | physical counting and hardware scanning need site acceptance |
| Operator cash-up | 1.5.7 / cashier / base Bar | HposMyCashup | cashier fixture shows blind Physical cash counted (P), Submit cash-up for review, Awaiting review and clock-out path | S23 | physical drawer round remains site acceptance |
| Manager cash-up review and closure | 1.5.7 / manager / base Bar | HposCashClose and cash-up proof contract | review, evidence and approval states rendered with fictional submission | S24 | live drawer evidence and approval policy remain site-specific |
| Sales reports and historical receipt printing | 1.5.7 / authorized manager or finance / base Bar | HposReports and shared POSReceipt | Sales row and Receipt & audit trail detail open the saved receipt for printing; behavior tests observe no business mutation | S10, S29 | physical printer acceptance remains site-specific |
| Attendance and handover | 1.5.7 / manager / base Bar | HposTeam and attendance kiosk | source and visible manager controls inspected | none | live attendance PIN and handover policy remain site-specific |
| Printer, drawer, scanner and customer display | 1.5.7 / manager / base Bar | settings and device components | configuration labels and troubleshooting controls inspected | S06 | physical hardware compatibility and test printing remain site acceptance |
| System Health, audit and support | 1.5.7 / manager / base Bar | support bundle scrubber, health and audit components | Manage fixture and source review | S06 | provider contact details were not invented; use the support contact supplied with the signed installation |
| Bar setup readiness | 1.5.7 / manager / base Bar | setup-readiness route and checklist component | readiness destination inspected in the current Bar source | none | customer data and final readiness state are site-specific |
| Accounting & Workforce daily use | 1.5.7 / finance / included package | Accounting, expenses, supplier bills, ledger, reconciliation, statements and payroll destinations | expense and finance permission states rendered; daily destinations inspected in source | S12 | live finance data and approval roles remain customer-specific |
| Stock & Purchasing Pro | 1.5.7 / manager / included package | supplier, purchasing, receiving, lot/expiry, recipe and variance destinations | package access tile and source contracts inspected | S06 | package-specific supplier and lot screens need live acceptance before a customer relies on them |
| Growth & Multi-outlet | 1.5.7 / manager / included package | customers, loyalty, vouchers, promotions, outlets and growth reporting destinations | Customers & loyalty fixture rendered; other package tiles inspected in source | S06, S11 | voucher, promotion and multi-outlet live setup remain site acceptance |
| Offline and reconnect | 1.5.7 / operator / base Bar | architecture, queue and recovery contracts | manual matrix checked against current controls; no production outage simulated | S15 | real device outage, restart and restore drill remain site acceptance |
| Packaged Bar guides | 1.5.7 / authenticated Bar user / base Bar | HposLayout -> HposNav Bar-only top-right profile menu -> HposBarGuidesPanel, plus barGuides manifest, fixed preload bridge, main-process allowlist and electron-builder resources | existing local package evidence refers to the pre-candidate guide pair; candidate v2 (manual 56 pages, quick-start 5 pages) has not been packaged or promoted | none | cashier UI open/save offline smoke remains pending because the Windows Computer Use helper failed during initialization and a direct Playwright launch of the packaged executable failed before a window opened |

## Evidence classes

- **Source** — implementation or acceptance-contract inspection.
- **Component** — current Bar React component rendered with fictional IPC fixtures.
- **Harness** — recovery or permission state rendered by the isolated demonstration harness.
- **Device** — physical hardware or live multi-terminal check.

This package contains source, component and harness evidence. It labels device, deployment, installer-distribution and live concurrency checks as remaining acceptance work instead of presenting them as verified customer facts.
## Candidate v2 manual impact and evidence (2026-10-06)

Candidate revision: `bar-manual-2026.10.06-candidate.2` and `bar-quick-start-2026.10.06-candidate.2`. The manual impact is **Required** because current signed-peer identity-conflict recovery and historical receipt-print paths are customer-visible Bar workflows. Candidate v2 is awaiting content and visual approval; no candidate file has been copied to the official manifest, canonical PDF directory or packaged guides.

| Workflow | Current evidence | Runtime verification | Candidate screenshots | Remaining gates |
|---|---|---|---|---|
| Signed-peer identity conflict recovery | `meshQueueMerge.js`, `meshState.js`, `HposSystemHealth.jsx`; actual isolated merge/store/diagnostic snapshot | pending=1, failed=0, quarantine=1 for identity conflict; ordinary replay failure produces pending=0, failed=1; UI regression asserts Network note and no Failed operations/Retry/Clear on identity case, and Retry/Clear only on ordinary failure | S27 and S28, generated from actual isolated merge/store/diagnostic output | content approval; separate disposable SQL proof and packaged offline cashier open/save acceptance remain open |
| Cashier historical receipt | `HposMySales.jsx`, shared `POSReceipt.jsx` | My sales row and detail both invoke `receipts.printCurrent`; test observes no sale, payment, void, return/refund or inventory mutation | S18 | physical printer acceptance remains site-specific |
| Authorized Sales historical receipt | `HposReports.jsx`, shared `POSReceipt.jsx` | manager PIN-gated Sales row and detail both invoke `receipts.printCurrent`; test observes no business mutation | S29 | physical printer acceptance remains site-specific |

The ordinary replay-failure state is documented separately: it appears under Failed operations and has manager Retry/Clear controls. Identity quarantine does not create that row, does not automatically pause normal sync/replay, and has no quarantine Retry/Clear controls. Support escalation uses System Health > Sync & queue > Other tills on this network; App issues > Send problem to support sends a device status summary.


## 2026-10-08 — Accounting export completeness candidate v6

Manual impact is **Required**. The Bar Accounting add-on now blocks incomplete AP, bank, and tax exports with server reason codes and recovery guidance, and server-side default export permissions are explicit. Candidate task BAR-DOC-123 documents the operator response through the normal approval and source workflows. It does not claim external supplier confirmation, external bank evidence, statutory filing, or professional tax review.

The isolated candidate pair is in docs/bar-manual/build/remediation-candidate-2026-10-07-accounting-v1/. The manual is 69 pages (SHA-256 0f3616fd570116a35f0b8ecf2c1e5a7a0508e10f19cec12bae446d66149cff43); the Quick Start is 5 pages (SHA-256 541f64c32d3abe46dca13747e3c21fc85d8e7b336307c674e29d5938c297c880). Quick Start task wording is unchanged; manual page references were refreshed for repagination. Candidate screenshots and H5/S30 rows are recorded in coverage.csv and screenshots.csv.

Full final-hash render inventory is 69 manual pages, 5 Quick Start pages, and 7 contact sheets. Candidate structural/content checks pass; new manual p. 57 and Quick Start p. 5 were visually inspected. QA details and exact official/canonical hash differences are in docs/audits/2026-10-07/accounting-remediation/evidence/bar-guide-candidate-qa.json.

Actual local win-unpacked Electron package, authenticated disposable cashier: both candidate guides opened and saved offline through packaged preload/IPC; the saved bytes matched the candidate package hashes. The cashier fixture did not render the Help & guides menu, so the menu click itself is not verified. This package used candidate PDFs, remained unsigned and unpublished, and does not prove the approved guide pair is packaged correctly.

Approval is pending. Official manifest, canonical PDFs, and the pre-existing package copies were not replaced. Existing official checksum mismatch remains a release gate.
## 2026-10-12 — General ledger replay and trial-balance follow-up

Manual impact is Required. The replay notice now uses the actual raw RPC response as well as legacy envelopes. The paged journal response supplies no trial balance; the renderer now reads authoritative balances separately and refuses to describe missing totals as zero. The customer wording and exact remaining candidate/release work are in remediation-impact-2026-10-12-ledger-verification.md. Candidate v10, canonical PDFs, manifest and packaged guide pair are preserved. The attempt10 replay screenshot is diagnostic evidence only because it still shows the old zero-balance bug; final corrected captures are being verified in attempt11. No human guide acceptance, PDF promotion or offline packaged-menu acceptance is implied.

### Final 2026-10-12 ledger evidence

Attempt11 passed and its raw screenshots were visually inspected: electron-pos-to-gl-posted-journal-20261012-attempt11.png shows the retained receipt R-0001 journal with BWP 12.34 cash debit / revenue credit; electron-pos-to-gl-post-retry-20261012-attempt11.png shows the duplicate notice in the viewport and verified BWP 2,833.68 trial-balance totals. Both live in docs/audits/2026-10-08/accounting-independent-review/evidence/. Maintained rendered gate passed; focused checks passed 50/50. Final customer wording is authored in remediation-impact-2026-10-12-ledger-verification.md. Incorporation/annotation/rebuild/review and existing human approval/package/offline guide gates remain pending; no approved PDF, manifest or package was changed.

## 2026-10-12 — candidate v11 exact-pair review and maintained behavior result

BAR-DOC-082 now incorporates the verified attempt11 replay/Trial balance guidance. The final unapproved candidate pair is Manual (84 pages, SHA-256 E8EEA0C2295DEC9AF57621E6AECFEC18CF7E90DB7E8CF0CA2B4F1527EBBCA145) and Quick Start (5 pages, SHA-256 58917A6F0AFAF2518DB12F24CF6A460EE6F3BC562F1047B260F075ADE092BA0B). Exact structural and page-count evidence is in docs/bar-manual/build/remediation-candidate-2026-10-12-v11/evidence/pdf-verification-v11-final.json. Internal visual review of all pages is in evidence/visual-review-20261012.md. The first v11 cover's revision-10 label was corrected before this final pair was rebuilt.

The maintained npm run test:bar-guide-behavior result is 38 total, 34 passed, 4 failed, 0 skipped, exit 1. The failures are: a simulated journal recovery test stopped because its mock account list was empty; two scratch-document assertions saw a six-page Quick Start where that separate draft expects five; and a modifier component fixture observed NaN for one price and omitted a second option. Exact details are in evidence/test-bar-guide-behavior-20261012-result.md. This is a failed mocked/component-and-PDF gate, not real operator acceptance.

Approval remains open. V8R2-03, V10-SCOPE-01, V9-02 owner/cashier/bartender usability, four behavior failures, official manifest approval, package parity, released-binary applicability, and ordinary cashier visible offline open/save for both approved PDFs remain open. No official guide, manifest, package or installer was changed; no candidate was approved or promoted. Universal ledger source coverage remains unknown and fail-closed.


## 2026-10-12 - candidate v11 behavior repair superseding result

The earlier candidate v11 maintained behavior result of 34/38 is preserved in its failure report. After separate reproductions, the maintained npm run test:bar-guide-behavior gate passes 39/39 with zero failures/skips and exit 0. Logs and root-cause analysis are under docs/bar-manual/build/remediation-candidate-2026-10-12-v11/evidence/isolated-regressions-20261012/. The exact v11 PDFs, BAR-DOC-082 coverage row, attempt 7/11 screenshot rows, canonical PDFs and official manifest remain unchanged. This is not real Electron/operator or cashier package acceptance. Owner scope/usability, formal approval, package parity and offline Help & guides remain open.

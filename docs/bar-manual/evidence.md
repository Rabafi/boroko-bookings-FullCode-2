# Evidence register

Documented version: **1.5.7**  
Review date: **09 September 2026**  
Operating mode: **Bar**  
Operating system documented: **Windows desktop**  
Included packages assumed for customer use: **Stock & Purchasing Pro, Accounting & Workforce, Growth & Multi-outlet**  
Demonstration outlet: **Main Bar with fictional data**

## Role journey verification

| Role | Opening / Till | Sale / receipts | Corrections | Tabs | Cash-up |
|---|---|---|---|---|---|
| Cashier / bartender | **My shift** → **Start your shift** → **Start my shift**; the shared Till dialog asks **Who is taking this order?**, **Staff PIN**, **Unlock Till** | **Sell**; **Sell** → **My sales** for the operator’s own receipts; the immediate completed-sale **POS Receipt** overlay exposes **Print receipt** | **My shift** → **Request sale correction**; the operator completes **Reason and detail** and asks an approver to enter **Authorised approver PIN** and choose **Ask approver to confirm** | **Open tabs** → **Resume tab →**; split/transfer controls are in the tab detail | **My Cash-up** → **Submit cash-up for review**; the operator sees **Awaiting review** or **Returned for correction** |
| Manager / supervisor | **Manage** → **Shifts & cashiers** for staff/attendance; manager can use the same **My shift** route where assigned | **Sales** → **Open receipt …** for receipt detail, tender and audit evidence | **Sales** → receipt detail; the manager uses the visible approval/void control and Manager PIN where the correction is authorised | **Open tabs** for tab ownership, split, transfer and recovery | **Cash & close** → **Refresh** → review **Expected cash**, **Counted cash**, **Variance** and **Cash-up evidence** → **Return for correction** or **Approve & close shift** |
| Stock user | Not a stock-user responsibility unless the role is also assigned a till | **Products** and **Stock**; no payment or cash-up route is assumed from stock permission alone | No correction route unless separately granted | No tab route is assumed from stock permission alone | No cash-up route is assumed from stock permission alone |
| Finance user | Not a till-opening responsibility unless separately assigned | **Sales** for tender and exception evidence; the included **Accounting & Workforce** destinations cover expenses, supplier bills, ledger, reconciliation, payroll and statements | Approval depends on the assigned correction capability and Manager PIN; package access alone is not approval | No tab route is assumed from finance permission alone | **Cash & close** when review permission is assigned; otherwise the finance user receives the approved evidence rather than taking over a cashier’s submission |

These routes are written from the current visible Bar components and role fixtures. The signed-product assumption and included Accounting & Workforce package are recorded above; activation mechanics remain outside the customer guide. A package, role permission and outlet assignment are separate checks. A visible destination is not proof that every action inside it is allowed.

## Workflow evidence

| Workflow | Build / role / package | Source evidence | Runtime verification | Screenshots | Remaining gaps |
|---|---|---|---|---|---|
| Product identity and first launch | 1.5.7 / manager / base Bar | first-launch component, product identity and Bar layout | isolated first-launch capture with fictional state | S00 | provider supplies the signed installer and final supported OS/hardware list |
| Workspace and counter sale | 1.5.7 / cashier / base Bar | HposLayout and HposTerminal | cashier fixture with populated basket, tender controls and completed receipt response | S01, S09, S17 | physical payment terminal and receipt printer need site acceptance |
| Shift opening and Till unlock | 1.5.7 / cashier / base Bar | HposMyShift and HposTillOperatorDialog | Start my shift and Unlock Till states rendered with fictional Mpho K. | S07, S08 | customer staff accounts and local PIN policy are site-specific |
| Own sales and receipt detail | 1.5.7 / cashier / base Bar | HposMySales, HposReports and POSReceipt | cashier My sales detail and completed receipt states rendered | S17, S18 | historical My sales detail has no separate reprint button in this build; live printer/reprint acceptance remains site-specific |
| Sale-correction request and approval boundary | 1.5.7 / cashier and manager / base Bar | HposReports correction mode, receipt detail and correction contract | cashier request screen rendered; manager controls inspected in Sales detail source | S10, S19 | live approval with customer staff accounts remains site acceptance |
| Open tabs, split and transfer | 1.5.7 / manager / base Bar | HposOpenChecks and tab mutation contracts | populated tab fixture; split and transfer dialogs captured as enlarged crops | S05, S13, S14 | live two-terminal concurrency remains site acceptance |
| Settlement uncertainty | 1.5.7 / operator / base Bar | HposTerminal pending envelope and original-attempt controls | settlement recovery route inspected separately from Open tabs recovery | none | no separate settlement-uncertainty screen was asserted in the Open tabs unresolved list |
| Split/transfer recovery | 1.5.7 / manager / base Bar | HposOpenChecks recovery panel and tab recovery contract | recovery harness shows Unresolved operations, Check status, Retry original and corrected-attempt choices | S15 | live outage/restart drill remains site acceptance |
| Products and availability | 1.5.7 / manager / base Bar | HposMenu and product data contract | populated Products fixture | S02, S20 | final catalogue and price approval are business-owned |
| Stock delivery and counts | 1.5.7 / stock manager / base Bar | HposStock and stock-state helpers | delivery, product edit and individual count forms rendered; explicit zero and Count All labels inspected | S03, S20, S21, S22, S26 | physical counting and hardware scanning need site acceptance |
| Operator cash-up | 1.5.7 / cashier / base Bar | HposMyCashup | cashier fixture shows blind Physical cash counted (P), Submit cash-up for review, Awaiting review and clock-out path | S23 | physical drawer round remains site acceptance |
| Manager cash-up review and closure | 1.5.7 / manager / base Bar | HposCashClose and cash-up proof contract | review, evidence and approval states rendered with fictional submission | S24 | live drawer evidence and approval policy remain site-specific |
| Sales reports and receipt history | 1.5.7 / manager / base Bar | HposReports | Sales filters and receipt detail rendered | S10 | live export destination remains site acceptance |
| Attendance and handover | 1.5.7 / manager / base Bar | HposTeam and attendance kiosk | source and visible manager controls inspected | none | live attendance PIN and handover policy remain site-specific |
| Printer, drawer, scanner and customer display | 1.5.7 / manager / base Bar | settings and device components | configuration labels and troubleshooting controls inspected | S06 | physical hardware compatibility and test printing remain site acceptance |
| System Health, audit and support | 1.5.7 / manager / base Bar | support bundle scrubber, health and audit components | Manage fixture and source review | S06 | provider contact details were not invented; use the support contact supplied with the signed installation |
| Bar setup readiness | 1.5.7 / manager / base Bar | setup-readiness route and checklist component | readiness destination inspected in the current Bar source | none | customer data and final readiness state are site-specific |
| Accounting & Workforce daily use | 1.5.7 / finance / included package | Accounting, expenses, supplier bills, ledger, reconciliation, statements and payroll destinations | expense and finance permission states rendered; daily destinations inspected in source | S12 | live finance data and approval roles remain customer-specific |
| Stock & Purchasing Pro | 1.5.7 / manager / included package | supplier, purchasing, receiving, lot/expiry, recipe and variance destinations | package access tile and source contracts inspected | S06 | package-specific supplier and lot screens need live acceptance before a customer relies on them |
| Growth & Multi-outlet | 1.5.7 / manager / included package | customers, loyalty, vouchers, promotions, outlets and growth reporting destinations | Customers & loyalty fixture rendered; other package tiles inspected in source | S06, S11 | voucher, promotion and multi-outlet live setup remain site acceptance |
| Offline and reconnect | 1.5.7 / operator / base Bar | architecture, queue and recovery contracts | manual matrix checked against current controls; no production outage simulated | S15 | real device outage, restart and restore drill remain site acceptance |
| Packaged Bar guides | 1.5.7 / authenticated Bar user / base Bar | HposLayout -> HposNav Bar-only top-right profile menu -> HposBarGuidesPanel, plus barGuides manifest, fixed preload bridge, main-process allowlist and electron-builder resources | local directory package contains both approved PDFs and manifest; packaged hashes match source (manual 55 pages, quick-start 4 pages) | none | cashier UI open/save offline smoke remains pending because the Windows Computer Use helper failed during initialization and a direct Playwright launch of the packaged executable failed before a window opened |

## Evidence classes

- **Source** — implementation or acceptance-contract inspection.
- **Component** — current Bar React component rendered with fictional IPC fixtures.
- **Harness** — recovery or permission state rendered by the isolated demonstration harness.
- **Device** — physical hardware or live multi-terminal check.

This package contains source, component and harness evidence. It labels device, deployment, installer-distribution and live concurrency checks as remaining acceptance work instead of presenting them as verified customer facts.



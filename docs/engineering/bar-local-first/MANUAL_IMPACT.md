# Bar manual impact record

## 1 November 2026 — local setup storage guidance

**Impact: customer instructions need a future update; source PDFs remain pending by user direction.** Setup now explains the main computer versus another till, outlet naming, optional contact fields, local owner PIN, and the disk-space check. A low-space warning recommends more operating headroom; a hard installation-space shortfall blocks setup and gives an exact amount and recovery action. Recovery copies and drills show a calculated space requirement. These changes affect setup and recovery instructions, so the approved manual and quick-start must be revised after the UI is stable, then screenshots, manifest/checksums and packaged offline-guide access must be verified. Per the user’s instruction, PDF and screenshot work remains pending and is non-blocking for the software-only review; it remains required before customer commissioning.

## 29 October 2026 — offline update controls

The Modern Bar administration screen now imports a selected offline package folder into the local service inbox, lists packages, stages a selected package through the service verifier, and offers guarded apply with an operator name, reason, and exact confirmation. Imported files are copied without following links. Successful apply triggers the installed service restart; the panel surfaces a pending restart or failed-apply recovery report, and blocks further update actions until the running version is confirmed. Update apply remains unavailable when the service has disabled it. The approved customer manual, quick-start, screenshots, manifest and packaged offline guide checks remain pending at the user's direction and are non-blocking for a software release. This software change does not qualify customer updates or local-Bar commissioning.

## Current release scope — 28 October 2026

At the user's direction, pending customer PDFs, quick-start, screenshots, approved-document-manifest and packaged-guide work are non-blocking for a software release. Earlier dated entries that say an operator-guide edit is “required before release” record the manual impact and work to do when documentation resumes; this current instruction supersedes their release-block wording. This does not approve existing guides, qualify customer use, or change the local-authority commissioning NO-GO.

## 28 October 2026 — live lot balances and expiry allocation

Modern and Legacy local Bar stock panels now show current remaining lot balances alongside, and separately from, immutable receipt history. Sales use eligible in-date lots FEFO; transfers preserve lot lineage; identified returns link to their original lot, while unidentifiable returns are held in quarantine. Existing stock migrated into the ledger has unknown source-lot/expiry provenance. Customer instructions and screenshots should explain those distinctions and that some returns require inspection before they can be sold again. As directed, the manual, quick-start, PDFs, screenshots, approved manifest and packaged-guide checks remain pending and non-blocking for a software release; no guide approval or customer qualification is implied.

## 28 October 2026 — error visibility

Page-level failures in the local Bar workspace, operations panel and administration panel now use the shared error notice, which scrolls/focuses the message and presents friendly error text. Errors directly below the form that produced them remain beside the active controls so an operator can correct the form without losing PIN or field context. No command, permission, financial, stock or recovery behavior changed. Manual impact is limited to how visible error messages are presented; no PDF or quick-start edit is required for this adjustment. Customer PDFs, quick-start, screenshots and packaged offline guide verification remain pending at the user's direction.

Date: 2026-10-20.

## 26 October 2026 — Modern saved-operation SQLite migration

Manual update required before release. Commissioned Modern local Bar tills now migrate their saved-operation JSONL history into a per-device SQLite journal automatically during startup; owner setup and pairing validate storage before consuming setup/pairing actions. Original operation IDs, uncertain states and OS-protected credentials are retained. Legacy keeps its separate journal. This is saved-operation storage, not the shared financial PostgreSQL authority or a replacement for physical replicas and independent backups.

Recovery guidance must preserve the original Windows profile, protected authority profile, retained JSONL archive, SQLite journal, initialization marker and available recovery sidecars. Never replace a missing SQLite journal with an older JSONL archive or create a replacement sale for an uncertain operation. The protected profile pins the migrated backend even if both the SQLite file and marker disappear. Corruption, unavailable OS secure storage or failed durable writes block trading and require recovery; validated setup failures can be retried after the cause is repaired. Do not advise copying an active database file as a valid backup or deleting journals to re-pair around unresolved work. Test tooling uses only synthetic fixtures and does not qualify customer installation or hardware. Customer PDF, quick-start, screenshot, approved-manifest and packaged-guide changes remain explicitly deferred release gates.

## 26 October 2026 — full-sale tip cancellation follow-up

Local migration 0060 refunds an unallocated tip when cancelling the remaining sale; item returns retain the original tip. The refund uses the original tender allocation ledger and posts the signed tip reversal to Accounting. If any tip has been allocated to staff, cancellation is refused atomically with actionable reconciliation guidance; no refund, restock or approval consumption is allowed. A complete allocation/payout reconciliation workflow is still pending, so guidance must not imply that reversing a payout alone removes its allocation. Historical submitted cash-ups and old receipts are not rewritten. This customer-facing correction needs guide updates before release. Customer PDFs, quick-start, screenshots, approved-document manifest and packaged-guide checks remain deferred by the user's direction. Isolated financial checks passed; full-plan acceptance and release are not implied.

## 26 October 2026 — finance, staff, tips and paired drawer handovers

Manual update required before release. Modern and Legacy local workspaces now share structured local accounting forms for ledger accounts, supplier invoices/approval/payments/reversals, bank records/import/reconciliation, tax drafts, payroll preparation/finalisation and budgets. Select existing records to edit their current versions; incomplete record reads pause saving. Invoice estimates use exact decimal arithmetic, while the service recalculates authoritative totals. Payroll and tax drafts do not make bank payments or statutory submissions. No hosted financial ingestion is enabled.

Settings adds staff suspension/reactivation; Customers adds approved loyalty corrections; Workforce adds tip allocation, payout and reversal controls. A different active operator with the required capability approves each protected action. PIN-only approval requires a distinct PIN among eligible identities; ambiguous PINs are refused. Access is checked again when the proof is consumed. Temporary PINs remain masked. Neither a visible button nor a PIN accepted by the UI grants authority.

Drawer adds a two-operator handover: the receiving operator opens their own shift, selects another active open drawer in the outlet, counts the cash, confirms receipt and obtains the outgoing operator's own PIN approval. The database records both entries atomically, refuses insufficient outgoing cash and preserves a single stable operation on retry. No manager substitution for the outgoing operator is accepted. An uncertain result must be resolved before moving the cash again. The local cash-total correction includes original posted tenders alongside signed returns/voids; historical submitted cash-ups are not silently rewritten and require reviewed reconciliation if affected.

Customer PDFs, quick-start, screenshots, approved-document manifest and packaged offline-guide evidence remain deferred by explicit user direction. They block release, as do installed-PC tests, which the user explicitly left pending on 26 October. This assessment does not approve commissioning or automatic failover.

Migration 0059 adds a server-side safe stop for new returns/voids against closed drawers and for cash refunds exceeding the original drawer's available cash. Explain replenishment/reconciliation and the distinction between a terminal refusal and an uncertain already-sent operation. Previously committed corrections can still be looked up/replayed without another refund. This guard is not a complete closed-period reconciliation workflow. Migration 0058's decimal result serialization is internal transport enforcement; it does not change charged amounts. Isolated checks now cover actual-client fractional refunds, export integrity, closed-drawer refusal, shortage rollback and committed receipt replay. The complete plan and release gates remain open.

## 26 October 2026 — takeover recovery and complete stock lists

Manual update required before release: complete stock/lot lists, local login/readiness guidance and protected credential-journal recovery affect operator expectations. Preserve the original journal and Windows profile when secure storage cannot unlock a pending operation; do not start the transaction again with a new identity. Lot receipts remain history rather than current balances. The journal newline repair and test-runner disk preflight are internal safeguards requiring no additional operator controls. Customer PDFs, quick-start, screenshots, approved manifest and packaged-guide verification remain deferred by user direction. See the dated takeover checkpoint for actual tests and open release gates.

A partial journal write now pauses further writes on that till until storage is restored and the app restarts and recovers its original journal. If a reply checkpoint fails after sending, the UI must retain the original uncertain operation. Customer recovery instructions need this safe-stop path before release. The approval-hash guard and explicit test discovery are internal enforcement changes with no new customer controls.

## 23 October 2026 — local lot and expiry visibility

Modern and Legacy local stock panels now show outlet-scoped lot/expiry receipt history and flag expired or near-expiry receipts. The display states that received quantities are receipt history only because sales are not allocated to lots and current remaining quantity by lot is not tracked. Customer guidance must explain checking expiry dates and that this view does not replace a physical lot count. Per the user's direction, customer PDF, quick-start, screenshot, approved-manifest, packaged-guide and offline open/save edits/checks remain pending. The guarded DB test and target-device workflow are not yet verified.

## 23 October 2026 — physical drawer count

Modern and Legacy Drawer panels now let a cashier record a physical count with a note. The local service locks the open shift, captures expected cash and variance, and commits the count as an audited, idempotent drawer record without changing expected cash. The UI displays the committed count-time variance; a retry uses the same durable operation ID. Customer guidance must explain performing and recording the physical count, the variance, and the distinction between a count observation and a cash movement. Paired handover/receiver confirmation is not implemented. Per the user's direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending. No rendered or live DB click-through has been performed for this change.

## 23 October 2026 — backup schedule

The Windows server installer now registers an hourly encrypted full-backup trigger alongside the existing daily and startup triggers. This affects backup/recovery expectations. When PDF work resumes, update the Bar recovery instructions to explain that hourly local snapshots do not provide point-in-time recovery or protect against host loss, and show operators how to confirm the backup task and independent copy. Per the user's direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending. Windows Task Scheduler execution has not been qualified on a target host.

## Decision

**Manual update required before any customer release of local Bar authority.** The intended host/join/device status, connection state, opening readiness, backup/recovery and offline behavior change customer-visible setup and daily operating guidance. Those workflows are not integrated yet, so no candidate manual or quick-start update can accurately describe the finished product in this checkpoint.

## Current evidence/status

- Approved manual and quick-start: not changed; approval/checksum state remains governed by `docs/bar-manual/document-manifest.json`.
- Local-authority screenshots and rendered candidate PDFs: not produced.
- Packaged approved guides and ordinary authenticated cashier offline open/save verification: not run.
- Bar guide scripts/build/package checks: not run in this checkpoint.
- Customer-facing implementation: the committed Modern local authority now opens a cashier path for local staff sign-in, shift opening, catalogue-based cash sale and same-operation retry. Service lifecycle, pairing, setup, other Bar operations and Legacy local cashier use are not available as customer workflows; do not imply full local-first operation is ready.

## Required before release

Follow `docs/bar-manual/maintenance.md`; update the manuscript, quick-start, relevant screenshots, `coverage.csv`, `evidence.md`, `screenshots.csv`, and `qa-report.md` after UI stabilizes. Produce candidate PDFs and visually inspect them; do not mark them approved or alter the approved manifest without the established review. Verify `npm run test:bar-guides`, `npm run build:hospitality-pos`, and packaged-app offline open/save/cancel/failure behavior with an ordinary authenticated Bar user. Keep internal signing/deployment and Accounting activation details out of customer PDFs.
# Manual impact decision — 20 October 2026 continuation

Modern and Legacy Bar startup now show an authority-specific recovery boundary when a local profile is committed or its status cannot be verified. A committed local profile now opens a basic local staff login and cash counter workspace in both clients, with readiness status, shift opening, cash sale and uncertain-operation retry. These change visible startup and daily workflow guidance. The approved Bar manual and quick-start need a customer-language explanation of the message, safe next action and supported workflow, with matching screenshots, before this implementation is released. The packaged offline copies and ordinary authenticated open/save behavior must then be re-verified using `docs/bar-manual/maintenance.md` and `document-manifest.json`.

This code checkpoint is not release-ready and no customer manual PDF, quick-start, screenshot, package manifest, or offline guide was changed or claimed complete. Internal signing, deployment, Accounting activation mechanics, and unrelated product guidance remain out of scope for customer PDFs.

Per the user's 20 October 2026 direction, defer all PDF, screenshot, and manifest edits for now. Pending release work: explain the new authority boundary and recovery action in customer language; recapture the changed screen from a verified app; rebuild and visually QA both guides; reconcile/approve the manual checksum; verify packaged offline copies and ordinary-user open/save behavior.

The Modern and Legacy cashier workflows added in this continuation also affect login, opening a shift, selecting available catalogue items, reading the local readiness indicator, committing a cash sale and resolving an uncertain result. Add accurate customer instructions and screenshots after the workflow is complete. All PDF, quick-start, screenshot, manifest and packaged-guide edits/checks remain pending by the user's direction.

The capability-gated local product form adds SKU, name, category, price, tax multiplier and stock-tracking controls. Customer guidance must explain that 0.14 represents a 14% tax multiplier and that a tracked product needs stock received separately before it is sellable. PDF, quick-start, screenshot, manifest and package verification for this UI remain pending by the user's direction.

Modern and Legacy Bar local workspaces now include a capability-gated Drawer panel for recording paid-in, paid-out and float adjustments against the open shift. The panel also shows the service-calculated expected cash and timestamped movement reasons for the current shift. The UI requires a positive amount and reason; the local service enforces the actor capability, shift/outlet scope, open-shift state, idempotency and audit. Customer instructions should explain when to use each movement, how to read the history and how to resolve an uncertain result. Handover and physical drawer counts remain unconnected. PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending by the user's direction.

Modern and Legacy Bar local workspaces now include a capability-gated Menu panel to list active products and mark each available or sold out for the current outlet. The service validates outlet scope and expected availability version, records audit/changefeed evidence, and rejects sales for unavailable products. Customer guidance must distinguish outlet availability from stock quantity and explain that the shared menu page remains on its existing cloud path until its callers are routed. PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending by the user's direction.

Both local workspaces now support a manager-approved return covering selected quantities from multiple sale lines in one atomic command, and a separate full-sale void. The correction form explains that approval is bound to the exact action and operation; service-side capability, cumulative return limits, maker-checker, expiry and one-time-use checks remain authoritative. Customer guidance must explain selecting lines, restock/waste disposition, manager approval, safe retry after an uncertain result, and the current correction limits. PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending by the user's direction.

Both local cash-up panels now list submitted cash-ups from the scoped local reporting window and allow a distinct manager to approve or reject a selected submission with a required reason and PIN. A reviewed cash-up can also be reopened into a new counted revision with cash/card recounts, notes, an optional supporting reference, a reason and a distinct manager PIN. The client reloads the selected shift summary; the service checks outlet scope, current state, maker-checker, period lock and one-time approval atomically, while preserving the reviewed snapshot. Customer guidance must explain the list period, review/reopen reasons and recovery from approval expiry or an uncertain result. PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending by the user's direction.

# Manual impact decision — 21 October 2026 setup, Settings and receipts

Modern startup now offers Create this Bar / Join an existing Bar. Both local workspaces expose Settings for creating a cashier account and generating a short-lived, single-use pairing code; the receipt view can display and print a service-confirmed receipt. These are customer-facing setup, staff access, device pairing and receipt workflows. Update customer instructions and screenshots before commissioning so operators know where the server must already be running, how to protect pairing codes and how receipt printing relates to an already committed sale.

Per the user's direction, PDF, quick-start, screenshot, approved document-manifest and packaged-guide edits/checks are pending. This note is the manual-impact assessment only; it does not claim the documentation or service installation workflow is complete.

Readiness indicators now show verified ready, blocked, stale, unknown or unavailable states with the last successful check time. A stale or unavailable check pauses readiness-gated actions. The admin panels now state when the backup destination cannot be read and explain that the package list may be incomplete. Customer guidance and screenshots need to cover these messages and recovery steps. Per the user's direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending; no customer PDF was edited.

External tender entry now shows a fixed local-only status. Operators cannot select “provider confirmed”; the client refuses that status without a trusted integration, and the service also rejects it. Room charge is disabled in the local tender selector and refused with a hotel-authority explanation. Customer instructions must explain that a terminal/bank reference is a local record and does not prove provider authorisation or settlement, and that room charges require an available hotel authority. PDF, quick-start, screenshot, approved-manifest and packaged-guide work remains pending by user direction.

Legacy receipt printing now re-reads the sale through the local service in main, then passes the verified receipt fields to the existing ESC/POS adapter; Windows printer mode uses the browser print view. Modern currently provides the verified receipt print view. Neither physical printer setup nor target hardware was exercised. Document the receipt recovery/print workflow and supported printer path after PDF work resumes.

Owner Settings now allow selecting cashier, manager, stock or finance roles; non-owner staff can create only cashier identities. The local service still enforces the role delegation ceiling and prevents owner creation through this form. Customer documentation must explain the role choices and temporary-PIN handoff. PDF and screenshot work remains pending.

# Manual impact decision — 21 October 2026 discount and staff guardrails

Local sale and tab settlement now enforce a configurable discount approval threshold (default 10%) and hard maximum (default 25%) for manual and promotion discounts, with a `pos.discount` maker-checker approval required above the threshold. Staff status changes now prevent non-owner escalation against owner/manager/stock/finance identities, self-suspension and removal of the last active owner. These are service-layer controls; no Modern or Legacy discount or staff-management UI consumes them yet, so no current customer workflow changed in this checkpoint.

Before commissioning Bar local authority, the approved manual and quick-start must explain the discount approval prompt, the configured limit, the owner-only staff controls, refusal messages and the safe recovery path, with matching screenshots. All PDF, quick-start, screenshot, manifest and packaged-guide verification remains pending by the user's direction.

# Manual impact decision — 21 October 2026 modifier selections

Modern and Legacy local cash-sale and tab-addition panels now show the configured modifier groups and options for each product. Cashiers can select within the configured limits; the displayed estimate includes selected price deltas, while the local service remains authoritative for selection validation, price and tax. This changes the visible sale and tab-entry steps and the receipt's item detail. Update customer guidance and screenshots when PDF work resumes. Per the user's direction, all PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending.

# Manual impact decision — 21 October 2026 versioned product editing

Both Modern and Legacy local menu workflows now allow users with `pos.menu_manage` to edit an active or inactive product. The form exposes SKU, name, category, price, tax multiplier, stock tracking and (while editing) active status. The menu carries the product version from a complete local query and the service rejects a stale edit with a refresh-and-review message. Customer guidance must explain that product edits affect the shared local catalogue and that a conflict requires refreshing and reviewing the current values before retrying. PDF, quick-start, screenshot, manifest and packaged-guide edits/checks remain pending by the user's direction.

# Manual impact decision — 21 October 2026 local audit search

Modern and Legacy local workspaces now expose an Audit panel to staff with `settings.manage`. It searches the current outlet's local audit history by action or recorded JSON values, shows timestamp/operation/actor, expands before/after details on demand, and pages older results. Customer guidance must explain the capability gate, outlet scope, default 30-day window, safe search and pagination. PDF, quick-start, screenshot, manifest and packaged-guide edits/checks remain pending by the user's direction.

# Manual impact decision — 21 October 2026 local stock and cash-up reports

Modern and Legacy local Reports panels now show the local service's outlet-scoped stock valuation, low-stock items, movement count and cash-up summary. Incomplete valuation (including missing cost data), incomplete cash-up records and externally unverified card settlement are labeled so reported values are not mistaken for complete or provider-confirmed totals. Customer guidance must explain report scope, the displayed periods and those completeness labels. PDF, quick-start, screenshot, manifest and packaged-guide edits/checks remain pending by the user's direction.

# Manual impact decision — 21 October 2026 local support report entry

Modern and Legacy local workspaces now expose a `settings.manage`-gated Support panel. It stores a redacted issue report, readiness blockers, severity/category and a checksum on the local Bar authority; external support delivery remains disabled and the UI asks the operator not to include secrets or guest/payment identity details. Customer guidance must make the local-only storage and disabled-delivery boundary clear. PDF, quick-start, screenshot, manifest and packaged-guide edits/checks remain pending by the user's direction.

# Manual impact decision — 21 October 2026 modifier configuration visibility

Modern and Legacy menu managers can inspect business-owned modifier groups/options and product assignments, create groups/options, edit existing definitions with version checks, deactivate definitions for new sales, and replace a product's group assignments in the local Menu panel. Customer guidance must explain how the service enforces required selection limits and option price changes, and that assignments affect all tills using the shared catalogue. PDF, quick-start, screenshot, manifest and packaged-guide edits/checks remain pending by the user's direction.


## Manual impact — local recipe editor and money values (21 October 2026)

The local menu manager now lets `pos.menu_manage` users select a sellable product, replace its ingredient recipe using business-owned catalogue items, record ingredient quantity/unit cost, or remove a recipe. The local service enforces business scope, distinct/active ingredients, positive quantities, non-duplicate components and optimistic recipe version checks; recipe changes affect stock deduction and stock valuation. Catalogue prices now arrive at the renderer as exact two-decimal strings. Customer guidance must explain these steps and the impact of recipe edits on stock/cost reports. Per the user's direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending.

## Manual impact — local promotion setup (21 October 2026)

The local menu manager lets `pos.menu_manage` users create, edit and deactivate business-wide promotion codes with percent/fixed amount, minimum subtotal, product/category/all-products scope and date limits. Modern and Legacy local cashiers now accept a code for a cash sale, show an estimate, require a different manager's PIN when the configured discount threshold is exceeded, and clearly block a promotion beyond the configured maximum. The service rechecks business date, code, eligible scope, minimum, policy, stock and exact-payload approval atomically. Customer guidance must explain the manager setup, authorised discount role, manager approval, maximum refusal and recovery after an uncertain sale. Per the user's direction, PDFs, quick-start, screenshots, manifest and packaged-guide edits/checks remain pending.

## Manual impact — local discount policy settings (21 October 2026)

Modern and Legacy local Settings now expose the service-backed discount approval threshold and maximum for users with `settings.manage`. Changing either value affects sale and tab-settlement guardrails across the business. Guidance must explain the difference between the approval threshold and the absolute maximum, that approval cannot override the maximum, and that the service applies the saved policy to every till. PDF, quick-start, screenshot, manifest and packaged-guide edits/checks remain pending by the user's direction.

## Manual impact — LAN menu catch-up and stale carts (21 October 2026)

Modern and Legacy local cashiers now refresh the shared catalogue in the background. Legacy also follows the authenticated event cursor and retention-gap response; both clients require a complete consistent snapshot after a catalogue change and clear unsent cart/promotion state when the shared menu changes. A failed refresh displays a recovery message and blocks sale commit until the menu can be verified. Customer instructions should explain the refresh notice, why an unsent cart is cleared, and how to reconnect and refresh before continuing. Per user direction, all PDF, quick-start, screenshot, approved-manifest, packaging and offline-guide edits/checks remain pending; no PDF was edited.

## Manual impact — administration and recovery panels (22 October 2026)

Modern and Legacy now expose local administration and operations including authority/database status, backup listing/creation/authenticated verification, replication status/durability and confirmed manual switchover, update status, and purchasing/customer/control/workforce/accounting workflows. Guidance must explain which capabilities are required, that backup verification authenticates encrypted bytes but does not prove a restore, that the configured Windows task and helper scripts do not prove an installed schedule or independent backup, and that manual switchover requires a reviewed recovery procedure and client repointing. Automatic failover, replacement-host restore and customer commissioning are not supported claims. Per the user's direction, PDF, quick-start, screenshot, approved-manifest, package and offline-guide edits/checks are pending; no customer PDF was edited.

## Manual impact — local customer loyalty actions (22 October 2026)

The Modern and Legacy local customer panels allow `customers.manage` staff to enroll customers, earn points against a committed local sale, and redeem points with a required reference. Modern selects from recent sales; Legacy requires the committed sale UUID. The authority checks sale/customer linkage, active program and available points; redemption is a loyalty event and is not a sale discount or tender. The Legacy panel does not approve from a cached points balance, and the Modern panel also leaves balance eligibility to the service. Customer guidance needs to explain these controls and the response to duplicate enrollment, duplicate sale earning, inactive program or insufficient points. Program setup and a current loyalty-balance read remain open. At the user's direction, customer PDFs, quick-start, screenshots, approved-manifest, package and offline-guide edits/checks are pending; no PDF was edited.

## Manual impact — export bundle retrieval contract (22 October 2026)

The Modern and Legacy Administration panels expose local export backlog, exported and acknowledged watermarks, recent batch integrity, and download actions. Staff with `export.manage` (and access to Administration) can create a bounded export checkpoint and request a download of a complete unsigned JSON bundle. The panels pause new exports if status is unavailable or a batch fails integrity reconciliation. They state that files remain local, cloud transport is disabled, and downloading does not mean upload or acknowledgement. They ask operators to confirm the file appears in Downloads because the browser does not report whether it was ultimately saved. If a request/retrieval is interrupted, the confirmed batch ID remains available for another read of the same bundle; operators should not create a replacement export to recover the download. The service scopes and verifies status by business/outlet/authority epoch and checks batch manifest and event hashes.

**Customer PDF, quick-start, screenshot, approved-manifest and packaged-guide work is pending at the user's direction.** No customer guide or PDF was edited in this continuation. Before customer release, document the capability requirement, create/save/retry steps, unsigned/local-only status and the distinction between export and acknowledgement; then complete the approved guide and offline package workflow.

# Manual impact decision — 22 October 2026 loyalty programme query

Migration 0043 adds an authenticated, outlet-scoped local service query for programme configuration, but no Modern or Legacy operator screen consumes it yet. The customer-facing workflow has not changed in this source checkpoint. When programme management UI is added, explain earn/redeem settings and outlet versus business scope in the approved guide. Per the user's direction, customer PDF edits remain pending; no PDF was changed.

# Manual impact decision — 22 October 2026 loyalty programme administration UI

Modern and Legacy owner administration now display the current business-wide and outlet-specific loyalty programmes and can create or version-update the selected programme through the local service. The UI states when business-wide changes affect all outlets, refuses a new business-wide programme when one is already configured, validates the minimum redemption as a whole number, and pauses saves when the authoritative list is unavailable. The service remains responsible for capability, scope, uniqueness, version conflict and audit enforcement.

This changes customer-facing Bar administration guidance. When PDF work resumes, update the approved manual and quick-start with programme scope, earn/redeem settings, active status, concurrent-edit recovery and the fact that changing rates does not change existing point balances. Per the user's direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide changes/checks remain pending; no PDF was edited.

The owner editor also supports creating an outlet-specific programme. It takes the outlet ID exclusively from the scoped service query and disables creation where an outlet programme already exists. This makes customer-facing instructions need to distinguish the business-wide and outlet-only setup choices. PDF/quick-start/screenshots/manifest/package checks remain pending by user direction.

The loyalty workflow now includes a timestamped `loyalty.account.get` read in both customer operations panels. It is sourced from the local ledger for a customer in the authenticated business/outlet. The balance is informational: the server rechecks programme status and points during earn/redeem commits. Customer guidance must explain the checked time and that a displayed balance does not guarantee redemption. Per the user's direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide work remains pending.

The latest loyalty balance read addition is customer-facing and expands required manual guidance: selecting a customer, the timestamped local points balance, refresh behavior after loyalty actions, and the rule that redemption eligibility is rechecked when committed. No guide or PDF was edited; all PDF, quick-start, screenshot, approved-manifest and packaged-guide work remains pending at the user's direction.

Export UI displays a batch event count that can exceed the configured group limit when one atomic command emits multiple outbox events. Bundle creation and recovery actions are unchanged. Customer guidance should describe the file's returned event count rather than infer a fixed event-row cap. PDF/quick-start/screenshot/approved-manifest/package edits remain pending by user direction.

# Manual impact decision — 27 October 2026

Takeover follow-up: first-run choice now precedes cloud startup. Choosing restaurant/cloud restarts the app, and the choice is remembered. Local setup retains committed-authority priority. The setup/restart guidance needs customer documentation before release; PDF, screenshot, quick-start and manifest edits remain deferred by the user.

Cashier/correction follow-up: Modern and Legacy show plain local-server status and recovery guidance, hide technical blocker codes from ordinary cashiers, and preserve manager diagnostics. Connection failures retain same-operation recovery instructions; uncertain outcomes and financial refusals remain visible. Correction detail now exposes authoritative remaining quantities, supports a subsequent partial line return, and labels cancellation as remaining sale/tip rather than refunding the entire original sale again. A manager-approved cancellation can refund an unallocated tip after all items were returned, while allocated tips, closed original drawers and shortages remain blocked. Customer guides must cover these changes before release; their artifacts remain deferred. Database and final application verification are recorded separately in the takeover checkpoint; a visible control is not readiness evidence.

Modern setup recovery guidance and Modern/Legacy return and void readiness messaging affect operator workflows. Customer guidance must explain retrying local authority status or signing in after committed setup, and retaining the correction while checking local readiness. The customer PDF, quick-start, screenshots, approved manifest and packaged offline guide checks remain deferred at the user's direction and are release gates. The export canonicalization guard has no separate customer-facing impact.

The temporary export epoch equality check was removed; earlier event epochs must remain exportable after recovery. This investigation has no separate manual impact.

# Manual impact decision - 27 October 2026 cloud synchronisation panel

Manual update required before release (administrator/owner-facing only). Modern and Legacy Bar administration now include a **Cloud synchronisation** section. It reads the local service's durable upload state (transport mode, configured/enabled, signing secret present or missing, schedule, pending events, prepared/failed batches, acknowledged watermark, last check/success/failure, next due, cash-up final-sync result and the latest batch) and offers "Sync now", an enable checkbox, receiver URL, signing key identifier, 15-minute or daily schedule, daily time and a batch limit.

Customer-facing guidance rules for the approved manual and quick-start:

- Local PostgreSQL remains the financial authority. Enabling or failing an upload never changes local sales, cash-up, stock or reports, and the cashier does not wait for an upload.
- Only the designated Bar server uploads; a till configured as a client reports that it is not the uploader. A client cannot acknowledge a batch from the till UI.
- "Accepted" means a receiver reported `ingested`. A received or validated receipt, a saved export file, a green status or an enabled toggle is not acceptance. Pending work stays on the Bar server and retries.
- A missing signing secret, a missing receiver or signing key identifier, an unreachable receiver, a timeout, a refused signature or a manifest mismatch must be shown as a retained failure with a safe retry path; never advise deleting batches, editing local totals or re-running a sale to clear the queue.
- The receiver URL may contain credentials; the UI shows a redacted value and accepts a new value only when the operator re-enters it. Guides must not instruct operators to paste a stored credential back into the form.
- Hosted cloud activation is **not available** in this release. Customer documents must not promise Supabase ingestion, hosted reports containing un-ingested trade, or a hosted activation procedure. The `local_test` transport is limited to a loopback test receiver on the same machine and is a development/verification tool, not a customer feature; the `approved` transport is reserved and refuses to run until separately authorised.
- 15-minute and daily scheduling, "Sync now" and the automatic final pass after a committed cash-up are workflow guidance that must match the shipped controls.

The export panel copy was also corrected: saving a JSON bundle is a local file, not an upload and not an acknowledgement.

No cashier screen, sale, payment, stock or cash-up workflow changed in this step. Customer PDF, quick-start, screenshots, approved-document manifest and packaged offline-guide evidence remain deferred at the user's direction and remain release gates. No hosted Supabase migration, receiver deployment, ingestion, cutover, release, commit or push was performed.
Operator-visible detail added after review: when the Bar server configuration has the transport disabled, the panel states that upload is disabled and the "Sync now" button is unavailable, so a cashier or manager cannot start a pass that would only record a disabled result. Enabling local configuration alone does not authorise a hosted upload; the transport remains an installation-level decision.

# Manual impact decision — 27 October 2026 catalogue snapshot and sync progress labels

Modern and Legacy catalogue refresh now validates that product and availability pages share the same authority scope and snapshot watermark, and that each product identity, SKU and version matches one-to-one. If the snapshots drift or pagination is invalid, the client retries within a bound, clears stale menu/edit state and blocks affected edits or sales until a complete snapshot is loaded. Admin export and cloud panels label counters as highest observed sequence values and explain that gaps or pending work can remain; a high acknowledged sequence does not prove a contiguous checkpoint or complete ingestion. Customer guidance should describe those pause-and-refresh and progress meanings. The approved manual, quick-start, screenshots, manifest and packaged offline-guide checks remain pending at the user's direction; no PDF was edited.

# Manual impact decision - 27 October 2026 witness failover

**Superseded status correction (27 October 2026):** The witness workflow described below is experimental and is not available in the production local Bar service. Startup refuses `failover.mode = witness` before opening the database or listening because transaction fencing and promotion safety are unproven. Do not publish the witness setup, promotion or recovery instructions below as an available customer workflow. The approved customer manual and quick-start remain deferred by the user; when that work resumes, document only the supported fail-closed behavior until a separately qualified coordinator is approved. The engineering record and exact failure analysis are in `FAILOVER_2026-10-27.md`.

The following is a historical draft of guidance for the unqualified witness prototype. It must not be treated as a description of a supported customer workflow or copied into customer documents. Any future manual update must be based on a qualified supported topology; until then, describe only that trading remains stopped when safe authority cannot be established.

Customer-facing guidance rules for the approved manual and quick-start:

- **A stopped screen is not a lost sale.** If trading stops because failover verification could not complete, the till must keep the original operation and the cashier must not start a replacement sale. The plain message says trading is stopped and to call the owner; technical blocker codes and lease details stay in administration.
- **Never unfence a host.** There is no unfence or resume control, and restarting the old primary will not make it writable again. Guides must not tell an operator to clear a fence, edit a flag, delete files or re-run setup to get the old server trading.
- **Repointing tills is manual in this release.** Automatic client repointing and service discovery are not implemented. After a promotion, every till must be pointed at the stable authority address (or the address the owner configured as the authority URL) before it can trade. Guides must not promise that tills move by themselves.
- **Re-enrol the old primary as a standby** from the promoted primary using the existing standby enrolment procedure before expecting synchronous durability again. Until then the promoted host runs with single-host durability, and it may keep the gate closed if synchronous settings remain configured with no caught-up standby; that is a safe stop, not a fault to work around.
- **The witness is an availability dependency.** If the witness machine or its state file is unavailable, trading stops and no standby promotes. Do not run two witnesses for one cluster, do not regenerate a lost witness state to force a new epoch, and do not restore an older witness state copy.
- **Only the designated server promotes.** A till never becomes an authority and a visible failover status or fence button is not permission. The administration action is loopback-only, capability-checked and audited.
- **Honest status words.** "Verified" automatic failover means live witness lease evidence exists for this host at its authority epoch. Reaching the witness, a configured URL or a green build does not. Administration must show the gate state, lease holder and remaining time, reported durability and the last decision rather than implying availability.
- **No hosted or customer-ready claim.** This release does not authorise a customer Bar cutover, an installer for a witness machine, automatic client repointing, or hosted activation.

Source includes a refused-trading message (503 `AUTHORITY_FENCED`) and readiness blocker for the disabled witness path; these do not make witness failover available. Customer PDF, quick-start, screenshots, approved-document manifest and packaged offline-guide evidence remain deferred at the user's direction and remain release gates. Physical multi-PC failover, power-loss and Windows 7 qualification are also deferred. No hosted Supabase change, deployment, cutover, release, commit or push was performed.

## Manual impact — synthetic transition export verifier (28 October 2026)

The new version-1 verifier is a developer-only command for synthetic source fixtures. It writes a dry-run receipt and never contacts a database or imports customer records. It adds no Bar operator screen, permission, daily workflow or customer-visible behavior; no customer manual update is required for this internal tool. Its output is explicitly not an import or cutover approval. Customer PDFs, quick-start, screenshots, approved-document manifest and packaged-guide work remain pending at the user's direction.

## Manual impact — resumable local setup and Legacy pairing (28 October 2026)

Modern Bar setup now displays a **Resume saved setup/pairing** action when a protected provisioning request is pending after an interrupted or ambiguous response. Legacy POS displays **Resume saved pairing** under the same condition, and suppresses a new-code form until the saved attempt is resumed or repaired. Status exposes only the pending kind and recoverability; staged credentials and pairing details remain in protected main-process storage. The owner may need to close and reopen the app after the local authority is committed. Customer guidance must explain resuming the original attempt, not requesting a new code or clearing local files, and escalating an unreadable recovery record. This changes first-run/recovery guidance. Customer PDF, quick-start, screenshots, approved-manifest, packaging and offline-guide edits/checks remain pending by the user's direction; no customer guide was edited.

## Manual impact — synthetic transition export validation hardening (28 October 2026)

No customer-facing workflow changed. The developer-only offline validator now refuses duplicate outlet declarations, missing business/outlet inventory, invalid or timezone-free export timestamps, and unresolved pending operations without a resolution receipt. **No customer manual update is required for this internal-only validation change.** Customer data must not be submitted to this prototype, and customer PDF work remains deferred.

## Manual impact — completed provisioning-stage reconciliation (28 October 2026)

No customer-visible workflow or control changed. At startup, Modern and Legacy now clear a leftover encrypted staging record only when its staged device credential exactly matches the credential in the committed authority profile; a different staged credential is preserved. This is internal recovery cleanup with no new operator instruction. **No customer manual update is required for this internal-only change.** PDF work remains deferred.

## Manual impact — declared transition relationship validation (28 October 2026)

No customer-facing workflow changed. The internal synthetic transition validator now checks explicitly declared source relationships for a unique target, nullability, and declared business/outlet scope, and includes linked/null row counts in its receipt. **No customer manual update is required for this developer-only validation change.** Customer PDFs, quick-start, screenshots, approved-document manifest and packaged offline-guide checks remain pending at the user's direction.

## Manual impact — required transition row scope (28 October 2026)

No Bar operator flow changed. The developer-only synthetic transition validator now rejects records without a business owner and requires outlet IDs for its listed outlet-owned operational collections. **No customer manual update is required for this internal validator change.** Customer documentation and approved PDF work remain pending at the user's direction.

## Manual impact — Modern local network diagnostics (28 October 2026)

The Local authority administration panel now displays the configured endpoint scope, service liveness/readiness, database reachability, TLS expiry, write-authority basis and automatic-failover evidence. This is read-only and adds no network, promotion, or membership control. It changes troubleshooting information shown to a Bar administrator; customer guidance may need a corresponding explanation of these states before release. Per the user's direction, PDF/quick-start/screenshots and approved-manifest changes remain pending. The UI states that reachability is not trading readiness and does not authorize failover.

## Manual impact — declared financial reconciliation in transition validator (28 October 2026)

No operator workflow or customer-facing behavior changed. The developer-only synthetic export validator can now compare a parent money field against exact child-row sums for explicitly declared business/outlet-scoped relationships. No customer manual update is required for this internal validation feature. It is not an importer or cutover approval; customer PDFs and related artifacts remain pending by user direction.

## Manual impact — selected-lot waste and quarantine inspection/release (28 October 2026)

Modern and Legacy local Bar stock panels now require the manager to select the precise lot for approved waste and provide inspection evidence before releasing quarantined returned stock. These actions change visible stock workflows and need customer instructions/screenshots before customer rollout. Per the user's direction, the manual, quick-start, PDFs, screenshots, approved manifest and packaged-guide checks remain pending and non-blocking for a software release. No customer guide was edited or approved; local Bar commissioning remains NO-GO.

## Manual impact — local journal posting and accounting period close (29 October 2026)

The local finance workspace now exposes a date-filtered trial balance, journal posting and maker-checker period close forms. The journal form helps catch unbalanced entries before submission; the local service remains authoritative. Period close requires a separate approver and prevents new postings to a closed period. These visible accounting workflows require customer instructions before rollout. Per the user's direction, all customer guide artifacts remain pending and non-blocking for a software release; no PDF was edited or approved.

## Manual impact — fresh Bar local setup default and support report history (29 October 2026)

A fresh `hospitality-pos` install now opens the local owner setup path by default; choosing an existing cloud workspace remains an explicit action. This does not create an authority or permit trading until local setup and service readiness succeed. The local support panel also shows paged, outlet-scoped report history to settings managers. Both changes affect visible setup/support workflows. Customer guidance remains pending and non-blocking for a software release by the user's direction; no PDF or approved guide was changed.

## Manual impact — closed-shift tip payout correction (29 October 2026)

When reversing a paid tip payout after its drawer has closed, the manager must select a different open manager drawer. The service records a compensating paid-in movement in that drawer, links it to the original payout, and leaves the original cash-up unchanged. This is a visible recovery instruction and requires customer guide updates before rollout. Per the user's direction, PDFs, quick-start, screenshots, approved manifest and packaged-guide checks remain pending and non-blocking for a software release; no guide was edited.

## Manual impact — Legacy local network diagnostics (28 October 2026)

Legacy local-authority administration now shows the endpoint scope, service reachability/liveness/readiness, database reachability, TLS state, write-authority basis and automatic-failover evidence. This is read-only and adds no network, promotion or membership control. Bar administrator troubleshooting guidance should explain these states before release. Customer PDF, quick-start, screenshots, approved-manifest and packaged-guide work remain pending by the user's direction; no customer guide was edited.

## Manual impact — secondary encrypted backup copy status (29 October 2026)

When `BAR_LOCAL_BACKUP_COPY_TO` is configured, manual backups now write the same encrypted package and manifest to that destination, and Modern/Legacy administration shows whether the destination is readable. The Windows installer refuses a copy path that overlaps the live PostgreSQL directory, primary backup directory, service data or installation. This is a visible owner recovery control; customer instructions should explain reconnecting the destination and that a second folder on the same physical drive is not an independent backup. The change still does not add WAL/PITR or prove off-host recovery. Per the user's direction, PDFs, quick-start, screenshots, approved manifest and packaged-guide checks remain pending and non-blocking for a software release; no guide was edited or approved.

## User-directed pending classification — 28 October 2026

The user directed that the remaining PDF, quick-start, screenshot, approved-document-manifest and packaged offline-guide work be skipped for now and recorded as pending, not blocking a software release. The same pending/non-blocking classification applies to the broader guide-dependent Bar suite, installed-PC/hardware checks, source-specific Lounge transition and remaining extended qualification work. This is a release-scope classification only: it does not represent guide approval, customer acceptance, a successful broad suite, a Lounge import, or local-authority commissioning. The local authority remains unqualified/NO-GO for commissioning until its separately stated operational and data-integrity gates pass.

## Manual impact — test harness and verification corrections (29 October 2026)

No customer workflow or UI behavior changed in this follow-up. A test-only environment flag was added to the isolated PostgreSQL runner, and stale regression snapshots were updated for already-implemented local routes. No customer manual update is required for these internal verification changes. All deferred customer guide and packaging work remains pending by user direction.

## Manual impact — new Bar and till connection wording (30 October 2026)

Setup now uses the labels “Set up a new Bar on this computer” and “Connect this till to my Bar” and explains that the main computer stores the Bar records. The one-use till code and certificate fingerprint are shown as connection details. This changes first-run/setup and pairing guidance, so the customer manual and quick-start need a later update and an installed workflow review. Per the user's direction, PDFs, screenshots, approved-manifest/checksums and packaged offline-guide checks remain pending and non-blocking for a software release. No PDF was edited or approved. This UI wording does not establish that LAN TLS, server installation, multi-PC pairing or customer commissioning is qualified.
## 2 November 2026 — installation progress and secure LAN pairing

Manual impact: setup displays actual stages, elapsed time, last activity and migration counts; an activity warning explains preserving the same attempt. Administrator-launch failures give concise guidance and collapsed support diagnostics. Pairing displays private HTTPS addresses plus the certificate fingerprint to compare on the connecting till. The main database remains private to the server. Customer manual/quick-start, screenshots, approved checksum manifest and packaged offline guide checks remain pending and non-blocking for this source checkpoint by user direction. No PDF was changed. Installed elevation and physical LAN qualification remain unverified; do not describe this checkpoint as a commissioned customer setup.

# 1 November 2026 — offline owner email/password

Manual impact: owner setup now collects an email address and password for offline sign-in; owner PIN remains for in-person approvals. Both Modern and Legacy sign-in screens provide owner email/password and staff ID/PIN modes. Existing commissioned owners without a password credential and isolated practice accounts retain PIN compatibility. Password reset requires the main computer's protected setup credential and signs out other sessions. Customer PDFs and quick-start, screenshots, approved document manifest/checksums, and packaged offline guide Open/Save verification are pending by user direction and do not block this software checkpoint. Customer commissioning evidence remains separate and unqualified.

Replacement-server reconnection now accepts owner email/password after the authenticated-device endpoint challenge, with an explicit original staff-ID/PIN option for existing accounts. Both workspaces use the same shared proof and screen, retain saved operations, and revoke the temporary verification session.

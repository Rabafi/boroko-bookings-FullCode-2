# LodgingOS property adaptation and controlled reclassification

Prepared: 2026-10-13 (Africa/Gaborone)
Status: Implementation brief requested by the user; no implementation or deployment performed by this document.

## 1. Objective and delivery boundary

Complete one coordinated implementation pass that makes LodgingOS accurately reflect a guest house, B&B, lodge, camp/campsite, or motel, including a controlled property-type change in Settings after setup. Deliver integrated code, migrations where needed, regression coverage, applicable documentation, passing affected checks/builds, and an evidence-based final report.

“One pass” means the implementing model owns discovery, parallel implementation, integration, self-review, correction, and validation through completion. It must not stop after scaffolding, produce disconnected agent patches, or defer known gaps to an unspecified second phase. It does not mean skipping iterative fixes or declaring success without evidence.

This brief authorizes implementation in the current project. It does not authorize changing real customer classifications, making financial test transactions in production, publishing installers, or automatically applying migrations to production. Prepare any deployment action completely; perform it only under explicit existing user authorization. Report the actual deployment state.

## 2. Evidence to recheck before editing

The following findings were verified against the working tree on 2026-10-13. Other work is active in this checkout, so these are observations, not permanent assumptions:

- `src/shared/productIdentity.js` allows `guest_house`, `bnb`, `lodge`, `camp`, and `motel` for `lodge-camp`. Hotel/resort and Restaurant/Bar POS use different products. Shared definitions mentioning hostel/apartment types do not make them selectable supported LodgingOS types.
- `src/shared/uiVocabulary.js` already supplies property-specific business nouns and several document labels.
- `src/shared/propertyTypes.js` builds defaults, operation styles, accommodation mix, and campsite profiles. `resolveLockedPropertyType` preserves the established type after setup.
- `src/main/domains/settings.js` uses that lock during ordinary settings save. Existing tests explicitly preserve product reclassification protection, including `tests/bar-mode-curation.test.mjs`.
- `Settings.jsx` displays the type and says it cannot be changed. `Setup.jsx` and `LodgeChooser.jsx` retain several lodge-only labels.
- Running `getDesktopNavItems` with broad synthetic role permissions across Starter/Standard/Pro gave identical menus for guest house/B&B, and identical menus for lodge/camp/motel at each tested plan. Guest house/B&B omit several modules, while lodge/camp/motel share events/day-use/F&B eligibility. Plan locks remain relevant.
- Supplying a camp profile with `rooms_or_units: false`, fewer `enabled_modules`, and `operation_style: simple` did not change navigation. Current navigation uses catalog/property/plan/role/add-on rules rather than those profile flags.
- `Rooms.jsx` supports room, cabin/unit, permanent tent and campsite inventory, plus powered sites, limits and rate modes. Camp inventory heading is “Sites & Rooms”; sidebar/dialog/board/planning labels remain partly room/lodge-specific.
- `Bookings.jsx` estimates single and multi-unit stays using nightly room rates and has no tent/vehicle input controls. The main bookings domain contains campsite pricing, `create_campsite_booking`, occupancy payloads and offline replay handling. The public booking form already has more campsite-aware controls.
- `Calendar.jsx`, `RoomGrid.jsx` and other daily screens contain room-only wording; some exclusive booking displays still use “Full Lodge.”
- Existing campsite/vocabulary tests cover helpers and selected source contracts, not a complete operator journey for each property type.

Read `AGENTS.md`, `PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, applicable nested guides, and `docs/SHIP_READY_RUNBOOK.md` if preparing a release. Inspect current Git status and preserve unrelated changes. Trace later migrations before judging any older RPC. Inspect linked database definitions when deployment compatibility matters; migration files alone do not prove deployment.

## 3. Product behavior to deliver

| Type | Required adaptation |
| --- | --- |
| Guest house | Correct guest-house wording; room/unit inventory; concise accommodation navigation and daily tasks. Existing paid/authorized optional services must not disappear just because of a default profile. |
| B&B | Correct B&B wording and accommodation flow; show existing breakfast inclusion/amenity information where already supported. Do not invent a new breakfast ordering or catering subsystem. |
| Lodge | Rooms/cabins/units and optional campsites; property-specific exclusive-use wording; events/day-use/F&B when configured and entitled. |
| Camp / Campsite | Sites, permanent tents, cabins and optional rooms; accurate unit names; people/tent/vehicle inputs and pricing; site readiness and facilities wording appropriate to actual inventory. |
| Motel | Motel wording and relevant arrival/departure tasks in the LodgingOS shell; avoid HotelOS-only rail entries or implied unsupported motel-only functionality. |

The distinction should be visible in setup/settings, navigation/search, dashboard, inventory, bookings, planning/availability, housekeeping/readiness, quotations/invoices/receipts, and guest-facing accommodation descriptions where applicable. Keep familiar common workflows; do not create five divergent financial systems or gratuitously redesign the shell.

Property type, actual accommodation mix, configured services, subscription entitlements and operator permissions are different inputs. Establish clear precedence instead of treating one as a substitute for another. Profile flags can tailor presentation but cannot grant server authorization or paid access. Legacy profiles without new fields must get safe, backward-compatible behavior.

## 4. Controlled property-type change in Settings

### Operator journey

1. An authorized administrator opens a clearly labeled Property type section. Show current type, available same-product targets, accommodation mix, and a concise explanation of effects.
2. Restrict target choices to the five supported LodgingOS types. Product identity, licenses and hospitality POS mode remain separate and protected.
3. Request a server-backed impact preview for the selected target. Show changes to wording/navigation/defaults and any blockers based on actual inventory, configuration, bookings, entitlements or relevant pending work.
4. Let the administrator review and explicitly confirm the concrete target. Do not silently save classification with an unrelated settings edit.
5. Commit through a dedicated atomic, audited, idempotent server contract; refresh canonical settings/access/profile and all affected clients after confirmation.
6. Give actionable recovery for offline state, permission denial, stale preview, incompatible configuration, ambiguous timeout and failed refresh. Preserve a stable operation key and provide a way to check the outcome before retrying.

### Server contract and protection

- Discover and reuse actual settings ownership/actor/capability conventions. Do not invent client-controlled tenancy or authority.
- Lock the relevant property/settings rows; enforce lodge scope, actor capability, same-product compatibility and expected version/current type. A preview is advisory; repeat all validations under the commit lock.
- Validate idempotency-key reuse against the original payload and persist an authoritative operation result. Concurrent changes and retries must resolve deterministically.
- Record before/after property type and relevant profile changes, actor, time, stable operation identity and a reason when useful. Preserve existing audit conventions.
- Keep ordinary settings save from bypassing this transition. Protect alternate writers, PWA calls, admin paths, imports, backup restore and generic database updates according to their actual trusted contracts. Do not globally weaken the existing lock.
- Do not change property/lodge IDs, room/site IDs, bookings, financial ledgers, paid totals, payment statuses, rates, invoices, stock or historical financial records as a side effect.
- Existing mixed inventory is valid where supported. Switching camp to lodge must not delete campsites or silently hide booked inventory. If a configuration really is incompatible, block with a specific repair path instead of destructive conversion.
- Do not replace the entire operating profile with fresh defaults. Preserve configured choices, entitlements, add-ons, capacity policy and existing values; apply narrowly justified defaults only to unset/new presentation fields.
- Classification changes are online-only. Do not queue an estimated local classification change. Inspect pending booking/stock/financial operations and preserve their original stable contracts. Block only demonstrated unsafe cases, with an explanation; unrelated pending work should not trigger a blanket ban.
- Reconcile late-arriving settings saves so they cannot overwrite the newly committed classification. A failed UI refresh must not imply the database change failed.

The five types must support valid same-family transitions in both directions, subject to concrete server-enforced blockers. Changing type must not be a licensing loophole or a way to activate HotelOS/POS features.

## 5. Shared presentation policy, menus and dashboard

Create or extend a small shared resolver for supported property type, real accommodation mix and contextual labels. Reuse existing vocabulary and catalog code; avoid duplicate mapping tables in every screen.

- Separate business nouns from unit nouns. A camp can contain a room, a cabin, a permanent tent and a campsite; display each correctly by inventory kind.
- Use property-neutral language before a type is known. Once selected, setup and login/profile cards should use the known type without changing stable internal identifiers.
- Correct sidebar, search results, page titles, dialogs, breadcrumbs, empty states, validation/recovery messages, guest documents and exclusive-use labels.
- Make accommodation navigation appropriate to actual supported inventory: sites-only, rooms-only or mixed. Use sensible fallbacks for old profiles and stale/offline cache.
- Define how optional services influence navigation and dashboard cards. Hide inapplicable modules, distinguish entitled/configured modules from locked offerings, and preserve legitimate installed services across type changes.
- Do not make guest house/B&B categorization permanently exclude an already authorized optional service unless server/commercial policy explicitly requires it. If current eligibility needs revision, align commercial, server and UI rules together rather than showing unusable controls.
- Give the dashboard property-appropriate summaries and next actions from existing operational data. Avoid fictional KPIs or unsupported B&B/motel subsystems.
- Camp housekeeping/readiness must reflect actual unit/facility tasks. Do not mechanically rename every room-cleaning task to campsite cleaning, or remove housekeeping needed by cabins/tents.
- Preserve capability and product route guards for direct links, quick actions and search. Menu visibility alone is not access enforcement.

## 6. Complete campsite booking and pricing flow

Trace single-unit creation, editing, multi-unit stays, quotations/conversion, public bookings, invoices/reports and both applicable offline paths before editing. Inspect the latest authoritative contract for each.

- Desktop booking must recognize selected unit kinds and use unit-aware labels, selection summaries, limits and rate descriptions.
- Add adults/children/tents/vehicles controls where applicable, with defaults and limits matching server definitions. Validate integer counts and supported pricing modes; make missing required occupancy information explicit.
- Calculate clearly labeled estimates with the shared helper or a server quote as appropriate. Cover per-site, per-person, per-tent, per-vehicle and combined modes. Reflect any legitimate seasonal/override policy consistently with the server; do not invent precedence.
- Keep the authoritative total/RPC result as truth. UI estimates must not author `amount_paid`, `payment_status` or persisted financial totals.
- Carry occupancy metadata, stable operation keys and any parent dependencies through create/edit/group/quotation/replay contracts where supported. Reuse existing RPCs when complete; otherwise update the complete atomic contract across callers.
- Editing must restore authoritative accommodation details; do not reset saved counts to zero or reprice an established booking silently.
- Mixed/group bookings need per-line counts and estimates where required. Do not allocate one campsite's counts across every child or route sites through a room-only financial contract.
- Preserve ambiguous-timeout retry identity and existing queued payload compatibility. Test zero/missing counts, capacity excess, pricing changes between quote/save, duplicate replay and concurrency.
- Ensure the reviewed public-site implementation and Manager reads remain consistent. Apply Legacy POS changes only if a traced shared payload/report/booking-charge dependency makes it applicable.

## 7. Cross-surface and deployment checks

Desktop is the main operator surface, but trace preload/IPC, main domains, authoritative Supabase RPCs/RLS, local profile/cache persistence, offline queue/replay, Manager PWA, public booking site, Legacy POS booking-linked paths, reports, imports/backups and migrations.

For each surface record “affected” with its change/check, or “not affected” with a concrete reason. PWA has its own device-local operational queue and does not use `database.js`. Product-type refresh must not leave stale permissions or a mismatched cached profile. Preserve offline read availability and existing queued financial/stock truth.

Validate migrations on a disposable database using repository helpers. Verify linked-schema compatibility read-only when credentials/tools permit. Do not test by mutating an actual customer property. If production deployment is not authorized, provide the ready migration list, deployment sequence, rollback/recovery assessment and smoke checks, and label the result awaiting deployment.

## 8. Multiple-agent implementation organization

Use multiple agents within this task. The parent owns integration and the final verdict. Suggested bounded ownership:

1. **Contracts agent:** property transition discovery, atomic RPC/migration, server authorization/concurrency/audit, main/preload integration and contract tests.
2. **Experience agent:** shared presentation rules, settings journey, navigation/dashboard, setup/chooser, unit terminology and related UI tests.
3. **Accommodation agent:** campsite form/estimates/details, group/quotation paths, replay compatibility, public/Manager consistency and focused regression tests.

Agree on shared interfaces before edits. Assign disjoint files where practical; parent owns shared-file merges. With a four-slot limit, use three children plus parent. After implementation, reassign an agent to independent adversarial review of work it did not author. Agents must share findings and blockers; their reports are evidence, not automatic acceptance. Do not create unrelated user-owned chats for subtasks.

## 9. Verification and regression matrix

Discover actual scripts from `package.json` and suite entrypoints. Use the repository's real commands; do not invent a test script or claim a source-string assertion proves behavior. Add behavioral coverage for contracts that change.

Minimum acceptance scenarios:

- Each of the five types, Starter/Standard/Pro and relevant trial behavior, representative roles and configured optional services.
- Rooms-only, sites-only and mixed inventory, old profile defaults, offline cached settings and post-transition refresh.
- Same-family transitions, both directions; unchanged target; unauthorized actor; wrong lodge; cross-product target; stale/concurrent requests; exact replay; mismatched-key reuse; timeout/outcome recovery; ordinary-save bypass attempt.
- Active bookings and existing mixed inventory preserved without ledger/rate/history changes. Existing commercial entitlements and limits remain valid.
- All campsite rate modes, count validation, single/group booking, edits, quotations where applicable, server quote disagreement, deposits, authoritative totals and replay identity.
- Property-specific labels and unit names in menu/search/board/planning/housekeeping/dashboard and guest documents. Verify actual rendered screens, not just helpers.
- Route/capability restrictions, keyboard flow, confirmation/error states, compact window and readable offline guidance.

Run focused regressions, applicable product/navigation/commercial/financial/offline suites, type checks for changed scoped modules and affected builds. Perform a five-type UI walkthrough with isolated fixture profiles/harnesses; never relabel the user's live profile to generate evidence. Capture relevant screenshots/evidence. Profile startup is outside this task unless a change introduces a startup regression.

Failures require investigation and repair. Classify unrelated baseline failures with reproduction evidence; do not silently omit them or keep rerunning broad suites without a reason.

## 10. Documentation and manual impact

Update `PROJECT_STATE.md` because classification transitions and profile/presentation policy materially change behavior. Document supported types, how to change type, restrictions, impact preview, recovery and deployment requirements. Update customer-facing help where affected.

Make an explicit Bar manual-impact assessment. If this is fully isolated to LodgingOS and Bar controls/workflows/permissions remain unchanged, record “No manual update required” with evidence. If shared changes affect Bar users, follow `docs/bar-manual/maintenance.md` and the approved manifest, including manual/quick-start/screenshots and packaged offline-guide checks before release. Do not assume shared files are harmless.

## 11. Self-review and stop conditions

Before delivery, parent and independent reviewer must inspect the final integrated diff against this plan and the financial-grade rules. Check bypass writers, scope/actor enforcement, atomicity, payload-bound retries, stale saves, cache refresh, backward-compatible queues, mixed inventory, pricing truth and entitlement boundaries.

Correct all actionable findings in the same pass and rerun affected verification. Do not weaken guards/tests to obtain green results. Do not claim full acceptance if a required workflow, rendered check, database validation or affected build remains unverified.

If external access genuinely prevents completion, finish all independent work, state the precise remaining limitation and provide concrete reviewable artifacts. Do not invent deployment evidence or substitute an unsafe client-only transition.

## 12. Final handover

Deliver: implemented behavior by type; files/contracts/migrations changed; agent ownership and independent-review outcome; verification commands/results and UI evidence; manual-impact decision; preserved user changes; migration/deployment state; any concrete remaining limitations. Identify the property-type Settings journey and campsite pricing corrections explicitly. The final claim must distinguish code complete, disposable database verified, linked schema verified, migration deployed and release published.

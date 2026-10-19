# Copy-ready implementation prompt

Implement the complete LodgingOS property-adaptation and controlled property-type-change plan in this repository:

`docs/engineering/property-adaptation/PROPERTY_ADAPTATION_PLAN.md`

Read that entire plan before editing. This is an implementation request, not a request for another plan. Complete discovery, code, migrations where needed, integration, regression coverage, rendered UI checks, self-review and corrections in one coordinated pass. Do not stop at partial scaffolding or defer known plan requirements to a later batch.

The project is Tsa Bonno HospitalityOS. Read and obey `AGENTS.md`, `PROJECT_STATE.md`, `docs/ARCHITECTURE.md`, applicable nested instructions, and the release runbook if preparing a release. Preserve the substantial existing working-tree changes and other active work. Recheck the dated findings against current code and later migrations; do not assume an old audit or this brief proves current deployment state.

Use multiple agents actively, within the available concurrency limit. Suggested workstreams are (1) atomic property-transition/server contracts, (2) shared presentation/Settings/navigation/dashboard, and (3) campsite booking/pricing/replay and cross-surface consistency. Agree shared interfaces first, give agents bounded ownership, integrate every change yourself, and assign an independent review to an agent that did not author the reviewed work. Use in-task subagents rather than creating separate user-owned chats. Do not accept agent summaries as proof that their code works.

The required outcome includes all of the following:

- LodgingOS accurately reflects guest house, B&B, lodge, camp/campsite and motel. Correct business and accommodation-unit vocabulary across setup/chooser, Settings, navigation/search, dashboard, inventory, bookings, availability/planning, readiness/housekeeping and guest documents where applicable.
- An authorized administrator can change between those five same-product property types in Settings after setup, using an impact preview and explicit confirmation. Keep HotelOS and Restaurant/Bar product identity, licenses and hospitality mode protected.
- Commit the transition through an atomic, server-authorized, lodge-scoped, audited and payload-bound idempotent contract. Enforce expected-state/concurrency checks. Ordinary settings saves and alternate writers must not bypass it. Keep transitions online-only and provide safe ambiguous-timeout/outcome recovery.
- Preserve inventory IDs, active bookings, historical financial records, rates, payments, stock, entitlements, configured services and unrelated profile fields. A camp-to-lodge transition must not delete or hide booked sites. Handle concrete incompatibilities with actionable blockers rather than destructive conversion.
- Make actual accommodation mix and configured services influence appropriate presentation/menu behavior, while preserving plan, role, product and server enforcement. Do not turn defaults into licensing policy or make UI visibility the authorization boundary.
- Complete desktop campsite booking inputs, counts/limits, accurate estimates, saved-detail restoration and applicable single/group/edit/quotation/replay paths for every supported rate mode. Use existing authoritative RPCs where complete; update complete contracts where needed. Carry stable operation keys and dependencies; preserve legacy queue payload compatibility. Never write bookings.amount_paid or author payment_status from clients, and never let estimates replace server totals.
- Trace all applicable desktop/main/preload, Supabase, Manager PWA, public booking, Legacy POS booking-linked, reporting, backup/import and offline paths. Document applicability and make complete changes where actually required.
- Add meaningful behavioral regressions, run actual package scripts, affected scoped type checks and builds, and verify rendered screens for all five types using isolated fixtures. Validate new database contracts on a disposable database. Do not reclassify the user's live property or make production financial test transactions.
- Update PROJECT_STATE and operator documentation; record the Bar manual-impact assessment and complete approved manual/packaged-guide checks if shared changes affect Bar customers.

Perform explicit self-checks before declaring completion: server bypasses, wrong-lodge/unauthorized actor, concurrent changes, stale settings overwrites, duplicate and mismatched-payload retries, ambiguous timeouts, mixed inventory, actual entitlements, offline cache/replay, all campsite price modes, and visible labels/errors. Have an independent agent inspect the final integrated implementation. Fix actionable findings during this pass and rerun affected checks. Do not disable guardrails or weaken tests to make them pass.

Implementation is authorized. Live customer classification changes, production migration application, installer publishing and releases require explicit existing user authorization; this prompt alone does not authorize them. Prepare deployment artifacts and checks completely, perform authorized actions only, and state the real deployment status. Verify the linked schema read-only when access permits; do not infer deployment from migration files. If a genuine external blocker remains, finish independent work and report the exact unresolved gate with reviewable artifacts rather than claiming the whole task is done.

Do not ask me to reconfirm routine implementation choices. Resolve them from the plan and repository evidence, keep progress updates concise, and continue until the complete authorized result is integrated and reviewed.

Your final response must summarize the completed property-specific experience and Settings transition; name the authoritative contracts/migrations; report agent contributions and independent-review findings/fixes; list checks/builds/UI evidence with results; state manual impact and deployment state; and disclose any remaining limitation plainly. Code complete, disposable DB verified, linked schema verified, migration deployed and release published are separate claims—use only the claims your evidence supports.

# Independent review prompt

Use this after the implementation model returns its completed change and evidence.

---

Review the Bar local-authority implementation against `AGENTS.md`, current `PROJECT_STATE.md` and `docs/engineering/bar-local-first/TECHNICAL_PLAN.md`. Read the implementation report, feature contract matrix, A01–A20 manifest, changed-file hashes, cutover/restore runbook, manual-impact record and actual test logs. Do not accept the author's summary as proof.

This is an independent correctness/security/completeness review, not permission to deploy. **Run no hosted Supabase migrations or writes, customer fixtures, releases or commissioning.** Use only positively identified isolated local test clusters. Inspect test wrappers before execution. Preserve all unrelated user/other-model changes and record the exact reviewed file hashes.

First establish what actually changed and whether the feature matrix is complete. Trace actual Bar navigation/search/actions/query tabs, enabled add-ons, settings/staff/import/export/background work, modern main/preload and Legacy clients. Find uncovered paths that still call cloud, depend on online Auth/entitlement or return mock/cache results as local truth. Verify hotel/lodge/PWA/public-site and existing cloud profiles retain their existing contracts.

Independently exercise real service/database paths for:

1. blank offline commissioning, trusted owner setup, pairing/TLS, entitlement validation, local staff/PIN/session/approval lifecycle;
2. cross-tenant/outlet/device/epoch/actor spoofing, direct API/SQL bypass, connection-pool scope leakage, package/capability denial and maker/checker;
3. concurrent identical keys and conflicting payloads, original receipt before stale shift/menu checks, unknown-outcome/status/late-arrival behavior;
4. atomic sale/tender/stock/audit/accounting/outbox rollback and crash-after-commit recovery; durable modern/Legacy client intents;
5. stock/tab/credit/voucher/cash-up/return/receiving races, exact decimal rounding and financial/stock conservation;
6. locally offered add-on/Accounting/workforce feature completeness and non-bypassable source/readiness/period/privacy/export guards;
7. loss of internet, then loss of LAN/server with internet still present: no authority fallback, duplicate replay or independent financial finalisation;
8. mesh/cloud-queue cross-contamination and stale old cloud writers; hosted writer-fencing limitation is explicit and commissioning cannot claim safe isolation from a local flag;
9. backup/WAL integrity, owner-held recovery material, staged replacement-machine restore, old-host isolation, stale-epoch denial, acknowledged receipts missing after restore and measured RPO/RTO;
10. disabled hosted ingestion, atomic outbox/export semantics, exported-versus-acknowledged state, dependency/cursor/payload integrity; no cloud writes or false cloud-report completeness;
11. local Windows service lifecycle/offline runtime packaging, native module loading, Legacy compatibility, printer failures/reprints, upgrades preserving data;
12. candidate/approved manual and quick-start accuracy, affected screenshots, approved manifest meaning and ordinary cashier offline packaged open/save access.

Rerun focused existing regressions and relevant builds using actual package scripts. Verify whether the 50,000-sale multi-process test hits real commands/DB and reconciles the ledgers, rather than generating queue rows. Distinguish simulated time from wall-clock soak and source build from installed/signed release. Check that missing runtime, hardware, keys or approval has not been disguised as a pass. Never run hosted fixtures to fill an evidence gap.

Report actionable findings with priority, exact verified path/line, concrete trigger, resulting financial/security/operational harm, reproduction/evidence and required correction. Use inline code comments for actionable code findings. Identify a missing/unsafe contract even if all submitted tests are green. Do not produce cosmetic findings to fill space.

Write a review record and acceptance matrix showing each requirement as verified, failed or unverified, with evidence references. Give separate verdicts for implementation completeness, financial/security correctness, documentation approval, packaged/hardware qualification, customer commissioning and cloud integration. Hosted schema unchanged and cloud ingestion disabled are expected boundaries, not proof that cloud consolidation works.

If there are blockers, state CHANGES REQUIRED and provide a bounded correction prompt. If the implementation is sound but hardware/guide/commercial/cutover evidence remains unavailable, state exactly which production gates remain NO-GO. No hosted deployment, customer switch or publication is authorised by a positive source review.

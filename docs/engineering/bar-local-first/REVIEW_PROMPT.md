# Independent review prompt

Use this after the implementation model returns its completed change and evidence.

---

Review the Bar local-authority implementation against `AGENTS.md`, current `PROJECT_STATE.md` and `docs/engineering/bar-local-first/TECHNICAL_PLAN.md`. Read the implementation report, feature contract matrix, A01–A20 manifest, changed-file hashes, cutover/restore runbook, manual-impact record and actual test logs. Do not accept the author's summary as proof.

This is an independent correctness/security/completeness review, not permission to deploy. **Run no hosted Supabase migrations or writes, customer fixtures, releases or commissioning.** Use only positively identified isolated local test clusters. Inspect test wrappers before execution. Preserve all unrelated user/other-model changes and record the exact reviewed file hashes.

First establish what actually changed and whether the feature matrix is complete. Trace actual Bar navigation/search/actions/query tabs, enabled add-ons, settings/staff/import/export/background work, modern main/preload and Legacy clients. Find uncovered paths that still call cloud, depend on online Auth/entitlement or return mock/cache results as local truth. Verify hotel/lodge/PWA/public-site and existing cloud profiles retain their existing contracts.

Verify that the new service/shared contracts use strict TypeScript, new high-risk adapters follow the plan's targeted language policy, and exceptions preserve compatibility rather than bypassing checks. Check one versioned contract definition, actual runtime validation, explicit money/identity types, no unchecked financial/authentication casts, compiled JavaScript compatibility with modern/Legacy runtimes and startup without development tooling. Database enforcement stays SQL/PLpgSQL. Reject both type-only validation and an unrelated application-wide rewrite.

Review A21–A23 in addition to A01–A20. Verify actual Windows 7 Legacy Bar workflows and office-published menu distribution over LAN with internet blocked: scope, complete/deleted/empty/paginated catalogues, stale carts and reconnect recovery. Preserve lodge/cloud behavior. Verify the actual supported Windows coordinator, full physical replicas, synchronous acknowledgement, promotion eligibility preserving acknowledged receipts, quorum loss, enforceable fencing, old-host return and original-ID recovery. Reject home-grown consensus, shared files, silent async fallback and automatic-failover claims for one modern host plus a Windows 7 till. Check witness/manual profiles, separate key/config provisioning and independent backups. Missing installed hardware/coordinator evidence blocks readiness.

Also verify the Settings-led setup section and A24, extending the manifest to A01–A24. Three PCs are illustrative; exercise two and six devices and distinguish client, full-replica and voter membership. Click actual server/join/full-copy/status/repair/switchover/remove controls in installed modern and Legacy builds. Check secure automatic discovery/pairing, offline service installation, resumable seeding, reconnect after address changes, role denial, safe membership changes, non-destructive failures and truthful readiness. Reject placeholder buttons, manual SQL/file-copy dependencies, unsafe promotion overrides and claims that a Windows 7 cache is a full replica. Verify screenshots/manual/quick-start and packaged guide coverage.

Independently exercise real service/database paths for:

Also independently verify A25–A32, extending the full manifest to A01–A32: power/maintenance behavior, opening checks and commit-time blockers, truthful always-visible till connection status, independent encrypted scheduled backups with isolated restore verification, offline mixed-version upgrades, fully separated rehearsal data, authorised offline replacement-PC recovery and the runnable failure matrix. Inspect actual controls and negative paths. Verify the simple two-PC recovery procedure positively isolates the previous primary, preserves all acknowledged receipts promised by its durability profile and never duplicates an uncertain sale. Check reference power-cut versus simulated-fault evidence, returned-old-host denial, training/verification isolation and guide coverage. Mark unavailable hardware evidence unverified; do not infer resilience from replicas or green source tests.

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

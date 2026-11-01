# Remaining local implementation — 26 October 2026

## Superseding checkpoint — 29 October 2026

This list is historical below; use this checkpoint and EV-159/160 as the latest state. Local owner setup is the default for fresh Hospitality POS installs, with cloud workspace selection explicit. It is not automatic PostgreSQL installation, business creation or commissioning. Local authority remains NO-GO for customer trading.

The complete guarded local PostgreSQL suite now passes **209/209** through migrations 0001–0073 on PostgreSQL 17.6 (EV-159). The Modern/Legacy workflow, storage, builds and focused typechecks are recorded in EV-160. Two local software verification gaps are still visible: the optional Electron startup smoke cannot launch Chromium's GPU child on this PC (`0xC0000135`), and the broad renderer IPC migration check exits nonzero with 11,077 diagnostics. Neither is represented as a passing check.

Continue local software implementation where possible. User explicitly excludes Supabase-dependent work and work requiring multiple physical PCs; physical Windows/peripheral/power qualification is likewise unavailable in this pass. The user also deferred PDFs, quick-starts, screenshots and approved-guide packaging, and directed that these be documented as pending but non-blocking for a software release. These exclusions do not establish customer commissioning readiness.

Unfinished local-capable software/qualification work includes isolated training/rehearsal authority; independent WAL/PITR and off-host recovery; replacement-host recovery and fencing; complete installed update orchestration; remaining approved corrections after closed shifts; automatic local service provisioning/lifecycle; complete profile/session/cache and shared-renderer route acceptance; and coverage reconciliation against every acceptance row. Continue to preserve failed fixtures and historical evidence. Do not use the older steps below as current verification status.

Read AGENTS.md, PROJECT_STATE.md, ARCHITECTURE.md, the original plan and TAKEOVER_LATEST_2026-10-26.md. Preserve unrelated TypeScript, Legacy login, PWA, booking and marketing changes. This checkpoint does not reduce acceptance scope or authorise hosted changes.

## Financial follow-up after disk cleanup

The disk blocker was cleared by authorised cache/project-fixture cleanup. Keep the runner's 4 GiB guard. Actual Modern/Legacy fractional refunds, finance detail reads and export integrity passed through 0059. The complete service rerun through 0060 passed **152/152**. Modern SQLite integration subsequently passed **67/67** Electron checks, **15/15** dedicated storage checks, a real HTTP/DB lost-reply recovery test and a bundled Electron / actual OS-storage probe. Consult TAKEOVER_LATEST_2026-10-26.md for exact boundaries and preserved historical failures; this is not full-plan acceptance.

```powershell
npm.cmd run bar-local:test:isolated
```

This creates a new loopback synthetic cluster, applies local migrations through 0060 and stops only that cluster. Logs remain under `.tmp/bar-isolated-tests`; successful data is retired after identity/stopped-state checks. PostgreSQL startup requires the approved elevated execution context on this machine, without weakening target safeguards.

The new tip guard does not deliver allocation/payout reconciliation. Allocated tips refuse cancellation atomically until that workflow is implemented; item returns retain the original tip. The case where every item was already returned and only a tip remains still needs an explicit supported reconciliation/refund workflow. Preserve historical receipts and submitted cash-ups.

After repairs, run final verification:

```powershell
npm.cmd run bar-local:test:isolated
npm.cmd run test:bar-local-ui
npm.cmd run test:bar-local-electron
npm.cmd run test:bar-local-storage
npm.cmd run test:bar-local-storage:electron
npm.cmd test --prefix legacy-pos
npm.cmd run bar-local:typecheck
npm.cmd run build:hospitality-pos
npm.cmd run build --prefix legacy-pos
```

The UI runner reuses installed Chromium, never downloads or skips a missing browser. `BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH` selects an installed executable. Root main/renderer pilot checks do not cover the whole app; dedicated finance checking covers the new UI/helpers and the service/contracts are strict TS.

## Remaining software, separate from hardware

1. Reconcile every original acceptance/feature/work-package row against current source and executable evidence. Mocks, visible forms, isolated SQL and author claims are insufficient. Attribute the broad Bar suite's 34 failures individually; do not regenerate deferred guide/PDF baselines.
2. Complete installed SQLite upgrade/replacement and the full crash/print/power matrix. Modern startup now uses transactional SQLite, with validated one-time JSONL import, protected profile pinning and bundled Electron/OS-storage checks. Preserve the original Windows profile, retained JSONL, SQLite journal and recovery sidecars; never substitute a stale archive. Legacy keeps its separate protected JSONL contract.
3. Finish Settings commissioning, host/replica enrollment/replacement and actual packaged lifecycle. Do not claim a replica before full physical seeding, catch-up and durability are established.
4. Select/integrate a mature supported coordinator/quorum/fencing topology. No improvised consensus or promotion of an unproven copy; never downgrade synchronous acknowledgement silently.
5. Finish independent WAL/PITR, portable recovery material, destination health, staging restore, replacement/upgrade recovery and evidence. Same-disk snapshots and replicas are not independent backups.
6. Finish durable export/checkpoint/retry/signing boundaries and dry-run cutover reconciliation. Hosted ingestion stays disabled. New hosted writer enforcement requires separate authorisation or proof of an existing supported mechanism.
7. Finish remaining lot/FEFO/expiry behavior and audit imports, attachments, training isolation and other matrix functions. Safe closed-drawer refund refusal does not deliver a reviewed historical reconciliation workflow. Preserve affected submitted cash-ups pending reviewed correction.

Physical Windows installation, two/six PCs, Windows 7, real power/peripheral tests and qualification are pending at the user's request. PDFs/quick-start/screenshots/approved-document manifest and packaged-guide checks are separately deferred. No hosted changes, release, deployment, commit or push are authorised here.

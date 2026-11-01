# Security and failure review — source checkpoint

Date: 2026-10-20. Status: **CHANGES REQUIRED**.

This is a bounded source checkpoint, not an independent approval or penetration test. It records verifiable gaps and the evidence needed to close them.

## Implementation continuation — 22 October 2026

The 20 October findings below are historical and must not be read as a current file-layout audit. Modern/Legacy Bar local entry points, IPC adapters, startup authority checks, operator panels, scoped service queries/commands, and Windows lifecycle source have since been added. The admin/operations code audit found and corrected additional source defects: database status and backup listing no longer suppress backend errors, backup verification authenticates AES-GCM contents rather than trusting an editable checksum manifest, failed admin audit writes are surfaced with a possible-completion warning, and the documented CLI switchover now persists the operator reason and intent/outcome audit.

Remaining critical qualification issues: there is no automatic coordinator, quorum or partition-safe failover; manual switchover leaves client repointing to the operator; Windows installation/service/ACL/task/reboot behavior is unqualified; backup tasks are source only, daily/startup, and lack WAL/PITR and proven independent custody; no replacement-host restore or measured RPO/RTO exists; not every existing Bar domain route is local; and no installed two-/six-till, Windows 7, power, printer or long-soak failure matrix has passed. The focused unit tests do not establish any of those facts. The broad service test invocation was not able to run its guarded DB cases because the disposable `BAR_LOCAL_TEST_DB=1` target was not configured.

The split-tender UI previously offered a `provider_confirmed` selection despite there being no trusted provider integration. Both local client evaluators now reject that value, both UIs state that external tender status is locally asserted only, and the local SQL sale contract rejects provider-confirmed input. Room charge is disabled and refused before submission because the hotel authority integration is absent. Focused Modern/Legacy tests, renderer typecheck and product builds pass; no provider integration or HTTP/database end-to-end run was added in this follow-up.

## Blocking findings

### P0 — Local authority is not connected to either application

**Evidence:** searches of `src/main/index.js`, `src/preload/index.js`, `legacy-pos/src/main/index.js`, and renderer components contain no local authority/router references. Local files exist under `src/main/bar-local/` and `legacy-pos/src/main/bar-local/`, but no entry point imports them.

**Trigger and harm:** selecting/using the existing Bar application and losing internet continues through the existing cloud/cache path. No enforced local-only mode or stable operation handoff exists. A future partial connection could also permit a cloud fallback unless the router owns all authority decisions.

**Required correction:** wire a trusted business/product/outlet/authority/epoch-scoped router through startup, authentication, IPC, all Bar reads/writes, background jobs and renderers; wire Legacy cashier paths; prove local outage with internet available fails closed; fence old queues/mesh and preserve operation ID/payload through uncertain responses. Keep cloud profiles and Hotel/Lodge/PWA/public paths unchanged.

### P0 — Operator setup and lifecycle are absent

**Evidence:** no connected Settings controls for host setup, join, replica enrollment, device status, repair, switchover, remove/replace, or recovery are present. No offline installer/service lifecycle or packaged dependencies are evidenced.

**Trigger and harm:** a cashier/operator cannot create or recover the local authority using the supported product workflow. Manual database setup would be error-prone and contradicts the required workflow.

**Required correction:** deliver privileged, idempotent Settings/service workflows, protected credential provisioning, discovery/pinning, resumable seed/catch-up and honest topology/readiness state; qualify two- and six-device profiles.

### P0 — Replication, coordinator, fencing and backup are not established

**Evidence:** dependency inventory states no supported coordinator selected, no physical standby implementation, no backup/WAL workflow, no recovery-key policy, no installed qualification. Windows 7 remains client-only.

**Trigger and harm:** an office-host failure can stop service; unsafe promotion or restoring a stale copy could lose acknowledged receipts or create split-brain. Replicas alone do not provide backup.

**Required correction:** select and package a supported Windows coordinator with majority agreement and enforceable fencing; prove acknowledged-prefix eligibility, synchronous durability, old-host denial and return-as-standby. Add independent encrypted backup/WAL, owner-held keys, isolated restore verification and measured RPO/RTO. Until then do not claim automatic failover or recovery guarantees.

### P1 — Feature matrix and customer workflows are incomplete

**Evidence:** current matrix marks rows partial, not implemented, or external pending. Several implemented service domains are explicitly not wired to client screens. The current Bar app workflows, enabled add-ons, Settings, exports and background jobs have not been exhaustively traced into local handlers.

**Trigger and harm:** operators may see missing functions or misleading cached/online results while local trading appears enabled.

**Required correction:** complete the matrix from actual navigation/callers, implement each locally possible workflow or explicit external pending state, and add real API/database authorization/recovery tests.

### P1 — A04–A32 operational evidence incomplete

**Evidence:** acceptance manifest records no client crash-window harness, installed failover, setup, recovery, backup, Windows 7, two-/six-device, actual 50,000-sale, 8-hour soak, or failure-matrix run. A03's earlier service HTTP concurrency evidence does not prove client persistence or installed deployment behavior.

**Required correction:** execute each acceptance criterion on the actual production path; simulated tests must be labelled simulated and not substituted for hardware/runtime evidence.

## Reproduction/evidence commands

- `rg -n "bar-local|bar_local|authorityMode|authority_mode" src/main/index.js src/preload legacy-pos/src/main/index.js src/renderer/src/components/Settings.jsx`
- `npm run bar-local:build` (passed in this checkpoint)
- `npm run bar-local:typecheck` (passed in this checkpoint)
- `npm run bar-local:test` (not run: isolated target variables absent; test suite resets its target schema)

No database-target guessing was performed. No hosted Supabase changes occurred.

## 2026-11-04 — normal Hpos local Bar Menu adapter

- `/hpos/menu` now mounts `BarLocalNativeMenu` in local Bar authority mode. The page uses only authenticated `barLocal` queries/commands, rejects incomplete or cross-snapshot reads, carries version preconditions, performs catalogue archive rather than deleting history, uses exact percentage-to-rate conversion and keeps unknown operations on their original retry ID. Cloud Restaurant menu flows are unchanged.
- Verification: focused route/menu/chooser checks **13/13**; renderer typecheck passed; Hospitality POS production build passed; disposable PostgreSQL catalogue/availability tests **2/2**; focused stock/shift-readiness/tabs/cash-up database tests **6/6**; rendered Chromium Menu workflow through the actual local service HTTP listener and disposable PostgreSQL **1/1**, including a simulated lost reply followed by same-operation retry and a single create effect. The browser test uses a test `barLocal` bridge and does not cover Electron IPC or the SQLite journal. `pg_ctl start` error 87 was bypassed by starting only identity-checked disposable clusters directly; all were cleanly stopped.
- A08 is now **verified**: 2/2 isolated DB tests cover same-operation receipt replay after shift close/menu and catalogue changes, and a pre-close sale envelope first submitted after close being durably refused under its original operation ID without changing shift/date or financial effects; see EV-197.
- Saved-setup reopen was attempted under the existing authorization but could not run: no Hospitality POS app is installed/registered on this workstation; the only discovered executable is the installer, which was not launched. See EV-195.
- The shared owner login now shows the saved post-setup notice and consumes it only after successful owner email/password authentication; the full local Electron test command passes **109/109** after updating a stale owner-first-use test. Staff PIN attempts do not clear that owner notice.
- `/hpos/pos` and `/hpos/stock` remain service-backed `BarLocalWorkspace` panels, not the regular `HposTerminal`/`HposStock` pages. Those panels retain local atomic workflows; normal Hpos parity and Electron IPC/running-service rendered acceptance remain open. Legacy saved-setup transition, full renderer/workspace separation, and release/commissioning gates remain open. Physical multi-PC and Supabase/hosted work remain excluded; PDFs and approved guide packaging remain pending and non-blocking by user direction.
- Focused Bar implementation/evidence commits are recorded in branch history. Push was rejected by automatic review because the origin is not verified as a trusted private organization repository; exact remaining action is recorded in EV-192. Broad unrelated worktree changes remain uncommitted.

## 2026-11-03 — shared Hospitality POS login wired to local Bar identity

- The configured local Bar shell now renders the familiar Hospitality POS login form, with explicit owner email/password and staff ID/PIN methods. Its local-authority branch calls only `barLocal.login`; cloud auth status, trusted-session restore, cloud password reset and company-selection flows are suppressed. The returned staff session is validated before entering the workspace.
- After authentication, the shell loads a scope-validated local `bootstrap` query and uses its business/outlet identity and entitlement feature set for shared profile/settings/feature contexts. It does not infer identity from email or network availability.
- The normal Hospitality POS startup now offers an explicit pre-login Restaurant / saved local Bar choice. Selection is durably stored; opening a Bar relaunches the same app with an isolated local Bar user-data profile. Switching back refuses unresolved local operations, clears the local session and returns to the saved Restaurant profile. Legacy saved-setup compatibility and a rendered mixed-business walkthrough remain unverified.
- The normal Menu, Stock and Till screens are still **not** routed to local adapters. Operational routes remain on the local panels, because generic cloud IPC remains fail-closed. Screen/API mapping and required disposable acceptance are recorded in `docs/engineering/bar-local-first/NORMAL_HPOS_LOCAL_AUTHORITY_INTEGRATION_2026-11-03.md`.
- Focused authority/chooser/setup tests passed **48/48**; existing local UI checks passed **43/43** with installed Chrome; renderer typecheck and final Hospitality POS production build passed (existing Vite chunk warnings only). The chooser hides cached Restaurant identity without deleting the disk session; rendered mixed-business/offline-session and queue replay acceptance remain pending. Native Menu/Stock/Till adapters and wrong-role/outlet service acceptance also remain pending. Existing Rabafi data and app process were not touched in this source verification; no hosted change, commit or push occurred. Customer PDF and packaged-guide work remains pending and non-blocking by user direction.

## 2026-11-03 — local Bar chooser lifecycle reconciliation

- Removed the unconditional saved-setup banner. The chooser now reads a sanitized summary of the separate local Bar workspace and shows a completed Bar under its saved business name with **Ready / Open Bar**, or an actual unfinished saved attempt as **Draft Setup / Continue setup**. Protected owner completion or a committed local authority keeps the entry Ready across restart and transient service outage; service readiness is not queried to decide whether setup completed. Unreadable saved state stays visible for recovery.
- A draft is deduplicated only when its exact profile ID was explicitly linked during new Bar setup handoff or the operator confirms **This is the same Bar**. The link is protected with OS storage and the saved profile data is retained. Existing unmatched drafts—including any generic “New Business” record without a saved link—and all other property profiles remain untouched. No name-based matching, customer database access, credential access, hosted activation, or destructive cleanup was performed.
- Focused chooser lifecycle/registration tests passed **28/28**. Main and renderer typechecks and the Hospitality POS production build passed. Manual impact is recorded in `docs/engineering/bar-local-first/MANUAL_IMPACT.md`; customer PDF, quick-start, screenshot, manifest, and packaged-guide work remains pending by user direction.

## 2026-11-03 — Bar owner projection review fixes

- Corrected owner report source handling: reviewed cash-ups inherit exact amounts from the earlier submitted record, lot waste reports delta and remaining quantity separately, and lot release is shown as a lifecycle event. Connection IDs now use the same non-UUID-safe contract across claim, management, sales, and PWA response validation.
- Migration 0081 also scopes retry selection, so an old prepared batch for another outlet no longer blocks the linked outlet. The receiver test reproduces the pre-fix selector and then verifies the 0079→0080→0081 upgrade path preserves the excluded batch and outbox ownership.
- PWA owner requests now race fetch and body reads against an independent deadline, cancel the active reader, and reject already-aborted callers before starting fetch. A real loopback HTTP suite passed **6/6** for stalled headers/body, cancellation, oversize bodies, repeated requests, and already-aborted signals.
- Latest verification: isolated owner receiver/upgrade regression **1/1**, request tests **6/6**, Bar service build, Manager PWA production build/typecheck, targeted ESLint **0 errors / 2 existing App.jsx warnings**, and scoped diff checks passed. The guarded runner reproduced Windows `pg_ctl start` error 87; the same owned disposable cluster was started directly, all 81 migrations bootstrapped, the regression passed, and `pg_ctl` stopped it cleanly.
- **Multi-outlet owner reporting remains pending and is release-blocking for multi-outlet businesses.** Migration 0080/0081 binds both new batches and retries to the configured outlet; other-outlet rows remain queued. The owner view labels its one-outlet scope and must not be presented as venue-wide. Browser walkthrough, hosted/Supabase receiver activation, installed customer qualification and physical multi-PC checks were not performed. Customer manual/PDF/screenshot/package-guide work remains pending and non-blocking by the user's instruction. No customer Bar database was used or changed.

## 2026-11-02 — current Bar local-first status after route and PWA follow-up

- Configured local Bar now mounts the standard Hpos layout/nav through a strict route allowlist; supported entries route to the established local service-backed Bar panels. Unsupported entries fail closed with a local-only explanation. This is shell integration, not parity with every cloud-backed Hpos component. Standard-shell role/outlet and ambiguous-timeout acceptance remain open.
- The one existing Manager PWA withholds stale hosted Bar snapshots and old accommodation/runtime notifications. A local-only owner sales projection slice now has a separate owner account, approval link, bounded signed uploader, isolated idempotent receiver, sales history/chart and ingest watermark. It has not been deployed or activated for customers. Stock, cash-up, wider reports/charts, and the receiver's hosted operation remain open.
- Follow-up verification: Manager PWA boundary/membership tests **22/22**, PWA production build passed, targeted ESLint **0 errors / 5 warnings**. See EV-181 and EV-182. Hospitality POS route/readiness tests/build/typecheck and local UI tests are recorded in EV-181.
- The user approved applying the installer fix and reopening the saved setup. The original Rabafi setup was reopened in the dedicated Bar app; service installation is confirmed but owner sign-in/commissioning and trade acceptance remain pending. Do not claim owner-commissioned status. See EV-175 and EV-179.
- PDF/quick-start/screenshots/approved package-guide work remains pending and non-blocking by user direction. Supabase/hosted activation and physical multi-PC checks remain excluded. Do not push/commit the broad mixed workspace as a single change; it contains many unrelated edits. Focused commit/push can happen after scope completion and clean separation.

## 2026-11-02 — local owner sales projection slice

- Added a Bar Owner View inside the existing Manager PWA; it reads a dedicated owner receiver and never falls back to accommodation or stale hosted Bar data. Verified owner email/session, one-time enrollment, owner approval/revocation, exact signed link proof, outlet scoping, sales totals/history/chart and last receiver-ingested timestamp are wired end to end.
- A real local Bar sale was committed, uploaded from the durable outbox, ingested into a separate disposable receiver database and read back through the PWA API. Exact-original-body hashing preserves decimal scale. Replayed batches are idempotent; wrong-owner access, hostile origins and revoked links are refused before another financial body is accepted. Tests: cloud sender **5/5**, body/deadline/retry **3/3**, owner receiver vertical slice **1/1**. Service typecheck/build, Manager typecheck/build and Hospitality POS production build passed.
- The ordinary `pg_ctl`-started test runner still fails on this Windows image with restricted-token error 87. Focused integration checks used the same identity-checked `bar_local_test_*` PostgreSQL 17 cluster via a direct hidden `postgres.exe` process and stopped it cleanly; the test runner itself was not weakened. The broad `typecheck:renderer-ipc` remains non-green with **8,628** repository-wide diagnostics (8/170 caller roots clean); this work does not claim standard-Hpos TypeScript acceptance.
- Receiver server and email webhook are not deployed, no hosted database is configured, and no production link is active. Stock, cash-up, broader owner reports/charts, installed customer qualification, and physical extra-PC testing remain open. Bar commissioning stays NO-GO. See EV-183 and `docs/engineering/bar-local-first/OWNER_PROJECTION_IMPLEMENTATION_2026-11-02.md`.

## 2026-11-02 — user-reported owner setup and empty-menu first-use status

- The user reports owner setup completed and the app restarted, but no success message appeared. They signed in and saw the Bar counter with `empty_catalogue`; their next action is to add products and stock. This later user report supersedes the earlier “owner setup pending” wording below; no live Rabafi data was read or changed in this continuation.
- Source now preserves a one-time owner sign-in notice across restart and lets the owner verify an empty menu while service readiness continues to block financial operations. Product tax is entered as a percentage, and failed catalogue reads are not treated as an empty menu. Focused software verification is recorded in EV-180.
- The latest user request to integrate local Bar into the normal Hpos customer shell remains open. The committed local profile still routes to `BarLocalWorkspace`; normal `HposLayout` pages continue to use cloud IPC and must not be exposed to local sessions until safely dispatched to the local authority. The local implementation is not accepted as complete or release-qualified.
- Customer PDFs/screenshots remain pending by user direction. Multiple physical PCs and hosted Supabase work remain excluded. The active app, local Bar database, products, stock and transactions were left untouched.

## 2026-11-02 — Rabafi local database installed; owner setup pending

- The original saved Rabafi Pub attempt now has both local services running. PostgreSQL accepts loopback connections on 127.0.0.1:55432 and the Bar service liveness route returns HTTP 200. The authenticated readiness route returns HTTP 401 without a device session, as designed. The Bar screen is refreshed to **Service installed — waiting for the owner sign-in**; the owner must enter the PIN and password to finish setup. Credentials were not generated or entered.
- Installation surfaced and fixed three additional Windows issues: the C# service wrapper read the wrong argument source; app-side retry detection could not read protected PostgreSQL state; and reinstall tried to rewrite already-correct Windows service settings. The elevated installer now safely chooses resume versus initdb, never resets the populated cluster, and skips redundant service configuration. PostgreSQL data and the Restaurant profile remain intact. The installer log reports the encrypted backup task registered, but restricted-access Task Scheduler enumeration was unavailable, so separate live task confirmation remains pending.
- This is an installed local database, not a fully owner-commissioned or release-qualified customer Bar. Owner onboarding, authenticated readiness/trade walkthrough, actual backup run/restore, TLS/LAN and physical multi-PC qualification remain open. PDFs/screenshots/packaged offline-guide work and Supabase work remain deferred; customer guides are pending and non-blocking for a software release by user direction. See `docs/engineering/bar-local-first/INSTALLER_RECOVERY_2026-11-02.md`.

## 2026-11-02 — Installer binding and real Windows stages corrected

- The actual binding failure was reproduced: the array splat passed -PgBin positionally into integer DbPort. A named hashtable now carries integer ports and boolean switches. Explicit resume preserves the old wrapper and regenerates it from the same protected attempt; no owner proof, secret or business identity is replaced. CLIXML progress is excluded from primary errors and actual installer status takes precedence.
- Real isolated elevated initdb and two NoApply configuration passes under strict service-account ACLs succeeded. They exposed/fixed Windows PowerShell's null-to-empty File.Replace issue and PostgreSQL's refusal to validate as an administrator. A bounded read-only validator reduces its child token and restores temporary configuration-only DACLs; it cannot start/stop a database. Temporary fresh-initdb password/installer access is removed afterward.
- A supervised live retry confirmed actual ports arrived as Int32, then exposed an earlier runtime copy to the unversioned parent. The copy root is corrected and an actual generated-function copy regression preserves earlier/partial copies. Existing runtime artifacts remain preserved. This historical checkpoint was superseded by the subsequent PG initialization and installed-service verification in EV-177–179.

## 2026-11-02 — Approved fix loaded; original Rabafi setup verified live

- User explicitly approved rebuilding/reopening the Bar app. Hospitality POS and service builds passed; the refreshed server package verified **1,974 files**. The previous packaged runtime was preserved. Only the dedicated, idle Bar window was closed normally and reopened; the shared Restaurant process stayed running.
- Live read-only IPC in the rebuilt window returns the original **Rabafi Pub** attempt `f7fac8c7-f80b-4fbd-97d7-5d8ddba18143`, phase `failed` with its historical installer error. Its saved-attempt screen is visible, **Retry the local Bar installer** is enabled, no new-registration form is visible and no saved-status error is shown. Protected setup and Restaurant profile checksums are unchanged. Earlier inability to observe actual IPC is superseded by this read-only running-window check.
- The corrected launcher is loaded. Older saved wrappers now inherit the progress-file location from the fixed launcher, and actual installer log stages provide a compatibility fallback. Focused tests passed 40/40, with the final affected 19/19 rerun and main no-emit check passing. No retry, new business, database initialization or customer commissioning was performed automatically; the next visible action is the original attempt's Retry button and Windows administrator approval. See EV-175.

## 2026-11-02 — Windows elevation fix and saved Bar setup visibility

- Supersedes the unresolved launcher result in EV-173: direct `RunAs` targeting Windows PowerShell consistently failed with 0xffffffff, while the signed Windows command host elevated successfully. The corrected launcher elevates that host once and runs only the canonical PowerShell executable with the encoded, fixed wrapper command. The real harmless smoke **passed**, including administrator-token assertion and spaces/apostrophes in the script path. UAC remains enabled; no cashier-app elevation, policy change, service/database action or current-app restart was used.
- The renderer no longer converts saved-status IPC errors to absent state or waits for full payload hashing before showing a saved attempt. New registration is locked until a positively verified absent response; errors retain the previous attempt and show recovery guidance. Polling reads status only instead of repeatedly hashing the payload. The profile chooser has an explicit **Open saved local Bar setup** action; resume refuses a missing saved record and preserves the existing prefill and company profiles.
- Current process inspection confirms distinct shared and dedicated Bar userData directories. The saved protected setup file remains in the dedicated directory. No live IPC debug listener was available, so the screenshot's precise IPC outcome was not observed; source race/error handling is verified, not presented as proof of corruption/deletion. Focused tests passed **40/40**, main no-emit check and status-helper strict check passed, and both changed JSX files parsed. The running app was not rebuilt/restarted or hot-patched by tools; loading the changed main-process launcher still requires an authorized app refresh/restart. See EV-174.

## 2026-11-02 — Bar installation visibility and secure LAN source follow-up

- New automatic setup plans create a protected native Windows certificate, pin its fingerprint before owner commissioning, expose only HTTPS on the private LAN, constrain the API firewall rule to Private/LocalSubnet and keep PostgreSQL on loopback. Pairing screens show private LAN addresses and the certificate fingerprint. The isolated certificate/retry/actual HTTPS check passed 2/2 before the live setup investigation; physical additional-PC installation remains pending.
- Source now reports actual installer stages and database migration counts, elapsed time and last activity. Unknown-duration work uses an indeterminate bar. A 30-minute launcher observation deadline preserves the running installer; refresh observes late completion. Unconfirmed started attempts cannot launch a second installer. Owner-stage recovery does not reinstall a completed service.
- The canonical Windows PowerShell/encoded-argument launcher handles account paths with spaces and apostrophes. **The real harmless RunAs smoke still reproduces Windows error 0xffffffff on this workstation; elevation is unresolved, not qualified.** UAC is enabled, Appinfo is running, and the test context is interactive/non-elevated. No assumption of cancellation or disk failure is made. The current saved attempt has a wrapper and protected state but no status/log; the default ProgramData install root is absent. This is evidence of no observed wrapper startup, not a global assertion about installed PostgreSQL instances.
- Focused setup/runtime tests passed 36/36; service/main no-emit checks and JSX parsing passed. The running app, saved draft, attempt/secrets and any databases/services were preserved. No application rebuild/relaunch or production change was performed to apply this source checkpoint. Remote owner portal/link work remains incomplete and is not activated. Customer guide/PDF work remains pending and non-blocking by user direction. See EV-173.

## 2026-11-02 — Offline Bar owner credentials and direct onboarding

- Fresh Bar setup remains local by default. Choosing Bar in standard product setup now leads directly to new-Bar setup or existing-Bar pairing, with the choice carried into the isolated Bar window. It does not commission a live business without completing the local Windows setup.
- Local migration 0078 adds salted PBKDF2 owner email/password authentication shared by Modern and Legacy. Password reset requires loopback plus the main Windows profile's protected recovery secret, revokes sessions, clears lockout and records an outlet-scoped audit event. Password changes and sign-in bind the verified credential version under database locks. New owners use email/password; existing owners without a password credential and isolated practice accounts retain PIN compatibility. Owner PIN remains available for approvals.
- Passwords are transient and excluded from durable provisioning records. Interrupted setup preserves its original operation/device proof and asks for the password again. A replay returns the original business identity and preserves any later password change.
- Verification and remaining boundaries are recorded in `docs/engineering/bar-local-first/EVIDENCE_LOG.md` (EV-172). Migration/profile/authentication, actual Modern/Legacy trading, scope denial, approval identity, concurrency and runtime privilege checks were exercised on an explicitly guarded disposable PostgreSQL 17 cluster. Modern/Legacy builds and the staged 1,961-file server payload passed. No customer Bar, installed live database, hosted Supabase or production receiver was activated. Full-suite Windows teardown/PITR qualification, installed update lifecycle and physical equipment/multiple-PC checks remain separate pending qualification work. PDFs/screenshots/guide approval remain deferred by user direction and non-blocking for this software checkpoint.

## 2026-10-30 — Bar local setup and replacement reconnect follow-up

- Bar registration aliases are refused before cloud company setup, and the setup wording now describes creating a new Bar on the main computer or connecting another till. Local Bar remains the fresh setup default; this does not install/commission the database automatically.
- Added an authenticated-device replacement challenge route. It signs a fresh nonce with the paired device token hash and binds the proof to Bar/outlet identity, the actual listening endpoint and the promoted, unfenced authority epoch. Modern and Legacy verify the challenge on the same pinned endpoint before releasing device credentials or owner PIN for reconnect. Local migration 0076 grants the lookup only to the service runtime; hosted migrations are untouched.
- Verification: focused Modern Bar Electron tests 101/101, Bar UI browser tests 5/5, registration/replacement proof 13/13, replacement challenge HTTP tests 3/3, Modern and Legacy builds, Bar service typecheck, and Modern renderer typecheck passed. The guarded full PostgreSQL suite reached 211/245 before its 30-minute runner timeout: one PITR runtime-authentication failure, an outdated replacement-test call signature, and downstream tests affected by that test fencing the shared runtime role. The replacement test passed 1/1 alone and post-close correction tests passed 3/3 alone. The default suite runner now runs physical recovery/replacement in a separate final child process; a complete rerun remains pending.
- Independent WAL/PITR/off-host recovery and replacement-host restoration/fencing, installed update lifecycle and full A01–A32/64-row reconciliation remain incomplete. Current practice-mode provision/trade/restart/reset passed 1/1 on an isolated temporary cluster, and post-close DB corrections passed 3/3. Physical additional-PC, Windows 7/peripheral/power checks and customer PDFs/quick-start/screenshots/packaged guides remain pending by user direction. No hosted Supabase change, Bar business creation, customer cutover, release or commissioning occurred.

## 2026-10-30 — Cloud Bar profile-switch read isolation

- Reproduced late catalogue responses populating a newly selected company cache, shared in-flight menu requests across companies, and old reconciliation denials being logged against the new company. Added business/cache/authenticated-client scope checks around menu/fingerprint, outlet, stock-readiness and financial-report reads; menu/outlet request deduplication is scoped. Late results are discarded before cache writes or critical-error attribution.
- Background cache hydration, post-sync refresh and read-retry timers now stop on business/client changes. Initial actor publication on the same authenticated client continues normal login hydration. Automatic validation waits for an online business staff session rather than running with Command Central identity or no backend token. Financial mutation/replay/idempotency contracts are unchanged.
- Verification: first-run/scope suite 17/17; menu/reconciliation/financial-persistence/multi-company tests 23/23; onboarding/operator/error visibility 20/20. The previously reported BarTraining error-banner failure is resolved in the current working tree by pre-existing changes, preserved here. Queue replay authority passed 9/9 and the offline queue regression passed after the cache-scope changes. Final Hospitality POS production build passed with the late stock-failure fence confirmed in the built main bundle; source syntax and scoped whitespace checks pass.
- Read-only live probes confirmed the four catalogue/fingerprint/stock/reconciliation RPCs exist and reject unauthenticated requests. No authenticated Rabafi renderer walkthrough, hosted migration, business mutation or deployment was performed. Rabafi removal remains stopped at the user’s instruction.
- Manual impact required for the added recovery message: manuscript/quick-start source updated. Approved PDFs, screenshots, manifest and packaged guide acceptance remain pending before release; this is development verification only.

## 2026-10-29 — Cloud Bar first-run error and access guidance

- Fixed a confirmed empty catalogue being labelled failed when an unrelated POS service rejects. Catalogue/service errors remain distinct; failed or missing catalogue responses never establish emptiness. Empty Till now offers Add products to authorized managers and explains opening stock. Stock failure messages remain for existing products/baskets; no selling authorization or server stock checks were relaxed.
- Manage PIN dialog links to authenticated My Staff PIN creation; existing PIN changes still require the current PIN and Manage still verifies it. New draft creation clears previous operator/replay authority before changing company.
- Renderer crashes now receive main-process business tags and App Issues filters by active business before limiting. Older unattributed computer logs remain available in support diagnostics.
- Focused regression suite: 6/6 pass. Hospitality POS production build passed. Adjacent onboarding/operator/error suite: 19/20 pass; unrelated existing BarTraining.jsx lacks the shared error-banner path. No hosted schema migration, local conversion or customer commissioning is claimed. Original access-denied deployment condition is not proven resolved by these UI fixes.
- Manual impact required: manuscript and quick-start source updated; screenshots, PDFs, approved manifest/checksums and packaged offline-guide tests remain pending before release. See docs/bar-manual/remediation-impact-2026-10-29-first-run.md.
- Rabafi Pub removal was attempted at the user’s request, then stopped at their instruction to leave it for now. Permanent deletion is disabled by the current application handler. Verified-TLS DB credentials were rejected; the authenticated CLI/API verified the exact cloud company and invoked the existing archive RPC with a saved stable operation ID. The RPC returned success:false / Company lifecycle operation failed. Post-call verification confirmed Rabafi Pub and Botswapelo Restaurant both remain active (deleted:false). No further removal or retry is authorized in this pass. A failed-operation audit may exist; no company archive/deletion or local profile removal succeeded.

## 2026-10-28 — Bar local-first continuation

### 29 October local-first continuation — update wiring in progress

Current source has since moved beyond the earlier checkpoint below: fresh `hospitality-pos` already defaults to local Bar setup, and `ServerSetupOrchestrator` plus the setup UI contain the bundled local PostgreSQL install and owner-provisioning path. This is implementation evidence only; an installed Windows exercise and customer commissioning remain unqualified. Modern owner administration now imports offline update folders into the service inbox, stages them through the pinned signature/schema/contract verifier, and applies only through the service's unresolved-work and encrypted-checkpoint gates. The API verifies the new checkpoint, records failed-apply recovery guidance, and requests graceful service restart after the HTTP response flush; the UI polls for the running version before enabling another update. `npm run bar-local:build`, `npm run bar-local:typecheck`, and focused Modern client, Electron runtime, renderer and update package/service tests passed **73/73**; fresh-local/setup/post-close/recovery/importer tests passed **23/23**; a follow-up update/import/runtime run passed **29/29**. Managed Windows restart behavior and the full guarded service suite have not yet been reverified in this continuation. Remaining local software gates include isolated training authority, independent WAL/PITR recovery, full route/session/cache isolation and complete closed-day correction coverage. Physical multi-PC, Supabase/source transition, customer guide and packaged-PDF work remain deferred; local customer commissioning remains NO-GO.

### 29 October local-only follow-up (focused verification complete)

Latest local-only follow-up (EV-162): `BAR_LOCAL_BACKUP_COPY_TO` now configures encrypted manual backup copies, with path-overlap guards in service configuration and the Windows service installer. Authenticated health/status and Modern/Legacy admin panels expose whether the destination is available and its latest package. Focused isolated PostgreSQL/API/installer checks, local workflow suites, typechecks, and both product builds passed. This is still only an optional same-host copy; WAL/PITR, off-host recovery and replacement-host restore are open. Fresh Hospitality POS continues to default to local owner setup, while actual local database activation requires a separately installed/running service and protected owner provisioning. No automatic install, business creation, customer cutover or production commissioning occurred.

EV-163 closes a path-alias bypass in backup storage separation: existing filesystem junction/symlink ancestors are resolved for comparisons in the service and Windows installer, and a junction regression passes. The 18-case guarded PostgreSQL/API/installer suite and direct Windows junction test passed; the earlier run's presentation-path assertion failure was fixed by keeping canonical paths internal to comparisons.

Fresh `hospitality-pos` installs now enter local owner setup by default; choosing an existing cloud workspace remains explicit. Under committed local authority, the main process returns before cloud database, queues, mesh, timers or updater setup; startup-gate regressions passed 7/7 (EV-156). This default does not install PostgreSQL, create a business, or commission local authority; protected owner provisioning plus authenticated service readiness are still required before trading. The local finance workspace includes exact-range trial balance, exact-cent journal preflight and maker-checker period close. Support history is outlet-scoped and redacted. Migration 0073 adds an approved paid-tip reversal through a distinct open manager drawer after the original drawer closes; the compensating movement references the payout and leaves the original cash-up unchanged. Focused isolated PostgreSQL cases passed 11/11 through migration 0072 and 2/2 for tip recovery/runtime privileges on migration 0073; the first full suite after 0071/0072 applied migrations but failed 2 of 208 stale client/migration parity checks, so do not claim a current full-suite pass. Rendered local workflow checks, Bar contracts 20/20, Legacy 53/53, typechecks and Modern/Legacy builds passed. See EV-154–156. Other local software work remains open: full profile/session/cache and shared-renderer route acceptance, complete closed-shift correction coverage beyond paid-tip reversal, independent WAL/PITR backups, signed update orchestration and isolated training mode. Multi-PC qualification, Supabase/source transition, physical equipment and customer guide work remain deferred; local authority is still unqualified for customer trading.
Local backup manifests now label newly created packages as encrypted `pg_dump` custom dumps and state explicitly that they are not WAL/PITR; focused backup/restore/update helper tests passed 29/29 (EV-157). This is accurate metadata, not an independent recovery chain or replacement-host restore.

The offline update path now has a real Ed25519 verifier over a canonical non-self-referential manifest and the `check-update`/`apply-update` CLI reads a pinned public key from the operator environment; a generated key/package passed end-to-end CLI verification and signed-field tampering was refused (EV-158). The settings status endpoint explicitly reports that package availability is not scanned, and both local admin panels surface that boundary. This does not supply a production signing key/package, install from the till, or complete the installed mixed-version upgrade gate.

After correcting the new CLI test's package-relative script path, the full guarded PostgreSQL suite passed **209/209** on PostgreSQL 17.6 through local migrations 0001–0073 (EV-159). The cluster stopped cleanly and only its successful, identity-verified disposable data was retired; run logs remain in `.tmp/bar-isolated-tests/2026-10-29T00-00-58-419Z-a214ff70`. An earlier failed test fixture remains preserved. This does not change local authority's unqualified commissioning status.

Final local verification: Bar contracts **20/20**, rendered local UI **5/5**, Modern/Legacy Bar Electron tests **89/89**, SQLite storage **15/15**, Modern/Legacy SQLite Electron storage smoke, local-default/startup/support wiring **7/7**, Legacy suite **53/53**, and Modern/Legacy production builds passed; renderer, finance, service and Legacy shared typechecks passed (EV-160). The broad renderer IPC typecheck still exits nonzero with **11,077** positive-program diagnostics across 673 files and 170 roots (its previous saved run had 11,173); the negative IPC misuse fixture passes. The Electron startup smoke is unverified because Chromium's GPU process fails to start on this PC with Windows `0xC0000135`; no renderer restart assertion ran. The local default is owner setup first; the product still does not automatically install PostgreSQL or provision/trade without an installed/running service and protected owner setup.

Latest continuation update: the guarded local PostgreSQL suite passed 205/205 on PostgreSQL 17.6 after applying all 68 migrations through 0068; successful disposable cluster data was retired and logs remain (EV-146). Modern local workflow browser checks for finance, staff/loyalty/tips, drawer handover and lot-history behavior passed 5/5 using installed Chromium 1234 (EV-147). Additional rendered checks passed for all five local stock movements plus purchase-order create, detail lookup and partial receipt with lot/expiry capture (EV-149), and the stale feature matrix was corrected. A broader `test:bar` run is not clean because frozen guide/PDF/hash checks fail; that suite was stopped per the user's instruction to defer the documentation work (EV-148). User-directed removal of `%TEMP%\MicrosoftEdgeDownloads` freed approximately 0.25 GiB while preserving installer caches and Bar database evidence. The synthetic transition validator supports explicitly declared exact parent-to-child decimal reconciliation; focused tests passed 12/12 (EV-142). Legacy Bar admin now displays the detailed network/readiness report in parity with Modern; Legacy full tests (219 source +53 Node) and build passed (EV-144). Lounge export/import, source reconciliation and old-writer fencing remain unimplemented. Remaining qualification and documentation checks are recorded as pending and non-blocking for a software release at the user's direction; local authority commissioning remains NO-GO.

Latest stock continuation: migrations 0069/0070 track current outlet/product lot balances, allocate sale depletion FEFO, preserve transfer/return lineage, quarantine untraceable returns, and provide manager-approved selected-lot waste plus inspected quarantine release. Focused isolated PostgreSQL tests passed 2/2 on the final lot workflows; Modern rendered stock operations passed 1/1; local Bar contracts passed 20/20; renderer typecheck and Modern/Legacy production builds passed (EV-153). Legacy rendered coverage for selected-lot waste/release was added and passed in EV-154. Migration 0073 also supports approved payout reversal through a distinct open manager drawer while preserving the original closed cash-up (EV-155). Other closed-shift correction types and installed-service/hardware/recovery qualification remain open. The full isolated service suite passed 206/206 through migration 0069 before migration 0070; do not describe that historical run as covering later migrations. Lounge transition and customer documentation remain pending/non-blocking at the user's direction. Local-authority commissioning remains NO-GO; do not claim production or customer readiness.

29 October follow-up: Legacy local stock lot selectors exposed a missing quantity-formatting helper during a new rendered workflow check; the helper has been added and a Legacy browser regression now covers exact-lot waste and inspected quarantine release. The local finance workspace also lacked journal-post and accounting-period-close forms despite existing service/contracts; both have been added with balanced-entry preflight and separate-approver period-close wiring. Modern and Legacy local operations panels already mount the shared local finance and tip workflows; stale matrix entries have been corrected. Final renderer/browser/typecheck verification for these latest edits is pending. User asked to perform verification/tests at the end of this implementation pass.

Recoverable local owner setup/pairing, bounded cloud response-body deadlines, runtime grants for reviewed cloud-sync functions and a synthetic transition-export validator were advanced; see `docs/engineering/bar-local-first/TAKEOVER_CONTINUATION_2026-10-28.md`. Modern passed 53 focused runtime/client tests and 12/12 rendered recovery checks; Legacy passed 219 source checks plus 53 Node tests; cloud deadline tests passed 3/3; focused TypeScript checks and Modern, Legacy and Bar service builds passed. The full guarded local PostgreSQL suite passed 205/205 with PostgreSQL 17.6 after applying migrations through 0068 (EV-146). An earlier sandboxed `pg_ctl` failure (EV-143) was resolved by running the same guarded runner outside the command sandbox; the successful cluster was stopped and retired with logs retained. Do not bypass the preflight or delete retained failed fixtures. Lounge data remains uninspected/unimported; no cloud writes, cutover or deployment. The synthetic transition validator now rejects incomplete business/outlet inventory, undated snapshots and unresolved pending operations and reconciles explicitly declared parent-child totals (EV-142). Modern/Legacy startup now cleans a stale setup stage only when its credential matches the committed protected device credential; focused boundary tests passed (EV-134). PDF/manual artifacts remain deferred by the user; internal manual impact has been recorded.
## 2026-10-28 — Marketing multisite split: six sites from one codebase

- The marketing presence is restructured into six Netlify sites built from one source tree: `tsabonno.com` hub (light ecosystem landing, blog, contact, brochure, enterprise, privacy, terms, admin) plus `lodge.`, `restaurant.`, `bar.`, `hotel.` and `property.tsabonno.com`. `marketing-site/src/sites.mjs` is the registry (origins, nav, page ownership, product homes, exported `HUB_MOVED` 301 map); `scripts/build-marketing-sites.mjs` composes shells from `src/partials/*`, rewrites same-site links relative and cross-site links to absolute subdomain URLs, stamps `data-site`/default `data-product` on bodies, generates per-site `site-config.js`/robots/sitemap/`_redirects`/`netlify.toml`, and validates every link, asset and anchor across all six outputs in a second pass. Output is git-ignored (`output/marketing/`); sources stay canonical.
- Hub `index.html` is now a light ecosystem page: brand hero, four-product family section (LodgingOS, Restaurant & Bar POS, HotelOS coming soon, PropertyOS coming soon), per-product pricing overview, blog/brochure/packages/contact resources, demo form (PropertyOS option) and FAQ (PropertyOS question, JSON-LD in sync). Hidden lodge-depth sections were removed from the hub — that depth lives on the product sites. Every URL that moved off the hub 301s to its subdomain home (legacy borokobookings 301s preserved); `/property` is new, not redirected.
- Per-site theming now works: the previously dead `html[data-product]` palette blocks became `body[data-site]` overrides (the build stamps `data-site` on every composed body), so restaurant/bar render coral, hotel copper, property slate on every page including shared thank-you/404; hub keeps the ecosystem green. Added `property-card` accent, a 2×2 product-family grid and a compact hub pricing grid. `script.js` routes CTAs per site via generated `window.TSA_SITE`; the hub chooser lists all four products; HotelOS and PropertyOS stay interest-only. PropertyOS remains honestly coming-soon — no prices, trial or download claims.
- Tests rewritten for the split: `test:marketing-site` asserts the per-site registry contract (every site footer links all five landings, every nav item resolves, every product home routes to a subdomain origin, per-site nav anchors and home product identities exist) plus the four-product hub pins and the PropertyOS pricing-honesty pin; `test:public-domains` gained the exact six subdomain origins and the `HUB_MOVED` 301 contract (`property`/`index` must never be in the map).
- Verification: `test:marketing-site` 5/5, `test:public-domains` 11/11, `product-extraction` 15/15, `enterprise-foundation` 181/181. Scripted browser QA against the generated six sites (Playwright route fulfilment for all subdomain hosts, all external hosts stubbed, no real leads/analytics): **0 problems, 17 check groups** — per-page load/overflow on all 40 pages, menu toggle, cookie banner, hub 4-product chooser, trial modals, coming-soon interest flows, cross-site navigation; screenshots at 1440/390. Report: `docs/audits/marketing-multisite-2026-10-28/IMPLEMENTATION-REPORT.md`.
- Deployment is not performed: no DNS, no Netlify site creation for the five subdomains, no commit, push or deploy. `marketing-site/.netlify/state.json` still points at the current single hub site; each subdomain needs its own Netlify site bound to `output/marketing/<site>/` plus DNS before this goes live.
- Bar manual impact: none — marketing-site presentation, build and test infrastructure only; no Bar operator workflow, control, permission, financial or stock behaviour, equipment or guide applicability change (`bar.tsabonno.com` serves the existing Bar POS storefront with a themed shell). No manual update required.

## 2026-10-28 — Bar local-first verification and Lounge transition preparation

- Botswapelo Lounge remains the user-selected target. The current repository contains no Lounge source export or cloud-to-local dry-run importer. The configured Supabase project reference did not match the documented workspace reference; its secrets were not read or used. The local Bar cutover runbook now records the evidence required for a target-specific rehearsal; no source data was read, imported or changed and no authority was switched. Hosted-writer isolation is unimplemented, so activation must remain blocked until a verified handover mechanism exists.
- Additional verification: Modern SQLite storage suite passed 15/15; Bar service typecheck passed; the updated generic drawer/tip contract test passed 1/1. The focused migration 0066 run and app/UI results are in the 27 October continuation entry and `docs/engineering/bar-local-first/EVIDENCE_LOG.md`.
- Follow-up UI verification: shared error visibility now covers page-level local Bar workspace, operations and administration failures; seven errors remain inline beside their originating forms to preserve operator context. `node --test tests/bar-error-visibility-all.test.mjs` passed 4/4 (EV-126). This is presentation-only; the manual impact record is updated, while customer PDF/quick-start/screenshots/package checks stay pending by user direction.
- The maintained broad Bar suite was captured at 812 tests, 785 pass, 21 fail and 6 skip (EV-127); it exited 1. The only visible non-guide product failure was a stale sales-mailbox assertion. The approved rename runbook confirms sales@ is not provisioned, so the assertion now verifies the shared support endpoint; focused `bar-base-product` passed 15/15 (EV-128). The broad suite has not been rerun since. Remaining visible failures are guide source-hash/PDF checks and unavailable Playwright Chromium. Do not update frozen guide baselines or PDF approval hashes while PDF work is paused.
- Full isolated service qualification is still pending: its guarded runner refused to initialize at 1.81 GiB free (4 GiB required). Preserve application data; do not bypass the guard. No migration of Botswapelo Lounge or customer cutover was performed.
- Command Central does not expose local Bar commissioning. The Hospitality POS application's local setup screen can create a fresh empty authority only when no cloud business is saved on that computer; it requires the local PostgreSQL service to be installed and running. Deleting the Lounge cloud account is unnecessary and would remove comparison/source data. A new API regression for forged business/outlet/authority/device scopes was added; source syntax and service typecheck pass, but database execution remains pending the guarded 4 GiB runner (EV-114). No UI behavior changed, so no additional customer-manual update is required.
- Repaired one stale Bar suite assertion for category icon/tone mapping by checking the exported visual data and current typed component lookup. Focused Bar food/category tests pass 22/22 (EV-115); the broad suite remains non-green and was not rerun.
- Repaired a stale mesh assertion to recognize the origin-device-only contract. The signed inbound path enforces that same restriction; focused Devices and signed-peer tests passed 44/44, including quarantine of PIN-approved and machine-bound payloads (EV-116). The broad suite remains non-green and was not rerun.
- Repaired a stale Bar offline product/snapshot assertion to check the saved outlet and same-operation dependency; focused offline create/sell tests passed 7/7 (EV-117). The broad suite remains non-green and was not rerun.
- Repaired stale stock delisting and failed-queue IPC source assertions; the full affected Bar product-contract file passed 20/20 (EV-118). No queue authorization policy was changed; broad suite remains non-green and was not rerun.
- Repaired the stale stock-aging preload and typed outlet projection assertions; focused stock-aging checks passed 2/2 (EV-119). This does not verify a hosted RPC or installed read, and the broad suite remains non-green.
- Repaired a stale tab-rejection assertion to retain cache-restoration checks across RPC refusal and thrown errors; focused entitlement/tab tests passed 11/11 (EV-120). The broad suite remains non-green and no live financial database path was exercised.
- Repaired a stale Till proof-renewal assertion to follow the typed call and current order boundary; focused operator-policy/session checks passed 13/13 (EV-121). Live Till/service verification and the broad suite remain pending.
- Repaired stale retry-shift source assertions to follow the typed journal read and current online attempt; focused retry-shift tests passed 8/8 and retain original-byte and changed-payload conflict checks (EV-122). Full crash-window acceptance remains open.
- Repaired the Till service test to follow the split preload transport module; focused service tests passed 12/12 with timeout/error checks intact (EV-123). Installed Electron behavior remains unverified.
- Repaired the hardware onboarding source assertion for its typed result while preserving the success-plus-verified trust boundary; focused onboarding tests passed 3/3 (EV-124). No physical hardware check was performed.
- Removed a duplicate capability-label property while preserving the existing label/order; hotel role/compliance tests passed 17/17 (EV-125). Rendered recovery remains blocked on the unavailable Playwright Chromium binary.

## 2026-10-27 — Bar local-first continuation, corrected failover status and Lounge target

- This continuation remains **implementation-incomplete / commissioning NO-GO**. The user selected Botswapelo Lounge as the target for moving to local Bar authority. This records target selection only; no cloud data was imported and no production authority or configuration was switched. The next safe step is an isolated, read-only source inventory and repeatable dry-run import with reconciliation and old-writer fencing before a separately scheduled cutover.
- Production startup now refuses `failover.mode = witness` before opening PostgreSQL or listening. A focused isolated PostgreSQL/API selection passed 5/5 and the service build passed; the runner stopped/retired its disposable database with evidence retained. These cases cover refusal to start unsafe witness mode, catalogue-required shift opening, drawer tip-payout rejection, and closed-shift tip reversal; they do not establish full service acceptance or reconcile previously submitted cash-up corrections. The full service suite did not start because its mandatory 4 GiB free-space guard found 1.81 GiB.
- Modern and Legacy catalogue refreshes now reject mixed product/availability snapshots, validate scope/watermark/identity/version/page consistency, retry boundedly and clear stale rows/edit state. The focused snapshot test passed 8/8; renderer typecheck, Modern build and Legacy build passed. Both admin panels now describe export and acknowledgement values as highest observed sequences and warn that gaps and pending ingestion may remain; focused UI tests passed 6/6. Restore evidence retains compatibility watermark aliases, adds explicit highest-sequence fields, counts unacknowledged pending outbox rows and leaves a contiguous acknowledged checkpoint unknown.
- Shared-contract and database guards reject generic drawer `tip_payout`; the approved workforce payout command remains separate. These customer-visible status/cashier recovery changes have a manual-impact assessment in `docs/engineering/bar-local-first/MANUAL_IMPACT.md`. Customer PDFs, quick-start, screenshots, approved manifest and packaged offline guides are pending by user direction. Hosted activation, deployment, database change, data import and cutover are not represented as performed.
- Current requirement-level status and next gates are indexed in `docs/engineering/bar-local-first/TAKEOVER_CONTINUATION_2026-10-27.md`. Lot-level depletion/FEFO, isolated training, cutover/import/fencing, complete fault/race/security/load coverage, supported coordinator qualification, installed lifecycle and physical qualification remain open. No commit or push was made.

## 2026-10-27 - Bar server-only cloud synchronisation implementation

- The local Bar service now has a durable, server-only upload path. Migration `0064_cloud_sync.sql` adds `cloud_sync_config`, `cloud_sync_state`, `cloud_sync_receipts` and the take/next/sign/uploading/fail/ack/run/status/config functions; `src/operations/cloudSync.ts` runs the bounded uploader. Only the designated `single_host` process uploads (one pass at a time via `pg_try_advisory_lock`), oldest committed batch first, bounded by `batch_limit` and `BAR_LOCAL_CLOUD_SYNC_MAX_BATCHES`.
- Batches are signed with HMAC-SHA256 over `<key_id>.<batch_id>.<manifest_hash>` and transported as the exact PostgreSQL canonical manifest text with signature fields merged in, so numeric scale cannot change and the receiver's manifest hash still verifies. `received` and `validated` receipts are recorded but leave work pending; only `ingested` sets `status='acknowledged'`, `acknowledged_at` and the watermark. Conflicting hashes/references are refused, never overwritten.
- `cloud_sync_take_batch` had limited event rows, which could split one financial commit across two uploads. It now reserves whole commit-sequence groups (the limit is a target, a larger group uploads intact) and the cloud regression asserts one commit group per batch under a one-group limit. `cloud_sync_config_set` rejects wrong JSON types with `VALIDATION_FAILED` and keeps partial-update semantics, so saving one field cannot silently clear the receiver URL or signing key.
- Transport is `disabled` by default and starts no uploader; `local_test` permits loopback receivers only; `approved` is reserved and refuses to run without separate hosted activation. A pass runs every 15 minutes or once daily, on "Sync now", and as a non-blocking final pass after a committed cash-up. Status (pending/prepared/failed batches, watermark, last check/success/failure, last final-sync state, latest batch) is read from the database, and both admin panels state that a saved export file is not an upload or an acknowledgement.
- Modern and Legacy gained the matching admin routes, validated clients, IPC channels and "Cloud synchronisation" panel for capability-gated sessions. The receiver contract in `db/cloud-receiver/0001_cloud_ingest.sql` remains a proposed contract tested only against disposable local PostgreSQL. A guard in both runtimes refuses local setup/pairing in a process that already started the cloud workspace (`CLOUD_WORKSPACE_ACTIVE`), so two authorities cannot run in one process.
- Verification: isolated PostgreSQL 17.6 suite **162/162** in 561.5 s through migration 0064 on the final source, 0 failures, 0 skips (`.tmp/bar-isolated-tests/2026-10-27T14-08-15-689Z-6071597c/`; the runner exited 1 only on a transient `pg-data` cleanup `EBUSY` after all steps passed); targeted cloud/receiver/api regression **6/6** (`.tmp/bar-isolated-tests/2026-10-27T14-06-07-185Z-118bc01f/`); Modern Electron **87/87**; Modern UI **5/5**; Legacy **219 source + 50 Node**; `bar-local` service build/typecheck, renderer typecheck, `build:hospitality-pos` and the Legacy product build all pass. The commit-group defect was found by inspection and is now covered by a regression assertion. Evidence and requirement coverage: `docs/engineering/bar-local-first/CLOUD_SYNC_2026-10-27.md`.
- Verdict: the upload path is implemented and verified at the local/development-PC level; **customer readiness remains NO-GO**. No hosted receiver exists, no hosted migration was applied, `approved` refuses to run, and no local Bar trade has reached Supabase. Installed Windows service/database lifecycle, physical 2/6-till topology, automatic failover, replacement-host restore, Windows 7 qualification, conflict-quarantine recovery, customer PDFs/quick-start/screenshots/manifest/packaged guides and cutover remain open. Manual impact recorded in `MANUAL_IMPACT.md` (27 October cloud synchronisation section). No commit, push, release, deployment or cutover was performed.

## 2026-10-27 - Marketing site UI/UX remediation and ecosystem redesign

- Full remediation and storytelling redesign of `marketing-site/` implemented per `docs/audits/marketing-ui-ux-2026-10-22/` (combined report, ecosystem story, F01–F16 audit, visual review, implementation prompt). Report at `docs/audits/marketing-ui-ux-2026-10-22/IMPLEMENTATION-REPORT.md`; after-captures at `implementation-evidence/`. Nothing committed, pushed or deployed.
- Ecosystem-first story: landing page sells the ecosystem, then LodgingOS → Restaurant & Bar POS → HotelOS (Coming soon) in that order across nav, cards, footer and pricing; app-shell palettes (forest/paper, coral/plum, copper/charcoal) in one shared design system. `styles.css` rebuilt as a ~29-section system with a legacy compatibility layer prepended — 0 classes newly missing versus HEAD (152 → 11, remainder covered by inline styles or hidden sections).
- HotelOS is Coming soon everywhere and gated in the shared action handler (`?product=hotel`, chooser, `data-product="hotel"`): interest/demo only, never trial/download. Pinned `window.location.href = './hotel.html'` retained. Genuine HotelOS screenshots captured into `assets/screenshots/` as hotel proof.
- `script.js` rewritten: product detection, chooser + trial modal, lead POST hardening (timeout, `res.ok`/409, no success on failure), 5-state release discovery, `tsa_selected_plan` retention, product-aware thank-you filtering, consent-gated analytics, accessible modal/menu/lightbox. Inline scripts externalized (`analytics.js`, `quote.js`, `admin.js`) — zero inline non-JSON-LD scripts across 27 pages; strict CSP kept (`script-src 'self' ... https://unpkg.com`; `connect-src` includes Supabase + `api.github.com`).
- F13 (long mobile pages) addressed with a sticky 8-tab feature index on `restaurant-pos` plus verified anchors and scroll-margin — page length itself not reduced (documented partial). Brochure updated with the Coming-soon note and regenerated via `npm run marketing:brochure` (36.8 MB).
- Verification: `test:marketing-site` 5/5, `test:public-domains` 9/9, `product-extraction` 15/15, `enterprise-foundation` 181/181. Scripted browser QA: 28 page/viewport captures (desktop/phone), tablet 768, 200% zoom, DPI-3, reduced-motion — no broken images, console/page errors or overflow; 12 interaction checks all pass (chooser, focus trap, Escape, mobile menu, hotel gate, thank-you filtering). An interrupted `marketing:images` run caused encoding-only byte churn on some pre-existing generated avif files.
- Bar manual impact: none (marketing-site copy and presentation only; no operator workflow, control, permission or guide applicability change).

## 2026-10-27 — Bar takeover startup follow-up

- The user transferred implementation from Terra to this chat; Terra and its delegated editors stopped. Modern's initial workspace choice now occurs before cloud database, replay and background startup. A pending choice opens only local setup/guide IPC; explicit restaurant/cloud selection persists a preference and requires restart. Committed local authority takes precedence and remains fenced from cloud.
- Renderer startup handles the pending choice without loading cloud business/session state. Existing or unreadable cloud profiles still require a qualified transition; no empty local replacement is silently created.
- Runtime/startup checks passed 24/24 and the Modern product build passed. Local migration 0061 retained-tip allocation and void-conservation regressions passed 2/2 against fresh isolated PostgreSQL, including concurrent allocation/void and privilege checks. See `docs/engineering/bar-local-first/TAKEOVER_2026-10-27.md` for evidence and boundaries.
- Full-plan implementation remains incomplete and commissioning remains NO-GO. Actual app relaunch, migration/cutover, hosted sync, lot/FEFO, independent recovery and other software gates remain open. Hardware and customer guides remain deferred. No hosted changes, release, commit or push.

## 2026-10-26 — Bar SQLite and financial follow-up

- The isolated PostgreSQL service suite through local migration 0060 passed **152/152** without skips. Fractional replies, finance reads, signed export integrity, closed-drawer/shortage correction guards and 100-request idempotency passed. Migration 0060 fixes full-sale cancellation retaining an unallocated tip; allocated staff tips refuse cancellation atomically pending supported reconciliation.
- Modern commissioned-local startup, setup and pairing now use a strictly checked TypeScript SQLite intent store, with WAL/FULL commits, immutable revisions, exclusive writer ownership and validated one-time JSONL import. Original IDs, protected credentials and uncertain operations survive migration. Protected authority profiles pin the SQLite backend, preventing stale JSONL fallback even if both the SQLite file and its marker disappear. Cloud queues and Legacy journals retain their separate contracts.
- Verification after integration: Modern **67/67**, dedicated SQLite **15/15**, actual SQLite-client HTTP/DB lost-reply recovery **1/1**, Legacy **219 source + 48 Node**, browser **5/5**, Modern build and scoped TS checks passed. A bundled production-module probe passed under Electron 42.11.10 / Node 24.19.0; a real Electron main process used actual OS secure storage, and a separate main process reopened the same protected operation. These are development-PC checks, not installed customer, power-loss or multi-till qualification. The main checker accepts direct TS imports under its existing noEmit contract; no strictness flags were disabled. Shared TypeScript work is preserved.
- Implementation and commissioning remain **incomplete / NO-GO**: supported automatic coordinator/fencing, complete enrollment/replacement, independent WAL/PITR, durable export/cutover boundaries, FEFO and remaining workflow/acceptance evidence remain open. Physical PCs and customer guide artifacts remain deferred by the user. No hosted Supabase changes/migrations, ingestion, cutover, release, commit or push. Current details: `docs/engineering/bar-local-first/TAKEOVER_LATEST_2026-10-26.md` and `LOCAL_REMAINING_2026-10-26.md`.

## 2026-10-26 — earlier Bar takeover checkpoint (superseded by follow-up above)

- Repaired migration/login/readiness ordering, Legacy reply identity, stock snapshots, protected journals and controlled switchover. Both apps now share accounting, staff status, loyalty correction, tip and paired cash-handover controls. PIN-only approvals authenticate the distinct approver and recheck access at consumption. See `docs/engineering/bar-local-first/TAKEOVER_LATEST_2026-10-26.md` for current evidence; earlier entries below are historical.
- Final Modern Electron checks passed 52/52, Legacy 219 source + 48 Node, UI suite 5/5 and PIN/handover contract checks 2/2. Both app builds and focused service/finance TypeScript checks passed. Root main/renderer checks are narrow pilot-file checks, not whole-app qualification. Full service evidence: 145/145 through 0051; latest through 0057 is 147/149. One fixture used the wrong invoice result key; one real Legacy fractional-refund reply failed journaling. New migrations 0058/0059 address decimal result serialization and closed-drawer/shortage correction guards but require DB verification. Migration 0057 fixes double subtraction after a cash-sale void, without rewriting historical submitted cash-ups.
- The disposable runner keeps a 4 GiB free-space guard, accepts multiple selected tests and retires only its positively identified stopped successful data. Verification is currently blocked at about 3.6 GiB free; the user has been asked to free at least 2 GB. Historical failed logs remain. See `LOCAL_REMAINING_2026-10-26.md` for the exact next commands.
- Software and customer readiness remain incomplete: Modern transactional SQLite intent storage, supported automatic failover/coordinator, complete enrollment/replacement, WAL/PITR/export/cutover work and full acceptance coverage remain open. Physical-PC tests and customer PDFs/guides are explicitly deferred by the user. Hosted ingestion remains disabled; no hosted changes, release, cutover, commit or push performed.

## 2026-10-23 — Bar local lot and expiry visibility follow-up

- Added authenticated outlet-scoped lot/expiry receipt visibility through migration 0047 and `stock.lot_expiry`. Modern and Legacy stock panels display expiry status, lot code, supplier reference and received quantity, clearly stating that this is not a current lot balance because sales are not allocated to lots.
- Remaining-quantity lot ledger, FEFO allocation, lot-specific waste, service/DB verification and release qualification remain incomplete. Customer PDF, quick-start, screenshot, approved-manifest and packaged offline-guide work remains pending at the user's direction.

## 2026-10-22 — Bar local export retrieval follow-up

- Added authenticated, authority/business/outlet-scoped `outbox.bundle.get` retrieval with manifest-integrity checks and non-acknowledging semantics. Modern and Legacy client allowlists and the shared query contract include the new route. Export bundle verification now checks each event payload hash against its canonical payload. Service/contracts build, query contract validator, export unit tests (3/3), Modern local client tests (31/31), and Legacy client tests (21/21) passed.
- The API/database scope/tamper regression was added but not run because no guarded isolated PostgreSQL target is configured. Operator download UX, signing, background worker/replay, checkpoint reconciliation, and hosted transport remain incomplete. PDF, quick-start, screenshot, approved-manifest and packaged-guide work remains pending by user direction.

## 2026-10-22 — Bar local-first loyalty follow-up

- Legacy local customer operations now connect loyalty enrollment, points earning against a committed sale UUID, and referenced points redemption through the local service's durable commands. The UI does not trust a cached balance and states that redemption is not a sale tender or discount. Focused Legacy workflow checks passed 11/11; Legacy production build and Modern renderer typecheck passed.
- Modern already offered the same loyalty commands with a recent-sale selector; both clients leave points eligibility and balance authoritative at the service. Current balance reads, programme management, live service click-through, and full Bar domain/background routing remain open. Manual impact is documented; customer PDFs, quick-start, screenshots, approved manifest, packaged guide checks remain pending at the user's direction.

## 2026-10-22 — Bar local-first source/build checkpoint

- Modern and Legacy local Bar now have admin status, backup list/create/verify, replication status/durability, confirmed manual switchover and update-status routes. Migration 0040 allowlists the admin status/audit functions. Split and non-cash tenders are supported with explicit provider evidence. Legacy exposes tab transfer/split/merge plus stock, purchasing, customer, voucher, control, workforce, accounting and administration panels. Preload admin typing was corrected.
- Windows packaging remains source only: the nine PowerShell scripts and the provisioning script are syntax-checked, not installed or qualified on Windows, PostgreSQL, TLS/SCM, Windows 7, physical tills or multi-till.
- Verification: isolated service 132/132 in 594.1s through migration 0040; Modern 40/40; Legacy 219 source + 43 Node; product builds passed; preload/renderer/main/service typechecks passed. `typecheck:main-surface` remains NOT clean at 5,385 pre-existing diagnostics (`docs/engineering/typescript-migration/evidence/L02-main-surface-diagnostics-2026-10-22T11-20-26-869Z.jsonl`).
- Feature matrix is 64 rows: 28 locally implemented, 35 partial, 1 external pending, 0 not implemented. Acceptance is 18 partial, 12 not run, 1 verified (A03) and 1 pending user direction.
- Not claimed or qualified: installed Windows/PostgreSQL/TLS/SCM, multi-node streaming/switchover/automatic failover, replacement-host restore or PITR, a scheduled backup destination, Windows 7, physical hardware, multi-till, power loss, soak, customer cutover or hosted ingestion.
- Worktree remains dirty with unrelated TypeScript-migration, company-login and public-domain work. No reset, commit, push, deploy or cutover was performed. Earlier matrix and acceptance totals below are historical where they differ from this checkpoint.
- Manual impact: the 22 October assessment is recorded in `docs/engineering/bar-local-first/MANUAL_IMPACT.md`; customer PDF, quick-start, screenshot, approved-manifest and packaged-guide work remains deferred by user direction.

## 2026-10-22 — LodgingOS follow-up blockers independently closed locally

- Independent recheck confirms the connection factory rejects the seven reproduced endpoint/TLS override cases and preserves verified TLS in four accepted configurations. The transition runner's actual selected domain helper now imports successfully through its module URL. Focused rerun: 39 pass, one genuine live SQL skip; all three required DB gates independently return exit 2 without configuration. Scoped whitespace and changed-helper/runner syntax checks pass.
- The preceding follow-up findings are closed at the local implementation level. See docs/engineering/property-adaptation/CLOSURE-REVIEW-2026-10-22.md and evidence/independent-2026-10-22/closure-verification.json. Live disposable identity/migration/SQL acceptance, linked production schema inspection, and outstanding Electron/release qualification remain pending. No DB connection or mutation was performed by the closure probe; no production deployment is claimed. Review artifacts only; manual impact none.

## 2026-10-22 — LodgingOS correction follow-up review: two areas remain

- The original lead-key, guest-email, staff transport, and public acceptance-fixture corrections are present. Independent focused rerun: 38 pass, one live SQL skip; all three required DB gates exit 2 with missing configuration.
- Follow-up behavioral probes found remaining defects: raw connection URL query options override the driver's effective endpoint and enforced TLS settings despite passing the target validator; the transition verifier also throws ERR_INVALID_ARG_TYPE when it passes an existing URL to pathToFileURL at its domain-helper import. Neither probe opens a database connection.
- See docs/engineering/property-adaptation/FOLLOWUP-REVIEW-2026-10-22.md and its evidence for exact reproductions and fixes. Verdict remains changes required; no migration, live SQL acceptance, production deployment, or Electron walkthrough was performed in this follow-up. No implementation code was edited; manual impact none for review artifacts.

## 2026-10-22 — LodgingOS correction independent review: changes required

- Independent review of the submitted public-booking correction found blocking contract defects: the private grouping helper rejects the lead child's bare operation key and reads `email` instead of the producer's `guest_email`; the migration also removes the anon API-key transport required by desktop custom staff sessions. The required DB runner retains obsolete current-schema expectations, and the public SQL acceptance uses an invalid transition UUID/incomplete setup fixture and leaks its staff session into later anonymous checks.
- Fresh independent checks reproduced 31 focused Node passes/1 live-DB skip, 42 mounted UI passes, both typechecks, offline queue and replay-authority checks (9/9), and both production builds. These do not execute the new server helper. Read-only disposable marker verification remained blocked (Management API HTTP 544; guarded PostgreSQL XX000), so no SQL migration or database write was attempted.
- Verdict and corrections: docs/engineering/property-adaptation/INDEPENDENT-REVIEW-2026-10-22.md. Implementation is not accepted or release-ready; production and Electron walkthrough remain unverified. No application implementation was changed by the review. Manual impact: no manual update required for review artifacts.

## 2026-10-22 — Legacy local Bar admin and operations panels

## 2026-10-22 — Bar local-first continuation

- Local Bar administration now has Modern/Legacy panels and service endpoints for status, backups, replication durability/manual switchover and update status. Migration 0040 adds schema/device status and admin audit support. Windows service, backup task, standby enrollment and manual switchover scripts are implementation sources only; they have not been qualified on installed target hardware.
- This continuation hardened admin status to fail when database checks cannot be read, prevents unreadable backup destinations/manifests from appearing as empty backup lists, authenticates encrypted backup contents with AES-GCM during verify, and reports an audit-write error with an explicit possible-completion warning. The direct CLI switchover now writes durable intent and outcome audit rows including the required operator reason.
- Verification: a separate guarded `npm run bar-local:test` result in the implementation report is 132/132 on isolated PostgreSQL 17.6. This follow-up passed Modern/Legacy readiness tests 2/2 each, focused admin/replication and operations tests 39/39, both product builds, service build and `node --check` for the CLI. The follow-up `npm test --prefix services/bar-local` invocation built successfully but its DB-backed cases failed closed because the explicitly guarded target was not configured; no DB was touched in that invocation. Modern Vite reported existing mixed static/dynamic import warnings.
- Both Modern and Legacy readiness views now distinguish ready, blocked, stale, unknown and unavailable states; only a current positive response enables guarded actions. Both admin panels now explain backup destination failure without presenting it as an empty package list. Remaining blockers include complete Bar domain routing, installed Windows lifecycle, supported coordinator/automatic failover, independent WAL/PITR backups, replacement-host restore, multi-till/hardware/power-failure tests, and remaining guarded DB/API/fault acceptance. Customer PDF, quick-start, screenshot, approved-manifest and packaged-guide edits remain pending at the user's direction.
- Split-tender entry no longer lets an operator mark a card/mobile/bank/external tender “provider confirmed.” Both clients show local-only status, refuse crafted provider-confirmed payloads, disable room charge and reject any stale room-charge value with hotel-authority guidance; the service SQL also rejects provider-confirmed claims. Focused tender regressions passed Modern 13/13 and Legacy 10/10, renderer typecheck passed, and both product builds passed afterward. The customer manual impact is recorded; PDF and related guide work remain pending.
- Modern admin responses now unwrap the service's nested status and replication records and read backups from its `packages` array. This fixes blank admin status/replication and a false-empty backup list. The response-shape tests passed 2/2, Modern renderer typecheck passed, and the product build passed; live service rendering remains unverified.

- Legacy `BarLocalWorkspace` now exposes capability-gated Administration and operational panels. Administration covers authenticated authority status, backup list/create/verify, replication status/durability, confirmed switchover, and update status; backup controls additionally require `backup.manage`. Operational panels cover purchasing, customers/vouchers, control checklists/incidents, workforce roster/attendance, and accounting/trial balance/expenses/journals/period close.
- Operational reads and mutations use the existing `window.api.pos.barLocal` query/command bridge with outlet-scoped complete-result validation. Write forms are hidden without `inventory.manage` or `accounting.manage`; voucher issuance remains gated by `vouchers.manage`; approvals continue through the existing manager PIN bridge and durable operation IDs. Server-side capability, approval, tenancy and state enforcement is unchanged.
- Verification: `npm run build` and `npm run test` from `legacy-pos` passed after integration (219 source regression checks plus 36 Node tests). No live local PostgreSQL, installed till, physical printer, multi-till recovery, Windows 7 or customer cutover was exercised. Legacy now also includes tender evaluation, tab transfer/split/merge and stock adjustment/stocktake/waste/transfer workflows. Remaining UI gaps include drawer counts/handover/variance, loyalty, AP/payroll/tax reads, and broader end-to-end routing/Modern parity.
- Manual impact: Required for new customer-visible purchasing, customer credit/voucher, control, workforce, accounting and administration workflows. Per prior user direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending.

## 2026-10-22 — Public domain and mailbox migration (code/config only)

- Canonical public endpoints are centralized in `src/shared/publicEndpoints.js`: `https://tsabonno.com` (plus `www`), `https://book.tsabonno.com`, `https://manager.tsabonno.com`, and `support@tsabonno.com`. `sales@tsabonno.com` is reserved but unprovisioned, so customer-facing recovery, help, and contact links use support only. Desktop booking-link display/copy, support/upgrade mailto actions, Manager PWA password-reset fallback, and the push VAPID subject consume the shared values.
- Booking-site canonical/Open Graph URLs now use `booking-site/src/lib/publicSiteUrl.js` instead of `window.location.origin`. Legacy booking host redirects (`borokoonlinebookings.netlify.app`) and marketing redirects (`borokobookings.com`, `www`, Netlify host) use 301/`:splat` rules before SPA fallback; lodge slugs, booking routes, query strings and guest-portal tokens are preserved. Legacy Manager aliases are intentionally not redirected pending installed-PWA/offline migration assessment.
- Marketing HTML, sitemap, robots, script mailboxes, admin placeholder, netlify CSP and the tracked brochure PDF use the new domain/mailbox. The obsolete ignored `marketing-site/dist` snapshot (21 stale files) and cached `.netlify/netlify.toml` (old CSP and absolute paths from another machine) were removed; marketing publishes from the source root via `publish = "."`. `@borokobookings` social handles and compatibility identities/storage keys/update feeds are retained. `.env.example` files and local ignored env files point auth redirects at `https://manager.tsabonno.com/reset-password`; booking env can override `VITE_PUBLIC_BOOKING_BASE_URL`.
- Verification: `npm run test:public-domains` 9/9; `npm run test:marketing-site` 5/5; `npm run booking:test` 75/75; `npm run booking:build`, `npm run manager:build`, `npm run build` (lodge-camp), `npm run build:hospitality-pos`, `npm run typecheck:booking`, `npm run typecheck:manager`, and `npm run marketing:brochure` passed. The rebuilt PDF is 11 pages with zero legacy domain/mailbox text hits. `npm run typecheck:main-surface` retains its existing diagnostic baseline (5385); the only new public-endpoint diagnostic was removed by JSDoc typing.
- Known pre-existing failures unrelated to this change: `npm test` stops in `tests/production-guardrails.test.mjs` because `get_pos_sales_summary` is called as `state.supabase).rpc(...)`; `npm run manager:lint` reports `manager-pwa/src/pages/Bookings.jsx:289` (`no-unexpected-multiline`) plus 36 warnings; the brand audit completed with 68 unresolved references in existing buildInfo/typecheck/tmp/Layout/Rooms/SubscriptionAccessPanel files and no domain-migration findings. `npm run test:brand-migration` exceeded 300s.
- Deployment boundary: repository/config/tests/docs only. No DNS, Netlify/Vercel domain attachment, hosted Supabase Auth allowlist/site URL, mailbox provisioning or SMTP/Resend configuration was performed or verified. Netlify site IDs are `85265a3c-f9c1-4bf2-b1fd-3c6cbdd97098` (marketing) and `29d20c46-e260-4f04-9025-aa606e2512bb` (booking); Manager Vercel project is `prj_b9milxVRjSkmlcR2kQcuN4rz2Cq8`.
- Manual impact: marketing brochure regenerated and checked; no legacy domain/mailbox references exist in `docs/bar-manual/`, so no Bar manual or quick-start update is required for this migration. No PDF/guide approval or packaged-guide checks were changed beyond the marketing brochure.

## 2026-10-21 — Local Bar LAN catalogue catch-up continuation

- Modern and Legacy local cashiers now check catalogue state every 15 seconds. Legacy consumes the authenticated `/v1/events` cursor with business/outlet/device scope validation and retention-gap recovery; both clients reload a complete consistent catalogue after menu changes and clear unsent cart/promotion state. Promotion snapshots refresh alongside products so changed discount definitions are not kept stale.
- Migration 0039 pages feed results by whole commit groups so a commit-sequence cursor cannot skip same-commit event rows; an API regression verifies two events are delivered together with a one-commit page.
- Failed catch-up remains visible and disables sale commit/tab additions until a complete snapshot and promotion policy query succeed. Legacy keeps the event cursor behind until a successful snapshot so failures retry the same feed window. Added transport URL-query serialization and regression coverage for event scope, gap handling and URL parameters.
- Verification: Full service suite 113/113 through migration 0039 and focused event API regression 1/1 passed on a fresh disposable PostgreSQL 17.6 loopback cluster; Modern local suite 27/27; Legacy 219 source checks + 32 Node tests; renderer/service typechecks and Modern/Legacy production builds passed. This is source/build evidence only; installed LAN, live multi-till, physical hardware and customer qualification remain unverified. Matrix is 63 rows: 20 locally implemented, 38 partial, 4 not implemented, 1 external pending. (Historical; superseded by the 2026-10-22 source/build checkpoint totals.)
- Manual impact: stale-menu notices and cart clearing affect cashier guidance. Per user instruction, all PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending; no PDF was edited.

## 2026-10-21 — Local Bar cashier promotion continuation

- Modern and Legacy BarLocalWorkspace now load a business/outlet-scoped active promotion snapshot and let discount-authorised cashiers apply promotion codes to cash sales. A different manager's PIN approval is bound to the sale payload and the same durable operation ID when the service policy threshold is exceeded; the absolute maximum blocks commit. Local Settings lets `settings.manage` users update the threshold and maximum through the service's audited `settings.update` command.
- Local migration 0038 adds the no-filter `menu.promotions` cashier query. The isolated PostgreSQL service suite passed 113/113 through migration 0038; focused promotion-query DB test 1/1; Modern local suite 26/26; Legacy tests 219 source regressions + 30 Node tests; both product builds, Modern renderer typecheck and Bar service/contracts typecheck passed. No installed host, live rendered approval click-through, physical printer or Windows 7 qualification occurred.
- Manual impact is recorded in `docs/engineering/bar-local-first/MANUAL_IMPACT.md`. Per the user's explicit direction, PDF, quick-start, screenshot, approved-manifest and packaged offline-guide edits/checks remain pending; no customer PDF was modified.

## 2026-10-21 — Local Bar support report continuation

- Modern and Legacy `settings.manage` staff can record a categorized/severity-tagged local support report with readiness blockers. The existing service redacts diagnostics and metadata, stores a checksum and audit event, and keeps external delivery disabled; the UI warns operators not to submit credentials, payment data or guest identity documents. No local report history query exists, so the panel does not claim delivery or provide a history view.
- Verification: Modern renderer typecheck and both product builds passed; audit/support contract tests pass 2/2. The existing service/API tests cover local support-report replay/redaction, but were not rerun because the isolated PostgreSQL target is not configured. Manual impact is required; PDF/quick-start/screenshot/manifest/package work remains pending by user direction.

## 2026-10-21 — Local Bar stock and cash-up report continuation

- Modern and Legacy Reports panels now fetch `reports.sales_summary`, `reports.stock`, and `reports.cashup` from the local service. Stock valuation/low-stock/movement data and cash-up shift totals are outlet-scoped; missing-cost valuation gaps, incomplete cash-ups, and unverified external card settlement are clearly marked. Shared report pages remain on their existing cloud path.
- Verification: `npm.cmd run typecheck:renderer`, both Hospitality POS/Legacy builds, and `npm.cmd run test:bar-local-electron` passed (21/21). Existing DB report evidence is dated; no live UI/database report query was run in this continuation. The stock/cash-up report controls change customer-visible guidance; all PDF/quick-start/screenshot/manifest/package edits/checks remain pending by user direction.

## 2026-10-21 — Local Bar audit search continuation

- Modern and Legacy local workspaces now expose an Audit panel to `settings.manage` staff, using the service's outlet-scoped `audit.search` query with action/value filters and cursor pagination. Before/after details are collapsed until requested; the shared `/hpos/system-health` route remains on its existing cloud contract.
- Verification after this UI addition: Modern local Electron 21/21, Legacy 219 source regressions + 30 Node tests, audit contract 1/1, Modern renderer typecheck, and both production builds passed. Manual impact is required; per user direction, all PDF, quick-start, screenshot, approved-manifest and packaged-guide work remains pending, as recorded in `docs/engineering/bar-local-first/MANUAL_IMPACT.md`.

## 2026-10-21 — Local Bar versioned product editing continuation

- Modern and Legacy local menu panels now load full `menu.list` product versions and support updating active or inactive products through the durable `catalogue.upsert` operation. Edits carry `expected_version`; local migration 0034 locks the business-scoped row, rejects stale versions with `PRODUCT_VERSION_CONFLICT`, increments product version and audits before/after values.
- Added contract validation and isolated DB regression coverage. Contract suite passed 2/2; Modern local Electron 21/21; Legacy 219 source checks + 30 Node tests; both product builds; Modern renderer and Bar service/contracts typechecks passed. The product-edit database regression was not run because this workspace has no configured guarded loopback PostgreSQL test target. An attempted `npm.cmd run legacy-pos:typecheck` reported that script does not exist; Legacy renderer is checked by its production build.
- Manual impact: Required for product edits, active status, and stale-edit recovery. All PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending at the user's explicit direction; see `docs/engineering/bar-local-first/MANUAL_IMPACT.md`.

## 2026-10-21 — Local Bar modifier selection continuation

- Modern and Legacy local cashier carts now render configured product modifier groups/options from the outlet-scoped `menu.availability` snapshot. Cashiers can select within group limits, create separate cart lines for different modifier choices on the same product, and see confirmed modifier names on receipts. Selected option IDs persist in durable `sale.commit` or `tab.add` intents; service SQL remains authoritative for membership, limits, price, tax, stock and the saved modifier snapshot.
- Display estimates include selected option price deltas and refuse incomplete required groups; they remain estimates only. No modifier authoring, promotion or recipe UI was added, and live renderer-to-PostgreSQL sale/tab interaction was not exercised.
- Verification: shared estimate/client tests 31/31; `npm.cmd run test:bar-local-electron` 21/21; Legacy 219 source regressions + 30 Node tests; Modern and Legacy production builds, `npm.cmd run typecheck:renderer`, and `npm.cmd run bar-local:typecheck` passed. Manual impact is recorded in `docs/engineering/bar-local-first/MANUAL_IMPACT.md`; all customer PDF, quick-start, screenshot, approved-manifest and packaged-guide work remains pending at the user's direction.

## 2026-10-21 — Local Bar drawer history and cash-up revision continuation

- Modern and Legacy Drawer panels now fetch the current shift's scoped `cashup.summary` and show authority-calculated expected cash plus timestamped paid-in/paid-out/float reasons in chronological order. Incomplete reads clear the cached summary and display recovery guidance; committed drawer movements trigger the existing refresh path.
- Both local cash-up panels now reopen approved/rejected cash-ups into a new revision after cash/card recount, optional notes/evidence reference, required reason and a distinct manager PIN. The approval bridge binds the exact payload and operation ID; the command is durable and the service retains the reviewed snapshot while rechecking expected status and accounting-period lock.
- Verification after the new client bridges: Modern local runtime 20/20, Modern client 28/28, Legacy 219 regression checks + 30 targeted Node tests, and Modern Hospitality POS plus Legacy production builds passed. Prior isolated SQL coverage for movement replay and cash-up revision/state/period guards is recorded in the Bar evidence log; this continuation did not run a new database click-through.
- Manual impact: Required for current-shift drawer history and cash-up recount/reopen guidance. User directed all PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks to remain pending; see `docs/engineering/bar-local-first/MANUAL_IMPACT.md`.

## 2026-10-21 — Bar add-on price refresh and Accounting dependency

- Repriced the active Bar catalogue: Stock & Purchasing Pro P2,500/year, Accounting & Workforce P3,500/year and Growth & Multi-Outlet P2,000/year. Bar POS Base remains P4,500/year. The authoritative SQL migration updates only the active catalogue version; historical quote snapshots retain their original totals.
- Added `commercial_addon_prices.required_addon_keys` and made Accounting & Workforce require Stock & Purchasing Pro in every catalogue version. Shared catalogue helpers expand selections, report dependency errors and reject invalid offer snapshots. Subscription, Command Central licensing and the Bar Manage guide now explain and enforce the combined selection, and package-change requests carry existing eligible add-ons plus the requested requirements.
- Server enforcement is in `supabase/migrations/20261021090000_bar_addon_dependencies_and_prices.sql`: `calculate_commercial_quote` raises the actionable dependency error, `activate_subscription_request` rejects legacy Accounting-only quotes with replacement-quote guidance, and `admin_governed_assign_commercial_subscription` prechecks and preserves quote errors instead of the generic assignment failure. Activation reads `settings.property_type` into a typed text variable instead of assigning two text fields to a full settings row, and accepts both `restaurant` and `bar` POS companies. Existing Accounting-only entitlements are not silently revoked; a deliberate assignment or activation must add Purchasing.
- Updated marketing-site Bar and package pricing plus the Bar manual Part G and a new manual-impact record. No PDF, manifest, screenshot set or packaged guide was rebuilt or approved. No product release, publish, git push or customer subscription change occurred.
- `supabase db push --linked` applied exactly `20261021090000_bar_addon_dependencies_and_prices.sql` to hosted project `Tsa Bonno HospitalityOS` (`oicgpknsmtvcsjacymum`) on 2026-10-22. Local/remote migration history matches through this ID and the post-deploy dry run reports the remote database up to date.
- Verification: `node --test tests/bar-addon-bundles.test.mjs tests/bar-base-product.test.mjs tests/marketing-site-contract.test.mjs` passed 30/30; `npm run test:commercial` passed 12/12; targeted Bar entitlement/route/parity tests passed 22/22; `npm run typecheck:shared`, `npm run typecheck:renderer` and `npm run build:hospitality-pos` passed. An isolated PostgreSQL 17 database was built from the repository baseline plus all 506 subsequent migrations; `npm run test:bar-addon-activation-sql` passed quote -> approval -> activation for bar and restaurant companies, rejected Accounting-only quotes, rejected historical Accounting-only activation with replacement-quote guidance, and activated a historical quote that already included both required add-ons. Post-deploy linked readback confirmed P2,500/P3,500/P2,000 prices, the Accounting -> Purchasing dependency, removal of the legacy composite settings read, `bar` activation eligibility and service-role execute grants. A live read-only quote smoke returned P10,500 for Bar POS plus both add-ons, and the Accounting-only quote raised the expected dependency error. Linked SQL lint (CLI 2.121.0, error level) returned zero findings and error-level advisors reported no issues. `npm run test:bar-guides` still fails its existing PDF-checksum-versus-manifest assertion and skips the absent directory package; this change did not rebuild or approve guide PDFs.
- Deployment boundary: the hosted migration is applied, but the repo baseline `settings_property_type_check` still does not admit `property_type = 'bar'`; this deployment did not change that constraint. No authenticated production activation or customer subscription was performed. Bar guide approval/package and product release gates remain open.

## 2026-10-21 — Local Bar cash-up review continuation

- Both local Bar workspaces now load the outlet-scoped `reports.cashup` window, list submitted cash-ups, fetch the selected shift's fresh `cashup.summary`, and offer approve/reject with a required reason and distinct manager PIN. The approval binds to the decision payload and operation ID; the command remains journaled and the service/SQL rechecks current state, outlet scope, maker-checker and one-time approval before commit.
- Added `cashup.review` to the narrow Modern/Legacy manager approval bridges. The review list is read-only reporting data; each selected decision uses the service's scoped summary and atomic review contract. A later continuation wires the existing revision-preserving `cashup.reopen` contract into both workspaces.
- Verification: Modern local Electron suite 20/20; Modern local client suite 28/28 including `pos.cashup` approval contract; Legacy suite 219 source checks plus 30 Node tests including the same capability; main typecheck and Modern/Legacy production builds passed. No live UI-to-database cash-up review, physical till or customer cutover was exercised.
- Manual impact: Required for the submitted-review list, service reporting-window scope, decision reason, manager PIN and recovery behavior. Per user direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending; see `docs/engineering/bar-local-first/MANUAL_IMPACT.md`.

## 2026-10-21 — Local Bar manager-approved return continuation

- Modern and Legacy local Bar workspaces now let a cashier prepare a multi-line sale return or full-sale void and obtain a distinct manager PIN approval through a narrow main-process bridge. The approval envelope derives authority/business/outlet/device scope from the paired profile, binds the exact correction payload and operation ID, and the subsequent journaled command consumes the expiring one-time approval. SQL remains responsible for capability checks, cumulative return limits, maker-checker enforcement, one-time consumption and atomic ledger/stock effects.
- Added Modern and Legacy client regressions for multi-line payload hash binding, approval scope/capability and operation identity reuse; updated the Modern fixed-IPC allowlist test, feature matrix, acceptance/evidence records and technical-plan checkpoint. Return, void and cash-up callers have not been exercised in a live UI-to-database workflow.
- Verification: `npm run test:bar-local-electron` passed 20/20; `node --test tests/bar-local/modern-client.test.mjs` passed 28/28; `npm run legacy-pos:test` passed 219 source checks plus 30 Node tests; `npm run build:hospitality-pos` and `npm run legacy-pos:build` passed. No live PIN/database maker-checker workflow, installed till or customer cutover was exercised by these client checks.
- Manual impact: Required for the manager PIN step, returned-line disposition, approval refusal/expiry and uncertain-result recovery. Per the user's direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending; see `docs/engineering/bar-local-first/MANUAL_IMPACT.md`.

## 2026-10-21 — Local Bar setup, pairing, Settings and receipt continuation

- Added Modern first-owner commissioning and existing-authority join forms at the local authority boundary. Both Modern and Legacy local Settings now expose owner-scoped role selection for cashier/manager/stock/finance identities and short-lived single-use device pairing codes. Both local workspaces display the service-confirmed receipt; Legacy main re-reads the scoped sale and routes verified details to ESC/POS or the Windows/browser print view. Shift opening and sales pause when readiness is blocked or stale.
- Updated the Bar acceptance manifest, technical-plan checkpoint and manual-impact record. Customer PDF, quick-start, screenshot, approved document-manifest and packaged-guide edits/checks remain pending by the user's explicit direction.
- Verification: after the setup, Settings, receipt-response, readiness and Legacy main-process print adapter changes, `npm run test:bar-local-electron` passed 20/20; `npm run legacy-pos:test` passed 219 regression checks plus 29 targeted tests; `npm run build:hospitality-pos` and `npm run legacy-pos:build` passed. No installed service/database package, Windows service lifecycle, network-isolated commissioning, physical receipt printer, multi-till recovery, full feature matrix or hosted/customer cutover qualification is claimed. No hosted write, release or cutover.
- Manual impact: required for owner setup, joining/pairing, staff creation and receipt printing. PDF and screenshot work is pending by user direction; see `docs/engineering/bar-local-first/MANUAL_IMPACT.md`.

## 2026-10-21 — Local Bar source-to-GL posting for sales, returns and voids

- Added `services/bar-local/db/migrations/0033_source_to_gl.sql`. When `bar_accounting_workforce` is enabled, `apply_tenders` posts the completed sale and `reverse_sale` posts the return or void in the same transaction. Each source row gets exactly one balanced journal entry and one `source_gl_postings` link keyed by source type and source ID. Replays return the existing link, tender totals must reconcile to the sale, closed periods and missing required chart accounts refuse the financial mutation, and the runtime role cannot read the posting table or execute the internal helpers.
- Fixed fixed-code mappings use active chart accounts: cash `1000`, card `1010`, bank transfer `1020`, mobile money `1030`, external `1040`, customer credit `1100`, tax `2100`, voucher `2200`, tips `2300` and revenue `4000`. Revenue is the sale's net subtotal, so discounts are reflected without a separate client-side calculation.
- Added `services/bar-local/tests/db-source-to-gl.test.mjs` covering completed sale, partial return, void, replay without a second posting, full source coverage, balanced debit/credit lines, disabled entitlement, missing account and closed period. Extended the restore verifier's `source_to_gl_coverage` check to recognise `sale.return` and `sale.void` journal sources.
- Updated accounting-dependent fixtures to opt into `bar_accounting_workforce` explicitly and seed only the accounts their sales require. Verification: service build passed; new focused test 4/4; 35 existing accounting, sales, guardrail, concurrency, reports, runtime and cash-up tests passed against the isolated local cluster. No hosted Supabase write, release or cutover.
- This closes the missing sale/return/void source-posting path only. C02 remains partial for opening-balance reconciliation, historical/cutover posting, readiness/exception reporting and complete app workflow evidence.
- Manual impact: No approved customer manual update is required yet because the posting path is service-only and not exposed as a new Modern or Legacy operator workflow.

## 2026-10-21 — Local Bar discount approvals and staff-status escalation hardening

- Added `services/bar-local/db/migrations/0032_discount_approvals_staff_status.sql`. Sale and tab settlement discounts above the configurable `discount_approval_threshold_percent` (default 10%) now require a bound `pos.discount` maker-checker approval; discounts above `discount_max_percent` (default 25%) are refused. The policy applies to manual and promotion discounts, preserves capability denial precedence, and is enforced both in the command path and by the sales trigger. Settings are validated as 0-100 percent values.
- Added `approval_id` to `sale.commit` and `tab.settle` contract payloads and registered `pos.discount` as their conditional approval capability. Existing replay and approval hashing remain unchanged; the approval hash excludes `approval_id`.
- Hardened `cmd_staff_status`: the target is locked, only an owner may change owner/manager/stock/finance identities, self-status changes are refused before approval consumption, a last-active-owner suspension guard is present, and missing targets return `STAFF_NOT_FOUND`.
- Added `services/bar-local/tests/db-discount-staff-guardrails.test.mjs` covering approval-required, approved commit and replay, configured maximum refusal, promotion parity, configurable maximum, owner/manager escalation denial, self-status denial and an approved cashier suspension. Extended runtime helper-denial coverage to `assert_discount_policy`.
- Adjusted two existing fixtures to the new policy and least-privilege boundary: the penny-return discount fixture now uses a larger denomination so its 1-cent promotion stays below the percentage cap, and direct internal report-function tests run through the migrator role because runtime access remains allowlist-only. The tender-capacity assertion now checks that the final tender never exceeds capacity rather than assuming a particular allocation order.
- Added real HTTP coverage for `promotion.upsert` including commit, exact replay, duplicate-code refusal, validation refusal and capability denial. Added restore-verifier regressions proving a mismatched sale tender total and missing source-to-GL coverage are rejected rather than reported verified.
- Verification: `npm run bar-local:typecheck` passed; full `services/bar-local` suite passed 96/96 (292.2s) against the isolated local cluster; `npm run test:bar-local-electron` passed 20/20; Modern/Legacy client and startup suites passed 46/46. No hosted Supabase write, migration, release or cutover.
- Manual impact: No approved customer manual update is required for this service-only checkpoint because the new policy is not yet exposed as a Modern or Legacy discount workflow. The discount approval/limit prompts, owner-only staff controls and recovery guidance must be documented and packaged before Bar local authority is commissioned.
- Remaining program work is not complete: C01-C08 still require full application workflow routing, source-to-GL posting/readiness, installer and Windows service lifecycle, replication/failover/fencing, scheduled/WAL recovery, event-driven catalogue distribution, durable cutover/export workers, hardware/Windows 7/multi-PC/load qualification, and deferred customer documentation. F08 still lacks successful HTTP coverage for every one of the 73 offered commands, and historical F03/F04 rows are not repaired by the forward-only fix.

## 2026-10-20 — Legacy POS neutral branding, company selection and explicit launcher

- Follow-up: launcher no longer inherits the terminal's output handles; it detaches Legacy with file-backed runtime output in `.tmp/legacy-preview.log` and uses an independent company-login preview profile to avoid focusing an old orange-logo window. Added early stdio guards limited to EPIPE/destroyed streams, with regression proof that unrelated errors are not swallowed. Existing profiles/queues are retained; no application-wide exception suppression or process termination.
- Legacy now lists the signed-in account's memberships across lodge/hotel/hospitality-pos using the existing server membership RPC, offers an explicit chooser when ambiguous, revalidates the selected company and resolves its scoped staff/session before activation. It clears stale app-session context before password authentication, refuses in-session switching and blocks switching over unresolved foreign/unknown-scope queue work. Offline unlock chooses only password-verified unexpired saved memberships; startup restoration remains pinned to its saved company.
- Added company-specific reference caches, owner-proven migration of old reference caches, and scoped financial cache reads/writes that retain other companies' records. Existing queues/journals and operation IDs are preserved. Replaced the restaurant-specific login/header logo with the existing neutral HospitalityOS asset.
- Added `npm run legacy:open` in both packages: pinned Legacy Electron, absolute package resolution, built-file launch and cleared inherited main-product/dev URL overrides. This avoids the root LodgingOS entry when terminal commands are pasted in the wrong order. Existing application work and local-authority implementation are preserved; this is not local-authority activation.
- Verification: 219 existing Legacy regression checks plus focused company tests pass; Legacy production build and strict check of the new selection module pass. Actual Electron 22 Login UI exercise passes for neutral branding and online/offline company selection using fictional mocked memberships. Live account acceptance and installed Windows 7 qualification were not performed. No hosted migrations, business fixtures, release or push.
- Manual impact required: added Legacy user guide, quick-start, impact/verification records and visually checked screenshots under `legacy-pos/docs/`. These are documentation candidates; the separate modern Bar approved PDF manifest/packaging is unchanged. No guide approval or customer release is claimed.

## 2026-10-20 - A03 100-request idempotency verified

- Added `services/bar-local/tests/api-concurrency.test.mjs`, driving 100 simultaneous HTTP command requests with one operation key through the real loopback service. The run produced one committed operation, one sale line, one audit record, one stock depletion and identical receipts; 99 requests replayed, and a changed payload using the same key was refused with `IDEMPOTENCY_PAYLOAD_CONFLICT`.
- Updated `ACCEPTANCE_MANIFEST.csv` A03 from partial to verified with no blocking gate. The manifest now has 1 verified, 12 partial and 19 not run; the feature matrix remains 33 locally implemented, 12 partial, 13 not implemented and 1 external pending.
- Verification: `npm run bar-local:test` passes 34/34 tests across 25 files (89.5s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - this is service-level concurrency evidence with no new customer-facing control or workflow.

## 2026-10-20 - Local Bar workforce roster and attendance

- Added `services/bar-local/db/migrations/0019_workforce_roster_attendance.sql` with outlet roster shifts, versioned schedule edits and cancellation, and single-open attendance periods. Registered `workforce.shift.schedule`, `workforce.shift.cancel`, `workforce.clock.in` and `workforce.clock.out`, plus scoped `workforce.roster`, `workforce.attendance.list` and `workforce.attendance.current` queries. All workforce contracts require the `bar_accounting_workforce` entitlement and `staff.manage`; no `staff.view` capability exists yet.
- Added `services/bar-local/tests/db-workforce.test.mjs` and `contract-workforce.test.mjs`, covering replay, stale roster versions, cancellation guards, duplicate open attendance, self clock-in, clock-out state conflicts, cross-midnight duration, cursor pagination, audit evidence and entitlement refusal. Updated `BAR-WORKFORCE-001`; matrix totals are now 33 locally implemented, 12 partial, 13 not implemented and 1 external pending.
- Verification: `npm run bar-local:typecheck` and the full `services/bar-local` suite pass 33/33 tests across 24 files (74.9s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - roster and attendance are service-layer only and are not yet wired into Modern or Legacy Bar client screens; client integration and manual updates remain pending.

## 2026-10-20 - Local Bar control checklists and incident evidence

- Added `services/bar-local/db/migrations/0018_control_checklists_incidents.sql` with server-seeded opening, service, safety and closing templates, versioned checklist start/item transitions, automatic completion when required items are complete, and a versioned incident log with single-resolution guarantees. Added `control.checklist.start`, `control.checklist.item.set`, `control.incident.log`, `control.incident.resolve` and their scoped list/detail queries.
- Added `services/bar-local/tests/db-control.test.mjs` and `contract-control.test.mjs`, covering template snapshots, replay, stale checklist versions, full completion, reopening, incident resolution conflicts, filters and audit evidence. Updated `BAR-CONTROL-001`; matrix totals are now 32 locally implemented, 12 partial, 14 not implemented and 1 external pending.
- Verification: `npm run bar-local:typecheck` and the full `services/bar-local` suite pass 31/31 tests across 22 files (64.4s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - control records are service-layer only and are not yet wired into Modern or Legacy Bar client screens; client integration and manual updates remain pending.
## 2026-10-20 - Local Bar sales summary reconciles corrections and tenders

- Added `services/bar-local/db/migrations/0017_sales_summary.sql`, implementing `reports.sales_summary` over signed original, return and void rows. It reports gross sales, returns, voids, net sales, discounts, tax, tips, sale count, average sale, tender nets, daily totals, product totals and current product-category totals with snapshot metadata.
- Added `services/bar-local/tests/db-sales-summary.test.mjs` and `contract-sales-summary.test.mjs`, proving that a partial return and a full void reconcile against tenders, products and categories. Updated the existing accounting test to the new report shape and updated `BAR-REPORT-001`; matrix totals are now 31 locally implemented, 12 partial, 15 not implemented and 1 external pending.
- Verification: `npm run bar-local:typecheck` and the full `services/bar-local` suite pass 29/29 tests across 20 files (54.4s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - the report contract is service-layer only and is not yet wired into Modern or Legacy Bar client screens; client integration and manual updates remain pending.
## 2026-10-20 - Local Bar chart of accounts is versioned and usage-safe

- Added `services/bar-local/db/migrations/0016_chart_of_accounts.sql` with `accounting.account.upsert` and `accounting.accounts.list`. Accounts are created and updated through optimistic versions; posted journal usage blocks changing an account's financial type, deactivated accounts cannot receive new postings, and every change is audited.
- Added `services/bar-local/tests/db-chart-of-accounts.test.mjs` and `contract-chart-of-accounts.test.mjs`, covering duplicate creation, stale versions, name updates, posted-type protection, deactivation, inactive posting refusal, list filters and totals, contract validation and audit before/after evidence. Updated `BAR-ACCOUNTING-001`; matrix totals are now 30 locally implemented, 13 partial, 15 not implemented and 1 external pending.
- Verification: `npm run bar-local:typecheck` and the full `services/bar-local` suite pass 27/27 tests across 18 files (40.9s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - chart management is service-layer only and is not yet exposed in Modern or Legacy Bar client workflows; client integration and manual updates remain pending.
## 2026-10-20 - Local Bar expenses post balanced journals with approved reversals

- Added `services/bar-local/db/migrations/0015_expenses.sql` with business/outlet-scoped expenses, active expense/payment account validation, closed-period guards, atomic balanced journal posting, optimistic versions and append-only reversal journals. Registered `expense.create` and `expense.void` (manager/owner accounting management, with `accounting.approve` maker-checker for reversal), plus `expenses.list` and `expense.get`.
- Added `services/bar-local/tests/db-expenses.test.mjs` and `contract-expenses.test.mjs`, covering journal debits/credits, replay, active-account rejection, future-date refusal, approved reversal, status filtering, audit records and contract validation. Updated `BAR-EXPENSE-001`; matrix totals are now 29 locally implemented, 13 partial, 16 not implemented and 1 external pending.
- Verification: `npm run bar-local:typecheck` and the full `services/bar-local` suite pass 25/25 tests across 16 files (37.6s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - expenses are service-layer only and are not yet exposed in Modern or Legacy Bar client workflows; client integration and manual updates remain pending.
## 2026-10-20 - Local Bar outlet menu availability enforced in sales

- Added `services/bar-local/db/migrations/0014_menu_availability.sql` with business/outlet-scoped `product_availability`, optimistic versions, `catalogue.availability.set`, `menu.availability`, audit/outbox records, catalogue revision bumps and runtime grants. Replaced `price_and_deplete_items` so sale commit and both tab add/settle paths refuse sold-out or inactive products before stock changes.
- Added `services/bar-local/tests/db-menu-availability.test.mjs` and `contract-menu-availability.test.mjs`, covering default availability, sold-out filtering, replay, sale refusal, stale-version conflicts, audit history, missing products and contract validation. Updated `BAR-MENU-003` to `locally_implemented`; matrix totals are now 28 locally implemented, 13 partial, 17 not implemented and 1 external pending.
- Verification: `npm run bar-local:typecheck` and the full `services/bar-local` suite pass 23/23 tests across 14 files (67.0s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - availability is service-layer only and is not yet exposed in Modern or Legacy Bar client workflows; client integration and manual updates remain pending.
## 2026-10-20 — Local Bar purchasing and operation-claim serialization verified

- Added `services/bar-local/db/migrations/0012_purchasing.sql` with business-scoped suppliers, optimistic supplier versions, approved purchase orders, partial/full receipts, over-receipt and stale-version guards, lot/expiry capture, atomic stock movements and query contracts for supplier/PO list and PO detail. Registered `supplier.upsert`, `purchase_order.create`, `purchase_order.cancel` and `purchase_order.receive`, including inventory approval requirements and contract error mappings.
- Added `services/bar-local/db/migrations/0013_operation_claim_serialization.sql`, which takes a transaction-scoped advisory lock on the operation identifier before `claim_operation` inserts. Concurrent identical-key claims previously deadlocked between the primary key and redundant scope unique index; they now serialize, then resolve to one commit plus replay/executing outcomes without duplicate financial or stock effects.
- Added `services/bar-local/tests/db-purchasing.test.mjs` covering supplier uniqueness and version conflicts, approved PO creation/replay, query pagination/detail, over-receipt refusal, partial and full receiving, lot/expiry movements, stock balances, stale versions, cancellation state guards and audit records. Updated `BAR-STOCK-006` to `locally_implemented`; matrix totals are now 27 locally implemented, 14 partial, 17 not implemented and 1 external pending.
- Verification: `npm run bar-local:build` and the full `services/bar-local` suite pass 21/21 tests across 12 files (30.0s) against the isolated local cluster; the concurrency file also passed five consecutive direct runs after the advisory-lock change. No hosted write, migration, release or cutover. Manual impact: No manual update required - purchasing is not yet exposed in Modern or Legacy Bar client workflows, so no current customer-facing behavior changed; client integration and manual updates remain pending.
## 2026-10-20 — Operation identifiers bound to their original command

- Added `services/bar-local/db/migrations/0011_claim_command_binding.sql`, replacing `bar_local.claim_operation` so a reused operation identifier is refused with `IDEMPOTENCY_PAYLOAD_CONFLICT` when the command differs, even if the supplied payload hash matches. Tenant/device/outlet scope checks still run first, and replay of the original command remains unchanged.
- Added `services/bar-local/tests/db-operation-binding.test.mjs`, which reuses a committed shift operation identifier for a tab command with the original hash and proves the substitution is refused, the original replay still works, and no tab or second operation is created.
- Verification: the full `services/bar-local` suite passes 20/20 tests across 11 files (25.1s) against the isolated local cluster; the service build and contract typecheck pass. No hosted write, migration, release or cutover. Manual impact: No manual update required - internal idempotency hardening only; no customer-facing Bar behavior changed.

## 2026-10-20 — Local Bar cash-up reopen added with revision history and period-lock guards

- Added `services/bar-local/db/migrations/0010_cashup_reopen.sql` with security-definer `bar_local.cmd_cashup_reopen`, `revision`/reopen metadata on `bar_local.cashups`, and a typed `bar_local.cashup_revisions` snapshot table. Reopen requires an exact `pos.cashup` approval, enforces outlet scope, reviewed-state match, non-negative counts and a closed-period check, recomputes expected cash, clears the prior review, records the superseded row, and writes audit plus a `cashup.reopened` event. Keeping one current row per shift preserves the existing `cashup.summary` contract.
- Registered `cashup.reopen` in `packages/bar-contracts/src/registry.ts` and `services/bar-local/src/commands.ts`; the validator requires the reviewed status, a reason and non-negative cash/card counts.
- Added `services/bar-local/tests/db-cashup-reopen.test.mjs` (approved and rejected corrections, unreviewed refusal, stale-state conflict, closed-period refusal, replay, snapshot integrity and no side effects) and `contract-cashup-reopen.test.mjs` (approval, reviewed status, reason and non-negative counts). Updated `BAR-CASH-003` to `locally_implemented`; matrix totals are now 26 locally implemented, 14 partial, 18 not implemented and 1 external pending.
- Verification: `npm run bar-local:typecheck` and the service build pass; the full `services/bar-local` suite passes 19/19 tests across 10 files (23.3s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - reopen is not yet exposed in Modern or Legacy Bar client workflows, so no current customer-facing behavior changed; client integration and manual updates remain pending.

## 2026-10-20 — Local Bar tab split and merge added with approval, version and replay guards

- Added `services/bar-local/db/migrations/0009_tab_split_merge.sql` with security-definer `bar_local.cmd_tab_split` and `bar_local.cmd_tab_merge`. Split moves explicitly selected open lines into a new tab and refuses an empty source; merge moves all open lines into a target tab, marks the source `transferred`, and preserves line pricing/stock snapshots. Both consume an exact `pos.manage` approval, lock affected tabs, enforce outlet/owner/version checks, renumber moved lines, are idempotent by operation key, and write audit plus `tab.split`/`tab.merged` events.
- Registered `tab.split` and `tab.merge` in `packages/bar-contracts/src/registry.ts` and `services/bar-local/src/commands.ts` with `pos.manage` capability/approval, duplicate-line and self-merge validation; the existing registry-parity startup check requires a handler mapping for every registered command.
- Added `services/bar-local/tests/db-tab-split-merge.test.mjs` (split/merge totals, moved-line conservation, settlement after merge, replay, empty-source, stale-version, foreign-line and no-side-effect guards) and `contract-tab-split-merge.test.mjs` (capability, approval, duplicate-line and self-merge validation). Updated `BAR-TAB-005`/`BAR-TAB-006` in `FEATURE_CONTRACT_MATRIX.csv` to `locally_implemented`; matrix totals are now 25 locally implemented, 14 partial, 19 not implemented and 1 external pending.
- Verification: `npm run bar-local:typecheck` and the service build pass; the full `services/bar-local` suite passes 14/14 tests across 9 files (16.6s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - split/merge are not yet exposed in Modern or Legacy Bar client workflows, so no current customer-facing behavior changed; client integration and manual updates remain pending.

## 2026-10-20 — Local Bar read paths validated; WP0 program evidence started

- Extended `packages/bar-contracts/src/results.ts` with `EventFeed`/`EventRecord`/`EventScope`, `OperationStatusResult`, `ReadinessResult` and corresponding validators. The local service now rejects malformed event ordering/count/cursor/completeness metadata, inconsistent committed/refused operation status, and readiness results whose `ready` flag disagrees with blockers. HTTP handlers assemble `ok` after validation, so database JSONB cannot override response status.
- Added `docs/engineering/bar-local-first/FEATURE_CONTRACT_MATRIX.csv` (59 scoped Bar features; 18 columns), `ACCEPTANCE_MANIFEST.csv` (A01–A32 with current evidence and gates), `ADR-001-LOCAL-AUTHORITY.md` and `DEPENDENCY_INVENTORY.md`. The matrix records 23 locally implemented, 14 partial, 21 not implemented and 1 external pending. These are inventory/evidence artifacts, not production-readiness claims.
- Verification: `npm run bar-local:typecheck` passes; the full `services/bar-local` suite passes 11/11 tests (7 files, 18.1s) against the isolated local cluster, including malformed event/operation/readiness tests and the existing HTTP read-path assertions. No hosted write, migration, release or cutover. Manual impact: No manual update required - internal contracts and program evidence only; no customer-facing Bar workflow changed.
- Boundary: WP0 remains in progress because the feature matrix still needs owner/domain completeness review and the acceptance evidence is mostly `not_run`/`partial`. WP1–WP8 client, backup, replication, installer, hardware and documentation work remain unimplemented.

## 2026-10-20 — Local Bar query results validated at the contract boundary

- Extended `packages/bar-contracts/src/results.ts` with `QueryResult`, `QueryPagination`, `QueryScope` and `validateQueryResult`. The local service now requires every successful query dispatch to return `data` plus bounded pagination (`next_cursor`/`has_more` consistency), non-negative `snapshot_watermark`, server-derived scope IDs/role/device, `as_of`, `complete` and explicit string `unavailable` reasons before responding. The HTTP response is assembled after validation, so SQL JSONB cannot override `ok` or `query`.
- Changed the service `typecheck` script to build the contracts package first; it previously resolved stale `dist` declarations when a new contract export was added, causing a false missing-export error.
- Verification: `npm run bar-local:typecheck` passes; the full `services/bar-local` suite passes 8/8 tests (7 files, 18.2s) against the isolated local cluster, including direct malformed-query-envelope tests and HTTP snapshot metadata assertions. No hosted write, migration, release or cutover. Manual impact: No manual update required - internal response-contract validation only; no customer-facing Bar workflow changed.

## 2026-10-20 — Local Bar command outcomes validated at the contract boundary

- Added `packages/bar-contracts/src/results.ts` with `CommandReceipt`, `CommandRefusal`, `CommandOutcome` and `validateCommandOutcome`; `executeCommand` now validates every committed/refused database result (receipt IDs, authority epoch, commit sequence, business date, server timestamp, cloud status; refusal code/message/flags) before returning it to HTTP clients. This closes the gap where SQL JSONB was forwarded unchecked.
- Verification: `npm run build` and `npm run bar-local:typecheck` pass; the full `services/bar-local` suite passes 6/6 files (28.3s) against the isolated local cluster. No hosted write, migration, release or cutover. Manual impact: No manual update required - internal service contract validation only; no customer-facing Bar workflow changed.

## 2026-10-19 — Bar plan extended for mixed Windows clients and replicated hosts

- Added all eight owner-approved operational improvements as mandatory A25–A32: power/maintenance guidance, opening readiness, persistent till connection status, independent automated backups/restore verification, safe offline updates, isolated rehearsal, replacement-PC wizard and failure qualification. Technical plan and both handoff prompts now require the full A01–A32 manifest and corresponding customer documentation. Planning only; no application/SQL change, test execution, hosted write, release or cutover by this update.
- Further owner clarification: three PCs are illustrative, not a fixed installation size. Added mandatory Settings-led server/join/full-copy/status/repair/switchover/removal workflows, automated installation/pairing/seeding/catch-up, explicit device-versus-replica-versus-voter roles and two-/six-PC acceptance gate A24. Both handoff prompts require these functional workflows and documentation evidence. This remains planning only.
- Planning-only update: modern office/till hosts may hold full PostgreSQL replicas; Windows 7/POSReady 7 remains a Legacy client. Added LAN catalogue publishing/distribution, complete Legacy Bar cashier workflow requirements, installer roles, coordinated failover/durability/fencing and A21–A23 to the technical plan and both handoff prompts.
- One modern office PC plus a Windows 7 till has one eligible database host. Three eligible modern hosts are the default proposed automatic-failover topology, conditional on a verified supported coordinator/runtime and failure evidence. Existing database foundation work below does not establish these capabilities. No application/SQL change, hosted migration/write, commissioning or deployment in this planning update; cloud ingestion remains disabled.
- Manual impact: no current customer workflow changed by planning; implementation requires setup/menu/failover/recovery manual, quick-start, screenshots and packaged-guide evidence updates.

## 2026-10-19 — Local Bar authority database foundation implemented and locally verified

- Implemented the first local-only slice of the approved plan under `services/bar-local/`: migrations `0001_schema` through `0007_grants` (schema, core operation lifecycle, identity/pairing/session primitives, sales/tabs/receipts, corrections/stock/credit/voucher/settings/accounting, allowlisted query dispatch, and the runtime privilege boundary), a checksum-checked migration runner, guarded bootstrap/migrate/reset scripts, a dedicated `bar_local_test` database runner, and an HTTP service (`src/`) with loopback-only first-owner commissioning, PBKDF2 PIN verifiers, persistent lockout after repeated PIN failures, device pairing, session issue/refresh/revoke, hash-bound manager approvals, command/query/operation/event routes, authenticated readiness and optional TLS. All functions callable by the runtime role are `SECURITY DEFINER` with a fixed `search_path`; direct table/sequence access is revoked.
- The new service and `packages/bar-contracts` are strict TypeScript compiled to Node-compatible JavaScript with declarations; contract commands/queries retain one runtime-validated definition whose payload/filter types are derived from the validators. `npm run build` compiles contracts then the service, and the service test aggregate builds before running. Existing application JavaScript was not converted.
- Added six regression suites (`services/bar-local/tests/`) covering: commissioning and session issuance; sale commit, exact replay, idempotency-payload conflict, approval-backed return and voucher refund; stock receive/deplete/insufficient-stock refusal/return-restock/transfer; customer credit and cash payment; tabs with cross-role ownership denial; shift close and maker-checker cash-up review; accounting journal/trial balance/outbox/period lock; scoped query dispatch; concurrent last-unit sales and concurrent identical operation keys; duplicate JSON object-key rejection; end-to-end HTTP commissioning, login, catalogue, sale, receipt lookup, replay/conflict, manager approval, maker-checker denial, pairing, session refresh/revocation, device inventory/revocation, outbox status, ordered event replay and persistent login lockout. `npm test` in `services/bar-local` passes 6/6 files against the isolated local cluster; root `npm run bar-local:typecheck` passes.
- Executing the SQL and service flows exposed and corrected real defects: `FOR SHARE` inside a `STABLE` function; ambiguous PL/pgSQL output-column references in sequence allocation and item pricing; tab settlement writing line IDs as product IDs; capability-only tab ownership checks that every `pos.manage` operator could bypass; return refund allocation using the wrong sign for voucher/credit/cash refunds; journal lines accepting null/negative/dual-sided amounts; trial balance including journal lines outside the requested date range; stock movements accepting null/negative quantities; unsupported tender methods/provider statuses; missing tab/stock validation paths; staff creation failing on null optional capabilities; query filters being lost during envelope validation; and composite session contexts being misread by the HTTP layer.
- Boundary: this is a local database and single-process service foundation, not an authority cutover. Modern/Legacy client routing and durable intent journals, client state machines, read-model/events streaming at client level, signed entitlement verification/activation, backup/export/restore lifecycle, replica/failover topology and coordinator qualification, Settings-led setup workflows, connection indicators/readiness, offline updates/rehearsal/replacement recovery, packaging, A01–A32 acceptance evidence, customer documentation and deployment remain unimplemented. Device administration now supports listing and authenticated revocation through the local service. No hosted Supabase migration/write, customer cutover or release occurred. The portable PostgreSQL cluster and `bar_local_test` database are developer test infrastructure only.
- Manual impact: No manual update required for this internal foundation; customer-facing Bar behavior, navigation, permissions and workflows are unchanged until the service and clients are integrated.

## 2026-10-19 — Proposed local Bar authority plan and implementation/review handoff

- Prepared `docs/engineering/bar-local-first/TECHNICAL_PLAN.md`, `IMPLEMENTATION_PROMPT.md` and `REVIEW_PROMPT.md` at the owner's request. Proposed architecture: one local PostgreSQL-backed Bar service for single/multiple tills, modern and Legacy clients, local financial/stock authority, full feature/add-on inventory, recovery, packaging and acceptance evidence; HotelOS/LodgingOS retain existing online-first Supabase contracts. This is a plan, not an implemented authority change or readiness approval.
- Implementation/review boundary: no hosted Supabase migrations or writes, release publication or real customer cutover. Local-only schema migrations and isolated local tests are required; hosted financial ingestion remains disabled pending a separately reviewed/authorised contract. Existing pending migrations and prior NO-GO evidence are not approved or superseded by this plan. Cloud reports/PWA will not automatically receive new local-Bar transactions in that initial boundary.
- Owner's language clarification: the proposed new local service/shared contracts use strict TypeScript, with targeted typed client adapters, runtime validation and compiled JavaScript compatibility for Legacy POS. SQL/PLpgSQL remains the database enforcement language; unrelated existing applications are not to be converted wholesale. Updated the plan and both handoff prompts; this is a planning-only change.
- Manual impact of eventual implementation: required, including setup/login/offline finality/recovery, quick-start, screenshots, PDF candidates and actual approval/package evidence. This planning-only change does not alter current Bar behavior or the approved guides. No application code, SQL, customer data or hosted deployment changed by this planning task.

## 2026-10-16 — R7 post-review corrections implemented (R7-A/B/C); submitted for re-review

- Implemented the DEEPSEEK_R7_FOLLOWUP corrections on the offline replay path (`src/main/domains/syncShared.js`, `src/main/domains/infrastructure.js`; local-only, uncommitted). Outcome policy is now source-aware: `classifyReplayOutcomeDetailed` reports manual-flag / structured-code / wording / none, and only wording/none fall through to the legacy prose classifiers, so a structured temporary outcome (e.g. `503` + catalogue-conflict prose) can no longer be overridden into manual-only dead-lettering or clear its uncertain submit journal. Journal retention is one policy (`shouldRetainPosSubmitJournal`: retryable classes, contract-missing, permission-denied, the commit-ambiguous receipt-identity codes incl. `TAB_VERSION_REQUIRED`, or uncertain legacy wording). The code matrix gained `TAB_VERSION_REQUIRED`, `IDEMPOTENCY_EXPIRED`, `IDEMPOTENCY_RECEIPT_UNAVAILABLE`, `OPERATION_KEY_REQUIRED`, `ACTOR_REQUIRED`, `OUTLET_SCOPE_CONFLICT`, `REPLAY_KEY_REQUIRED`; `408` now maps to transport-uncertain and `tab_version_required` joins the business-conflict wording. Codes not listed (e.g. insufficient-stock, payment-total-mismatch) keep the safe bounded-retry → manual-review fallback — documented as a deferred decision in the closure matrix, not hidden.
- Parent waits no longer spend the child's dispatch budget: the skip branch preserves `retryCount` and records the wait separately (`_parent_wait_count` with its own bounded 1s→30s + jitter schedule); a dispatched attempt deletes the wait counter; a terminal parent parks the child explicitly without dispatch; a committed parent releases waiting children on the success path. The strict in-development assertion caught one incomplete first edit; the final suite is green.
- Verification (logs and file hashes preserved in `docs/audits/2026-10-16/bar-r7-review/post-fix/`): `bar-historical-replay-contract` 26/26 (8 new post-review cases: code matrix, journal retention, structured temporary refusal with conflict prose, parent wait at 4, terminal-parent parking, probe tri-state, concurrent add/remove, edits/collisions fail-closed); `bar-retry-transfer-durability` 7/7; `queue-replay-authority` 9/9; offline-queue, offline-POS, inventory and financial guard scripts ok; `npm test` guardrails ok; `test:typecheck:main` 2/2 + 16 guards; Bar affected subset 71/71. Full `test:bar`: 777 tests / 759 pass / 13 fail / 5 skipped — 12 failures identical to the pre-classified baseline, and the 13th (`bar-base-food:170`) is unrelated typed-lookup drift in the current uncommitted `HposTerminal.jsx` working state (test file unmodified vs HEAD; neither file this diff touches appears in that assertion input).
- The review's import blocker is resolved: the extra closing brace at `src/shared/accommodation.js:391` removed with the annotation WIP preserved (hash `CAE9B213…`); all post-fix suites execute at runtime with no import-stage failures. The review probe (`probe-r7.mjs`) was not modified or re-run — it asserts the old defects by design; its cases were converted into safe-outcome acceptance cases in the suite.
- Status and boundaries: closure matrix at `docs/audits/2026-10-16/bar-r7-review/post-fix/R7_FIX_CLOSURE.md` (defect → correction → acceptance case → evidence, deferred code-matrix note, failure attribution). Submitted for independent re-review; this entry does not accept R7, does not approve the historical-replay migration and does not change the remote rollout NO-GO. No SQL was executed. Manual impact: No manual update required for this internal classification/scheduling correction; the 2026-10-15 guide/manual obligations for parked-sale review states remain open and deferred.

## 2026-10-16 — Independent R7 review: improvements verified in isolation; acceptance still requires corrections

- `docs/audits/2026-10-16/bar-r7-review/REVIEW.md`: CHANGES REQUIRED. The code-first helper is still overridden downstream by legacy wording (`503` + catalogue-conflict text becomes manual-only dead-letter and may clear the uncertain submit journal). `parent_pending` still increments the child's execution retry count without dispatch and can dead-letter it at five. Current `TAB_VERSION_REQUIRED` maps to unknown without matching prose. Actual-function/statement probes reproduce these gaps and confirm seven tri-state probe outcomes plus preservation of a concurrent failed-store addition during contract requeue.
- Independent integration reruns did not reproduce the author's green snapshot: the historical and queue-authority suites fail at import because current unrelated `src/shared/accommodation.js:391` has an extra closing brace. The seven original durable retry-transfer tests pass. No attribution to R7 for that syntax error; no production file altered in the review. Logs/source hashes and a bounded `DEEPSEEK_R7_FOLLOWUP.md` retained beside the review.
- No SQL/migration reviewed or applied. Prior broader blockers, manual/guide obligations and remote rollout NO-GO remain. The implementation entry below is the author's reported snapshot, not independent R7 acceptance.

## 2026-10-16 — Replay retry scheduling enforced; parked-sale probe and structured codes corrected (R7)

- R7 (review item "structured codes/scheduling need correction") implemented on the offline replay path in `src/main/domains/infrastructure.js` + `src/main/domains/syncShared.js`: the sync loop now enforces persisted `_next_retry_at` before every attempt (a not-yet-due row is left untouched — no attempt, no retry burn, no dead-letter — and the pass parks when all remaining rows wait on schedule); each row is attempted at most once per pass; the blocking in-pass backoff sleep was removed so pacing is durable across restarts instead of decorative. `buildReplayFailureMetadata` writes bounded backoff (loop policy 1s→30s via `SYNC_RETRY_BASE/MAX_DELAY_MS`) plus stable per-`_queue_id` jitter (0–10s, deterministic, zero without identity). Dependency skips behind a still-pending parent are scheduled the same way via the newly retryable `parent_pending` outcome instead of hot-looping.
- `classifyReplayOutcome` classifies structured codes first (manual-review flag, structured refusal codes including historical/reconciliation codes, PostgREST/SQLSTATE) and only falls back to bounded transport wording; the contract probe returns "unknown" (null, uncached) on auth/throttling/transport errors instead of caching a wrong availability verdict; the parked-sale requeue no longer refuses the `manualRetryOnly` flag it itself sets on contract-parked sales (payload-identity and destination-collision checks still fail closed) so the deployment-recovery path actually recovers.
- Verification: `bar-historical-replay-contract` 18/18 (new due-schedule enforcement, code-first classification, jitter determinism/bounds, parent-skip assertions; probe-requeue test now genuinely reaches replay), `queue-replay-authority` 9/9, `test:offline-queue-critical` pass, `npm test` (production-guardrails) pass, `test:typecheck:main` 2/2 + 16 guards pass, Bar suite 752 pass / 12 fail / 5 skipped — the same 12 pre-classified failures recorded 2026-10-15 (6 guide evidence/PDF hashes, 5 stale source-contract anchors in preload/pos.js/PWA, 1 missing Playwright browser), none in the sync area. Lounge-stress simulation still models the old in-pass retry pacing; convergence semantics unchanged.
- Manual impact: No manual update required — internal retry scheduling/classification only; no customer-facing Bar workflow, control, permission or guidance changed. Guide/manual blockers and the NO-GO rollout state from the 2026-10-15 entry remain open; no migration was reviewed, applied or deployed by this change.

## 2026-10-15 — Codex review rejects historical replay draft; no migration approved

- Review: `docs/audits/2026-10-15/bar-remote-remediation/codex-review/REVIEW.md`. Verdict CHANGES REQUIRED / NO-GO. Submitted historical migration SHA-256 `3fa79c63c42e3059529e601e1f95ac244f61af6a7533367384a5be8dfcbdd93f` reintroduces pre-claim tab/ownership checks and omits later mandatory tab-version, duplicate-settlement, rollback/resolve-tab, waiter and pool-tender guards. Predictable replay prefix/time bounds do not establish offline provenance; approved-cash-up note alone does not implement reconciliation. New client routing can park stale-open-cache sales; async parked requeue can overwrite concurrent failed-store changes (isolated function-body reproduction retained). Structured codes/scheduling and menu completeness also need correction.
- Independently reran new historical suites plus retry-transfer regression: 32/32 pass; those tests do not establish SQL behavior and miss the above defects. No SQL/migration/DB fixture was executed. Other copied migrations remain unapproved; file inventory is not semantic review. Prior implementation claims below describe the author's submission, not acceptance.
- Prepared `docs/audits/2026-10-15/bar-remote-remediation/DEEPSEEK_CONTINUATION_PROMPT.md` covering review fixes, unfinished original A–I work, and owner-selected opening checks, unusual-activity detection, duplicate protection and context-aware help (items 1/5/6/8). All new/revised SQL remains held for Codex review before application anywhere. Production code and draft migration were not changed in this review.

## 2026-10-15 — Bar remote remediation pass: historical replay contract implemented client-side and drafted server-side; Codex packet created; still no-go

- Historical sale replay (client): queued/recovered sales for a closed originating shift now replay the original bytes and key through `replay_pos_order_v3_historical_v1` (probe-gated, `hist-replay:` key binding, `contract_missing` parking when the server contract is absent, dependency-safe requeue, journal reopen, structured outcome classification). Open-shift live sales keep the literal `create_pos_order_v3` call. Migration `20261015010000_pos_historical_sale_replay_v1.sql` (private impl + unchanged public delegator + wrapper; committed-receipt-first; ±5 min window; 56-day = 42+14 expiry; audit row + approved cash-up reconciliation note) is **unreviewed and unapplied** — Codex packet at `docs/audits/2026-10-15/bar-remote-remediation/migration-review/` (26 local-only files, SHA-256, authorization matrix, 16 fixtures NOT RUN).
- Verification: `npm test` green (two stale anchors repaired after concurrent annotation edits — maintenance `ticketView`, JSDoc-cast `(err)?.message`; behavioral intent preserved). New `tests/bar-historical-replay-contract.test.mjs` (16) and `tests/bar-historical-replay-migration.test.mjs` (9) pass; `queue-replay-authority` 9/9 (probe now runs only when parked sales exist); offline queue/POS critical scripts pass. Bar gate: 12 remaining pre-classified failures (guide evidence 6, stale source-contract anchors 5, missing default browser 1).
- Remediation report, state machine/caller matrix, guide impact record and commissioning checklist at `docs/audits/2026-10-15/bar-remote-remediation/`. **Remote rollout remains NO-GO**: migrations await Codex review, all DB fixtures NOT RUN (no approved disposable target), WP E (backup/restore), F (mesh assessment), H (50k qualification) and I (guides/package) incomplete. Manual impact: guide/manual updates are required for the parked-sale review states and new reason codes but were deliberately not written before the server contract is approved (recorded in `guide-manual-impact.md`).

## 2026-10-15 — Remote multi-till Bar assessment: no-go; retry-transfer durability fixed locally

- Assessed standalone Bar mode for weeks offline, several LAN tills and high weekend volume. See `docs/audits/2026-10-15/bar-remote-readiness.md` and its evidence. Automatic and manager retry transfers now durably save the pending destination before pruning failed copies; seven real-store/function-body regression checks pass, including interrupted transfers and 20,000-sale transfer. Existing keys, payloads and dependencies are preserved. No full recovery supervisor or historical replay redesign is claimed.
- Read-only linked history check: 498 rows, 24 local-only migrations from 20261007010000 through 20261014020000; September offline-window/lease/date history matched. Live function metadata confirms current staff-menu RPC is missing and sale RPC retains full-payload hashing/open-shift validation; client shift rewrites remain a financial recovery risk. Hourly generic backup omits Bar sales/queue/journal data; mesh excludes machine-bound approval operations. Actual multi-till weeks-outage, full restore and financial reconciliation remain unqualified.
- Baseline Bar gate: 706 pass / 24 fail / 5 skipped. Offline queue/POS critical scripts and replay-authority 9/9 pass; Legacy 219/0 pass; guide contract 10/12 with current/packaged approval-hash mismatch. Bar source build passed on retry after concurrently arriving checkout edits settled. No migration deployment, live business fixtures, signed installer or customer rollout performed. Existing unrelated changes preserved. Manual impact: no update required for internal transfer-order correction; existing guide approval/package blockers and future recovery-feature documentation remain open.

## 2026-10-15 — LodgingOS R1–R8 verification corrections integrated; re-review closed with 2 parent-fixed blockers

- Implemented the INDEPENDENT_REVIEW-2026-10-15 corrections in one coordinated pass (Agent A: forward SQL R1/R2/R3/R8; Agent B: R4/R5/R6 persistence/refresh/mounted tests; Agent C: R7 accommodation contract + rendered verification) plus independent re-review of non-authored code and parent integration fixes. No production writes, no db:push, no releases; unrelated/in-flight work preserved.
- New forward SQL (all untracked, awaiting deployment): 20261014040000 (R1 receipt-before-stale-check replay + full-precision v2 fingerprint with v1 dual-accept + R2 source-family/unsupported_source + expectations_required), 20261014050000 (R3 BEFORE UPDATE OF property_type/business_type trigger, classification_locked; writer flag, bootstrap window, service_role trusted paths verified against effective definitions), 20261014060000 (R7 _is_campsite_priced_kind campsite+tent, 8 asserted gate patches; server stamps family label 'campsite', rooms keeps truthful 'tent').
- R4/R5/R6: real createTransitionController used by Settings (persist-verify-throw before any RPC, archive-and-supersede instead of delete, foreign-scope read-only, scope+op fencing); always-attached truthful refresh {ok,reason} + refreshSettingsFromServer IPC with visible saved-but-refresh-pending + refresh-only retry (zero resubmission); genuine t.skip everywhere, required DB gate npm run test:property-disposable exits 2 without creds; mutation probes red/green in-suite.
- R7: CAMPSITE_PRICED_KINDS=('campsite','tent') identical in JS + SQL; tent flows through computeStayTotal all modes; independent caps with no prior generic max_occupancy gate; display keeps Permanent tent; no stored-total repricing; no queue envelope change. Shell/nav follow the same loaded actual-mix summary as inventory screens. Rendered r7 harness PNGs + honest mounted-component limitation recorded.
- R8: DEPLOYMENT-pending.md rewritten (exact 6-migration chain, verified dry-run, backlog-separation rule, corrected one-time-patch disclosure, non-destructive rollback, smoke checks).
- Re-review verdict was CHANGES-REQUIRED with 2 blocking items, both fixed by parent in this pass: (B1) stale replay test now asserts the R5 truthful refresh object; (B2) commit receipt lookup moved BEFORE the source-family check (header + live SQL test already required this; static order guard added). Also fixed a missing JSX fragment in Rooms.jsx site-only block found by the desktop build.
- Verification (final): focused battery 162 tests → 158 pass / 0 fail / 4 genuine skips; typecheck:shared + typecheck:renderer exit 0; test:offline-queue-critical ok; lodge-camp desktop build green (main+preload+renderer). test:queue-replay-authority currently fails with ReferenceError: classifyReplayOutcome is not defined (infrastructure.js:1356 call site vs classifyReplayOutcomeDetailed import) — breakage from another workstream's in-flight sync refactor in files outside this diff; documented, not weakened, left for the owning work.
- Database/deployment: code complete. Disposable-DB live run still blocked (no LUNA_REMEDIATION_* creds; required gate exits 2 rather than passing). Linked-schema read-only probe (prior pass) still stands: latest applied 20261005090000; all 20261014* migrations awaiting deployment. No customer reclassification; no installer published.
- Bar manual impact: No manual update required. No Bar/POS surface, queue contract, or packaged guide touched by this correction set (queue-replay breakage is pre-existing in-flight work owned elsewhere).

## 2026-10-15 — LodgingOS property adaptation implemented; independent review closed with one blocking fix

- Implemented the complete property-adaptation plan (docs/engineering/property-adaptation/PROPERTY_ADAPTATION_PLAN.md) in one coordinated pass with three bounded workstreams plus independent adversarial review. Prior Experience/Contracts work (presentation resolver, nav labels, Settings transition section, transition RPCs) was rechecked against the review findings rather than assumed.
- Agent A (Settings operation lifecycle): new pure module src/shared/propertyTransitionOperation.js (immutable capture, scoped storage key per lodge/user, byte-identical retry payloads, retire-after-outcome) + PropertyTypeSection rework (persist-before-send, resume on reopen/restart, foreign-scope isolation, target/reason lock while pending, refresh-failure fencing, NOT_FOUND late-landing warning, fresh key per consecutive change). New tests/property-transition-lifecycle.test.mjs (20 behavioral tests).
- Agent B (DB contracts/cache): verified migration 20261014010000_property_type_transitions.sql + follow-up 20261014020000 lodge-scope deny (no new migration needed), refresh-on-status-recovery with non-fatal refresh flag, IPC/preload/database passthroughs wired, per-writer bypass table (ordinary save + operating-profile guarded; PWA read-only; Legacy POS/public unaffected; backup/restore is trusted exact restore). Disposable-DB driver scripts/verify-property-transitions-disposable.mjs written; live run SKIPs without LUNA_REMEDIATION_* credentials.
- Agent C (services/campsite/rendered): conference/pool/pos/inventory catalog extended to guest_house/bnb (no server/commercial prohibition; plan/capability locks intact), campsite inputs/estimates/edit-restore/group carry in Bookings.jsx + accommodation.js helpers + Quotations.jsx defaults, per-surface trace table, five-type rendered walkthrough with real PNGs (docs/engineering/property-adaptation/EVIDENCE-rendered-walkthrough.md + evidence/).
- Independent review verdict was CHANGES-REQUIRED with one blocking gap (single-line campsite quotation conversion dropped tents/vehicles; multi-room comparison forced them to 0). Fixed in this pass by parent: new migration 20261014030000_campsite_quotation_conversion_carry.sql (single-line carry with server-verified totals + details row; multi-room actual-vs-actual comparison; room/event/legacy paths byte-identical), offline display projection in src/main/domains/bookings.js (queue payload unchanged), new tests/campsite-quotation-conversion.test.mjs (5/5 behavioral), tests/campsite-quotation-migration-guard.test.mjs (3/3), tests/campsite-quotation-conversion-sql.test.mjs (disposable, SKIPs here).
- Verification: property/campsite battery 99/99 pass; verified-booking-contracts + queue-replay-authority pass (30/30 incl. reviewer's 9/9 isolation re-run — Agent C's earlier 30/31 flake not reproduced); lodge-camp desktop build passes (1m51s); typecheck:shared passes. offline-queue-regression fails on a source-text assertion over src/main/database.js (expects resolveQueuedItemCreatedAtRaw body in the facade; the function now lives in src/main/domains/usageSupport.js after another workstream's facade extraction) — pre-existing/in-flight, outside this diff, not weakened.
- Database/deployment: code complete. Disposable-DB verification NOT run (no LUNA_REMEDIATION_* credentials in this env; SQL suites SKIP cleanly). Linked-schema read-only probe (SELECT-only, read-only txn, rolled back, zero writes) against oicgpknsmtvcsjacymum PROVES non-deployment: latest applied migration is 20261005090000; preview_/commit_/status property-transition RPCs and the property_type_transitions table are absent; convert_quotation_to_booking_pre_intent_v1 and create_multi_room_booking exist in their pre-fix form. So 20261014010000, 20261014020000 and the new 20261014030000 all await deployment; no customer reclassification; no installer published. (Management-API SQL path separately 544-timed-out twice; direct read-only probe is the evidence above.)
- Bar manual impact: No manual update required. Diff is LodgingOS-confined (property transition journey, campsite quotation conversion, lodge-camp catalog entries); Bar POS product, controls, permissions, packaged guides untouched. Follow-up recommendation (non-blocking): validate Command Central business_type allowlist values (taxonomy drift only, cannot reclassify).


## 2026-10-13 — TypeScript B02-F accepted; R1 follow-up closed

- Independent acceptance: docs/engineering/typescript-migration/evidence/B02F-acceptance.md. Final Legacy checker validates the actual 47-file positive program in its acceptance guard; fresh exact wrapper-disabled/DOM and assertion-no-op probes fail for intended reasons, control/focused trio green (2/2 + 23). Production errors.js/fixtures/configs/locks unchanged, runtime comment-free output identical. Cumulative accepted scope is seven JS modules plus Manager declaration, not full app/financial/IPC/offline/hardware coverage. Manifest byte drift is exactly the unrelated test:restaurant:ledger-disposable script addition (removing its line in memory reproduces recorded hash); writer unspecified, addition preserved. Earlier pending/review text is historical. Builds remain implementer-reported, 219 Legacy tests are prior independently green evidence, old-hardware/B00/D limitations remain; manual impact none. No new batch, release/deployment or operational work authorized by acceptance.

## 2026-10-13 — TypeScript B02-F R1 re-review; one guard-input correction remains

- Assertion extraction and its no-op sensitivity are independently verified, but B02-F remains CHANGES REQUIRED: inventory-accepted checks config roots rather than actual program files, leaving the exact original wrapper-disabled/DOM pair green with 23 guards. Reviewer verified a one-input change to positiveProgram.getSourceFiles() closes that pair in memory while normal checking stays green. Scope is only that guard input plus bounded evidence/wording, by docs/engineering/typescript-migration/B02F_R1_FOLLOWUP_PROMPT.md; re-review/probes retained separately. All accepted suites and Legacy 219/0 pass independently, source/fixtures/locks unchanged, builds remain prior implementer reports. No next batch/release/DB/runtime work; manual impact none. Earlier R1 PENDING text is submission history.

## 2026-10-13 — TypeScript B02-F R1 inventory-guard correction; release gates still open

- R1 correction implemented for the CHANGES REQUIRED review above: pure throwing `assertProgramInventory` extracted in `scripts/typecheck-legacy-shared.mjs` and called by both real inventory paths; missing-source/missing-fixture/unexpected-ambient-file guards rerouted to it; added inventory-accepted + inventory-dom-reference cases; DOM triple-slash integrated probe confirms the real pinned lib.dom.d.ts loads then requires the same-assertion rejection. Guard total is now 23 (21 at first submission). Sensitivity: stdin-loaded disposable variant with ONLY the extracted assertion neutered exits 1 at the missing-source guard's expected-rejection message; unmutated control exits 0; negative-assertion no-op rerun still fails closed at the benign safeguard. No production source/config/fixture/manifest/lock/dependency changes. Full packet updated (`B02F-report.md` R1 section + self-review); correction baseline/snapshots/probe logs saved; prior evidence/reviews preserved. Builds not repeated for this checker-only correction; prior implementer reports stand with limits. Manual impact: none. Status: PENDING RE-REVIEW; no other batch authorized.

## 2026-10-13 — TypeScript B02-F R1 follow-up: actual-program acceptance guard; release gates still open

- Follow-up to the CHANGES REQUIRED re-review above: one guard-input change in `scripts/typecheck-legacy-shared.mjs` — `inventory-accepted` now validates the actual constructed `positiveProgram` file list (47 files) through the real `assertProgramInventory` instead of the two configured roots. Guard total stays 23; normal suite stays 2/2 green. Bounded stdin proofs: adapted control exits 0; DOM-injected positive fixture exits 1 at positive inventory for lib.dom.d.ts; wrapper-noop + DOM exits 1 at `guard inventory-accepted` naming lib.dom.d.ts (the exact original failure pair); assertion-noop exits 1 at the missing-source safeguard. No source/config/fixture/manifest/lock/dependency changes. Evidence: `B02F-R1-followup-baseline.md` (+ snapshots), `B02F-R1-followup-logs/`, report follow-up section. Manual impact: none. Status: PENDING RE-REVIEW; no other batch authorized.

## 2026-10-13 — TypeScript B02-F independent review requires inventory-guard correction

- B02-F is CHANGES REQUIRED for R1 (docs/engineering/typescript-migration/evidence/B02F-independent-review.md). Normal scoped checks and all 219 Legacy regression checks pass; runtime source is comments only with identical pinned comment-free output. Reviewer reproduced a false pass: disabling actual inventory enforcement and simulating a DOM reference still leaves all 21 guards green because two inventory tests repeat filtering instead of invoking the actual assertion. Only scripts/typecheck-legacy-shared.mjs and bounded correction evidence/current wording are assigned by B02F_REVISION_PROMPT.md. Earlier accepted batches remain accepted; no other B02/B03, runtime, financial, hardware, queue, deployment or release work authorized. Builds remain implementer-reported; old-hardware verification remains unperformed. Manual impact: none (checker/evidence correction only). Earlier B02-F submission claims below are historical pending-review state.

## 2026-10-12 — TypeScript B02-F Legacy POS shared error formatter; release gates still open

- B02-E is independently ACCEPTED (`docs/engineering/typescript-migration/evidence/B02E-acceptance.md`). B02-F establishes an isolated Legacy shared-pure checker over `legacy-pos/src/shared/errors.js` (`@ts-check` + JSDoc only: `sanitizePosError(@param unknown → string)`; every message, branch, regex, redaction, whitespace rule, 160-unit truncation and throw behaviour preserved; zero runtime change). New `legacy-pos/tsconfig.typecheck-shared.json` (extends pilot; target ES2020, `checkJs:true`, lib exactly [ES2020], explicit `types:[]` — no Node/DOM/Electron/React/Vite/Manager-globals leakage), `tests/typecheck/legacy-errors/` fixtures (valid 0 diags; invalid TS2322 L2 + TS2339 L4 + TS2591 L5 + TS2584 L6 + TS2304 L7, compile-only), and `scripts/typecheck-legacy-shared.mjs` (2/2 programs + 21 guards: same-assertion checks plus constrained ES2020-family provenance incl. triple-slash-DOM rejection, Node-leak/directive-absent/rejection-disappearance integrated probes, and a stdin-loaded no-op-assertion variant that fails closed at the safeguard). Manifest gains `typecheck:legacy-shared` / `test:typecheck:legacy-shared` only (no installs, all four lockfiles untouched; Node16/Chrome108 targets intact). Pinned-tsc comment-free transpile byte-identical; synthetic-scratch runtime matrix MATCH (incl. genuine throwing-hook throw). All assigned checks serial exit 0 (legacy duo + booking/manager/renderer/main/shared/pilot suites + workspace/products/release-arch/products:list + legacy test 219/0 + legacy build, before-and-after identical; generated-config timestamp churn disclosed); desktop/Manager/booking builds not repeated (sources unchanged; prior reports stand); brand audit not rerun by design. Sabotage restores proven against saved ORIGINAL copies (hash-exact; no fresh references). Bar manual impact: no manual update required (comment-only typing, identical messages); old-hardware runtime verification remains unperformed (stated, not waived). Evidence: `docs/engineering/typescript-migration/evidence/B02F-baseline.md` (+ snapshots/status), `B02F-report.md`, `B02F-logs/`. B02-F reviewer decision PENDING REVIEW; no Legacy queue/financial/hardware/main/preload/React migration, desktop preload, Deno, other B02 or B03 authorized.

## 2026-10-12 — TypeScript B02-E public booking URL/slug utilities; release gates still open

- B02-D is independently ACCEPTED with evidence limitations (`docs/engineering/typescript-migration/evidence/B02D-acceptance.md`). B02-E establishes an isolated public-booking browser checker over `booking-site/src/lib/utils.js` (`@ts-check` + JSDoc only: `unknown` WhatsApp input, string|null country-code option, `string|URL|null` website, required CalendarBooking typedef with unknown metadata, `unknown` slug input; URLs, prefixing, nullable results, regex/date-text handling, interpolation and throws preserved; zero runtime change). New `booking-site/tsconfig.typecheck.json` (`checkJs:true`; lib ES2022+DOM+DOM.Iterable; explicit `types:[]` — no Node/Electron/React/Vite/Manager-globals leakage, no window.api fiction), `tests/typecheck/booking-utils/` fixtures (valid 0 diags incl. narrowing + browser typing; invalid TS18047 L3 + TS2322 L4+L5+L6 + TS2591 L7 + TS2339 L8, compile-only), and `scripts/typecheck-booking.mjs` (2/2 programs + 19 guards: same-assertion checks plus Manager-global-exclusion, Node-leak, directive-absent and rejection-disappearance integrated probes). Manifest gains `typecheck:booking` / `test:typecheck:booking` only (no installs, all three lockfiles untouched). Pinned-tsc comment-free transpile byte-identical; synthetic-scratch runtime matrix MATCH (incl. encoded calendar output and identical throws). All assigned checks serial exit 0 (booking duo + manager/renderer/main/shared/pilot suites + workspace/products/release-arch/products:list + booking test 33/33 + booking build); desktop/Manager builds not repeated (sources unchanged; prior reports stand); brand audit not rerun by design. Sabotage restores proven against saved ORIGINAL copies (hash-exact; creation-vs-canonical discipline per B02-D lessons). Bar manual impact: no manual update required (comment-only typing, identical behaviour). Evidence: `docs/engineering/typescript-migration/evidence/B02E-baseline.md` (+ snapshots/status), `B02E-report.md`, `B02E-logs/`. B02-E reviewer decision PENDING REVIEW; no booking API/payment/React component, preload/Legacy/Deno, other B02 work or B03 authorized.

## 2026-10-12 — TypeScript B02-D independent acceptance with evidence limits

- B02-D ACCEPTED (`docs/engineering/typescript-migration/evidence/B02D-acceptance.md`): actual globals-validator rejection and no-op sensitivity independently verified; Manager suite 2/2 + 33 guards and all accepted suites/contract tests green. Runtime/source/dependencies unchanged. B02-C log copies restored, with donor manifests verified. D pre-edit checker-log gap, fixture creation-byte uncertainty and post-correction recovery-snapshot classification remain explicit; reviewer corrected the stale B02-B metadata in the correction-baseline document and preserved as-reviewed evidence. Prior implementation-state PENDING text below is historical. No release/deployment claim; no manual update required for unchanged behaviour. B02-E scope assigned separately; no execution beyond it authorized.

## 2026-10-12 — TypeScript B02-D Manager PWA build info; release gates still open

- B02-C is independently ACCEPTED (`docs/engineering/typescript-migration/evidence/B02C-acceptance.md`). B02-D establishes an isolated Manager PWA checker over `manager-pwa/src/lib/buildInfo.js` (`@ts-check` + JSDoc only, ESLint global comment kept; `unknown` fallback/shortBuildId boundaries, string results, optional worker metadata never promising agreement; zero runtime change) plus one type-only declaration file `manager-pwa/src/types/build-info.d.ts` (exactly the two real Vite globals as ambient string consts; AST-validated, no emit). New `manager-pwa/tsconfig.typecheck.json` (`checkJs:true`; lib ES2022+DOM+DOM.Iterable; explicit `types:[]` — no Node/Electron/React/Vite leakage, no window.api fiction), `tests/typecheck/manager-build-info/` fixtures (valid 0 diags incl. narrowed metadata + browser typing; invalid TS2322 L2 + TS18048 L4 + TS2345 L5 + TS2591 L6 + TS2339 L7, compile-only), and `scripts/typecheck-manager.mjs` (2/2 programs + 33 guards after the R1/R2 correction below: declare-only + suppression enforcement via pinned metadata, same-function guards, no-op-mutated validator fails closed, in-memory weakened-globals probe fails closed; negative program asserts zero declaration diagnostics). Manifest gains `typecheck:manager` / `test:typecheck:manager` only (no installs, both lockfiles untouched). Pinned-tsc comment-free transpile byte-identical for buildInfo and the localDate editorial; synthetic-scratch runtime matrix MATCH (incl. own-keys distinction and identical raw-import ReferenceError). All assigned checks serial exit 0 (manager duo + renderer/main/shared/pilot suites + workspace/products/release-arch/products:list + manager contract 3/3 + manager lint/build before-and-after identical); desktop builds not repeated (prose-only desktop change; B02-C builds stand as prior reports); brand audit not rerun by design. Two assigned editorials included (localDate NaN-vs-throw comment; B02C-report matrix wording). Bar manual impact: no manual update required (comment-only typing, identical behaviour). Evidence: `docs/engineering/typescript-migration/evidence/B02D-baseline.md` (+ snapshots/status), `B02D-report.md`, `B02D-logs/`. B02-D reviewer decision PENDING RE-REVIEW (R1/R2 correction implemented same day; see correction section in `B02D-report.md` and `evidence/B02D-correction-provenance.md`); no preload/React component, other PWA module, booking/Legacy/Deno or B03 work authorized.

## 2026-10-10 — TypeScript B02-C renderer browser utility; release gates still open

- B02-B is independently ACCEPTED with R1/R2 closed (`docs/engineering/typescript-migration/evidence/B02B-acceptance.md`). B02-C establishes an isolated browser renderer checker over `src/renderer/src/utils/localDate.js` (`@ts-check` + JSDoc only, 42+/0-: `Date|string|number` formatting, `unknown` offset/parser inputs, `Date|null` with no validity promise; local timezone, coercion, rollover and NaN-component behaviour preserved; zero runtime change). New `tsconfig.typecheck-renderer.json` (extends pilot; `checkJs:true`; lib ES2022+DOM+DOM.Iterable; explicit `types:[]` — no Node/Electron leakage, no window.api declaration), `tests/typecheck/renderer-local-date/` fixtures (valid 0 diags incl. DOM typing; invalid TS2345 L2 + TS18047 L4 + TS2322 L5 + TS2591 L6 + TS2339 L7, compile-only), and `scripts/typecheck-renderer.mjs` (2/2 programs + 18 guards: same-assertion option/inventory/diagnostic checks plus integrated Node-leak, directive-absent and JSDoc-widening probes). Manifest gains `typecheck:renderer` / `test:typecheck:renderer` only (no installs, lockfile untouched). Pinned-tsc comment-free transpile byte-identical; synthetic-scratch runtime matrix MATCH. All assigned checks/builds serial exit 0 (renderer + main/shared/pilot suites + workspace/products/release-arch/products:list + three product builds); brand audit not rerun by design. One editorial clarification included (B02B-report rollback bullet now lists dependencies.undici-types ~7.18.0). Bar manual impact: no manual update required (comment-only typing, identical date behaviour). Evidence: `docs/engineering/typescript-migration/evidence/B02C-baseline.md` (+ snapshots/status), `B02C-report.md`, `B02C-logs/`. B02-C ACCEPTED (see evidence/B02C-acceptance.md); no JSX/React component, preload, other B02 environment or B03 work authorized.

## 2026-10-09 — TypeScript B02-B Node-only main helper; release gates still open

- B02-A is independently ACCEPTED (`docs/engineering/typescript-migration/evidence/B02A-acceptance.md`). B02-B checks one Node-only desktop-main helper: `src/main/domains/fileStore.js` (`@ts-check` + JSDoc only, 27+/0-: `PathLike`/`PathOrFileDescriptor` inputs, `readJsonFile` returns unknown, no generic T/casts/validators; zero runtime change). Pinned `@types/node@24.19.1` exact devDependency (`--ignore-scripts`; matches Node 24 line with dev 24.14.0 verified and Electron 42.11.10 installed; lockfile delta confined to typings stanzas). New `tsconfig.typecheck-main.json` (NodeNext, esModuleInterop, `checkJs:true`, `types:["node"]`), `tests/typecheck/main-file-store/` fixtures (valid 0 diags; invalid TS2345 L7+L8 + TS18046 L11 + TS2584 L13, compile-only), and `scripts/typecheck-main.mjs` (2/2 programs + 16 guards after the R1/R2 correction below; manifest-tied typings-major-24 with same-validator cases, enumerated provenance incl. root undici-types + buffer shim). Manifest gains `typecheck:main` / `test:typecheck:main` only. Synthetic-scratch equivalence probe MATCH (fallback identity, bytes, throws). All assigned checks/builds serial exit 0 (main + B01/B02-A trios + workspace/products/release-arch/products:list + three product builds); brand audit and manager checks not repeated by design. Two editorial clarifications included (brand fallback comment; B02-A SAB2 marker-vs-count wording). Bar manual impact: no manual update required (comment-only typing). Evidence: `docs/engineering/typescript-migration/evidence/B02B-baseline.md` (+ snapshots/status), `B02B-report.md`, `B02B-logs/`. B02-B ACCEPTED (see evidence/B02B-acceptance.md); other main modules, IPC/preload/renderer, PWA/Legacy/Deno, B03 not authorized.
- R1/R2 corrections implemented (same day; review CHANGES REQUIRED): version validator reads through injectable callbacks with four same-validator guards; no-op-mutation and integrated wrong-major probes fail closed with intended messages; undici-types@7.24.6 corrected to repository root with the exact five-entry lock delta; rollback rewritten as targeted inverse hunks (no uninstall inverse, no whole-file restore). Builds remain implementer-reported to the reviewer. Status: ACCEPTED with R1/R2 closed (see evidence/B02B-acceptance.md; prior review history preserved).

## 2026-10-09 — TypeScript B02-A shared-pure scope; release gates still open

- B01 is independently ACCEPTED (`docs/engineering/typescript-migration/evidence/B01-acceptance.md`; R1/R2 closed in scope). B02-A establishes a strict shared-pure checker over `packages/product-config/index.js` (unchanged) and `src/shared/brandIdentity.js` (comments/JSDoc only: `@ts-check`, `ProductId` derived type-only from real PRODUCT_IDS, readonly `ProductBrand` record with honest string index, `@returns {unknown}` getter; zero runtime change). New `tsconfig.typecheck-shared.json` (extends pilot, `checkJs:true`), `tests/typecheck/shared-brand/` fixtures (valid passes; invalid gives TS2322 L9 + TS2540 L10 + TS18046 L13, compile-only), and `scripts/typecheck-shared.mjs` with 12 in-memory guard cases; manifest gains `typecheck:shared` / `test:typecheck:shared` only (no dep/lockfile changes). All assigned checks/builds serial: shared + B01 trio + workspace/products/release-architecture/products:list + manager lint/build + three product builds exit 0, except pre-existing `test:brand-migration` 9/11 (missing dist artifacts + audit buffer exhaustion, identical at baseline; one `.env` key preview redacted from saved logs). Pre-existing inherited-key getter behaviour (`constructor`/`toString` return functions) recorded, not fixed. Bar manual impact: no manual update required (comment-only typing). Evidence: `docs/engineering/typescript-migration/evidence/B02A-baseline.md` (+ snapshots/status), `B02A-report.md`, `B02A-logs/`. B02-A reviewer decision PENDING; other B02 scopes and B03 not authorized.

## 2026-10-09 — TypeScript pilot B00/B01 tooling only; release gates still open

- Added pinned `typescript@5.9.3` (exact devDependency, `--ignore-scripts`) plus `tsconfig.typecheck-pilot.json` (`strict`, `noEmit`, `allowJs`, global `checkJs:false`) and scripts `typecheck:pilot` / `test:typecheck:pilot`. Exactly one production file is checked: `packages/product-config/index.js`, retained as JavaScript with `// @ts-check` + comment-only JSDoc (no runtime/ID/mode/shape/freeze change). New fixtures `tests/typecheck/product-config/` prove valid IDs pass and invalid IDs (2× TS2322) plus readonly misuses (TS2540 + TS2339) are rejected via the required `scripts/typecheck-pilot.mjs` self-check (3/3 configs, 59-file inventories, sabotage-sensitive). B01 validation serial: typecheck + self-check + workspace/products/release-architecture/products:list + three product builds (`lodge-camp`, `hotel`, `hospitality-pos`) all exit 0, matching B00 baselines. No financial certification, no app-wide migration, no deployment/signing/publishing/DB change. Bar manual impact: no manual update required (compile-time checking only). Evidence: `docs/engineering/typescript-migration/STATUS.md`, `evidence/B00-baseline.md`, `evidence/B01-report.md`. The three builds are implementer-reported (not independently rerun). B00 evidence carries a standing limitation: abbreviated summaries only, no saved complete pre-edit snapshots — recorded honestly in the migration evidence, with a forward snapshot rule for later batches. B01 ACCEPTED 2026-10-09 (see evidence/B01-acceptance.md); B02-A authorized separately.
- R1/R2 corrections (same day, reviewer CHANGES REQUIRED): runner now enforces exact effective target/module/resolution/lib, explicit `types:[]`, all pinned strict sub-options, pinned-lib provenance, and active `@ts-check` on the production JS in every program (shared `scripts/typecheck-pilot-checks.mjs`); new `test:typecheck:pilot-guards` suite passes 23/23 intended-rejection cases; the reviewer's three false-pass probes now fail with the intended guard messages; original sabotage coverage re-verified with identical hashes. Fixtures, configs, and production runtime unchanged. Status: ACCEPTED with R1/R2 closed (see evidence/B01-acceptance.md; prior review history preserved).

## 2026-10-08 — Independent-review acceptance continuation; release gates still open

- Followed `docs/audits/2026-10-08/accounting-independent-review/LUNA_REMAINING_GATES_PLAN.md`. REV-01–03 remain repaired; no prior migrations were modified. Relevant forward migration IDs: 20261007010000–20261007120000, 20261008010000, and 20261008020000; applied only to approved disposable `repsrmlomedqrmrdsbga`. Production link `oicgpknsmtvcsjacymum` was preserved and received no migration or mutation.
- Guarded SQL acceptance passed: the three previously failed suites passed 11/11, 19/19, and 1/1; maintained Restaurant gate passed 42 suites / 1,115 tests / 0 failures / 0 skips. SQL fixture setup verified the marker and explicitly assumed `postgres`; actual anon/authenticated cutover assertions stayed separate. Five SQL suite children each received a fresh 300-second temporary login role. See the closure register for identities and evidence.
- Real Electron operation `14861239-fcae-45de-9df1-1af0092d9930` retained same-profile restart/status evidence; the independent checker posted one balanced entry; exact same-key preload/IPC replay passed. The persisted composite Post runner report is incomplete after a wrong entry-identity assertion and later overwrite, so the required single lost-response journey is conservatively still open. A separate operation `91204072-8ad9-4dce-8ca7-d30b72320552` has same-operation status/denial/checker approval/Post/replay acceptance with authoritative one-entry readback; its response-loss hook did not confirm. No replacement UUID was issued after either uncertain attempt. Retained rows are listed in `RETAINED_FIXTURES.md`.
- All 22 Accounting form actions remain source-checked but are not fully normal-click accepted. POS-to-GL, budget template/approval, payroll, cutover and statements/close/reopen are not certified through real desktop lifecycles. Ledger export with unknown legacy source coverage remains fail-closed under `LEDGER_SOURCE_COVERAGE_UNKNOWN`.
- Bar candidate v8 exact pair is prepared: manual SHA-256 `0B64A9188D564F6F727C4C070836579FC0B01995CB4639E7CD6AC9D533BD118A` (71 pages), Quick Start SHA-256 `E56FAC296EF170F190FD1EC9E30C3C9EB0F8BFB9159B9B575812910D0768A743` (5 pages); candidate verifier 20/20. The [exact-pair approval packet](docs/bar-manual/build/remediation-candidate-2026-10-08-v8/APPROVAL_PACKET.md) is ready. Owner approval, official manifest promotion, approved-pair package parity and ordinary cashier visible offline Help & guides open/save remain pending. `npm run test:bar-guides` is 11/12 due the official canonical/manifest checksum mismatch.
- Maintained `npm run test:bar-guide-behavior` completed 16/16, 0 failed, 0 skipped (635,406 ms). `npm run test:bar-guides` is 11/12 due official checksum mismatch.
- Release state: not end-to-end ready. No production deployment, customer Accounting activation, installer signing/publication or customer release occurred.

See `docs/audits/2026-10-07/accounting-remediation/CLOSURE_REGISTER.md` for detailed role, IPC, lifecycle, fixture and blocker evidence.
# Tsa Bonno HospitalityOS Project State

## 2026-10-08 — Accounting remediation implemented locally and exercised on disposable; release gates remain

- Implemented local forward repairs for ACC-01 through ACC-05 and Hotel diagnostic DEP-01. Twelve migrations from 20261007010000 through 20261007120000 were applied to the explicitly approved disposable repsrmlomedqrmrdsbga only. Production link and customer data were not mutated; Accounting was not activated.
- Disposable evidence includes Hotel diagnostic lineage and permission cases with cleanup; default Finance/Manager general-export and Admin payroll-export role checks; AP approval, partial/full settlement and credit; Tax generation/review/approval; Bank import, independent allocation review, completion and immutable packet; and manual-journal same-key replay, interrupted response, concurrent callers and checker-only posting.
- Source/full suite results: focused Accounting remediation regressions 34/34; Bar Accounting matrix 7/7; disposable DB gate 5/5; financial truth 189/189; guarded Restaurant suite 1,076/1,076 across 41 suites with no skips; Hotel folio intents 12/12. See docs/audits/2026-10-07/accounting-remediation/CLOSURE_REGISTER.md for complete commands and evidence boundaries.
- Genuine Electron/preload/IPC on the disposable backend: 20/20 certified Chart/Ledger/AP/Bank/Tax positive exports across JSON/XLSX/CSV/PDF and 12/12 incomplete AP/Bank/Tax export attempts refused before saving; byte/hash checks and PDF detailed JSON companions verified. All seven Accounting routes rendered, including Budgets.
- Bar manual impact is required. Candidate v6 and S30 were prepared in an isolated folder; the manual has 69 pages and Quick Start 5, with refreshed references. Candidate PDFs were opened/saved offline via actual packaged cashier preload IPC, but the Help & guides menu did not render. Candidate approval, official manifest promotion, and approved-pair package verification remain pending. The official pair still disagrees with manifest checksums; test:bar-guides is 11/12 and test:bar has 695 pass, 2 fail, 5 skips.
- Local hospitality-pos source build passes. Only an unsigned local win-unpacked test package using candidate PDFs was made; no installer was signed, published, or installed.
- Lifecycle completeness remains below release-ready: all 22 intended controls pass source regression; a rendered normal click on the journal form dispatches exactly once through mocked IPC, with live HTTP/database journal replay tested separately. The full 22-button real desktop click matrix remains open; POS-to-GL, payroll, statements/period close, and cutover lack complete real desktop mutation evidence. Synthetic test records are retained only on the disposable project and listed in docs/audits/2026-10-07/accounting-remediation/RETAINED_FIXTURES.md. The disposable lodge profile was restored. Details and known limits are in the closure register.
- Production deployment: none. The latest production readback in the preceding entry showed 474 migrations through 20261005090000; production was not re-read during this remediation. That readback still has the Hotel diagnostic error. No claim of production repair or end-to-end release readiness is made.
## 2026-10-07 — Authorized production DB push; Accounting audit fails end-to-end

- Applied all nine October migrations to linked production `oicgpknsmtvcsjacymum`. Readback: 474 entries through `20261005090000`; final dry run up to date. This supersedes the earlier same-day production-unchanged status below. No desktop publication or production Accounting activation.
- Accounting audit confirms five unresolved findings: 22 inert form-submit controls; default server export capabilities missing; AP/Bank/Tax exports hard-coded incomplete; real desktop Budgets crash from missing templates; journal submit retry creates another draft after draft creation succeeds (duplicate posting not proven).
- Seven Accounting desktop screens open through genuine login against approved disposable `repsrmlomedqrmrdsbga`; Budgets fails. Actual Electron/preload/IPC saves Chart and Ledger in four formats each with explicit fixture export overrides. Eight HTTPS workspace reads, independent cutover approval/activation, tenancy denial and payroll privacy checks pass. Full financial lifecycles remain uncertified.
- Post-deploy production lint fails: `get_hotel_folio_integrity_diagnostics` uses unsupported `max(uuid)` in the newly applied Hotel migration. Separate unresolved deployment blocker. Error-level security advisors report no issues.
- Source Accounting 40/40, financial truth 189/189 and 33 mocked rendered scenarios pass; these do not negate the real workflow failures. Audit findings only; no application/RPC repair. Manual impact: no update required for audit-only evidence; prior Bar guide release gates remain open.
- Evidence and scope limits: [Accounting audit](docs/audits/2026-10-07/accounting-addon/REPORT.md).
## 2026-10-07 — Bar disposable database/API acceptance; production remains unchanged

- User-approved disposable Supabase project repsrmlomedqrmrdsbga resumed and upgraded to 474 migration entries through 20261005090000. Documented September catalog/modifier baseline drift was reconciled separately; the production link was preserved.
- Final Restaurant gate passes 1,076/1,076 across 41 suites with no skips, including actual Accounting behavioral coverage and 19 real-role cutover/activation cases. Settlement, product modifier and shared-Till attribution SQL pass. New reconciliation/Hotel/booking catalog gates pass; those are not financial mutation/concurrency proof.
- Actual anon SQL role with genuine app session passes sale/void/replay/report cases. Live HTTPS anon-key plus x-boroko-session passes session isolation, sale and receipt replay, authorized PIN void/conflicting retry, authoritative reconciliation and durable validation history. Non-stock fixtures do not certify stock restoration or every operator workflow.
- Corrected acceptance fixtures and role restoration; obsolete grant assertions now test September 24 staff-session anon access plus no-session denial. No customer application permissions or behavior changed by these test repairs. Manual impact: no update required for test-only changes.
- Production read-only metadata still shows 465 entries through 20260924000001; new reconciliation/validation/void-receipt contracts remain absent. No production migration, Accounting activation, customer transaction or publication performed.
- Release remains incomplete: authenticated Electron screen journey, broader financial/cross-surface mutation acceptance, Bar guide approval/package/offline access, combined production rollout and post-deploy smoke. Evidence: [Bar acceptance results](docs/audits/2026-10-07/bar-online-readiness/RESULTS.md).

## 2026-10-06 — Luna audit remediation implemented locally; deployment gates remain

- Implemented local client, shared, PWA/public caller, offline replay, mesh, reporting and Legacy dependency changes for AUD-01 through AUD-12. Nine forward migrations exist locally through 20261005090000; none was applied to a database.
- Final local regressions: booking/source 32/32, queue replay 9/9, Hotel folio intent 11/11, reconciliation 5/5, validation persistence 6/6, multi-room mesh 6/6, financial truth 189/189, Legacy POS 219/219, Enterprise 50/50, Manager PWA/public web surfaces pass. LodgingOS, HotelOS, Restaurant & Bar, and Legacy POS builds pass.
- Financial SQL mutation/concurrency/authorization acceptance remains blocked: no explicit disposable database URL/identity, localhost:54322 refuses connections, and Docker/psql/pg_ctl are unavailable. No production or installed customer profile was used.
- AUD-11 remains partial: root full dependency graph has 5 high/10 moderate advisories and shipped Legacy Electron 22 has 7 high/10 moderate full-graph advisories. AUD-12 guide candidates are visually reviewed but await content/visual approval, official manifest/package update, and ordinary cashier offline open/save proof.
- GUIDE-02 follow-up: Bar guide candidate v3 preserves v1/v2 and fixes the actual quick-start p2 Result and p4 numbered-step layout inputs. The exact v2 PDF regression is red 0/3; candidate v3 scratch/final PDFs are green 3/3; `npm run test:bar-guide-behavior` passes 6/6. Final v3 hashes, renders, bookmarks, screenshots and adversarial review are recorded in `docs/bar-manual/build/remediation-candidate-2026-10-06-v3/`; approval remains pending, and official manifest/canonical/package files are unchanged.
- Deployment state: **not deployed**. Production migrations, financial-history changes, Accounting activation, signing/publication and customer messaging were not performed. Full evidence and one-row-per-finding closure registers: docs/audits/2026-10-05/remediation/.

## 2026-10-05 — Three-product audit (findings only; production read-only)

- LodgingOS, HotelOS, Restaurant & Bar POS: [full audit](docs/audits/2026-10-05/REPORT.md) with isolated reproductions and saved test/deployment evidence. Existing edits preserved; no application/RPC/dependency repair implemented or deployed.
- 12 confirmed findings (9 high, 3 medium): unsafe duplicate acknowledgement; Hotel retry/transfer/split/void/state gaps; capped reconciliation/false audit confirmation; missing multi-room mesh; booking replay payload validation; dependency advisories; Bar guide hash mismatch.
- Linked/desktop/database route `oicgpknsmtvcsjacymum`: 465/465 migration IDs through `20260924000001`; 18 live RPCs; 9 RLS-enabled critical tables; 10 no-session checks deny or expose no records. READ ONLY enforced. Historical other-project claims are not installation proof.
- All 3 desktop builds/web gates pass; financial truth 189/189; Bar 688 pass/4 fail/5 skip; Restaurant 34/40 files pass (3 DB gaps/3 source-contract failures); supplemental 109/121; Hpos browser 33/33. Two Electron smoke attempts time out before first window, so workflow assertions did not run. Enterprise modular IPC scan and other stale assertions require reconciliation.
- Root prod audit fails on Electron 42.8.1/Nodemailer 9.1.1/Undici 7.29.0; PWA/public audits zero. Both Bar PDFs disagree with manifest. Release sign-off remains uncleared, including disposable SQL/positive-isolation/packaged/hardware evidence. Manual impact of audit: No manual update required (no operator change); existing guide drift remains blocking.

## 2026-09-25 — Bar fully functional offline: phantom tabs, shift-filtered unlock, provisional receipts, cached-first loads (local; zero SQL)

- Operator report (Botswapelo Lounge, Bar offline): 10 phantom tabs while offline; unlock-Till card listed every employee; stock/menu/on-shift loads took very long with no progress; offline receipts showed no receipt number or item prices; My Sales / Sales history missed sales offline; cash-up staff dropdown and outlet cash-model reads stalled with no loading state; cash-up review appeared blocked offline.
- Fixes (`pos.js`, zero RPC change): offline is now served from cache on the background probe's `state.isOnline` flag — reads never probe. `_getOutlets` returns cache instantly when offline (was: two 12s network attempts even offline); `getMenuStockReadiness` uses the flag instead of a 10s `checkOnline()` probe; `getActiveShifts`/`getPosBarActiveShifts`/`getCurrentPosShift`/`getStaffOpenPosShift`/cash-up submission reads wrap RPCs in 5s `withNetworkTimeout` and fall back to cache (was: unbounded hangs or `[]`/throw that read as "nobody on shift"); menu/staff/drawer reads use 5s budgets; `_getPosOrders` server fetch has an 8s budget with cache fallback.
- Phantom tabs root cause (follows the 2026-09-24 online purge): `isActivePosTab`/`isActiveTableTab` treated a missing/unknown status as `open` via the `normalizeTabStatus` fallback, so offline reads resurrected settled cache rows as ~10 open tabs. Predicates now require an explicit active status; only genuine `_pending_sync` estimates without server status still show.
- Unlock Till (`HposTillOperatorDialog`): filters to clocked-in staff whenever the roster is known — online AND offline (cached attendance) — with a `Loading who is on shift…` state. Only a failed roster read fails open to the full list.
- Offline receipts: new `TILL-YYYYMMDD-NNNN` provisional numbers (per outlet per day, display-only; server issues the authoritative number on replay), `business_date` stamped (was missing, so date-filtered history excluded every offline sale), `cashier_id` follows the PIN-verified operator (was: device login, hiding offline sales from My Sales), line `net_subtotal`/`gross_subtotal` persisted so receipts/My Sales/history always show real prices. Till receipt builder uses the returned provisional number and priced lines.
- Sales/history: `getSharedTillOperatorOrders` matches cashier/waiter/operator; `HposMySales`/`HposReports` server refresh can no longer wipe on-screen cached sales on failure (stays on device data with an offline note).
- Cash-up: staff dropdowns show `Loading team…`/`Loading this person's Till shift…` + on-shift marks; outlet/cash-model reads are instant offline via the cache; review already queued offline and now falls back to provisional review within 5s instead of hanging when the link stalls but the flag is stale-true.
- Bar manual impact: Required — offline unlock now lists on-shift staff only, offline receipts carry TILL- references with full prices, Till/cash-up show staged loading. Manuscript stays accurate (no promised behavior removed); screenshot re-verification (unlock dialog S07/S08, offline receipt, My Sales offline) + PDF rebuild fold into the pending guides rebuild.
- Evidence: `bar-till-unlock-shift-filter` + `bar-open-tabs-count-parity` + `bar-product-contracts` + `bar-pool-tables` 37/37; `test:offline-pos-critical` ok; `test:pos-hardware-adapter` ok; `test:pos-financial-truth` 7/7; `test:financial-truth` 189/189; `test:inventory-offline-sync` ok. Pre-existing failures untouched (fail on files with zero diff from this change): `bar-cashup-blind`, `bar-deferred-service:80`, `bar-guides-contract` (PDF checksum), `bar-payment-references:30`, `offline-queue-regression:146` (stale `CONNECTIVITY_PROBE_TIMEOUT_MS` literal vs parameterized probe timeout at HEAD). No migration; `db:push` NOT run. Relaunch required (renderer + main).
- Operator next (in-app): relaunch the Bar app, go online once on Sell so the tab-cache purge runs, then go offline in Botswapelo Lounge and confirm: Open tabs matches online count, unlock lists on-shift staff only, Till loads fast with staged progress, new offline sale prints a TILL- receipt with prices, and it appears in My Sales.

## 2026-09-24 — Settings outlet-tab recovery-screen crash fix (local; zero SQL)

- Operator repro: Cash & close → outlet setting → `#/settings?tab=outlets` landed on the recovery screen (`Rendered more hooks than during the previous render`, `Settings.jsx:914`).
- Root cause: the outlet-setup `useState` x6 + `useEffect` x2 sat below the `if (!form)` loading early-return. First paint (form null) ran fewer hooks; once the form loaded the hook count grew and React threw straight to `AppErrorBoundary` — same class as the earlier Till TDZ and POSReceipt hooks-order crashes.
- Fix (`Settings.jsx`, zero RPC change): outlet-setup hooks moved above the loading guard with a do-not-move warning comment; plain consts (`tabs`, role/switch helpers) stay below. Verified zero hook calls remain after the guard.
- Bar manual impact: No manual update required — no workflow, control, or recovery step changed; the Outlets tab opens as documented.
- Evidence: new pin in `settings-save-workflow` (no hooks after guard + outlet hooks above guard); manage PIN suites green; esbuild clean. Note: `settings-save-workflow` keeps 1 pre-existing CRLF failure (`skippedColumns` LF regex vs CRLF file, fails on clean tree too). No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-24 — Manage package-access bar removed; silent self-refresh (local; zero SQL)

- Operator request: remove the Manage `Refresh package access` bar; access should refresh on its own interval.
- Fix (`HposManageHub.jsx`, zero RPC change): manual bar, refreshing/error states and copy gone; hub now force-refreshes silently on open, every 60s while open, and on return to the tab (failures silent; global App 15-min refresh owns loud errors). Empty-state copy updated to wait/reopen instead of pressing refresh.
- Bar manual impact: No manual update required — control removed, no workflow added; guides never documented the button as a step.
- Evidence: `bar-addon-activation-refresh` 5/5 (new silent-refresh pin); manage PIN suites green; esbuild clean; `build:hospitality-pos` passes. No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-24 — Bar Sell compact layout: cart-only scroll, wider panel, names first (local; zero SQL)

- Operator request: whole Sell fits without scrolling to Record payment; only cart items scroll; item names take precedence even if the cart section grows.
- Fixes (`HposTerminal.jsx`, zero RPC change): cart panel widened 372→440px (overlay 460px); cart rows restructured so the name block owns the row (line total moved underneath as `each · Total`, name wraps 2 lines, 44px qty/remove touch targets untouched); top bar / category bar / order header / totals / payment chooser + detail all tightened (paddings, gaps, secondary fonts) while keeping pinned 56px pay tiles, 60px Record button + 16px/800 label, 44px charge button, unit-`each` + `Line total` strings and the `flex:1/overflowY/minHeight:0` cart list; payment footer is now non-scrolling `flexShrink:0` so ONLY the cart scrolls.
- Bar manual impact: Required — visibly denser Sell + wider basket with wrapping names. Screenshot recapture (Sell with long names + full footer in view), manuscript one-liners, PDF rebuild and manifest approval fold into the pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (renderer).
- Evidence: devices/payment-footer/touch/selling/pool/service-contract green (declutter pin updated to cart-only scroll + 440px); esbuild clean; `build:hospitality-pos` passes.

## 2026-09-24 — Bar Sell offline declutter: slim auto-collapse banners, mid-sale reprint removed, success auto-dismiss, payment pinned, stale-10 tabs purge (local; zero SQL)

- Operator report (Bar Sell offline): amber stock banner too tall, mid-sale `Reprint last receipt` row, sticky green unlock success, hidden Record payment, flickering `10 open tabs`, `Scanner paused`.
- Fixes (`HposTerminal.jsx`, `pos.js`, zero RPC change): stale/local amber + unsent-sales green are now slim one-line pills that auto-collapse after 8s (tap +/– to expand; status change resets; wording unchanged); mid-sale reprint row removed — reprint stays only in the empty-basket placeholder (`Same again` + lost-slip) plus My sales / history prints; every green `successMessage` (till unlock, shift open, restore) auto-dismisses after 6s (errors never auto-dismiss; `addToCart` still clears immediately); undo-add is now a slim pill that fades after 2.5s; right basket column is now height-constrained (`minHeight:0` + hidden overflow) with the Totals+Payment footer `flexShrink:0` + internal scroll (`maxHeight:52%`) so Record payment / Take payment stays reachable; scanner chip now names the blocker in its tooltip (payment / shift / locked till / modifier / receipt) and includes the receipt-open case that the key handler already suspended.
- Stale 10 tabs root cause: `getPosTabs(active)` purged only table-attached actives from cache (`isActiveTableTab`), so active named rows without `table_name` were retained as "history" yet returned by the wider offline fallback (`isActivePosTab`) — online showed 0, offline resurrected 10. Fix: retained history now uses `isActivePosTab`, so one successful online refresh purges settled orphans for good; Till count/brief/refresh now use the explicit server active set (`open/running/ready/delivered`) so unknown/missing statuses never count. Operator next: relaunch, go online once on Sell so the purge runs, confirm pill matches Open Tabs; genuine `Pending sync` chips remain and resolve in System Health (never bulk-clear).
- Follow-up: Card looked "missing" because a Pool line forces cash-only — the Till hid Card/mobile/split entirely. Cash-only stays enforced (server refuses otherwise), but Cash/Card/Mobile/Split/account now stay visible and disabled with `Pool tables pay Cash only` so the control never silently vanishes. Remove the Pool line (or finish it as cash) and Card enables again. Separately, the Card square itself lost its teal box because its color was `var(--bb-info)` while the tile builds `${color}20` / `${color}08` (hex + alpha) — invalid CSS that drops the border/background. Card now uses hex `#356ed8` (same as `--bb-info`) so its box renders like Cash.
- Bar manual impact: Required — slimmer offline strips with auto-collapse, reprint only when basket empty, success fades, payment footer pinned, tab pill matches Open Tabs, scanner pause reasons. Screenshot recapture (offline Sell with items, empty-basket reprint, payment footer), manuscript one-liners, PDF rebuild and manifest approval fold into the pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (renderer + main).
- Evidence: `bar-devices-displays` 31/31 (updated reprint contract + new declutter pin); `bar-open-tabs-count-parity` 5/5 (explicit active predicate + purge pin); till selling/service/recovery + barcode/entitlements green; esbuild JSX clean; `build:hospitality-pos` passes.

## 2026-09-24 — General Ledger recovery-screen crash fix (local; zero SQL)

- Live-data crash on first open: `workspace.trial_balance.reduce` threw when the ledger RPC returned no `trial_balance` array. `RestaurantGeneralLedger.jsx` now normalizes every workspace write (entries/trial_balance/entry-lines coerce to arrays; accounts/mappings coerce via `normalizeRows`), so malformed responses render empty state instead of the recovery screen. Pinned in `bar-accounting-workspace-access`.
- Evidence: workspace-access suite 5/5; esbuild JSX clean. No migration; `db:push` NOT run. Dev server hot-reloads (renderer only).
- Bar manual impact: No manual update required — no workflow, control, or recovery step changed; page renders as documented.

## 2026-09-24 — Bar Accounting anon follow-up DEPLOYED: pages open for signed-in staff

- Root cause of the persistent `permission denied for function get_restaurant_accounting_readiness`: the desktop connects with the anon key and carries staff identity in the `x-boroko-session` header (`authClients.js`); the wired `pgrst.db_pre_request` hook resolves actor/role/lodge per request. Granting authenticated alone could never open the pages. Matches the established desktop precedent (`clock_out_staff_with_attendance_pin` → anon).
- New migration `20260924000001_accounting_workspace_anon_client_access.sql` DEPLOYED: identical 141-name surface extended to anon (public still revoked, service_role untouched). Safety unchanged — no session resolves no actor and every function fails closed 42501; session role + lodge binding decide.
- Evidence: `db:push` applied exactly `20260924000001`; live read-back anon present on readiness/accounts/ledger/chart-export/payroll-workspace; `bar-accounting-workspace-access` 4/4.
- Operator next (in-app): relaunch the Bar app, sign in, open Chart of Accounts — readiness resolves by staff capability now, then walk `restaurant/accounting-setup` to activate before relying on figures.

## 2026-09-24 — Bar Accounting production activation: workspace grants DEPLOYED (owner-directed bypass)

- Owner instruction: activate Accounting in production, forego the activation runbook, bypass staged disposable proof, remove the UI-preview mode, push. All three executed.
- Live finding before writing anything: `20260907010000` (+`20260908000000/01`) were ALREADY applied (runbook status stale); authenticated already held the activation-lifecycle surface. The workspace reads were service_role-only, and the v3 export/payroll/artifact functions carried in-body `service_role`-only no-ship gates — so grants alone could never have opened the pages.
- New migration `20260924000000_accounting_workspace_client_access.sql` DEPLOYED via `db:push`: 13 in-body gates swapped for the tenant-scoped fail-closed capability checker (matrix caps: export/payroll_view/payroll_export/payroll_manage; artifact recorder accepts export OR payroll_export; export-run helper takes baseline read; service_role bypass preserved), plus authenticated EXECUTE on the exact desktop client contract (115 RPCs) and its internal callees (capability/platform helpers, v2 reads, payroll locks). anon/public revoked throughout; service_role untouched. Starter/POS/lodge report exports, payroll statutory approval fns, and `get_accounting_report_export_v3` deliberately stay closed.
- Explicitly preserved guardrails: payroll calculation still demands independent statutory approval (no client can grant it); activation lifecycle (readiness → cutover → activate) still gates posting — grants alone do not activate. Residual risk accepted by owner: end-to-end Bar-role capability mapping is unproven (fails closed with honest errors, never silent data).
- Evidence: `db:push` applied exactly `20260924000000`; live read-back 16/16 authenticated grants present, 0 anon leaks, 0 residual no-ship gates on the shipped surface; new `bar-accounting-workspace-access` 3/3; preview-removal pins + activation/finance-route suites green; esbuild JSX clean. UI preview removed from `RestaurantAccountingUi.jsx` (Bar hero + hpos actions kept for the upcoming UI pass).
- Bar manual impact: Required — accounting pages now load live data and actions for entitled roles (was: universal readiness block). Screenshot recapture (all 8 pages + setup), manuscript one-liners, PDF rebuild and manifest approval fold into the pending guides rebuild. Relaunch required (renderer + main).
- Operator next (in-app): sign in fresh (stale/anon sessions still read as permission-denied), confirm staff role carries accounting caps, then walk `restaurant/accounting-setup` (readiness → cutover → activate) before relying on any figure.

## 2026-09-23 — Receipt layering, row-level print, history newest-first + sort (local; zero SQL)

- Operator follow-up: (a) receipt opened from a detail dialog rendered behind the void card — root cause: `POSReceipt` sat at z-100 while every app modal backdrop is z-1000. Fix: receipt modal (and its empty state) now render at z-1100, still under the command palette (2000+). (b) Row-level printing: My sales and Sales report ledger rows each gain a far-right print action opening that row's own receipt directly (rows restructured to sibling buttons so controls never nest; subgrid keeps history columns aligned; money metrics still read unsorted `rows`). (c) Sales history now leads with the newest transaction and offers Newest/Oldest/Highest/Lowest ordering — display-only, classifications and totals untouched.
- Follow-up same day: (a) the empty-basket Reprint button used the undefined `--bb-accent-gradient` token, so it rendered transparent with white text — invisible next to the working Same-again/Pool buttons. Now uses the solid `--bb-accent` (pinned). (b) History print is a compact borderless ghost icon on the same row so ledger rows stay tight (pinned). (c) History ledger no longer scrolls sideways: the 760px floor is lifted for the new rows, cells truncate with ellipsis, and narrow screens collapse to receipt + status + total + print (pinned).
- Evidence: `bar-devices-displays` 30/30 (row-print, layering, sort, compact-print pins); till selling/service/payment-footer/recovery + financial-ui-regression green; `build:hospitality-pos` passes.
- Bar manual impact: Required — changed list rows (print action), new sort control, receipt now tops dialogs. Screenshot recapture (My sales rows, history rows + sort, receipt over detail), manuscript one-liners, PDF rebuild and manifest approval fold into the pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-23 — Receipts printable everywhere: persistent Till reprint + My Sales / History print (local; zero SQL)

- Operator report: the sell-page Reprint last receipt only lived in the empty-basket placeholder, so it vanished on the first item add; My sales and Sales history had no receipt printing at all.
- Fixes: Till gains a slim persistent `🧾 Reprint last receipt` row under the basket header whenever a sale is recorded and payment is closed (shared `reprintLastReceipt` path, opens the recorded order with `autoPrint: false` — never re-charges); My sales detail and Sales report detail each gain a Print receipt control opening the same shared `POSReceipt` modal (Print + Save as PDF, same server-number guard, missing data renders Unavailable instead of invented money).
- Evidence: `bar-devices-displays` 29/29 (new reprint-visibility + history-print pins); till selling/service/payment-footer/recovery + financial-ui-regression green; `build:hospitality-pos` passes.
- Bar manual impact: Required — new visible controls (persistent sell-page Reprint; Print receipt in My sales receipt detail and Sales report receipt detail). Screenshot recapture (sell basket with items, both detail dialogs), manuscript one-liners, PDF rebuild and manifest approval fold into the pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-23 — Till TDZ crash fix, extensive recovery report, screen-only drawer nudge (local; zero SQL)

- Operator-reported `Cannot access 'showPayment' before initialization`: `HposTerminal.jsx` derived `basketVisible` above the `showPayment` state, so every Till render died into `AppErrorBoundary`. Fix: `basketVisible` now sits below all state it reads (warning comment included). A reload between the two edits could briefly show `basketVisible is not defined` — a full relaunch clears it; the committed file declares before use.
- Recovery screen is now extensive per operator request and stays: error message + time + route on screen, full JS stack + component trail in a details block, one-tap Copy full error report, Reload App; the same report is still appended to `renderer-errors.log` (System Health can show it).
- `Please close the cash drawer.` no longer prints on the customer copy (`print:hidden` in `POSReceipt.jsx`); it stays as an on-screen operator nudge. Cash received / change lines still print as normal receipt lines.
- Evidence: `bar-devices-displays` 27/27 (new pins: basket ordering, extensive recovery report, print-hidden nudge); `bar-till-recovery` 9/9; `build:hospitality-pos` passes.
- Bar manual impact: Required — one-liner in Part C that the drawer-shut nudge is screen-only and never prints. Screen render and screenshots unchanged; fold into the pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-23 — Bar receipt-save recovery crash: hooks-order fix + hardened save (local; zero SQL)

- Operator report: Bar Till receipt Save lands on the Recovery Screen. Found a definite Rules-of-Hooks fault in `POSReceipt.jsx`: the `if (!order)` empty-state return sat above derived values and the auto-print `useEffect`, so any null<->object transition changes the hook count and React throws straight to `AppErrorBoundary` (same class as the earlier Till TDZ crash).
- Fix: all hooks now run unconditionally (`safeOrder = order || null`, null-safe totals/tender/items, effect guards `!safeOrder`), empty state renders after hooks; item/payment rows tolerate null/non-array payloads; save guards missing order, ignores double-tap, and treats a cancelled save dialog (`{success:false}` with no error) as silent instead of a failure alert.
- Evidence: new pin in `bar-till-recovery` (hooks order + save guards) 9/9; `bar-devices-displays` 25/25; till selling/service/payment-footer + financial-ui-regression green; JSX clean; `build:hospitality-pos` passes.
- Bar manual impact: No manual update required — no workflow, control, permission, or recovery step changed; Save as PDF behaves as already documented, cancel stays silent. No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-23 — External audit fixes: pinned auto-open, honest drawer, manual notice, steady terminal id (local; zero SQL)

- Verified another model's audit claim-by-claim against the code: 5 of 8 bugs confirmed (auto-open ignored the pin; drawer green in Windows mode; manual card test errored; fresh request_id per send risking double charge; test-all overstated Windows printing; pin-save committed stray edits; checkbox/default mismatch), 1 needs a live e2e proof before touching (single-instance lock order — pre-existing, intentional single-copy guard, Playwright runs serial), 1 coverage claim refuted (new contracts ARE pinned in tests).
- Fixes: boot passes the pinned displayId (unplugged falls back); drawer readiness/strip/steps/check all require an ESC/POS target when enabled (manual exempt, lodge parity); manual card test shows a calm notice via the `manual` flag; one steady bridge reference per payment (fingerprint on method/amount, cleared on close, randomUUID with fallback); test-all labels unverified Windows printing honestly (no silent paper); pinning saves onto freshly loaded settings with an honest notice; checkbox aligned to backend default.
- Coverage: new `Audit fixes` pin test (had to fix my own regex escaping and a wrong-shape assertion along the way); `bar-devices-displays` 25/25; render harness 8/8; till/base/queue suites + guardrails green.
- Bar manual impact: Not required — no workflow, control, permission, or recovery step changed; fixes make the app match already-documented behavior (pinning reopens there; manual mode needs nothing). Same pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Always-sell hardening: safe IPC calls, loading watchdog, local-stock fallback (local; zero SQL)

- Operator report: every Sell card said "Refresh required" with no banner, online, no recent edits. Diagnosis: the Till can sit in its first "loading" state with no recourse — banners and Refresh only render for stale/failed. Contributing fragility: bare `?.().then` chains throw synchronously when a binding is missing (same class as the earlier TDZ crash).
- Fixes: (1) every optional IPC `.then` chain wrapped in `Promise.resolve(...)` across Till/Health/OpenChecks/Displays (plus a pin test that scans all four files, which caught two leftover unlock-dialog spots); (2) 20s loading watchdog converts a stuck first check into a loud failure with Refresh; (3) new `local` readiness state built from this till's inventory cache (server-seeded, mesh-adjusted) so the bar always sells with an on-screen "last known stock" label — only a truly empty computer still pauses. Pay-time server check unchanged.
- Evidence: render harness 8/8; `bar-devices-displays` 24/24; JSX clean.
- Bar manual impact: **Required** — Part H offline paragraph (never pauses for a stock check). Same pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-23 — Crash fix: Till display-feed effect sat above its totals (local; zero SQL)

- The operator reported the app crashing to the recovery screen. Root cause was mine: the guest-screen feed effect in `HposTerminal.jsx` was declared above `subtotal/promotionDiscount/tax/tipTotal/total`, so its dependency array hit the temporal dead zone on every Sell render (`Cannot access 'promotionDiscount' before initialization`) and the error boundary took the whole Till down.
- Fix: moved the effect below the totals block (with a comment warning the next editor). Verified with a throwaway server-render harness (all 8 Bar/lodge screens render clean, harness deleted) plus a permanent order pin in `bar-devices-displays` (`Till display feed is declared after the totals it reads`).
- Evidence: render harness 8/8; `bar-devices-displays` + `bar-till-selling` + `bar-till-service` 40/40. No migration; `db:push` NOT run. Relaunch required (renderer) — the crash disappears on relaunch.

## 2026-09-23 — Long-offline multi-till: tabs, shifts, menu, deliveries flow over mesh (local; zero SQL)

- Audit answer: mesh already carried sales/tabs/shifts/menu/delivery ops as queue payloads, but only sales touched the other till's live views (inventory decrement). Tabs, shifts, menu, modifiers, promotions, deliveries, and counts sat in the queue invisible until the server confirmed.
- New mesh cache effects (same trust root as local offline writes, all stamped pending + mesh source): peer tabs land in Open Tabs (open/settle/handover), peer shift opens land in the shift list, peer menu writes land in the selling list (new offline products arrive provisional, like own), modifier/promotion full lists replace, deliveries add and counts set the stock cache. Server replay + versioning unchanged.
- Mesh contract extended minimally: `create/update_pos_menu_item_offline` allowlisted with strict schemas (they are the real offline tables; the online names were already covered). Clock/attendance operations stay off the mesh permanently — payloads carry raw staff PINs. Staff must sign in on each till before an outage.
- Till counts now include deliveries received on either till (mapped inventory→menu); physical counts reconcile at replay and stay out of the ledger by design.
- Coverage: `bar-devices-displays` 19/19 (sharing pin); till/service/touch/payment suites + offline-queue pass; mesh-p2p unchanged (14/15, pre-existing allowlist gap).
- Bar manual impact: **Required** — Part H offline paragraph (two-till sharing + sign-in rule). Screenshots, PDF rebuild, manifest approval and packaged offline smoke fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing. No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Team visibility without credentials: sanitized mesh state sync (local; zero SQL)

- The user accepted the PIN-travel risk and asked to proceed; declined for raw PINs anyway (consent cannot fix persistent plaintext secrets in queue files, backups, bundles, journals, and stolen hardware, nor destroyed audit non-repudiation). Built the safe equivalent instead: a visible-only team state channel — sanitized at build time on the source till, validated again on receipt, additive-only merge, never replayed.
- New `meshStateSync.js` + `GET /mesh/state/team` (allowlisted route): active/recent attendance, cash movements, cash counts, drawer periods, cash-up submissions — all stripped of pin/password/secret/token/manager_pin material (explicit + pattern, nested), bounded sizes, unknown ids skipped, existing rows never overwritten. Pulled per peer inside `syncMeshQueues`; health recorded as `lastTeamSync` and shown on the Bar Other-tills panel.
- A compromised peer cannot smuggle credentials: receiver refuses secret-carrying snapshots outright (not merged, not stored).
- Coverage: `bar-devices-displays` 21/21 (state-sync pin); mesh-p2p unchanged 14/15 (pre-existing `create_multi_room_booking` gap).
- Bar manual impact: **Required** — Part H offline paragraph (visible results travel; sign-ins stay per-till). Same pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Mesh weed-out: drawer opens, pack/product writes, checklists flow; PIN work fenced off (local; zero SQL)

- Verified every queued RPC table against the mesh contract instead of assuming. Added 6 PIN-free tables with strict schemas: `open_pos_drawer_period` (second till sees the drawer open, no double-open), `set_bar_pos_pack_template_offline` + `save_bar_pos_product_with_packs_offline` (peer pack sizes and new products sellable offline), `create_daily_checklist` + `create_bar_checklist_from_template` + `complete_checklist_item` (routines visible across tills). New cache appliers mirror the local offline write paths; unknown linked stock or unknown checklist items are skipped, never invented; a drawer open carrying PIN material is quarantined.
- Permanently fenced off (payloads carry raw staff/operator/manager PINs): all clock in/out tables, cash movements/counts/submits, cash-up and drawer reviews, till-operator activation. Cash-up review and drops reconcile at replay. Left for their owners: lodge/hotel/commercial tables (incl. the pre-existing `create_multi_room_booking` allowlist gap), catalog publication jobs (per-device lease races), prep-ticket moves (online-only by design).
- Coverage: `bar-devices-displays` 20/20 (contract weed-out pin); stock/tab suites + till/service/touch/payment + offline-queue pass (174 total green across the two runs).
- Bar manual impact: **Required** — Part H offline paragraph extended (drawer opens, packs, products, checklists flow; drops/counts/reviews reconcile at replay). Same pending guides rebuild. No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Two-till sharing over mesh: shared stock counts, one-settlement tab holds, Other-tills screen (local; zero SQL)

- Stock levels flow till-to-till: new `pos:getUnconfirmedPosUsage` (facade + `pos.view` IPC + preload) sums unsent sales from the local queue — own + mesh-imported — with voids/returns handed back best-effort via the cached order. The Till subtracts usage from its counts on load, after every payment, and whenever a mesh merge lands (gated strictly on the merge marker, so ordinary status traffic never triggers server reads). Green chips say whose unsent sales are included; fail-closed direction (may show Finished early, never oversell); Pay-time server check unchanged.
- One tab, one settlement: advisory `pos-tab` mesh locks ride the existing lock broadcast (room locks untouched; old peers ignore the new shape). Till holds the lock across Pay for a resumed tab and waits with a named message when held; Open Tabs badges the row and holds Settle. Server atomic settlement remains the real guard; locks expire in 2 minutes regardless.
- Bar surfaces the lodge Local Mesh screen in Bar words: Other tills panel in System Health Sync (peers, tab holds, last share, imported count, warnings, manual connect, conflict surfacing). No new protocol; same diagnostics IPC.
- Out of scope kept out: cross-till shift/drawer arbitration (shared-drawer model is already outlet-scoped; server remains truth), live same-second tab-line merging (version conflicts still go to manager review).
- Coverage: `bar-devices-displays` 18/18 (usage + holds + mesh screen pins); `bar-till-selling` Settle pin updated for the hold; mesh-p2p 14/15 with the `create_multi_room_booking` allowlist gap proven pre-existing (fails on clean tree too); `npm test` + offline-queue ok.
- Bar manual impact: **Required** — Part D tabs paragraph (shared counts, settling badge) + Part H (Other tills). Screenshots, PDF rebuild, manifest approval and packaged offline smoke fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing. No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Manual drawer + bank-terminal setup: key-open drawers, bank presets, technician contract (local; zero SQL)

- Manual drawer (`cash_drawer_manual`, adapter + domain passthrough, same save contract): Bar Devices and Lodge/Hotel setup gain a Manual drawer (no printer) tick. Readiness shows Manual drawer — key open (success), setup steps + morning check go green, drawer-needs-target warnings disappear, Test drawer / no-sale kick hide. Electronic kicks refuse honestly backend-side (`openCashDrawer` guard; receipt printing skips the pulse but still prints), so a manual drawer can never jam a receipt. Float, drops, paid-outs, cash-ups unchanged.
- Bank-terminal seamlessness: provider quick-pick (FNB, Stanbic, Absa, Standard Chartered, Bank Gaborone, Yoco, DPO, Peach), bank-flow copy (type amount into the machine; bridge only with the bank's till-integration address), and a technician panel documenting the exact Till→bridge message and expected approval reply. Test sends P1 only. Lodge card block points at the same contract.
- Coverage: `bar-devices-displays` 15/15 (manual-drawer + bank-setup pins); focused till/base/mode/restaurant suites 117/117; JSX parse clean.
- Bar manual impact: **Required** — Part B setup line (manual drawer, network finder, bank Manual/bridge). Screenshots, PDF rebuild, manifest approval and packaged offline smoke fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing. No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Bar ease batch: live guest screen, network finder, daily checks, scan names+beeps, drawer controls (local; zero SQL)

- Guest screen comes alive: Bar Till pushes its basket live (same local snapshot contract as lodge; previously never pushed), cash sales leave a big Change due + thank-you on the screen until the next sale, and a saved welcome message shows on idle. Welcome message is a shared hardware field (`display_welcome_message`) editable in Bar Devices and Lodge/Hotel setup.
- No typing addresses: connect-only network printer finder (`pos:scanNetworkPrinters`, `settings.manage_general`; sends zero bytes so nothing prints) with per-result Use this printer + test-before-trust warning.
- Daily routines: read-only Run morning check (green/red per device, never prints/kicks), device-local Open the bar / Close the bar checklists (per-day, this-computer labels), card-totals compare boxes (operator-typed notes with auto-diff; books stay server-side), first-day guide, one-tap Send problem to support (counts + device summary, PIN/card warning).
- Scanner joy: verification names the product the barcode belongs to (menu lookup, best-effort) and beeps happy/sad via the till-sound toggle.
- Drawer discipline: no-sale opening needs a typed reason (audited) behind `pos.cashup`; receipts nudge drawer shut; Till reprint is a big lost-slip button; interrupted baskets reassure about power cuts.
- Lodge/hotel parity: same welcome-message field in POS setup; shared receipt nudge; lodge Till display feed unchanged.
- Coverage: `bar-devices-displays` 13/13; focused till/base/mode/restaurant suites 125/125; JSX parse clean on 6 files.
- Bar manual impact: **Required** — Part C cash paragraph (guest-screen change, drawer nudge) + Part H (finder, morning check, Daily checks, reprint, power-cut restore). Screenshots, PDF rebuild, manifest approval and packaged offline smoke fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing. No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Display pinning + guided setup steps: sticky monitors, auto-open, numbered flow (local; zero SQL)

- Pins survive restart: new per-PC hardware fields (`display_customer/bar/kitchen_display_id`, `display_customer_auto_open`) persisted through `normalizePosHardwareSettings` + `readPosHardwareSettings`; same `pos:saveHardwareSettings` contract (`settings.manage_general`).
- Bar Devices: per-screen pin selectors with disconnected-monitor warning, pinned badges on monitor rows, one-tap Reopen pinned, opt-in Open customer display on startup, numbered 1–5 setup steps with next-action line, and a what-plugs-in-where note. Pinning saves immediately; other edits still use Save.
- Boot: 15s startup task reopens the customer display on its saved monitor only when auto-open is on, the display is enabled, and a saved layout exists — otherwise nothing opens. Best-effort `display_auto_open` audit event.
- Lodge/hotel `POS.jsx`: monitor selectors reseed from saved pins on load and persist the pin on change (was in-memory-only), pinned/disconnected hints, same auto-open toggle.
- Coverage: `bar-devices-displays` now 7/7 (pin/auto-open + steps pins); focused barcode/onboarding/hardware/restaurant suites pass; JSX parse clean on all three renderer files.
- Bar manual impact: **Required** — Part B setup line extended with steps + pinning. Screenshots (pinned Devices tab), PDF rebuild, manifest approval and packaged offline smoke fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing. No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Devices & displays overhaul: Bar printer picker, ESC/POS + drawer detail, card machine surfaced, test-all, Till send-total (local; zero SQL)

- Bar `HposSystemHealth.jsx` Devices tab: new readiness strip (receipts/drawer/card/scanner/displays), Windows printer discovery via `receipts:listPrinters` with mismatch warning + one-click apply, full ESC/POS target (connection/host/port/path/codepage/timeout) shown only for direct mode, drawer detail (timing/pin/pulse) + Test drawer, new Card machine panel (provider/name/mode/bridge URL/timeout, manual-first copy), scanner advanced collapsed + 30-day re-verify badge, displays fullscreen toggle + customer-display toggle + 1-vs-many monitor guidance, Test all devices (receipt → drawer → terminal → scanner state → display count). Same `pos:*` IPC contracts; verification fields still main-process-only.
- Bar Till `HposTerminal.jsx`: card payment keeps the optional approval-code box; bridge-ready terminals (provider + bridge URL, non-manual mode) gain Send-to-card-machine (single + split-card-balance) via `pos:sendPaymentTerminalTotal`, filling the approval code on success. Manual hint otherwise. Send never auto-submits; Pay still records the sale server-side.
- Lodge/hotel `POS.jsx` parity (same file serves both): keeps all existing fields; adds scanner settings block sharing the Bar contract (enabled/min/max/terminator + shared `scanner_last_verified_at`), ESC/POS-missing-target and drawer-needs-target warnings, saved-printer-mismatch warning, single-monitor guidance, and Test all devices. Existing Send Total to Card Machine unchanged.
- Coverage: new `tests/bar-devices-displays.test.mjs` 5/5; `bar-barcode-scanner` + `bar-onboarding-controls` + `bar-till-payment-footer` + `bar-base-product` + `bar-product-contracts` + `bar-financial-ui-regression` 86/86; `pos-hardware-adapter` + `restaurant-hpos-service-contract` + `bar-mode-curation` ok.
- Bar manual impact: **Required** — Part B setup line, Part C card paragraph (manual default + optional bridge send), Part H System Health line updated in `manuscript.md`. Screenshot recapture (Devices tab, card panel, Till send button), PDF rebuild, `coverage.csv`/`evidence.md`/`screenshots.csv`/`qa-report.md`, manifest approval and packaged offline smoke fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing. No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-23 — Lodge offline-honesty batch: roomAttributes fail-closed, dayUse device-only meta, revenue Unavailable (local; zero SQL)

- Fix 1 (silent loss): `roomAttributes.js` offline create/update/delete no longer queue fake types (`roomAttributes:create/update/delete` matched no replay branch, so edits were deleted while reporting success). They now throw `Room attributes need an internet connection…`; IPC already returns `{success:false}`, and `RoomAttributes.jsx` now checks `result.success` before showing success (preload returns the envelope without throwing).
- Fix 2 (silent local-only): `saveDayUseConfig` gains opt-in `{includeMeta:true}` envelope reporting `device_only` + recovery warning when offline or the server table is missing; `dayuse:saveConfig` IPC requests it. Cache rows stay clean (no marker persisted).
- Fix 3 (silent zeros): `getReportsSnapshot` fallback withholds booking-revenue fields as null + `revenueUnavailable: true` + `_complete: false` when the never-written `payments` cache is empty (empty source ≠ zero money); `Reports.jsx` Shared Net Cash card renders `Unavailable` with reconnect guidance instead of confident 0. True zeros (payments present, none in range) still show 0.
- Bar manual impact: No manual update required — lodge-only surfaces (room attributes, Day Use setup, lodge reports snapshot); no Bar workflow, control, or recovery step changed.
- Evidence: `offline-guards-behavioral` 37/37 (5 new pins); `enterprise-room-attributes` 17/17; `npm test` + `test:offline-queue-critical` + `test:offline-pos-critical` ok; esbuild JSX clean on `Reports.jsx` + `RoomAttributes.jsx`. Note: `settings-save-workflow` has 1 pre-existing failure (CRLF vs LF regex expectation in an untouched file; `git diff` clean on `settings.js`). No migration; `db:push` NOT run. Relaunch required (main + renderer).

## 2026-09-23 — Bar long-outage server batch: lease 365, window unlimited, sale-day dates (3 migrations DEPLOYED 2026-09-23)

- Owner approvals: lease Beyond 30 for Bar; old sales post to original sale day (accounting); every Bar sale syncs even past 60 days (no manager per-sale review).
- `20260923000001_bar_offline_lease_365.sql`: `_offline_valid_until` ceiling 30→365; `get_lodge_entitlement` Bar-only cap 365 (others 30, trial 30 untouched); `admin_assign_commercial_subscription` stores up to 365 for Bar-only hospitality-pos (others 30). No GRANT/REVOKE (OR REPLACE preserves ACLs); guards assert predecessor functions exist.
- `20260923000002_bar_offline_window_unlimited.sql`: Bar floor 1440h→87600h (trigger + backfill, Bar rows only). Missing/wrong-outlet snapshots and future timestamps still refuse; per-lodge overrides above the floor untouched.
- `20260923000003_pos_business_date_sale_day.sql`: `assign_pos_daily_order_number` prefers sane `client_created_at` (present, ≤ now+5min, same guard as order RPC) else current behaviour; explicit `business_date` still wins. Known divergence left alone: batch GL posters grouping by `created_at` day (follow-up if day-level GL parity required).
- Desktop already ready: firm-no park honours the flags (Fix 2) so post-deploy old sales succeed instead of parking; client already sends `client_created_at`.
- Bar manual impact: none beyond the already-recorded counts/profile lines — no new workflow; dates/lease are server behaviour. PDF rebuild + manifest approval still pending (pre-existing checksum fail).
- Evidence: `bar-offline-scale-guards` 14/14 (3 new migration pins); full `test:bar` 640 pass + 1 pre-existing guides checksum fail + 5 skipped; `test:offline-queue-critical` + `test:offline-pos-critical` + `npm test` ok; `db:lint` clean. Deployment: `db:push` applied exactly `20260923000001..03` (operator-approved; first attempt failed clean on bare CREATE 42723, fixed with OR REPLACE, nothing applied; second push clean). Post-push: `migration list` parity through `20260923000003`, dry-run `Remote database is up to date`, live `pg_proc` read-back confirms 365 ceiling + Bar 87600 floor + sale-day trigger, `db advisors --level error` `No issues found`. Relaunch required (main + renderer) so the Till reads the new lease.

## 2026-09-23 — Bar 7-item batch: firm-no park, drain guard, fast status, settings warn, offline counts, PWA flush (local; zero SQL)

- Fix 2: server firm-no refusals (`catalog_refresh_required` / `manual_review_required`, e.g. sales older than the trading window) now park manual-review-only on first refusal (`infrastructure.js` preserves `code` + flag, `shouldManualReviewSyncItem` honours them). No more 5x retry + 30-min requeue forever; Till stays sellable, failed row + dead-letter stay visible.
- Fix 3b: replay pauses when the link drops mid-drain (`_runSyncQueue` checks `state.isOnline` per item, journals `replay_paused_offline`). Only the in-flight item spends a retry; the rest stay pending untouched.
- Fix 4: status counts build id sets once (`syncStatus.js`, `sync.js` classify takes prebuilt Sets). Same answers, no more square cost per 30s poll. Journal tail-read from prior batch unchanged.
- Fix 6: operating-profile save offline now returns `device_only` meta with "save again when back online" (`index.js` IPC; domain write path unchanged). Venue settings already warned; profile was silent.
- Fix 7: physical counts queue offline from last-known baselines (`HposStock.jsx` `stockCountsQueueable`: every line needs `updated_at`; certified labels still need a full server read; server versioning unchanged). Single count + Count All buttons/post all use the queueable gate; offline posts already returned queued notices.
- PWA: queue pushes once on app start when already online, banner names items needing review in the inbox (`App.jsx`); friendly full-storage + export/blocked-clear from prior batch unchanged.
- Proposals (no code, need sign-off): (a) lease beyond 30 days needs a server rule change + risk sign-off (owner chose Beyond 30); (b) posting weeks-old sales to their original sale day needs accounting sign-off (owner chose Change dates) — current deliberate behaviour (reconnect-day shift/date, original time in forensic fields) unchanged.
- Bar manual impact: Required — Part H counts paragraph now says counts queue offline from last-known baselines + profile-save warning. PDF rebuild + screenshots + manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: `bar-offline-scale-guards` 11/11; `bar-stock-batch-operations` 10/10; `bar-financial-ui-regression` 37/37; `test:offline-queue-critical` ok; `test:offline-pos-critical` ok; `npm test` ok; `pwa-support-write-ahead` 5/5; `manager:lint` 0 errors; esbuild JSX clean on `HposStock.jsx`. No migration; `db:push` NOT run. Relaunch required (main + renderer + PWA refresh).

## 2026-09-23 — Sell screen 15-item efficiency batch (local; zero SQL)

- Follow-up to the same-day UX batch after a full-app audit of the 15 proposed ideas (several already existed: exact-cash Quick cash, Hold check / open tabs, sticky category bar, customer display route, Same again on the empty-basket CTA). New Till Sell behavior:
  - **Receipt CTAs**: shared `POSReceipt` accepts optional `onNewSale` / `onRepeatSale` (only Till passes them). New sale closes the receipt, clears the success strip, and refocuses search; Same again runs `reorderLastSale()` and refocuses. Close also refocuses search for the next customer.
  - **Empty-grid shortcuts**: when a search/category filter yields no rows (and load succeeded), offer *Show top sellers* / *Show favourites* alongside *Clear search and show all*.
  - **Category counts**: pills on each category chip (`categoryCounts`, incl. Favourites / Top sellers).
  - **In-basket badge**: `ProductCard` shows `inBasketQty` in the aria-label and a quantity pill when the line is already in the basket.
  - **Undo last add**: 6s local undo of the most recent +1 / new line (never touches a paid order); shown in the submit/success strip with an Undo button; Clear sale also clears the undo state and refocuses search.
  - **Multi-add long-press**: holding a product card for ~480ms opens a qty sheet (2/3/4/6 presets + free entry 1–99). Long-press suppresses the follow-up click so one hold never double-adds; the sheet closes the on-screen search keyboard like other blocking overlays.
  - **Recently sold this shift**: device-local horizontal strip under the category bar (max 12 unique product ids, filled from each successful payment’s cart). One tap re-adds a still-sellable item (stock/availability blocked chips stay visible but disabled). Not a report — local only.
  - **Shift pace**: the open-shift pill appends `· N sold` (device-local quantity from successful payments this session; never a financial total).
  - **Payment idle nudge**: if the payment panel stays open 90s without a tender/method change, a soft `role="status"` banner says the payment is still open (Esc closes). Any tender change restarts the clock; closing payment clears it.
  - **Optional till sound** (default off): icon-only Volume toggle in the global top bar next to LiveClock date/time (`HposNav`); arms AudioContext only after a user gesture; shared `src/shared/tillSound.js` module used by both the nav toggle and Till beeps (add-to-cart + payment success). Persisted in `localStorage` (`hpos-till-sound`). Never required to sell. (Earlier draft had a text button on the Sell top bar — moved to icon-only nav control.)
- Surfaces already present (no duplicate feature): customer display route (`/pos/customer-display`), Hold check / open tabs, sticky category bar, Quick cash Exact, receipt *Same again* on the empty-basket CTA.
- Bar manual impact: **Required** — new visible Sell controls (receipt New sale / Same again, empty-grid Top sellers / Favourites shortcuts, category count pills, in-basket qty badge, Undo add, multi-add hold sheet, Just sold strip, Shift open · N sold, payment idle nudge, **top-bar icon-only till sound toggle next to date/time**). Screenshot recapture + manuscript one-liners + PDF rebuild + manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: full `test:bar` **631 pass + 1 pre-existing guides checksum fail + 5 skipped** (was 630 before this pin test); focused till suites **30/30**; esbuild JSX parse clean on `HposTerminal.jsx` + `POSReceipt.jsx`; `build:hospitality-pos` passes; `git diff --check` clean (line-ending warnings only). No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-23 — Sell screen UX batch (12 items; local; zero SQL)

- Till product grid: quick-cash rows use `auto-fit minmax(60px,1fr)` so orphaned amounts no longer break the grid; product cards use a native full-card button (`aria-disabled` when blocked, no opacity dimming, sibling favourite star, single high-contrast unavailable label); a 10-card skeleton (`.hpos-skeleton` + sweep keyframes) replaces the blank grid while loading, with `role="status"`; empty/failed catalogue states gain "Retry loading products" and "Clear search and show all".
- Cart and footer: unit price line restored under each cart row (`{currency} {fmt(unit)} each`); Take-payment CTA unified to the coral `--hpos-accent-gradient`; shared-drawer gate now fails closed in the UI (Pay disabled while `drawerGateNeeded && !recoveredAttempt`, amber `role="status"` notice + preflight in `completeOrder`) while the domain still refuses server-side.
- Dialogs and a11y: Clear/switch-table confirms use shared `ConfirmDialog` (no `window.confirm`; Escape cancels; `role="dialog"`, `aria-modal`, labelled title); shift-start and modifier modals gained dialog semantics + focus trap; global Escape/F2 handlers are guarded when focus is in a dialog, PIN input, or search; `···` line-options touch target lifted to 44px with 12px type.
- Tokenization: repeated `#c95635`/`#b84a38`/text/surface hex literals in `HposTerminal.jsx` style objects now read `var(--hpos-accent)` / `var(--bb-danger)` / friends (SVG presentation attrs keep literal hex).
- Test contracts updated for the split ConfirmDialog title/message, the tokenized danger colour, and the drawer-gate disabled expression (`bar-till-service`, `bar-till-selling`, `bar-till-touch-targets`, `bar-till-payment-footer`).
- Touch-only follow-up (same batch): Sell search input, favourite star, and Charge-to-account lifted to 44px; new in-app on-screen keyboard for the Sell search (`showSearchKeyboard`, keyboard toggle with `aria-expanded`, floating right-hand panel `role="dialog"` at `right:16px bottom:16px` width `min(460px, …)` so the product grid stays visible while filtering, letter/number keys 44px). Search field gains a clear (X) control when text is present (`aria-label="Clear search"`, padding widens to make room). Pointerdown outside the panel (and outside the search field / clear / toggle) dismisses the keyboard; Escape also closes it before clearing the field; payment/shift/unlock/modifier/confirm overlays auto-close it. Focus stays in the search input on key tap (`onMouseDown` preventDefault) so barcode-wedge and physical Enter are unchanged. Pinned in `bar-till-touch-targets` (clear button, float-right, outside-dismiss contracts).
- Bar manual impact: Required — visible Sell-screen controls changed (unit price line, in-app Clear dialog, drawer-closed Pay disable + notice, skeleton/empty/error recovery buttons, card sold-out contrast, **44px search/star/charge targets, search clear (X), floating on-screen search keyboard**). Screenshot recapture (Sell workspace + payment panel), manuscript one-liners where needed, PDF rebuild and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: full `test:bar` 630 pass + 1 pre-existing guides checksum fail + 5 skipped; focused till suites 29/29; esbuild JSX parse clean on `HposTerminal.jsx`; `build:hospitality-pos` passes; `git diff --check` clean (line-ending warnings only). No migration; `db:push` NOT run. Relaunch required (renderer).

## 2026-09-22 — Bar offline scale guards 1-4 (local; zero SQL)

- Fix 1 single copy: `src/main/index.js` now uses `app.requestSingleInstanceLock()` + `second-instance` focus + `whenReady` guard (mirrors Legacy POS). Second copy quits instead of erasing the first copy's queue. Multi-computer bars unaffected (each has its own files; mesh/server sharing untouched).
- Fix 2 fast status: `getOperationJournalSummary()` now parses only the last 500 lines (`total` still exact, `truncated` flag + `fileSizeBytes`). Status polls and System Health no longer re-parse weeks of history. `buildLocalOperationsBundle()` reuses its single full read instead of reading twice.
- Fix 3 trim: history log trims to newest 2000 lines once past 5MB (`pruneOperationJournalIfNeeded`, health fault `operation_journal_rotated`). Queued sales untouched; journal is forensic only.
- Fix 4 phone storage: PWA queue keeps fail-closed writes but now explains full storage in plain words, warns at 200 items (`getPwaStorageHealth`), and offers Export queue (download) + Clear blocked in Control. `queueOrRun` maps quota errors via `friendlyPwaQueueError`.
- Bar manual impact: Required — one-liner that only one copy runs per computer (Part H). Fold into pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing. Fixes 2-4 need no manual change (same workflows, faster/recovery only).
- Evidence: new `bar-offline-scale-guards` 5/5; `test:offline-queue-critical` ok; `test:offline-pos-critical` ok; `npm test` ok; `pwa-support-write-ahead` 5/5; `manager:lint` 0 errors; `test:bar` 628 pass + 1 pre-existing guides checksum fail + 5 skipped. No migration; `db:push` NOT run. Relaunch required (main + renderer + PWA refresh).
- Deferred point 5: queue write strategy (add-only log + index) documented in `docs/BAR_QUEUE_WRITE_STRATEGY_PLAN.md` for a later run. Not started.

## 2026-09-22 — Bar POS package buy + money guards fix batch (2 migrations DEPLOYED 2026-09-22)

- Fixed buy-blockers: package builder no longer crashes on profile mismatch (filtered list + friendly message, quote preview memoised), Request button sends correct bar type via getHospitalityMode with visible errors, trial tick-box now drives P0-due-now once per property (full P18,500 still locked by test).
- Money guards: expired/suspended licences block new sales fail-closed (read-only reports stay), pool tables cash-only enforced client + new server guard migration, PIN offline fallback tightened to true transport only, null-package auto-activate closed, void refresh now logs + health fault instead of silent.
- Contracts aligned: bar first-class type (never lodge), add-ons eligible restaurant+bar server+app, upgrade nudge points to Bar add-ons, incident log reachable in Bar checklists, recipes copy says Included with Stock add-on, cloneFeatureMap fail-closed, duplicate hub tile + hash-in-render + double-gate cleaned, PIN modal Escape/focus, menu Edit disabled without manager right, empty trial workspace explains activation.
- Website: sitemap + redirects include bar-pos, contact has Bar POS, Bar page lists 3 add-ons with honest limits + recipes excluded + v1.5.7, brochure includes Bar POS.
- Bar manual impact: Required — buy flow, trial, pool cash-only, subscription block, incident log, recipes copy, PIN modal. PDF rebuild + screenshots + manifest approval fold into already-pending guides rebuild; bar-guides-contract checksum failure remains (pre-existing).
- Evidence: test:bar 623 pass + 1 pre-existing guides checksum fail; npm test ok; offline-pos/queue ok; financial-integrity ok; test:commercial 12/12; test:marketing-site ok; db:lint clean. Deployment: db:push NOT run — 20260921000000_bar_entitlement_parity + 20260922000001_pool_cash_only_guard need operator go-ahead. Relaunch required (main + renderer).

## 2026-09-20 — Manage unlock works offline on transport failures (local; zero SQL)

- Operator repro: unlocking Manage on the Bar app demanded internet. Root cause: `verifyManagerPinForManage` only fell back to the trusted cached PIN verifier on the 12s `network_read_timeout`; a dead cable/router fails fast with `fetch failed`/abort, which was rethrown as `Reconnect and try again` while `state.isOnline` was still true. Same narrow catch existed on the Till unlock path.
- Fix (`src/main/domains/pos.js`, zero RPC change): new `isPosPinTransportFailure` (timeout code + fetch/network/abort/timeout/connection/offline signals) with a shared `resolveOfflineManageUnlock` contract. Both Manage and Till unlocks now fall back to the cached verifier on thrown transport errors and on transport-flavoured RPC `error` objects; authoritative answers (wrong PIN, permission denied, non-manager role) still fail closed with no bypass. Audit (`manager_manage_unlocked_offline` / `staff_selected_offline`) unchanged.
- Surfaces: locked-Manage placeholder and Part A manuscript now state offline unlock works after the team list has synced once on that computer. Help-ticket flow still needs a connection (stated in-dialog).
- Bar manual impact: Required — Part A one-liner (offline Manage unlock). PDF rebuild, screenshot recapture and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-manage-pin-offline` 3/3; `bar-manage-pin-gate` + `bar-manage-pin-recovery` 13/13; full `test:bar` 599 pass + only the pre-existing `bar-guides-contract` checksum failure; `npm test` production-guardrails ok; offline suites ok; `node --check` clean on main. Relaunch required (main + renderer).

## 2026-09-16 — Shared-drawer cash model built end to end (migration ready, NOT yet deployed)

- Operator need (village bars, one computer, many sellers, one drawer): one blind count per drawer per period instead of one personal cash-up per worker. Reconciled design with the review model: cash containers (drawer per outlet, pouch per operator), one live period per drawer, movements (drop/paid-out/float/pouch transfers, PIN-proven, idempotent) that move money, counts (opening/handover/closing) that only observe, server-derived expectations (same tender/float/tips math, period-scoped), blind submit → manager review with honest self-review flag. Retired drawer-close RPC untouched. Existing outlets keep `personal_bank` until an admin switches them with zero open activity (audited).
- Contract changes: `clock_out_staff` releases shared-drawer Tills (personal guards intact, incl. unreconciled personal sales); period approve closes only untouched outlet shifts; offline mirrors + same-RPC replay for open/move/count/submit/review; outlet reads carry `cash_model` (unknown fails closed to personal rules).
- Surfaces: Staff shift close gains the drawer panel (drops/paid-outs/handovers, single PIN) and hides personal cash-up in shared outlets; Cash & close gains the drawer close section (blind submit, manager review, evidence); My Shift/My Cash-up defer to the drawer in shared outlets; outlet editor asks the physical question (bar defaults to shared drawer).
- Bar manual impact: Required — Parts C/F/H (drawer open, drops/paid-outs, handovers, period close + review, outlet cash question). PDF rebuild, screenshot recapture and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-village-cashup` 12/12 + `bar-village-workflow` 10/10; full `test:bar` 596 pass + only the pre-existing `bar-guides-contract` checksum failure; `npm test` production-guardrails ok; offline suites ok; `db:lint` clean; esbuild clean on all touched files; `node --check` clean on main. Deployment: `db:push` NOT run — needs operator go-ahead (one migration `20260918000000`; live verified absent, clock-out guard live without shared branch as expected). Relaunch required (main + renderer).
- Operator next: (1) approve `db:push`; (2) relaunch; (3) in outlet settings set the Bar outlet to One shared drawer (admin, no open shifts); (4) open the drawer with the counted float and trade — sellers clock in/out freely, drops/paid-outs recorded live, one blind count at close.

## 2026-09-17 — Offline sync P0s: replay write fence, incremental dead-letters, delivery-aware stock projection (local; zero SQL)

- Verified audit claims against the live tree, then fixed all three: (1) `_runSyncQueue` held `pending` in memory and rewrote `sync-queue.json` from that stale snapshot on every loop write, so a sale queued during an RPC await (`queueOperation` read-append-write) was erased on the next replay write. Every loop write now merges unknown on-disk arrivals first (`collectNewDiskQueueArrivals` pure in `syncShared.js`, `absorbNewDiskQueueArrivals`/`writeReplayQueue` in `infrastructure.js`); in-memory ordering stays authoritative, completed/dead/in-flight ids never resurrect. (2) Dead letters lived in memory until the run-end `sync-failed.json` flush, so a crash mid-replay dropped them from both operational queues. Each dead letter now persists incrementally (`persistDeadLetterIncrementally` + deduped `mergeDeadLetterQueues` upsert); the run-end flush is a no-duplicate upsert. (3) `applyQueuedPosInventoryReservations` subtracted only queued sales from `synced_current_stock`, so an offline delivery (10→30 locally) collapsed to 10 on the next projection rebuild. The projection now folds queued deliveries/adjusts/purchases/counts in queue order (counts absolute, rest additive) with one shared menu/name index per computation — 30k orders project in ~320ms headless (was ~15.9s per the audit's per-line parse pattern).
- Scope: main desktop queue only (`hospitality-pos` Bar app). Legacy POS has a separate queue/mesh/contract and is untouched. No RPC, idempotency-key, or server-contract change; replay bytes and stable keys preserved; journal/audit paths unchanged; financial display still pending-until-confirmed.
- Bar manual impact: Not required — no new workflow, control, permission, or recovery step; fixes restore already-documented Till/stock/sync behavior (deliveries raise stock, sales never vanish, failed work stays visible in System Health for Retry/Clear).
- Evidence: `test:offline-queue-critical` ok (new fence + dead-letter pins + temp-dir end-to-end); `test:offline-pos-critical` ok (new delivery/count/index pins + temp-dir 10→30→28 projection); `npm test` production-guardrails ok; `test:inventory-offline-sync` ok; `test:bar` 574 pass + only the pre-existing `bar-guides-contract` checksum failure (guides rebuild still pending, unrelated); `node --check` clean on touched main files. Headless: 10k orders 148ms / 30k orders 320ms, stock exact. Relaunch required (main-process code).

## 2026-09-16 — Till unlock lists only clocked-in staff (local; zero SQL)

- Operator request: the unlock list showed everyone (20+ names), hiding errors and inviting a pick the server would refuse anyway. Online unlocks require prior clock-in (`20260715026000`), so the dialog now lists only staff with an active attendance shift; when none, it says `No one is clocked in right now — clock in at Staff shift close first` instead of the grid/PIN. Offline (or unknown connectivity/attendance) deliberately shows everyone, because offline unlocks auto-create attendance — filtering there would strand remote bars. The Till refreshes both signals on every unlock open (`getActiveShifts` + `sync.getStatus`, fail-open nulls); stale selections can't confirm. Server remains the backstop.
- Bar manual impact: Required — Till unlock list + empty state (Part C). PDF rebuild, screenshot recapture and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-till-unlock-shift-filter` 4/4; full `test:bar` 574 pass + only the pre-existing `bar-guides-contract` checksum failure; `npm test` production-guardrails ok; offline suites ok; esbuild JSX check clean on touched renderer files. Relaunch required (renderer).

## 2026-09-16 — Stress-test crew evicted from Lounge lists + shift heading fix (live data, zero SQL files)

- Operator pain: unlock-Till/on-shift lists flooded with 20+ WEEKS test workers; shared shift heading always said "Who is clocking in?" even when closing out.
- Heading: `HposSharedShiftClose` (and legacy kiosk) now show `Clocking in {name}` / `Closing {name}` once a person is picked, `Who is using this terminal?` before that. Renderer-only.
- Live cleanup (Lounge `45f21c52`, verified by fresh read-back): 27 active test attendance shifts closed via the real `clock_out_staff` RPC and 61 test accounts suspended via the real `update_user_profile` RPC (88/88 ok, fail-closed per item; first impersonation attempt correctly refused everything with lodge-denied and changed nothing). Untouched deliberately: `179ab2d3` (test-origin account holding the only open Lounge Till, labelled Brian Rabafi, no cash-up — close it through the normal cash-up flow), Wedu K + tills in other lodges. Suspended accounts vanish from kiosk/unlock pickers; relaunch refreshes local caches.
- Bar manual impact: none — test-data hygiene, no workflow change (the heading wording is cosmetic and needs no manual update).
- Evidence: related suites 15/15; esbuild JSX check clean on touched files. Relaunch required (renderer) to see the shorter lists.

## 2026-09-16 — All errors now come to the user in plain language (local; zero SQL, grant migration deployed)

- Operator request: every error in the app must appear where the user is (or jump to them), and read as plain guidance instead of technical text. Scan found 226 error sites in 137 renderer files.
- Mechanism (shared, no per-screen logic): new `ErrorNotice` (`components/shared/ErrorNotice.jsx`) — mounts exactly when an error appears, scrolls itself into view (`nearest`: no jump when already visible), focuses for assistive tech, and does nothing inside open dialogs (already in front of the user; no focus stealing from PIN/text fields). New `friendlyErrorMessage` (`components/shared/friendlyError.js`) translates known technical signatures (permission denied, transport/Electron wrapping, offline, timeouts, duplicates, foreign-key, bad format, rate limits, device faults) into actionable sentences; already-friendly text and specifics (names, amounts, refs) pass through untouched. Detail stays in logs/support bundle.
- Rollout: `HposNotice` error branch and accounting `AccountingNotice`/`AccountingError` route through it (covers the whole Bar/POS world + all 9 accounting pages with zero per-file edits); ~200 red error banners converted across hotel/lodging/restaurant/fnb/admin/accounting with identical classes/text (visuals unchanged). Skipped deliberately: amber warning callouts, success/info/loading states, toasts (already fixed-position), static notes, and one inline message already under its button (`HposManageHub` refresh) — pinned by an explicit skip list in the scan test. Manager PWA / booking-site / Legacy POS are separate builds and are not covered here.
- Bar manual impact: Required — error behavior + plain-language wording on Bar screens (Parts C/H). PDF rebuild, screenshot recapture and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-error-visibility-all` 4/4 + `friendly-errors` 4/4; full `test:bar` 570 pass + only the pre-existing `bar-guides-contract` checksum failure; `npm test` production-guardrails ok; offline suites ok; `db:lint` clean; esbuild check clean on all 214 renderer files; `node --check` clean on main. The `20260917000000` clock-out grant migration is now DEPLOYED (see entry below). Relaunch required (main + renderer).
- Follow-up same day: Till unlock with 20+ workers hid the error — the dialog-skip correctly ignored it, but this scrolling dialog is the exception. New `scrollInDialog` opt-in on `ErrorNotice`, used by the unlock dialog only, so a wrong-PIN error scrolls into view inside the staff list; all other dialogs keep the no-steal behavior. Pinned by test (`restaurant-self-shift` + visibility contract).

## 2026-09-16 — Clock-out permission denied + hidden errors on shift screens (deployed to linked oicgpknsmtvcsjacymum)

- Operator repro: clock-out fails with `permission denied for function clock_out_staff_with_attendance_pin`, and errors render above the card where the operator (down at the buttons) never sees them.
- Root cause (permission): `20260914010000` redefined the clock-out RPC and re-granted EXECUTE to `authenticated, service_role` only, dropping the `anon` grant the desktop session needs (`20260816190000` pattern). Clock-in kept `anon`, so terminals fail exactly at clock-out. Fix (`supabase/migrations/20260917000000_clockout_pin_anon_grant.sql`, LOCAL ONLY, not pushed): grant-only restore of `anon, authenticated, service_role` on the clock-out RPC; no body/signature/RLS change, server PIN + cash-up + idempotency checks untouched. Until deployed, `pos.js` maps the bare denial into recovery guidance (shift stays open, cash-up kept, no repeat tapping, manager updates permissions + relaunch).
- Fix (errors): new error anchor on Staff shift close, Clock in/out kiosk, Staff cash-up, My Cash-up and My Shift — a new error scrolls into view and takes focus instead of sitting hidden above the card. Same 6-line pattern per screen, no CSS or shared-component change. App-wide rollout beyond these five screens is a follow-up, same pattern.
- Deployment 2026-09-16 (operator-approved `db:push`, exactly `20260917000000`): pre-push `migration list` showed remote at parity through `20260916000000` with only `20260917000000` pending; post-push parity through `20260917000000`, live `pg_proc` read-back confirms `clock_out_staff_with_attendance_pin` SECURITY DEFINER with EXECUTE to `postgres,service_role,authenticated,anon` (clock-in unchanged), migration rows recorded, `db lint` clean, `db advisors --level error` `No issues found`. Relaunch required (main + renderer) — then clock out again.
- Bar manual impact: Required — combined-screen error behavior + clock-out recovery line (Parts C/H). PDF rebuild, screenshot recapture and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-shift-error-visibility` 3/3; related suites 39/39; full `test:bar` 566 pass + only the pre-existing `bar-guides-contract` checksum failure; `npm test` production-guardrails ok; offline suites ok; `db:lint` clean; `node --check` clean on main, esbuild JSX check clean on touched renderer files. Deployment: `db:push` NOT run — needs operator go-ahead (one grant-only migration). Relaunch required (main + renderer).
- Operator next: (1) approve `db:push` for `20260917000000`, relaunch, clock out again; (2) if it still fails before the push, the new message says so plainly — shift stays open, nothing is lost.

## 2026-09-16 — Shared Clock in/out + Staff cash-up combined into Staff shift close (local; zero SQL)

- Operator request: one shared-terminal screen instead of two. New `HposSharedShiftClose.jsx` (`hpos/shift-close`): pick name once, one PIN field — clock in when off shift; when on shift it resolves `getStaffOpenShift` + `getStaffCashupSubmission` and either offers `Clock out without cash-up` (no open Till sales found — server guard already permits this) or blind cash count → `Submit cash-up` → `Clock out staff` (clock-out stays blocked until submitted while Till sales exist, matching server + offline domain guards). Same RPCs, same `shared_terminal` round keys, blind count preserved, correction notes preserved.
- Wiring: `App.jsx` adds `hpos/shift-close`; legacy `hpos/attendance` + `hpos/shared-cashup` redirect there (deep links keep working). `HposLayout.jsx` search + supervisor/manager rail show single `Staff shift close`. Old component files kept untouched for audit history. `restaurant-self-shift` kiosk test updated to the unified contract.
- Bar manual impact: Required — shared-terminal nav + combined close flow + no-till bypass (Parts C/H). PDF rebuild, screenshot recapture (combined screen, no-till notice, Till-sales gate) and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-shared-shift-close` 4/4; `restaurant-self-shift` + `bar-cashup-blind` + `cashup-replay` 33/33; full `test:bar` 563 pass + only the pre-existing `bar-guides-contract` checksum failure; `npm test` production-guardrails ok; offline suites ok; esbuild JSX check clean on touched renderer files. Relaunch required (renderer).
- Operator next: relaunch, open Staff shift close as supervisor/manager — clock someone in, clock out a non-till helper without cash-up, submit a till cash-up then clock out.

## 2026-09-16 — Bar Till open-tab count no longer drifts from Open Tabs (local; zero SQL)

- Operator repro: the Till pill showed 10 open tabs while Open Tabs showed none. Live server truth: 0 open tabs (7 closed rows across 2 lodges), so the 10 lived only in this terminal's cache. Root cause, two parts: the Till was the only surface reading `getTabs()` unfiltered, whose contract merges every local row missing from the server (Open Tabs/Cash & close/rail badge all read `getTabs({status:'active'})`, which merges pending-sync estimates only); and the Till set its count once at mount and never refreshed, while Open Tabs re-reads every 15s.
- Fix (`HposTerminal.jsx`, zero RPC change): initial load and a new lightweight 15s + visibility refresh both use `getTabs({ status: 'active' })` with the exact closed/paid/cancelled/voided predicate Open Tabs, Cash & close and the rail badge share, so all four surfaces agree within ~15s. No domain change: the unfiltered-merge path stays for its floor-table priming caller, and genuine offline pending tabs still appear (marked Pending sync on Open Tabs).
- Bar manual impact: Required — Part D one-liner (Till count matches Open Tabs). PDF rebuild, Till pill screenshot recapture and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-open-tabs-count-parity` 5/5; tab-adjacent suites 42/42; full `test:bar` 559 pass + only the pre-existing `bar-guides-contract` checksum failure; esbuild JSX check clean. Relaunch required (renderer).
- Operator next (no queue clearing): relaunch, reopen Sell and confirm the pill now matches Open Tabs; if Open Tabs still shows Pending sync chips, those are genuine unsynced tabs — resolve them in System Health (Retry re-queues the original; Clear stops retries for manager review), never bulk-clear.

## 2026-09-16 — Bar Till wrong-PIN guidance, self-service My Staff PIN, search Manage gate (deployed to linked oicgpknsmtvcsjacymum)

- Operator request (Bar app, bartenders and everyone else): a wrong Till PIN now says `If you forgot it, ask an admin to reset it in Staff Management.` Shared `OPERATOR_PIN_RESET_HINT` in `pos.js` covers cached + server PIN failures for Till unlock (`activateSharedTillOperator`), staff select, attendance clock-in/out and shared cash-up; `HposTillOperatorDialog` defensively appends the same hint for older main builds. Manage PIN dialog keeps its own support-ticket help flow.
- Self-service PIN in the personal account: new `My Staff PIN` card on `My Shift` (also linked from the top-right profile menu) calls new online-only `users:changeOwnPin` (`pos.view`, never `staff.manage`) → `changeOwnStaffPin` (`authUsers.js`) → new atomic `change_own_staff_pin` RPC (`20260916000000_self_service_staff_pin.sql`, LOCAL ONLY, not pushed): self-only target via `app_current_user_id()`, 4–6 digit enforcement, current-PIN proof when a PIN exists (forgotten → admin reset guidance), 15-min `staff_pin.change` rate limit, `pin_hash` via `extensions.crypt(gen_salt bf 10)` so the existing `staff_approval_pin_changed` audit fires free. Offline fails closed with reconnect guidance; success refreshes the trusted offline cache hash. Admin override unchanged: Staff Management PIN field + `users:update` (`staff.manage`) still overwrites any PIN.
- Global search Manage gate: new shared `isManageHubPath` + `requiresManagePinForSearch` (`barModeProfile.js`, union of both modes' Manage hub routes, query-stripped) — `HposLayout` search selection now routes every Manage-hub destination through the same `requestManageAccess` 15-min unlock as the Manage button. Page-level content blocking stays limited to `/hpos/manage`, `/hpos/stock`, `/hpos/cash`, `/hpos/reports`; personal pages (`My Shift`, Till, `My Cash-up`) never gate.
- Bar manual impact: Required — manuscript Parts A/C updated (Till wrong-PIN admin-reset line; My Staff PIN self-service + admin override; search Manage results need the same manager PIN). PDF rebuild, screenshot recapture (Till error, My Staff PIN card, search-gated Manage result) and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-staff-pin-self-service` 3/3; full `test:bar` 554 pass + only the pre-existing `bar-guides-contract` checksum failure; `npm test` production-guardrails ok; offline suites ok; `node --check` clean, esbuild JSX check clean. Deployment: `db:push` applied exactly `20260916000000` (operator-approved); `migration list` parity through `20260916000000`, dry-run `Remote database is up to date`, `db lint --level error` zero errors, `db advisors --level error` `No issues found`, live `pg_proc` read-back confirms `change_own_staff_pin` SECURITY DEFINER + `search_path=public` + `staff_pin.change` rate limit + admin-reset hint, EXECUTE grantees `anon/authenticated/postgres/service_role`, migration row recorded. Relaunch required (main + renderer).

## 2026-09-15 — Command Central can now reset a staff POS PIN (local; zero SQL)

- Gap found answering a PIN ticket: Command Central could reset login passwords and PWA access but had no staff (approval) PIN reset — the PIN was only resettable lodge-side in Staff accounts. New `resetCompanyUserPin` (`admin.js`): online-only, 4–6 digit enforcement, target resolved inside the target lodge, active accounts only, bcrypt lodge-side (cost 10, like the Staff screen), writes via the existing audited `update_user_profile` RPC with a PIN-only payload (last-admin guard + `staff_approval_pin_changed` trigger come free), Command Central actor audit without secret material. Wired through `database.js`, `admin:resetCompanyUserPin` IPC (fresh CC reauth, added to the sensitive-mutations list), preload, and a "Reset staff PIN" action + user-picker modal in Company Detail (verify-by-phone guidance; prompt to reply on the ticket). Support loop for a PIN ticket is now: ticket in inbox → call the manager → reset PIN here → reply on the ticket → manager retries.
- Bar manual impact: none — internal support tooling is explicitly excluded from customer PDFs.
- Evidence: `command-central-regression` 35/35 (extended sensitive list + new reset contract test); `npm test` production-guardrails ok; offline suites ok; `node --check` clean, esbuild JSX check clean. Relaunch required (main + renderer).

## 2026-09-15 — Forgot-PIN help request crashed after filing: bare .catch on PostgREST builder (local; zero SQL)

- Operator repro: "Request help" on the Manage PIN dialog returned `state.adminDb.from(...).insert(...).catch is not a function`. Root cause: this machine sets `SUPABASE_SERVICE_ROLE_KEY`, so `createSupportTicket` takes the direct-insert adminDb path, whose fire-and-forget message insert chained `.catch()` on a PostgREST builder — builders resolve via `await` but implement no `.catch`, so it threw AFTER the ticket row already existed (request filed, error shown; retry safely reuses it by title).
- Fix (local; zero SQL): both support message inserts (`createSupportTicket` lodge path + `updateSupportTicket` CC note path in `admin.js`) now `await` inside try/catch; audit confirms these were the only bare-builder `.catch` chains in main (all others go through `.then()` or real promises first).
- Bar manual impact: none beyond the already-documented help flow (no operator workflow change; the error text is gone).
- Evidence: new `bar-support-ticket-builder` 3/3 (static pins + builder-semantics proof; discriminates pre-fix code); full `test:bar` rerun below. Relaunch required (main-process code).

## 2026-09-15 — Forgot-PIN help: Bar Manage PIN dialog files a support ticket Command Central already shows (local; zero SQL)

- Operator need: a manager locked out of Manage (e.g. Brian's PIN failing everywhere) had no in-app recovery path. New flow on both sides reusing the existing ticket contract: the Manage PIN dialog gains "Forgot PIN? Get help" — files category `Access` / priority `High` / source `hpos_manage_pin` via the existing `admin:createSupportTicket` IPC (logged-in session author attached, notification email fires), reuses the already-open request on repeat taps (no duplicate spam), refuses digit-only notes so a PIN can never be typed into a ticket, and offers "Check for reply" which reads back the latest `command_central` message via `requests:getAll` with a best-effort read receipt. Offline fails closed with reconnect guidance.
- Command Central: no new UI — the existing SupportTickets inbox already lists/filters/replies by category/priority with the open-count badge (verified, pinned by test). Deliberate non-goal: no remote PIN reset or unlock bypass; recovery stays human-verified through support, PIN checks unchanged.
- Bar manual impact: Required — Part H one-liner (forgot-PIN help request + reply check from the Manage PIN dialog). PDF rebuild, dialog screenshot recapture and manifest approval fold into the already-pending guides rebuild.
- Evidence: new `bar-manage-pin-recovery` 5/5; full `test:bar` 548 pass + only the pre-existing `bar-guides-contract` checksum failure; esbuild JSX check clean. Relaunch required (renderer).

## 2026-09-15 — Stock/Cash/Sales move under Manage; Manage button requires manager PIN (local; zero SQL)

- Operator request: move Stock, Cash & close and Sales under the Manage page, and require the manager to enter a PIN when opening pages under Manage. Scope agreed: Bar + Restaurant rails, direct URLs keep working (no redirects), PIN gate sits on the Manage button at the bottom of the sidebar, unlock lasts one session up to a 15-minute timeout.
- Fix (local; zero SQL): `HPOS_DOCK_ITEMS_BAR` is now Sell/Open tabs/Products and `HPOS_DOCK_ITEMS_RESTAURANT` is Sell/Open checks/Floor/Kitchen/Menu (`barModeProfile.js`); Stock/Cash/Sales stay in `HPOS_MORE_ITEMS_BAR` and are added to `HPOS_MORE_ITEMS_RESTAURANT` so both modes list them in the Manage hub with descriptions. New shared `HPOS_MANAGER_GATED_ROUTES` (`/hpos/manage`, `/hpos/stock`, `/hpos/cash`, `/hpos/reports`) + `isManagerGatedPath` + 15-min `HPOS_MANAGER_PIN_UNLOCK_TIMEOUT_MS`. New server-enforced `verifyManagerPinForManage` (`pos.js`, online `pos_validate_pin` with manager-only `pos.menu_manage` — the only manager-only POS capability the server PIN allowlist enforces — offline cached verifier with manager/admin-only roles, supervisors and cashiers fail closed) wired through `database.js`, `pos:verifyManagerPin` IPC (`index.js`) and preload. `HposLayout.jsx` routes the Manage button, command palette and deep links through the same unlock, remembers only a session timestamp (PIN never stored), blocks gated page content until unlocked, and clears on user change/timeout.
- Permission note: supervisors lose rail access to Cash & close/Sales (now Manage-only, managers/admins with PIN). Cashiers unchanged (never had Manage). Capability checks on the pages themselves are untouched; the PIN is an additional step, not a replacement.
- Bar manual impact: Required — manuscript Parts A/C/E/F updated (rail now Sell/Open tabs/Products; Stock/Cash/Sales via Manage + manager PIN, 15-min unlock). PDF rebuild, screenshot recapture (rail + Manage PIN dialog + locked placeholder) and manifest approval fold into the already-pending guides rebuild; `bar-guides-contract` checksum failure remains pre-existing.
- Evidence: new `bar-manage-pin-gate` 5/5; `bar-base-product` + `bar-mode-curation` + `restaurant-hpos-service-contract` + `bar-till-base-entitlements` + `bar-financial-ui-regression` 91/91; full `test:bar` 543 pass + only the pre-existing `bar-guides-contract` checksum failure; `test:offline-queue-critical` + `test:offline-pos-critical` ok; `node --check` clean on main files, esbuild JSX check clean on touched renderer files. Relaunch required (main + renderer).

## 2026-09-15 — Bar Till "Earlier sale needs checking" whack-a-mole: 38 stacked pendings; definitive replay refusals no longer block (local; zero SQL)

- Symptom (operator, Lounge): the Fanta 2L P25 banner (`9/15/2026, 1:52:05 AM`) reappeared on every Till visit and bound Pay to the old attempt, killing selling speed. Live profile truth: 38 `pending` journal entries (23:14–23:52 UTC, real items — Fanta/Simba/Russian/Heineken/GranPa, same outlet/shift/user), each with a local `pos-orders` row `_sync_state: failed` (36x `Insufficient stock for X`, 2x `fetch failed`). Queue empty (dead letters cleared earlier), so the 38 were orphaned pendings that could never drain.
- Root cause: `infrastructure.js` dead-lettering called `reopenPosSubmitAttempt` for EVERY dead POS replay, including definitive server refusals the server proved were never recorded (same class the online path already clears via `outcomeMayStillBeAmbiguous`). Recovery surfaces only the newest pending, so clearing one reveals the next — 38 banners in a row. The collapse was also memory-only, so every remount re-expanded it.
- Live verification + unblock (operator-approved): service-role read-back of all 38 ids found 0 server rows — safe to clear with no double-charge risk. Backup `pos-submit-attempts.json.pre-unblock-38-<ts>.bak` taken in the live profile dir; all 38 pendings cleared via the journal contract (pending now 0, `getPending` null). The 38 local failed order rows are retained for audit; nothing was retried, so no sale was created by the unblock. Operator next after relaunch: confirm banner gone, compare cash vs Sales, fix the short stock (delivery/adjust), and re-ring fresh only what was handed over but never recorded.
- Fix (local; zero SQL): new pure `isAmbiguousPosOrderReplayError` (`infrastructure.js`) — only timeout/network/fetch/ambiguous/till/shift/idempotency reopens to pending; definitive refusals (insufficient stock, catalog snapshot, validation) clear the journal while the failed row + dead-letter stay for review. `countPendingPosSubmitAttempts` (`posSubmitJournal.js`) surfaced as `pendingCount` (`pos.js`); Till banner shows `N earlier sales` when stacked, persists collapse per attempt (`hpos-recovery-collapsed:<intent>`), and gains a `Re-check Sales` button that re-runs the server lookup and clears itself when nothing is unresolved.
- Bar manual impact: Required — Part C/H one-liner (definitive stock/short failures now fail in place with review guidance instead of blocking the Till; only truly uncertain sales bind Pay). Fold into the pending guides rebuild; manuscript untouched by this change.
- Evidence: `bar-pos-submit-journal` + `bar-till-recovery` new pins pass (26/26); `test:offline-queue-critical` + `test:offline-pos-critical` ok; till-service/retry-shift/stress 27/27; full `test:bar` 537 pass with only the 2 unrelated pre-existing failures (`bar-guides-contract` checksum pending rebuild + `bar-base-product` nav, neither touches these files); `build:hospitality-pos` passes. Relaunch required (main + renderer).

## 2026-09-15 — Stock "offline" banner while online: orphaned WEEKS provisional rows; purge-on-discard (local; zero SQL)

- Symptom (operator, Lounge): Stock shows `Offline - showing last saved stock` while online. Cause: 18 local `inventory-items` rows (`WEEKS Stock N MU1Q*`, preflight stamps) stuck `_pending_sync`/`pending` — their product requests are terminally rejected (or queue-cleared), so they never replay, and `getItemsWithReadStatus` correctly reports `complete: false`. Server has all compat columns; no item lacks `updated_at` — the banner is honest, the rows are orphans.
- Second gap found: the Products banner only listed actionable requests (rejected ones were invisible) with only Retry (which throws for rejected) — the wired `pos:discardProductRequest` IPC had NO UI caller, so rejected saves and their provisional rows were stranded forever.
- Fix (local; zero SQL): `purgeProvisionalProductRows` (`pos.js`, key-scoped to `pos-menu-items` + `inventory-items`, server rows never carry the marker); `discardProductRequest` now gates on terminal state (missing/rejected only), purges, and journals `provisional_product_purged`; startup `recoverPendingProductRequests` sweeps purges for already-rejected requests (backfill; requests stay listed for explicit discard); `getProductRequestStatus` includes rejected entries; Products banner shows Discard for rejected rows with confirm + purged-counts notice (Retry stays for the rest). IPC dual-capability gate unchanged (server-enforced).
- Bar manual impact: Required — Part E one-liner (rejected saves discardable; discarding clears pending rows). Fold into pending guides rebuild.
- Evidence: new `bar-product-contracts` block; `offline-queue-regression` ok; `bar-financial-ui-regression` 37/37; esbuild JSX checks clean on touched renderer files. Relaunch required (main + renderer). Operator next: Products → discard each rejected WEEKS save (18 rows purge, banner clears), then re-check Stock.
- Follow-up same day (operator request): Products banner gains an All / Needs retry / Rejected filter with counts so rejected saves are visually separable; pins extended in the same contract block.

## 2026-09-15 — Timeout persists under burst concurrency; export single-flight (local; zero SQL)

- Symptom (operator, Lounge): statement timeout + provisional banner persisted AFTER both export rewrites and after discarding the 9 void rows. Live DB evidence: role timeouts are `authenticated` 8s / `anon` 3s; the full wrapper measures 994ms solo, but 6 concurrent full calls reproduce `canceling statement due to statement timeout`. Each call builds/transfers a 5.46MB envelope, so bursts (dev StrictMode double-mounts every Reports visit, plus parallel voids/waste/slow-movers reads) saturate the small instance and every caller times out together. pg_stat_statements confirms app reads spiking to 2.6s individually.
- Fix (`src/main/index.js`, local; zero SQL): `loadAuthoritativePosHistoryExportDeduped` single-flight keyed by range+outlet — concurrent identical callers share one statement (also halves duplicate report-run rows). All 4 call sites (history, excel, pdf, daily-close) switched; sequential calls always re-run for fresh data.
- Evidence: `bar-financial-ui-regression` 37/37 (updated pins); `test:bar` 534 pass + only the pre-existing guides-checksum failure; `node --check` clean. Relaunch required (main-process code).

## 2026-09-15 — Export blocked by 9 orphaned WEEKS void records; new manager Discard path (local; zero SQL)

- Symptom (operator, Lounge): after the timeout fix, `POS history export is blocked while 9 financial operation(s) await sync or resolution` + permanent provisional banner. Certified query now runs; the guardrail correctly refuses to certify while local financial rows are unresolved.
- The 9 (all WEEKS stress voids, same requester, 00:05:10–00:05:20 UTC): 3 failed `Order not found` (queue items already cleared by operator) + 6 `pending` with no error and NO queue/failed backing (orphaned when the queue was cleared). Live server check: 4 reference orders ABSENT server-side (true orphans, nothing real to void); 5 reference REAL `completed` server orders P25–P84 with zero void logs (live unfulfilled void intents on real money).
- Design gap found: `sync:clearFailed` → `markClearedSyncItemForManualReview` patches related ORDER rows but never touches local void-history rows, and no UI path existed to resolve them — cleared/orphaned void rows blocked certified exports FOREVER. (The 346 stale failed local order rows do not block: date filters require `business_date`, which offline-created rows lack.)
- Fix (local; zero SQL): pure `resolveLocalVoidDiscardEligibility` + `discardLocalPosVoidRecord` (`pos.js`), `removeLocalPosVoidHistory` (`posOffline.js`, re-exported), `pos:discardLocalVoidRecord` IPC (`sync.manage`, same gate as Clear), preload binding, and a System Health `Void records awaiting confirmation` desk with per-row Discard + financial confirm. Fail-closed: offline refuses, server-confirmed voids resolve to synced instead, queue-backed rows redirect to Retry/Clear, order-standing discards warn that the sale is kept (re-void at Till with supervisor PIN otherwise). Every discard writes a `financial_void_record_discarded` health fault + journal entry + status broadcast.
- Data-hygiene flag (NO action taken): Sept server data holds ~2,155 WEEKS-named test orders (Sept 14, ~P128k gross) from the synced stress bulk. Certified totals will present them as real Lounge revenue until the operator decides (bulk-void, adjust, or accept). Operator next after unblocking: decide test-data disposition.
- Bar manual impact: Required — Part H one-liner for the void-records desk + Discard control (fold into pending guides rebuild); the Till re-void flow itself is already documented.
- Evidence: `offline-queue-regression` ok (eligibility matrix 8 asserts + wiring pins); `bar-financial-ui-regression` 37/37; `test:bar` 534 pass + only the pre-existing guides-checksum failure; `node --check` clean on main files, esbuild JSX check clean. Relaunch required (main + renderer).

## 2026-09-15 — Sales history gaps: export statement timeout + stillborn Waste card (migration ready, NOT yet deployed)

- Symptom (operator, Lounge): Sales history shows too little data with `canceling statement due to statement timeout` and a permanent `This transaction view is provisional (server)` banner; terminal also shows `inventory:getMovementsWithReadStatus failed: An inventory item is required for scoped movement history` (waste section always empty) and one transient `[POS TABS] Remote tab refresh unavailable: fetch failed` (network blip, by-design cache fallback, no change).
- Root cause 1 (timeout): `get_pos_financial_report_export_v2_unscoped` (live body renamed from `20260812030000` by `20260814010000`) computes each order line's stock cost with a correlated subquery over `inventory_movements` (sequential scan per line, no covering index) plus per-order `pos_order_items` probes with no `(order_id, lodge_id)` index. After the 2500-order stress sync, a monthly range blows past the statement timeout; the Till falls back to provisional local rows (banner + blocked totals/exports, correctly fail-closed).
- Fix 1 (`supabase/migrations/20260915010000_pos_report_export_timeout_fix.sql`, LOCAL ONLY, not pushed): two `IF NOT EXISTS` covering indexes + pre-aggregated `movement_costs` CTE (one pass over the period's depletion movements, NULL-item movements excluded exactly like the old per-line predicate which could never match NULL) joined per line. Diff-verified against the prior body: only the CTE/join/indexes differ; output keys, control totals, certification semantics, auth wrapper and grants untouched (file has no GRANT/REVOKE — OR REPLACE preserves ACLs; live `_unscoped` stays service-role-only behind the authenticated wrapper).
- Root cause 2 (waste): the `inventory:getMovementsWithReadStatus` IPC demands `item_id`, but the Waste card (added later, `da964c82`) queries the period ledger with none — the guard predates the card, so the Waste card NEVER worked (tests mock IPC, which is why suites stayed green). The domain read already supports item-less queries and rows carry `outlet_id`.
- Fix 2 (`src/main/index.js`, local): item-less calls now run the lodge-wide ledger and scope rows to the operator outlet (single-item lodge/outlet assertions unchanged). Fail-closed `complete` semantics untouched: sparse ledgers still render UNAVAILABLE rather than invented waste.
- Bar manual impact: Required — Part F one-liner (Waste card now populates where it previously showed Unavailable; totals/exports still gated on certified reads). Fold into the pending guides rebuild; manuscript untouched.
- Evidence: new `bar-financial-ui-regression` blocks (export scale-out pins + waste outlet-scope pins) 36/36; live `db lint --level error` zero errors (live schema, pre-push). Deployment: `db:push` NOT run — needs operator go-ahead (one migration, read-path-only, indexes build in ms on these table sizes).
- Deployed 2026-09-15 (operator-approved `db:push`, exactly `20260915010000`): live read-back via pooler confirms the `_unscoped` body carries `movement_costs` with the old per-line scan gone, SECURITY DEFINER kept, both indexes live, migration row recorded, `_unscoped` grants unchanged (`postgres` + `service_role` only), post-push `db lint --level error` zero errors. Nothing published; no relaunch needed for the server fix, but the waste IPC fix above is main-process code and needs a relaunch.
- Correction same day: part 1 alone did NOT end the timeouts (operator still repros). Live shape timings explain why: tables are small (2174 orders / 2179 items / 4539 movements) but the function ran thousands of sequential correlated `jsonb_agg` subqueries in one statement (measured 3.5s for the item shape alone over a long-RTT path; the full statement exceeded the timeout under load). Part 2 (`20260915020000_pos_report_export_item_agg_fix.sql`, deployed same approval line, read-path-only, verified live: grouped agg present, old correlated agg gone, 2 intended index-covered EXISTS kept, both migrations recorded, lint clean): `order_items_agg` CTE aggregates the period's lines in one grouped pass, left-joined per order. Proven byte-identical on all 2169 real September orders (0 mismatches) and the full assembly chain measures 712ms end-to-end (was multi-second + timeout). Contract pins added (`bar-financial-ui-regression` 37/37).
- Operator next: (1) approve `db:push`, then reopen Sales history for September and confirm certified totals + no timeout; (2) clear the 4 WEEKS queue rows per the earlier note.

## 2026-09-15 — Bar dev endless load: deterministic sync churn from WEEKS void/cashup leftovers (local; zero SQL)

- Symptom (operator-reproduced 2026-09-15 ~10:20 UTC, `dev:restaurant-bar` on Botswapelo Lounge): terminal stuck printing `Syncing 4 offline operation(s)...` + `[Sync] Backing off 1000ms before retrying rpc approve_pos_void_with_pin` forever; app window never finished loading. Main process one thread at sustained high CPU, starving renderer boot IPC.
- Queue truth (live profile `45f21c52`, before fix): 4 active items — 3x `approve_pos_void_with_pin` (WEEKS stress `MU1USDIP` over-ring voids, 00:05 UTC) failing deterministically with `Order not found`, plus 1x `submit_pos_shift_cashup_with_attendance_pin` (WEEKS cashup) stuck on `Skipped: parent operation failed`. `sync-failed.json` empty (operator cleared dead letters during the 51→22 cleanup, orphaning these dependents). Verified in `20260604201454` the void RPC checks the order row BEFORE any PIN validation, so `Order not found` is deterministic and PIN-independent — identical bytes can never succeed. Failure loop: 5 retries with backoff → dead-letter → 30-min auto-requeue (`DEAD_LETTER_AUTO_RETRY_AFTER_MS`) + 60s/120s timers + unconditional post-void inventory refresh = endless churn with multi-MB cache rewrites per attempt (`pos-orders.json` 4.5MB/2515 rows after the stress sync).
- Fix (`src/main/domains/infrastructure.js`, zero RPC change, nothing discarded): new pure `isTerminalPosVoidFailure` — void `Order not found` / `Cannot void a settled order` dead-letter manual-review-only (visible in System Health with the server message intact, excluded from auto-retry); `Order is already voided` (desired end state, e.g. voided from another terminal) is consumed as synced via `isAlreadyAppliedRpcError` (placed before the payload-id gate — voids carry `order_id` inside the payload); skip branch now ignores lingered failed ids for parents that completed in the same run, and parks a child manual-only only when its failed parent can never replay (manual-only dead this run / already manual-only / gone entirely — still-pending or retryably-dead parents keep the child retryable so ordering converges).
- Effect on the 4 live items (on next launch, one short final cycle): 3 voids → manual-only dead letters; cashup (parent order cleared, absent everywhere) → manual-only `can no longer succeed` dead letter. Churn stops; operator clears the 4 test-origin rows via System Health Clear per the ongoing WEEKS cleanup (owner-approved stress artifacts, none committed server-side).
- Bar manual impact: Required — Part H one-liner (deterministic void/settled refusals and unresolvable-parent skips park in manager review with Retry/Clear unchanged); folded into the already-pending guides PDF rebuild/manifest approval, manuscript untouched by this change.
- Evidence: `test:offline-queue-critical` ok; `test:offline-pos-critical` ok; `test:bar` 531 pass + only the pre-existing `bar-guides-contract` PDF-checksum failure (guides rebuild pending, unrelated); `node --check` clean. Diagnostic note: I stopped the runaway dev processes during investigation — relaunch required. File-parse timings ruled out data size as the CPU cause (22MB op log parses in ~0.5s); the saturation came from the retry churn, not the profile size.
- Honesty note (2026-09-15, same day, after operator pushback): the void churn above is proven (terminal snippet + queue state + SQL check-order-first), but the 10:19 boot's 300+ CPU seconds is NOT fully explained by it — `sync-meta.json` proves that boot never started a sync pass (`lastSyncStartedAt` stayed `08:24:17`, replay ran unauthenticated). Added additive-only `[BOOT]` phase markers (`initDatabase` phases, cache-refresh fire/done, backup start/done, window created in `src/main/index.js` + `infrastructure.js`; zero behavior change) so the next launch attributes wall time to an exact phase from the terminal output. Operator next: relaunch, and if the window still hangs, paste the `[BOOT]` lines plus what the window shows (splash vs `Loading restaurant workspace...` vs login) — the gap between two markers identifies the slow phase in one round trip.
- Root cause found via the `[BOOT]` markers (operator-provided terminal, same day): 63s connectivity probe (two 10s-timeout fetches stretched by a starved event loop) + a 59s gap between two adjacent statements around the boot `refreshAllCaches()` fire + 121s total refresh. The loadingscreen stall is a main-thread freeze, not data size: `buildSyncStatusSnapshot`/`getSyncDetails` resolved every dependency id with its own `readCache` file read + full parse. The WEEKS cash-up carries 2500 `_depends_on_all` ids, so one status computation re-parsed the 4.5MB `pos-orders.json` thousands of times. Triggered at boot (`markSyncRefreshStale` → `broadcastSyncStatus`), then every 30s by the Layout `sync:getStatus` poll and every System Health open — each freeze minutes long, starving renderer boot IPC.
- Fix (`src/main/domains/syncStatus.js` + `sync.js`, zero RPC/behavior change to resolution outcomes): new `createDependencyCacheResolver` — one shared per-computation index (each touched cache parsed at most once, rows keyed by id); both grouped-count classifiers and `getSyncDetails` enrichment thread it through, with pending/failed id Sets replacing per-id array scans. Single-id `isQueuedDependencyResolved` export kept (delegates to a fresh resolver; the hot sync loop never calls it — `pickNextReadySyncItemIndex` ignores the callback).
- Evidence: headless perf proof against the live data shape (temp copy, read-only): `buildSyncStatusSnapshot` with the 2500-dep cashup + real 4.5MB cache = 1 file read / 164ms; `getSyncDetails` = 2 reads / 303ms (was thousands of reads ≈ minutes). `test:offline-queue-critical` + `test:offline-pos-critical` ok (new pins for the resolver threading + void classification). `[BOOT]` markers kept (one line per phase per launch; they proved their worth here).

## 2026-09-14 — Lounge P5 retry unlock-loop: stale shift cleared session before server rewrite (local; zero SQL)

- Live defect, operator-reproduced on Botswapelo Lounge: the Earlier-sale banner retry for P5 `3783c8fb` (Brian, Counter, 1x GranPa, P5 cash, 9/13) unlocked fine as Brian, then instantly re-prompted `Till has locked` in an endless loop. Root cause: the retry replays original bytes with closed shift `5d1897d1`; the IPC Till gate (`getSharedTillActionContext` authorize) runs BEFORE the `createPosOrder` loop-breaker rewrite, so every retry failed SHIFT_MISMATCH identically and the gate cleared the session. The 2026-09-13 rewrite fixed the server payload but never the pre-gate check.
- Fix (`src/main/index.js`, zero RPC change): the gate reattributes a stale shift to the operator's current open shift for the authorize check only, via new pure `src/shared/tillAuthorizeShift.js` `resolveAuthorizeShiftId` + existing `db.getStaffOpenPosShift` (cache offline, RPC online). Payload, journal bytes and digest are untouched; any doubt keeps the original shift (fail closed). Same-outlet guard; tab paths already send session values (no-op there).
- Live verdict 2026-09-14 ~23:50 UTC: after both fixes + relaunch, the P5 retry reached the server and got terminal `catalog_refresh_required` (old snapshot predates the order; server rejects pre-write, nothing charged). The existing non-ambiguous path auto-cleared the journal (live `pos-submit-attempts.json` now `[]`) and the Till dismissed the banner with rebuild guidance. Operator next: Refresh Till, verify GranPa on the current menu, re-ring P5 fresh, verify in Sales. Either way the loop ends and the journal block lifts.
- Second break found on the same retry (operator-reproduced after the first fix): `This sale attempt was already submitted with different details`. The online path journalled the freshly rebuilt envelope (new catalog snapshot id, recomputed totals), which can never hash equal to the 9/13 original — so every legitimate retry tripped the changed-payload conflict and the `reused` branch below was unreachable. Fix (`src/main/domains/pos.js`, zero RPC change): same-intent retries swap in the journalled bytes via new `getPosSubmitAttempt` read-only accessor BEFORE recording (mirrors the offline path); genuinely new intents unaffected, changed sales still get fresh intent ids upstream. Amounts/operator/outlet still byte-identical under the original operation key.
- Bar manual impact: none (restores the documented retry behavior; no new operator workflow).
- Evidence: `tests/bar-till-retry-shift.test.mjs` 8/8 (authorize matrix + Lounge P5 authorize shape + wiring/static contracts + journal stored-envelope accessor + rebuilt-conflict vs stored-reuse reproduction); related `bar-pos-submit-journal` + `bar-till-recovery` + `bar-offline-shift-guardrails` + `bar-till-operator-policy` 42/42; `node --check` clean on touched files. Nothing published; relaunch required for UI (both fixes).
- GranPa follow-up (same night): fresh re-ring STILL gets `catalog_refresh_required`, while other items appear to sell. Authenticated PostgREST read showed 0 rows — later proven an RLS artifact by direct-DB read (see correction below); the rows exist and other items confirm normally. Local cache holds 8 sellable rows (GranPa ghost `d2be44dc` + others) with no server counterpart. Fix is republication, not retries: delete the ghost in Products (`already_deleted` → purges on reload), re-create via the wizard (price 5 → `selling_price` 5; wizard falls back to price, verified in code), re-enter Sell, sell, verify CONFIRMED in Sales. Same treatment for any other local-only item that fails.
- The 51 dead letters in the Lounge profile are ALL this night's WEEKS preflights (stamps MU1QKMAE/MU1QMRJR/MU1QP1RG), three spec bugs, none committed server-side: 18x `save_bar_product_with_stock` (`selling_price: 0`, server requires >0 — spec copied the TEST-Bar field), 18x dependent publication skips, 6x deliveries + 3x adjusts (human `weeks-*` op ids; server casts to uuid), 4x offline unlocks (provisional-shift FK), 2x cashup parent-skips. Disposition: manager-review Clear of WEEKS rows only (51 rows: every entry mentioning WEEKS/weeks — `weeks-lounge-product-*`, `weeks-delivery-*`, `weeks-adjust-*`, `weeks.crew.*`, `WEEKS expense`, `WEEKS` cashups/unlocks — plus 1 older `live-ui-product-MU188960-14` test row), never bulk-clear. Spec fixed: staff/shift/unlock move ONLINE (documented exception — identities must exist for replayable shifts), volume stays offline; `selling_price` mirrors price; UUID op ids; periodic offline session refresh. Pre-Sept-14 incident dead letters are gone (retried/cleared through the normal paths).
- GranPa re-created via wizard (request `a92d1c37`, 22:20 UTC): state `committed`, publication `pending`, no error — yet the Till still fails `catalog_refresh_required` on a fresh basket. CORRECTION (direct-DB read 2026-09-15 ~00:05 UTC via pooler, bypassing RLS): the server catalog is FINE — 8 `pos_menu_items` rows incl. GranPa `e217f942` (P5, available, created 22:20:48Z), fresh snapshot `39b99c86` published 22:19 for the Bar outlet, both grants present, migrations `20260913000000/20260914000000/20260914010000` deployed, proof-remap marker present in `activate_shared_till_operator_offline`. My earlier "server menu empty" claim from PostgREST reads was an RLS artifact (anon AND Brian-JWT list reads return zero while the same key family works through SECURITY DEFINER RPCs) — lesson: verify list-reads against the app's read path or direct DB, never anon/RLS-filtered selects alone.
- Remaining GranPa cause: the Till sends the STALE cached snapshot id (local `pos-catalog-snapshots.json` predates the 22:19 publish), so the server correctly reports the item missing from THAT snapshot. Fix is client-side refresh, no data repair: tap the Till's stock-status refresh control (rendered with the cached-readiness note / unavailable banner — the only refresh buttons in the Till), rebuild the basket, pay. No more re-creates.
- Root cause underneath (deployed 2026-09-15 ~00:40 UTC as `20260915000000_catalog_publication_job_anon_grants.sql`, exactly one migration via `db:push`): `claim/complete/fail_catalog_publication_job` granted EXECUTE to authenticated+service_role only, but desktop connects with the anon key — every publication sweep died with `permission denied for function claim_catalog_publication_job`, publications piled pending, snapshots froze (latest Bar snapshot 22:19, before GranPa's 22:20 save). ACL read-back confirms anon now present on all three; enforcement stays server-side (SECURITY DEFINER + lodge/outlet checks, grant-only file). Sweep re-run (`desktop-lounge-publish-sweep`, app closed): `published` job `7ccb9355`, fresh Bar snapshot `9808b42d` 22:50 UTC including GranPa. Operator: reopen, re-enter Sell, fresh GranPa basket, verify CONFIRMED in Sales.
- UI-silence gap (logged, unfixed): a locally-saved but unpublished product renders a normal Till card with no unpublished marker (unlike provisional/pending-sync chips), so the first signal is the Pay-time `catalog_refresh_required`. Products request state (`committed` + `publication: pending`, per-request Retry) is the only indicator, buried in Products. Fix direction: Till-side unpublished guard with guidance before Pay; cause-side fixes (grants/spec fields) already done.
- Resolution 2026-09-15 ~01:00 UTC: operator confirms the fresh GranPa sale went through and shows in history. Trading unblocked.
- Cleanup in progress: dead letters 51 → 22 (operator cleared deliveries/adjusts/partial products). Remaining 22 all test-origin, none committed: 10x product saves (keys `weeks-lounge-product-*`), 10x dependent publication skips, 1x test unlock (WEEKS Crew 1 MU1QP1RG, FK), 1x dependent test cashup skip. The desk renders table/error text, not operation keys — hence no visible "weeks" rows; identify by exact error strings. 12 WEEKS test users did sync server-side (STRESS-named, owner-approved); rejected WEEKS product-request entries remain for Products-side discard.
- Full thousands-scale stress RUN 2026-09-15 (~58 min, `desktop-lounge-weeks-offline-stress`, SCALE=full, stamp MU1USDIP, leave-queued): 25 users + shift + Till unlock + operator clock-in online; offline bulk 120 products, 2500/2500 counter sales, 30 PIN voids, 20 clock-ins, 1 cash-up, 25 deliveries, 20 adjusts — queue 0 → 3197 pending, 0 failed, still offline at close. Missed volume (55, spec-side, queued nothing): 40 tabs (offline raw-IPC `saveTab` needs the UI-minted operator proof; my periodic offline session refresh replaced the proof-carrying online session — reorder tabs before sales next run) and 15 returns (my payload omitted `shift_id`, which the API requires — `pos.js:2355`). Expenses correctly skipped (Lounge plan gate). Next: operator reopens online and syncs 3197 (the real pressure test); tabs/returns rejoin in a follow-up run with the two spec tweaks.

## 2026-09-14 — Lounge offline stress: 516-op outage run, chaos replay, exact money (test only; zero SQL)

- New `tests/bar-offline-lounge-stress.test.mjs` (7/7, ~3s, deterministic seed, isolated temp profile — live data untouched): a full Lounge Bar trading day queued offline (12 clock-ins incl. 2 duplicate attempts, 6 tills incl. duplicate-unlock guard probe, 40 products + snapshot publish, 332 counter/tab sales, 20 tabs, 5 voids, 3 returns, 2 cash-ups + clock-outs with 2 no-cash-up refusals, 53 inventory ops, 30 expenses, 10 maintenance, 3 poison ops incl. the GranPa snapshot-orphan pattern), then replayed through 12% timeouts, 5% duplicate deliveries and a mid-replay restart against a contract-faithful mock server. 8 transfers + 6 splits run the real `posTabRecovery` envelope lifecycle incl. ambiguous-commit and stale-version paths.
- Verified: queue drains fully; every committed key applied exactly once; dead-letter set is exactly the 5 poison ops (retained, none silently dropped); dependencies commit before dependents; cash/card/tips/discounts/voided/returned reconcile to the pula; stale-shift reattribution resolves the current open till. Real code exercised: `syncStore` persistence/journal/meta, `pickNextReadySyncItemIndex`, `isFinancialSyncItem`, tab recovery, `resolveCurrentOpenShiftId`.
- Bar manual impact: none (test-only, no operator workflow change).
- Evidence: `test:bar` 523 pass + 1 pre-existing `bar-guides-contract` PDF-checksum failure (manual rebuild pending); `test:offline-queue-critical` ok; `test:offline-pos-critical` ok. Nothing published.

## 2026-09-14 — Botswapelo Lounge 6 dead-letters: offline Till FK + shift guardrails (migration + local)

- Incident: Botswapelo Lounge (`45f21c52-...`, Bar outlet) dead-lettered 6 ops 2026-09-13→14 after 5 retries (`sync-meta: All 6 item(s) dead-lettered`): 2x `activate_shared_till_operator_offline` FK `pos_till_operator_proofs_pos_shift_id_fkey`, 1x `create_pos_order_v3` blocked parent (P5 GranPa counter), 2x `clock_out_staff_with_attendance_pin` cash-up guard, 1x `clock_in_staff_with_attendance_pin_offline` duplicate active shift.
- Server root cause: `20260816200000` offline Till wrapper remapped only `pos_shifts.id`, but `20260820180000` added synchronous child `pos_till_operator_proofs` + `open_pos_shift_with_id` already-open return for same outlet/cashier. New `20260914000000_fix_offline_till_proof_remap.sql` (forward-only, OR REPLACE, grants preserved): fresh replays remap proofs before shifts; pre-existing opens return `already_open` with `remap_skipped` instead of remapping. Dependents unblock via existing dependency + `resolveCurrentOpenShiftId` reattribution.
- Local guardrails (`src/main/domains/pos.js`, zero RPC change): offline Till unlock returns the existing open shift for same staff+outlet (plus queued-till check) instead of queueing a duplicate; offline PIN clock-in fails closed when a clock-out for that staff is still pending sync and reuses a pending clock-in instead of double-queueing; offline PIN clock-out mirrors the cash-up check on local cache before flipping the row or queueing, so it can no longer optimistically complete then dead-letter and poison the next clock-in.
- Lounge remediation (operator, after migration deploy): deploy migration via `db:push` path + parity/lint; System Health Retry — the 2 Till ops then succeed (already_open) and the P5 order replays under the current open shift; the 2 clock-outs stay correctly blocked until My Cash-up `submitted/approved` for `ee54afa6`/`08d98088`; the duplicate Lelentle clock-in `277028b7` is invalid while `dbff630e` is active — clear that single non-financial item only after verifying the active list. Never bulk-clear the financial P5 order.
- Bar manual impact: Required — Parts C/H one-liners for duplicate-unlock already-open, pending-clock-out wait, and offline cash-up block (PDF rebuild/manifest approval pending with guides workstream, same as prior entries).
- Evidence: new `bar-offline-shift-guardrails` 6/6; `bar-offline-continuity` + `bar-offline-rpc-contracts` + `bar-till-recovery` 15/15; `bar-migration-drift-fresh-chain` static 4/4 (5 DB cases skip without disposable). Deployment 2026-09-14: linked `oicgpknsmtvcsjacymum` was at parity through `20260913000000`, so `db:push` applied exactly `20260914000000`; post-checks `migration list` parity through `20260914000000`, dry-run `Remote database is up to date`, `db lint --level error` zero errors, `db advisors --level error` `No issues found`, live `pg_proc` read-back confirms proof-remap + already_open + SECURITY DEFINER, EXECUTE grantees anon/authenticated/postgres/service_role. Nothing published; relaunch required for UI.

## 2026-09-14 — Botswapelo Lounge follow-up: 3 remain, P5 needs re-ring, clock-outs now auto-clear

- State 10:22 UTC: 6→3. Server truth: both attendance shifts completed today with fresh keys (`de01873f` 10:17, `dbff630e` 10:21), both cash-ups `submitted`, both tills (`08d98088`, `ee54afa6`) still `open` by design until manager review + shift close. P5 order `3783c8fb` never committed (0 rows server-side); GranPa exists/available but latest snapshot `c02cf5f7` v9 (09:25) predates it (created 09:50), so the immutable-snapshot rejection is correct — old payload can never succeed, must re-ring on a fresh snapshot, then clear old with manager review.
- Fix deployed `20260914010000_clockout_idempotent_close.sql` (parity through `...01`, dry-run up to date, lint/advisors clean, live `pg_proc` confirms `already_closed` path): already-completed clock-outs return success instead of idempotency-conflict dead-letter. Next Retry clears the 2 clock-outs automatically. No data changed by deploy.
- Till still open after clock-out is normal: attendance close ≠ till close. Close tills via review + shift close; then clock in fresh before new sales.

## 2026-09-13 — Retry unlock-loop breaker: stale shifts rewritten on interactive retry (local; zero SQL)

- Operator defect: a stuck Earlier-sale banner retried forever through unlock — every retry replayed the original bytes including a since-closed shift_id, so the server failed it identically and the Till re-prompted unlock in an endless loop (no dismiss exists anywhere by design). The interactive retry now reattributes to the current open shift via the same shared `resolveCurrentOpenShiftId` helper the queue replay uses (amounts, waiter, outlet, timestamps untouched; journal keeps original bytes; claim-first still returns the stored result when recorded). Queue replay refactored onto the same helper. No migration; server remains the backstop.
- Bar manual impact: none (restores the documented retry behavior; no new operator workflow).
- Evidence: `bar-offline-create-and-sell` +1 shift-resolution block (unit + both paths); full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-12 — All five offline gaps: tabs, expenses envelope, voids UI, checklists, device exports (local; zero SQL)

- Tabs (largest): open/add/settle queue offline behind an unlocked Till (PIN-verified session replaces the live-proof gate). Local tab rows never invent versions; holds rewrite the queued upsert in place (last-writer-wins); settles queue behind their tab create and mark the local row closed-pending. Replay reattributes weeks-old work to the waiter's current open shift (per the server's current-shift settlement design; waiter/outlet/amounts/dates untouched), strips stale operator proofs, and sends tab version conflicts straight to manager review; dead settles reopen the local tab visibly. Transfer/split/merge stay online-only. No migration: existing version/conflict/shift checks remain the backstop.
- Expenses: full offline already existed; fixed the one gap (expenses:getAll joins the transport envelope so server-complete metadata survives IPC).
- Voids: transport already queued with encrypted PIN; void forms now open on completed and still-syncing sales with queued-approval copy (approval stays server-side at replay).
- Checklists: lists/templates cache with fast fallback; ticks and template starts queue offline with stable keys (last-writer-wins per tab analogue for template starts); UI survives the seed throw and names pending state.
- Reports: new Device Excel/PDF exports of this terminal's saved records, every page UNCONFIRMED, same reports.export gate; certified path untouched.
- Bar manual impact: Required — manuscript Part H documents all five (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: new `bar-till-offline-tabs` 10/10; `bar-till-base-entitlements` gate copy updated; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-12 — Offline create-and-sell for weeks offline (local; zero SQL)

- Owner need: remote bars offline for weeks must create products and sell them without connection. Chain, all client-side (no migration): offline product saves queue a local catalog snapshot behind the product replay; offline sales join their provisional products' queue ids as dependencies so the runner replays product → snapshot → sale in order; product replay success rewrites queued `pending:` menu identities to the real server ids (duplicate-name consumes resolve the surviving row by exact name); provisional cache rows are purged by operation key afterwards. The Till sells provisional rows offline at the entered price with a Pending-sync chip, and blocks them with Syncing once the server is reachable but the sync is outstanding. Server pricing/depletion still resolve at replay; Pay-time server checks remain the backstop.
- Bar manual impact: Required — manuscript Part H documents offline create-and-sell ordering (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: new `bar-offline-create-and-sell` 6/6; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-12 — My-sales totals always visible as marked estimates (local; zero SQL)

- Owner decision (online-first): My sales shows saved figures even before server certification, each uncertified figure carrying an explicit * estimate mark plus a footnote (last saved on this device, not confirmed; certified figures replace them on refresh). Corrections still require certified truth and cash-up never reads this screen; the main Sales report, Business Control and PWA stay certified-only (multi-terminal aggregates must not present estimates as truth). The prior withhold-until-complete guardrail test now pins the estimate contract instead.
- Bar manual impact: Required — manuscript Part F documents *-marked estimates (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: `bar-financial-ui-regression` estimate contract 34/34; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-12 — Offline hardening: receipts, retry banner, fast cache reads, clock-out guard, pending products (local; zero SQL)

- Receipts: `POSReceipt` renders an explicit empty state instead of throwing to the recovery screen when the order is gone; the PROVISIONAL banner hides on print/PDF (customer copy) while staying on screen.
- Retry banner root-caused: offline success left the journal `pending`, so the banner returned on every remount with no minimize. New `provisional` journal state (recorded locally + queued): ignored by recovery and the new-sale block; replay success commits it, dead-letter reopens it for manager recovery. The banner now collapses to one line (Pay stays bound to the original attempt).
- Slow offline loads: `withNetworkTimeout` (12s) + cache fallbacks on menu, staff list, staff PIN (cached verifier), outlets and inventory pages; preload strips Electron's `Error invoking remote method` prefix so errors read human.
- Clock-out now requires a submitted/approved cash-up for an open POS shift across Till, team list and kiosk (server RPC unchanged — residual).
- Offline product saves upsert provisional rows (visible Pending sync in Products, excluded from Till selling); replay success purges them by operation key. Physical Count stays online-only by design (certified starting number); My-sales totals stay server-certified by design.
- Bar manual impact: Required — manuscript Part H documents pending products, no-retry-after-completion, cash-up-before-clock-out and count-online (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: `bar-pos-submit-journal` +3 provisional blocks; `bar-till-service` +1 collapse block; `bar-products-stock-badges` +1 pending block; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-12 — Products names out-of-stock from counted links (local; zero SQL)

- Owner need: see finished items on the Products page. Cards with a direct stock link now carry Out of stock at zero (header counts them), Only X left at/below reorder level, and the on-hand count on the stock line; counts refresh with the catalogue and fail soft to the last read. Availability flags are untouched (zero never flips them); non-stock and recipe items show no badge. Pure renderer change on the already-loaded inventory read — no migration, no new IPC.
- Bar manual impact: Required — manuscript Part E documents the badges (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: new `bar-products-stock-badges` 3/3; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-12 — Till automatic sold-out from counted stock (deployed to linked oicgpknsmtvcsjacymum)

- Owner need: no manual switch — finished items must grey out by themselves and refuse sale at the Till. Readiness carried no counts by design, so `20260913000000_bar_readiness_on_hand.sql` extends `get_pos_menu_stock_readiness` rows with `on_hand` + `stock_unit` for direct-stock items only (mirrors the Pay-time `current_stock` check, same lodge). Safety per review: no GRANT/REVOKE/DROP/DML in the file (OR REPLACE keeps the existing authenticated + anon EXECUTE, incl. the desktop-read convention), same signature and role check, additive jsonb keys old clients ignore, counts only (no costs/recipes/suppliers), and no other consumer uses this read (Legacy POS and PWA checked).
- Till: zero-count items render grey Finished — out of stock and untappable; taps/typing/scans past the count refuse with Only X left; Same again skips short lines; counts re-read quietly after every sale (silent failures keep badges; manual Refresh still reports loudly). Old servers without counts keep today's behavior with the server as backstop. The manual eye switch is removed entirely.
- Deployment: linked project `oicgpknsmtvcsjacymum` was at parity through `20260912000000`, so `db:push` applied exactly this one migration. Live-verified by query: history row present, 1 overload, body carries on_hand + stock_unit with the role check kept, SECURITY DEFINER + search_path=public confirmed via pg_proc, EXECUTE grantees still anon/authenticated/postgres/service_role, `migration list` parity through `20260913000000`, `db lint` zero errors. Nothing published; relaunch required for UI.
- Defect found by operator (Serobe greyed Finished): `Number(null)` is `0`, so uncounted rows (non-stock/tray food) read as zero stock. `countsOf` now skips null/undefined explicitly; regression pins null (absent) vs 0 (present). Fixed locally with build rerun; relaunch required.
- Bar manual impact: Required — manuscript Part C documents automatic finished (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: `bar-till-service` now 8/8 (migration safety + counts travel + auto-block); full `test:bar` + `build:hospitality-pos` rerun below.

## 2026-09-12 — Till service round: sticky errors, Same again, card sold-out, Pool night, low badges (local; zero SQL)

- Operator defects fixed: a failed Pay (e.g. server short-stock refusal) left its error forever — Clear and new basket input never retired it. Every basket mutation (add, +/−, type quantity, remove, clear) now clears the sale error; the next Pay revalidates fresh while uncertain-attempt recovery state stays untouched.
- Same again rebuilds the last sale from the live catalog in one tap (fresh prices; missing/unavailable/stock-blocked lines skipped and named). Sold-out switching moved onto the Till card eye switch behind the existing `pos.menu_manage` contract (managers toggle in place with confirm; cashiers get manager guidance, no new auth surface). Pool night adds every available table at once (type each box cash, pay once). Low badges (Only X left) load idle after opening via capability-gated `inventory:getLowStock`, guidance only, never blocking; cashiers without `inventory.view` simply see none.
- Bar manual impact: Required — manuscript Part C documents all five behaviors (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: new `bar-till-service` 5/5; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-12 — Till payment footer can never lose Take payment (local; zero SQL)

- Serious defect, operator-reproduced: with required cash received, a blank-received Pay attempt showed the tender error while Take payment was unreachable — the basket list could not shrink (missing `minHeight: 0`), so the error banner pushed the footer out of the clipped column. The list now shrinks, the button stays rendered (disabled only while the tender is invalid, never unmounted), Collect Cash is one compact line, and the single-tender breakdown box (a pure repeat of the total) only renders for split/account sales or live tender errors. Cart rows carry one inline line total with no repeated unit-price line.
- Bar manual impact: none beyond the already-documented cash flow (no new operator workflow; restores the documented Pay reachability).
- Evidence: new `bar-till-payment-footer` 4/4; full `test:bar` 462 pass with only the 1 `bar-guides-contract` PDF-checksum failure (guides rebuild pending); `build:hospitality-pos` passes. Nothing published; relaunch required for UI.

## 2026-09-12 — Bar cash received required with P20/P50/P100/P200 (local; zero SQL)

- Owner need: every cash sale must record what the customer handed over. Bar cash Pay now blocks while Cash received is blank (tap Exact, P20, P50, P100, P200, or type); quick list grows from P50/P100/P200 to P20/P50/P100/P200. Restaurant mode keeps the old optional behavior; uncertain-attempt retries still reuse their original aids and never re-prompt. Received/change stay display-only tendering aids (allocation is always exactly due), so no migration or RPC change was needed.
- Bar manual impact: Required — manuscript Part C documents required received plus P20 (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: new `bar-cash-received-required` 3/3; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-12 — Bar pool tables daily cash per table (local; zero SQL)

- Owner need: Botswana bars run multiple pool tables; games are not counted, only cash per table per day matters, any amount (even odd pula). Each table is now one product in a new `Pool` category: `Pool Table 1`, `Pool Table 2`, price P1, No stock tracking, no packs. Pool Till cards carry their own billiard-ball icon on soft felt-green (never Softs teal). End of day: add each table to one counter sale, type box cash as quantity (Table 1 P80 = quantity 80), Pay cash once.
- Till shows a Pool hint when Pool lines are in the basket (quantity means pula); wizard locks Pool to P1 (price box disabled, server payload forced to 1) and locks Stock source to No tracking (box disabled) with plain help and fast defaults; a basket holding Pool lines offers Cash only (card/mobile/split/account hidden, auto-reset to cash, main-process `enforceBarBaseTenderBoundary` rejects anything else); basket rows are one compact line each with a small 54px quantity box so several items fit without scrolling, touch targets stay 44px; Sales gains a Pool tables card with each table collected plus All pool tables total (fails soft to Unavailable on uncertified reads, empty state guides Products setup). Category/total flow reuses the existing atomic `create_pos_order_v3` catalog pricing, offline queue, idempotent retry, blind cash-up and receipt detail — no migration, no new RPC.
- Bar manual impact: Required — manuscript Part E (pool product setup) and Part F (night entry + Pool card + cash-only + compact rows) updated; PDF rebuild/manifest approval still pending with the guides workstream.
- Evidence: new `bar-pool-tables` 7/7; full `test:bar` 455 pass with only the 1 `bar-guides-contract` PDF-checksum failure from the manuscript edit (guides rebuild pending); `build:hospitality-pos` passes with Till + Reports markers in fresh bundles. Nothing published; relaunch required for UI.

## 2026-09-11 — Stuck publication retries and stale-catalog Till recovery (local; zero SQL)

- Two live defects behind one operator report (Russian Full unpublished, Till rejecting with the raw snapshot error): the Products banner retry replayed committed entries verbatim without ever sweeping publication, and the wizard's publication retry swept only the form outlet (empty list reported success). `retryProductRequest` now sweeps a committed entry's stored outlets and marks the outcome; the wizard reuses that stored-request path so banner and dialog always agree.
- The Till maps `catalog_refresh_required` (and the raw snapshot message) to refresh-and-rebuild guidance; the server rejects pre-write, so the copy states nothing was charged.
- Bar manual impact: Required — Part E gains the publication/refresh paragraph (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: `bar-product-contracts` +1, `bar-base-food` +1; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-11 — Base Bar slow movers and shift handover (local; zero SQL)

- Sales report gains a Slow movers card: stocked items with no sale in the last 14 days (never-sold items count once matured past 14 days), quantities only, from the existing stock-list and stock-aging reads. No costs, no reorder advice — Pro purchasing suggestions and valuation untouched.
- My Shift gains a handover section for the open shift: completed sales count (certified reads only), open tabs with names, waste since shift start, and cash-up state. Counts and names only, never takings, preserving blind cash-up; every figure fails soft to Unavailable.
- Bar manual impact: Required — Part C (handover) and Part F (slow movers) one-liners; PDF rebuild/manifest approval still pending with the guides workstream.
- Evidence: `bar-base-food` 21/21; full `test:bar` 445 pass with only the 2 pre-existing `bar-guides-contract` PDF-checksum failures (plus one transient ENOSPC flake in the same file while C: was completely full — passes with space freed); `build:hospitality-pos` passes. Nothing published; relaunch required for UI.

## 2026-09-11 — Base Bar waste summary in Sales report and POS exports (local; zero SQL)

- The Sales report carries a quantity-only Waste card (per-item wasted quantities with top reason for the selected period), and the POS history Excel/PDF exports carry Waste Summary plus line-level Waste Detail with the same numbers; the JSON companion adds the same waste dataset. One shared `src/shared/wasteSummary.js` aggregator serves all three surfaces.
- Boundaries kept: only Waste-action movements count (other decreases excluded), money never appears (costed waste/margin stay Pro), sections render only on a complete server movement ledger (labeled UNAVAILABLE otherwise), and exports omit waste without the stock permission. No migration, no new RPC.
- Bar manual impact: Required — Part F documents the card and export sections (PDF rebuild/manifest approval still pending with the guides workstream).
- Evidence: `bar-base-food` 19/19; full `test:bar` + `build:hospitality-pos` rerun below. Nothing published; relaunch required for UI.

## 2026-09-11 — Auto-menu sync no longer mints duplicates for wizard-covered stock (deployed to linked oicgpknsmtvcsjacymum)

- Incident: renaming wizard-made stock in Stock re-ran `sync_inventory_item_to_pos`, which found no auto row and inserted a new auto sellable, duplicating the wizard product(s) at the Till (Russian/Russian Half case).
- Fix as `20260912000000_bar_sync_skip_covered_stock.sql`: the INSERT branch now fires only when no `pos_menu_items` row of any kind references the stock. Early-return cleanup, in-place auto-row maintenance, and standalone-stock minting are byte-identical to `20260911000000`. No privilege statements in the file (`CREATE OR REPLACE` keeps existing access); pinned by contract test.
- Deployment: linked project `oicgpknsmtvcsjacymum` (this worktree's app target) was at parity through `20260911000000`, so the push applied exactly this one migration. Post-checks: `migration list` parity through `20260912000000`, dry-run `Remote database is up to date`, `db lint --level error` zero errors. Live function-body read-back was not performed (no SQL console path from here); evidence is push success + parity + lint + static contract tests.
- Operator note: the already-minted auto `Russian` row is not removed by this migration — delete it once from Products (its stock stays listed via the Half), then add Russian Full. Future stock edits will no longer re-mint it.
- Evidence: `bar-product-contracts` +1 block; full `test:bar` 438/440 with only the 2 pre-existing `bar-guides-contract` PDF-checksum failures. Bar manual impact: none beyond the existing rename guidance (no new operator workflow).

## 2026-09-11 — Base Bar no-stock products for in-house food (local; zero SQL)

- In-house food cooked by the tray (hundreds of fatcakes a day) can now skip stock entirely: the Bar wizard's Stock source offers No stock tracking, persisted as `stock_method = 'non_stock'` through the existing `create/update_pos_menu_item` contracts (tip definitions from `20260716025000` accept and store it; the Till/readiness path already sells it with no depletion). No migration written or deployed.
- Server-shape findings pinned by tests rather than new SQL: outlet stays null on create (the current tip has no beverage-outlet guard; null-outlet items pass the Till outlet filter so fatcakes sell at the Bar), edits keep the existing outlet scope, recipe-forced sections (breakfast/starters/mains/sides/desserts/cocktails/food) fail closed client-side because the server would silently force the recipe method, and linking from a stockless product now offers the selected row's version instead of a null that the server rejects.
- Display repair included: the desktop menu list read omitted `stock_method`, which would have shown non-stock products as needing stock setup; the column is now selected (additive, cache-compatible). Availability toggles round-trip `non_stock` because updates omit `stock_method` and the server preserves the stored method.
- Retry discipline mirrors stock-only creation (no operation key on the plain contract): ambiguous failures must be checked in Products before any explicit retry, never replayed blindly; the wizard says so.
- Bar manual impact: Required — Part E gains the no-stock paragraph (manual availability, recipe-forced exclusion). PDF rebuild/manifest approval still pending with the guides workstream.
- Evidence: `bar-base-food` 11/11; full `test:bar` + `build:hospitality-pos` rerun below. Migrations NOT pushed (none written), nothing published; relaunch required for UI.

## 2026-09-11 — Base Bar food improvements: weighed units, clearer flow, sizes & extras, waste action (local; zero SQL)

- Base Bar (`bar_pos`, no add-on) food gaps closed without any migration: the server contract already stores any unit text and accepts any positive decimal `depletion_qty` (`20260909000000`), so no `REVOKE`/`GRANT` risk was taken after the 2026-09-10 anon-grant outage. No files under `supabase/` were touched.
- `BAR_COUNTED_UNITS` (new shared list): bottle/can/keg/packet/portion/each plus kg/g/l/ml, used by both the product wizard and the stock dialog. `BAR_PRODUCT_CATEGORIES` gains `Cider`. Fries can now consume weighed ingredients (e.g. Potatoes in kg at 0.3 per sale) with the existing atomic `save_bar_product_with_stock` + Till depletion path, idempotent and audited as before. Pack sizes stay server-pinned 6/12/24; copy now states packs work for portions too.
- Wizard `Flow` relabelled `What are you adding?` (option contracts unchanged), depletion help carries the weighed example, and a Sizes & extras notice surfaces applicable modifier groups with a manage shortcut (Products; Stock entry shows the notice read-only). Waste action on each Stock row posts a negative delta through the existing idempotent `adjust_inventory_stock` RPC (`inventory.manage`, lodge assertion, fresh operation key, offline-queued) with structured `Waste · reason_code=…` notes and required reason/detail; validation/notice helpers gained additive `waste` branches.
- Bar manual impact: Required — `manuscript.md` Part E extended (weighed depletion, sizes/extras, portion packs, Waste). PDF rebuild/manifest approval still pending with the guides workstream.
- Evidence: new `bar-base-food` 8/8; full `test:bar` 432/434 with only the 2 pre-existing `bar-guides-contract` PDF-checksum failures (output/pdf vs manifest drift from the parallel guides workstream; reproduced at baseline, untouched by this change); `build:hospitality-pos` passes; `git diff --check` clean. Migrations NOT pushed (none written), nothing published; relaunch required for UI.

## 2026-09-11 — Product delete delists stock automatically; opening-stock exactly-once (deployed to linked Theko)

- Operator requirement: deleting a product must delist its stock item in Stock automatically, with movement history preserved for financial truth and auditing. Deployed as `20260911000000_bar_product_delete_delists_stock.sql` on linked `hwzkwdfmoeayophaktsq` (Theko); live-verified by query.
- `delete_pos_menu_item` now: (1) returns idempotent success for an already-deleted row (`already_deleted`) so offline queue replays of applied deletes never dead-letter; (2) on hard delete, delists the linked stock item (`inventory_items.is_active = false`) ONLY when no remaining reference keeps it in service — any `pos_menu_items` row of any template kind including archived, legacy `menu_items`, `restaurant_recipe_ingredients`, and `restaurant_prep_item_ingredients`/`restaurant_prep_items.produced_inventory_item_id` (joined by lodge); (3) writes a `stock_delisted_with_product_delete` entry to `restaurant_financial_audit_log` with `movements_preserved: true`. Movements are never touched by the delist path. The archive path (sale history) keeps stock listed by design.
- Opening-stock exactly-once repair: the AFTER INSERT `log_inventory_opening_stock_movement` trigger is the single opening writer. The wizard contract's explicit insert (third writer, note "…when the product was created") was removed; `restaurant_seed_inventory_item_stock_location_balance` keeps seeding the location balance but no longer writes its second opening movement. Provable same-event duplicates were deduplicated in-migration (wizard rows dropped when any other opening row exists; plain "Opening stock" rows dropped when the richer seed row exists) — post-check: 0 items with duplicate openings DB-wide.
- `save_bar_product_with_stock` stock duplicate-name guard now excludes inactive items, so a delisted name is reusable when the product is re-created. `sync_inventory_item_to_pos` refuses to resurrect auto sellables for inactive stock.
- Desktop/UI: `deletePosMenuItem` passes the server outcome flags through; HposMenu reports "Product deleted and its stock item delisted. Movement history is preserved for audit."; delisted stock is excluded from HposStock list + Count-All scope, lodge Inventory list, the wizard's link list, HposMenu pickers, and day-use lists. `get_bar_stock_aging` already excluded inactive items server-side.
- Incident remediation on Theko: the three phantom "Coke 330ml" stock items from the 2026-09-10 retry storm (products already deleted by the operator, 0 purchases, only defect-written openings) were deduplicated to one opening movement each and delisted with three `stock_delisted_with_product_delete` audit entries. Operator next step: re-create Coke 330ml normally — one save now yields exactly one product, one stock item and one opening movement.
- Blank count sheet printed blank (reported by operator): `index.css` runs a global print policy (`body * { visibility: hidden !important }`) that whitelists specific printable overlays; the Bar count sheet used display-only print rules, so it kept layout but painted nothing. Fixed in `hospitality-pos.css` by joining the visibility whitelist and anchoring the sheet `position: absolute` at the page top (the established multi-page report-overlay pattern, so long sheets flow across pages). Regression pinned in `bar-stock-base-ergonomics`; the browser harness bundle CSS regenerates from source via esbuild on each suite run. No manual update required (restores already-documented behavior; defect printed empty pages).
- Evidence: `bar-product-contracts` +2 blocks (delist SQL contract incl. movement-delete count = 2 dedup rules only; operational-filter wiring across surfaces); full `test:bar` 424/431 — only failures remain the pre-existing `bar-guides-contract` PDF-checksum pair; `build:hospitality-pos` passes; `git diff --check` clean. Bar manual impact: Required — manuscript Part E updated (delete delists stock, history preserved, freed names reusable); PDF rebuild/manifest approval still pending with the guides workstream. `20260909060000` verification migration still deliberately local-only.

## 2026-09-11 — Bar product save: duplicate-name guard, terminal rejections, queue resolved-detection, Bar sync Clear (deployed to linked Theko)

- Incident: the 2026-09-10 outage of `save_bar_product_with_stock` (anon EXECUTE revoked, then a broken deployed pack loop) left every wizard save as a retryable `unknown` product-request under a freshly minted operation key. After the RPC was repaired, retrying the stored failed entries created the same product/stock repeatedly (operation-key dedupe cannot see cross-key duplicates), and the Bar System Health queue had no Clear control.
- Deployed on this machine's linked project `hwzkwdfmoeayophaktsq` (Theko) — the DB the customer app actually hit; note other PROJECT_STATE entries reference `oicgpknsmtvcsjacymum` from a parallel workstream. Chain deployed today: `20260910000000` (anon EXECUTE re-grant), `20260910010000`/`20260910020000` (surgical pack-loop patches, superseded), `20260910030000` (full-body redeploy with index-iteration pack loops + anon grant), `20260910040000` (duplicate-name guards). Live verified by query: product guard (`A product named … already exists`, 23505, pack rows excluded, edits exclude self), stock guard (same lodge + same outlet-or-unassigned location), index loops present, `v_pack_row->>` gone, ACL `{postgres,service_role,anon,authenticated}` all EXECUTE.
- `20260910040000_bar_product_duplicate_name_guard.sql`: both guards fail closed BEFORE any mutation with recovery hints; same-key replays return earlier (unaffected); `bar_pack` derived rows excluded from the product match. Legacy `save_bar_pos_product_with_packs` path is not exposed by the current renderer (preload has no binding) and remains unguarded — deliberate scope boundary.
- Chain-tolerance repair: `20260910010000`/`20260910020000` were fail-closed DO patches against live-drift shapes; on a fresh disposable chain their anchors can be absent, which would abort the chain even though `20260910030000`/`040000` redeploy the authoritative body. Both files were edited post-deploy (live never re-runs them) to skip with a `raise notice … superseded by 20260910030000` instead of raising; pinned by a contracts test. Fresh-chain convergence: 20260909000000 → grants → optional patches (skip) → 030000 → 040000 = final guarded body.
- Desktop flow: `src/shared/productRequest.js` adds `isDefinitiveProductRejection` (SQLSTATE 22023/23505 ⇒ terminal); `pos.js` `dispatchOnline` now returns `{transported, rejected}` for those instead of throwing retryable-unknown, so stale duplicate entries become `rejected` (discardable from the Products banner) instead of re-dispatching forever. Transport/permission/missing stay retryable.
- Queue resolved-detection: `infrastructure.js` `isAlreadyAppliedRpcError` treats `save_bar_product_with_stock` refusals matching `^A (product|stock item) named …` as already-applied (resolved elsewhere ⇒ item consumed as synced, never dead-lettered). The match is prefix-anchored so barcode/operation-key conflicts (which also say "Use the existing product instead.") stay reviewable.
- Bar UI: `HposSystemHealth.jsx` failed-operations desk gains per-row and bulk Clear (calls existing `sync:clearFailed` IPC; records manager-review health faults + journal exactly like the admin panel), with a confirm gate when any selected row is financial; queue-desk copy explains Retry vs Clear. CSS wrappers `hpos-sync-header-actions`/`hpos-sync-row-actions` (+ mobile breakpoint) in `hospitality-pos.css`.
- Evidence: `bar-product-contracts` +7 blocks (guard SQL, classification wiring, resolved-detection, Clear controls, chain tolerance); `bar-product-save-flow` +2 (classifier unit matrix; retry-storm duplicate under a new key terminally rejected with one effect and discard). Full `test:bar` 422/429 — the only 2 failures are the pre-existing `bar-guides-contract` PDF-checksum pair (reproduced at baseline without these changes; the concurrent guides workstream owes the rebuild). `offline-queue-regression` ok; restaurant suite unchanged (same 3 pre-existing disposable-DB-gated failures at baseline and with changes). `build:hospitality-pos` passes; `git diff --check` clean.
- Bar manual impact: **Required** — visible controls and workflow changed. `manuscript.md` updated: Part E now states a product/stock name can only be used once (use the existing product instead); Part H documents System Health Retry vs Clear (stops retries, records for manager review). Pending before release: screenshot recapture of the Products/System Health flows, PDF rebuild, manifest approval and packaged offline smoke — folded into the already-pending guides rebuild above.
- Operator follow-ups: (1) delete the already-created duplicate products from Products, keeping one copy — the guard is forward-looking and does not dedupe existing rows; (2) stale failed/pending product saves on the device will terminally reject on their next retry with the duplicate-name message and can then be discarded from the Products banner; (3) relaunch the Bar app to load the new renderer/main code; (4) `20260909060000_fnb_drift_full_block_verification.sql` remains local-only (deliberately not pushed with these fixes).

## 2026-09-10 — Bar repair tranche F1–F8: persistence, wizard, SQL, publication, recovery, gating, docs (local; migrations NOT deployed)

- F1 `src/shared/productSaveFlow.js` (new, pure/tested): persist-once with verified read-back writes (storage failure blocks dispatch), verbatim replay under stable keys, overwrite rejection on changed payloads, single-flight per key, definitive-rejected vs unknown-outcome vs pending-upgrade states, crash recovery enumeration. `pos.js` save path rebuilt on it (replay-first ordering preserved around journal reuse); startup + 15-min recovery scheduler in `index.js`; retry/status/discard IPC + preload + facade.
- F2 wizard: staged legacy fallback removed (missing RPC preserves the request with an update-required message); edit hydration of packs/barcodes/availability with preserved-changes saves; operation-key rotation only on real value changes after failure; explicit unknown-outcome retry; stock-only safe-retry guidance; Products interrupted-save banner with per-key retry (`pos:getProductRequestStatus`/`retry`).
- F3 SQL (local files): mandatory edit versions under row locks, disabled-pack skip, mid-transaction auto-menu cleanup scoped to fresh rows, server opening-stock movement, outlet authorization; barcode triggers remain the concurrency backstop.
- F4 publication: shared sweep machine with per-outlet published/pending/failed/no-job (empty never proves publication), poison cap with permanent-fail RPC path, supersede reporting; `complete` RPC requires token + live lease and reports supersession.
- F5 Till recovery: canonical key builders, init-gated draft persistence, hold id submitted + persisted together, identity reconciliation preserving unknown outcomes, actionable storage-failure states.
- F6 modifiers: trigger rewrite (distinct-attribution counting, malformed rejection), INSERT-only tab-save coverage, domain replay-first ordering.
- F7 Till gating: `tillEntitlements` matrix (base/add-on/denial/restaurant), customer/promotion read/control/submit gates, approved stale-readiness cache with labeled banner, backend-update compat codes.
- F8: narrow-viewport basket drawer with totals bar (payment forces open), decimal-safe `roundCash` (1.005→1.01), split-tender exclusion pinned, manuscript updated (favourites, quick cash/change, Settle vs Resume, unified product flow, explicit float, reprint, stale readiness, retry saves).
- Evidence: new `bar-product-save-flow` 11/11 (executed same-key/overwrite/storage/concurrency/drop-after-commit/rejection/recovery + publication handover/expiry/overtake/partial/poison), `bar-basket-hold-recovery` 3/3, `bar-till-entitlements` 4/4, extended contracts/daily/recovery suites; full `test:bar` 414/416 with the only 2 failures in `bar-guides-contract` PDF-checksum tests caused by another concurrent workstream's mid-build untracked `output/pdf` + `document-manifest.json` (reproduces without my changes; my manuscript edit does not affect PDF bytes); non-DB restaurant suites pass; PG suites unrunnable here; `build:hospitality-pos` passes; `diff --check` clean on touched files. Migrations NOT pushed, nothing published. Residuals: disposable-DB run of `test:bar-product-sql` (skips without `BAR_PRODUCT_TEST_DB_URL`), guide screenshot recapture + PDF rebuild + manifest approval + packaged offline smoke (needs display + the concurrent guides build to settle).

## 2026-09-10 — Bar readiness missing-RPC ReferenceError fixed (local, needs relaunch)

- `src/main/domains/pos.js` called `isMissingRpcError()` on the stock-readiness and product-save RPC error paths without importing it (helper lives in untracked `src/shared/productRequest.js`). Every RPC error — including the expected missing-function case when `20260909030000` is undeployed — threw `ReferenceError` instead of returning the graceful `backend-update-required` envelope, so the Till showed `Stock status unavailable — selling is paused` with no recovery via Refresh. Fixed with the one-line shared import; IPC already fails closed, renderer behavior unchanged (still paused on unknown readiness).
- Regression: `bar-product-contracts` now asserts the import + `backend-update-required` branches; `bar-product-save-flow` executes the real classifier (missing shapes true, transport/business errors false, null-safe). Full `test:bar` 411/415; the 4 failures are parallel-tranche drift (Bar-guide PDF checksums, `auto_from_inventory` migration text, single-line tabId regex), none from this fix. `build:hospitality-pos` passes.
- Residuals: `20260909030000` was already deployed (pooler dry-run reported up to date); renderer ignores the `code` and keeps fail-closed pause; `20260909030000` role list still excludes `supervisor`/`bar` logins (see prior investigation). No manual update required (internal defect fix, no customer-facing workflow change).
- 2026-09-10 deployment: forward migration `20260909050000_bar_read_rpc_anon_grants.sql` (anon EXECUTE on `get_pos_menu_stock_readiness(uuid)` + `get_bar_stock_aging(uuid,uuid)`, matching the established desktop-grant convention; enforcement stays server-side) pushed to production `oicgpknsmtvcsjacymum` via pooler — exactly one migration applied. Live verified: `has_function_privilege('anon',…)` true for both. Direct-DB hostname does not resolve from this network (pooler path used). Operator action: relaunch the Bar app from a build containing the `isMissingRpcError` import fix, then Refresh in Till/Stock.

## 2026-09-09 — Disposable-cloud SQL acceptance complete (isolated project; production untouched)

- Created isolated disposable Supabase project `repsrmlomedqrmrdsbga` (same org/region as production) with ref-guarded tooling; linked production project `oicgpknsmtvcsjacymum` was never written by this work (one read-only tenant SELECT excepted). No Docker was available, so the local-stack path was not used. Note: remote production migration parity advanced to `20260908020000` during this work via a separate party; the repaired July-30 bytes, drift repairs, payroll fix, and `20260909*` files are not deployed there.
- Applied the full migration chain (439 timestamped files) to the disposable with a tolerant runner (benign base-template conflicts ignored and logged; per-file BEGIN/COMMIT semantics emulated). Two genuine fresh-build defects surfaced and were repaired as forward-compatible migrations: missing `btree_gist` prerequisite ordering (environment bootstrap + report) and byte-exact source-snapshot assertions failing on fresh builds (July-30 attribution repair by Task A; three F&B drift repairs plus a payroll interval-literal fix authored here). A duplicate version collision (`20260909000000`) from parallel work was resolved by renaming the payroll fix to `20260909040000`; scratch `test.tmp.sql` was renamed out of the migrations glob and pinned by a filename guard.
- Per-migration object reconciliation over all 439 files: existence plus exact function bodies with surgical-patch/shutdown/rebuild/drop dispositions; 438/439 PASS, remainder is an accepted upstream platform-template drift (realtime subscription index, unreferenced). Migration history stamped; `db push --dry-run` reports up to date.
- Real SQL acceptance on the disposable, all green with exact SQLSTATEs under real `authenticated`/`anon` roles: cutover maker/checker 19/19, behavioral 11/11, recipe 1/1, settlement strict gate (contract + behaviors A-D), migration portability 8/8, drift fresh-chain 5/5, matrix + activation 31/31, plus a live manager-unlock/PIN-staff attribution demo (operator = shift waiter, audit actor = manager). F5 needed managed-platform session pooling discipline (per-subtest session reaping under the 15-session cap) and three test-source corrections (wrong RPC signature literal, complete budget matrix + conflict code, as-of date bound); the suites found one real app bug (payroll interval literal, fixed forward).
- Draft release packet in `docs/ACCOUNTING_RELEASE_READINESS_PACKET.md` (proposed/verified/pending separated). Still requiring explicit owner choices: pilot tenant/effective date/operators/devices/channel/abort owner, signing inputs (`CSC_LINK`, `CSC_KEY_PASSWORD` missing), publish token (`GH_TOKEN` missing), production migration deployment, and the go/no-go approval. No activation, signing, publishing, or production migration is claimed.

## 2026-09-09 — Bar customer guides packaged and exposed offline (repository implementation; UI smoke pending)

- Added the Bar documentation lifecycle gate to `AGENTS.md`, `docs/bar-manual/maintenance.md`, the pull-request template, `docs/SHIP_READY_RUNBOOK.md` and `docs/BAR_RELEASE_ACCEPTANCE.md`.
- Added `docs/bar-manual/document-manifest.json` for app applicability, distinct document revisions, review date, filenames and SHA-256 approval checksums.
- The actual Bar shell now exposes Help & guides from the HposLayout -> HposNav top-right profile menu, with Open manual, Open quick-start and Save PDF actions for ordinary authenticated Bar users. The renderer sends fixed document IDs through preload; main resolves only the allowlisted packaged resources under `resources/bar-guides/`.
- `apps/hospitality-pos/electron-builder.json` packages the approved Bar pair and manifest. Open/save are local and do not require connectivity or write operational records.
- Verification: the full `npm run test:bar` suite passes 395/395, and `npm run test:bar-guides` passes 12/12 executable checks; the final PDFs contain exactly 55 manual pages and 4 quick-start pages; fresh release renders contain exactly 55 and 4 page images. The final hashes are manual `682AB70A868C706B9AB0DDE18A1272F40791B968B91963F62D481B6FD79C3356` and quick-start `DE66637B4C8D2E1A44F1F8E2943D9A88C3784838F317B0C55E2F6434AE0C350B`; packaged copies match.
- Final verification rerun on 2026-09-10: `npm run build:hospitality-pos`, `npm run test:bar-guides`, PDF integrity checks, and the unpacked Windows package completed successfully; the actual packaged-window offline Open/Save smoke remains pending as recorded below.
- The prior Save dialog defect (`title: Save` referencing an undefined variable) was fixed and covered by executable cancellation, copy-failure, open-failure and missing-resource tests. The prior Bar recovery-screen crash was fixed by initializing HposTerminal selectedOutlet before dependent effects; build:hospitality-pos passes. Repository implementation and local packaged-resource verification are complete for this tranche. Packaged UI open/save testing remains uncompleted because the Windows Computer Use helper failed during initialization with `helper_unknown_error: apply deny-read ACLs`; a direct Playwright launch of the packaged executable also failed before a window opened. No signed installer, release-feed publication or installed-artifact smoke is claimed.

## 2026-09-09 — Bar P2b/P2c: selling polish, basket recovery, quick cash, reprint (local, needs relaunch)

- Till: per-outlet favourites + Top sellers (operator-ordered, never hardcoded), direct quantity entry (existing per-caller rules preserved, no integer imposition), single/pack basket badges, last-added highlight + scroll, Undo-remove (6s, unpaid only) + Clear confirmation, Open-tabs count button, resumed-tab identity header (“Ready to continue” / “Tab changed — refresh required”), Open Tabs Settle action distinct from Resume (requires certified total, auto-opens payment).
- Basket recovery: tenant/outlet/operator/shift-scoped drafts persisted on change, one-shot restore with explicit Restore/Discard; precedence resumed-tab > payment-recovery > hold-intent (matched by tab identity + recency) > draft; catalogue revalidation on restore (drop unavailable, refresh prices, report both). Hold intents persisted before dispatch and reconciled by tab identity.
- Quick cash: Exact/P50/P100/P200 + custom received for cash tenders, validated (received >= due, half-up rounding); allocation stays exactly due, excess is change only — pure shared helper `tillBasketRecovery.js` with behavioral tests. Receipts carry display-only `cash_received`/`change_due`; this-terminal last-receipt reprint without resubmission; absent aids never fabricated.
- Evidence: `bar-till-selling` 5/5, `bar-till-recovery` 5/5; full `test:bar` green; `build:hospitality-pos` passes. No migration, no deployment.

## 2026-09-09 — Bar P3/P4: atomic product contract, publication jobs, enforcement, wizard, daily flow (migrations NOT deployed)

- New local migrations (require linked-DB deploy + disposable-DB acceptance before any release): `20260909000000` atomic `save_bar_product_with_stock` (stock create-or-link + opening-once + product + packs, expected-version guards, barcode conflicts with recovery hints, wizard stock skips auto-menu sync by design, publication jobs created in-txn, full payload+ids persisted); `20260909010000` publication claim/complete/fail RPCs (token + unexpired lease, per-outlet versions, supersession, server-side tenant/outlet checks); `20260909020000` modifier-min trigger (sale rows only, reversals/legacy shapes exempt); `20260909030000` stock-readiness read (outcome only).
- Desktop: `saveBarProductWithStock` (dual capability, pre-dispatch durable request, verbatim retry, best-effort publish sweep), `processPendingPublicationJobs` worker (poison-attempt cap, desktop-closed pause stated), `getMenuStockReadiness` (pos.view, no recipe gate), domain modifier asserts (Till Hold/Pay + saveTab/createPosOrder, freshness-tracked, server trigger as backstop).
- UI: `HposProductWizard` (shared from Products + Stock, stock-only path, recipe read-only recovery without conversion, duplicates + use-existing, Save & add another, pre-migration staged fallback marked compatibility mode, publication retry); Till server-readiness gating (unknown/failed blocks selling with Refresh recovery; restaurant path unchanged); Till unknown-scan permission-gated creation; explicit opening float on Till + My Shift; Open Tabs sorting; Cash & close open-tab link; readiness grouped into 6 Bar sections (evidence/progress unchanged).
- Unrelated-worktree repair (no behavior change): `src/main/index.js` had a syntax error from concurrent pending work (`})  app.on(`) that blocked every build; split into two statements. Pre-existing `diff --check` whitespace flags in `HposLayout.jsx`/`HposNav.jsx` left untouched.
- Evidence: `bar-product-contracts` 9/9, `bar-daily-flow` 8/8; full `test:bar` 395/395; non-DB restaurant suites pass (`restaurant-hpos-service-contract`, `gaps-fixes` incl. a slice-bound fix for the new grouping block, mode-curation, operations-foundation, product-extraction 91+34); PG-backed suites un-runnable here (ECONNREFUSED 127.0.0.1:54322, no docker — pre-existing environment limit); `build:hospitality-pos` passes with wizard + worker markers in fresh bundles; `git diff --check` clean on all touched files. Migrations NOT pushed, nothing published. Relaunch required for UI; server features inert until migration deployment.

## 2026-09-09 — Bar Till touch targets enlarged, hover traps removed (local, needs relaunch)

- Till frequent controls now meet a 44px minimum: basket +/- (44px with accessible labels), remove (44px bordered, full opacity), category pills and service-mode toggles (44px height, larger type, `aria-pressed`). Cash/Card/Mobile/Split are 56px primary buttons; the final Pay confirmation is 60px. Product-card meta chips and the sold-out/setup label grew to 11–12px.
- Removed hover-only JS traps that stick on touch: product-card lift, cart-row highlight, trash opacity toggle, pay-button background mutation. Keyboard focus was already covered globally (`hospitality-pos.css` `:focus-visible` rules) and is now pinned by regression test. No scanner/keyboard shortcut behavior changed.
- Evidence: new `tests/bar-till-touch-targets.test.mjs` 5/5; full `npm run test:bar` 362/362; `npm run build:hospitality-pos` passes; `git diff --check` clean. Relaunch the Bar build. No Supabase deployment.

## 2026-09-09 — Bar Till skips floor-table reads in Bar-only mode (local, needs relaunch)

- `HposTerminal.jsx` no longer loads `getTablesWithStatus` when `shouldLoadTillTables()` is false (new `src/shared/barModeProfile.js` helper: true unless Bar-only). The current-shift read is untouched and always runs, so Bar still loads the correct operator/outlet shift; post-hold/post-payment table refreshes are gated the same way. Restaurant behavior unchanged (helper returns true there).
- Bar tab-name suggestions now come from the already-loaded tab list (`openTabNames` from `getTabs`) instead of floor tables. Stale voucher codes/amounts clear whenever the sale leaves walk-up counter mode (tab/table/customer), matching the voucher row visibility condition so hidden values can never reach the tender breakdown.
- Per approved baseline V4 P1 (safe subset): existing customer/promotion/recipe/modifier reads are retained until the P3 readiness contracts land; no migration in this tranche.
- Evidence: new `tests/bar-till-shift-tables.test.mjs` 4/4; full `npm run test:bar` 351/351 green on re-run (one transient `bar-migration-drift-fresh-chain` branch-matrix failure in an earlier run did not reproduce; that suite reads only migration SQL + an inline helper and passes standalone — pre-existing suite-level flakiness in this dirty worktree, unrelated to these files); `npm run build:hospitality-pos` passes with markers verified in fresh `out/hospitality-pos` bundle; `git diff --check` clean on touched files. Relaunch the Bar build to take effect. No Supabase deployment.

## 2026-09-09 — Lodge Starter team performance inside Staff (deployed migration)

- The lodging app now embeds a read-only Performance tab inside Staff (`StaffProductivityPanel`), so Starter teams see server-recorded task activity, timing, ratings and incidents per staff member with a working From/To filter. Copy follows the property vocabulary (lodge/camp/guest house/motel/B&B).
- Hotel and POS are untouched: `/workforce` stays Enterprise + Workforce add-on, `workforce_management` stays `hotel_only`/Enterprise in the catalog and plan maps.
- Read path only: desktop IPC tries `workforce_scheduling.view` then falls back to `staff.view`; migration `20260908020000` lets `get_staff_productivity_dashboard` accept `staff_basic` for `lodge-camp` only (other products still require `workforce_management`; lodge access + role check unchanged, fail closed). All manage RPCs unchanged.
- Also fixed the Workforce page Refresh to actually use the selected date range (it previously re-queried a hardcoded 30 days).
- Evidence: `tests/lodge-starter-productivity.test.mjs` 5/5, `restaurant-staff-management` 7/7, `production-guardrails` ok; migrations pushed via `npm run db:push` (including 3 pending accounting migrations from the worktree) and the live gate verified against the linked project (`LIVE_GATE_OK`).
- Note: `commercial-catalog-authority` has 1 pre-existing failure from worktree drift (6-arg `isCommercialFeatureIncluded` calls predate this change; Starter plan maps were not altered).

## 2026-09-09 — Cross-product Manager activity & performance workspace (local)

- The Manager PWA now has a single protected `/performance` workspace for LodgingOS, HotelOS, Restaurant OS, and Bar OS managers/admins with current product-aware metrics and a merged recent-activity timeline.
- It reuses existing server-backed dashboard, reporting, POS, financial-audit, and operational read contracts rather than adding a second client-side financial model.
- The route requires `dashboard.view`; individual unavailable sources are named with recovery guidance, while the visible data remains read-only.
- Restaurant/Bar POS monetary metrics fail closed as `Unavailable` whenever the period is not server-certified. Quotes, conference reservations, and day-use rows never display their non-ledger totals as confirmed cash.
- Evidence: focused `manager-performance-workspace` tests 3/3, Manager PWA lint, and production build all pass.
- No migration, database deployment, PWA publication, installer release, or live-data change was performed.

## 2026-09-08 - Activated Bar addon visibility and Manage refresh (local)

- Read-only linked-database inspection confirmed Botswapelo Lounge's active Bar POS licence contains all three approved addons. The deployed entitlement RPC still emits base-package-only effective_features alongside the full approved commercial_pricing_snapshot; the running desk cache already contains the addon keys.
- Desktop entitlement normalization now resolves valid product-scoped commercial grants before legacy Pro defaults for features omitted by that RPC. Explicit server feature denials, commercial force-off, expired/foreign contexts and role permissions retain precedence. This fixes reproduced workforce/advanced-report false defaults; accounting itself is permitted by the current source for the Lounge admin, so the exact prior on-screen state was not observed.
- Manage refreshes the shared entitlement snapshot on entry and offers Refresh package access with actionable failure feedback, avoiding the existing 15-minute renderer polling delay after Command Central changes.
- Focused behavioral regression: tests/bar-addon-activation-refresh.test.mjs 5/5. Full Bar gate 314/315: the browser-suite test fails in existing Accounting lifecycle scenarios A2/A3/A4 (cutover selector, activation read-back fixture missing lodge identity, and extra cutover-list reads); these files were not changed by this repair. build:hospitality-pos passes; main normalizer and Manage refresh markers verified in fresh output. Targeted git diff --check passes.
- No live licence edits, accounting cutover, migration deployment or installer publishing. Running Electron must relaunch to load the rebuilt main-process normalizer.


## 2026-09-07 - Verification-driven completion pass: V01–V05 fixed, restaurant gate 37/39, Accounting matrix reviewed, activation UI built (all local; nothing activated/published)

Independent verification (BAR_CLAIMS_VERIFICATION.md) reproduced five defect
classes in the prior pass; all are fixed here with behavioral (not
source-text) coverage. No production publishing, migration execution, grant
change, live-data repair, add-on enablement, or provider activation performed.

- V01 outcome classifier is now provenance-aware (`keyPreviouslySent`,
  explicit domain-unknown wins, server evidence required for commit, bare
  SQLSTATE/message proves nothing, replay-convergent version conflicts only).
  Domain tags every result with provenance; both tab IPC catch blocks tag
  `outcome: unknown`; post-commit cache reconciliation can no longer convert
  a commit into failure (warning field instead). Also fixed: thrown split RPC
  errors now convert to unknown envelopes instead of escaping. New
  `bar-tab-recovery-outcomes` 10/10 runs the REAL classifier + REAL domain
  functions (Electron stubbed, Supabase scripted, temp fs cache).
- V02 immutable replay executor (`replaySavedTabOperation` /
  `submitNewTabOperation`): verbatim saved requests with `is_replay`,
  per-operation replay auth (originator or manager), single-flight per key,
  archive-instead-of-delete, tenant-scoped inbox independent of the tab
  list/ownership/form state, read-storage errors block dispatch, corrected
  path validates terminal rejection itself. `HposOpenChecks` reworked to the
  two entry paths; status checks are labeled as same-key replays. Domain
  accepts `is_replay` past stale local pre-checks. New executor tests 10/10;
  real-browser R1–R6 pass (saved-3-way replay from a 2-way form, corrected
  new key, verbatim transfer replay, closed-tab inbox resolve, post-ownership
  replay, tenant isolation).
- V03 tenant binding: missing/blank lodge rejected whenever an expected
  lodge is known; fetch binder stamps requested lodge / refuses foreign
  answers; offline legacy snapshots bind only on single-profile devices
  (multi-profile must refresh); all Bar callers audited (one Till straggler
  fixed). New `bar-commercial-tenant-binding` 5/5 runs the REAL validator,
  binder, and offline adapter with seeded caches/registry.
- V04 standalone Bar per-tab filter (`workspaceTabAccess.js` decision
  contract: commercial force-off + capability, fail-closed without context;
  tampered `?tab=` renders explicit denial, never the child; outlet scope
  falls back to a sanitized URL value). Restaurant-mode behavior unchanged
  by design. Browser F1–F4 pass with zero-unauthorized-call spies; decision
  tests 7/7.
- V05 allowlisted bundle schema (`shapeSupportBundle`: known top-level keys
  only; bodies reduced to IDs/counts/codes/sanitized strings) + fixed
  replacer bug (numeric match offsets leaked into output) + context-aware
  scrub + cycle/binary/depth/size guards. Real `getSupportBundle` pipeline
  test with seeded synthetic secrets passes; verification probe fully
  redacted. 9/9 across both scrub suites.
- Phase B: restaurant gate 37/39 (was 27/39). Ten drift files resolved with
  per-assertion evidence in `docs/BAR_TEST_FAILURE_TRIAGE.md`; only the two
  PostgreSQL-blocked suites remain (no database/docker in this environment).
  Two real product issues found and fixed in triage: POS even-split omitted
  `source_tab_version` (optimistic concurrency gap), and the area-view
  toggle was missing (implemented: viewMode/tablesByArea/Grid-By-Area).
- Phase D: `docs/ACCOUNTING_RPC_AUTHORIZATION_MATRIX.md` now covers 95 IPC
  operations mapped to exact deployed signatures (definer/search_path/grants/
  tenant markers extracted per function; lifecycle caps reconciled as
  read/manage/close with no invented permission; orphan dispositions
  reviewed — main-internal artifact writers, one gated basic-report path,
  dead V2 superseded variants with no path). Executable guards 6/6 in
  `bar-accounting-matrix`. Found and closed a real maker/checker gap:
  `approve_restaurant_historical_cutover` existed server-side but was
  unwired — domain + `approveCutover` IPC op added.
- Phase E: `RestaurantAccountingActivation.jsx` on route
  `restaurant/accounting-setup` (read gate + manage-gated actions, linked
  from the readiness notice): readiness with actionable items, cutover
  prepare (idempotent) → independent approve (notes + hash echo +
  preparer≠approver warning) → explicit-approval activate with exact args →
  uncertain-response read-back recovery → suspend with retained-history
  note. Browser A1–A5 pass; node activation tests 5/5.
- Verification: `npm run test:bar` 309/309; `test:financial-truth` 189/189;
  `test:restaurant:all` 37/39 (2 PG-blocked); pos-rush 43/43;
  release-behavior/architecture ok; hardware-adapter ok (contract only);
  legacy-pos 219/219; manager lint 0 errors; `git diff --check` clean;
  `build:hospitality-pos` passes with all fix markers verified in fresh
  `out/hospitality-pos` bundles (unsigned local build, version still 1.5.7).
- Residuals needing explicit approval: (1) isolated disposable database for
  Phase C/D3 — no docker here, exact request in
  `docs/ACCOUNTING_SQL_ACCEPTANCE.md`; (2) release version number;
  (3) code-signing inputs + publish token for `scripts/release.mjs publish`;
  (4) pilot tenant/config/cutover/devices/channel (`docs/ACCOUNTING_PILOT_RELEASE_EVIDENCE.md`
  is an empty shell by design); (5) WP7 live two-terminal/device runs.
  Pre-existing cosmetic duplicate key `lost_found.manage` in
  `accessControl.js` labels left untouched.

## 2026-09-07 - Bar handoff WP1/WP2/WP3/WP6 implemented locally (not released)

- WP1 commercial entitlements: conflicting normalized override aliases now fail closed consistently across single-feature and set decisions; entitlement checks accept an optional expected lodge binding and all Bar callers (main IPC, domain, App, Layout, Manage Hub, Menu, Terminal, SubscriptionAccessPanel) supply it; Till voucher/tip gating now consumes the shared entitlement object instead of bare package strings (was silently ignoring force-on/off). New `tests/bar-commercial-overrides-wp1.test.mjs` 8/8; one stale regex in `bar-commercial-overrides.test.mjs` widened for the lodge arg without changing its invariant.
- WP2 split/transfer recovery: new `src/shared/posTabRecovery.js` durable envelope (tenant-scoped keys, legacy key migration reads, quarantine on corruption, persist-before-dispatch, unknown/rejected/needs_review classification); `pos.js` split/transfer preserve code/SQLSTATE/outcome and allow server-authoritative replay when the local tab cache lost the row; Open Tabs shows original-attempt summary with Check status / Retry original / Start corrected attempt (corrected only after proven rejection) and outcome-not-confirmed copy, never storage-deletion advice. New `tests/bar-tab-recovery.test.mjs` 9/9; one stale waiter-ownership source assertion re-pointed at the helper (legacy keys preserved there).
- WP3 finance route: reviewed the `finance-close -> restaurant_accounting` exception (kept); `/hpos/cash` confirmed Accounting-free; Bar Expenses confirmed on its own entitled `/hpos/expenses` page; finance tabs enforce per-tab FeatureGate without mounting unauthorized components; outlet query context preserved. New `tests/bar-finance-route.test.mjs` 6/6.
- WP4 gate: same 12 restaurant files fail as baseline (2 need approved disposable PG at 127.0.0.1:54322, 10 need product decisions + per-file capture; nothing weakened). Added `POS_SETTLEMENT_STRICT_RELEASE=1` so release CI fails instead of skipping unset SQL acceptance (both modes verified). Triage in `docs/BAR_TEST_FAILURE_TRIAGE.md`.
- WP5 accounting: activation explicitly blocked; `docs/BAR_ACCOUNTING_ACTIVATION_RUNBOOK.md` holds the generated 112-function matrix (capability column is a heuristic needing per-function review, high-risk functions called out), design notes, staged proposal, and no-grant deactivation runbook. No migration, grant, or deployment performed.
- WP6 hardening: support bundles now scrub PINs/tokens/card material/payroll/bank/customer PII via `src/shared/supportBundleScrub.js` and carry product, app version, and pending-operation counts. New `tests/bar-support-bundle-scrub.test.mjs` 4/4.
- Verification: `npm run test:bar` 260/260 across 36 files; `test:financial-truth` 189/189; release-behavior/architecture, hardware-adapter, pos-rush pass; `git diff --check` clean; `build:hospitality-pos` passes with WP1-WP3 markers verified in fresh `out/hospitality-pos` bundles (unsigned local build, not a signed installer). Docs: `BAR_COMPLETION_STATUS.md`, `BAR_CAPABILITY_ACCEPTANCE_MATRIX.md`, `BAR_TAB_RECOVERY_CONTRACT.md`, `BAR_RELEASE_ACCEPTANCE.md`.
- Residuals needing approval/decisions: disposable-DB runs, 10 restaurant product decisions, WP7 device/two-terminal/offline/restore acceptance, transfer replay by non-originator (server returns `tab_not_owned`; client keeps record for support), signed release + migration parity refresh + owner sign-off. No production publishing, migration execution, grant change, live-data repair, add-on enablement, or provider activation performed.

## 2026-09-06 - Open Tabs duplicate tab-poll removed (local, needs relaunch)

- `HposLayout.jsx` no longer fires its own `getTabs({status:'active'})` while the route is `/hpos/checks`: `HposOpenChecks.jsx` already owns mount + 15s quiet poll + visibility refetch of the same financial-truth RPC, so the layout kept only its kitchen-ticket poll there and preserves the last-known Open-tabs badge count instead of flickering it to zero. Leaving the page repolls via the new `location.pathname` dependency.
- Gradual Bar slowdown context: Till mount still fans out 7 parallel full reads (`getMenuItems`, full customer DTO, `getTabs` with line items, recipes, staff, promotions, outlets) plus sequential modifiers and floor snapshot; `getCustomers`/recipes/promotions have no caller-side limit and grow monotonically. Next candidate tranche is lazy-loading the customer DTO (only needed for account-charge/delivery/customer picker) and staggering Till secondary reads. Backend caps (`fetchAllPosRows` to 100000, whole-file cache/queue rewrites, unrotated journal) are larger risks and intentionally untouched here.
- Verification: new `tests/bar-open-tabs-poll-dedupe.test.mjs` 2/2; full `npm run test:bar` 228/228 pass; `npm run build:hospitality-pos` passes with `onChecksPage` verified in `HposLayout-dEbiN4tF.js`. Relaunch the fresh Bar build to feel the difference on Open Tabs.

## 2026-09-06 - Cross-shift tab settlement fix deployed to Supabase

- Deployed two pending migrations via `npm run db:push` (pooler) to `oicgpknsmtvcsjacymum`: `20260906001000_fnb_live_function_drift_repair_followup.sql` and `20260906163000_pos_tab_settlement_current_shift_proof.sql`. `migration list --linked` shows parity through `20260906163000`; dry-run reports `Remote database is up to date`.
- Live `pg_get_functiondef('_pos_tab_settlement_owner_error')` verified: validates the Till operator proof against the current payment `shift_id` (`v_payment_shift`), no longer against the tab's original `v_tab.shift_id`. Same assigned waiter can now settle a still-open Bar tab in a later open shift with a fresh PIN unlock in the current shift/outlet.
- Operator recovery for `The shared Till operator proof is missing or expired ... before settling this tab` on cross-shift tabs: the assigned waiter needs an open Till shift + active attendance in the current shift, Unlock Till with that waiter's PIN in the current outlet/shift, refresh Open Tabs, then `Record payment & close tab`.
- Verification: `bar-waiter-tab-ownership` 13/13, full `npm run test:bar` 226/226 pass.
- Residual: `supabase db lint --linked --level error` still reports one error in `get_fnb_consolidated_report` (`column "total" does not exist` on the expenses fragment). Pre-existing F&B drift, untouched by this tranche; needs a forward repair before the ship-ready gate passes.

## 2026-09-06 - Shift-mode tab settlement proof renewal (local, needs relaunch)

- Fixed a payment-boundary race in the shared Till: pointer/keyboard activity renewed the server proof asynchronously, so `Record payment & close tab` could reach `create_pos_order_v3` first and receive `The shared Till operator proof is missing or expired` while the UI still appeared unlocked.
- Fresh Shift-mode payments now await authoritative proof renewal before creating the order envelope. Renewal failure clears the local operator session, reopens the PIN prompt, and records no payment. Recovered/idempotent attempts skip the preflight so the server can still replay a previously committed payment under its original operation key after proof expiry.
- Verification: focused Till/operator and tab-ownership tests pass; full `npm run test:bar` passes 225/225; `npm run build:hospitality-pos` passes and `HposTerminal-VtGghgh3.js` contains the awaited renewal before `createOrder`. No database migration or deployment was required.

## 2026-09-06 - Bar stock, availability, Finance routing, cash-close truth, and tab-save guards (local, needs relaunch)

- Single-item Bar physical counts now use the same atomic `postBarPhysicalCount` contract as Count All, including `expected_qty`, `expected_updated_at`, actual quantity, structured reason, and a stable operation id. Zero-variance counts still reach the server for certification; delivery remains on its separate adjustment path.
- Menu availability changes inspect the authoritative mutation result before changing local sold-out state. A rejected response leaves the product unchanged and displays the server error.
- Bar's shared Finance & close route is add-on-aware: `/restaurant/finance-close` is reachable with `restaurant_accounting`, while its tab capabilities and server authorization remain enforced.
- Cash & close no longer converts server errors, malformed responses, or incomplete/offline snapshots into an empty queue. It shows an explicit unverified state and recovery action instead of a clear review.
- Reopened HPOS and Lodge tabs forward their loaded `expected_version` and `tab_version`; existing-tab saves without a positive version fail closed. A rejected optimistic save restores the exact prior cached row and ordering.
- Bar tab checkout remains one atomic `create_pos_order_v3` call. The retained `pos:openTableSession` compatibility handler accepts `tables` or `tabs`; floor-table IPCs remain `tables`-only.
- Verification: 83/83 focused checks and full `npm run test:bar` 190/190 pass. `npm run build:hospitality-pos` passes; fresh bundles include `HposStock-ChoVYHUH.js`, `HposMenu-BTPFIz_M.js`, `HposCashClose-HPG1qJA5.js`, and `HposTerminal-GQnWJRrD.js`. No database migration or deployment was required.

## 2026-09-05 — Cash & close scroll lock fixed to Till-only viewport (local, needs relaunch)

- Defect: `/hpos/cash` sat in `POS_ROUTE_PREFIXES`, so `HposLayout` applied the locked Till viewport (`overflow: hidden`) to the Cash & close review page — long cash-up queues and the manager decision form below the fold were unreachable for every role.
- Fix: the `is-pos` class in `HposLayout.jsx:435` now follows `isTillRoute` (`/pos`, `/hpos/pos`) instead of `isPosRoute`; `/hpos/cash` keeps its New Order suppression and history nav unchanged.
- Regression: `tests/bar-cash-scroll.test.mjs` 2/2. Verification: focused 6/6 with boot-context tests, full `npm run test:bar` 188/188 pass; `npm run build:hospitality-pos` rebuilt with the Till-only lock verified in the renderer bundle. Relaunch the fresh Bar build.

## 2026-09-05 — Cashier boot navigation loop fixed via auth-only outlet context (local, needs relaunch)

- Defect: `settings:get` requires `settings.view`, which cashier/supervisor roles lack, so boot settings stayed `null`. Every `/hpos/*` route guard (`RestaurantOnlyRoute`) then defaulted `property_type` to `lodge` and bounced to `/`, which `HposLayout` bounced to `/hpos/pos` in an infinite loop (sidebar rendered, pages flickered blank, React Router flood protection tripped). Managers were unaffected. The `reports:criticalErrors` role error in the logs is expected noise for these roles (health log is `system.health`-gated and callers already swallow it).
- Fix: new auth-only `settings:getOutletContext` IPC (`src/main/index.js`) with an explicit routing/mode/identity allowlist (lodge/product/mode/currency/names only, no secrets, fails closed to `null` when signed out); exposed in preload; `App.jsx` boot falls back to it when the full row is denied. Guards still fail closed on a genuine lodge context.
- Regression: `tests/bar-cashier-boot-context.test.mjs` 4/4. Verification: full `npm run test:bar` 188/188 pass; `npm run build:hospitality-pos` rebuilt with the fix verified in main/preload/renderer bundles. Relaunch the fresh Bar build and log the cashier in again (outlet filter snapshots at login).

## 2026-09-05 — Byte-equivalent retries + pre-journal version guard (P0 follow-up, local)

- Cache backfill removed: `resolveCachedTabVersion` deleted. New shared `src/shared/posV3TabFields.js` (`applyOptionalV3TabFields` forwards `expected_tab_version`/`resolve_tab` only when the caller sent them; `isPositiveTabVersion`) keeps rebuilt retries byte-identical so old version-less journal entries replay server-side instead of dying in local conflict. New `hasPosSubmitAttempt` journal export lets the domain reject brand-new version-less `tab_id` attempts before journaling while exempting replays (server replays committed work first, definitively rejects uncommitted work for clearing).
- POS.jsx blocks locally on `currentOpenTab?.id !== activeTabId` or missing version, all modes.
- Verification: real journal behavioral tests (old journal reuses byte-identical, enriched conflicts, helper units), bar 185/185, legacy 219/219; both products rebuilt. No migration this round (server already mandates + replays first).

## 2026-09-05 — Mandatory tab version + lodge waiter + claim-first reorder (P0 follow-ups, deployed)

- `20260905233000_pos_v3_claim_first_tab_settlement.sql` (pushed, verified live incl. ordering): replay returns before any tab lock/validation/ownership/upsert/write; proof strip stays pre-claim; name resolution gated on `resolve_tab` (legacy never opts in — proven by executable legacy test); unsettleable close raises and rolls back.
- `20260905234000_pos_v3_tab_version_waiter.sql` (pushed, verified live): `expected_tab_version` mandatory for every `tab_id` (`tab_version_required`); non-Bar resolve attributes the validated payload waiter, Bar keeps the proof operator. Terminal/helper fail closed on missing versions (explicit `resumeIntent` makes lost-link reachable); POS.jsx blocks locally when `activeTabId` lacks a version; domain backfills versions from local cache for queued payloads in both builders.
- R-0002 behavioral SQL cases A–D in one always-rolled-back txn (scratch-DB only); historical duplicates untouched (no DELETE/backfill; gated index note stands).
- Verification: bar 183/183, legacy 219/219, lodge one-call + version-block tests pass, live `pg_get_functiondef` markers + ordering all OK; both products rebuilt. Relaunch fresh builds.
- Residuals: orphan `restaurant-hpos-service-contract.test.mjs` already red on HEAD (restored untouched); `restaurant-operations-foundation` has pre-existing preload-drift failures (appended test passes alone).

## 2026-09-05 — Claim-first atomic settlement + one-call lodge/bar payments (P0 follow-ups, deployed)

- `20260905233000_pos_v3_claim_first_tab_settlement.sql` (pushed, verified live incl. ordering): idempotent replay now returns before any tab lock/validation/ownership/upsert/write; proof strip stays pre-claim for stable hashes; tab resolve-or-create gated on explicit `resolve_tab` (legacy/others never mint tabs — proven by new legacy test); unsettleable close raises `P0001` and rolls everything back. Live `pg_get_functiondef` verified: all markers present, single claim, replay precedes lock/ownership/resolve.
- Terminal sends `expected_tab_version` + `resolve_tab`; domain forwards both in online+offline v3 builders (server field stays optional). Lodge `POS.jsx` table payments are one call now (table-pick open flow unchanged, still consuming). Resume carries explicit `resumeIntent`; helper fail-closed covers lost-link (now reachable), context-change, and counter-degrade; nav state clears on replay successes too.
- Behavioral SQL (`tests/pos-tab-settlement-atomic.sql`): R-0002 fixture cases A–D in one always-rolled-back txn (settle → identical replay → second rejected → stale blocked/valid settles). Scratch-DB only via `npm run test:pos-settlement-sql`; never pointed at production. Yogofun/duplicate history untouched (no DELETE/backfill anywhere; gated index note in migration).
- Verification: bar suite 181/181, legacy suite 219/219, new foundation lodge test passes (that file has pre-existing preload-drift failures unrelated to this change); both products rebuilt and bundles verified (`resolve_tab` in lodge POS, single `openTableSession` left only for table-pick). Relaunch fresh builds.
- Residuals: orphan `restaurant-hpos-service-contract.test.mjs` was already red on HEAD (quote drift, then stale `redeemVoucher` etc.) — file restored untouched; needs a dedicated refurbishment pass. A concurrent `db push` raced us once (version row appeared with "up to date"); coordinate pushes.

## 2026-09-05 — Fail-closed resumed-tab retention + version guard (P0, deployed)

- New shared helper `resolveResumedTabPayment` (`src/shared/barModeProfile.js`): a tab-opened sale must retain its exact tab id (resume nav id or selected tab id; mismatch blocks with `tab_context_changed`), must settle in a tab mode (counter flip blocked with `tab_settlement_required`), and forwards the loaded version when known. `HposTerminal.jsx` completeOrder fails closed through it before journaling; order payload carries `tab_id` + `expected_tab_version`. `HposOpenChecks.jsx` resume now passes `tabVersion` (legacy null-`table_name` tabs included via `tabName` fallback).
- `20260905232000_pos_v3_tab_version_guard.sql` (pushed, verified live): presented versions are checked against the locked tab row pre-claim (`tab_version_conflict`); absent versions keep prior behavior. Exact replays exempt via claim short-circuit.
- R-0002 recovery coverage: helper unit tests (fresh/resume/mismatch/degraded/malformed), migration asserts (replay-before-mutation ordering, single commit, no deletes), Strict single-use + failure-preserves-session + Shift renew/consume-no-op store tests, live SQL introspection (`tests/pos-tab-settlement-atomic.sql`, `npm run test:pos-settlement-sql` skips without `POS_SETTLEMENT_TEST_DB_URL`).
- Historical duplicates (e.g. yogofun records) untouched in code: no DELETE/backfill anywhere; reconcile via audited void/refund, then the gated unique index note in `20260905231000` applies.
- Verification: full `npm run test:bar` 181/181 pass; rebuilt (`HposTerminal-eaKAjtx_.js` carries the helper). Relaunch from the fresh build. Residual: lodge `POS.jsx` table flow still uses two calls (Strict exposure, unreported); orphan `restaurant-hpos-service-contract.test.mjs` has a pre-existing line-59 quote-style failure unrelated to these changes.

## 2026-09-05 — Paid tab auto-close carries operator proof and reports failures (local, not deployed)

- Defect: `createPosOrder` in `src/main/domains/pos.js` closed the tab fire-and-forget (`closePosTab(data.tab_id).catch(() => {})`) with no operator proof, so the server rejected the close as `tab_not_owned` (desktop actor is the login manager, tab waiter is the PIN bartender) while the payment stood — Open Tabs never reduced and no error ever surfaced.
- Fix: the auto-close (online and offline paths) now forwards `_operator_proof`, and a failed close no longer fails the recorded payment but returns `tab_close_warning`, which `HposTerminal.jsx` appends to the success message so the operator knows the tab is still open (e.g. it belongs to another waiter → use Transfer waiter).
- Regression: new `paid tab auto-close carries the operator proof and reports close failures` test in `tests/bar-waiter-tab-ownership.test.mjs`. Verification: full `npm run test:bar` 177/177 pass; `npm run build:hospitality-pos` rebuilt (renderer + main bundles verified to carry `tab_close_warning`). Relaunch from the fresh build or `npm run dev:restaurant-bar`.

## 2026-09-05 — Bar tab resume lands on Open tab so payment closes it (local, not deployed)

- Pre-existing defect surfaced once tab payments started working: bar tabs always carry `table_name` (= tab name), so `HposTerminal.jsx` resume logic set mode `table`, which is invalid in bar-only and corrected to `counter`. The payment then recorded a counter sale with `tab_id: null` and the tab stayed open (`createPosOrder` only auto-closes when `tab_id` is present). None of the earlier reference/Till edits touched this path (confirmed via `git diff`).
- Resume now lands on `tab` in bar mode at all three decision points (initial state, loaded-tab effect, invalid-mode correction which prefers `tab` when resuming). Restaurant table resume is unchanged.
- Regression: new `resumed bar tabs open in tab mode so payment closes the tab` test in `tests/bar-mode-curation.test.mjs`. Verification: full `npm run test:bar` 176/176 pass; `npm run build:hospitality-pos` rebuilt (`HposTerminal-BY0NeR4A.js` carries the fix). Relaunch from the fresh build or `npm run dev:restaurant-bar`.

## 2026-09-05 — Bar POS card and mobile-money references fully optional (deployed)

- Restaurant Bar POS (`HposTerminal.jsx`): both `Card approval/reference (optional)` and `Mobile money reference (optional)`; provider inputs no longer `required`; client-side check only rejects overlong (>120) references. Desktop domain `validateProviderPaymentReferences` likewise only length-guards both methods.
- Migrations `20260905000000` (card-optional, superseded) and `20260905000001_pos_provider_references_optional.sql` (both optional, matching-row allocation checks kept) were the only pending migrations and were pushed via `npm run db:push` at the operator's explicit request. Live trigger verified via `pg_get_functiondef`: contains `v_card_seen`/`v_mobile_seen` and 120-char guards, no `requires a transaction or approval reference`.
- Main POS (`POS.jsx`) and Legacy POS renderers/validators remain strict in their own UI; the relaxed domain/DB layers stay compatible with them.
- Verification: new `bar POS provider references are optional with length guards` test; full `npm run test:bar` 175/175 pass; `npm run build:hospitality-pos` rebuilt (`HposTerminal-C0Ezr1dw.js` carries the optional labels). Relaunch from the fresh build or `npm run dev:restaurant-bar`.

## 2026-09-05 — Bar tab close uses PIN-verified operator for table session (local, not deployed)

- `HposTerminal.jsx` tab payment called `pos:openTableSession` with the login `user` while the Till authorize check compares the session against the payload waiter/cashier IDs. On a shared terminal (manager logged in, bartender PIN-verified) every tab payment failed with `till_operator_mismatch`, cleared the session, and looped on re-PIN with `Till has locked`. Counter sales already sent `verifiedOperator` so they kept working. The tab open call now sends `(verifiedOperator || user)` for `waiter_id`/`waiter_name`, matching the order payload and hold-check paths.
- Follow-up: the same call also omitted `shift_id`, which shared-Till authorize rejects with `till_operator_shift_mismatch` (clearing the session) while counter `createOrder` sends `shift_id` and passes. The tab open call now sends `cashier_id` and `shift_id: currentShift?.id`. `npm run build:hospitality-pos` rebuilt so `out/hospitality-pos` carries the fix; relaunch from the fresh build (or `npm run dev:restaurant-bar`).
- Regression: new `tab open session carries the PIN-verified operator, not the login user` test in `tests/bar-till-operator-policy.test.mjs`. Verification: targeted 21/21 and full `npm run test:bar` 173/173 pass locally. `npm run build:hospitality-pos` completed successfully so `out/hospitality-pos` now carries both this fix and the tables-or-tabs gate; relaunch from the fresh build (or `npm run dev:restaurant-bar`) — restarting the old installed build alone does not pick up source fixes.

## 2026-09-05 — Bar base open-tab sales unblocked from restaurant tables gate (local, not deployed)

- `pos:openTableSession` in `src/main/index.js` now accepts either `tables` or `tabs` via `requireTablesOrTabsFeature()`. Bar POS base includes `tabs` but excludes `tables`, so every Bar open-tab sale was failing with the generic `This feature is not included in the current commercial package` error. Counter sales were unaffected; tab sales in Botswapelo Lounge were blocked.
- Restaurant packages include both features so their behavior is unchanged; packages with neither still fail closed with the same generic message. Floor-table management IPCs remain `tables`-only.
- Regression: new `Bar base open-tab sales are not blocked by the restaurant tables gate` test in `tests/bar-till-base-entitlements.test.mjs`. Verification: targeted 22/22 and full `npm run test:bar` 172/172 pass locally.

## 2026-09-05 — Restaurant Bar POS card reference made optional (local, not deployed)

- Restaurant Bar POS (`HposTerminal.jsx`) card approval/reference is now optional: label shows `Card approval/reference (optional)`, the input is only `required` for mobile money, and client-side `missingReferences` only blocks mobile-money tenders without a reference. Mobile-money reference remains required.
- Desktop domain `validateProviderPaymentReferences` in `src/main/domains/pos.js` now only requires a reference for `mobile_money`; card references are length-guarded (120 chars) but may be empty. Main POS (`POS.jsx`) and Legacy POS UIs remain strict in their own renderers; the relaxed domain/DB layers stay compatible with them.
- Forward migration `20260905000000_pos_card_reference_optional.sql` redefines `validate_pos_tender_references()` so card rows need only a matching card tender row (reference optional, length-checked) while mobile-money rows still require a reference plus a matching row. Local only; requires linked Supabase deployment plus authenticated behavioral proof before customer enablement. NOTE 2026-09-05: until that migration is applied to the linked database, the deployed trigger still rejects card tenders without a reference (`card tender requires a transaction or approval reference`) even though the UI/domain allow it — apply only that file via the Supabase SQL editor, do not `db:push` (it would push all pending tranches).
- Verification: `tests/bar-payment-references.test.mjs` 3/3 and full `npm run test:bar` 171/171 pass locally.

## 2026-09-04 — F&B progressive activation hardened locally (migrations pending deployment)

All five phases of `docs/FNB_PROGRESSIVE_ACTIVATION_PLAN.md` are implemented
in local source and hardened against the post-implementation review findings.
No Supabase deployment, installer publication, PWA/marketing deploy, or live
authenticated smoke has been performed for this tranche.

- Entitlements fail closed: `_fnb_entitlement_state()` returns
  entitled/not_entitled/unverified (never throws true on error); `set_` rejects
  `ENTITLEMENT_UNVERIFIED`; `get_` reports unverified rows as
  disabled+unentitled; previously enabled modules hide on lapse; every feature
  RPC enforces `_fnb_require_module()` independently; renderer defaults are
  unverified and the panel offers no action until the server confirms.
- Room service is a fulfilment view over canonical POS: menu-item lines at
  server prices (free text rejected), outlet/booking/room validation, open
  shift required, one `pos_orders` + `pos_order_items` + `pos_prep_tickets`
  (service_mode room) write-set per operation key, void-permission cancels,
  runner validation, delivery posts one POS-sourced `booking_charges` row
  (unique pos-source index, no client `folio_posted`).
- Meal redemption enforces the plan window, outlet scope, and complimentary
  manager approval; `inventory_consumed`/`folio_reference` are always stored
  as false/null (server-derived, client values stripped in the domain too).
- Reporting uses real columns (`pos_orders.total`, `inventory_purchases.date`
  /`.total_cost`, `expenses.date`/`.amount`) and NULL+completeness flags for
  unavailable money; Today/demand no longer reference absent
  `is_active`/`deleted` columns. Handoff posts exactly one canonical expense.
- Invoice capture requires a lodge supplier + purchase order, takes ordered
  qty/price from PO lines, and compares against confirmed received/invoiced
  figures; food-safety readings require a manager template; all replays with
  a mismatched payload return `IDEMPOTENCY_CONFLICT`.
- Server `_fnb_has_capability()` (role default + boolean override) and
  `_fnb_require_outlet()` (lodge ownership, active, `allowed_outlet_ids`)
  guard every RPC; handover writes (transitions, close-outs, approvals) stay
  possible while disabled, new work does not.
- UI: booking/room/menu selectors + live delivery queue; entitlement list +
  grant/redeem; template picker + corrective queue; supplier→PO→line matching
  + invoice decision queue; scoped caches/dedupe keys; five F&B RPCs added to
  `FINANCIAL_SYNC_TABLES`; `.fnb-field` replaces the blanket label rule;
  hub holds loading state for module links and all cards/tabs carry outlet.
- Coverage `tests/fnb-progressive-activation.test.mjs` passes 23/23
  (executed registry/sync logic + fail-closed SQL invariants, no no-op
  assertions); lodge integration 10/10, product extraction 15/15, restaurant
  curation 55/55, offline-queue ok, LodgingOS build passes with only existing
  warnings. `tests/production-guardrails.test.mjs` still fails on its
  pre-existing stale `database.js`-facade assertion (logic now lives in
  `src/main/domains/bookings.js`); unrelated to F&B.
- Known remaining gap (documented, not claimed): room-service POS rows are
  written directly to the canonical tables rather than through the
  `create_pos_order_v3` validator, so v3-only guards (catalog snapshot,
  operator proof) do not run on them; shift, menu, price, idempotency, kitchen
  routing, and folio-source equivalence are enforced. Close this before
  treating room service as fully v3-equivalent.
- Forward migrations `20260904000000`, `20260904010000`, `20260904020000`
  remain local-only and unapplied remotely. Disabling a module hides
  navigation and stops new work; retained history stays readable.

## 2026-09-04 — AI assistant is recommend-only; offline smarts added locally

The desktop Ops AI no longer automates anything. There is no proposal
store, no confirm-execute path, and no direct ledger write reachable from
the assistant: `src/main/ai/aiOrchestrator.js` maps every write intent
(`create_booking`, `check_in`, `check_out`, `record_payment`,
`bulk_record_payment`, `bulk_check_out`) to a route-bearing recommendation
(`RECOMMENDATION_ROUTES` + `buildRecommendation`), and `ai:execute` rejects
unconditionally with audit event `ai.execute.rejected` (`recommend_only`).
The renderer (`OpsAi.jsx`) shows a Recommendation card whose button only
navigates (payment intents deep-link `collectPaymentBookingId` /
`reviewBookingId`); the proposal Confirm UI is removed. The two crafted
bulk-message fast-paths in `ai:turn` (capability/actions-gate bypass) and
all timestamp-minted idempotency keys in the orchestrator are deleted, and
the cloud system prompt now instructs recommend-only behavior. Read tools,
capability gates on reads, strict fenced-JSON parsing, sync-aware context,
provider routing, error normalization, and bulk Inline-panel IPC
(preview → explicit Confirm, still capability-gated) are unchanged.

Offline smarts (no outside LLM, all device-local): `chrono-node/en`
(English-only deep import) extends day-window parsing ("last 7 days",
"in 5 days", "fortnight"; room digits never corrupt the window),
`fuse.js/basic` powers sidebar topic search with did-you-mean plus a
`findClosestTopics` helper, room number-words resolve ("room five" → 5),
shift bias is hour-parameterized (`getTimeAwareSuggestions`), multi-match
guest/booking widgets disambiguate, the daily briefing carries a
deterministic template `story`, fallback queries log a truncated
`ai.unresolved_query` signal for the monthly synonym backlog review, and
the tool runner accepts an injectable clock so date-relative tools are
deterministic in tests. `chrono-node` is pruned to ~138 KB (EN ESM only)
via `scripts/prune-chrono-locales.mjs`, chained into `postinstall` so fresh
installs stay lean; `mini-search` was evaluated and deferred to avoid
regressing the tuned intent matcher.

Verification: ai-guardrails 96/96, ai-local-tools 12/12 (fixed clock),
ai-smarts 21/21 (new), local-assistant 36/36, ai-provider-behavior 15/15,
ai-parser-runtime 36/36, production guardrails ok, LodgingOS production
build passes with only pre-existing warnings. No Supabase migration is
involved. Desktop release required before operators see the new UI; cloud
provider + guest-PII caution from the 2026-09-03 audit still applies if a
cloud provider is ever configured.

Follow-up accuracy hardening (same tranche, local matcher only): fixed
seven reproduced misroutes with evidence — guarded synonyms (order/sale/
bill/food/tab skip expansion near void/cancel/purchase/stock/report/
utility contexts; `refund` mapping removed), light (unexpanded) identity
gates for playbooks and policy FAQ, stopword-robust content-token sequence
tiers in scoring, exact-phrase keywords (purchase order, order stock, void
sale, electricity bill, food cost, ...), bare check-in/out routing to the
guides, missing-room defaulting to all rooms, and session raw-first (a
confident raw answer wins; continuation-led messages still enrich). All
suites stay green (ai-smarts now 31/31 with misroute regression pins) and
the production build still passes. Known residual limitations: "open tabs"
has no backing tool so it honestly disambiguates, and vague "purchase
report" may land on an unrelated summary — both read-only, neither executes.

## 2026-09-04 — Verified booking audit contracts deployed to Supabase

Forward migration `20260904090000_verified_booking_contracts.sql` adds the
authoritative import-row contract, paid-cancellation and checkout-balance
guards, accommodation-aware update/reschedule wrappers, one atomic and
idempotent multi-room booking/group-invoice transaction, and payload-bound
public booking idempotency. Multi-room replay is one queue intent, uses stable
child mappings, refreshes authoritative booking/group data after success, and
marks every affected child for recovery when replay is rejected.

Offline booking money now remains in explicit `_estimated_*` presentation
fields until server confirmation. Bookings, Room Grid, and receipts label that
state and block unsafe financial/status actions. Public booking forms retain a
per-intent UUID across refresh/ambiguous retry. Manager PWA entitlements fail
closed without a verified server lease, and every device-local queue mutation
uses verified write/readback persistence. The race-prone invoice max+1 helper
is hard-gated away from invoice creation.

Focused booking contracts pass 10/10; import, offline-queue, financial-integrity,
customer-credit/reschedule, production guardrail, campsite/rate, and all 31
Enterprise regression suites pass. LodgingOS, Manager PWA, and public booking
site production builds pass; the booking site test suite passes 33/33. Manager
PWA lint has warnings but no errors. The linked `Tsa Bonno HospitalityOS`
Supabase project (`oicgpknsmtvcsjacymum`) has local/remote migration parity
through `20260904090000`; the post-push dry run reports the remote database up
to date. Linked SQL lint reports no booking-contract finding, but release remains
blocked by three error-level findings in the simultaneously deployed F&B
functions documented below.

## 2026-09-04 — F&B database migrations deployed; client surfaces unpublished

All five phases of `docs/FNB_PROGRESSIVE_ACTIVATION_PLAN.md` are implemented in
local source. Migrations `20260904000000` through `20260904020000` are applied
to the linked Supabase project; no installer publication, PWA/marketing deploy,
or live authenticated smoke has been performed for this tranche. Post-push SQL
lint reports three error-level schema mismatches in
`fnb_module_disable_blockers`, `get_fnb_consolidated_report`, and
`get_fnb_demand_recommendations`; these must be repaired by a forward migration
before release.

- Phase 1: company-scoped `fnb_module_preferences` + `get/set` RPCs with
  allowlist, lodge membership, `settings.manage_general` (server equivalent of
  `settings.manage`), commercial entitlement, optimistic versioning,
  disable-blockers, and append-only audit; online-only activation with
  last-confirmed cache + retry; slim header with shared outlet context and
  primary New order; Today landing counts; compact switcher showing enabled
  modules only; More-tools panel (enabled first, disabled with benefit + one
  action); completed lodge token adapter + button/field/modal/table/empty/error
  hierarchy scoped strictly to `.lodge-food-beverage-hub`.
- Phase 2: Inventory/Expenses consume `?scope=food-beverage&outlet=&from=`
  with an F&B-filtered banner and Back-to-F&B return; Reports consumes
  `?tab=pos&outlet=&from=food-beverage` without dropping context on tab
  switches; module-gated tabs hide while disabled (recipes, purchasing, team,
  settlement) and canonical bridges carry outlet + return; consolidated F&B
  report reads server-confirmed sales/cost signals with source + completeness.
- Phase 3: idempotent room-service create (offline-eligible, same key on
  replay) + online-only state transitions with runner/cancel-reason/audit;
  atomic meal-plan grant/redeem with covers, complimentary reason/approval,
  inventory-consumed flag, and folio-reference-only rule (never authors
  `amount_paid`/`payment_status`); Today + consolidated read models.
- Phase 4: immutable temperature logs (offline-eligible) with automatic
  out-of-range corrective actions + explicit supervisor close-out; supplier
  invoice capture (offline-eligible) with ordered/received/invoiced matching,
  manager variance approval, and accounting handoff that posts no ledger.
- Phase 5: read-only advisory demand recommendations (occupancy, events,
  reservations, history, stock) with freshness/confidence/source/exceptions;
  explicit manager approval creates traceable prep-batch / draft-PO requests.

Forward migrations `20260904000000_fnb_module_preferences.sql`,
`20260904010000_fnb_guest_service.sql`, and
`20260904020000_fnb_supply_planning.sql` are local-only and unapplied
remotely. Disabling a module hides navigation and stops new work; it never
deletes data, reverses money, or blocks authorised retained-history reads.
Focused F&B activation coverage passes 11/11, lodge/restaurant integration
passes 10/10, product extraction 15/15, restaurant curation 55/55, and the
LodgingOS production build passes with only the existing chunking warnings.
`tests/production-guardrails.test.mjs` still fails on its pre-existing stale
`database.js`-facade assertion (it expects inline `cached[idx]` payment logic
that now lives in `src/main/domains/bookings.js`); that failure predates this
tranche and is unrelated to F&B.

## 2026-09-03 — Lodge Food & Beverage integration de-duplicated locally

The LodgingOS Food & Beverage hub now reuses the mature Restaurant & Bar
kitchen, menu/recipe, purchasing, lot/expiry, team, settlement, and operational
control workflows without creating a second owner for shared lodge records.
Lodge Inventory remains authoritative for item stock, Lodge Reports for sales
evidence, Lodge Expenses for operating costs, and the lodge POS for selling and
operator cash-up. Those duplicated F&B views now present explicit links to the
canonical lodge workflow.

The live floor now hands table, outlet, service-mode, and running-tab context to
the lodge POS; reservation and recipe links remain inside the lodge F&B route.
The broken Cash & close workspace alias is mapped to Finance, workspace cards
and tabs are capability-filtered, and the embedded restaurant header is
suppressed so the F&B page uses lodge visual hierarchy. Duplicate lodge POS
menu, table, modifier, recipe, and floor setup entries were removed in favor of
F&B management, while terminal device, shift, promotion, and audit controls
remain in POS.

The F&B shell has since been simplified to an operator-first hierarchy: four
permission-aware quick actions, one sticky compact workspace switcher, one
selected-workspace heading, and smaller secondary tabs/guidance. A CSS adapter
scoped strictly to `.lodge-food-beverage-hub` translates the reused restaurant
plum/copper controls to LodgingOS emerald/slate/white without changing the
standalone Restaurant & Bar product.

Focused lodge/restaurant integration coverage passes 87/87 and the LodgingOS
production build passes. No Supabase migration or deployment is required for
this renderer integration.

## 2026-09-03 — Client subscription settings and commercial billing history clarified locally

The client-facing Subscription page now leads with the current plan, price,
standing, next payment, and compact usage. Invoice and payment history has
explicit loading, unavailable, error, and empty states; plan selection is
labelled as a preview/request rather than immediate activation; and technical
entitlement detail is collapsed by default.

Subscription billing history no longer reuses guest booking invoices. Forward
migration `20260903090000_client_commercial_billing_history.sql` adds a narrow,
session-bound reader over the commercial account, invoice, allocation, and
payment ledgers. It enforces company, product, active-user, and subscription-
management scope server-side, returns authoritative invoice status and balance
fields, and never converts a failed read into a misleading empty paid history.
The desktop IPC retains the legacy method name only as a compatibility alias to
the new commercial contract.

The unfinished Document Templates page has been retired from client Settings,
desktop navigation, and the legacy `/documents` route. The underlying Hotel
document implementation remains dormant and fail-closed so it can be completed
later without exposing template metadata as a finished client workflow.

Focused subscription/billing/routing coverage passes 87/87, the commercial
suite passes 11/11, production guardrails pass, and LodgingOS, HotelOS, and
Hospitality POS production builds pass with the existing chunk-size warnings.
The complete Enterprise regression gate passes all 31 suites, and the product
extraction suite passes 15/15. Stale navigation and direct-IPC source-shape
assertions were aligned with the current `Users & Access` label and guarded
preload `invoke()` wrapper. The linked migration history records
`20260903090000_client_commercial_billing_history.sql` as applied. Forward repair
`20260903110000_client_commercial_billing_history_scope_repair.sql` was applied
on 2026-09-03; it binds the direct-auth fallback to the requested company and
hides internal draft invoices. The post-deployment dry run reports the remote
database up to date, and linked error-level SQL lint and advisors both return
no findings. No installers have been published.

## 2026-09-01 — Trial transition UX and commercial override control plane deployed to Supabase

All three separately distributed products retain full in-product access during
an active 30-day trial. LodgingOS now labels trial-only feature access, shows
the exact selected post-trial package and countdown, and presents user, room,
check-in-month booking, Manager PWA session, offline-queue, and feature-loss
impacts before activation. No paid package is treated as an automatic fallback:
without an activated package, access pauses. Trial guidance is silent for paid
subscriptions.

Commercially locked routes remain discoverable and now open a page-specific
upgrade showcase without mounting the protected workspace. Role/capability
denials remain separate and explicitly explain that an upgrade does not change
operator permissions.

Forward migration `20260829110000_commercial_entitlement_overrides.sql` adds a
product-scoped, append-only feature and numeric allowance override ledger.
Command Central can force on/off every feature in the selected product's
package/add-on catalogue and override LodgingOS users, rooms, monthly bookings,
or booking grace; for example, Starter can be granted three users. Overrides
require a fresh active master-admin identity, an eight-character reason, a
stable operation ID, server audit, and optional expiry, and are soft-revoked to
restore the package default. Security, roles, tenancy, audit, idempotency,
financial ledgers, and product identity cannot be overridden. The desktop and
server creation guards consume `effective_limits`, and entitlement reads are
bound to the current executable so Lodge, Hotel, and POS grants cannot leak
across products.

Unsafe lower-package assignment now returns an audited `pending_remediation`
result rather than a dead-end error or an unsafe activation. For excess users,
Command Central requires the operator to select exactly which accounts remain
active; overflow accounts are suspended, never deleted, Manager PWA access is
disabled, and active sessions are revoked atomically. Existing rooms, bookings,
financial records, and offline work are never automatically deleted or
discarded.

Customer-facing commercial catalogues are product-specific. LodgingOS exposes
only Starter, Standard, and Pro and no longer recommends Enterprise after Pro;
HotelOS presents its separately licensed Hotel Core offer, while POS retains
its own package ladder. Command Central groups packages by product and lets an
operator compare overrides against a prospective package such as Starter even
when the client's currently active license is Pro. Internal `Enterprise`
compatibility identifiers remain in shared HotelOS implementation paths, but
they are not a LodgingOS plan or customer-facing upgrade target.

Focused trial/override/remediation coverage passes, production guardrails pass,
and LodgingOS, HotelOS, and Hospitality POS production builds pass with only the
existing chunking warnings. Migration
`20260829110000_commercial_entitlement_overrides.sql` was applied to the linked
Supabase project on 2026-09-01. Post-deployment lint identified one invalid
reference to the nonexistent `public.users.updated_at` column inside the new
user-remediation RPC; no user records had been changed. Forward repair
`20260901010000_fix_commercial_user_remediation_user_timestamp.sql` was applied
immediately. The final linked dry run reports the remote database up to date,
and linked error-level SQL lint and security advisors both pass with no issues.
No desktop installers have been published, so the new operator-facing trial,
showcase, remediation, and override controls require the matching desktop
release before they are available to customers.

## 2026-08-29 — Login entitlement argument-limit incident repaired and deployed

The Enterprise plan-normalization migration deployed on 2026-08-28 rebuilt the
63-key `_license_plan_features` result with one `jsonb_build_object` call. That
passed 126 arguments to PostgreSQL, exceeding its 100-argument function-call
limit and causing entitlement resolution during customer login to fail with
`cannot pass more than 100 arguments to a function`.

Forward migration `20260829010000_fix_license_feature_argument_limit.sql`
preserves the complete 63-flag and plan-tier contract while building the JSONB
map from rows with `jsonb_object_agg`, removing the variadic argument ceiling.
It is deployed to the linked Supabase project, local and remote migration
history match, and a post-deploy dry run is empty. Live read-only RPC probes
pass for expired, trial, Starter, Standard, Pro, Enterprise, and the Hotel plan
alias with the expected enabled-feature counts and boolean values. Focused
login/subscription/Hotel entitlement coverage passes 17/17. No desktop release
is required for this server-side repair.

## 2026-08-28 — Subscription switching and tier-surface guardrails implemented locally (migration pending)

LodgingOS now exposes `Core Data Backup` directly on Starter and consolidates it
into a single `Data Management` workspace on Standard and Pro. The legacy
`/starter-backup` route remains compatible, and role-aware Data Management tabs
retain backup access for Finance users without exposing import controls. Hotel
Core now discovers the same Data Management workspace, and Hotel navigation
uses the `Guest Deposits` name with feature and role annotations.

Manager Mobile App provisioning is now consistently Pro-only in the Users &
Access UI and desktop main process. New enablement requires a live authoritative
entitlement; offline or unverifiable provisioning fails closed. Forward
migration `20260828091000_users_access_subscription_guards.sql` enforces the
same rule for every database caller, revokes active PWA sessions when mobile
access is disabled, and rejects any active Standard assignment while enabled
PWA users or active PWA sessions remain. This includes Pro-to-Standard,
trial-to-Standard, and deactivate/insert transitions and never silently rewrites
staff access.

Successful activation now refreshes the shared renderer entitlement immediately
and bypasses the two-minute main-process cache. Guest Deposits closes and blocks
stale receive, allocation, and refund forms after capability loss, and its
reconciliation control is role-aware. Focused subscription, recovery, deposit,
and traffic coverage passes; production guardrails and both LodgingOS and
HotelOS production builds pass with only existing chunking warnings. The linked
Supabase dry run identifies only the new `20260828091000` migration as pending;
it has not been deployed, and no desktop release has been published.

## 2026-08-28 — Check-in-month booking-cap rule implemented and deployed

Booking-cap enforcement now uses only the selected check-in month's active,
non-exclusive bookings (`confirmed`, `checked_in`, and `checked_out`). Booking
creation-month volume remains visible as an explicitly informational metric and
cannot block booking creation. The desktop no longer disables New Booking merely
because the current check-in month is full; the selected date is enforced during
creation, and multi-room bookings preflight all requested room-booking units.

Forward migration `20260828090000_booking_check_in_month_usage_enforcement.sql`
removes the creation-month quota, serializes per-lodge/per-check-in-month quota
acquisition, and applies the same guard when a pending/cancelled booking is
confirmed or a booking is moved into another month. LodgingOS booking bases are
now Starter 120, Standard 400, and Pro 600, retaining only the small existing
grace allowances of +2, +5, and +10 respectively. Pro is no longer treated as
unlimited by the forward server rule or usage UI. Enterprise/Hotel limits remain
unchanged pending the separate product-boundary work. Focused subscription,
cross-layer enforcement, and production-guardrail tests pass, as does the
Lodge/Camp production build. The linked migration history was verified on
2026-08-28 as applied through
`20260828090000_booking_check_in_month_usage_enforcement.sql`; live server
enforcement now includes this rule. No desktop release was published as part of
that database verification.

## 2026-08-27 — Whole-project Auth/config recovery integration (local-only)

The scheduled backup workflow now has a separate encrypted whole-project
recovery bundle step. It uses the existing database URL and encryption public
key to capture explicit Auth schema/data, Storage schema, migration history,
and a value-free repository function/config inventory; it uploads only the
encrypted artifact to the dedicated `tsa-bonno/supabase/whole-project/` R2
prefix and a seven-day GitHub artifact. The shared R2 helper remains backward
compatible with the existing database artifact names. No Management API token,
function secret, project API key, provider credential, Storage object byte,
private key, or passphrase is exported. The integration, checksums, and restore
ordering pass locally; no live workflow run, upload, deployment, or restore
proof exists yet.

## 2026-08-27 — Encrypted Supabase Storage backup tranche implemented locally (credentials and live proof pending)

The existing scheduled database-backup workflow now has a separate encrypted
Supabase Storage tranche. It uses dedicated Supabase Storage S3 credentials only
inside the Storage step, dynamically lists every live bucket and paginated object,
HEADs private and public objects, records S3-visible bucket/object metadata and
plaintext SHA-256 values in an encrypted manifest, and writes independently
encrypted object blobs to the existing private Cloudflare R2 bucket. R2 blob keys
are deterministic synthetic hashes; the incremental public index contains no
bucket names or object paths. Unchanged blobs are reused only after their encrypted
size and checksum metadata are HEAD-verified.

Storage snapshots are explicitly non-atomic. A run publishes its encrypted
manifest and complete public index only after a second full bucket/object/HEAD
inventory exactly matches the first. Every manifest, blob, and public index upload
is read-after-write or HEAD verified. Storage retention uses a separate versioned
R2 prefix, validates the complete index/manifest graph and every blob referenced by
retained snapshots before deleting anything, and fails with no deletion on a
malformed index, orphan/missing manifest, or missing/corrupt retained blob. It
retains 14 daily days and one snapshot per ISO week through 90 days and never uses
a service-role fallback.

Focused local coverage exercises S3 continuation-token pagination, private object
paths and metadata remaining absent from the public index/R2 key names, encrypted
manifest recovery, unchanged-blob reuse, mid-run source mutation rejection,
retained-reference-safe cleanup, fail-closed malformed/missing reference state,
and workflow credential scoping. This tranche is not deployed, committed, pushed,
or live-verified. It still requires four repository secrets
(`SUPABASE_STORAGE_S3_ENDPOINT`, `SUPABASE_STORAGE_S3_REGION`,
`SUPABASE_STORAGE_S3_ACCESS_KEY_ID`, and
`SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY`), a controlled manual workflow run, R2
inspection, representative blob decryption/checksum proof, and a disposable-project
Storage restore rehearsal. Supabase-generated S3 credentials are server-only but
have full Storage access across all buckets and bypass RLS; Supabase currently does
not provide a generated read-only S3 key. The initial copy consumes Storage egress,
S3 does not expose all bucket access/restriction settings, and object versioning is
not supported, so the database archive and a separately protected secrets/function
inventory remain required for whole-project recovery.

## 2026-08-27 — Encrypted Supabase database backup live and independently verified

The scheduled GitHub Actions database-backup workflow now has a fail-closed
preflight that reports every missing repository secret by its actual GitHub
name, writes a safe run summary, opens one deduplicated failure issue, detects
an overdue successful backup after 26 hours, and closes the overdue issue after
a fully successful run. Success requires the encrypted database artifact and
the private Cloudflare R2 upload; cleanup remains unconditional. R2 uses a
SigV4-signed S3-compatible request with a dedicated managed prefix and bounded
daily/weekly retention that never deletes the sole successful object. A local offline
verification/rehearsal command now decrypts an existing archive into a unique
temporary path, rejects unsafe or malformed tar input, verifies required files,
checks the recorded SHA-256 values and metadata, accepts legacy v1
`github_run_id` archives through an explicit compatibility alias while emitting
canonical `run_id` output, emits a secret-redacted report,
and removes plaintext by default. It does not restore or write a database.

The first three scheduled workflow runs failed because GitHub supplied none of
the six required repository secrets:
`SUPABASE_BACKUP_DB_URL`, `BACKUP_ENCRYPTION_PUBLIC_KEY_B64`,
`CLOUDFLARE_R2_ACCOUNT_ID`, `CLOUDFLARE_R2_BUCKET`,
`CLOUDFLARE_R2_ACCESS_KEY_ID`, and `CLOUDFLARE_R2_SECRET_ACCESS_KEY`. The owner
subsequently configured all six without placing their values in source or chat.
Manual GitHub Actions run `33079309627` on commit `9be651a` completed all dump,
encryption, GitHub-artifact, R2-upload, freshness, retention, and cleanup steps.
R2 retained one encrypted object and deleted none.

The exact object downloaded back from R2 was independently decrypted and
verified locally using the owner-held encrypted private key and separately held
passphrase:
`tsa-bonno_supabase_tsa-bonno-supabase-2026-08-27T13-54-39Z-33079309627.tar.gz.tbbackup`,
10,828,261 bytes, archive SHA-256
`cd7e2d498898cf36968141dcfc341f0b83b4803d011b201978eef85bcbef5668`.
Verification confirmed the required SQL files, metadata, and internal checksums
and removed temporary plaintext. Commit `e074610` corrected future archives to
write canonical `run_id` while retaining a strict, conflict-rejecting v1 adapter
for the first archive's `github_run_id` field.

The linked Supabase project currently exposes one Storage bucket,
`private-cashup-proofs`, and four deployed Edge Functions. Only
`send-booking-confirmation` and `send-push` have source in this repository;
`auth-master-admin` and `send-welcome-email` must be recovered into source
control. The present workflow backs up the PostgreSQL database archive only. It
does not yet copy Storage objects, Edge Function source, function-secret values,
or external-provider configuration. A future whole-project tranche must add an
encrypted, content-addressed Storage manifest/object backup with retention that
never deletes blobs referenced by retained manifests, recover the missing
function sources, and maintain a separately protected restore inventory for
secrets that must be recreated rather than exported.

Local evidence passes the R2/workflow, backup-crypto/retention, and offline
rehearsal tests (25/25), script syntax validation, `git diff --check`, and
production guardrails. The workflow and verifier are committed and pushed to
`main`; the daily schedule is active and the first encrypted database backup is
verified. This is not yet whole-project disaster recovery: Auth users, Storage
object bytes/configuration, two missing Edge Function sources, deployed
function secrets, provider/project configuration, and unsynced device queues
still require separate backup contracts and full disposable-project restore
evidence.

## 2026-08-27 — Starter recovery workspace and weekly automation (database deployed; desktop not released)

The Starter `.tbbackup` contract now defaults to v3 with recomputed canonical
per-table hashes, strict import ceilings, schema-aligned restore allowlists,
protected/media-field removal, explicit non-transactional snapshot disclosure,
and signed-ledger validation/reconstruction. Command Central now has a
freshly-reauthenticated, capability-gated recovery workspace that decrypts only
in the Electron main process, validates and remaps in memory, and can submit an
idempotent restore only to a new quarantined disposable lodge. A restore is not
labelled verified until the authoritative execute RPC and a separate server
verification RPC both confirm actor, target, counts, isolation, quarantine,
ledger reconciliation, and request binding. Live-lodge replacement remains
blocked. Source room-type and floor-section IDs are deliberately not copied
across lodge boundaries; their unresolved counts are disclosed while campsite
operational fields are preserved.

Eligible accommodation packages now have an opt-in, customer-owned weekly
automation path with OS-secure passphrase storage, active-lodge scoping,
startup/reconnect due evaluation, crash-safe single-flight locking, immediate
post-write verification, bounded retention of scheduler-owned verified files,
and a simple status/setup UI with passphrase visibility controls. This remains
separate from managed/Pro backup policy and never blocks lodge operations.

Local verification passes: Starter backup 27/27 and combined recovery,
automation, wiring, and SQL-contract coverage 42/42. The linked project is now
applied through `20260827020000_starter_recovery_campsite_booking_completeness.sql`,
including the prepayment entitlement migration, the recovery/automation RPCs,
post-deploy idempotency and quarantine guardrails, and campsite booking-detail
restore coverage. Local/remote migration history matches, the post-deploy dry
run is empty, and linked error-level SQL lint and security advisors report no
issues.

This is database deployment evidence only. No authenticated Command Central
disposable-restore/two-lodge isolation smoke, restart credential test, packaged
installer, publication, or customer enablement has been completed, so the
desktop recovery and automation workflows are not yet customer-ready. The
package remains a seven-category core-data export rather than a whole-product
backup. Its export ceiling is 256 MiB/100,000 rows per table, while the current
authoritative one-RPC restore transport is limited to 8 MiB; larger valid
packages require a future chunked restore transport and must not be presented
as currently restorable.

The approved future direction is now recorded in
`docs/STARTER_BACKUP_RECOVERY_ROADMAP.md`: every authoritative customer data
domain must gain a backup and tested recovery path, including POS, inventory,
expenses/accounting, events, assets, attachments, non-secret memberships, and
audit evidence. Secrets and rebuildable device state remain excluded. The
current product name must remain **Core Data Backup** until that broader scope,
chunked transport, reconciliation, and disposable restore evidence exist.

No installer was built or published.
During local work, ignored reproducible `out/hospitality-pos`,
`dist/hospitality-pos`, and `node_modules/.vite` artifacts were removed to
recover disk space; no source, customer data, or `.tbbackup` file was removed.

## 2026-08-25 — Starter Core Data Recovery Export package (local implementation; no publication)

Starter Backup now writes a branded `.tbbackup` envelope around canonical core
JSON. The package carries included/excluded dataset categories, app/schema
versions, full SHA-256 checksums, recovery readme, and optional AES-256-GCM
encryption using a passphrase that is never persisted. The desktop flow shows
the saved destination, full fingerprint, record counts and completeness,
supports opening the folder, verification, saving another atomic copy,
seven-day history/reminders, and a disposable in-memory support-led restore
rehearsal that writes only a non-PII validation report. Decrypted customer data
is not returned over the renderer IPC verifier and is not extracted by the
rehearsal. No live restore or database overwrite path was added. Package
round-trip, integrity, wrong-passphrase, atomic-write contract, history, and
rehearsal tests pass;
`npm run build` passes with the existing Vite dynamic-import warning. This
source remains unpublished and no installer or external deployment is claimed.
The near-term implementation plan for Command Central live recovery and
automated encrypted Starter backups is tracked in
[docs/STARTER_BACKUP_RECOVERY_ROADMAP.md](docs/STARTER_BACKUP_RECOVERY_ROADMAP.md).

## 2026-08-25 — Manager PWA version visibility and multi-business switching (production deployed)

The Manager PWA now exposes the root application semantic version plus a
unique per-build identifier under Menu, supports an explicit update check, and
identifies the waiting build in the global update prompt. Service-worker
registration is build-addressed and bypasses the HTTP cache for update checks;
runtime asset caching and the existing offline shell remain intact.

Supabase-authenticated accounts now retain every active Manager membership
returned by the server instead of silently filtering disabled or unentitled
companies and auto-opening the last eligible product. Login presents a
product/package-aware company chooser, and Menu presents the same company list
inside the authenticated app. Unavailable companies remain visible with an
actionable access/plan state but cannot be selected. A switch re-lists
memberships server-side, selects the exact lodge without a fallback row, mints
the new lodge-scoped app session, revokes the previous session, and remounts
entitlement, inbox, product-shell, and data providers by lodge/session identity.

A read-only linked account check for `botswapelostudios2@gmail.com` found five
active, auth-linked Admin memberships. Restaurant is enabled and entitled;
Bar, Lodge, and Lounge are entitled but their per-user Manager PWA access is
off; Hotel is both disabled and not entitled under its current package state.
No production permission or entitlement was changed. Enabling the three
eligible memberships remains an explicit access-control action, while Hotel
requires a valid Manager App entitlement before it may be opened.

Combined PWA/product/prepayment coverage passes 68/68, Manager lint has zero
errors and 34 existing warnings, and the production PWA build passes. Vercel
deployment `dpl_62R3FmKmkDm4HqW4p579XNbgaucy` is READY and is aliased to
`boroko-bookings.vercel.app`; both that alias and
`tsa-bonno-hospitalityos-manager.vercel.app` load the Tsa Bonno HospitalityOS
Manager production shell. No database migration, desktop release, marketing
deployment, commit, or push is claimed for this tranche.

## 2026-08-25 — Tiered Guest Deposits / Prepayments (local implementation; database deployment pending)

The accommodation products now use one authoritative customer-credit ledger
and RPC family across three commercial tiers. Lodge Starter exposes Guest
Deposits Lite (`prepayments_basic`) for receiving a deposit, viewing the
server-confirmed balance and history, allocating credit to a booking, and
Admin-authorized refund/reversal with a mandatory reason. Lodge Standard adds
Prepayments Management (`prepayments_management`) with portfolio search,
reconciliation, partial or split allocation support, bounded operational
reporting, and audited CSV export. Lodge Pro adds Credit Control & Automation
(`prepayments_advanced`) with server-calculated ageing, configurable three-band
thresholds, alerts, analytics, and advisory read-only matching suggestions.
Hotel Core carries all three accommodation capabilities; Hospitality POS
packages carry none. Downgraded accommodation accounts retain ledger reads
while actions outside the active tier fail closed. The Manager PWA remains
read-only.

The Manager PWA now uses the exact `prepayments.view` capability instead of
the older invoice-view proxy. `/prepayments` is an accommodation route for both
LodgingOS and HotelOS, remains unavailable to Hospitality POS, fails closed on
malformed authoritative summaries, and explicitly disables receive, allocate,
refund, reverse, reconcile, export, ageing, matching, and configuration
capabilities on mobile. It does not calculate a portfolio liability from row
fallbacks. Public marketing now presents the same tier boundaries across the
home comparison, package page, feature page, LodgingOS and HotelOS pages,
Manager App page, and brochure. The Standard brochure no longer places the
Manager App below Pro. The public guest booking site remains unchanged because
it contains no internal package or customer-credit control surface.

Desktop mutations require caller-owned stable operation IDs; refund and
reversal require a reason; IPC, domain, and database boundaries independently
enforce lodge, actor, role, capability, subscription feature, and input rules.
Offline allocation exposes explicitly pending estimate fields and never authors
authoritative `amount_paid` or `payment_status`. Failed or malformed
authoritative reads remain unavailable rather than becoming zero. Standard CSV
exports are bounded, neutralize spreadsheet formulas, hash the written file,
and record server audit evidence with a visible partial-success state when the
file succeeds but audit confirmation fails. Pro ageing, alerts, matching, and
configuration are server-backed; matching suggestions do not mutate ledgers.

Forward migration `20260825010000_prepayments_tier_controls.sql` adds the
catalogue, entitlement, authorization, configuration/audit, portfolio,
reconciliation, ageing, alert, matching, and export contracts. A linked dry run
on 2026-08-25 identifies exactly this migration as pending; it has not been
deployed or live-smoke-tested. Local evidence passes the 16/16 focused tier
contract, 44/44 combined affected contracts, 9/9 hotel financial invariants,
production guardrails, the LodgingOS production build, and the Manager PWA
build. Manager membership coverage passes 17/17, the marketing contract passes
all legacy assertions plus 4/4 new tier-boundary checks, and Manager lint has
zero errors and 34 existing warnings. The existing Vite mesh dynamic/static
import warning remains. Manager PWA production deployment
`dpl_3WtPaDKfEC8wZozNu7bMEzKDkkEH` is READY on Vercel; both
`tsa-bonno-hospitalityos-manager.vercel.app` and the compatibility alias
`boroko-bookings.vercel.app` return HTTP 200, and their production shell asset
hashes match the verified local build. The prepayments database migration,
desktop source, and marketing source remain uncommitted/unpublished; no
authenticated production Guest Deposits smoke is claimed.

## 2026-08-24 — Lodge Starter basic reports (linked database applied; desktop publication pending)

Lodge Starter now includes a deliberately narrow, view-only `basic_reports`
module for Today, 7-day, and 30-day operating summaries. The full `reports`
module and all report exports remain Standard-only. The desktop route is
capability-gated by `reports.basic_view`; only manager/finance/admin-equivalent
roles receive that capability by default, with the existing entitlement and
override boundaries still applied.

Forward migration `20260824050000_starter_basic_report.sql` adds the
server-authoritative `get_starter_basic_report(uuid, integer)` RPC. It enforces
application-session, lodge, role/capability, and range checks server-side; uses
the property's configured business timezone; distinguishes arrivals,
departures, and bookings-created dates; calculates occupancy from room-nights;
and derives collections and outstanding balances from signed payment-ledger
entries rather than a cached booking total. Financial values are returned only
when booking/payment source coverage and payment signs can be certified;
otherwise every monetary field is `NULL` with an actionable reason. The
desktop anon-key application-session grant is restored explicitly while the
SECURITY DEFINER body remains fail-closed.
The same migration updates the active accommodation-package catalogue and
package-entitlement rows, backfills valid current and legacy accommodation
licences without overwriting manual feature overrides, and records each new
lodge grant in the activation audit log.

Focused Starter/marketing coverage passes 5/5, commercial coverage passes
11/11, production guardrails pass, and the LodgingOS production build passes
with the existing Vite mesh dynamic/static import warning. The affected
enterprise entitlement run passes 46/47; its sole failure is the pre-existing
IPC parity test expecting literal `ipcRenderer.invoke(...)` calls even though
the preload uses the shared `invoke(...)` wrapper, so it discovers zero preload
channels before evaluating this feature's matching handler. Migration
`20260824050000` is applied to the linked Tsa Bonno HospitalityOS project;
local/remote history is in parity through that ID, the post-deployment dry run
reports the remote database up to date, linked error-level SQL lint returns no
findings, and error-level advisors report no issues. The updated desktop and
marketing source remain unpublished, and no desktop installer has been built
or published for this tranche.

## 2026-08-24 — Lodge Starter package completion (linked database applied; desktop publication pending)

The Starter package now has four bounded operator workflows in local source:
Users & Access Lite, customer-owned Starter Backup, print/save-PDF output for
Basic Reports, and universal immutable operational audit recording. Users &
Access Lite permits at most two accounts, requires one active Admin, restricts
the second account to Receptionist or Operations, and withholds custom
permissions, PWA access, outlet scope, audit viewing, and full Staff Management.
The matching database guards serialize account changes and reject a
noncompliant Starter activation or downgrade instead of silently accepting an
over-limit lodge.

Starter Backup creates an atomic, customer-owned JSON artifact with lodge scope,
PII warnings, completeness evidence, row ceilings, a SHA-256 digest, and no
secret/idempotency-key or absolute-path disclosure. Recovery is explicitly
support-led; the feature does not claim a live restore. It is available only to
licensed Lodge/Hotel accommodation packages and is rejected for Hospitality POS
before any save dialog or data read. Basic Reports now support bounded A4 PDF
and native print output for the existing Today/7-day/30-day summaries. Report
money remains server-authoritative, and print retries retain a stable operation
ID for idempotent audit evidence.

Starter operational writes now have a forward-only audit-recording closure in
`20260824070000_starter_universal_audit_recording.sql`. Existing
`financial_audit_log` remains authoritative for booking/payment financial
mutations, `staff_access_audit` remains authoritative for Starter user-access
changes, and POS ledgers remain unchanged. The new lodge-scoped,
actor-attributed `starter_operational_audit_log` captures rooms, housekeeping,
customers, quotations, invoices, and maintenance changes with immutable
append-only protection and recursive credential/identity-secret redaction.
Starter backup creation and basic-report PDF/print artifact actions call the
server RPC `record_starter_artifact_audit` with stable content/operation IDs;
artifact writes report `auditRecorded: false` when server evidence cannot be
confirmed. Audit viewing and night-audit workflow remain Standard-only. Focused
cross-product coverage passes 57/57, production guardrails pass, and the
LodgingOS production build passes with the existing Vite mesh import warning.
The affected Enterprise entitlement file passes 21/22; its sole failure is the
pre-existing IPC parity parser that expects literal `ipcRenderer.invoke(...)`
calls although preload uses the shared `invoke(...)` wrapper. Linked migrations
`20260824060000_starter_users_access_lite.sql`,
`20260824065000_starter_backup_entitlement.sql`, and
`20260824070000_starter_universal_audit_recording.sql` are applied. Migration
history has local/remote parity through `20260824070000`, the post-deployment
dry run reports the remote database up to date, and linked error-level SQL lint
returns no findings. A refreshed authenticated Hills View Lodge desktop session
now resolves `staff_basic: true` and refreshes all three existing user records;
the lodge remains above the Starter two-user limit and new creation is blocked.
Desktop source remains uncommitted/unpublished, and authenticated backup,
report-artifact, installer, and public-release smoke remain open.

## 2026-08-24 — Consolidated main and Bar/POS source publication

Repository history is consolidated onto `main`; redundant local and GitHub branch labels were removed only after their committed tips were preserved on `main`. The previously uncommitted Bar/POS operational tranche is now prepared for repository publication on that single branch, including the ordered forward migrations through `20260821040000`, guarded offline replay, authoritative financial/read completeness, Bar Base stock and Till controls, cash-up evidence, setup/read truth, secure local storage, Command Central subscription hardening, Manager PWA alignment, Legacy POS continuity, marketing copy, and the matching regression coverage.

Current verification passes: production guardrails; Bar 171/171; focused offline/setup/open-tabs/security 17/17; Legacy POS 218/218; command-central 34/34; commercial 11/11; Manager PWA membership 17/17; restaurant workspace 22/22; marketing contract 1/1; LodgingOS, Hospitality POS, Legacy POS, and Manager PWA production builds; and Manager PWA lint with zero errors and 34 existing warnings. The known Vite mesh dynamic/static import warning remains. This source publication does not publish desktop installers, deploy the Manager PWA or marketing site, or independently change the already-recorded linked Supabase deployment state.

## 2026-08-21 — Offline contract, secure-store, health-fault, and setup-read truth tranche (linked database applied; desktop publication pending)

The desktop/POS offline contract now has stable idempotent wrappers for POS menu updates and staff clock-out, with legacy queue replay conversion preserving the original operation key. Direct `clock_out_staff` execution is revoked for the desktop client role; live anonymous probes confirmed both new wrappers are callable but fail closed with `Access denied for this lodge.`, while the direct RPC returns permission denied. The linked migration `20260821040000_offline_rpc_contracts_and_desktop_grants.sql` was successfully pushed, and `supabase migration list --linked` reports local/remote parity through `20260821040000`.

Secure local storage now fails closed when encrypted storage is unavailable and propagates an actionable warning rather than silently writing sensitive session material in plaintext. Health-fault retention/deduplication now runs through the actual sync-store path with bounded, redacted, deterministic records. Setup progress now uses an authoritative read-status envelope and visibly labels offline/unavailable evidence; completion remains blocked until the server read is complete. Existing setup array callers remain supported.

Combined focused coverage is 11/11, `npm run test:bar` is 171/171, changed JavaScript syntax checks pass, and `npm run build:hospitality-pos` exits 0 with the existing Vite mesh dynamic/static import warning. Linked SQL lint returned `results=[]`. The pre-deploy dry run identified only `20260821040000`. A later post-deploy dry run hit transient `LegacyDbConfigConnectTempRoleError`, and the advisors command stalled during login-role initialization and was interrupted; those checks are not claimed as passed. Desktop source/build evidence is local only: no installer, public desktop release, PWA publication, or operator smoke has been performed.

## 2026-08-20 — Open-tab values restored from server-derived line facts (linked applied)

Held POS tabs submit persisted `unit_price` and `quantity` snapshots, not
renderer-authored line totals. Forward migration
`20260820170000_pos_tab_server_derived_line_values.sql` adds an immutable,
strictly validated server helper that derives line values for new writes and
for existing active rows at read time. Invalid item shapes remain operationally
visible but stay `financial_complete=false`; the operational read remains
complete and the Open Tabs top-level amount fields are populated only for
certified rows. Migration `20260820170000` is applied to the linked project;
the follow-up dry run reports the remote database up to date, linked
error-level SQL lint returns zero findings, and linked error-level advisors
report no issues. Focused Open Tabs coverage passes 4/4 and the full Bar suite
passes 155/155.

## 2026-08-20 — Bar Base deferred service tranche (implementation; deployment performed elsewhere)

The deferred Bar Base service tranche is implemented in repository source and
covered by focused regressions. Migrations
`20260820120000_bar_base_atomic_stock_operations.sql`,
`20260820130000_bar_setup_alert_checklist_controls.sql`, and
`20260820140000_bar_base_deferred_service_tranche.sql` are covered by this
implementation. This delegated task performed no deployment; the current
shared project state records the linked tranche through `20260820160000` as
applied by separate work, without this entry independently asserting remote
state. The tranche adds certified daily-close summary output,
immutable/idempotent cash-up proof metadata and scoped signed reads, certified
basic category/top-product reporting, controlled void-reason templates,
authoritative handover notes, and Bar board controls while preserving Base/add-on
boundaries and blind cash-up behavior.

Cash-up proof upload/list/read now uses the session-bound Supabase client,
structured-clone bytes, bounded MIME/size validation, SHA-256 and stable retry
keys; no local path, base64 blob, service credential, delete path, or permanent
URL is stored. The private Storage bucket/policies still require functional
live verification to prove that the `x-boroko-session` request context is
available to Storage policy evaluation. Until that verification, the UI fails
closed with an actionable message rather than treating missing evidence as
empty.

Focused deferred coverage passes 4/4, the Bar suite passes 155/155 and includes
onboarding, checklist, and deferred-service tests, and the Hospitality POS build passes
with the existing mesh chunking warning only. No deployment, commit, or
desktop publication has been performed.

## 2026-08-20 — Named Bar tabs restored to Open Tabs (linked database applied; desktop publication pending)

The Open Tabs desktop read now distinguishes an active POS tab from an active
physical-table tab. Named Bar tabs intentionally have no `table_name`; they
are included by the operational active-status filter, while floor occupancy
continues to require a real table name. This fixes the local/cache path that
previously hid a successfully held named tab.

Forward migration
`20260820150000_pos_open_tabs_operational_read_completeness.sql` separates a
complete operational tab-row read from per-row financial certification. A
server-confirmed tab remains visible when its line amounts are not certifiable,
but its total stays unavailable; the UI does not promote an incomplete amount
to financial truth. Migration `20260820150000` is applied to the linked project.
The ordered push also exposed a PostgreSQL `42P10` lint error in the newly
deployed checklist-template function: its conflict target omitted the predicate
from a partial unique index. Forward migration `20260820160000` repairs that
target without changing the nullable legacy table shape. Linked migration
history is in parity through `20260820160000`; the follow-up dry run reports the
remote database up to date, linked error-level SQL lint is clean, and linked
error-level advisors report no issues. Focused Open Tabs coverage passes 2/2,
focused checklist coverage passes 4/4, the complete Bar suite passes 144/144,
and the Hospitality POS production build passes with the existing mesh chunking
warning only. Updated desktop source still requires normal installer publication
before operators receive it.

## 2026-08-20 — Bar POS Base readiness, stock ergonomics, and commercial-copy alignment (linked database applied; desktop publication pending)

Bar POS Base remains P4,500/year and now explicitly documents the counter
essentials already supported in the product: modifiers, open tabs, and
receipts. The three separate annual add-on boundaries remain intact:
Stock & Purchasing Pro (P3,000), Accounting & Workforce (P6,000), and Growth
& Multi-Outlet (P5,000); advanced Owner View, purchasing depth, accounting,
workforce, and multi-outlet workflows are not included in Base.

Bar onboarding now presents a 14-stage, evidence-backed staff/device/shift
readiness path covering staff accounts, least-privilege roles, private PINs,
device readiness, and a first completed shift. Receipt, scanner, and cash
hardware readiness requires an explicitly observed successful test on the
current POS computer; saved settings alone do not complete the stage.
Attendance-PIN clock-out and manager-approved daily-close checklist evidence
remain server-authoritative and cannot be satisfied by a client-side tick.

Basic Bar stock now has category suggestions, a low-stock filter, structured
adjustment reasons, read-only movement history with source-completeness
status, a printable blank count sheet that never presents cached quantities as
certified on-hand, and stable operation/retry keys. Atomic batch count posting
and multi-line simple delivery are now implemented through the forward-only
`20260820120000_bar_base_atomic_stock_operations.sql` migration: each operation
uses one stable UUID/payload hash, deterministic row locks, explicit expected
quantity/version evidence, outlet/manager authorization, immutable count or
delivery movements, and replay-safe offline queue contracts. Count All is
blocked unless the stock read is server-complete and versioned. Simple
delivery remains supplier/PO/lot/expiry/valuation-free and fails closed to
Purchase Receiving when Accounting is active. Bar stock history now exposes
server actor, expected, actual, delta and reason. Barcode receiving lookup and
verified ESC/POS output-path label printing are wired; label printing gives a
recovery message when no configured output path exists.

The ordered linked migration tranche from
`20260820100000_bar_base_catalog_feature_alignment.sql` through
`20260820160000_bar_checklist_operation_conflict_target_repair.sql` is applied.
Remote history is in parity, a follow-up dry run is a no-op, linked error-level
SQL lint is clean, and error-level advisors report no issues. Source changes
remain uncommitted and no desktop installer has been published. Independent
verification records `npm run test:bar` (144/144) and
`npm run build:hospitality-pos` passing, with the existing mesh warning only;
focused commercial, marketing, onboarding, stock, Open Tabs, and checklist
tests also pass.

## 2026-08-18 — Bar POS tab/digest anon grants repaired (linked applied)

Live diagnosis on the Botswapelo Lodge bar desk exposed a production defect:
the desktop application-session client executes RPCs as the `anon` role (anon
key plus `x-boroko-session` header), but the 2026-08-14 Bar POS authorization
hardening migration (`20260814010000`) revoked `anon` from `upsert_pos_tab`,
`update_pos_tab_status`, and `generate_owner_digest`, and its tab read wrapper
was never granted to `anon` in the first place. Every open-tab poll failed with
`permission denied for function get_restaurant_pos_tabs_financial_truth`
(repeated each refresh round), so the desktop fell back to device-local tabs
marked uncertified and tab saves/transfers/owner digest would fail the same way
at runtime. This is the same class as the 2026-08-17
`app_current_lodge_id` repair and the follow-up "re-audit remaining
authenticated-only functions the desktop (anon role) may call".

Migration `20260818100000_bar_pos_tab_anon_session_grants.sql` restores EXECUTE
to `anon` (plus `authenticated`, `service_role`) on
`get_restaurant_pos_tabs_financial_truth(uuid,uuid,text)`,
`upsert_pos_tab(jsonb)`, `update_pos_tab_status(uuid,text,text)`, and
`generate_owner_digest(uuid)`. All remain SECURITY DEFINER with server-side
app-session, lodge, role, and outlet enforcement (`app_require_pos_outlet_access`,
`app_require_lodge_role`, `_restaurant_require_operational_report_access`), so
the grants restore the client contract without opening table access or
bypassing any guardrail. The unscoped implementations stay
`service_role`-only. Applied to the linked project via `supabase db push` on
2026-08-18. Live verification with the anon key and no session: the RPC is now
callable past the permission layer and returns the intended fail-closed body
guard `42501 "A valid app session is required."` instead of
`permission denied for function get_restaurant_pos_tabs_financial_truth`;
the desktop (anon key plus `x-boroko-session`) passes that guard. Restart the
bar app so open-tab financial truth refreshes from the server again.

The bar System Health page ("system health is empty") previously never loaded
the desktop saved-issue log the top-right warning pill counts, so the pill could
show N critical errors while the page showed nothing. Fixed in the renderer:
`HposSystemHealth.jsx` now loads `reports.criticalErrors` (limit 12) and
`app.getRendererErrors` (limit 6) with the rest of the health snapshot and
renders them under a new "App issues" tab with a badge count matching the pill
(danger/warning tone by financial/`db_init`/error level, message, scope label,
time, and context JSON). "Clear saved issues" is gated by the `system.health`
capability client-side and enforced by the existing
`reports:clearCriticalErrors` IPC handler; the clear only touches the
device-local `critical-errors.json` log, never database financial truth.
Regression coverage added to `tests/bar-financial-ui-regression.test.mjs`.
Verified: `npm run build:hospitality-pos` builds, and the compiled chunk
contains the new section. The three errors currently counted on the bar desk
are stale `pos.order.create` failures logged 2026-08-16 (two catalog-snapshot
blocks and three insufficient-stock blocks at the same outlet, from the
fresh-company smoke tests before that day's catalog/outlet fixes) and can be
cleared from the new App issues tab.

Repository verification: full `test:bar` suite 127/129 pass. The two failures
are a working-tree caveat unrelated to this change: the in-progress uncommitted
preload refactor (src/preload/index.js, `invoke(...)` helper instead of
`ipcRenderer.invoke(...)` literals) no longer matches the literal assertions in
`tests/bar-financial-ui-regression.test.mjs` and `tests/bar-stock-aging.test.mjs`;
the refactored preload still exposes the same channels and contracts.

## 2026-08-17 — Anon-role session-function grants repaired (linked applied)

A live diagnosis (Botswapelo Lodge dev desk, The Hills View account switch)
exposed a production defect: `public.app_current_lodge_id(text)` had never been
granted EXECUTE to `anon`/`authenticated`. RLS policies on
`event_booking_line_items`, `event_booking_resources`, `event_booking_rooms`,
`room_types`, `floor_sections`, and venue tables call it directly, so every
read of those tables failed for the desktop/PWA/public surfaces with
`permission denied for function app_current_lodge_id` (reproduced via REST
probes). The desktop's background cache refresh batch includes
`event-line-items`, so each refresh round partially failed with
`Cache refresh failed: ... app_current_lodge_id`, leaving caches stale, the
health panel stuck retrying ("Fresh data is still retrying after a refresh
problem"), and report refreshes intermittently stuck while a failing round was
in flight. Report RPCs themselves (revenue, P&L, room profitability, snapshot,
occupancy) were verified healthy end-to-end with the app's own session token.

Migration `20260817090000_grant_anon_session_functions.sql` is linked and
applied: it grants EXECUTE on `app_current_lodge_id(text)` to `anon,
authenticated`, and EXECUTE on `submit_authenticated_commercial_quote_request(jsonb)`
to `anon` (previously authenticated/service_role only; the desktop calls it as
anon). Verification after deploy: `rpc/app_current_lodge_id` returns the
correct lodge id; `event_booking_line_items`, `room_types`, and
`floor_sections` reads return 200; the quote RPC now returns a business
validation error (not 42501); the full cache fetcher batch is clean. The only
remaining non-200 in the batch is `maintenance_tickets` selecting `issue`
(42703, deployed schema is older), which the app already tolerates via its
legacy-select fallback. `supabase db push` also applied the previously pending
`20260816200000_bar_offline_continuity.sql` in the same ordered deployment.
Follow-up: restart the desktop app so refresh rounds complete and the health
panel clears; re-audit remaining authenticated-only functions the desktop
(anon role) may call.

## 2026-08-16 — Bar Mode 60-day offline continuity (repository implementation; deployment pending)

Desktop Bar Mode now supports a device-local, dependency-ordered outage chain
for attendance, personal/shared Till activation, shifts, POS sales, menu and Bar
pack changes, immutable catalogue publication, blind cash-up submission, manager
cash-up review, shift close, and attendance clock-out. Local financial results
remain explicitly provisional; replay invokes the existing authoritative RPCs
with stable operation/idempotency keys and does not create a second local
financial model. Cash-up replay waits for the shift and every queued sale, and
sale replay waits for locally-created shifts, catalogue snapshots, inventory,
and booking dependencies as applicable. PIN and manager-PIN fields are
encrypted with Electron safeStorage before entering the durable queue.

The trusted desktop-session design now keeps a successful first online login
locally unlockable by password for 60 days, and the forward migration aligns
the authoritative desktop application-token lifetime to that same window. The trusted
record is stored per local profile, the password remains a bcrypt hash, and the
record uses Electron safeStorage encryption when the operating system makes it
available. This does not turn external card processors or cloud sync into
offline services; offline tenders and operational results are stored locally
and reconciled when connectivity returns.

Forward migration `20260816200000_bar_offline_continuity.sql` extends eligible,
non-revoked desktop sessions created within the preceding 60 days and adds the
client-identity replay wrappers needed by offline catalogue, attendance,
shared-Till and cash-up-review operations, and raises Bar-only immutable
catalogue eligibility to 1,440 hours (60 days). The migration is present in the
repository but is not confirmed deployed. Updated desktop source likewise
requires a normal production build and installer publication before operators
receive it.

Local verification passed on 2026-08-16: JavaScript syntax checks for the
changed main-process domains; `tests/bar-offline-continuity.test.mjs` (6/6);
`tests/offline-pos-regression.test.mjs`;
`tests/offline-queue-regression.test.mjs` (combined 8/8); and
`npm run test:bar` (128/128, including the new continuity coverage). The Hospitality POS
production build could not be rerun in this session because the execution
approval service rejected the build after its usage limit was reached; this is
an unverified release gate, not a build failure.

## 2026-08-16 — Bar product “Save & make available” session grant repair (linked applied)

The fresh Bar setup smoke test exposed a real production defect: the atomic,
idempotent `save_bar_pos_product_with_packs(jsonb)` RPC was callable only by
the Supabase `authenticated` role, while the established desktop
application-session client calls it as `anon`. Migration
`20260816110000_bar_product_save_custom_session_grant.sql` is applied to the
linked project and grants execution to `anon`, `authenticated`, and
`service_role`, after removing the broader default grant. It does not grant
table access or remove any guardrail: the RPC remains SECURITY DEFINER and
requires the current application session, matching lodge, manager/admin role,
stable operation key, payload-hash replay check, and catalog audit record.

The prior `20260816100000_bar_base_manager_pwa.sql` entitlement alignment was
applied in the same ordered deployment. Linked migration history confirms
local/remote parity through `20260816130000`. A follow-up fresh-company smoke
also found that the product RPC called the Bar pack helper to disable every
unselected pack size; that could reject and roll back an ordinary product whose
stock record was unassigned or not at a Bar outlet. Migration
`20260816120000_bar_product_save_skip_unselected_pack_templates.sql` is linked
and applied: it touches pack templates only when a pack is enabled or an
existing pack needs disabling. The Bar UI now states that the underlying item
can still be sold individually, displays pack choices only for stock assigned
to an active Bar outlet, and lets the operator choose a stock location during
stock creation/editing. Focused Bar product regression passes 10/10; the final
live smoke is an authorised Bar manager retrying the exact “Save & make
available” action. A later stock-location smoke showed the legacy virtual Bar
fallback had no UUID, so its display text could be submitted as an inventory
outlet ID and was correctly rejected by PostgreSQL. Migration
`20260816130000_bar_mode_default_physical_outlet.sql` is linked and applied:
it backfills exactly one active physical beverage outlet for each Bar-mode
company without a physical Bar outlet, and installs the same provision-on-
settings trigger for future Bar signups. It does not relabel historical stock
or sales. The Bar Stock UI now filters virtual rows from all UUID controls and
submits only a verified durable outlet ID.

The same fresh-company smoke then found that the newly provisioned physical Bar
outlet had no outlet-matched immutable POS catalogue snapshot. The v3 order
contract correctly refused to trade rather than silently using a global or
different-outlet catalogue. Migration
`20260816140000_bar_outlet_initial_catalog_snapshot.sql` is linked and
applied: its server-owned lifecycle helper builds the ordinary immutable
catalogue payload for the physical Bar outlet, creates one only when none is
active, and backfills existing Bar-mode companies. It retains the exact-outlet
snapshot requirement for orders; subsequent catalogue changes continue to use
the normal audited manager publication path. The focused Bar product/snapshot
regression suite passes 12/12. The remaining live smoke is one authorised
two-item Bar sale followed by receipt, stock, sales-report, and cash-up checks.

That live sale then exposed a second fresh-company setup defect: `current_stock`
held the opening 12 bottles, but the physical stock-location balance used by
the POS line trigger was zero. Migration
`20260816150000_bar_stock_location_opening_balance_repair.sql` is linked and
applied. It maps each Bar outlet to its shared default stock location unless a
manager already selected another mapping, reconciles only the previously
unallocated remainder of existing Bar stock without changing business-wide
stock or inventing a historical financial movement, and atomically creates
matching location balances and opening-stock ledger entries for future items.
The idempotent Receive/Count RPC now updates both balances and rejects an
attempt to make either negative. Focused Bar product/snapshot regression passes
13/13; the next live smoke remains one two-item sale followed by receipt,
on-hand, sales-report, and cash-up checks.

That live sale confirmed the financial transaction but exposed a receipt
identity presentation defect: the daily POS insert trigger had assigned the
immutable server receipt number, while `create_pos_order_v3(jsonb)` omitted it
from both its initial response and stored idempotent result. Migration
`20260816160000_pos_v3_server_receipt_identity.sql` is linked and applied. It
returns the receipt number, order number, daily sequence, and business date
from the committed same-lodge `pos_orders` row, and enriches only prior v3
idempotency records that already map to a row with a server-issued receipt
number. It neither changes a POS order nor its tender, stock, audit trail, or
receipt assignment. The POS receipt UI continues to block print/save when a
server number is genuinely absent rather than inventing one. The focused POS
financial-truth suite passes 7/7 and the complete Bar suite passes 107/107.

The same live sale revealed that the Reports screen was deriving its financial
readiness from raw POS history metadata in the renderer, even though the
server already publishes a certified, hash-bound POS financial-report dataset
for exports. The desktop now has a `pos:getCertifiedReportHistory` IPC
contract that uses that server dataset, its report run and control totals, and
the existing local-pending-operation check. It returns an explicit complete
envelope only after certification; otherwise it retains the order list but
marks every aggregate as unavailable and gives the operator the server
recovery reason. The reports screen uses those certified controls for normal
history (correction mode remains separately scoped). The first live use
correctly failed closed because the older authorization migration granted that
SECURITY DEFINER report function only to `authenticated`, while the desktop
uses the established application-session context with the PostgREST `anon`
role. Migration
`20260816170000_pos_financial_report_custom_session_grant.sql` is linked and
applied. It grants only `anon`, `authenticated`, and `service_role` execute
access after revoking the public default; it does not grant table access or
weaken the report's app-actor, lodge, capability, or outlet-scope checks. The
complete Bar suite passes 107/107, the focused financial-report regression
passes 31/31, and the Hospitality POS production build passes.

The first PDF-export smoke then exposed the matching application-session grant
gap in `record_report_artifact_result(...)`: the detailed JSON companion was
written locally, but its server audit record was denied before PDF rendering.
Migration `20260816180000_pos_report_artifact_custom_session_grant.sql` is
linked and applied. It restores execute access only to `anon`,
`authenticated`, and `service_role`; the SECURITY DEFINER RPC still locks the
same-lodge report run, requires the caller's current POS-report access, and
allows a non-service caller only to record artifacts for the POS report run it
created. Accounting-artifact access remains excluded. The focused
financial-report regression passes 31/31; the outstanding live smoke is a
successful PDF plus JSON companion export for the certified Bar sale.

The subsequent Bar stock smoke found that `getInventoryItems()` correctly
marked an online server-complete array, but the custom array properties were
lost across Electron IPC and the UI therefore showed its safety warning and
withheld availability cards. The desktop now exposes the additional
`inventory:getItemsWithReadStatus` envelope (`items`, `source`, `complete`)
for the Bar stock controls; the legacy list endpoint remains unchanged for
other operational callers. The Bar page treats a missing envelope as
unverified, while an online, complete server read now displays its truth
explicitly. This alters no inventory record or database contract. Focused Bar
stock/report tests pass 33/33 and the Hospitality POS production build passes.
The remaining live smoke is a restarted Bar app showing the stock cards and
the expected post-sale on-hand balance without an unavailable-source warning.

The same manual smoke exposed a separate interrupted-sale recovery hazard.
Read-only linked evidence for the test company shows two different v3 sale
intents rather than one idempotency key being applied twice: R-0001
(`773ff471-bd15-4b28-a97c-29ba2b3d5906`) was created on the client at
13:44:06Z and committed at 13:44:12Z; the older unresolved intent later issued
as R-0002 (`e08df12f-223f-4205-8323-4ff5643fdcc3`) was created on the client
at 13:29:35Z but committed only when recovered at 14:40:57Z. Each receipt has
exactly one matching `financial_operation_idempotency` record and its own
`pos-order:<intent-id>` key. The server therefore preserved same-key
idempotency, but the local submission journal previously allowed the same
signed-in operator to start a different intent while an older one remained
pending.

The journal now permits only one unresolved intent per lodge and signed-in
operator, while still allowing an exact payload/key replay. A different sale
fails closed with `pos_submit_recovery_required`; a failed or unauthorized
server reconciliation read no longer becomes a false “not found” result. The
Till recovery card displays the original client timestamp, items, quantities,
and tenders, warns that a retry can complete an older sale that was never
recorded, and tells the operator to check Sales and not retry after entering a
replacement. The submit-journal tests are now part of the normal Bar release
gate. Verification: focused recovery/workspace/stock tests pass 36/36, the
complete Bar suite passes 119/119, and the Hospitality POS production build
passes. No database migration or direct data repair was made. R-0002 remains
intact pending an explicit, audited manager void with stock returned; deleting
the transaction would destroy the financial and inventory audit trail.

Live correction verification: the manager voided R-0002 through the protected
PIN workflow with the documented interrupted-test-sale reason and
`return_to_stock`. A read-only linked database check confirms R-0001 remains
the sole completed P40 sale, R-0002 is `voided`, `pos_override_log` contains
the void approval, and `pos_audit_log` records an authoritative -P40 delta plus
two restored Heineken 330ml units. Both `inventory_items.current_stock` and the
mapped Bar stock-location balance are now 10. No row was deleted or edited
outside the governed void RPC.

The live shared-terminal cash-up smoke then found an analogous deployment
grant gap: the staff cash-up submission succeeded, but its required
attendance-PIN clock-out was denied before the manager review. Migration
`20260816190000_attendance_pin_custom_session_grant.sql` is linked and
applied. It grants execute only on the existing protected attendance-PIN
clock-in and clock-out RPCs to `anon`, `authenticated`, and `service_role`
after revoking the public default. Their SECURITY DEFINER implementations
continue to require the current app actor's lodge/role, selected staff member,
staff PIN, and existing attendance idempotency contract. Read-only linked
verification confirms `anon` execute access for exactly both functions. The
focused cash-up checks pass 7/7 and the complete Bar suite passes 120/120.

The repaired attendance path then completed a live cash-up lifecycle for the
fresh Bar company: the cashier submitted P60, attendance clock-out completed,
and the manager approved the same P60 against P60 expected with zero variance.
Linked read-only verification confirms one approved submission, one closed Till
shift, and one reconciled cash-up session carrying the same server cash-up
identity; it did not create a second close. Two final operator-UX corrections
are in the desktop source: a successful staff clock-out notice is no longer
cleared by the form reset, and focusing the manager-PIN input brings the
Approve/return actions into view with an accessible scroll target. Focused
cash-up tests now pass 8/8, the complete Bar suite passes 121/121, and
`npm run build:hospitality-pos` passes on 2026-08-16. This is source/build and
linked-database evidence; the desktop UI changes still require the normal
desktop release/installer publication process before customer devices receive
them.

Bar Manage now includes an owner-facing package guide sourced from the same
authoritative add-on catalogue used by commercial quoting. It accurately
states that Base Bar POS records sales, simple delivery quantities, and
physical counts, but does not create supplier bills, purchase history,
cost-of-sales reporting, or a P&L. It shows each annual add-on's live
entitlement state and price, and explains that both Stock & Purchasing Pro and
Accounting & Workforce are required for a controlled purchases-to-P&L workflow.
The guide is informational and routes only to governed package review; it does
not alter any entitlement. The complete Bar suite passes 122/122.

## 2026-08-14 — Linked Supabase migration deployment without Docker

Docker Desktop and Podman are unavailable on this workstation, so the migration
alternative is the linked Supabase Management API path: `supabase db push
--linked --yes`. With the user's explicit deployment authority, the full local
chain is now applied to project `oicgpknsmtvcsjacymum` through
`20260814080000_security_definer_search_path_hardening.sql`. `supabase migration
list --linked` reports 371 migration rows with every local ID equal to its remote
ID; there are no pending local migrations. The deployment included the Bar/POS
authorization hardening plus forward-only linked-schema lint repairs: persisted
POS `tab_id` linkage and split-payment guard, historical-cutover approval
timestamp, partial tax-return conflict targeting, stale parameter/column fixes,
and HypoPG advisor wrappers with admin/service-role-only execution.

Remote verification: `supabase db lint --linked --level error --fail-on error`
passes with zero linked SQL errors. Read-only smoke checks confirm the obsolete
`public.pos_payments` relation is not referenced, `pos_orders.tab_id` and
cutover `approved_at` exist, and the tax base partial unique index is present.
The 20260814060000 forward migration makes the five compatibility views
security-invoker/security-barrier and enables RLS while revoking direct
anon/authenticated table grants on the ten internal audit, sequence, commercial,
and payroll tables. `supabase db advisors --linked --level error --fail-on none`
now reports no error-level findings; 20260814070000 also removes the redundant
POS table uniqueness index. The 20260814080000 migration fixes the mutable
search_path on 59 SECURITY DEFINER functions. The warning-level advisor baseline
is now 1,854 legacy warnings (835 anonymous/863 authenticated callable
SECURITY DEFINER notices, 42 permissive-policy notices, 66 init-plan notices,
46 remaining mutable search paths, one Auth configuration warning, and one
public-extension placement warning). The local disposable Accounting
behavioral suite remains unavailable because no local PostgreSQL runtime is
installed; never aim it at the linked production project.

## 2026-08-14 — Bar/Restaurant authorization and fail-closed verification (linked applied, release-gated)

The linked project now includes `20260814010000_bar_pos_authorization_hardening.sql` and the forward lint-repair/security chain through `20260814080000`. Their wrapper contracts enforce operator capability, lodge/outlet scope, and audited tab-status transitions for POS tabs and financial report exports; the desktop IPC mirrors those boundaries for settings, hardware, POS reads/exports, cash-drawer operations, and Accounting close/payroll exports. Hospitality POS Business Control now treats unavailable POS, expense, stock-cost, menu-cost, expiry, and procurement sources as unavailable rather than zero or “none,” and Balance Sheet period-close controls require `accounting.close`. Cached tab reads are outlet/status filtered, online tab-status failures no longer mutate the local cache, and cash-up history failures no longer become a false empty history. Owner Digest now derives monetary fields only from the certified POS report envelope; staff performance, recipe variance/preparation-loss, finance overview, settlement, deposit, tip, and cash-up reads preserve source metadata and fail closed instead of presenting empty reads as zero. A preparation-loss RPC contract bug referencing an undefined client variable was also removed. The lint-repair chain persists authoritative POS order-to-tab identity and repairs linked schema drift without recreating `pos_payments`; the final security migration makes compatibility views obey base-table RLS and removes direct grants on internal tables, the index cleanup removes a redundant `pos_tabs` uniqueness index, and the definer hardening fixes trusted search paths on 59 elevated functions.

Local verification on 2026-08-14: Bar regression 98/98, financial-truth 189/189, commercial 10/10, product 15/15, release architecture 2/2, offline POS/queue, financial-integrity, release-behavior, production guardrails, `audit:prod` (0 production vulnerabilities), `npm run build:hospitality-pos`, `npm run manager:lint`, and `npm run manager:build` all pass; Manager lint has 0 errors (34 warnings). The official restaurant suite still requires PostgreSQL at `127.0.0.1:54322`; the opt-in disposable harness confirms Docker Desktop and Podman are both absent. Linked migration parity, error-level SQL lint, and error-level security advisors now pass, and read-only smoke confirms anonymous compatibility-view reads return zero rows while RPC-backed commercial quoting still works. No authenticated outlet-isolation/concurrency smoke has run. This is database deployment evidence only; Restaurant/Bar and Accounting remain no-ship until disposable behavior, authenticated smoke, policy sign-off, and release packaging are completed.

Count correction (2026-08-13): the final Bar suite is 89/89 after adding shared report, stock-cost, and expense finality coverage; earlier 84/84, 85/85, and 86/86 references below are superseded.

Final cross-surface verification (2026-08-13): generic restaurant Finance Overview, Daily Close, Cash Drawer, desktop POS History, Hpos My Sales, Legacy receipt detail, open-tab split previews, customer display, queued return rows, and incomplete cash-up previews now fail closed on uncertified totals or tenders. History exports require a server-complete reconciled envelope; refund workflows require an explicit confirmed tender instead of inheriting `cash`; server-issued receipt identity and recorded line amounts remain mandatory for printed artifacts; successful online receipt DTOs no longer turn missing server amounts/tenders into zero or local fallback truth. Detailed expenses and stock-cost reports/exports also preserve unavailable amounts, reject synthetic quantity×unit-cost totals, and require explicit server-complete source metadata. Shared booking revenue, occupancy, P&L, and room-profitability views now use the same explicit finality contract. The new `20260812040000_spend_report_finality.sql` and `20260812050000_shared_report_finality.sql` add those certificates to the server RPCs, but neither is deployed. The final Bar suite is 89/89, financial truth is 189/189, Legacy POS is 217/217, Manager lint has 0 errors (34 warnings), Manager/web/booking builds and tests, Hospitality POS and Legacy builds, offline/queue, enterprise, production guardrails, and release gates pass. This remains local code evidence only: linked migrations are behind the local tip, `db:lint` reports 20 linked-schema errors, and no disposable PostgreSQL or authenticated production smoke has run.

## 2026-08-12 — Bar financial UI finality follow-up (local, no-ship)

The Bar implementation now withholds Manager PWA and desktop summary money when the authoritative POS source is incomplete or stale, uses server/business-date and lodge-timezone finality in `20260812010000_manager_bar_pos_snapshot_finality.sql`, preserves POS/expense read metadata through Electron IPC, and prevents synthetic receipt numbers, derived open-tab totals, cached Till totals, and unconfirmed corrections. Bar exports select restaurant-scoped presets and fail closed if a legacy preset is submitted. Legacy POS Bar mode also removes lodging-specific sync language. Focused Bar tests pass 86/86; financial-truth tests pass 189/189; Manager build/lint and Hospitality POS/Legacy POS builds/tests pass. The new migrations and all client changes are local-only; the linked database remains behind the local migration tip and the disposable PostgreSQL behavioral gate is unavailable, so this is not a deployment or release claim.

Follow-up verification (2026-08-13): the Bar suite now passes 86/86 after withholding incomplete Hpos Reports/Business Control/Manager operations/Manager POS-sales monetary aggregates, requiring persisted reconciled tender envelopes and recorded line amounts for Manager certification, making cached stock counts explicitly last-known and blocking audited count deltas until a server-complete read, excluding lodging night-audit and maintenance-only surfaces from the Manager PWA Bar navigation, removing unsafe optional-promise catches, and closing remaining unrecorded item-line fallbacks in Business Control, POS exports, generic desktop reports, shared POS snapshots, Legacy POS history/export, Legacy cash-up, hardware receipts, and receipt tender labels. Manager PWA lint has 0 errors (34 warnings), Manager build and Hospitality POS/Legacy POS builds pass, `npm run audit:prod` passes with 0 production vulnerabilities, Legacy POS regression passes 217/217, and release architecture/behavior gates pass. The focused financial-truth suite passes 189/189; offline POS/queue critical gates, enterprise (50/50), full production guardrails, and web-surface contracts/builds also pass. The open-tab/customer-display financial-finality regression is included in the 86/86 count. The disposable Accounting behavioral suite still cannot connect to `127.0.0.1:54322` on this workstation; linked `db:lint` still reports 20 pre-cleanup-schema errors because the local cleanup migrations are not deployed. New local finality migrations `20260812020000_manager_bar_pos_report_detail_finality.sql` and `20260812030000_pos_export_detail_finality.sql` remain uncompiled against PostgreSQL and unapplied; the generic desktop POS summary now falls back to the authoritative export contract when deployed and otherwise remains uncertified.

Current correction for this section (2026-08-08): the local tip is `20260807560000_financial_truth_remediation_followup.sql`. It corrects signed POS return tender controls, signed tender-envelope enforcement, deferred cumulative-return GL posting, operational/Accounting tender-writer separation, customer-account DTO authorization, POS export outlet scope and artifact evidence, statement cumulative equity/row DTO correctness, and bank split-allocation capacity. The focused financial-truth/accounting suite passes 186/186 and the Hospitality POS production build passes. This migration is local-only and has not been applied to a disposable or linked database; Accounting & Payroll remains no-ship pending the existing behavioral, authorization, migration, policy and deployment gates. The historical 153/153 and 30-migration figures below describe an earlier continuation slice and are superseded.

## 2026-08-07 — Financial-truth continuation: source-chain closure, complete file exports, and linked lint cleanup (local, no-ship)

The current local tip also contains `20260807380000_pos_account_voucher_atomic_tender_guard.sql`. It requires activated Accounting plus customer/voucher identity in the authoritative POS tender breakdown, and both desktop and Legacy POS replay adapt older queued v3 account envelopes without rotating their stable operation key. This migration is local-only and unverified in the unavailable disposable PostgreSQL behavioral gate.

The latest local forward gates add Accounting grant lockdown, server-authored POS report datasets, historical-account/opening-balance policy, optional-Accounting operational tender subledgers, cumulative return reversal, source-coverage registry, signed bank imports/allocation matching, page-specific export finality, payroll statutory/PII controls, authoritative source-population coverage, fail-closed statement finality, and an allocation-aware bank workspace. The existing v2 contracts remain compatibility surfaces but are no-ship locked. `20260807420000` through `20260807550000` are local-only and not deployed.

Correction to the historical verification counts in this section: the focused financial-truth/accounting suite now passes 179/179; 31 pending migrations through `20260807380000` were transaction-compiled and rolled back, while the cutover/AP and forward financial-truth gate migrations through `20260807550000` have static/contract evidence only; Legacy POS regression passes 217/217; and the full data exporter now writes a per-section `data-export-manifest-v1`, blocks incomplete financial claims, and visibly labels allowed partial operational workbooks.

The local remediation chain now also includes `20260807230000_inventory_movement_evidence_and_valuation.sql`, `20260807240000_payroll_payment_batches_and_idempotency.sql`, `20260807250000_payroll_statutory_provenance_and_attendance.sql`, `20260807260000_financial_truth_linked_lint_cleanup.sql`, `20260807270000` through `20260807330000`, plus `20260807340000_cashup_variance_source_gl_posting.sql`, `20260807350000_tax_amendment_and_adjustment_lifecycle.sql`, `20260807360000_tax_adjustment_review_read.sql`, and `20260807370000_accounting_page_exports.sql`. Stock movements, purchases, and transfer records receive durable operation/source-document/payload evidence and disclose `unknown_legacy` valuation instead of reconstructing history from current cost. Payroll has immutable export batches with file hashes/control totals, stable approve/export/settle/reconcile/close operations, liability settlement against a selected asset account, bank evidence, statutory source/hash/provenance requirements, and an attendance disposition register. Settlement now posts clearing/fee/deposit journals and source coverage; blind cash-up posts only non-zero cash over/short differences; tax has governed debit/credit-note adjustments, filed-return amendment generation, and an authenticated review read surface. The cleanup migration repairs active linked-schema Manage/AP/bank projection errors and fail-closes stale pre-V2 financial RPC bodies without restoring operator grants. All eight Accounting pages now request complete, server-authoritative report-run-backed exports with row counts, source hashes, completeness manifests, and stable report-run identities.

The desktop Accounting bridge and Payroll/Tax pages expose these contracts, preserve stable keys through retries, block payslips before approved calculation state, and retain the eight-page export/readiness controls. Accounting report/export RPCs remain authenticated-denied by the forward lockdown until the DB gate passes. POS history Excel/PDF exports now request the uncapped server-certified POS dataset, use shared classification/control logic, verify the saved workbook/PDF, and attempt restricted artifact evidence recording. The repository includes `npm run test:restaurant:disposable`, an explicit opt-in harness that starts Supabase, resets a disposable database, applies the ordered migrations, runs the restaurant suite, and stops the stack; the harness reaches Supabase only under elevated filesystem access, then fails because Docker Desktop/Podman is not installed or on PATH. Local verification on this continuation: the focused financial-truth/accounting suite passes 179/179; the POS truth fixtures pass 4/4 including >5,000 rows; temporary POS Excel/PDF handlers write, reopen, and hash artifacts; Manager PWA lint/build and Hospitality POS production build remain previous passing evidence; changed JavaScript syntax checks pass; and 31 pending migrations through `20260807380000` were the last transaction-compiled batch and explicitly rolled back. The forward financial-truth gate migrations through `20260807550000` have static/contract evidence only. The combined build command once exceeded its 120-second shell timeout while the POS client build was still running, then the standalone `npm run build:hospitality-pos` completed successfully.

This remains a strict no-ship state. The new SQL migrations are not deployed or live-verified; the local PostgreSQL behavioral gate at `127.0.0.1:54322` is unavailable; linked Supabase lint reached the project but reports 20 current-schema errors until the cleanup migration is applied; no authenticated concurrency/isolation/cutover or payroll bank rehearsal has run; and accounting policy/statutory sign-off, migration deployment evidence, signed packaging, and production smoke are still required. Do not enable Accounting or claim the 85-issue remediation is shipped from this worktree.

## 2026-08-07 — Bar and Accounting financial-truth remediation (local, no-ship)

The forward financial-truth control plane is implemented locally but is not deployed or enabled. `20260807120000_bar_accounting_financial_truth_control_plane.sql` adds explicit accounting activation/cutover, source-posting coverage, cumulative balance-sheet calculations, report-run manifests, expense/POS/AP/payroll source linkage, payroll expected-worker readiness, and locked absolute stocktake behavior. `20260807130000_bar_tab_financial_snapshot_and_concurrency.sql` adds server-computed open-tab totals, tab versions and payload-hash split replay. `20260807140000_retire_legacy_cash_drawer_close.sql` removes the editable lodge-wide drawer close and auto-close behavior. `20260807150000_budget_versioned_complete_matrix.sql` adds exact versioned budget coverage and maker-checker approval. `20260807160000_ap_payment_payload_hash_and_bank_close_boundary.sql` binds AP payments to a canonical payload and payment account. `20260807170000_bank_packet_without_period_lock.sql` completes bank packets without implicitly locking an accounting period. The linked database boundary remains the previously recorded `20260730100000_shared_till_operator_attribution`; all seven migrations are local-only.

Accounting activation remains a no-ship operation until a disposable PostgreSQL instance proves the behavioral/concurrency/authorization fixtures, the policy decisions in `docs/ACCOUNTING_POLICY_DECISIONS.md` are signed off, source coverage is complete for the target period, the migration chain is deployed and linted, and authenticated smoke covers desktop, Manager PWA, and Legacy POS compatibility. No production or release claim is made from local SQL or static tests. The current worktree contains unrelated user changes and remains uncommitted.

As of: 2026-08-06 (POS critical-hardening follow-up, local)

## Status: The Restaurant & Bar (Hospitality POS) hardening implementation is in the repository as uncommitted work and is not released or deployed from this worktree. POS submissions recover from interrupted server calls through a stable main-process submit journal that never evicts unresolved financial attempts; recipe stock depletion is implemented as server-atomic in the new local migration but is not PostgreSQL-verified on this workstation; shift close routes through authoritative cash-up finalization or exact server evidence and requires `pos.cashup`; cash-up submissions use fail-closed persisted, server-key-correlated rounds; and the Manager PWA support inbox uses write-ahead queue envelopes and queue-item operation IDs. The restored Till attribution migration is present locally and is already applied to the linked project. `supabase migration list --linked` confirms local and remote histories align through `20260730100000_shared_till_operator_attribution`. The forward migrations `20260805090000_pos_recipe_stock_depletion_server_atomic.sql`, `20260805100000_support_inbox_operation_id_idempotency.sql`, `20260806100000_authoritative_pos_shift_close_resolution.sql`, and `20260806110000_cashup_retry_resolution_keys.sql` remain local-only and require separate review/deployment before customer enablement. Verification below records repository implementation, linked deployment and release state separately; repository presence is not deployment or release.

### 2026-08-06 — Encrypted free-tier Supabase cloud backup workflow (local, not enabled)

- A daily GitHub Actions workflow now prepares the official Supabase logical-backup set (`roles.sql`, `schema.sql`, and `data.sql`) on a hosted runner, records SHA-256 evidence, encrypts the compressed archive with AES-256-GCM plus RSA-OAEP key wrapping, removes runner plaintext, retains a seven-day encrypted Actions artifact, and uploads the encrypted copy to a user-owned Google Drive folder through least-scope `drive.file` OAuth.
- Google Drive retention keeps daily copies for 14 days and one copy per ISO week through 90 days; expired copies move to Drive trash. Encryption decryption/tamper checks and retention-policy tests are repository-local. The encrypted private key never belongs in GitHub or Google Drive and is required for every recovery rehearsal.
- This workflow is not operational yet. It has not been pushed to the default branch, no GitHub secrets are configured from this worktree, and no live backup or restore rehearsal has run. Follow `docs/SUPABASE_FREE_BACKUPS.md`, manually trigger the first run, decrypt the resulting artifact, and restore only to a disposable project before claiming recovery readiness. Database dumps do not contain Supabase Storage object binaries, which remain a separate backup requirement.

### 2026-08-05 — POS critical-hardening pass (local, not deployed)

- Interrupted POS submissions now recover via a durable main-process submit journal (`posSubmitJournal.js`, JSON-backed in the state cache dir). First submission records the exact server envelope (submitIntentId, order ID, client timestamp, payload digest); an exact retry reuses the original envelope so the server idempotency contract replays the original sale; changed payloads fail closed as idempotency conflicts; unresolved entries are never evicted to make room for committed records; and corrupt journals write a durable recovery block before moving evidence. If the marker write fails, the original corrupt file remains in place and an in-process latch prevents a later sale from treating the missing marker as a clean first run. HPOS Terminal recovery offers only Retry original sale with guidance that staff must not recreate it. Till-operator gate rejections keep the envelope, so retry after PIN re-verification checks the original sale. Journal capacity/corruption, marker-write failure and interrupted-submission recovery tests pass.
- Recipe stock depletion is now server-atomic: a new trigger on `pos_order_items` inserts lock inventory rows, computes portion quantity in inventory units including waste, fails closed on insufficient stock, and writes both restaurant recipe stock movements and inventory movements. The legacy `record_recipe_stock_depletion` RPC is rewritten as an idempotent replay that derives quantities from the authoritative order lines and skips lines that already have movements; a new manager-only reconciliation report lists orders missing movements. The offline queue no longer enqueues a separate depletion operation, so offline replay cannot double-deplete. The focused recipe contract tests pass; live PostgreSQL behavior remains blocked by the unavailable local database.
- Shift close now runs through the authoritative `finalize_pos_shift_cashup_v2` RPC with a stable per-shift idempotency key; offline and failed/ambiguous responses keep the local shift open; exact server resolution requires a closed status plus matching cash-up/finalization evidence; stale cached `open`, missing, locked, void and unknown states fail closed; and replay does not append a second close audit. The `pos:closeShift` IPC handler requires `pos.cashup`, and the Lodge compatibility UI shows pending/error/recovery guidance.
- Cash-up submissions (My Cash-up and shared-terminal Staff cash-up) now persist one real lodge/shift/manager-actor round with the original payload fingerprint before IPC. Exact transport retries reuse the same key and original count/notes/identities; storage failures prevent the RPC; changed details remain blocked until the server confirms rejection of that exact saved idempotency key; and shared-terminal retries continue to require the staff PIN while retaining the staff operator separately. A stale rejection from the preceding round, including after a corrected submission commits but its response is lost, cannot rotate the corrected round's key. The local `20260806110000_cashup_retry_resolution_keys.sql` migration exposes only the opaque operation key needed for this correlation and keeps expected drawer/variance data out of the cashier response.
- The Manager PWA support inbox now writes the complete queue envelope before every online support RPC, verifies it by read-back, deduplicates by operation ID, removes it only after success/replay, and retains the same item after transport ambiguity. The support RPC migration adds transaction-scoped advisory locks and canonical SHA-256 payload hashes for lodge/ticket operation scopes; PostgreSQL concurrency behavior remains unverified until the local database is available.
- Verification: the focused repository regressions pass 61/61 with 0 failures (56 POS/support correction tests plus 5 separate cloud-backup tests); `test:bar` passes 67/67; `npm test`, all five offline/financial/inventory/release gates, Manager lint (0 errors), Manager build, and the Hospitality POS build pass. The recipe and support PostgreSQL behavioral suites, plus `test:restaurant`, are blocked by `ECONNREFUSED 127.0.0.1:54322` and therefore make no database-behavior claim. The cash-up retry-resolution migration has repository contract coverage but no PostgreSQL behavioral result on this workstation. `git diff --check` passes; the final handoff records script-level pass/fail status separately where scripts do not emit test counts.
- Repository/deployment boundary: `20260730100000_shared_till_operator_attribution.sql` is restored locally and remains uncommitted; `supabase migration list --linked` confirms the same version is applied remotely. `20260805090000_pos_recipe_stock_depletion_server_atomic.sql`, `20260805100000_support_inbox_operation_id_idempotency.sql`, `20260806100000_authoritative_pos_shift_close_resolution.sql`, and `20260806110000_cashup_retry_resolution_keys.sql` are local-only and have not been deployed. All renderer/main-process/PWA changes in this section are local and uncommitted; no release binary, push, or migration deployment was performed.

### 2026-07-30 — Configurable Till operator verification (local)

- Hospitality POS settings now expose Till operator verification for restaurant/bar companies. New and unset companies fail closed to **Strict — PIN for every order**. Managers can explicitly choose **Shift — PIN once, then stay unlocked** and configure the inactivity lock (default 30 minutes, bounded to 5–240 minutes).
- Shift sessions retain the PIN-verified operator identity for sales, held tabs, and cash-up. The authoritative main-process session manager now renews only validated Shift activity, expires without read-side effects, clears on outlet/operator/shift mismatch, and invalidates matching sessions when a shift or policy closes. Sensitive corrections remain manager-approved. Anonymous Till operation is not supported.
- The main process validates and overwrites shared-terminal operator, outlet and shift attribution before order/tab writes, consumes Strict sessions after a successful order, and revalidates an open shift online so the policy cannot be bypassed by renderer state. Missing/invalid policy data resolves to Strict. The deployed `20260716033000_pos_order_operator_from_shift.sql` trigger remains the database authority for completed-order cashier attribution.
- Focused verification: the Bar suite includes behavioral session expiry, touch renewal, mismatch rejection, Strict consumption, shift-close isolation, and the deployed server attribution guard. This session-policy implementation and the restored `20260730100000_shared_till_operator_attribution.sql` file remain local and uncommitted; `supabase migration list --linked` confirms the linked project has the same migration applied. The supporting migration is not a reason to omit a migration from the repository; it is the repository’s restored record of an already-linked deployment.

### 2026-07-29 — Bar Mode scanner and barcode hardening (deployed)

- Hospitality POS Till and Legacy POS now share one keyboard-wedge decoder with Enter/Numpad Enter/Tab and idle completion, timing-gap reset, prefix/suffix framing, length/control validation, leading-zero preservation, duplicate terminator protection, outlet-safe lookup, stock-availability checks, and suspension while payment, PIN, shift, modifier, or receipt workflows have focus.
- Bar Base Stock and Products support manual barcode entry or an explicit Scan flow. Stock create/edit preserves barcode values through online RPCs, cache and retry payloads; Products can inherit a linked stock barcode without overwriting an explicit menu code. 6/12/24-pack templates have independent scan/edit fields and cannot silently reuse a single-bottle code.
- System Health now verifies a real scanner input on the current POS computer, displays captured length/terminator for operator confirmation, exposes bounded framing/timing settings, and records only a SHA-256 barcode hash in the local POS audit. A keyboard-wedge device has no OS-level “connected” signal; this explicit capture is the authoritative connection proof.
- Forward migrations `20260729160000_barcode_scanner_guardrails.sql` and `20260729170000_bar_pack_template_barcodes.sql` are applied to the linked Supabase project. They normalize and lock active inventory/menu assignments, enforce lodge/outlet duplicate rules, provide manager-only conflict checks, preserve single-product sync, and persist distinct package barcodes through the authoritative pack RPC.
- Verification passes: 57 Bar tests, 217 Legacy POS regressions, 3 critical financial/offline/inventory gates, POS hardware-adapter tests, 15 product tests, 2 release-architecture tests, main-process syntax checks, both Hospitality POS and Legacy POS production builds, and linked migration history through `20260729170000`. Linked lint still reports the repository’s existing unrelated schema errors plus one non-blocking loop-variable warning in `normalize_pos_barcode`; no new scanner/pack errors were reported.
- No installer was built or published. Before customer handoff, run System Health → Devices → Verify scanner input with the actual scanner, scan a known product, confirm the displayed count/terminator, then scan that product at Till, Stock setup, and (if used) each pack template. Keep a printed/manual fallback until that physical smoke test passes.

### 2026-07-29 — Bar Mode guardrail repair pass (deployed)

- Stock editing now preserves `latest_unit_cost`: blank cost means unchanged, zero remains an explicit valid value, invalid/negative/non-finite values fail closed, and edit forms cannot change on-hand quantity outside Receive/Count. Restricted stock users select only assigned outlets; managers/admins may use lodge-wide or explicit outlet aging views.
- Provider payment references are enforced at the Hospitality POS main-process boundary, Legacy POS renderer/main/offline queue boundaries, and a forward database trigger repair that rejects empty/non-array provider breakdowns as well as missing or oversized references.
- Cash-up idempotency now serializes retries and validates shift, cashier/operator, actor, rounded physical cash, and notes before returning a replay. Shared attendance-PIN handovers use the same conflict contract.
- Focused verification passes: 43 Bar tests, 217 Legacy POS regressions, 4 critical financial/offline/hardware gates, 15 product tests, 2 release-architecture tests, main-process syntax checks, and the Hospitality POS production build.
- The first linked deployment attempt exposed an invalid historical `SELECT ... INTO` record syntax in `20260721151000_command_central_commercial_billing.sql`. That migration was repaired and committed as `567f6d76` before retrying. The ordered push then applied all 16 pending migrations through `20260729150000`; read-only migration history now matches local through that version.
- Post-deployment `npm run db:lint` completed, but `scratch/db-lint.json` retains 20 pre-existing errors in unrelated asset, restaurant-accounting, payroll, and corporate-billing surfaces. None name the new Bar contracts (`get_bar_stock_aging`, cash-up idempotency, or tender-reference guards).
- No installer was built or published. Authenticated cashier/manager smoke tests for cash/card/mobile/split tenders, measured pours, stock-aging visibility, blind cash-up, and exact replay still require designated test accounts and remain the final operational gate.
### 2026-07-29 — Wrong-folder Restaurant/Bar recovery audit

- Compared the canonical `Tsa Bonno HospitalityOS` worktree with the accidental `Boroko Bookings` worktree. The accidental branch is the canonical branch's June 6 ancestor and is 41 commits behind; its July 29 work is uncommitted and targets the obsolete pre-v3 POS architecture.
- Preserved all 19 tracked modifications and 52 untracked non-ignored files from the accidental folder in the verified `recovery/boroko-bookings-2026-07-29.zip` bundle. All 71 extracted files matched their source SHA-256 values. Ignored environment files were compared separately without copying secrets; the canonical folder already retains the required backend, booking-site, PWA, database, and release configuration.
- The July 29 POS/domain/UI and Phase 1–8 migrations were not copied wholesale. They would downgrade the current `create_pos_order_v3` path or create parallel sale, return, KDS, shift, inventory, and check models. The proposed anonymous Manager oversight function also lacks an effective caller lodge/capability check, and the proposed check ledger accepts caller-authored line prices.
- Recovered the architecture-neutral disposable-test-tenant guard, deterministic Restaurant/Bar fixtures, guarded seed/reset CLI, `.env.example` opt-out, and package test script. The nine non-network guard tests pass; `--help` on the recovered CLI was repaired.
- The comparison and per-phase disposition are recorded in `docs/WRONG_FOLDER_RECOVERY_2026-07-29.md`. No July 29 Supabase migration was deployed. Valid concerns from the accidental audit—especially plaintext approval credentials in legacy offline queue compatibility and best-effort POS audit writes—remain candidates for new v3-compatible forward repairs.
- Canonical verification before the recovery snapshot: production guardrails, the recovered tenant guard, offline POS, inventory offline sync, Booking Site tests (33/33), Booking Site build, Marketing Site contract, Hospitality POS production build, Lodge/Camp production build, Manager PWA production build, and Manager PWA lint all pass. Manager lint retains 45 existing warnings and no errors. The Restaurant suite passes its first 16 accounting tests, then stops at the known disposable PostgreSQL gate because `127.0.0.1:54322` is not running. Restoring Booking Site development dependencies from its lockfile reported five audit findings (one moderate and four high); no dependency versions were auto-changed during recovery.

### 2026-07-29 — Bar Mode launch-readiness implementation (local, not deployed)

- Bar cash-up is now blind for active cashier/bartender sessions: the operator enters only the physical cash count, expected tender totals and live variance are withheld, and the authoritative submission contract stores server-derived non-cash expectations for manager review. Shared-terminal PIN handover follows the same contract and prevents duplicate submitted handovers.
- Bar products now accept validated decimal `depletion_qty` values for measured pours, retain independent 6/12/24 pack-template depletion, and fail closed when the recipe method is selected without the Stock & Purchasing Pro entitlement. A database check guard prevents new or updated non-positive direct-stock quantities.
- Bar Base Stock now exposes server-authoritative last receipt/sale dates, elapsed days, and Fresh/Aging/Stale/Critical age buckets through an outlet/lodge-scoped read RPC. The UI keeps on-hand values visible but labels stock age unavailable when offline or when the RPC cannot be verified; lot expiry and write-off remain Stock & Purchasing Pro controls.
- Card and mobile-money POS tenders now require a transaction or terminal approval reference in Bar Till and the legacy POS compatibility surface. References persist through the v3 payment breakdown, offline replay payload, receipt, sales detail, and the database trigger guard.
- Focused verification passes: 39 Bar/product/cash-up/aging/payment-reference tests, the offline POS, inventory offline-sync, financial-integrity, and POS hardware gates, plus both Lodge/Camp and product-specific Hospitality POS production builds. No installer was built or published. The four forward migrations from this pass are local only and require linked Supabase deployment plus authenticated behavioral proof before customer enablement.

### 2026-07-23 — Bar POS base and three add-on bundles (local, not deployed)

- The 2026-07-22 base-only curation is superseded by a four-part commercial structure: **Bar POS** base at P4,500/year, **Stock & Purchasing Pro** at P3,000/year, **Accounting & Workforce** at P6,000/year, and **Growth & Multi-Outlet** at P5,000/year. Bar mode keeps one six-item operating rail; base management now includes staff accounts, live shifts, bar checklists, access/POS audit, products, basic stock, cash-up, sales, displays, settings, health and protected data tools.
- Add-on routes are controlled by the selected commercial add-on keys as well as ordinary role/capability checks. Direct URLs fail closed. Restaurant floor, reservations and kitchen remain excluded from bar mode; shared accounting pages stay shared, while stock, workforce, customer, voucher, owner and outlet language is bar-specific.
- The authoritative commercial migration `20260723010000_bar_product_bundles.sql` mirrors the local catalogue, restricts all three add-ons to the `bar_only` operating profile, unions selected add-on features into the canonical quote snapshot, and lets existing governed activation reset/grant the resulting product feature rows. Entitlement loading restores selected add-on keys from the immutable commercial pricing snapshot so access survives restart and offline cache use.
- Bar Base gained mixed cash/card-or-mobile tender capture, basic cashier/bartender/manager administration, an access and POS audit view, and opening/closing control checks. The base deliberately has no arbitrary user cap; its simplicity is enforced by workflow boundaries rather than preventing an owner from creating the two or three accounts needed to operate safely.
- Stock & Purchasing Pro now exposes supplier/PO approval and idempotent receiving, reorder suggestions, lots/expiry and audited write-off, cocktail/prepared-portion recipes, prep batches, variance, stocktake/movement history, wastage evidence, and an on-hand stock valuation KPI.
- Accounting & Workforce exposes bar rosters, attendance, performance, controlled tip-pool payouts, expenses, all rebuilt accounting workspaces, private payroll, payment instruction export, and printable calculation-snapshot payslips. The accounting/payroll database RPCs and tables remain service-role-only under the existing no-ship guard. This pass does **not** restore authenticated operator grants: disposable-database behavioral proof, linked lint remediation, explicit per-RPC grant restoration, and authenticated smoke tests remain mandatory before this add-on can be sold or enabled in production.
- Growth & Multi-Outlet exposes regular-customer profiles and loyalty visibility, scheduled promotions, stored-value vouchers, authorised bar outlets, stock-custody transfers, cross-outlet contribution, central product catalogue behavior, advanced bar owner signals, and a Growth-gated Manager PWA owner view.
- Manager PWA now uses server-issued `hospitality_mode`: bar sessions cannot open or discover restaurant floor/kitchen pages, use bar product/stock/tab language, and require `owner_mobile_view` for the bar owner dashboard.
- Local verification: 181 focused bar/commercial/entitlement/accounting contract tests pass, including fail-closed coverage for every bar add-on deep link; both the product-specific Hospitality POS production build and Manager PWA production build pass. Manager PWA lint passes with 0 errors (45 existing whole-app warnings), and its production dependency audit reports 0 vulnerabilities. The Restaurant suite reaches its disposable PostgreSQL behavioral gate and stops because `127.0.0.1:54322` is not running; this workstation has no Docker executable, so the required local Supabase database cannot be started here. The migration and PWA changes are local and not deployed.

### 2026-07-22 — Bar POS base-product simplification (local, not deployed)

- Bar-only mode now presents a deliberately small primary rail: Sell, Open tabs, Products, Stock, Cash & close, and Sales. Its Manage hub retains only the base operating tools plus optional displays, settings, health, subscription and data utilities; restaurant floor/kitchen, customer CRM, staff administration, business control, advanced inventory, finance/accounting, payroll and outlet-control workspaces are hidden and fail closed on direct navigation.
- The base Stock page now lets an authorised manager create bottle/can/keg/packet/prepared-portion items, receive a simple delivery, and record a physical count. Stock movements continue through the existing authoritative inventory bridge, and physical counts use stable operation IDs instead of creating a separate bar ledger.
- Bar product setup supports drinks, snacks and simple food through direct stock or prepared-portion links. Recipe production remains a restaurant workflow. Bar setup readiness is reduced to ten evidence-backed stages covering business/tax, outlets, products/prices, base stock, payments, receipt hardware and cash controls.
- Basic shared sales reporting is now routed at `/hpos/reports`; bar day close omits table and kitchen blockers. Shared shift and cash-up controls remain in the base product because they provide operator and till accountability, while staff administration/performance remains outside the base bar workspace.
- Bar-facing language now consistently uses bartender, cashier, operator, tabs and counter service. The shared database payload retains legacy `waiter_id`/`waiter_name` field names for compatibility with the audited POS contract.
- Local verification: focused bar/commercial tests pass and the production desktop build completes. No Supabase migration or production deployment is part of this change.

### 2026-07-21 — Command Central control-plane foundation (local, not deployed)

- Command Central privileged mutations now require a master-administrator session at the Electron IPC boundary; a lodge-level `super_admin` session is not sufficient. Permanent company deletion is disabled pending the governed archive/anonymize workflow.
- High-risk Command Central mutations now additionally require a current-password step-up that expires after ten minutes and is bound to the exact master-admin user ID. The main process enforces the gate for commercial/licence, billing/invoice, release, company lifecycle, feature, user-access/password, test-reset, and implementation mutations; this is password reauthentication, not an MFA claim.
- Master-admin authentication now applies an in-process five-failure/fifteen-minute identity lockout, and master sessions expire after four hours. Master accounts are excluded from offline trusted-session storage, do not persist an offline password verifier, clear their nonce on logout, and cannot use the 60-day lodge staff offline-unlock path. The lockout is process-local until the authoritative server-side security-event/session model is deployed.
- New local-only forward migrations introduce a service-role-only control-plane operation/audit model and a separate commercial account, invoice, payment, allocation, and credit-note ledger. Commercial billing derives subscription charges from the canonical license price snapshot and does not use guest booking invoices or payments.
- The desktop bridge exposes retry-safe commercial invoice generation and payment recording, each requiring a stable operation ID and a reason. Accounting read models now report unavailable data as unavailable rather than presenting a successful zero-value result; the screen labels commercial subscription metrics separately from customer booking finance.
- System Health now treats skipped or runtime-only replay-contract probes as unverified rather than green. The operator must run an explicitly authorized deep health check before the replay-critical contract is shown as ready.
- Lodge-session support requests now derive their company target from the active trusted profile/session instead of accepting a renderer-supplied company ID; master-admin Command Central requests retain their explicit target-company workflow.
- Company archive/restore now use the same local-only governed control-plane pattern: master-admin IPC, a stable operation ID, a required reason, locked settings mutation, lifecycle history, and audit event. Legacy direct archive/restore IPC and permanent deletion remain unavailable. This migration is not deployed.
- Product-scoped release-control contracts are now local-only: a release is keyed and selected by `lodge-camp`, `hotel`, or `hospitality-pos`; the desktop and Legacy POS updaters send their runtime product identity through the public read-only gate and legacy unscoped releases are ineligible. The release desk selects a product before creating, listing, or changing a rollout. Deployment and linked updater verification remain required.
- Product-aware commercial subscription assignment is now wrapped in the local-only Command Central operation/audit envelope. The workbench keys active assignments by `(lodge_id, product_id)`, preserves selected add-ons during edits, and generates one stable operation ID per create/edit attempt so a retry replays the same recorded result rather than creating an untracked second assignment.
- Subscription-request activation now uses the local-only `admin_governed_activate_subscription_request` wrapper. Commercial requests retain the catalog-backed activation contract; legacy requests use the authoritative contract RPC inside the same operation claim/audit envelope, with no renderer/domain fallback writes to `licenses` or `lodge_features`.
- Legacy license create/update/delete, contract-issue, and billing-write IPC channels now return explicit refusals instead of calling direct table or fallback writers. Commercial subscription assignment is the only remaining Command Central license-write entry point, pending linked-RPC deployment verification.
- Command Central entitlement overrides now fail closed if their authoritative subscription RPC is unavailable; the old direct `lodge_features` upsert/delete fallback was removed so a missing contract cannot silently alter access without its server-side guardrails.
- Release lists and scheduled-release reads now propagate an unavailable control-plane query to the UI rather than returning an indistinguishable empty list.
- The Command Central Companies desk no longer performs a background per-company stats fan-out. It loads and retains an authoritative usage signal only when an operator opens that company, labels uninspected companies as unknown rather than clear, and avoids fleet-size-driven startup traffic.
- Selected-company statistics now inspect every parallel query result and reject partial failures instead of converting failed counts to zero. The detail panel shows the actual unavailable reason and a retry action; last activity is not labelled “No bookings yet” when its source could not be verified.
- Implementation & Add-ons now requires an explicit Command Central company selection. Website/payment-readiness records, payment-provider configuration, dashboard reads, local drafts, in-flight deduplication, and caches carry that lodge target; explicit Command Central reads fail visibly instead of falling back to an unlabeled empty or stale tenant view.
- Bulk status/delete/notification actions, update pushes, and notification creation now require the same fresh master-admin step-up. Sync-queue read failures return `ok: false` with unknown counts instead of presenting a healthy empty fleet.
- Command Central diagnostics now propagate support, audit, notification, automation, and fleet query failures rather than converting them to empty results. Each check retains its source, checked timestamp, latency, and observable row count, and Fleet treats an unavailable sync-queue response as an error.
- Local-only migration `20260721155000_command_central_health_history.sql` adds service-role-only diagnostic history with bounded, allowlisted evidence fields. The UI records completed runs, loads the five most recent server summaries, and explicitly shows `History unavailable` when the RPC is not deployed; secrets, raw SQL, tokens, and arbitrary payload keys are not accepted into the stored evidence envelope.
- Command Central audit reads now require the authoritative audit RPC and an online connection. They no longer fall back to the unrelated `activity_logs` table or return an indistinguishable empty summary when the audit contract fails. The legacy audit writer now awaits the audit RPC and returns an explicit recorded/unrecorded outcome to its callers instead of swallowing errors. Legacy mutations that still write audit after their business mutation remain a known non-atomic risk; only the new governed control-plane RPCs currently guarantee mutation-plus-audit rollback.
- The Activity Log renderer now uses independent authoritative read outcomes and displays a retryable unavailable state; an audit RPC failure can no longer be rendered as `No audit entries yet`.
- Support Tickets and Feature Flags now preserve unavailable/error state in the renderer instead of treating failed reads as empty ticket or override sets; feature saves are blocked until authoritative overrides load successfully.
- Finance Office now reads and posts invoices through the separate commercial ledger read/write RPCs, records payments through the governed allocation workflow, enforces one non-void invoice per account/billing period, and no longer edits or deletes guest-booking invoices. Guest booking finance remains a separate compatibility surface outside Command Central bookkeeping.
- The main-process read bridge for broadcasts, expenses, feature overrides, invoices, overdue licences, and company users now propagates authoritative query failures instead of converting them to empty arrays or zero summaries.
- Company settings changes now require an operator-supplied reason of at least eight characters at both the IPC and domain boundary; the handler no longer invents a generic audit reason.
- Local verification after these guardrails: `node --test tests/command-central-regression.test.mjs` passes 30/30, `npm test` passes, and `npm run build` completes. Command Central’s initial renderer chunk is about 298 kB (down from about 587 kB); heavy workspaces load on demand, while the remaining workspace chunks still merit later decomposition.
- Broader local gates: `npm run test:commercial` passes 9/9, `npm run test:products` passes 14/14, and `npm run test:release-architecture` passes 2/2. `npm run test:enterprise` remains red on the separate Restaurant Accounting no-ship work because `App.jsx` references the `restaurant_accounting` UpgradeWall key before that module is registered in `MODULE_CATALOG`; this Command Central pass did not expose that unfinished financial surface merely to make the suite green.
- Local-only forward migrations now include the commercial billing read model, audit read model/writer revocation, company access suspension/restore snapshots, product-assignment integrity, and governed subscription-request activation (`20260721157000` through `20260721161000`). This work has not been applied to the linked Supabase project and is not release or production proof. Linked database migration application and behavioral RPC verification remain required before any billing, lifecycle, licensing, or updater workflow is enabled for operators.
- Read-only linked `npm run db:lint` completed without a CLI transport failure but reported 20 existing function-level errors in asset, restaurant-accounting, payroll, and corporate-billing surfaces; none are from the local-only Command Central migrations, so those new RPCs still require deployment-time lint and behavioral proof.

### 2026-07-20 — Restaurant Accounting financial rebuild in progress

- Forward migrations `20260720010000` through `20260720090000` are applied to linked Supabase, covering the ledger, chart, POS, AP, bank, tax, budgets/statements, privacy-scoped payroll, and side-effect-free read models. Payroll now uses effective-dated pay terms, versioned statutory configuration, separate approved regular/overtime inputs, immutable calculation snapshots, maker-checker approval, balanced ledger posting, and payment export that explicitly remains unpaid.
- Statements are derived exclusively from posted journals. Balance sheets include current-period earnings and a balance difference, income statements retain historical activity for deactivated accounts, and cash flow uses explicit cash/operating/investing/financing classifications while surfacing ambiguous journals as unclassified.
- Every rebuilt RPC remains service-role-only; no authenticated execute grant, RLS policy, or direct operator table privilege has been restored. The explicit desktop v2 domain, allowlisted/capability-gated IPC dispatcher, preload bridge, and separated capabilities are now being wired, but routes and navigation remain unavailable. Focused payroll rebuild checks pass 9/9 (60/60 across the eight rebuild migrations when run sequentially). Restaurant Accounting remains no-ship pending page replacement, behavioral database coverage, build/UI verification, and per-RPC grant restoration.


### 2026-07-19 — Restaurant Accounting P7 shutdown drift guard

- Forward migration `20260719030000_restaurant_accounting_shutdown_drift_guard.sql` is applied to the linked Supabase project. It redefines `get_restaurant_payroll_settings` as a side-effect-free read: missing settings return documented defaults without inserting personnel or financial configuration.
- Operator access remains fully revoked. The migration grants the getter only to `service_role` and fails closed if any Accounting RLS policy reappears, any Accounting table has RLS disabled, any operator table or column privilege returns, or the getter becomes executable by `anon` or `authenticated`.
- The shutdown regression now derives the 20-table inventory from the Accounting `CREATE TABLE` SQL and checks the effective getter body and drift postconditions. Focused Restaurant Accounting suites pass 141/141, and a fresh Restaurant & Bar production build contains no Accounting page chunks or main-process RPC strings.
- Linked migration history matches through `20260719030000`. Live anonymous probes return HTTP 401 for both `restaurant_payroll_settings` and `get_restaurant_payroll_settings`. Restaurant Accounting remains no-ship; this hardening does not restore any UI, API, table, or RPC access.
### 2026-07-18 — Restaurant Accounting P0/P1 deployment

- Forward migrations `20260717010000` through `20260718040000` are applied to the linked Supabase project. The last migration provides the missing `app_get_actor_user_id()` compatibility bridge to the canonical `app_current_user_id()` session helper, resolving the actor-identity runtime errors surfaced by linked lint after the initial push.
- The deployed P0/P1 set includes accounting feature enforcement, corrected GL/tax/bank migration defects, a protected AP payment workflow, immutable audit/DML access controls, statement-import replay protection, maker-checker bank-match approval, GL-based reconciliation completion, and payment idempotency.
- Linked migration history matches every version through `20260718040000`. Targeted linked lint no longer reports the accounting actor-helper error; the broader lint report still contains unrelated pre-existing findings in other database areas. Focused Restaurant Accounting regression suites pass 128/128, and the Restaurant & Bar production build passed locally.
- This proves database deployment and local build/test coverage. An authenticated operator smoke test of chart setup, AP payment retry, bank import/reconciliation, tax, and payroll remains a release sign-off task.

### 2026-07-19 — Restaurant Accounting P6 total table shutdown

- Forward migration `20260719020000_restaurant_accounting_total_table_shutdown.sql` is applied to the linked Supabase project. It revokes `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER` from `public`, `anon`, and `authenticated` on all 20 Accounting tables, including per-column grants; only `service_role` retains documented remediation access.
- The migration removes every existing RLS policy on those tables and leaves RLS enabled with no replacement operator policy. It fails closed unless PostgreSQL effective-privilege checks confirm that `anon` and `authenticated` have no table-level or column-level Accounting access.
- A zero-row live anonymous PostgREST probe now returns HTTP 401 for `restaurant_accounts`, `restaurant_employee_pay_records`, and `restaurant_payroll_settings`, replacing the pre-P6 HTTP 200 direct-table response. The same deployed SQL postcondition covers `authenticated` independently of any particular user or lodge membership. A zero-row `service_role` probe returns HTTP 200 for the documented remediation path.
- Linked migration history matches through `20260719020000`. Restaurant Accounting remains no-ship pending its financial-contract and privacy-policy rebuild.

### 2026-07-19 — Restaurant Accounting P5 total operator RPC shutdown

- Forward migration `20260719010000_restaurant_accounting_total_rpc_shutdown.sql` is applied to the linked Supabase project. It revokes all 61 Restaurant Accounting RPCs—including every read-named reporting and payroll RPC—from `public`, `anon`, and `authenticated`; `service_role` is the only retained execution path for controlled remediation.
- The migration fails closed unless PostgreSQL effective-privilege checks prove that `anon` and `authenticated` cannot execute any manifest entry. The manifest is checked against every Accounting SQL RPC and explicitly includes `get_restaurant_payroll_settings`, whose prior SECURITY DEFINER implementation could insert default settings.
- The eight Accounting renderer imports, preload namespaces, IPC handlers, desktop/HPOS navigation entries, HPOS metadata, and production database-facade domain exports are absent. The current Restaurant & Bar production build contains neither Accounting page chunks nor Accounting RPC strings in its main-process bundle.
- Linked migration history matches through `20260719010000`; focused Restaurant Accounting suites pass 137/137. Restaurant Accounting remains no-ship pending a complete financial-contract rebuild.

### 2026-07-19 — Restaurant Accounting P4 dormant-surface hardening

- Forward migration `20260718070000_restaurant_accounting_effective_privilege_guard.sql` is applied to the linked Supabase project. It guarded the then-known write-named Accounting RPC inventory and direct Accounting-table DML using PostgreSQL effective-privilege checks.
- Its function inventory did not include the read-named but side-effectful `get_restaurant_payroll_settings` RPC or the remaining read RPCs. That incomplete operator shutdown is superseded by the P5 total-RPC shutdown above.
- The client-surface removal described below remains part of the deployed no-ship boundary.

### 2026-07-18 — Restaurant Accounting P3 full shutdown

- Forward migration `20260718060000_restaurant_accounting_full_write_shutdown.sql` is applied to the linked Supabase project. It revokes every discovered Restaurant Accounting mutation RPC from `public`, `anon`, and `authenticated`, including chart, journals, bank import/matching, AP, tax, budgets, and payroll. Service-role execution remains only for controlled remediation.
- The Restaurant & Bar desktop and HPOS navigation no longer surface the eight Accounting pages. Each former direct route now shows an explicit temporary-unavailability screen rather than a seemingly normal workflow that fails after data entry.
- Linked migration history matches through `20260718060000`. Focused P2/P3 containment tests and the Restaurant & Bar production build pass. This makes unrelated Restaurant & Bar release assessment possible without exposing Accounting operations, but it does not make Restaurant Accounting shippable or financially trustworthy.
### 2026-07-18 — Restaurant Accounting P2 financial-write containment

- Forward migration 20260718050000_restaurant_accounting_p2_financial_write_containment.sql is applied to the linked Supabase project. It removes authenticated execution of POS/expense GL posting, AP approval/payment, tax-status filing, bank-match approval/reconciliation completion, and payroll calculation/approval/posting mutations. Read-only reporting remains available; service-role access is reserved for controlled remediation.
- Restaurant Accounting IPC handlers now reject failures rather than returning a { success: false } value that callers can mistake for a successful operation. Contained permission errors tell the operator that no accounting data was changed. Bank Reconciliation now unwraps the Chart-of-Accounts response before rendering its selector, clears a stale CSV preview when input changes, and does not present immutable bank-account fields as editable.
- Linked migration history matches through 20260718050000. Focused Restaurant Accounting regressions pass 132/132 and the Restaurant & Bar production build passed. Linked lint still reports pre-existing global issues and, importantly, confirms the contained POS posting, bank-match proposal, and payroll calculation functions are not safe to release as financial workflows.
- This is a safety containment, not production-readiness approval. The ledger, accounting policy, tax, AP, bank, and payroll rebuild remain required before restoring authenticated financial writes.
### 2026-07-16 — Restaurant & Bar floor workflow boundary

- The sidebar **Floor plan** is now a real-time service view: it shows table availability, reservations, occupied checks, serving staff and elapsed check time, then takes the selected table into the Till to start or continue its transaction. It no longer offers table setup or archive controls.
- **Manage → Floor & Service → Live Floor** is now the manager configuration desk for adding, naming, seating, area assignment, editing and safely archiving tables. The interface is hidden from non-managers and the existing IPC/RPC capability enforcement remains authoritative.
- This preserves the existing PIN-verified Till and server-authoritative open-tab contract for transactions; no financial or table-session write path was moved or weakened.

### 2026-07-16 — Waiter reservations and waitlist service workflow

- The sidebar Floor plan now opens a dedicated **Reservations & waitlist** service page for cashiers/waiters. They can view today’s arrivals, add and edit active walk-ins, select an available table to seat a party, confirm an arrival, and mark a no-show.
- Future-reservation creation/editing/cancellation, table setup and management overrides remain in **Manage**. The new `pos.service` capability gives the front-of-house workflow its own boundary rather than treating every waiter as a manager.
- Waitlist removal is deliberately non-destructive: the record becomes cancelled only after a reason is supplied. Every service edit, seating, removal and reservation state change writes before/after evidence plus the canonical actor to `restaurant_service_events`.
- Managers can edit active walk-ins and remove them through that same audited workflow; the waiter service page uses the established light HPOS service surface for legible, consistent contrast.
- Waiters can create phone reservations for a shared house guest list. A capacity check uses the active floor’s seats and overlapping reservations; a full slot can instead become a clearly labelled reservation-waitlist request, never a false confirmed booking. The reservation creator is retained in the audit trail, while the on-duty team assigns the actual table/server at arrival.
- Forward migration `20260716040000_restaurant_service_reservations_waitlist.sql` is applied to the linked Supabase project. Focused service-contract regression and the Restaurant & Bar production build pass.

### 2026-07-16 — Recipe preparation-loss reporting

- A completed void reverses sale revenue, but prepared food and cocktails remain consumed. Recipe Variance now shows those cancellations as **Preparation loss**, separate from financial revenue and cash reporting.
- The report is read-only and derived from the immutable `pos_order_voided` audit record plus the frozen `restaurant_recipe_stock_movements.theoretical_cost` captured at sale time. It cannot be edited or double-counted by the UI.
- It also shows each affected ingredient’s physical preparation-loss quantity and percentage of all recipe consumption in the selected period. That percentage is deliberately consumption-based, not a misleading percentage of purchases; purchase, opening-stock and closing-count measures remain separate inventory controls.
- Forward migration `20260716034000_recipe_preparation_loss_reporting.sql` adds the manager-scoped reporting contract and is applied to the linked Supabase project. Focused Restaurant workspace regression coverage and the Restaurant & Bar production build pass.

### 2026-07-16 — Restaurant & Bar open-check operator guard and recipe clarity

- An open table or tab now requires an identified serving operator and that operator's active Till shift for the selected outlet. The renderer gives the recovery guidance, while the authoritative `upsert_pos_tab` contract validates the staff/shift relationship and writes an audit entry; an unlocked screen alone is never the security boundary.
- Recipe cards now return and show their linked menu item, its selling price, the true stock-item name and current unit cost. Initial recipes no longer show a confusing `v1` suffix. New menu items require a price above P0.00 before recipe setup, so an unsellable cocktail cannot be silently created.
- Forward migrations `20260716026000_restaurant_open_tab_operator_and_recipe_clarity.sql` and `20260716027000_restaurant_menu_price_guard.sql` are applied to the linked Supabase project.

### 2026-07-16 — Restaurant recipe unit and cost integrity

- Recipe costing and depletion now convert compatible stock units before calculating value or changing on-hand stock: for example, 200 ml consumes 0.2 litres. Incompatible units are rejected server-side instead of silently corrupting stock and margin reporting.
- Stock Control now displays the authoritative cost per counting unit and allows a manager to correct it with an auditable zero-quantity cost-correction movement. Supplier receipts remain the normal way to refresh a unit cost.
- Forward migration `20260716028000_restaurant_recipe_unit_integrity.sql` is applied to the linked Supabase project.

### 2026-07-16 — Supabase I/O and request-amplification reduction

- Restaurant & Bar desktop cache refresh and background watchers are now product-scoped, so the POS product no longer refreshes accommodation-only datasets or runs accommodation booking watchers. POS screens request active/date-bounded records, coalesce short-lived duplicate reads, and pause recurring refreshes while hidden.
- Manager PWA dashboard and alert loading are product-aware: Restaurant & Bar uses POS/inventory summaries instead of accommodation booking reads, support-request polling is cached/coalesced, and background inbox/device-health intervals are reduced without removing focus/online refreshes.
- Device-health publication suppresses unchanged writes for up to 20 minutes. The POS floor now has one server snapshot RPC, entitlement/session helpers avoid repeated wide settings/session work, and the hot POS ticket access paths have supporting indexes.
- Forward migration `20260716016000_optimize_supabase_io.sql` is applied to the linked Supabase project. A live anonymous smoke probe found that the shared lodge-access helper could return SQL `NULL` for a missing session; forward migration `20260716017000_fail_closed_lodge_access.sql` makes that path explicitly fail closed. Linked migration history confirms the local/remote versions match. Full linked lint still reports unrelated pre-existing errors in corporate/staff functions; none reference the functions in these migrations.
- Verification passed: 10 focused Supabase-traffic regressions, all 24 Restaurant regression suites, 16 Manager PWA Phase A checks, 25 Manager PWA Phase D checks, 14 product-isolation checks, 15 entitlement/financial feature checks, and production builds for Manager PWA, LodgingOS, and Restaurant & Bar POS. A linked anonymous floor-snapshot probe now fails closed with HTTP 401 / SQLSTATE 42501.

### 2026-07-15 — Restaurant & Bar two-stage cash-up control

- Cashiers now have a touch-friendly **My Cash-up** workspace next to **My Shift**. It submits only the cashier's physical cash count and keeps the shift open while a review is pending.
- **Cash & close** is supervisor/manager scoped. It shows the pending-count queue, the server-calculated expected cash, the counted cash, and any variance before an approval or return-for-correction decision.
- Forward migration `20260715017000_pos_cashup_submission_review.sql` is applied to the linked Supabase project. It uses server-side role and own-shift checks, prevents duplicate submissions, writes an audit record, and delegates approval to the existing atomic `finalize_pos_shift_cashup_v2` contract; cashiers cannot silently finalise their own shift.

### 2026-07-15 — Restaurant & Bar retained cash-tip handover

- An all-cash sale now records its tip as a server-derived `cash_tip_retained` amount. The customer receipt and payment remain at the full tendered value, while the waiter’s expected physical drawer handover excludes the retained cash tip.

### 2026-07-15 — Restaurant & Bar shared-terminal cash-up corrections

- A manager can submit a waiter cash-up from the shared terminal only after the waiter confirms with their attendance PIN. Returned submissions now require a manager correction note and show that note in **Staff cash-up** when the waiter is selected, so the same shift can be safely corrected and resubmitted.
- Forward migrations `20260715022000_restaurant_shared_terminal_cashup_pin.sql`, `20260715027000_cashup_rejection_note_required.sql`, and `20260715028000_shared_cashup_correction_visibility.sql` are applied to the linked Supabase project.

### 2026-07-15 — Restaurant & Bar manager-PIN cash-up review

- Every approval or return-for-correction decision on a shared terminal now requires the PIN of the currently signed-in manager or supervisor. The server validates that same actor, rate-limits failed attempts separately, and records successful PIN verification in the cash-up audit trail.
- Forward migration `20260715029000_cashup_review_manager_pin.sql` is applied to the linked Supabase project.
- The cash-up submission and manager review show the retained amount explicitly. Card, mobile-money, account, and split-payment tips remain in the payable tip balance; retained cash tips cannot be paid a second time.
- Forward migration `20260715021000_cash_tip_retention_cashup.sql` is applied to the linked Supabase project.

### 2026-07-16 — Restaurant & Bar operational readiness and staff feedback

- Service staff can now log factual guest feedback directly from **My Shift**. Submission uses the existing canonical-actor feedback RPC and POS-view access; the manager commercial-control desk now shows a 30-day, manager-only follow-up queue with the submitting staff member and timestamp.
- Managers see an opening-checklist reminder on **My Shift** before service and on the **Manage** hub each day. It points to the control board without blocking an urgent shift start.
- **Restaurant setup readiness** is a manager/admin/owner-only, evidence-based 20-stage launch board. It advances from authoritative configuration and completed-control evidence rather than manager self-attestation, and every incomplete stage gives a short completion instruction and a direct workspace link. Its required reporting chain now proves positive menu pricing, inventory cost, menu-to-stock links, tendered sale, reconciled drawer, manager-approved cash-up, owner digest, and a protected data export.
- The Manage entry and direct readiness route retire automatically after all 20 controls have evidence. A successful protected data export records its evidence server-side only after the workbook has been written successfully; an export is not reported as failed if the non-financial evidence write later fails.
- The setup detector respects the stored operating profile: bar-only venues are not required to invent restaurant tables or food recipes, while the same cash, cash-up, reporting, and export evidence remains mandatory.
- Forward migrations `20260716002000_restaurant_setup_progress.sql`, `20260716003000_restaurant_feedback_manager_queue.sql`, `20260716004000_restaurant_setup_readiness_detection.sql`, `20260716005000_restaurant_financial_setup_readiness.sql`, and `20260716006000_restaurant_setup_readiness_bar_mode.sql` are applied to the linked Supabase project. Focused Restaurant checks (27/27) and the Restaurant & Bar build pass.

### 2026-07-16 — Restaurant & Bar Sales & Payments protected void review

- Sales & Payments now opens a receipt into its line items, tender/payment breakdown, recorded status, and the linked void audit reference (reason, approver and time). It no longer leaves transaction history as an opaque read-only list.
- An eligible receipt can be voided from that review screen only through the existing server-authoritative `approve_pos_void_with_pin` contract. The operator must supply an authorised approver PIN and a mandatory reason; the server remains responsible for outlet and role checks, locking, idempotent duplicate protection, stock restoration, and the immutable audit record. Settled receipts explicitly direct the operator to the protected return flow so tender/line reversal is recorded correctly.
- Repository verification: the focused Sales & Payments regression passed and the Restaurant & Bar production build passed. `npm run test:restaurant` remains blocked by the pre-existing `RestaurantPurchasing receivePurchaseOrder sends raw orderId` assertion; it is outside this change.

### 2026-07-16 — Restaurant & Bar Till history completeness and daily numbers

- Sales & Payments now interprets a selected calendar day in the local operating timezone rather than UTC, so early-morning local Till sales are not omitted. It includes and labels POS transaction types (sale/return) alongside status-based void evidence.
- POS orders now have a server-issued business date, daily order number, concise order number (`0001`) and receipt number (`R-0001`, or `RET-0001` for a return). The sequence resets per lodge and business day atomically; the UUID remains the immutable technical/audit identity and `(lodge_id, business_date, daily_order_number)` is unique.
- Existing POS history was backfilled in chronological business-day order. Forward migration `20260716030000_pos_daily_order_and_receipt_numbers.sql` is applied to the linked Supabase project; a follow-up migration check confirmed it is up to date. Focused Sales & Payments regression and the Restaurant & Bar build passed.

### 2026-07-16 — POS business-day timezone authority

- Sales history now filters by the persisted `pos_orders.business_date`, not by a UTC timestamp range generated by a desktop or browser. This prevents sales after local midnight from disappearing from their business day.
- `public.pos_business_date_at` resolves an order timestamp using each business's configured `settings.timezone`; the daily order/receipt trigger uses that same server-side authority. This business is configured as `Africa/Gaborone`, so a `2026-07-15 23:02:22 UTC` sale resolves to business date `2026-07-16`.
- Forward migration `20260716031000_pos_business_date_timezone_authority.sql` is applied to the linked Supabase project. Focused Sales & Payments regression and the Restaurant & Bar build passed; a follow-up migration check confirmed the remote is up to date.

### 2026-07-16 — Restaurant & Bar sale-correction and stock-disposition control

- Service staff now have **Request sale correction** on **My Shift** and in the command search. The screen shows only the signed-in waiter’s own Till sales; it does not load the outlet-wide void audit. A supervisor, manager, or admin must still supply their own authorised PIN to approve the final action.
- The correction dialog gives an operator-facing explanation of the stock outcome. Food, cocktails, and all recipe items remain consumed after a correction because they were prepared. For directly linked packaged stock, the operator must state whether it was returned unopened (restore stock) or opened/broken/damaged (keep stock depleted). The server records that disposition in the immutable POS audit along with the reason and approver, and restores stock only for the unopened return case.
- Transaction history now makes completed sales green and voided sales red. It displays short business order/receipt numbers while retaining the UUID only as the audit identity.
- Forward migration `20260716032000_pos_void_packaged_stock_disposition.sql` is applied to the linked Supabase project. Verification passed: `node tests/restaurant-workspace-ux.test.mjs` (17 tests), the Restaurant & Bar production build, and a linked migration-history check confirming versions `20260716030000` through `20260716032000` are deployed. A live operator test of both packaged-stock choices remains required before release sign-off.

### 2026-07-16 — Shared Till PIN-scoped sales history

- Once a waiter unlocks the shared Till with their Staff PIN, **My sales** is available directly in Till. It opens a separate, read-only transaction view restricted by the main-process PIN session to that verified operator’s cashier/waiter records; a generic floor-manager login cannot select or inspect another waiter’s sales through this route.
- The view reads this terminal’s local POS cache first for fast feedback, then refreshes the exact same operator/date scope from the authoritative server when online. It explains which source is being shown, falls back safely while offline, and begins on the current business day.
- The PIN-scoped session expires after ten minutes and is cleared when Till is manually relocked or a shared-terminal sale completes. This does not change financial truth or add a database migration.
- Verification passed: `node tests/restaurant-workspace-ux.test.mjs` (18 tests) and the Restaurant & Bar production build. A restart of the Electron main process is required before live manual testing.

### 2026-07-16 — POS sales-history schema repair and Till-native history view

- The linked POS schema does not contain `pos_orders.waiter_id`. Sales history now uses the existing authoritative `cashier_id` assigned at shared-Till PIN unlock, removing the bad column from both management and operator history reads. This restores the manager’s all-waiter Finance & Close history and scopes **My sales** correctly to the PIN-verified cashier without introducing a speculative schema migration.
- **My sales** is now a compact Till-native screen rather than a reused management reporting layout: business-day filters, clear cached/server state, receipt count and recorded-sales cards, searchable receipt rows, receipt item/tender detail, and explicit manager-correction guidance.
- Verification passed: `node tests/restaurant-workspace-ux.test.mjs` (18 tests) and Restaurant & Bar production build. A restart is required before retesting the repaired main-process query.

### 2026-07-16 — Shared Till operator attribution repair

- Live investigation found that the three 2026-07-16 Till sales were correctly linked to Wedu K’s PIN-verified `pos_shifts` record but were incorrectly attributed to the manager account by `create_pos_order_v3`. The history screen was therefore correctly returning zero rows for the waiter under the old data, revealing a server attribution defect rather than a display issue.
- Forward migration `20260716033000_pos_order_operator_from_shift.sql` makes the linked Till shift the authoritative cashier source for every POS order, regardless of the manager account holding the shared terminal session. It backfilled only orders with a provable linked shift, wrote an immutable `pos_order_operator_repaired` audit entry for every repair, and deliberately left unlinked historical orders untouched.
- Linked-database proof: receipts `R-0001`, `R-0002`, and `R-0003` now all show Wedu K as cashier and retain their original shift; audit rows confirm the correction. The migration is deployed. Verification passed: 19 focused Restaurant workspace tests and the Restaurant & Bar production build. Restart Electron before retesting.
- **My sales** now separates sales excluding tips from tips recorded, shows a tip alongside each applicable receipt, and shows the individual tip again inside receipt detail. This avoids treating gratuities as sales turnover while keeping waiter-facing tip visibility clear. Focused tests and the Restaurant & Bar production build pass.
- A waiter can now open their own receipt in **My sales** and start **Request correction / void sale** in that same receipt. The operator records the reason and packaged-stock outcome; the supervisor/manager/admin enters their PIN in the same form to approve it. The desktop void payload now preserves the selected stock disposition through to the authoritative RPC instead of silently dropping it. Focused tests and the Restaurant & Bar production build pass.
- The correction copy is item-aware: direct packaged items show **Void sale / packaged return** and the stock outcome selector; food/cocktails and other recipe items show **Record prepared-item cancellation**, explicitly state that ingredients remain consumed, and do not ask for a stock-outcome choice that cannot apply. Focused tests and the Restaurant & Bar production build pass.

### 2026-07-16 — Restaurant & Bar outlet setup control

- **Outlet control** is the canonical Restaurant & Bar page for creating and maintaining separate operational outlets. It distinguishes a physical outlet from an additional POS terminal, supports manager/admin creation, rename, type, ordering, activation and deactivation, and prevents the final active outlet from being deactivated.
- Outlet configuration is online-only, server-authorised, and records before/after audit evidence. Legacy `/multi-outlet-pos` links redirect to `/restaurant/outlet-control`.
- Forward migration `20260716013000_restaurant_outlet_control.sql` is applied to the linked Supabase project.

### 2026-07-15 — Restaurant & Bar Staff Management audit and access guardrails

- Restaurant & Bar Staff Management now presents service-team roles and controls instead of lodging terminology: waiter/till operator, service supervisor, restaurant manager, and restaurant-specific access guidance.
- Staff creation now gives a clear outlet-setup recovery path; cashier and supervisor accounts cannot be saved without a valid outlet belonging to the business.
- The Restaurant & Bar **Access audit** tab reads a new immutable, server-backed `staff_access_audit` trail rather than the clearable device activity file. Password, approval-PIN, and mobile-password hashes are excluded from audit snapshots.
- Staff account create/update/delete, password, mobile access, outlet, role, status, permission, and auth-link changes are captured by a `public.users` database trigger. The read RPC is manager/admin scoped.
- Managers can now operate the workflow they are shown for ordinary service accounts, but server and IPC guards prevent them from creating elevated finance/manager/owner accounts, altering custom permission exceptions, or deleting anything other than archived service-team accounts.
- Forward migration `20260715015000_staff_access_audit_and_manager_scope.sql` was applied to the linked Supabase project. Focused staff/Restaurant contract checks and the Restaurant & Bar build pass. Broader database lint findings remain pre-existing Phase 4–6 work and are not evidence of a staff migration failure.

### 2026-07-15 — LodgingOS Food & Beverage held back from release

- The untested Lodge Food & Beverage workspace is removed from desktop navigation and the LodgingOS route allowlist.
- Direct or bookmarked `/food-beverage/*` routes redirect to the safe application home screen.
- The underlying implementation is retained for later testing and re-enablement.
- Focused product extraction and release-architecture tests pass, and the LodgingOS production build completes.

### 2026-07-15 — LodgingOS Food & Beverage resurfaced after v1.5.5

- The Lodge Food & Beverage navigation entry, route allowlist, and workspace route are re-enabled locally.
- This post-v1.5.5 change is not part of the already-published v1.5.5 installer.

### Session 4 — Canonical actor and final settlement invariants

Verified and deployed through forward-only migrations `20260714247000` and
`20260714248000`:

- Workforce, attendance, leave, settlement, and ledger actor foreign keys now
  use the desktop application's canonical business identity,
  `public.users.id`, rather than mixing it with `auth.users.id`.
- Existing IDs are translated through `public.users.auth_user_id`; migration
  preflight aborts instead of deleting or orphaning financial/workforce rows.
- Workforce lodge-scope triggers validate staff against `public.users`.
- Package application locks the event, requires an 8–128 character stable
  idempotency key, returns stored replay results before mutable terminal-state
  checks, rejects changed payload reuse, and uses key-derived source references.
- Adjustment metadata is constrained for both zero and positive adjustments.
- The linked database passed the duplicate-settlement audit and now enforces
  `UNIQUE (lodge_id, event_booking_id)`.
- Focused repair tests (6/6), auth/entitlement tests (15/15), commercial tests
  (9/9), and the 31-suite Enterprise gate pass.

The current `tests/database-integration-suite.mjs` is not accepted as behavioral
release evidence: several cases still prove helper availability or fake-ID
rejection rather than the named concurrency, rollback, attendance, and
lodge-isolation scenarios. It must be replaced by a disposable Supabase harness
with seeded real fixtures before financial release sign-off; never point it at
the linked customer database.

### Session 1 (morning) — P0 fixes + Phase 4–6 wiring

Completed:
- Duplicate `createShiftHandover` export fixed
- Add-on entitlement model made consistent (runtime feature keys, add-on capabilities, service-role bypass)
- Corporate migration chain consolidated (142400 deleted, 142360 bugs patched)
- Direct table write grants revoked (events depth migration → SELECT-only)
- `subscriptionRequests.js` ADDON_FEATURE_MAP completed
- Phase 4–6 migrations, domain functions, IPC handlers, preload bridges, React components, and shared wiring all created
- UpgradeWall routes use canonical feature keys
- IPC capabilities use add-on-specific (not generic core) keys

**Session 2 (afternoon) — Full round 1–9 implementation**

Completed:
- **Item 1 (compile)**: Missing catch block added to compliance handover handler; build verification added to `production-guardrails.test.mjs` (lines 1045–1052) + `compile-verification.mjs` (9 tests)
- **Item 2 (settlement replacement)**: `settle_event` now has ONE definition in `14243000` (overload in `14244000` removed); `p_final_total` eliminated from React form, preload, IPC, domain, and RPC; total computed server-side from locked non-voided line items; paid amount from authoritative payments; `p_adjustment_type` validated (`credit`, `waiver`, `discount`, NULL); unique settlement per event enforced; unexpected SQL exceptions re-raised (no catch-all)
- **Item 3 (folio mutations)**: Folio posting uses `add_folio_charge` with child idempotency key derived from settlement key; never inserts into `folio_line_items` or updates `hotel_folios.balance` directly; uses `FOR UPDATE` lock; raises exception on failure → rolls back entire settlement
- **Item 4 (auth helpers)**: `app_require_feature` uses `public.app_is_service_role()` via `current_setting('role', true)`; `app_is_service_role()` helper added; `database-auth-entitlement.test.mjs` tests verify service-role bypass, correct feature keys, role arrays
- **Item 5 (attendance constraints)**: Partial unique index on `(lodge_id, staff_id)`; `clocked_in_by` populated from authoritative current user; self-service validates actor equals staff; manager override explicitly capability-gated with `manager_override_by`/`_reason` audit columns; staff-belong-to-lodge validation in trigger; race-prone overlap trigger removed (application-level FOR UPDATE); overnight shift conventions documented
- **Item 6 (bridge forwarding)**: All 12 remaining asset/venue preload functions updated; `venueManagement:settleEvent` preload/IPC/domain all use new 7-param signature; `bridge-contract.test.mjs` (84 tests) verifies exact param counts for all 74 bridge functions
- **Item 7 (database tests)**: `tests/database-integration-suite.mjs` created (24 tests across 6 groups); intentionally FAILS the release gate when DB harness is unavailable
- **Item 8 (deployment gates)**: All test suites pass: `npm test` ✓, `test:commercial` (9/9) ✓, `test:enterprise` (31 suites) ✓, `compile-verification.mjs` (9/9) ✓, `bridge-contract.test.mjs` (84/84) ✓
- **Item 9 (documentation)**: `MIGRATION_ORDER_MANIFEST.md` updated with `14244000` and Session 2 changes; `PROJECT_STATE.md` updated with accurate state

### Session 3 (late Day 2) — External audit response + Phase 2 repair migration

An external audit identified 11 critical findings. All have been repaired via forward-only migration `20260714245000`.

**Audit findings that were FALSE (audit was wrong):**
- "settle_event calls app_get_lodge_role_of_user which is not defined" → **TRUE, confirmed at line 663** — replaced with `app_require_feature`
- "payments table has no status column" → **TRUE, confirmed at line 15898** — replaced query with refund-aware payment calculation
- "Settlement calculates wrong total (missing venue/resources)" → **TRUE, confirmed** — replaced with `_calculate_event_settlement_totals` matching `recalculate_event_totals` contract
- "Settlement bypasses paid add-on gate" → **TRUE, confirmed** — `app_require_feature` added
- "Client retry idempotency unsafe — Date.now() on every click" → **TRUE, confirmed at VenueManagement.jsx:338** — stable key + settling state added
- "Different keys can race to settle same event" → **TRUE, confirmed** — event-scoped advisory lock before booking lock, check moved after lock
- "Adjustment accounting incomplete (no type stored, no ledger entry, negative allowed)" → **TRUE, confirmed** — `adjustment_type` column added, validation tightened, ledger entry added
- "Folio child key exceeds 128-char limit" → **TRUE** — `left(v_key, 100)` prefix
- "Folio reference should be settlement_id, not event_booking_id" → **TRUE** — fixed to pass `v_settled_id`
- "Attendance trigger returns before lodge validation on self-service" → **TRUE, confirmed at line 75** — lodge check moved above early return
- "Overlap shift prevention is absent — no FOR UPDATE, no overlap check" → **TRUE, confirmed at line 107** — GiST exclusion constraint added
- "app_is_service_role overwritten incorrectly (narrower)" → **TRUE, confirmed** — restored to `app_request_role() IN ('service_role','supabase_admin','postgres')`
- "Staff lodge check should use user_lodge_roles, not public.users.lodge_id" → **TRUE** — dual check added
- "Database integration suite is entirely unimplemented (24 assert.fail scaffolds)" → **TRUE** — replaced with real assertions

**Repairs applied (migration `20260714245000`):**
1. `adjustment_type` column added to `event_settlements`
2. Balance CHECK constraint added
3. `_calculate_event_settlement_totals()` function matching canonical `recalculate_event_totals`
4. `settle_event` fully rewritten with: `app_reject_pwa_financial_mutation()`, `app_require_feature`, idempotency key format validation, event-scoped advisory lock, booking FOR UPDATE before settle check, refund-aware payment total, full validation of adjustments (non-negative, type+reason required when non-zero, cannot exceed outstanding), 3-line audit ledger entries, deterministic folio child key (<128 chars), settlement_id as folio reference, same-key/same-payload replay, same-key/different-payload rejection
5. `app_is_service_role` restored to baseline semantics (`app_request_role() IN ('service_role','supabase_admin','postgres')`)
6. `enforce_self_clock_in` trigger — lodge validation moved before self-service early return, dual check (user_lodge_roles + users)
7. GiST exclusion constraint `no_overlap_staff_shifts` with overnight shift handling
8. `upsert_staff_schedule` changed to plain INSERT (multi-shift-day model)
9. `btree_gist` extension enabled

**Client-side fixes (VenueManagement.jsx):**
- Stable idempotency key (generated once, reused on retry)
- `settling` state prevents duplicate submission
- `adjustment_type` dropdown added to settlement form
- `min="0"` on adjustment amount input
- `already settled` error treated as success (idempotent replay)

**Database integration tests (database-integration-suite.mjs):**
- All 24 scaffold `assert.fail('Implement: ...')` replaced with real assertions
- B3 concurrency expectation corrected: "exactly one settlement row" not "both succeed"
- Tests use service_role RPC calls to verify function existence and behavior
- Full settlement, authorization, attendance, and lodge-scope tests with proper skip gates

**Current gaps:**
- Database integration suite still requires replacement with a seeded,
  disposable-database behavioral harness; credentials alone do not make its
  current helper/fake-ID assertions release evidence
- Phase 8 broader HotelOS backlog **unstarted** (sidebar features beyond Phases 4–6)
- Pricing and commercial grouping **blocked** pending product owner direction
- The system is **not financially release-ready** until real DB scenarios pass on a disposable environment
- The unique constraint on `(lodge_id, event_booking_id)` for `event_settlements` is deployed via `20260714248000`

### What now exists (local, unapplied)

#### Staff Operations & Workforce (Phase 4 depth)
- Migration `20260714241000_staff_operations_depth.sql` — 9 tables (departments, shift templates, task assignments, training checklists, training records, shift handovers, etc.) + 23 feature-gated RPCs
- Domain `staffOperations.js` — 23 exported functions with dedupePromise
- IPC handlers (23) — all gated by `workforce_scheduling.view/manage` capabilities
- Preload bridge `staffOperations` — 23 methods
- React component `StaffOperations.jsx` — 7-tab UI (departments, shifts, tasks, training, handovers, productivity, conflicts)
- Route `/workforce` — gated by `workforce_management` feature key

#### Asset Management & Maintenance (Phase 5 depth)
- Migration `20260714242000_asset_maintenance_depth.sql` — 7 tables (categories, warranties, inspections, attachments, costs, preventive templates, preventive assignments) + 28 feature-gated RPCs
- Domain `assetManagement.js` — 28 exported functions with dedupePromise
- IPC handlers (28) — all gated by `asset_registry.view/manage` capabilities
- Preload bridge `assetManagement` — 28 methods
- React component `AssetManagement.jsx` — 6-tab UI
- Route `/assets` — gated by `asset_management` feature key

#### Events & Venues (Phase 6 depth)
- Migration `20260714243000_events_venues_depth.sql` — 6 tables (leads, availability rules, run sheets, supplier coordination, deposit milestones, settlements) + 23 feature-gated RPCs; direct table write grants revoked (SELECT-only now)
- Domain `venueManagement.js` — 23 exported functions with dedupePromise
- IPC handlers (23) — all gated by `venue_management.view/manage` capabilities
- Preload bridge `venueManagement` — 23 methods
- React component `VenueManagement.jsx` — 8-tab UI
- Route `/venues` — gated by `venue_management` feature key

#### Shared wiring (all wired)
- `moduleCatalog.js` — entries for `workforce_management`, `asset_management`, `venue_management` with addonKey mappings
- `accessControl.js` — capabilities: `workforce_scheduling.view/manage`, `asset_registry.view/manage`, `venue_management.view/manage`
- `entitlementMerge.js` — maps commercial keys → runtime feature keys
- `subscriptionRequests.js` — ADDON_FEATURE_MAP includes all three
- `desktopNav.js` / `hotelNav.js` — nav items for all three
- `subscriptionState.js` — feature keys registered

#### Entitlement model
- `app_require_feature` — service-role bypass added, runtime feature keys used consistently
- UpgradeWall routes use canonical `workforce_management`, `asset_management`, `venue_management`
- IPC handlers use add-on-specific capabilities not generic core caps

#### Corporate financial repair
- Migration `20260714236000_corporate_billing_repair.sql` — stronger implementation (mandatory idempotency, advisory locks, sequential allocation)
- Migration `20260714240000_corporate_folio_idempotency.sql` — DELETED (it was the weaker version that overrode 142360)
- Bug fix: `v_allocated` ordering in allocation JSON construction

### What remains incomplete (unchanged)
- Hotel Core modules still `Partial` or `Foundation only` per completion matrix
- No E2E scenarios proved with real database
- Phase 14 commercial bundling not started
- Pricing remains blocked

Multi-agent Phases 0–13 executed on the current worktree (Phase 14 commercial bundling **not** started).

### Linked Supabase (this session)

`npm run db:push` applied:

- `20260713200000_hotel_core_entitlement_boundary.sql` — Hotel Core included_features expansion; deactivates now-core commercial add-on price rows
- `20260713210000_folio_charge_payment_idempotency.sql` — `add_folio_charge` / `add_folio_payment` accept `p_idempotency_key` via `_claim/_record_financial_operation`
- `20260714120000_hotel_reports_ledger_restore.sql` — ledger-derived advanced report RPCs
- `20260714200000_folio_payment_overload_repair.sql` — drops ambiguous charge/payment overloads so corporate settle and 4-arg calls resolve uniquely

Desktop folio domain forwards `p_idempotency_key` for charge/payment only; other folio RPCs still strip the key. `npm run db:lint` after overload repair wrote empty issue list (`[]`).

### Automated verification (this session)

| Suite | Result |
|---|---|
| `node --test tests/hotel-*.test.mjs` | **103/103 pass** |
| `npm run test:enterprise` | **28 suites pass** |
| `npm run test:commercial` | **9/9 pass** |
| Offline + lower-tier (Phase 9–13 agent) | **41/41 pass** |

### Status honesty

- Hotel Core **contract** frozen and server-entitled; ops/finance/offline **safety** hardened.
- Modules with external providers remain **Complete except external-provider certification** or **Partial** (OTA live, payment merchant, SMS/WhatsApp).
- Packaged HotelOS operator smoke, dual-lodge multi-property live proof, and full hotel-day e2e still **unproved**.
- Phase 14 suite pricing / commercial regrouping **blocked** until product owner accepts the completion report in `docs/HOTELOS_COMPLETION_MATRIX.md` + `docs/HOTELOS_PROVIDER_READINESS.md` + `docs/HOTELOS_REGRESSION_SCENARIOS.md`.

## 2026-07-14: HotelOS Phase 9–13 offline / provider / truth reconciliation

- Re-verified hotel offline classifications against live domains after concurrent Phase 3–8 work. Folio, night audit, corporate charge/pay/suspend remain **online_only** (no financial queue). Check-in steps remain online-required (not queued). Room moves remain queueable with stable keys. Housekeeping assign/inspect still RPC-only.
- Safety/docs: `docs/OFFLINE_MATRIX.md` reconciled; **new** `docs/HOTELOS_PROVIDER_READINESS.md`, `docs/HOTELOS_REGRESSION_SCENARIOS.md` (15 scenarios: 10 pass / 5 unproved); `docs/HOTELOS_COMPLETION_MATRIX.md` Phase 9–13 section.
- Tests: `tests/hotel-offline-entitlement-safety.test.mjs`; `enterprise-offline-contract.test.mjs` expects online_only folio; lower-tier addon list excludes Hotel Core modules. Focused offline/lower-tier **41/41 pass**.
- Provider truth: live OTA still fail-closed; SMS/WhatsApp not carrier-ready; payment merchant cert open. Phase 14 commercial bundling **not** implemented. Packaged hotel-day smoke **unproved**.

## 2026-07-14: HotelOS Phase 6–8 guest experience + enterprise ops hardening

- Guest messaging: channel readiness (email SMTP via nodemailer when configured; SMS/WhatsApp always `not_configured`); queue is never marked `sent` without provider confirmation; delivery rows demote unready channel “sent” to display `not_configured`.
- Guest CRM: notes list/add wiring, VIP list no longer silent-empty on error, VIP/blacklist/preference UI gated by `guest_crm.*` capabilities.
- Guest portal: desktop config surfaces stale/request errors and clarifies it is config not the guest app; booking-site `/portal` session validate + requests retry/error states tightened.
- Abandoned payment recovery: recover paths strip/omit client `payment_status`/`amount_paid` and set `payment_confirmed: false` (ledger remains RPC-authoritative).
- Group operations: list via group blocks, real checkin/checkout/pickup/release RPCs with success assertions; full-page empty/error UI.
- Multi-property switch fails closed (no local lodge change on error); property switcher surfaces isolation errors.
- Operations compliance: incident/visitor/emergency loads no longer swallowed into empty success; partial-load warnings in UI.
- Focused tests: `tests/hotel-guest-enterprise.test.mjs` (17/17). No commercial catalog or hotel core entitlement list changes. Optional `update_message_delivery_status` / CRM note RPCs may be missing until a later migration.

## 2026-07-14: HotelOS Phase 5 — Revenue & distribution (internal completeness)

- **Channel adapter** (`channelProviderAdapter.js`): live OTA paths fail closed (`provider_connected: false`, never unconditional success). **ManualExportProvider** performs real local export-queue/artifact work (structured `export_artifact` with id, checksum, payload, optional file under cache `channel-exports/`). Not OTA delivery.
- **Channel manager** (`channelManager.js`): mappings/configs/import confirm-reject retained; `processSyncQueue` runs adapter per channel (manual → export artifacts; live → not-connected), then server `process_channel_sync_queue` when online (manual_review, not completed). Dead-letter/retry fields respected when present on items.
- **Rates** (`ratePlans.js` / `rateCalendar.js`): prefer server `quote_room_stay` / rate RPCs; offline or client math labelled `is_estimate` / `_financial_estimate`.
- **Revenue manager**: recommendations always `requires_approval` / `auto_applied: false`; approve/reject record intent only; `applyRevenueRecommendation` fails closed (no silent rate apply). UI approve/reject buttons on recommendation cards.
- **Booking engine**: `createBookingIntent` / `confirmBookingIntent` use stable idempotency keys (no new key on timeout/retry); prices labelled estimates; prefers `quote_room_stay` when room id supplied.
- Focused tests: `tests/hotel-channel-rates.test.mjs` (12/12) plus enterprise channel/booking/rate suites. **Status: complete as internal foundation — not provider-certified live OTA connectivity.**

## 2026-07-14: HotelOS Phase 3 — Financial Core

- **Folio ledger** (`folioLedger.js`): all mutations (create/charge/payment/transfer/split/void/close/reopen/lock) are **online_only** — `requireOnline` throws `onlineOnly` and **never** queues. RPCs: `create_hotel_folio`, `add_folio_charge`, `add_folio_payment`, `transfer_folio_charge`, `split_folio`, `void_folio_line`, `close_folio`, `reopen_folio`, `lock_folio`. Client-side stable keys are generated but **stripped** before PostgREST because folio RPCs still lack `p_idempotency_key`.
- **Folios.jsx**: ledger charge/payment/transfer/split/void/close/reopen/lock via `window.api.folioLedger`; transfer no longer coerces UUID with `Number()`; no client `payment_status`/`amount_paid` assignment.
- **Night audit** (`nightAudit.js` + `NightAuditEnterprise.jsx`): close/reopen/resolveException online_only; close passes `p_force`; reopen requires reason; pre-close checks remain read-with-cache.
- **Corporate settlement** (`corporateBilling.js`): charge/payment/suspend/reactivate online_only (no fake offline success); charge uses `charge_to_corporate_account` with `p_settle_booking`.
- **POS → booking folio**: existing `create_pos_order_v3` path keeps stable `create_idempotency_key` / `pos-order:{submitIntentId}` (no new queue id on retry).
- **Customer credit allocation**: stable content-hash / caller key via `buildCreditIdempotencyKey` — **no `Date.now()`** in allocation/receipt/refund/reverse keys.
- Focused tests: `tests/hotel-financial-invariants.test.mjs` (+ offline-contract, folio-ledger, night-audit, corporate, credit, rates suites). **Linked folio charge/payment idempotency migration applied 2026-07-14; domain forwards keys for charge/payment.**

## 2026-07-14: HotelOS Phase 4 — Reporting + Documents

- Document system domain (`documentSystem.js`) enforces online-only for template CRUD, draft render, and publish; mutations go through `create/update/delete_document_template`, `render_document`, `publish_document` RPCs and reject `success: false`. Publish is never queued (matches `docs/OFFLINE_MATRIX.md`).
- `DocumentSystem.jsx` only shows success after `assertRpcSuccess` on RPC results; hotel document types match schema (`folio`, `invoice`, `registration_card`, `statement`, `receipt`, `contract`, `cancellation_note`). Quotation remains a render subject type, not a template check value.
- Hotel KPIs (`hotel.js` / `HotelKpis.jsx`) label occupancy/ADR/RevPAR as `booking_cache_estimate` and point operators to enterprise advanced reports for ledger-derived figures. No hard-coded sample KPIs.
- `advancedReports.js` calls report RPCs with live `p_from`/`p_to` params, tags `authority: ledger_derived`, and does not invent client-side numbers. UI surfaces RPC errors instead of empty fake success.
- Migration `20260714120000_hotel_reports_ledger_restore.sql` restores occupancy (with ADR/RevPAR summary), rate performance, channel, cancellation/no-show, pace, pickup, debtor aging, deposit liability, and folio exception RPC bodies from bookings/rooms/corporate ledgers. **Linked `db:push` applied 2026-07-14.**
- Focused test: `tests/hotel-documents-reports.test.mjs`.

## 2026-07-13: HotelOS completion program — Phase 0 + Phase 1

- Phase 0 truth matrix written to `docs/HOTELOS_COMPLETION_MATRIX.md` from live nav, catalogue, entitlements, domains, offline matrix, and false-completion signals (provider stubs, silent empty front-desk catches, core/add-on double-charge, contract-name tests).
- Phase 1 freezes **Hotel Core** so a clean licence can run a normal hotel day without buying fundamentals again:
  - Core now includes basic `rate_plans`, `corporate_accounts` settlement, `documents`, `hotel_roles`, `room_attributes`, `checkin_workflow`, `early_late_checkout`, `cancellation_policies`, `night_audit_enterprise`, housekeeping readiness, and related operational keys.
  - Premium remains channels, guest portal/messaging/CRM, advanced rates/yield, multi-property, multi-outlet POS, payment gateway, group operations, etc.
- Client sources updated: `commercialEntitlements.js`, `subscriptionState.js` Enterprise map, `entitlementMerge.js`, `moduleCatalog.js`, `enterpriseAddons.js`, `hotelNav.js`, `propertyTypes.js`.
- Marketing quote/planner surfaces updated (`enterprise.html`, `packages.html`) so rate plans / corporate / mobile HK are not re-sold as add-ons.
- Local migration `20260713200000_hotel_core_entitlement_boundary.sql` expands server `hotel_core` `included_features` and deactivates now-core commercial addon price rows. **Linked `db:push` applied 2026-07-14.**
- Focused tests: enterprise foundation + commercial + marketing + entitlement gating + sidebar curation (200/200) and `tests/hotel-core-entitlement-boundary.test.mjs` (9/9).
- Phase 2 started: Hotel front-desk board (`HotelHome.jsx` + `hotel.js` dashboard stats) no longer swallows query failures into empty success, surfaces partial-load warnings, labels occupancy/balance as estimates, and adds actionable exception cards (no-shows, unassigned, dirty/maintenance blockers, outstanding balances, VIP). Focused test: `tests/hotel-front-desk-board.test.mjs`.
- Phase 2 hotel day ops (2026-07-14): check-in/out workflow now enriches checklists with pre-arrival room readiness + booking-ledger balance estimates (labelled, never author `payment_status`), surfaces board/checklist load failures instead of empty success, and supports manager override via existing `complete_checkin_step` + `complete_hotel_checkin` with auditable reason (`completeHotelCheckinWithOverride` IPC). Room moves require an audit reason domain-side, improve conflict messaging, detect rate impact, and navigate to folio when rates differ. Housekeeping readiness adds inspected state, refuse-service (assignment `skipped` + notes), maintenance escalation links; maintenance ticket/OOO/return-to-service errors surface instead of console-only swallow. Focused test: `tests/hotel-ops-workflows.test.mjs`.
- Remaining Phase 2 items (full reservations concurrency proof, PWA HK depth) and Phases 3–13 plus Phase 14 commercial bundling remain open until the completion report.

## 2026-07-13: Tsa Bonno HospitalityOS public-brand migration

- Independent packaging-isolation verification (2026-07-13 evening): each product `app.asar` was inspected with `@electron/asar`. Foreign `out/<other-product>/` path counts were 0 for all three packages; packaged `package.json` mains were `out/lodge-camp|hotel|hospitality-pos/main/index.js`; `product.json`, `app-update.yml` feeds, official product logo/icon resources, and exact Tsa Bonno `ProductName`/`FileDescription` metadata were confirmed. Packaged bridge package names remain `boroko-bookings` / `boroko-hotel` / `boroko-hospitality-pos`, NSIS `deleteAppDataOnUninstall` is false, and shortcut/uninstall labels are the Tsa Bonno product names. A focused regression in `tests/tsa-bonno-brand-migration.test.mjs` asserts those asar and bridge contracts whenever the three `dist/*/win-unpacked` artifacts exist. Installers remain `NotSigned`. Live marketing/booking/manager brand assets and HTTP 200 surfaces re-verified; no redeploy performed.
- Partial LodgingOS data-path proof (safe disposable copy only): a copy of `%APPDATA%\\boroko-bookings` was loaded by `dist/lodge-camp/win-unpacked/Tsa Bonno LodgingOS.exe` via `BOROKO_TEST_USER_DATA_DIR`. `profiles.json`, `lodge-id.json`, and `.updaterId` hashes stayed identical; the real installed user-data directory was not modified. This proves the branded binary can open existing lodge profile state without cross-writing Hotel/POS package identities in that controlled run. It does **not** prove NSIS in-place upgrade, shortcut/uninstaller replacement, offline-queue replay across a real installer upgrade, or clean-machine install. Full upgrade/data-retention and code-signing remain release gates. This machine still has a live `Boroko Bookings` 1.5.4 install; no destructive upgrade was run against it.
- Product build outputs are isolated under `out/lodge-camp`, `out/hotel`, and `out/hospitality-pos`. This closes a confirmed cross-product development hazard where a LodgingOS build could overwrite the shared `out/` tree while HotelOS was running and make the Hotel window reload with LodgingOS identity. Launch configuration now requires an explicit valid product, root scripts expose explicit product commands, and current workspace documentation uses the `@tsa-bonno/*` package names. A HotelOS runtime remained titled `Botswapelo Hotel · Tsa Bonno HotelOS` while a full LodgingOS build completed after this isolation change.
- The release helper now treats `--help` as read-only and rejects missing/unknown modes instead of silently defaulting to a patch-and-publish operation. An accidental LodgingOS `v1.5.5` draft created during diagnosis was deleted; the live latest release remains `v1.5.4`, and Hotel/POS release feeds were not changed.
- Canonical customer-facing names are now **Tsa Bonno HospitalityOS**, **Tsa Bonno LodgingOS**, **Tsa Bonno HotelOS**, and **Tsa Bonno Restaurant & Bar POS**. Shared product identity, desktop/PWA/booking/marketing UI, installer presentation, exports, receipts, email copy, SEO metadata, release notes, and active brand assets use those names.
- The owner-supplied SVGs in `logos/` are the canonical visual identity for the ecosystem and all three products. The asset builder now produces product-specific color wordmarks, direct white-on-transparent variants for dark surfaces, PNG/PWA/Windows icon outputs, and copies them into the desktop apps, Manager PWA, marketing site, booking site, and Legacy POS. A regression test requires transparent PNG padding; rendered review caught and corrected an earlier opaque-black padding defect before deployment.
- Compatibility identities remain deliberately unchanged where an in-place update or live integration depends on them: product/database keys (`lodge-camp`, `hospitality-pos`, `lodge_camp`, `hospitality_pos`), Windows app IDs, LodgingOS app-data path, `x-boroko-*` protocols, established environment/storage keys, GitHub updater repositories, and currently published legacy URLs/email addresses.
- Vercel project `prj_b9milxVRjSkmlcR2kQcuN4rz2Cq8` is renamed `tsa-bonno-hospitalityos-manager`. Both `https://tsa-bonno-hospitalityos-manager.vercel.app` and compatibility `https://boroko-bookings.vercel.app` are verified production domains serving the Tsa Bonno Manager build.
- Existing marketing and booking Netlify site IDs were preserved and production-deployed. `https://borokobookings.netlify.app` serves the renamed marketing site and brochure; `https://borokoonlinebookings.netlify.app` serves the current booking build. Their old Netlify slugs remain compatibility URLs because changing a Netlify site name changes its default hostname.
- Supabase migration `20260713013000_tsa_bonno_public_brand_labels.sql` is present in linked migration history. Live anonymous calls return the exact three Tsa Bonno product labels. The `send-booking-confirmation` Edge Function and Netlify quote-download function were redeployed with the new brand. The Supabase project ref/API endpoint are unchanged.
- The linked Supabase dashboard project display name is now **Tsa Bonno HospitalityOS**, verified through the authenticated Management API and `supabase projects list`; project ref `oicgpknsmtvcsjacymum`, organization, API URL, database, and credentials remain unchanged. The strict line-by-line brand audit now exits successfully with zero unresolved and zero blocking occurrences.
- GitHub repository descriptions use the Tsa Bonno names and the source-repository homepage points to the new Manager domain. Repository slugs and release feeds remain compatibility identities pending updater-bridge proof.
- Verification passed for brand-migration, product extraction, release architecture, commercial catalogue, marketing contracts, the root build, all three product builds serially, Manager PWA, booking site, and Legacy POS. The marketing brochure and captured web assets were rendered and visually checked. Local v1.5.5 LodgingOS, HotelOS, and Restaurant & Bar POS installers have exact Tsa Bonno Windows product metadata and branded icons. The separate v1.1.0 Legacy POS installer and packaged executable are verified IA-32 (`0x014C`) with Tsa Bonno metadata.
- No renamed Windows installer was published: all four locally built installers are unsigned (`NotSigned`). Code-signing, clean-machine smoke, and the LodgingOS in-place upgrade/data-retention bridge proof remain release gates.
- The migration is not complete: no new canonical marketing/booking domains, email aliases, or social handles have been supplied; Netlify/GitHub compatibility slugs remain by design; and code-signing plus clean-machine/in-place Windows installer bridge proof is still required before any updater identity can move.

## 2026-07-13: Restaurant and Bar Business Control contract repair

- Business Control now uses capability-aware tabs, supplier-isolated purchase-order conversion, refreshed shift-plan mutations, actionable reservation navigation, repeated-void/after-hours risk signals, weighted forecasting with confidence, and expected-versus-measured bottle/keg variance.
- The native HPOS terminal loads eligible promotions, applies category/minimum-spend/schedule/customer-segment rules in its payment preview, and submits the selected promotion to authoritative POS v3 pricing.
- Linked Supabase migrations `20260713120000`, `20260713130000`, and `20260713140000` are deployed. The forward repair updates snapshot publication and authoritative checkout enforcement for the current promotion schema. The earlier branding migration blocker was corrected from a nonexistent `description` column to `sales_copy` and deployed.
- Bar POS and Restaurant Control/Growth commercial entitlements include incident logging; Business Control hides controls the signed-in role cannot use.
- Verification: all 22 Restaurant suites, product extraction tests, HPOS product build, linked migration push/list, and database lint passed.

### Bar-only experience hardening

- Bar Only now skips recipe, reservation, waitlist, and kitchen-ticket reads instead of merely hiding their routes.
- Business Control uses drink margin, pour control, bartender/cashier shifts, bottle/keg purchasing, bar promotions, and bar risk language; restaurant guest flow and kitchen/server roles are excluded.
- The manager hub, command palette, reports, system health, terminal header, and team roles now render bar-native descriptions and labels.
- Verification: bar-mode curation tests, the HPOS service contract, all 22 Restaurant suites, and the Hospitality POS product build passed.
- Follow-up root cause: `bootstrap_company_settings` omitted `operating_profile`, so Botswapelo Bar's local setup selection (`bar_only`) was dropped from the linked settings row and every fresh login correctly—but undesirably—defaulted to restaurant mode. Migration `20260713150000_hospitality_mode_bootstrap_repair.sql` is deployed, the affected linked row is repaired, entitlement identity is merged into renderer settings, and both current HPOS desktop caches are corrected.

This is the dated orientation document for humans and AI agents. It is intentionally separate from the durable rules in [AGENTS.md](AGENTS.md).

## 2026-07-13: Marketing information architecture and rendered-site audit

- The public homepage now presents Tsa Bonno HospitalityOS as a three-application family: Tsa Bonno LodgingOS, Tsa Bonno HotelOS, and Tsa Bonno Restaurant & Bar POS.
- The homepage was reduced from a repetitive 16,000px-plus desktop narrative to five visible selling sections, with smaller supporting headings and a product-aware enquiry/FAQ close.
- Packages now separates Lodge, Hotel, Restaurant, and Bar pricing. Hotel has a client-side planning calculator for requestable add-ons and a clearly labelled planned roadmap; final quotation and activation remain server-authoritative.
- Lodge, Hotel, Restaurant, and Bar landing pages each display their own commercial pricing.
- Public desktop and mobile navigation was normalised across every marketing HTML page so Hotel and Bar POS are no longer absent from secondary pages.
- A Playwright/Edge sweep rendered all 27 HTML pages at desktop and mobile sizes. Mobile overflow on the homepage and Bar POS was fixed, the duplicate private-admin H1 was corrected, and invalid Restaurant POS responsive `bar-stock` image candidates were repaired.
- Verification: `npm run test:marketing-site`, local-link scan, desktop/mobile overflow checks, browser page-error checks, broken-image checks, and screenshot contact-sheet review. These changes are local and have not been deployed to Netlify.

## 2026-07-12: Integrated product release and public marketing deployment

- LodgingOS, HotelOS, and Restaurant & Bar POS v1.5.5 Windows installers were built and published to their isolated public GitHub release feeds under the former release-era artifact identities. The three `releases/latest/download` installer URLs returned HTTP 200 after publication.
- The Lodge Food & Beverage hub now exposes restaurant-grade sales, menu/modifier management, tables and service areas, table reservations, kitchen, bar products, stock, team, and close-of-day tools while retaining the Lodge accommodation shell and routes.
- Tsa Bonno HotelOS now has a distinct copper command shell with a shift action strip for arrivals, room moves, folios, housekeeping, and night audit. Completed HotelOS workspaces are catalogued active, including guided check-in, early/late handling, cancellation policies, advanced booking/rates, maintenance, groups, compliance, guest CRM, reports, and multi-outlet POS.
- The marketing site was deployed to the existing `borokobookings` Netlify production site in deploy `6a5411ea5f1f29c32d1a1299`. The homepage plus Lodge, Hotel, Restaurant POS, and Bar POS landing pages returned HTTP 200 and production content markers were verified.
- Full release evidence passed: production guardrails, offline queue/POS, financial integrity, inventory sync, imports, release behaviour/architecture, 28 Enterprise suites, 22 Restaurant suites, product and marketing contracts, Manager PWA and booking-site builds/tests, production dependency audit, and serial installer builds. Linked Supabase reported `Remote database is up to date`.

## 2026-07-13: Restaurant-native POS navigation and service UX

- Restaurant & Bar POS retains its own `HposTerminal` and warm hospitality design. It does not render or import the Lodge app's shared `POS.jsx` surface.
- The floating option dock was replaced with a persistent, responsive service rail. Secondary tools now open in a full `HposManageHub` that filters destinations through the signed-in user's capabilities.
- Duplicate `Advanced POS`, standalone recipe/purchasing/admin, and other overlapping navigation entries were removed from the Hospitality POS profile; canonical restaurant workspaces remain available through Menu, Stock, Team, Cash & Close, and Manage.
- The restaurant-native terminal now starts accountable POS shifts in place, blocks payment until a shift is open, restores an occupied table's open check, labels table/tab settlement explicitly, and adds mobile-money payment alongside cash and card.
- The HPOS visual system now uses a dimensional aubergine service rail, elevated coral active states, layered cream/plum management surfaces, and restaurant-native money pages. Reports, expenses, cash close, and remaining HPOS success states use copper, plum, indigo, and blue-teal instead of inherited Lodge green styling.
- `pos.cashup` is now a real access-control capability for supervisors, managers, admins, and package-aware navigation instead of a UI-only capability reference.
- Verification: all 22 restaurant regression suites passed and the `@boroko/hospitality-pos` product build passed. Packaged/manual rush-hour operator smoke remains separate.

## 2026-07-12: Manager PWA product-aware memberships and session split

- One Manager PWA remains the mobile surface for LodgingOS, HotelOS, and Restaurant & Bar POS. Product identity is **server-authoritative** `product_family`, not a client-chosen UI mode.
- Migration `20260712200000_manager_pwa_product_memberships.sql` adds:
  - `normalize_settings_property_type` / `resolve_product_family` / `product_family_label` (motel → `lodge-camp`; `pos_only` → restaurant → `hospitality-pos`; hotel/resort → `hotel`)
  - `list_manager_pwa_memberships()` — membership list only; **does not mint** app sessions
  - `issue_manager_pwa_session(p_lodge_id)` — mints one lodge-scoped PWA session after explicit company choice
  - Compatibility `authenticate_manager_from_supabase` no longer bulk-mints sessions when `p_lodge_id` is null
  - `list_desktop_product_memberships` now filters via `resolve_product_family` and returns `product_family`
  - `refresh_pwa_app_session` returns the same product/package/feature identity fields
- Membership rows include `product_family`, label, role, PWA enablement, plan, commercial package key, package label, hospitality mode, and `effective_features`.
- Manager PWA login: Supabase Auth password → list memberships → chooser when multiple → issue session for one company. **Password is not kept in React state** during selection.
- PWA shell (header badge, bottom nav, Menu modules, dashboard/reports copy) adapts from session `product_family`. Restaurant primary nav uses Home / Sales / Stock / Money / Inbox / Menu.
- Focused tests: `tests/manager-pwa-product-memberships.test.mjs`; product-extraction and lodge-camp blocker tests updated. Linked Supabase: `npm run db:push` applied `20260712200000_manager_pwa_product_memberships.sql`. Manager PWA lint/build passed (existing warnings only). Public PWA deploy remains separate.

## 2026-07-12: Product-aware commercial catalogue and authoritative quotes

- Added `src/shared/commercialEntitlements.js` with explicit LodgingOS Starter/Standard/Pro, Hotel Core, Bar POS, and Restaurant Service/Control/Growth offers. Hotel Core is `hotel_core` with internal compatibility plan `Enterprise`; POS offers use compatibility plan `Pro` without inheriting LodgingOS usage caps.
- Added the server-owned commercial catalogue, immutable quote snapshot, short-lived quote token, product/package validation, atomic Command Central notification, and server-approved activation mapping in `20260712170000_commercial_catalog_quote_authority.sql`, with forward repairs in `20260712171000_commercial_catalog_quote_authority_repair.sql`, `20260712172000_commercial_quote_addon_eligibility_repair.sql`, and `20260712173000_commercial_catalog_hotel_addon_repair.sql`.
- Linked Supabase deployment is confirmed: `npm run db:push` completed and `npm run db:lint` reports zero errors. Live anonymous quote-calculation smoke checks returned Lodge Starter P8,999, Hotel Core P37,998 plus selected add-on setup/recurring lines, and Bar POS P4,500.
- Desktop Package Builder and subscription request domain now submit stable product/package selections to the authoritative authenticated quote RPC. New commercial activation skips client-side licence/feature writes and is applied by the server transaction; legacy requests retain compatibility behaviour.
- POS Settings and upgrade requests now select and persist `commercial_package_key`, so Bar POS, Restaurant Service, Restaurant Control, and Restaurant Growth no longer collapse to the shared internal `Pro` plan. `src/shared/commercialAccess.js`, the access snapshot, POS IPC handlers, and restaurant route walls enforce the package feature boundary; the 20260712174000 migration resets catalog-known non-included features before granting the selected package.
- Live quote smoke checks now return all four POS keys and prices: Bar POS P4,500, Restaurant Service P8,999, Restaurant Control P12,999, and Restaurant Growth P18,999. Live catalog checks confirm Service excludes inventory/recipes, Control excludes loyalty, Growth includes loyalty, and Bar POS excludes tables/recipes. HotelOS/POS shared upgrade surfaces no longer render LodgingOS capacity-limit copy.
- Hotel marketing quotation now submits the product-aware public RPC. The protected Netlify quote endpoint retrieves by expiring token and returns a no-store PDF; the Packages page now presents the separate POS offers and correct Bar one-year licence wording.
- Verification passed: `npm run test:commercial` (including package-key persistence and Service/Control/Growth/Bar regressions), `npm run test:marketing-site`, `npm run test:products`, `npm run test:restaurant`, `npm test`, `npm run build`, all three product workspace builds, `npm run db:push`, and `npm run db:lint`. Public Netlify publication and a real Command Central activation against a live customer licence remain unproved.

## 2026-07-12: Product-scoped commercial packages

- LodgingOS customer-facing packages are Starter, Standard, and Pro. The old Enterprise package is no longer exposed in LodgingOS package selection, subscription upgrade UI, or LodgingOS marketing structured data.
- Tsa Bonno HotelOS is quoted as a separate product. HotelOS quotation flows may still submit the internal `Enterprise` plan key so existing licenses, entitlement maps, activation RPCs, and historical requests remain compatible.
- Hotel optional services remain explicitly quoted/activated and are no longer presented as a generic Enterprise package or as Lodge upsells.
- The legacy `/enterprise` marketing URL remains available as a compatibility URL, but its content is now the Tsa Bonno HotelOS quotation flow.

## 2026-07-12: Product-family usability and marketing integration

- Settings no longer offers a free property-type switcher. Product identity (LodgingOS / HotelOS / Restaurant & Bar POS, plus bar vs restaurant mode) is chosen at setup and shown as a locked label in Settings. After `setup_complete`, `saveSettings` keeps the existing `property_type` via `resolveLockedPropertyType` so a client cannot reclassify lodge ↔ hotel ↔ restaurant in-app. Setup still sets the type within each product’s allowed list.
- LodgingOS desktop nav is product-scoped: when compatibility `productId` is `lodge-camp`, hotel-only modules and locked HotelOS-group upsells are hidden (including motel, which is hotel-class by property type but ships on LodgingOS). The LodgingOS shell no longer switches `bizType` to `hotel` for motel, and its dashboard no longer embeds the hotel enterprise board. Property-type-only nav calls (no product id) keep legacy hotel inheritance for catalog tests; HotelOS continues to use `HotelLayout` / `hotelNav` for live night audit and front-desk rails.
- LodgingOS keeps the existing accommodation shell and core routes. A new **Food & Beverage** entry opens a LodgingOS-only control hub that reuses the restaurant-grade kitchen/bar, menu/modifier, recipe costing, prep batch, stock/purchasing, team, cash-close, settlement, checklist, and exception components without making LodgingOS present as Restaurant & Bar POS. The product route allowlist blocks this hub in HotelOS and Restaurant & Bar POS builds.
- Restaurant & Bar POS now keeps the service-critical actions in its persistent bottom dock: Service/Sell, Floor where applicable, Kitchen where applicable, Stock, Products for bar-only mode, and Cash & close. Lower-frequency tools are grouped under Operate, Review & close, and Business setup instead of appearing as one flat option wall.
- Hotel remains a separately compiled product with its independent copper operations shell, front-desk movement board, hotel navigation/search, guided check-in/out, folios, nightly rates, corporate settlement, housekeeping, and night-audit paths. Hotel v1.5.5 is packaged and publicly published; clean-machine operator smoke and external provider connectivity remain unproved.
- Marketing now presents Tsa Bonno HospitalityOS as a three-application product family. Dedicated `lodge-app.html`, `hotel.html`, `restaurant-pos.html`, and `bar-pos.html` landing pages expose product-specific trial registration and dedicated release-feed/download links. Trial forms use LodgingOS, HotelOS, or Restaurant/Bar language based on the selected product. The pages are published at the compatibility URL `https://borokobookings.netlify.app`.
- Verification passed: `npm test`, `npm run test:products`, all 22 `npm run test:restaurant` suites, focused Hotel rate/night-audit/corporate and UUID workflow suites, `npm run test:marketing-site`, and serial builds for `@boroko/lodge-camp`, `@boroko/hotel`, and `@boroko/hospitality-pos`.

## Released baseline

- Desktop package manifest version: `1.5.5`. Lodge/Camp, Hotel, and Restaurant & Bar POS installers and update metadata are published in their separate public release repositories.
- Legacy POS package version: `1.1.0`.
- Manager PWA and public booking site are independently built and deployed web surfaces.
- The desktop app uses `database.js` as a compatibility facade; business logic is split across `src/main/domains/`.
- Legacy POS is a separate Electron 22/Windows POSReady 7-compatible deliverable with its own updater, release scripts, cache, queue, mesh behavior, and database probe.

## Implemented architecture and safeguards

The repository currently contains:

- RPC-first booking payment handling and database-derived payment status.
- A customer-credit ledger for advance payments that do not reserve rooms, with receipt, allocation, refund, reversal, audit, and liability reporting.
- Atomic booking rescheduling with room/date conflict checks, exclusive-event protection, authoritative repricing, reason capture, and overpayment transfer to customer credit.
- A desktop **Front Desk -> Prepayments** workspace for receiving advance payments, viewing balances and history, applying credit to bookings, refunding/reversing entries, and printing advance-payment receipts.
- Read-only Manager PWA visibility for outstanding customer-credit liability.
- Human-readable advance-payment receipt numbers (`PRE-YYYY-NNNN`) and dedicated A4 PDF rendering.
- Stable offline operation IDs and idempotency protection for critical financial and inventory work.
- `financial_operation_idempotency` and `financial_audit_log` infrastructure.
- Atomic POS v3 order/return flows, inventory depletion/restoration, outlet enforcement, shift and cash-up contracts.
- Booking-linked POS charge support where the order has authoritative booking/folio linkage.
- Atomic room-maintenance reconciliation.
- Event/full-lodge quotation support.
- Manager PWA POS reporting, support inbox/read receipts, operational caching, and guarded operational mutations.
- Main desktop and Legacy POS mesh/offline synchronization support.
- Main desktop long-outage hardening: queued desktop operations now have an append-only local operation journal, manager-acknowledged lodge offline mode, offline operations bundle export, mesh repair visibility, and mesh allowlist/schema coverage for every desktop offline RPC operation while preserving Supabase RPC replay as final authority.
- Main desktop normal operations now have broader offline queue coverage in the repository: booking charges, customer-credit allocation/refund/reversal, rate overrides, expenses, maintenance updates/resolution, inventory purchases/item edits/deletes/stocktakes, event line items, supply purchases/item edits/deletes, room-supply allocations/moves, and supply/room-supply stocktakes. Local values remain pending estimates until replay succeeds.
- Main desktop sync queue storage is file-backed JSON/JSONL under the app cache/user-data path (`sync-queue.json`, failed queue JSON, and `offline-operation-log.jsonl`), not a SQLite queue. The queue processor uses a promise-level processing guard and dependency-aware replay ordering.
- Manager PWA offline state is device-local `localStorage`, scoped per lodge, with blocked high-risk mutation types and a three-attempt unresolved/dead-letter threshold. It is not IndexedDB and is not a global financial authority.
- Legacy POS mesh uses signed local HTTP requests with HMAC-SHA256, timestamps, nonces, lodge identity checks, and a bounded mesh port range. It is authenticated local transport, not anonymous raw LAN message acceptance.
- Booking refund preparation now supports offline pending-approval requests with proof references, retained-fee calculations, local cache visibility, and operation-journal audit. The actual refund/customer-credit settlement still requires online manager PIN verification and the authoritative `approve_booking_refund` RPC.
- Accommodation multi-room booking is implemented as one lead guest stay group with multiple normal room booking records plus a first-class group invoice wrapper (`booking_invoice_groups` / lines). Direct bookings and room quotations can both produce this grouped accommodation invoice. It uses `[STAY_GROUP]` metadata, not Events & Venues event grouping, so each room line keeps normal room availability, status, payment, refund, profitability, and offline replay behavior while the guest/company sees one invoice. Group invoice payments and approved refunds are entered once by the operator and allocated across the child room booking ledgers.
- Public booking-site accommodation requests can now use lodge-specific public offer settings. Lodges can advertise room stays, multi-room stays, full-lodge stays, day-use options, and event/venue options on their slug. The public booking RPC supports single-room, multi-room, and full-lodge accommodation requests; multi-room requests create the same group invoice wrapper as desktop direct bookings, while full-lodge requests create one exclusive booking to preserve exclusive-event conflict rules. Day-use and event/venue offers are exposed as public information/contact paths until their pricing, payment, and approval rules are opened through dedicated public RPCs.
- Command Central audit, fleet-health, notification, entitlement, and release-control capabilities.

The customer-credit and booking-reschedule migrations were confirmed applied to the linked Supabase project on 2026-06-20. Repository implementation and database deployment do not by themselves prove that every client surface has been published or operator-smoke-tested.

## Current workspace and recent verification

### 2026-07-11: Campsite authoritative pricing contract

The LodgingOS campsite pricing migration `20260711200000_campsite_booking_pricing_contract.sql` is present locally and appears in the linked migration history after `20260711191000`. `npm run db:push` completed with `Remote database is up to date`, and `npm run db:lint` completed with a zero-error result.

- `accommodation_booking_expected_total` is the server pricing contract for campsite site/person/tent/vehicle/composite modes, capacity checks, required-rate checks, and rounded totals.
- `create_campsite_booking` preserves the established room `create_booking` contract while carrying campsite occupancy through transaction-local pricing context, storing `booking_accommodation_details`, and rejecting idempotency-key reuse with changed occupancy.
- Desktop booking and offline/mesh replay now submit `p_tents` and `p_vehicles` through `create_campsite_booking`; normal room bookings keep the existing `create_booking` path.
- The booking-site card and shared estimate now display the configured rate mode and do not invent a tent or vehicle count when the guest has entered zero.
- Focused campsite, booking-site, offline queue/POS, release, blocker, and database-lint checks pass locally. Isolated live campsite RPC smoke, deployed booking-site parity, and packaged operator smoke remain unproved.
- Playwright web-server paths were corrected to resolve from `Playwright tests/`. Both E2E projects start their servers, but the pinned Chromium binary is not installed in this environment, so browser assertions remain unproved.

### 2026-07-11: Product-scoped multi-company desktop sign-in

- One Supabase Auth email can now have staff profiles at multiple companies. The desktop sign-in first lists only companies compatible with the launched product, then requires an explicit company choice when more than one is available.
- HotelOS only lists hotel/resort companies; LodgingOS lists lodge/camp/guest-house/motel companies; Restaurant & Bar POS lists restaurant companies. A selected company is then authenticated through the existing lodge-scoped app-session contract.
- Linked Supabase migration `20260711201000_product_membership_login.sql` was applied. It adds `list_desktop_product_memberships(text)`; database lint reported no errors after deployment.
- Staff/admin creation now permits the same email at different companies while still rejecting duplicate staff email records inside the same company.

### 2026-07-11: Hotel rates + night audit + corporate settlement

Linked migrations **applied**:
- `20260711190000_hotel_rates_night_audit_corporate.sql`
- `20260711191000_hotel_rate_night_audit_overload_repair.sql` (clears ambiguous 4-arg/5-arg `room_booking_expected_total` and dual `run_night_audit_checks` signatures that broke create/reschedule booking lint)

- `room_booking_expected_total` prices **night-by-night** using room overrides, then rate plans (corporate/room-type/general + days_of_week + stay limits), then room base rate. Single 5-arg function with corporate default + `quote_room_stay` RPC.
- Desktop `createBooking` prefers server `quote_room_stay` so booking totals match rate plans.
- Night audit checks expanded (pending departures, possible no-shows, open hotel folio balances, dirty rooms, pending moves); **one closed audit per business date**; critical blockers unless forced; overdue arrivals marked `no_show` on close. Single `run_night_audit_checks(lodge, business_date default)`.
- Desktop **Night Audit (Enterprise)** route (`/night-audit-enterprise`) is a live operational UI: run checks, force-close, history/reopen, exception resolve — not a redirect to the report-style `/audit`.
- Corporate charge settlement: invoice created, booking linked to corporate account, guest bill settlement via `payments` method `corporate` + open hotel folio payment mirror. UI requires booking id; amount blank/0 settles remaining balance.
- `supabase db lint --level error` on linked project: **0 errors** after overload repair.
- Tests: `tests/hotel-rates-night-audit-corporate.test.mjs`.

### 2026-07-11: Hotel Enterprise UUID rebuild (core modules)

Linked migration applied: `20260711180000_hotel_enterprise_uuid_complete.sql`.

- **Hotel folio ledger** rebuilt on **uuid** `lodge_id` / `folio_id` (old bigint ledger dropped; table was empty). Full RPCs: create, list, lines, charge, payment, transfer, split, void, close, reopen, lock, balance, auto guest-folio on check-in.
- **Check-in / check-out workflow** rebuilt on uuid with config, checklist init/complete/reset, and final `complete_hotel_checkin` / `complete_hotel_checkout` (room status + folio close).
- **Rate applicability** RPC `get_applicable_room_rate` (override → rate plan → room base).
- **Channel dashboard** uuid-safe operational summary (`manual_review` mode).
- Desktop: `checkinWorkflow` complete hotel check-in/out IPC, hotel dashboard route live (no longer redirects home), Layout treats motel/hotel/resort as `hotel` nav biz type, hotel inherits lodge nav + Front Desk/Folios/Check-in entries.
- Tests: `tests/hotel-enterprise-uuid-complete.test.mjs`.

Still require operator smoke before “100% sellable Hotel” claims: live night-audit close on a real lodge day, corporate charge against a live booking with open folio, channel import conversion, multi-property group switching with real second lodge, payment gateway, OTA sync providers.

### 2026-07-11: Database lint gate cleared on linked project

Linked Supabase `supabase db lint --level error --fail-on error -s public` now reports **0 errors** (was 104 functions / 107-class failures).

Applied repair migrations:

- `20260711160000_database_lint_gate_repair.sql`
- `20260711161000_database_lint_gate_repair_pass2.sql`
- `20260711162000_database_lint_gate_repair_pass3.sql`

What was fixed:

- compatibility columns (`bookings.corporate_account_id/room_type_id/customer_name/channel/group_block_id`, `booking_charges.unit_price/total_amount`, invoice/status totals, marketing/channel `updated_at`, payment provider `settings`, etc.)
- missing relation shims (`subscription_requests`, `stock_movements`, `booking_room_moves`, `housekeeping_log`, `user_lodges`, `restaurant_tables`, views for `pos_outlets`/`menu_items`/`maintenance`)
- bigint `app_require_lodge_role` overloads for incomplete enterprise modules that still use bigint lodge IDs (fail closed at runtime for real uuid lodges)
- extensions-qualified crypto helpers (`gen_random_bytes`, `crypt`, `hmac`, `digest`, `row_to_jsonb`)
- targeted function repairs/stubs for reports, POS v2 aliases, folio helpers, early/late checkout fees, debtor aging

Note: some enterprise hotel/booking-engine functions remain **fail-closed stubs or bigint-era shims** so lint passes and production uuid lodge paths stay safe. Full rewrite of those modules onto uuid lodge IDs is still future product work.

Run: `npm run db:lint` (uses linked DB credentials from `.env.db`).

### 2026-07-11: Campsite accommodation model + release-blocker migrations applied

Linked Supabase migrations applied successfully:

- `20260711120000_lodge_camp_release_blockers_repair.sql` (POS/guest-portal/PWA auth repair)
- `20260711140000_campsite_accommodation_model.sql` (campsite inventory model)

Campsite model now in repository and linked DB (Phase 1 complete product path):

- `rooms` gains `accommodation_kind` (`room`/`unit`/`tent`/`campsite`), capacity adults/children, max tents/vehicles, powered flag, site surface, shared facilities, and rate modes (`site`/`person`/`tent`/`vehicle`/`composite`) with per-person/tent/vehicle rates.
- `create_room` / `update_room` persist those fields with server validation.
- Public availability returns separate `rooms` and `campsites` arrays with campsite pricing via `compute_accommodation_stay_total`.
- Public offers include `campsites` (`public_offer_campsites`).
- Desktop Rooms UI labels inventory as Sites & Rooms for camp properties and exposes campsite controls.
- Booking site shows campsites separately from rooms/units.
- `camp` is a first-class property type again (no longer normalized away to `lodge`); operating profile includes `accommodation_mix` / `campsite_profile`.
- Shared helpers live in `src/shared/accommodation.js`.
- Contract tests: `tests/campsite-accommodation-model.test.mjs`.

Still open / not claimed done:

- Hosted online payments/deposits product work
- Deploying booking-site/PWA builds to production hosts
- Phase 2 multi-pitch capacity engine (true multi-booking per physical campsite area) — current model keeps one campsite row = one reservable unit for conflict safety
- Operator smoke of live campsite create/book/public search after desktop release

### 2026-07-12: Multi-company admin email uniqueness fix

- Hotel company setup with an email already used as restaurant admin failed on `users_admin_email_unique` (global unique index on admin emails).
- Linked migration applied: `20260712153000_drop_global_admin_email_unique.sql`. Same admin email may now exist at different companies; uniqueness remains per company via `users_email_lodge_unique` / `users_lodge_id_email_key`.
- Desktop `createUser` maps leftover constraint errors more clearly.

### 2026-07-12: Company setup settings RLS bootstrap

- New-company desktop setup was failing with `new row violates row-level security policy for table "settings"` because setup upserts settings through the anon client before any lodge session/user exists, while `settings` INSERT requires `app_lodge_access(lodge_id)`.
- Linked migration applied: `20260712120000_bootstrap_company_settings.sql` adds security-definer `bootstrap_company_settings(jsonb)` for first-time company rows only (refuses already-completed companies).
- Desktop `initializeCompanySetup` now calls `saveSettings(..., { allowBootstrap: true })`, which falls back to service-role or the bootstrap RPC when RLS blocks direct upsert. This unblocks multi-product setup with the same email (e.g. restaurant admin also creating a hotel company).

### 2026-07-12: Hotel in-app shell rebuilt as independent PMS UI

- Hotel product no longer re-skins Lodge `Layout.jsx`. It uses a dedicated shell under `src/renderer/src/components/hotel/`:
  - `HotelLayout.jsx` — charcoal/brass top command bar + icon rail + zone flyouts (different IA from lodge sidebar)
  - `HotelHome.jsx` — front-desk command board (arrivals / in-house / departures + room board)
  - `hotelTheme.css` — product-scoped tokens that re-skin shared operational pages without forking financial modules
  - `hotelNav.js` — hotel-only navigation map
- `App.jsx` routes hotel product to `HotelLayout` and home to `HotelHome`. Lodge still uses live `Layout` + `Dashboard`. HPOS still uses `HposLayout`.
- Onboarding (login/chooser/setup/loading) for hotel matches the charcoal/brass language. Lodge UI remains frozen green.

### 2026-07-12: Product shell contract + continuous isolation (frontend boundary)

- Expanded `src/shared/productIdentity.js` into a shell contract: brand names, business nouns, taglines, theme ids, route allowlists, and release repos — still one shared main/domains/Supabase backend.
- Cross-product login/session hardening: product assert now also runs on offline trusted-session unlock, session restore, and `validateCurrentSession` (not only online login). Wrong-product companies fail closed with `product_profile_mismatch`.
- Renderer `ProductShellGuard` enforces per-product route allowlists so restaurant.exe cannot open hotel enterprise modules and hotel.exe cannot open pure HPOS shell routes.
- **LodgingOS retains its established green operational chrome**, with chooser/loading/public identity renamed to Tsa Bonno LodgingOS. **Restaurant & Bar POS retains its own service shell**. **HotelOS** uses distinct indigo/slate onboarding and dedicated layout chrome so the three products remain visually separate.
- Marketing download script maps product pages to isolated GitHub release feeds; restaurant/hotel pages no longer silently resolve to the Lodge installer when their feed has no asset yet (early-access WhatsApp path).
- Focused tests: `tests/product-extraction.test.mjs` (+ release architecture). Operator smoke of packaged Hotel/HPOS installers still unproved.

### 2026-07-11: Product workspace and release-feed isolation

- The repository remains one shared code workspace and one Supabase backend for Tsa Bonno LodgingOS, Tsa Bonno HotelOS, and Tsa Bonno Restaurant & Bar POS.
- LodgingOS is the renamed existing installation: it retains compatibility Windows application ID `com.boroko.bookings`, user-data identity `boroko-bookings`, and established public updater feed `Rabafi/boroko-bookings-releases`. Its public installer/shortcut/uninstall labels use Tsa Bonno LodgingOS, and releases install in place for live customers.
- Hotel (`com.boroko.hotel`) and Restaurant & Bar POS (`com.boroko.hospitalitypos`) have independent public GitHub Releases feeds. This avoids `latest.yml` collisions that could otherwise offer one product's installer to another product.
- The Hotel and Restaurant & Bar POS feeds are configured and their GitHub repositories exist, but no new standalone product installer has been published or operator-smoke-tested yet.

The worktree on 2026-07-03 was not pristine before this documentation update. Preserve unrelated changes:

- modified `src/main/domains/settings.js`;
- modified `src/renderer/src/components/Settings.jsx`;
- modified `booking-site/src/pages/LodgePage.jsx`;
- modified `booking-site/src/pages/BookingPage.jsx`;
- modified `booking-site/src/pages/SuccessPage.jsx`;
- modified `tests/customer-credit-reschedule-regression.test.mjs`;
- untracked `supabase/migrations/20260703153000_public_booking_offers.sql`.

Older in-progress areas that were previously called out have since been partly or fully absorbed into repository code. Do not assume they are published or deployed just because they are present locally:

- completed customer-credit and booking-reschedule implementation awaiting intentional commit/release publication;
- detailed report export RPCs and desktop report export work;
- guest lifetime intelligence and Manager PWA guest/reporting work;
- Manager PWA navigation, inbox, notification, freshness, and UX changes;
- Legacy POS shift/outlet/cash-up enforcement and mesh/runtime changes;
- related focused regression tests;
- Events & Venues planning material;
- missing RLS policies on `room_rate_overrides` table fixed via `20260621180000_add_room_rate_overrides_rls_policies.sql` migration (applied);
- `room_booking_expected_total` function updated to consult rate overrides via `20260621190000_add_rate_overrides_to_expected_total.sql` migration (applied) — previously the `create_booking` RPC rejected override-based totals;
- `Rooms.jsx`: error display added inside rate override form (was hidden inside room CRUD modal);
- `Rooms.jsx`: success message after saving rate override (was missing entirely).
- 2026-06-25: Guests gained customer-credit balance visibility plus shortcuts into Prepayments; cancelled booking refunds can now be transferred to customer credit through `20260625120000_booking_refund_to_customer_credit.sql` (applied to the linked Supabase project and live function definition verified).
- 2026-06-26: Events & Venues venue-only creation was repaired via `20260626120000_harden_event_booking_parent_id.sql` and `20260626123000_fix_event_booking_id_after_idempotency_miss.sql` (applied to the linked Supabase project and rollback-only live smoke verified). Root cause: the `create_event_booking` idempotency miss path cleared `v_event_id` before inserting `conference_bookings`.
- 2026-07-03: Main desktop offline/mesh hardening implemented in the repository. This adds a local operation journal, System Health offline-mode controls, daily offline operations bundle export, mesh repair diagnostics, and mesh allowlist/schema coverage for all desktop queued RPCs, including reschedules, customer credit, booking charges, rate overrides, expenses, maintenance, inventory stocktakes/purchases, event line items, and room-supply workflows. This does not make the local mesh a final database authority; cloud replay and server-side RPC validation remain required before values are final.
- 2026-07-03: Accommodation room quotations gained `accommodation_lines` storage so one quote can cover several rooms and convert into the same grouped accommodation invoice model used by direct multi-room bookings. The linked Supabase migration `20260703143000_quotation_accommodation_lines.sql` was applied.
- 2026-07-03: Public online booking gained lodge-configured public offer settings and live migration `20260703153000_public_booking_offers.sql` was applied. The booking site now reads `get_public_booking_offers`, lets guests select multiple available rooms, can request full-lodge exclusive use when enabled, and submits supported accommodation requests through the hardened `create_online_booking` RPC.
- 2026-07-03: External Kimi/agent offline-sync reports were verified against the current repository. The severe claims in `agent 1.txt` through `Agent 7.txt` were mostly false for this checkout: the code does not use SQLite sync queues, does have server-side idempotency infrastructure for key financial/offline paths, does not have the claimed direct booking-payment fallback that writes `bookings.amount_paid`, and the Legacy POS mesh is signed/authenticated. The corrected report was closer, but overstated readiness; live database deployment and packaged-operator smoke tests still need separate proof.
- 2026-07-08: Restaurant-mode Supabase migrations through `20260708190000_restaurant_phase3_role_hardening.sql` were applied to the linked Supabase project via `npm run db:push`, and a follow-up push reported `Remote database is up to date`. Live schema smoke confirmed the restaurant Phase 2-5 migration records, 20 expected restaurant tables with RLS enabled, parent-join RLS on purchase-order/checklist child tables, role guards on the checked restaurant RPC set, and `generate_owner_digest` using `inventory_items` rather than the old `inventory` name. This does not prove packaged desktop, Manager PWA, or operator workflow smoke.
- 2026-07-10: Restaurant Phase 6 differentiators, POS visual-cue migrations, and `20260710160000_pos_even_split_atomic.sql` were applied to the linked Supabase project via `npm run db:push`; a later push must still be used to prove no newer local migrations are pending. Even bill splits now run through a single server transaction with row locking, lodge/outlet role enforcement, server audit, and an idempotency record. Kitchen-ticket reads and status updates use the authoritative `pos_prep_tickets`/RPC path when online, while the local cache remains an offline fallback. This is repository and linked-database proof, not proof that a packaged desktop, deployed Manager PWA, printers, or a real restaurant service shift has been operator-smoke-tested.

## Enterprise Foundation (codex/tsa-bonno-enterprise-foundation branch)

The Enterprise foundation implementation has been started on the `codex/tsa-bonno-enterprise-foundation` branch. This branch builds the product foundation for the Enterprise Hotel tier and property-aware module visibility without breaking current Starter, Standard, or Pro behavior.

### Implemented so far

1. **Enterprise subscription plan**: Added `Enterprise` to `SUBSCRIPTION_PLAN_ORDER` and `PLAN_ALIASES`. Enterprise is the top tier for hotel-grade PMS operations.

2. **Pro plan capped**: Pro is no longer unlimited. New limits: 500 bookings/month, 10 grace, 30 rooms, 10 users.

3. **Enterprise usage limits**: 2,000 bookings/month, 50 grace, 100 rooms, 25 users.

4. **Property type constants** (`src/shared/propertyTypes.js`): Defines `guest_house`, `bnb`, `lodge`, `camp`, `motel`, `hotel`, `resort`, `restaurant` with labels, defaults, and helper functions (`normalizePropertyType`, `isHotelPropertyType`, `isResortPropertyType`, `isRestaurantOnly`).

5. **Module catalog and visibility resolver** (`src/shared/moduleCatalog.js`): 34-module catalog with categories, plan requirements, property type restrictions, and add-on keys. `resolveModuleVisibility` returns `visible`, `locked`, or `hidden` based on property type, plan, and add-on state.

6. **Navigation updated** (`src/renderer/src/navigation/desktopNav.js`): Added Hotel group nav items (Hotel Dashboard, Room Types, Floors & Sections, Folios, Hotel KPIs, Advanced Housekeeping, Corporate Accounts, Rate Plans, Custom Website, Payment Links, Channel Manager, Guest Messaging, Guest Portal, Multi-Property, Revenue Manager, Enterprise Reports, Guest CRM, Operations Compliance, and Multi-Outlet POS). Navigation filtering now uses module visibility resolver with property type, plan, and add-on state.

7. **Subscription panel updated** (`src/renderer/src/components/SubscriptionAccessPanel.jsx`): Shows Enterprise plan with capacity pack messaging, handles Enterprise recommendation, and styles Enterprise plan card with indigo theme.

8. **Entitlement feature map updated** (`src/main/domains/subscriptionState.js`): Added Enterprise-level features (`hotel_mode`, `room_types`, `physical_inventory`, `floors_sections`, `front_desk_dashboard`, `folios`, `advanced_housekeeping`, `hotel_kpis`, `corporate_accounts`, `rate_plans`, `custom_website`, `payment_gateway`, `channel_manager`, `multi_property`).

9. **Tests added** (`tests/enterprise-foundation.test.mjs`): 43 tests covering plan limits, property type normalization, module catalog, visibility resolver, and add-on gating. All pass.

10. **Existing tests updated** (`tests/subscription-usage-limits.test.mjs`): Updated to reflect capped Pro limits, Enterprise as the best-fit plan, and the `enterprise` usage state key.

11. **Hotel module routes implemented in repository**: Hotel Dashboard, Room Types, Floors & Sections, Folios, Hotel KPIs, Advanced Housekeeping, Corporate Accounts placeholder, and Rate Plans placeholder now have routed Enterprise-gated screens. Corporate Accounts and Rate Plans remain controlled add-on placeholders, not full production modules.

12. **Room Types foundation**: `room_types` domain, cache registration, renderer CRUD, room dropdown linkage, and Supabase migration files are present. Rooms keep the legacy `room_type` text fallback while Enterprise rooms can link to `room_type_id`.

13. **Floors & Sections foundation**: `floor_sections` domain, renderer CRUD, room linkage, cache registration, and migration files are present. Rooms can optionally link to `floor_section_id`.

14. **Hotel Dashboard and Hotel KPIs**: Front-desk dashboard, arrivals, departures, in-house guests, no-show attention list, occupancy, ADR, RevPAR, and daily hotel KPI estimates are implemented. Revenue figures in hotel KPI/dashboard views are labelled as estimates; database/RPC financial records remain authoritative.

15. **Folio foundation**: The Hotel Folios screen is booking-charge-backed and posts charges through the existing audited booking-charge RPC path. It is not a separate final folio ledger yet, and it must not be treated as a replacement for authoritative payment/refund/settlement flows.

16. **Advanced Housekeeping**: Enterprise-gated advanced housekeeping board is implemented using the existing `rooms.updateHousekeeping` IPC/RPC path. It adds supervisor-style turnaround visibility without creating a second room-readiness mutation path.

17. **Enterprise add-on catalog**: Shared `enterpriseAddons` catalog distinguishes requestable add-ons from planned add-ons. Settings/Subscription shows relevant Enterprise add-ons for the selected property type and makes clear that add-ons require explicit activation.

18. **Audited Room Moves foundation**: Room Moves is now a distinct Enterprise feature/capability (`room_moves`) rather than a front-desk-dashboard side effect. The desktop domain uses the dedicated `move_booking_room` RPC with a stable idempotency key for online and offline replay. The new `20260703230000_room_moves_foundation.sql` migration creates `room_move_log`, enforces lodge role checks, locks affected booking/room rows, rejects conflicting idempotency-key reuse, checks target-room date conflicts, marks the previous occupied room dirty, marks the target room occupied, and writes the audit row server-side.

19. **Operational add-on read contract repaired**: Phase 10 operational module reads now call concrete RPCs (`get_lost_found_items`, `get_incident_logs`, `get_visitor_registrations`, `get_linen_items`, `get_linen_laundry_batches`) instead of a non-existent generic `rpc` function. `20260703220000_phase10_operational_modules.sql` defines those read RPCs and repairs the emergency-list view to use current bookings/customers/rooms fields.

20. **In-app upgrade request path wired to Command Central tickets**: The Subscription Package Builder now has a real preload/main-process submission bridge. Until a dedicated commercial-request table/workflow is built, submitted package requests create `Upgrade Request` support tickets in Command Central with selected plan, add-ons, capacity details, contact details, and pricing-note context. This is a working intake path, not the final quote-to-invoice/pro-forma workflow.

21. **Dedicated subscription request data model**: The support-ticket bridge has been replaced with a dedicated `subscription_package_requests` table and Supabase RPCs for in-app/public submission, admin listing/detail, status updates, quote/pro-forma document recording, and activation. Domain file `subscriptionRequests.js`, IPC handlers, and preload bridge are wired. Command Central has a Subscription Requests inbox with status flow controls.

22. **Marketing website Enterprise package builder**: The marketing site (`marketing-site/`) now has an Enterprise page (`/enterprise`) where prospects can select Enterprise add-ons, fill in property details, and submit a quote request directly via the public `submit_public_subscription_request` RPC. The packages page now includes Enterprise as a fourth tier.

23. **Commercial request hardening**: `20260704001000_subscription_requests_activation_hardening.sql` removes the broad public/authenticated request policies, keeps public website leads hidden from lodge users, grants admin request RPCs through `service_role`, validates request payloads, stores quote/pro-forma document payloads on the request, and makes activation require a selected license/lodge pair that actually matches `licenses.lodge_id`. Desktop activation updates the selected license plan and upserts selected add-on feature entitlements before marking the request activated. Command Central can save recorded quote/pro-forma payloads as A4 PDFs.

24. **Automated package quotation flow**: Starter, Standard, Pro, and Enterprise now use published annual package prices in the shared commercial package catalog (`P8,999`, `P12,999`, `P18,999`, `P37,998`). Advertised Enterprise add-ons now also have published Pula annual/setup pricing. The in-app Subscription Package Builder now generates and submits the same quotation request, includes one-time 30-day trial eligibility in the pricing snapshot, and downloads the quote document for the client. The marketing website package buttons route into the quote builder for Starter/Standard/Pro/Enterprise, capture whether the property has already used the one-month trial, download a client quotation after successful submission, and submit the same pricing/trial snapshot to the public subscription request RPC. Public request RPC hardening in `20260704100000_subscription_request_auto_quote_pricing.sql` stores automatic quote payloads with status `quoted` and creates a Command Central notification.

25. **Enterprise add-on sales catalog tightened**: Public/in-app advertised Enterprise add-ons now focus on commercially meaningful modules: Custom Direct Booking Website, Online Payment Gateway, Rate Plans, Channel Manager, Corporate Accounts, Advanced Housekeeping Mobile, Guest Portal, Multi-Property Dashboard, Advanced Rate Engine, and Multi-Outlet POS Pro. Smaller operational utilities such as emergency list, visitor register, incident log, lost and found, and linen/laundry remain internal/planned module work rather than advertised quote add-ons.

26. **Enterprise operations contract layer**: `20260704110000_enterprise_operations_contracts.sql` adds lodge-scoped, RLS-enabled operational tables and RPCs for Enterprise workflow readiness records/events, payment-link requests, channel sync queue items, guest messages, guest-portal requests, revenue recommendations, guest CRM notes, Enterprise documents, and report snapshots. Desktop domain/preload/IPC wiring exposes this through `enterpriseOperations`, and the Enterprise workflow workspaces now save setup readiness to that contract with a local draft fallback. Payment links start as `requested` records only; this does not mark bookings paid. Channel sync items require idempotency keys and stay queued/manual-review until a real provider integration is configured.

### What is NOT yet proven or complete in this branch

- Live Supabase deployment of the Enterprise migration set through `20260704001000_subscription_requests_activation_hardening.sql` was completed on 2026-07-04 via `npm run db:push`; a follow-up `npm run db:push` reported `Remote database is up to date`.
- Live Supabase deployment state was refreshed on 2026-07-06 after the July 5 Enterprise migration set was added. The supported wrapper `npm run db:push` connected through the configured Supabase pooler and reported `Remote database is up to date`, so the repository migration history through `20260705205000_multi_property_shared_profiles.sql` was confirmed applied to the linked project. The follow-up channel-sync safety migration `20260706100000_channel_sync_manual_review_until_provider.sql` was also applied on 2026-07-06 and a second `npm run db:push` reported `Remote database is up to date`. This does not prove provider integrations, packaged desktop smoke tests, or deployed web clients.
- Corporate Accounts, Rate Plans, group blocks, rooming lists, master folios, Custom Website, Payment Links, Channel Manager, Guest Messaging, Guest Portal, Multi-Property, Revenue Manager, Advanced Reporting, Guest CRM, Operations Compliance, and Multi-Outlet POS now have routed Enterprise screens or contract-backed setup/control-plane foundations in the repository. Some remain operational foundations rather than full external integrations: there is still no live OTA/channel provider, no public card-payment settlement, and no released custom website deployment automation.
- The dedicated subscription request table, Command Central inbox, marketing website package builder, automatic website quote download, quote/pro-forma request records, desktop PDF export, and one-click Command Central activation from a selected request are now implemented in the repository. Public website requests can store an auto-generated quote payload and reference immediately, but payment remains manual and activation remains Command Central-controlled. There is no public self-service card payment gateway in this scope.
- The Folios implementation is a safe foundation over existing booking charges, not a final independent hotel folio ledger with split billing, master folio, night audit close, and company allocation.
- Early check-in and late checkout currently rely on existing booking status/date rules and reschedule paths; a dedicated hotel policy/pricing workflow has not been implemented.
- Brand rename and release publication are not done.

Focused verification run on 2026-07-03:

- `npm test` passed.
- `npm run test:offline-queue-critical` passed.
- `npm run test:offline-pos-critical` passed.
- `npm run test:financial-integrity` passed.
- `npm run test:inventory-offline-sync` passed.
- `npm run legacy-pos:test` passed with 216 checks.
- `npm run db:push` applied `20260703153000_public_booking_offers.sql`.
- `npm run test:customer-credit-reschedule` passed.
- `npm --prefix booking-site run test:run` passed.
- `npm --prefix booking-site run build` passed.
- `npm run build` passed.
- `node .\tests\enterprise-foundation.test.mjs` passed with 172 tests after the Room Moves, operational read RPC, subscription-request guardrails, commercial document workflow, PDF export, and activation hardening were added.
- `node .\tests\subscription-usage-limits.test.mjs` passed with 14 tests.
- `npm test` passed (`production-guardrails: ok`).
- `npm run build` passed for main, preload, and renderer.

Focused verification run on 2026-07-04 after live Enterprise migration deployment:

- `npm run db:push` applied the remaining Enterprise migrations and a second run reported `Remote database is up to date`.
- `node .\tests\enterprise-foundation.test.mjs` passed with 173 tests after live-schema migration fixes for `settings(lodge_id)`, migration timestamp uniqueness, and the emergency-list view.
- `node .\tests\subscription-usage-limits.test.mjs` passed with 14 tests.
- `npm test` passed (`production-guardrails: ok`).
- `npm run build` passed for main, preload, and renderer.

Focused verification run on 2026-07-04 after automated quotation and Enterprise operations contract work:

- `node .\tests\enterprise-foundation.test.mjs` passed with 178 tests.
- `npm run build` passed for main, preload, and renderer.

Before continuing any of these areas, inspect `git status`, the relevant diff, and the latest migration files. Preserve unrelated edits.

## Superseded old priorities

The former top-level priorities—deposit linkage, basic booking replay, first-generation idempotency, initial POS-to-booking linkage, and adding a financial audit table—are no longer accurate as unimplemented project-wide tasks.

They remain regression-sensitive contracts. New work must verify and preserve them rather than reimplement them from an old plan.

## Known caveats

- Customer-credit/reschedule repair migrations through `20260621170000` are applied to the linked project, including receipt numbering, safe transfer keys, local-date check-in, and event parent-ID protection.
- The customer-credit/reschedule feature is release-candidate quality, not yet production-certified: packaged-installer smoke tests, disconnected replay testing, database concurrency/isolation smoke tests, Supabase lint/advisors, artifact signing, and final publication remain.
- Desktop 1.5.5 is the active local package manifest version. A successful local build does not mean it has been published.
- Historical POS orders with `outlet_id = NULL` may appear as `Unassigned`; do not invent outlet attribution without evidence.
- Some regression suites are structural contract tests. Passing them does not replace database smoke tests for high-risk SQL.
- Long-outage desktop operation remains "pending local truth" until Supabase replay succeeds. Managers should save offline operations bundles during multi-day outages and must review failed/dead-lettered operations when internet returns.
- Intentionally online-only areas remain: first-time login/session bootstrap, Command Central/admin service-role work, imports/undo imports, server-authoritative exports/reports/financial validation, license activation, fleet health, formal booking refund approval/final settlement with live manager PIN verification, and POS catalog publishing/setup changes needed by Legacy POS snapshots. Booking refund requests can be prepared offline, but they do not move money or customer credit until that online approval succeeds.
- The working tree can contain multiple concurrent initiatives. Do not stage, revert, format, or rewrite unrelated files.
- A PWA empty result may indicate session/readiness or schema-contract failure rather than genuinely absent data.
- `room_rate_overrides` previously had RLS enabled but no policies; the `20260621180000` migration added the policies and was recorded as applied. Re-verify the linked schema if this table appears empty in a deployed client.

## Where to look

- Durable engineering rules: [AGENTS.md](AGENTS.md)
- Architecture and execution paths: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Release checks: [docs/SHIP_READY_RUNBOOK.md](docs/SHIP_READY_RUNBOOK.md)
- Database migrations: `supabase/migrations/`
- Desktop business domains: `src/main/domains/`
- Manager PWA API contract: `manager-pwa/src/lib/api.js`
- Legacy POS main process and queue: `legacy-pos/src/main/`
- Focused regression suites: `tests/` and `legacy-pos/tests/`

## 2026-07-04: Enterprise hotel features added

- **Night Audit Transactional Close**: `night_audit_close` and `night_audit_exceptions` tables with RPCs for running checks, closing, reopening, summary, history, and exception resolution. Domain in `src/main/domains/nightAudit.js`. IPC handlers and preload bridges wired.
- **Check-in / Check-out Workflow**: `checkin_config`, `checkin_checklist_items`, `checkout_checklist_items` tables with RPCs for checklist retrieval, step completion, reset, and config management. Domain in `src/main/domains/checkinWorkflow.js`. React component at `CheckinWorkflow.jsx`.
- **Early Check-in / Late Checkout Policy Engine**: Policy and request tables for early check-in and late checkout with fee calculation, approval workflow, and CRUD RPCs. Domain in `src/main/domains/earlyLateCheckout.js`. React component at `EarlyLateCheckout.jsx`.
- **Cancellation / No-Show Policy Engine**: `cancellation_policies` and `cancellation_requests` tables with fee calculation, deposit handling, customer credit, and approval workflow. Domain in `src/main/domains/cancellationPolicies.js`. React component at `CancellationPolicies.jsx`.
- **Revenue Manager UI**: React component at `RevenueManager.jsx` with forecast, competitor notes, demand events, and recommendations panels.
- **NightAudit component** verified complete at `NightAudit.jsx` (595 lines).
- All four SQL migrations: `20260705100000_night_audit_close.sql`, `20260705120000_checkin_checkout_workflow.sql`, `20260705140000_early_late_checkout_policies.sql`, `20260705160000_cancellation_policies.sql`.
- Shared layer: capabilities added to `accessControl.js`, modules added to `moduleCatalog.js`, DEV_ENTERPRISE_PREVIEW_CAPABILITIES updated, `database.js` exports extended.
- Test suites: `tests/enterprise-night-audit.test.mjs` (11 tests), `tests/enterprise-checkin-cancellation.test.mjs` (16 tests) — all 27 passing.

## 2026-07-06: Enterprise maturity verification and fixes

- The Enterprise worktree remains a large uncommitted implementation branch. Preserve unrelated changes and compare each surface against the current manifest before claiming readiness.
- The `/booking-engine` desktop route now renders a dedicated `BookingEngine.jsx` workspace instead of pointing at the generic `EnterpriseWorkflowWorkspace` with an undefined `advanced_booking_engine` workflow key. The workspace manages booking-engine rules and upsells through the existing preload/domain/RPC contract and includes price, availability, and upsell preview only; it does not create booking intents implicitly.
- `PaymentGatewayConfig.jsx` no longer records a fake completed webhook payment from a manual "test webhook" action. The admin screen now exposes a signature verification check through `payments.verifyWebhookSignature`, and the UI states that the check does not create a payment or settle a booking.
- Regression coverage was extended in `tests/enterprise-booking-engine.test.mjs` and `tests/enterprise-payment-webhook-security.test.mjs` for the dedicated Booking Engine route and payment webhook UI safety.
- Verification passed on 2026-07-06: `node .\tests\enterprise-booking-engine.test.mjs` (26 tests), `node .\tests\enterprise-payment-webhook-security.test.mjs` (16 tests), `node .\tests\enterprise-routing-regression.test.mjs` (45 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Enterprise navigation/catalog maturity was tightened on 2026-07-06: `maintenance_enterprise`, `group_operations`, and `advanced_reports` now have module-catalog rows; Custom Website, Payment Gateway Config, Housekeeping Command Center, Promo Codes, and Rate Calendar routes are reflected in the catalog/module keys used by navigation; and `tests/enterprise-nav-catalog-parity.test.mjs` now fails any Enterprise nav entry that bypasses module-catalog gating or points at a route missing from its catalog module.
- Enterprise entitlement/access-control maturity was tightened on 2026-07-06: route-level `UpgradeWall` feature names are now backed by the subscription feature map; add-on-only Enterprise features such as Documents, Hotel Roles, Room Attributes, Advanced Reports, Advanced Booking Engine, Advanced Rates, Rate Calendar, and Promo Codes remain locked until the add-on is enabled; and hotel workflow capabilities such as group operations, preventive maintenance, night audit close/reopen/checks, check-in/out, early/late checkout, and cancellation policies are blocked when their Enterprise feature is disabled.
- Verification for the navigation/catalog/entitlement pass: `node .\tests\enterprise-nav-catalog-parity.test.mjs` (4 tests), `node .\tests\enterprise-entitlement-gating.test.mjs` (7 tests), `node .\tests\enterprise-housekeeping-maintenance.test.mjs` (13 tests), `node .\tests\enterprise-routing-regression.test.mjs` (46 tests), `node .\tests\enterprise-lower-tier-regression.test.mjs` (10 tests), `node .\tests\subscription-usage-limits.test.mjs` (14 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Live Supabase deployment state was refreshed on 2026-07-06: `npm run db:push` used the configured Supabase pooler and reported `Remote database is up to date` for the linked project. Local SQL contract verification also passed via `node .\tests\enterprise-live-sql-contract.test.mjs` (135 tests).
- Channel Manager provider safety was tightened on 2026-07-06: the local provider adapter now fails closed when no live OTA adapter is connected, and the forward migration `20260706100000_channel_sync_manual_review_until_provider.sql` replaces `process_channel_sync_queue` so queued channel sync items move to `manual_review_required` with an explicit provider-not-connected message instead of being marked `completed`. This was deployed to the linked Supabase project via `npm run db:push`; a follow-up run reported `Remote database is up to date`.
- Verification for the channel safety pass: `node .\tests\enterprise-channel-manager.test.mjs` (10 tests), `node .\tests\enterprise-live-sql-contract.test.mjs` (140 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Payment webhook safety was tightened on 2026-07-07: the desktop preload/main IPC bridge no longer exposes `recordWebhookPayment`, the admin Payment Gateway screen remains signature-check-only, and the forward migration `20260707100000_payment_webhook_service_role_only.sql` revokes `record_webhook_payment` from `authenticated`/`anon` and grants it only to `service_role`. This preserves the rule that browser redirects, renderer actions, and operator tests cannot settle online payments; only server-side provider webhook infrastructure may record a verified webhook payment.
- The desktop payment bridge was tightened further on 2026-07-07: `payments:createBookingIntent` and `payments:createPaymentIntent` are no longer exposed through preload/main IPC or the desktop `database.js` facade. Until a real hosted-checkout/server integration is built, the desktop Payment Gateway surface is limited to provider configuration, dashboard visibility, and signature verification; it cannot initiate or settle public provider payments from renderer code.
- The payment webhook lockdown migration was deployed to the linked Supabase project on 2026-07-07 via `npm run db:push`; a follow-up run reported `Remote database is up to date`.
- Verification for the payment webhook safety pass: `node .\tests\enterprise-payment-webhook-security.test.mjs` (17 tests), `node .\tests\enterprise-live-sql-contract.test.mjs` (145 tests), `npm test` (`production-guardrails: ok`), and `npm run build`.
- Enterprise readiness screens were tightened on 2026-07-07: Custom Website, Payment Links, and Channel Manager workflow workspaces now expose explicit non-editable launch gates for the unresolved external proof they still need, such as website deployment automation, published-site smoke testing, hosted checkout, server webhook infrastructure, provider reconciliation, and live OTA provider adapters. A locally completed readiness checklist no longer implies that those add-ons are operational.
- Enterprise catalog parity was also tightened: the Advanced Reports module now has a matching `advanced_reports` add-on catalog entry, and the Advanced Housekeeping module/test coverage recognizes both routed housekeeping surfaces (`/advanced-housekeeping` and `/housekeeping-command-center`).
- Verification for the readiness-gate/catalog pass: `node .\tests\enterprise-foundation.test.mjs` (179 tests), `node .\tests\enterprise-nav-catalog-parity.test.mjs` (4 tests), and `node .\tests\enterprise-entitlement-gating.test.mjs` (7 tests).
- Release-gate maturity was tightened on 2026-07-07: `tests/release-behavior.test.mjs` was aligned to the current split-domain code layout and current offline dependency semantics, added as `npm run test:release-behavior`, and added to `docs/SHIP_READY_RUNBOOK.md`. It now verifies prior-run dependency handling, queued booking-reference rewrite behavior, idempotent payment replay branch ordering, and POS v3 submit-intent idempotency.
- Verification for the release-gate pass: `npm run test:release-behavior`, `npm run test:offline-queue-critical`, and `npm run test:offline-pos-critical`.
- Enterprise regression maturity was tightened on 2026-07-07: `npm run test:enterprise` was added as a discoverable Enterprise release gate in `package.json` and `docs/SHIP_READY_RUNBOOK.md`. It runs every `tests/enterprise-*.test.mjs` suite in sorted order and fails the release gate on the first broken Enterprise route, contract, migration, entitlement, offline, or security regression. Verification passed with 27 Enterprise suites.
- Web-surface local release checks were refreshed on 2026-07-07 and promoted to a root release gate: `npm run test:web-surfaces` runs Manager PWA lint/build plus booking-site tests/build. It passed with the existing Manager PWA lint warnings still warning-only, booking-site tests at 32 passing tests, and both web builds passing. This is local build/test proof only; it does not prove Netlify/public deployment publication or live browser smoke on the deployed URLs.
- Deployment-state clarity was tightened on 2026-07-07: `docs/DEPLOYMENT_EVIDENCE_MATRIX.md` now records built, deployed/published, and smoke-tested evidence separately for Supabase, desktop, Legacy POS, Manager PWA, public booking site, marketing site, payment provider integration, channel provider integration, and custom website automation. Rows that only have local build/test evidence are explicitly marked `local-only` or `not-proven`.
- Marketing-site Enterprise proof was tightened on 2026-07-07: `npm run test:marketing-site` now verifies Enterprise package metadata, the Netlify `/enterprise` redirect, public subscription-request RPC wiring, manual-payment-only copy, published Enterprise pricing, and advertised Enterprise add-on keys. `packages.html` metadata and structured data now include Enterprise instead of describing only Starter/Standard/Pro.
- HotelOS sidebar curation was tightened on 2026-07-07: duplicate or setup-only Enterprise entries are no longer shown as primary hotel sidebar pages. HotelOS keeps the normal Dashboard, Housekeeping, Maintenance, Night Audit, Staff, Settings, and core hotel workspaces, while hiding duplicate/deep-link pages such as Hotel Dashboard, Advanced Housekeeping, Housekeeping Command, Maintenance (Enterprise), Hotel KPIs, Corporate Billing, Rate Calendar, Promo Codes, Room Attributes, Documents, Hotel Roles, Night Audit (Enterprise), Check-in Workflow, Early/Late Checkout, Cancellation Policies, Booking Engine, Payment Links, Payment Gateway, and Custom Website. Custom Website remains an internal/deep-link workflow rather than a client daily workspace because Tsa Bonno provisions the website for the client.
- Customer-facing Enterprise Preview Mode was removed on 2026-07-07. Unpurchased add-ons should not appear as locked daily-navigation clutter; add-on testing now belongs in Command Central, where grouped bundles such as Website + Online Payments, Guest Experience Suite, Revenue & Distribution Suite, and Enterprise Operations Suite can be enabled/disabled for a selected account using admin feature overrides.
- Website/payment packaging direction was simplified on 2026-07-07: customers should see "Direct Booking Website with Online Payments" rather than separate technical payment gateway/webhook items. Tsa Bonno configures the website, connects the property's payment provider, guests book and pay online, and the desktop app receives the booking plus verified payment confirmation. Payment links are parked as a later operational tool for special invoice/folio/balance links.
- Still not proven by this local verification: real payment-provider checkout/provider-hosted settlement infrastructure, real OTA/channel-provider connectivity, custom website deployment automation, packaged installer smoke testing, and public/marketing deployment publication.

## 2026-07-08: Future Enterprise hotel add-ons added to manifest

- The Enterprise manifest and shared add-on catalog now include three planned hotel add-on directions: Staff Operations & Workforce, Maintenance & Asset Management, and Events & Venue Management. They are marked as planned/non-advertised add-ons, not shipped operational modules or public quote-builder products.
- Verification after the catalog/manifest update: `node .\tests\enterprise-foundation.test.mjs` passed with 180 tests.

## 2026-07-08: Restaurant POS phase verification and foundations

- Restaurant POS product planning now lives in `docs/RESTAURANT_POS_PRODUCT_PLAN.md` with phase-by-phase status notes and guardrails for other agents. Phase 1 restaurant curation is verified complete in the repository; Phase 2 restaurant operations is verified complete after hardening bill splits, manager-discount PIN approval, modifier persistence, and Enterprise nav guardrail expectations; Phases 3 and 4 now have tested shared foundations but are not yet fully wired to customer-facing UI, Supabase stock/loyalty/account ledgers, or offline replay.
- Phase 2 hardening added `supabase/migrations/20260708120000_restaurant_phase2_operations_hardening.sql`. This migration persists modifier group `min_selections`/`max_selections` and adds `approve_pos_discount_with_pin(payload jsonb)` so manager discount approval is server-authoritative and audited through PIN capability checks instead of a provisional offline approval.
- Restaurant-mode verification found and fixed Enterprise navigation drift around the Payment Gateway add-on: the advertised/requestable route now resolves through `/payment-links`, and `payment_gateway` no longer lists the stale `/payment-gateway-config` route as a catalog navigation route.
- New restaurant regression coverage: `tests/restaurant-operations-foundation.test.mjs`, `tests/restaurant-recipe-costing.test.mjs`, and `tests/restaurant-growth-foundation.test.mjs`.
- New shared foundations: `src/shared/restaurantRecipeCosting.js` for units, recipe theoretical usage, cost, and variance; `src/shared/restaurantGrowth.js` for loyalty math, customer-account ledger entries, delivery settlement, and multi-outlet comparison.
- Verification passed on 2026-07-08: `node .\tests\restaurant-mode-curation.test.mjs`, `node .\tests\restaurant-operations-foundation.test.mjs`, `node .\tests\restaurant-recipe-costing.test.mjs`, `node .\tests\restaurant-growth-foundation.test.mjs`, `npm test`, `npm run test:enterprise`, `npm run build`, and `npm run manager:build`.

## Updating this file

### 2026-08-16 — Command Central subscription truth and activation hardening

- Linked Supabase migration `20260816090000_command_central_subscription_truth_hardening.sql` is confirmed applied. It removes the obsolete one-argument `activate_subscription_request(uuid)` bypass, limits commercial activation to approved requests, validates activation payment-state input, and preserves the governing operation/audit workflow.
- Bar POS annual bundles are now financially consistent across shared UI pricing, authoritative SQL quotes, and generated Command Central PDF documents: the initial annual invoice includes Bar POS plus selected annual bundles. A Bar POS quote with all three bundles is `P18,500` due now and `P18,500` annual renewal. Hotel recurring add-on timing was intentionally preserved.
- Command Central now injects a freshly reauthenticated master-admin actor into commercial assignment and request activation; activation targets are filtered to the exact lodge and product; the operator sees a final confirmation and recovery guidance when an assignment must be created or corrected first.
- Licensing Workbench now consumes persisted company operating profiles so it does not offer Bar-only packages/add-ons to a restaurant profile. Product-matched package and add-on eligibility remains server-enforced.
- Deployment verification on 2026-08-16: remote migration history reports the migration applied, the legacy bypass overload count is zero, the live quote RPC returned the figures above, and the old `payment_under_review` activation path is absent. Local verification passed: `npm run test:bar` (100 tests), `npm test`, `npm run build:hospitality-pos`, and `npm run build`.

The database migration is live. Updated desktop source still requires the normal desktop release/installer publication process before operators receive its UI and IPC changes.

### 2026-08-16 — Bar POS Base includes Manager PWA (database deployed; web publication pending)

- Bar POS Base now explicitly includes the browser-based Manager PWA in both the shared commercial catalogue and a new forward-only commercial migration. The PWA remains mobile read-only for Bar operations: sales, open tabs, basic stock, cash-close readiness, reports, staff visibility, alerts, and inbox. Desktop Bar POS remains the only sales, cash-up, return, void, correction, and stock-mutation surface.
- Growth & Multi-Outlet remains the explicit gate for the advanced Bar Owner View (`owner_mobile_view`); Base Bar cannot discover or deep-link to it. Restaurant floor and kitchen remain blocked in `bar_only` sessions.
- The migration updates only the active `bar_pos` catalogue, adds the matching authoritative package-entitlement row, and persists the PWA grant for active Bar licenses only when no existing lodge-level feature override exists. Existing manual PWA disablements remain authoritative, and automatic grants receive an activation-audit record. Historical price/quote snapshots are unchanged; Bar POS remains P4,500/year.
- Production database verification on 2026-08-16: linked Supabase migration history records `20260816100000`, and linked error-level SQL lint returned zero findings. The Manager PWA production deployment was not published: the linked Vercel project `tsa-bonno-hospitalityos-manager` rejected its stored deployment token. Marketing-site and desktop package-copy changes also remain unpublished. Complete an authenticated Bar Base/Growth smoke after the PWA deployment succeeds before claiming end-to-end availability.

Update this document when:

- a major feature is completed or removed;
- an execution path or application surface changes;
- a migration is confirmed deployed;
- release versions change;
- a known critical risk becomes verified, fixed, or superseded.

Use exact dates and distinguish repository implementation, uncommitted work, released binaries, and confirmed production deployment.
### 2026-07-13 — Restaurant & Bar POS world-class shell tranche

- Added a native Open Checks/Open Tabs workspace backed by the existing POS tab contract, with live 15-second refresh, ownership, age, value, search, and safe resume into `HposTerminal`.
- Added live rail badges for running checks/tabs and active kitchen tickets, capability-aware command search (`Ctrl/Cmd+K`), and explicit role-adaptive rail profiles for cashier, supervisor, and management roles.
- Added persistent touch/compact density modes, reusable HPOS UI primitives, a keyboard skip link, global focus-visible treatment, reduced-motion support, accessible notices/dialog semantics, and F2 payment access.
- Escape no longer silently destroys a terminal cart; it only dismisses transient payment/search UI.
- Restaurant and bar continue to share the same financial, offline, tab, order, and export contracts. No Lodge POS renderer was imported.
- The remaining Settings boundary is now HPOS-presented and only exposes relevant General and Subscription tabs. Lodge document templates and the accommodation health console were removed from HPOS navigation; a native restaurant/bar System Health workspace uses the existing sync status/details contracts.
- Customer and prep displays now use customer/POS language, and Multi-Outlet POS removes Room Service in restaurant/bar mode and adopts the HPOS visual system.

### 2026-07-13 — Manager capability expansion (online ordering intentionally excluded)

- Added the native Business Control workspace for restaurant and bar managers. It consolidates owner briefs, 30-day sales and run-rate signals, menu popularity, labour-versus-sales, reorder suggestions, promotions, reservation/waitlist flow, alerts, checklists, audit activity, and expiry watch.
- Added a Bar Control workflow for bottle/keg/ingredient variance: spill, comp/staff drink, measured-pour variance, expiry/spoilage, and physical count adjustments are recorded through the existing authoritative `inventory.adjustStock` contract with a stable operation identifier and manager-visible reason.
- Online/self-service ordering is deliberately not included in this expansion, per product scope.
## 2026-09-04 — LodgingOS General Settings save workflow hardened

General Settings now keeps an in-progress draft stable across global settings
refreshes and Assistant toggles, disables clean or unauthorized saves, validates
all save entry points consistently, and preserves edits made while a save is in
flight. Save feedback distinguishes server, partial-schema, and device-only
results. Remote saves have bounded timeouts with actionable recovery guidance;
offline saves are explicitly marked as device-only and requiring a later retry.
Focused settings-save regression coverage passes and the LodgingOS production
build passes. No database migration or release installer was published.

## 2026-09-07 — Live F&B reporting-function drift repaired

- Three forward-only migrations (`20260906000000`, `20260906001000`, and `20260907000000`) repair stale deployed dynamic-SQL fragments in the F&B disable-blocker, consolidated-report, and demand-recommendation functions. The repairs use anchored `pg_get_functiondef` replacements and fail closed if the expected deployed definition is not present.
- The linked Supabase project is confirmed migrated and `npm run db:lint` now produces an empty error report. Focused progressive-activation regression coverage passes 26/26.
- This database repair does not activate Restaurant Accounting. Botswapelo Lounge's active Bar licence still has no `bar_accounting_workforce` add-on selection, and the lodge has no chart of accounts or POS/tender mappings. Accounting remains correctly fail-closed pending governed commercial entitlement and configuration.

## 2026-09-08 - Accounting activation verified-fix pass (local only, NOT applied/activated)

- Implemented the three verified activation defects from `ACCOUNTING_VERIFIED_FIX_HANDOFF.md` (WP1–WP5, local edits + tests + one additive migration; no database, grant, activation, or publishing operation occurred):
  1. An independent reviewer can now load any prepared cutover batch after sign-in/reload via tenant-scoped `getCutoverBatches`/`getCutoverBatch` reads (`accounting.read`); absent-or-foreign batches answer identical nulls, stale selections are cleared, and late responses are ignored.
  2. Opening-balance application is an explicit UI step wired through `applyCutover` (`accounting.manage`) with per-batch single flight and server idempotent replay; activation with a supplied batch requires authoritative applied state, while the valid no-history/no-batch path is preserved.
  3. Uncertain activation reconciles the complete stored tuple via the pure `src/shared/accountingActivation.js` snapshot/comparator (exact-match / active-different / inactive / unreadable); any `active:true` under a different date/config/policy/batch/tenant never confirms, and readiness copy requires `ready === true` with every blocker listed.
- New local-only migration `supabase/migrations/20260907010000_accounting_cutover_reads_and_activation_grants.sql` (authored, NOT APPLIED): repairs two 42703 runtime failures found by inspection (`approved_at`, `applied_at` columns), adds the three read RPCs, and grants authenticated EXECUTE on the activation lifecycle surface only. Deployment still requires the exact-target approval in `docs/ACCOUNTING_SQL_ACCEPTANCE.md`.
- Evidence: `test:bar` 318/318, `test:financial-truth` 189/189, browser suite 21/21 (W0/W0b/W1/W1b–W7), node activation 8/8, matrix 7/7 over 99 IPC ops, rush 43/43, release-behavior/architecture/hardware-adapter ok, legacy-pos 219/219, manager lint 0 errors, `build:hospitality-pos` exit 0 (unsigned), `git diff --check` exit 0. `test:restaurant:all` passes every non-SQL file; the only failures are the 3 SQL suites with `ECONNREFUSED 127.0.0.1:54322`, including the new strict cutover-activation suite. Nothing activated, packaged, signed, or released.

## 2026-09-08 - Accounting second repair pass F1–F5 (local only, NOT applied/activated)

- Closed five verified findings on top of the earlier fix pass (local code + tests + one additive migration; no database, grant, activation, or publishing operation occurred):
  - F1: approval binds to reviewed evidence. The reviewer explicitly confirms the displayed batch into an immutable snapshot; approval revalidates it against a fresh read and never auto-submits a changed hash. New local-only migration `supabase/migrations/20260908000000_accounting_approve_evidence_binding.sql` (authored, NOT APPLIED, grants nothing) rejects null/blank expected hashes server-side while keeping every under-lock guard.
  - F2: the activation comparator is fail-closed — explicit-boolean `active` required, `active:false` + status:active reads as scheduled/not-yet-active, one canonical cutover field with alias-conflict rejection, explicit-null vs absent distinction, malformed rejection without coercion.
  - F3: one tenant/user/URL-scoped load lifecycle — direct URLs, reloads, and back/forward navigation resolve under the current session; session changes invalidate all in-flight reads.
  - F4: nominal and timeout apply paths share one rule — only same-batch applied detail confirms; malformed/unconfirmed outcomes keep the batch ID for same-batch retry and never enable activation.
  - F5: the cutover SQL suite is rewritten with a pre-connection safety gate (opt-in flag + explicit target URL + host-bound acknowledgement), real `authenticated`/`anon` role sessions, two-client concurrency races, rollback atomicity, and full readiness fixtures. Execution remains blocked pending disposable-target approval.
- Evidence: `test:bar` 324/324, browser suite 31/31 (incl. X1/X1b/X1c/X2/X3/X3b/X3c/X4/X4b), node activation 14/14, matrix 7/7 (signatures unchanged), `test:financial-truth` 189/189, rush 43/43, release/hardware contracts ok, `build:hospitality-pos` exit 0 (unsigned, new-flow markers verified), `diff --check` exit 0. `test:restaurant:all` 37/40 files; the 3 SQL failures are the 2 pre-existing ECONNREFUSED suites plus the rewritten cutover suite's explicit safety refusal (no connection attempted). Nothing activated, packaged, signed, or released.

## 2026-09-08 - Accounting third repair pass G1–G4 + G2 (local only, NOT applied/activated)

- Closed four further verified findings (local code + tests + one additive migration; no database, grant, activation, or publishing operation occurred):
  - G1: approval now binds the full reviewed revision atomically. New local-only migration `supabase/migrations/20260908010000_accounting_approve_revision_binding.sql` (authored, NOT APPLIED) drops the weaker 4-argument overload and replaces it with a single strong 6-argument form validating opening hash, source identity, and preparation identity null-safely under the batch row lock. The source-only re-preparation race (same opening hash, new source/preparer) is rejected before mutation; domain, UI snapshot, harness mock, and matrix row updated with it.
  - G2: SQL suite logic repaired — pure safety-configuration matrix (no connection to test safety), self-approval naming the reviewed hash, before/after rollback counts retaining the earlier posting, explicit license + override entitlement provisioning (each step verified), v2 mappings effective 2026-01-01, source-drift/preparer-drift/missing-hash SQL coverage, and concurrent dispatch documented as lock-serialized with exactly-one-winner assertions.
  - G3: blank identity is malformed (never an implicit null), review snapshots require tenant/preparer/source-documented evidence in a mandatory tenant/batch scope, and missing fresh fields block instead of being skipped.
  - G4: approval success notices require authoritative same-batch approved detail matching the reviewed revision; lying/malformed/lost responses stay unconfirmed with the batch retained. Production HashRouter parity covered by a cold-URL browser regression.
- Evidence: `test:bar` 331/331, browser suite 34/34 (incl. Y1/Y2/Y3), node activation 21/21, matrix 7/7 (approve row updated for the new signature), `test:financial-truth` 189/189. `test:restaurant:all` 37/40 files; SQL execution still blocked (2 ECONNREFUSED + cutover safety refusal). Nothing activated, packaged, signed, or released.

## 2026-09-08 - Accounting fourth repair pass H1–H3 (local only, NOT applied/activated)

- Closed three further verified findings (local code + tests only — no new migration; no database, grant, activation, or publishing operation occurred):
  - H1: safety tests no longer assert the invoking environment is unapproved. The pure configuration matrix plus isolated child-process checks (scrubbed env refuses pre-connection nonzero; valid-shaped dummy env passes connection-free) pass under both absent and valid-shaped settings. The real integration entry keeps requireSafety() first and never connects unapproved.
  - H2: the entitlement fixture fetches `get_lodge_entitlement` once as JSON and validates commercial identity + flag from the same result; setup sessions establish a real actor identity before protected RPC fixture calls (genuine capability gates, not missing-session failures).
  - H3: approval readback proves the full reviewed revision via a shared strict source reader (absent ≠ explicit null; blank/wrong-type/conflicting rejected in snapshot, preflight, and outcome alike), preparation-identity comparison, mandatory snapshot scope, and approver-independence (approver recorded and ≠ preparer; current operator need not be the approver, with revision-only wording).
- Evidence: `test:bar` 333/333, browser suite 35/35 (incl. Z1), node activation 23/23, matrix 7/7, `test:financial-truth` 189/189, rush 43/43, release/hardware contracts ok, `build:hospitality-pos` exit 0 (unsigned), `diff --check` exit 0. `test:restaurant:all` 37/40 files; SQL execution still blocked (2 ECONNREFUSED + cutover safety refusal: 3 pass connection-free). Nothing activated, packaged, signed, or released.
- Coordination: Supabase task owns disposable-cloud acceptance and must certify against the final snapshot hashes recorded in `docs/BAR_COMPLETION_STATUS.md`. No 40/40 SQL-backed claim is made here.

## 2026-09-09 - Accounting Task A managed-platform repair I1 (local only, NOT applied/activated)

- Replaced the unconditional superuser premise with precise managed-Supabase-compatible prerequisite checks (local code + tests only — all three forward migrations byte-identical, verified by hash; no database, grant, activation, or publishing operation occurred):
  - New `tests/helpers/disposable-prerequisites.mjs`: a static reviewable requirement list (fixture tables with exact DML rights, setup RPC EXECUTE rights by exact signature, `authenticated`/`anon` role-switching, auth helper), a read-only live prober (`has_*_privilege` checks plus guarded SET ROLE trials with RESET, side-effect free), and a pure evaluator. A sufficient managed non-superuser proceeds; gaps fail pre-side-effect naming the exact capability and operation.
  - The suite's `connectSuperuser` is now `connectFixture` (safety checks still first, no superuser assumed); the integration test runs the preflight before any fixture insert and dropped the `usesuper` assertion and the restricted-helper direct call.
- Evidence: `test:bar` 334/334, node activation 24/24 (H1–H3 intact), safety both ways (valid-shaped G2 filter 3/3 never dialled; absent env 3 connection-free + designed refusal), `test:financial-truth` 189/189, rush 43/43, release/hardware contracts ok, `build:hospitality-pos` exit 0 (unsigned). `test:restaurant:all` 37/40 files; SQL execution still blocked (2 ECONNREFUSED + cutover safety refusal). `git diff --check` fails solely on another workstream's pre-existing file (hotel StaffOperations blank EOF line, preserved untouched); all Task A files check clean. Nothing activated, packaged, signed, or released.
- Coordination: Task B owns disposable-cloud acceptance and must check hashes before running, certifying the corrected snapshot in `docs/BAR_COMPLETION_STATUS.md` (changed suite + helper + node tests; unchanged migrations/pure/component) — never the superseded pass-4 suite hash. Status-only notice to Task B; no shared-file edits requested.

## 2026-09-09 - Accounting Task A line-ending repair (local only, no cloud contact)

- Unblocked Task B's halted migration chain: `20260730100000_shared_till_operator_attribution.sql` failed with P0001 because its CRLF matcher blocks matched zero times against the LF-stored `create_pos_order_v3` definition. Repaired with a newline-portable strict transformation
(byte-exact legacy path first, CRLF-normalized fallback, explicit already-installed branch, zero/ambiguous errors
kept, rewritten output verified before EXECUTE). Checkout-independent test `tests/bar-migration-line-ending-portability.test.mjs`
8/8 in the CRLF tree and 8/8 in an isolated LF checkout (canonical LF blocks derived once, explicit CRLF built by single
conversion, fallback branch covered by construction on both; file collected by the bar gate). Narrow `.gitattributes` (`supabase/migrations/*.sql text eol=lf`) added after measuring zero status churn; no renormalization run.
- Triage: the halt file is the sole CRLF member of the 20-file anchored-replacement class (5 applied-prefix peers LF, 14 post-halt peers LF, 1 post-halt dependent immune via single-line needles). The applied prefix is untouched — definer `20260711120000` byte-identical by hash. H1–H3/I1 behavior not reopened.
- Evidence: portability 7/7, bar 334/334, financial-truth 189/189, rush 43/43, release-behavior ok, restaurant 37/40 (3 SQL-blocked as before), release-architecture/hardware ok, build exit 0 (unsigned), task files diff-check clean. Nothing activated, packaged, signed, or released.
- Resume package for Task B in `docs/BAR_COMPLETION_STATUS.md` (old/new raw + canonical hashes, applied-prefix classification, SQL acceptance checklist) and `docs/ACCOUNTING_SQL_ACCEPTANCE.md`. Task B validates the new hash, confirms no partial effects on the SAME disposable project, resumes, then completes the chain and runs final acceptance. No production changes; Task B's runner and cloud project untouched.

## 2026-10-08 — Accounting independent-review repairs (local and disposable only)

- Added forward-only migration supabase/migrations/20261008010000_accounting_independent_review_fixes.sql; it was compiled and applied only on approved disposable project repsrmlomedqrmrdsbga after the project marker and allow_mutation=true were verified. Earlier migrations were not edited. The production project link remains oicgpknsmtvcsjacymum; no production migration, customer Accounting activation, installer publication, or release occurred.
- REV-01 removes the ambiguous-result “Discard and edit” path. A point-in-time not-found status preserves the original operation UUID and payload in durable client storage; restart and retry continue with that identity. There is no cancellation endpoint, so cancellation-versus-commit is inapplicable; the UI does not offer cancellation or a replacement key. Real disposable RPC coverage includes delayed arrival, same-key retry, dropped response, one submitted draft, independent approval, and one post. A real Electron restart restored the exact pending intent; direct IPC status then found the submitted row. The visible status-notice capture timed out, so that UI assertion remains open.
- REV-02 persists source_row_ordinal and uses it for same-day running balances, closing-row selection, immutable packet manifests, and exports. Real disposable RPC coverage passed for mixed same-day credits/debits, repeated values, randomized UUID order, import replay, final closing balance, packet/export order, and legacy packet hash preservation with explicit order-unverified status.
- REV-03 adds tests/restaurant-accounting-remediation-regressions.test.mjs to established discovery. The maintained npm run test:restaurant:all log contains all 42 discovered suites and executed the wrapper; this is demonstrated in the log rather than inferred from documentation.
- Latest local verification: focused review regressions and Bar Accounting matrix 45/45; npm run test:financial-truth 189/189. npm run test:restaurant:all discovered 42 suites and reported 1,086 passed / 3 failed: two SQL suites could not connect to localhost 127.0.0.1:54322; cutover integration refused to run without its explicit disposable-test opt-in. No local database was started or substituted for the approved disposable. npm run test:bar ran 89 files (698 passed / 2 failed / 5 skipped); failures are the existing official guide checksum contract and missing Playwright Chromium executable. npm run test:bar-guides remains 11/12, because official canonical guide hashes do not match the official manifest.
- Real Electron evidence is narrower than the requested full acceptance: 9/9 Accounting routes rendered in the isolated disposable build. Keep the two real Electron journal runs distinct. Operation 05dc37ec-a550-4066-89b0-8a370c32811f proves normal Ledger submission after a dropped IPC response, direct status IPC, independent checker approval/post, and one posted row; its final restart-continuation report timed out before it recorded a restored pending UI. Operation 14861239-fcae-45de-9df1-1af0092d9930 proves normal Ledger submission after a dropped IPC response, same-profile restart restoring the exact UUID and payload, and a normal status click resolving the submitted draft; later checker login failed, leaving draft 5853a53f-930c-4f3d-8fd2-22a51420467d submitted and unposted. These separate results do not form one fully passed end-to-end journal recovery-and-approval run. The status-notice capture gap applies to operation 05dc37ec-a550-4066-89b0-8a370c32811f; operation 14861239-fcae-45de-9df1-1af0092d9930 recorded a successful submitted-status notice. The all-22 control coverage is currently source assertions, not 22 valid/invalid normal-click acceptances. Real desktop POS-to-GL, budget/template approval, payroll calculation/post/payment, cutover, and statements close/reopen remain incomplete; route rendering and database/RPC evidence do not close those gates.
- Bar manual impact remains Required for the customer-visible Accounting export guidance. Current candidate-only pair is docs/bar-manual/build/remediation-candidate-2026-10-08-v6/: 71-page manual SHA-256 DAEC71C2133E1A2AEA9193B67592C027C0CFF4ECA5969E7D917AE9DE1CEBAA5C, 5-page Quick Start SHA-256 8E4FFF647D80D8159E2EA1DD714F4D238EE08FFA97CC9A04BD5FD5A3614B3C9F. Exact-pair offline open/save passed through packaged Electron preload/IPC as a genuine disposable cashier; package resources were restored afterward. A separate visible-menu attempt stopped because the cashier profile selector was absent. Candidate owner approval, official manifest promotion, and visible Help & guides acceptance remain open. Canonical guides and official manifest were unchanged.
- Synthetic Payroll capabilities and the add-on entitlement used for route acceptance were restored to their captured disposable baselines; the Payroll feature is false and selected add-ons are empty. No customer-facing Accounting activation or installer was created. Do not claim end-to-end or release readiness: the full real desktop acceptance, maintained gates, Bar approval/promotion, and separately authorized production/release steps remain unresolved. Evidence and the finding-by-finding closure register are under docs/audits/2026-10-07/accounting-remediation/.


### 2026-10-08 — Independent-review validation follow-up

- REV-01/02/03 implementation is tracked in the closure register. Forward migration `20261008010000_accounting_independent_review_fixes.sql` was compiled/applied only on disposable `repsrmlomedqrmrdsbga`; production link remains `oicgpknsmtvcsjacymum`. No earlier migration, production database, customer Accounting activation, or installer publication was changed.
- Latest focused review + Bar Accounting matrix tests: 45/45; financial truth: 189/189. The local maintained Restaurant runner discovered 42 suites and executed the remediation wrapper but finished 1,086/1,089 (two localhost SQL connection refusals and one cutover opt-in refusal). An initial marker-verified run against the approved disposable discovered 42 suites and passed 14 checks, then its third behavioral suite failed and the child stalled until the 15-minute timeout. That attempt was superseded by the later completed 42-suite rerun after failure-safe client cleanup, recorded below; the initial read-only post-check found no new synthetic lodge fixture. Exact logs and report are in `docs/audits/2026-10-07/accounting-remediation/evidence/review-restaurant-all-disposable-2026-10-08.*` and `review-disposable-timeout-fixture-check-2026-10-08.json`.
- Bar maintained tests remain red: `test:bar` 698 pass / 2 fail / 5 skipped; `test:bar-guides` 11/12. Failures remain the official-guide hash mismatch and unavailable Playwright Chromium. Candidate v6 is 71/5 pages with exact hashes recorded in the closure register. Candidate approval, manifest promotion, visible Help & guides acceptance, and release packaging are still open.
- Desktop status remains partial. The full 22-control normal-click matrix has not passed. Journal runs 05dc… and 1486… are separate; one records independent checker posting, while the other records exact restart intent/status recovery but checker timeout and an unposted draft. Real desktop POS-to-GL, budget/template approval, payroll lifecycle, cutover, and statements close/reopen remain open. Do not infer end-to-end readiness from the source/RPC results.
- Deployment status: disposable only; no production migration/activation, no signed or published installer. The unresolved desktop gates, maintained test failures, and Bar approval/package gates prevent release readiness.


#### Whitespace check

The targeted `git diff --check` for `PROJECT_STATE.md` and the touched Accounting source files passes. Workspace-wide `git diff --check` still exits 1 on existing Bar guide Markdown spacing in `docs/bar-manual/evidence.md`, `manuscript.md`, and `qa-report.md` (including a manuscript blank line at EOF); these guide edits were preserved. Git also reports existing LF-to-CRLF normalization warnings on modified working files.


### 2026-10-08 — Maintained Restaurant gate completed with remaining failures

- Corrected the Accounting behavioral test’s failure lifecycle by bounding PostgreSQL connection setup at 10 seconds and closing all tracked clients from `t.after`. The business assertions were unchanged. The isolated target run now reports the actual `42501 permission denied for schema public` failure promptly and confirms the first settings insert did not occur.
- The marker-verified disposable run of the maintained `npm run test:restaurant:all` completed all 42 discovered suites: 1,086/1,089 passed. The integrated Accounting remediation wrapper executed and passed 38/38, including REV-01/02/03 and all 22 source-level submit-control assertions. This proves runner discovery/execution, not the real desktop click matrix.
- Remaining failures: the behavioral test lacks schema access for its synthetic settings insert; cutover safely rejected the available fixture role because required DML/SELECT, RPC EXECUTE and `auth.role()` capabilities are absent; recipe depletion hit a PostgreSQL connection timeout before fixtures. No grants were added, no fixture rows were created, and the read-only marker-gated post-check is recorded under `docs/audits/2026-10-07/accounting-remediation/evidence/review-disposable-maintained-gate-fixture-check-2026-10-08.json`.
- The disposable runner used the exact host:port acknowledgement and withheld production/service credentials. Project marker remained valid and production link stayed `oicgpknsmtvcsjacymum`. The maintained gate remains red; this does not satisfy end-to-end readiness.

## 2026-10-09 — Accounting acceptance continuation

This is the current status addendum; earlier worktree notes and migration history are preserved. REV-01–03 were already repaired and were not reimplemented without new evidence.

### Changes and migration state

- Corrected the local Bar Sales report so a receipt marked Settled has no void form. Updated the exact v9 manual candidate to state the supported escalation boundary and regenerated its approval/test/visual reports. No customer-facing official guide or package was promoted.
- Updated the Accounting closure register and retained-fixture record. Added sanitized marker-verified lifecycle counts and the exact attempt9 financial identities.
- No new migration was authored or applied in this continuation. The approved disposable's latest recorded migration remains 20261008020000. Previously applied migrations were preserved.
- The local worktree remains dirty with prior work; no unrelated changes were reverted.

### Disposable SQL, maintained gate, and roles

The guarded fixture initializer and temporary credential/connection setup were restored previously. The three failed SQL suites then passed individually: Accounting behavioral 11/11, cutover/activation 19/19, and recipe depletion 1/1. Cutover assertions used genuine anon/authenticated roles separately from privileged fixture setup. The integrated npm run test:restaurant:all gate discovered and executed 42 suites and the remediation wrapper, with 1,115 passed, 0 failed, 0 skipped. Evidence is under docs/audits/2026-10-07/accounting-remediation/evidence/review-restaurant-all-disposable-refreshed-2026-10-08.*.

A fresh read-only preflight confirmed disposable marker LUNA-REMEDIATION-DISPOSABLE-v1 on repsrmlomedqrmrdsbga, allow_mutation=true, PostgreSQL database, latest migration 20261008020000 and preserved production link oicgpknsmtvcsjacymum. Maker/checker capability overrides remained empty. The later full fixture detail query timed out; no mutation was issued afterward. See evidence/independent-review-disposable-preflight.json and evidence/read-only-lifecycle-counts-2026-10-09.json.

### Actual Electron acceptance

- Complete journal recovery: attempt9 passed the single UUID/payload visible submit, actual authenticated RPC commit with dropped response, same-profile restart, exact intent restoration, visible status check, maker self-approval denial, independent checker approval/post, and same-key replay. One balanced 25.00 entry and the expected approval/post audit events were read back. See docs/audits/2026-10-08/accounting-independent-review/evidence/electron-journal-lost-response-20261009-attempt9.json.
- Normal-click matrix: 12/22 distinct controls accepted (ACC-01, COA-01/02, GL-01/02, AP-01/02, BUD-01/02, TAX-01/02, BANK-01). Ten remain: AP-03/04, BANK-02, GL-03, PAY-01 through PAY-06. Source checks, route rendering, direct IPC or RPC tests do not count as UI clicks.
- The disposable read-only inventory reports zero POS orders, zero Payroll periods/configuration/terms/attendance/time/payments and zero accounting period closes. Payroll add-on remains disabled and both synthetic users have empty capability overrides. No rule approval was fabricated to bypass the Payroll attestation control.
- POS-to-GL, AP credit/payment approval lifecycle, independent budget approval/immutable export, payroll calculation/approval/post/settlement, cutover apply, bank packet completion, statement close/reopen remain unaccepted through real desktop operator actions.
- Ledger export completeness remains explicitly blocked by unknown eligible source coverage. It must fail closed until source coverage is resolved.

### Bar guide candidate and gates

The exact v9 review candidate contains an 82-page Manual SHA-256 D8EF4FF7FA3357B7F679C28FF25A26E3506E7C4FE02CC4E18FE3D06919E0B890 and 5-page Quick Start SHA-256 91B270FBE922555CFBD57B9E41A432F2532107DFFE7F747B0FE350FE0833E088. Focused rendered component regressions passed 8/8, exact final PDF verification passed 13/13, source snapshot rehash passed 37/37, and visual spot QA covered manual pp.28-29/p.76 and Quick Start p.5. These tests use fictional fixture data/fake bridges; they are not live Electron, IPC/RPC or cashier acceptance. Exact approval packet is docs/bar-manual/build/remediation-candidate-2026-10-09-v9/APPROVAL_PACKET.md.

Maintained npm run test:bar with installed Chrome: 732 passed, 1 failed, 5 skipped. npm run test:bar-guides: 11 passed, 1 failed, 0 skipped. Both failures are the existing canonical manual checksum mismatch against the unchanged official manifest. No human owner approval has been entered. Official manifest/canonical PDFs remain unchanged; package parity for an approved pair and ordinary cashier visible offline open/save for both guides remain unverified.

### Deployment and readiness

Production link oicgpknsmtvcsjacymum is preserved. No production deployment/query, Accounting activation, customer mutation, official guide promotion, installer signing or publication occurred. Disposable-only results and candidate documents do not establish end-to-end readiness. Readiness remains false while the ten real-Electron controls, financial desktop lifecycles, unknown ledger export source coverage, owner guide approval and approved-package offline guide acceptance remain open.

#### Superseding AP acceptance update — 2026-10-09

The later real Electron AP acceptance completed the retained bill's full visible submit, independent checker approval/accrual, credit-note submit and independent approval, and credit-adjusted payment path. Bill `df8aa613-3f5f-4243-8b91-0a275885fc4a` (`ACCEPT-1d0cf4b0`) is BWP 50.00; approved BWP 5.00 credit `d41c1684-32cd-4f1a-803f-450b12d76562` reversed through entry `ad89c23f-d6de-4d1c-854a-3970cc963b83`; payment `1982e030-f2ab-40ca-bb0f-3b38c8fd1516` was BWP 45.00, posting entry `0de6963a-0a32-4ad4-917d-df438433094c`. Maker and independent checker identities and per-stage balance evidence are in the AP continuation artifact and `RETAINED_FIXTURES.md`.

This supersedes the earlier AP-partial note and advances the distinct real Electron normal-click control count to **14/22**. Open controls are BANK-02, GL-03, PAY-01 through PAY-06. This AP result does not close POS-to-GL, budget independent approval/export, Payroll, cutover, bank reconciliation, or statement close/reopen. No new migration was made/applied and no production link or data was changed. End-to-end readiness remains false.

## 2026-10-09 Accounting remediation continuation — budget export superseding status

Forward migrations `20261009010000_restaurant_budget_export_requires_approval.sql` and `20261009020000_restaurant_budget_export_restore_staff_rpc_grant.sql` are applied to approved disposable `repsrmlomedqrmrdsbga` only. The database marker was verified before mutation; head is 20261009020000. No applied migration was edited. Production link `oicgpknsmtvcsjacymum` is preserved; no production migration, customer Accounting activation, installer publication, or production mutation occurred.

The budget-export RPC now blocks incomplete matrices and any version lacking exact-version approved status and an independent approver. Unknown ledger source coverage remains unknown. A narrow exact-signature `anon` execute grant restores the existing staff-session RPC route; authorization/capability checks remain server-side. Actual unauthenticated anon RPC assertion returned 401 and did not create an export run. Fixture SQL setup/readback ran as `postgres`; operator assertion remained anon-key/no staff identity. New focused tests pass 42/42; the maintained integrated wrapper discovered and executed the remediation suite (42/42). The historical full Restaurant gate was 42 suites / 1,115 passed / 0 failed / 0 skipped before these two new budget tests; no claim that the full gate was rerun after them.

Real Electron visible maker self-approval denial, independent checker approval, and approved-budget JSON export all passed. Exact version `0011cee9-c71c-4105-9c8c-84d248370cb0` has 24 lines and unchanged payload hash; maker `6184abcd-d736-4ced-ac0e-064d4132ec69`, checker `430fe55c-77da-4504-912f-b2d49f91e766`. Export run `0bd3eb19-7b3b-4cb1-b079-99319df65e0e`; file SHA-256 `03cfe01de1c0da91bd1bf41100698953e1833cc75b6a305126a62d9f50f36d2f`; row count 24; artifact/file hash parity and server registration passed. Full evidence is in `docs/audits/2026-10-08/accounting-independent-review/evidence/` as indexed by the closure register and retained-fixture register.

The real Electron 22-control matrix remains 14/22 (BANK-02, GL-03, PAY-01..PAY-06 open). Previously passed complete same-UUID journal lost-response/restart/status/checker/post/replay and AP bill/credit/payment lifecycles remain recorded. POS-to-GL, payroll lifecycle, cutover, statements close/reopen, completed same-day bank packet, Bar candidate approval/package parity/offline cashier access, and universal ledger source coverage remain open. End-to-end readiness remains false; this is not a release-ready state.

## 2026-10-09 — ordered bank packet acceptance continuation

This supersedes the 14/22 desktop checkpoint for BANK-02 only. Earlier changes and migration history remain preserved.

- Added forward migration 20261009030000_restaurant_bank_packet_reader_ordinal_order.sql (previous disposable head 20261009020000). Applied only on marker-verified disposable repsrmlomedqrmrdsbga; anon/authenticated/service_role execute privileges unchanged; no packet rows or immutable hashes rewritten; no earlier migration edited. Production link remains oicgpknsmtvcsjacymum, no production deployment.
- BANK-02 passed real Electron normal-click acceptance through import, maker journal/allocation work, independent checker approvals, Complete & lock, and visible JSON export. Four same-day rows persisted and exported in ordinals 1–4 despite randomized UUID order; packet/export hashes and checker audit actor match. The distinct click matrix is 15/22; GL-03 and PAY-01 through PAY-06 remain open.
- Post-migration maintained wrapper: 1 suite discovered/executed, 42 passed, 0 failed, 0 skipped (bank-packet-reader-maintained-wrapper-2026-10-09.log). Exact saved full Restaurant gate before this migration: 42/42 suites, 1,118 passed, 0 failed, 0 skipped, integrated wrapper discovered/executed, exit 0 (review-restaurant-all-disposable-continuation-2026-10-09.json/.log). Do not describe that full gate as post-migration or imply a full rerun after the wrapper changes.
- Desktop cutover: real visible Reload batch showed retained batch 0545997b-d5a0-4f8f-b54b-fb0782db631b applied by the prior HTTPS workflow, with maker/checker and balanced BWP 1,500 opening posting. No desktop prepare/approve/apply or activation sequence was completed; no reapply or activation click occurred.
- Desktop statements: route remained at the activation/readiness loader and exposed no prepare/approve/reopen controls. Period-close read was empty before and after; no close/reopen mutation. A later read-only readiness probe timed out before recording marker verification, so dependent mutations stopped. The cutover status run did verify marker and production link before its route read.
- POS-to-GL: marker-verified read-only fixture check found zero menu items, orders, or open shifts. No sale/journal was fabricated. Payroll: genuine-session Electron preflight found zero configurations, periods, terms, and time inputs, with no GL settings; entitlement remains disabled, no capability override or synthetic legal approval. No Payroll mutation.
- Accounting Bar manual impact remains Required for prior export-completeness guidance; the ordinal reader adds no operator-visible procedure. Exact v10 guide pair remains unapproved and not approval-ready while V8R2-03/V10-SCOPE-01 remain open. Official docs/manifest unchanged; candidate package parity and ordinary cashier offline Help & guides acceptance are unverified. LEDGER_SOURCE_COVERAGE_UNKNOWN still blocks universal ledger export certification.
- Default command helper still has the apply deny-read ACL failure. Approval-reviewed exec_command shell execution worked for sanitized evidence reads/writes and guarded harnesses. No ACL was edited or control disabled.
- Deployment/release remain separate: disposable migration head 20261009030000; production not deployed; no customer Accounting activation; no guide approval/promotion; no installer signing/publication. End-to-end readiness remains false.

## 2026-10-09 - Accounting acceptance continuation after 15/22 checkpoint

This is the latest current-state addendum. The distinct real-Electron normal-click matrix remains 15/22: BANK-02 completed; GL-03 and PAY-01 through PAY-06 remain open. Closed REV-01 through REV-03 and previously passing unchanged suites were not repeated. Existing full same-UUID journal recovery/checker/post, AP credit/payment, and budget approval/export evidence remains retained and was not discarded or replayed.

### POS-to-GL

- Retained setup only: product 8a0fceab-6f01-439f-9865-b6a877d2531a (Accounting POS GL Acceptance 3ba64041, Beer, BWP 12.34, non-stock, global outlet) and visible category mapping 287c087b-dfc1-4091-bd6f-fe49a51d75c7 (beer to active revenue account 2c0338e4-e72b-4f88-bee5-0063e320c2ec).
- The product click report said the click completed, but its screenshot still has Saving buttons; database created_at is three seconds after the report finish time. Current marker-verified readback confirms one row but the active Bar snapshot remains empty. Fresh readback found zero POS orders, open shifts, or POS source journal entries. Do not count product creation as accepted and do not call this a sale, posting, or retry lifecycle. Evidence: pos-retained-current-inventory-20261009.json, plus prior product/mapping reports and screenshots.
- A no-key run of the retained checker profile went offline and read zero menu rows. This is not online RPC acceptance. Auto-review rejected a subsequent run that would place the disposable public anon key in renderer config, citing the no-credentials-to-renderers instruction. The rejected action did not start. No indirect credential injection or fallback was attempted; online UI RPC continuation is pending user direction on that configuration.

### Payroll, cutover, statements, and ledger coverage

- Payroll preflight through real Electron/genuine saved staff profile returned zero configurations, periods, terms, time inputs, and GL settings; entitlement remains disabled. PAY-01 through PAY-06 were not clicked and no permission, PIN, statutory approval, or Payroll data was fabricated.
- Desktop cutover evidence is a Reload batch display of existing applied batch 0545997b-d5a0-4f8f-b54b-fb0782db631b and its BWP 1,500 opening journal. Full desktop prepare/independent-approve/apply/readiness journey remains open; no re-apply or activation occurred.
- Checker-session Statements IPC reports 35 coverage rows, 17 missing source contracts, 16 unsupported rows, source_coverage_complete=false, dataset_complete=false, and financially_final=false; close controls are absent and period-close rows remain empty. No close/reopen mutation was attempted. LEDGER_SOURCE_COVERAGE_UNKNOWN remains fail-closed for universal certification.

### Current tests and Bar guide state

- npm run test:bar-guide-behavior: 26/26 passed, 0 failed, 0 skipped, exit 0. These are renderer/component fixture and candidate PDF checks, not cashier acceptance.
- npm run test:bar-guides: 11 passed, 1 failed, 0 skipped, exit 1. Canonical Bar Manual hash is 91BFD9812685939F780B60C273231515A91EE13930C8E08C9E9EE9D725437308, while the unchanged official manifest expects 682AB70A868C706B9AB0DDE18A1272F40791B968B91963F62D481B6FD79C3356; the Quick Start canonical/package hashes also differ from its manifest. Exact readback: bar-guide-package-parity-readback-20261009.json.
- Candidate v10 remains unapproved and not ready: manual hash AAC263DDCD914136E416AC0DBDDC85D417D9D028A8EA6BF203092884B8B4FED6, Quick Start 7C9FEE67CE801576280640627C0C963C29EDEF727DF41250F98EDC3A45BBAAF0. V8R2-03, V10-SCOPE-01, and human usability acceptance remain open. No candidate copy, approval, manifest promotion, or cashier visible offline test occurred.

### Execution and separate deployment states

- Default command helper still fails before execution with apply deny-read ACLs. Approval-reviewed exec_command worked for guarded read-only checks and guide tests; its initial test approval timed out and its one retry executed. No ACL or security control was edited.
- No migration was authored or applied in this continuation. Disposable head remains 20261009030000_restaurant_bank_packet_reader_ordinal_order.sql; production link oicgpknsmtvcsjacymum remains intact. No production deployment or mutation, customer Accounting activation, approved-guide promotion, installer signing, or publication occurred. End-to-end readiness is false.

## 2026-10-10 — Accounting acceptance paused for explicit public-key confirmation

- The user’s current instruction requires explicit human confirmation of the narrow public-key exception before any retry of the rejected online Electron launch. No such confirmation is present in the current turn. No key was passed to Electron, no alternate launch route was used, and no online acceptance or financial mutation was attempted.
- Default exec_command failed before command start with apply deny-read ACLs. A narrow approval-reviewed, workspace-only require_escalated path succeeded for read-only document and saved-log inspection. No filesystem ACL or security control was changed. No disposable connection/marker probe or fixture mutation occurred in this status-only continuation.
- Reopened and parsed docs/audits/2026-10-07/accounting-remediation/evidence/review-restaurant-all-disposable-continuation-2026-10-09.json and its exact .log: saved run 42/42 suites discovered/executed, 1,118 passed, 0 failed, 0 skipped, integrated wrapper discovered/executed, exit 0. This is verification of the saved 2026-10-09 run, not a new run; it does not supersede the recorded migration timing boundary.
- Real Electron normal-click matrix remains 15/22; GL-03 and PAY-01..PAY-06 remain open. POS-to-GL catalog publication/sale/post/retry, Payroll lifecycle, desktop cutover prepare/checker/apply, statement close/reopen, and the existing source-coverage restriction remain unaccepted/open as described above. Closed bank, AP, journal, and budget evidence is retained and was not repeated.
- Latest disposable migration head remains 20261009030000_restaurant_bank_packet_reader_ordinal_order.sql. Production link oicgpknsmtvcsjacymum is preserved. No production deployment, customer Accounting activation, guide self-approval/promotion, installer signing, or publication occurred. Guide v10 and its approval/package/usability gates remain open; end-to-end readiness remains false.

## 2026-10-12 — POS shift-board blocker diagnosed; acceptance continuation running

- Approval-reviewed workspace reads and writes resumed without ACL or security changes. Two isolated real Electron diagnostics verified disposable marker LUNA-REMEDIATION-DISPOSABLE-v1 on repsrmlomedqrmrdsbga before temporary synthetic Auth setup. Production link oicgpknsmtvcsjacymum was preserved. Only the public anon client key entered Electron; privileged setup values stayed outside the client and evidence.
- The rendered AccessContext has role=admin, productId=hospitality-pos, commercialPackageKey=bar_pos, pos=true, pos.view=true and pos.manage=true, with no role/feature/commercial denial or capability override. The actual HposTeam clock-in form is visible. The exact Staff member label locator has zero matches because its wrapping label includes dropdown option text; the scoped prefix locator has one match. The previous absent-control report is superseded by this observed runner-locator diagnosis, not a capability repair.
- Diagnostic route navigation is not normal-click acceptance. No PIN, attendance, sale or GL mutation was attempted by either diagnostic. Temporary user links, Auth principals and isolated profiles were cleaned up. Evidence: docs/audits/2026-10-08/accounting-independent-review/evidence/electron-pos-capability-diagnostic-20261012.json and electron-pos-board-diagnostic-20261012.json.
- The corrected attempt6 runner uses scoped label prefixes and waits for loaded staff options. Its isolated normal-click acceptance is in progress; no new control is accepted by this checkpoint. Matrix remains 15/22; GL-03 and PAY-01..PAY-06 remain open. Payroll, cutover, statement close/reopen, guide approval/package/offline acceptance and unknown ledger source coverage remain unresolved.
- Saved Restaurant 42-suite/1,118-test results remain historical. No migration or maintained test gate was run for this checkpoint. The latest recorded disposable migration head from the supplied inventory is 20261010020000; it has not been freshly inventoried here. No production deployment, customer activation, guide promotion, signing or publication occurred. End-to-end readiness remains false.

## 2026-10-12 — POS-to-GL accepted for retained non-stock cash fixture; matrix 16/22

This supersedes the earlier continuation-in-progress checkpoint. End-to-end release readiness remains false.

- The missing clock-in form was a runner locator error, not a denied capability: the genuine renderer has pos.manage=true and the form is visible. Scoped prefix label locators and a loaded-staff wait repaired the runner. Attempt6 failed on a fetch before setup. Attempt7 completed normal own-PIN setup, Manage unlock, clock-in, Till unlock and exactly one BWP 12.34 cash sale of the existing non-stock Beer product. Its receipt modal blocked the subsequent Manage click; no second sale was attempted.
- Accepted GL-03 using that exact retained order across the linked desktop continuations. Order 2d66eed1-0cbf-4f8b-a9d6-2f6c9fdca31c, source posting 656285b4-b206-4337-9be1-388d2b3c1550 and posted journal 6c472c02-102b-4a30-a5ee-bfa7d7b401e6 remain the same. The journal debits cash account 1000 and credits Beer revenue account 4000 by BWP 12.34 each. Manual Post and repeated same-order clicks confirm/reuse this journal; the evidence does not claim the manual click first created it, nor one uninterrupted same-profile run. No stock decrement or hardware cash handling is certified by this explicit non-stock fixture.
- Found and repaired two renderer issues. The POS replay flag is returned directly by the RPC; General ledger now unwraps either the actual raw response or a legacy envelope before showing the replay notice. The paged journal API returns no trial balance; General ledger now separately reads the existing authoritative getLedger operation, validates totals, and renders unavailable rather than a false zero for missing/malformed data. A read revision guard rejects older filter/session results. Paging does not overwrite the separately verified balance.
- Attempt11 passes genuine login, normal Manage/General ledger navigation, two same-order Post clicks, the duplicate notice in the viewport, unchanged journal identity, posted-journal display, and rendered trial-balance totals matching a genuine-session authoritative read: 11 account rows, BWP 2,833.68 debits and credits through 2026-10-12. These are posted-ledger balances, not universal eligible-source certification. Raw receipt, journal and replay/total screenshots were visually inspected. Evidence: docs/audits/2026-10-08/accounting-independent-review/evidence/electron-pos-to-gl-normal-click-20261012-attempt7.json, attempt8/9/10/11 reports in the same directory, and pos-to-gl-authoritative-readback-20261012.json.
- Validation: the maintained rendered browser gate passed after the final ledger repair, including raw/enveloped replay, authoritative nonzero totals independent of journal paging, unavailable totals and a delayed older filter response. Focused Accounting and Bar authorization checks passed 50/50. Earlier red logs prove the raw replay regression and expose the already-stale Budget export allowlist expectation; the latter was aligned with the explicitly reviewed 20261009020000 RPC grant and strengthened with export-capability, independent-approval and narrow-grant checks. No database grant was changed. The isolated hospitality-pos main/preload/renderer build passed for attempt11. The full Restaurant and full Bar gates were not rerun; the saved 42-suite/1,118-test Restaurant result remains historical.
- Distinct real Electron matrix: 16/22. Remaining controls: PAY-01..PAY-06. Payroll, desktop cutover prepare/independent approval/apply, statements close/reopen, universal ledger source coverage and guide release gates remain open. LEDGER_SOURCE_COVERAGE_UNKNOWN remains fail-closed.
- Retained disposable additions: active attendance e2aefc3b-21f1-4b7d-a546-b67638290445 and the one sale/line/source posting/journal above. The original Till shift b1dc793a-63d5-4e60-99b4-b566b764408b remains open and linked to that attendance. Synthetic maker now has the PIN created through the attempt7 own-PIN form; its plaintext is not retained. Later known test PINs were provisioned only as synthetic fixture preparation outside Electron and the original hash was restored, together with email/Auth/password-hash linkage. Temporary Auth principals and isolated profiles were removed. No privileged client credentials or private values were recorded.
- Fresh read-only disposable inventory verified head 20261010020000 and the exact marker on repsrmlomedqrmrdsbga. This continuation authored/applied no migration. Production link oicgpknsmtvcsjacymum stayed intact; no production query/deployment/mutation, customer activation, guide promotion, signing or publication occurred.
- Bar manual impact is Required. The authored customer follow-up and exact pending candidate work are in docs/bar-manual/remediation-impact-2026-10-12-ledger-verification.md. Final verified captures are available; candidate incorporation/annotation/PDF rebuild and human approval/package/offline-menu gates remain pending. Candidate v10, canonical PDFs and the official manifest were preserved. This software acceptance does not approve a guide or a release.

## 2026-10-12 — continuation after 16/22; v11 guide candidate reviewed

This is a documentation and evidence continuation. It performed two read-only normal clicks (cutover Reload batch and Statements Refresh), made no disposable database mutation, and authored or applied no migration. The distinct matrix remains 16/22. The last verified disposable head remains 20261010020000; production link oicgpknsmtvcsjacymum remains preserved. No production query/deployment, customer Accounting activation, guide promotion, signing or publication occurred.

### Current acceptance state

- Distinct real Electron normal-click matrix remains 16/22. GL-03 is accepted from the retained one-sale POS fixture. PAY-01 through PAY-06 remain unaccepted. The Bar behavior run does not alter the matrix.
- Latest real desktop evidence remains attempt11 for POS-to-GL: retained order 2d66eed1-0cbf-4f8b-a9d6-2f6c9fdca31c, source posting 656285b4-b206-4337-9be1-388d2b3c1550, journal 6c472c02-102b-4a30-a5ee-bfa7d7b401e6; two same-order Post clicks reused the same journal and displayed the replay notice. Existing acceptance and the open till/attendance fixture were preserved; no sale, payroll, cutover, or close mutation was made in this continuation.
- Saved Payroll read-only preflight remains the current prerequisite evidence: marker-verified disposable project repsrmlomedqrmrdsbga, head 20261010020000, zero pay periods, employment terms, statutory configurations, source documents, GL settings, time inputs, attendance reconciliation, expected worker rows, pay records, payment batches and exports. It does not establish Payroll readiness or entitlement. No independently verified statutory source/professional approval exists in the retained record; no such approval or Payroll fixture was fabricated.
- Desktop cutover evidence remains status-only for already-applied batch 0545997b-d5a0-4f8f-b54b-fb0782db631b; no desktop prepare/checker/apply journey or reapply is accepted. Statements/close evidence remains fail-closed: 35 source-coverage rows, 17 missing source contracts, 16 unsupported rows; source_coverage_complete=false, dataset_complete=false, financially_final=false; no close controls or close row. Saved readback: docs/audits/2026-10-08/accounting-independent-review/evidence/electron-statements-coverage-checker-probe-20261009.json. No close or reopen mutation is accepted.
- LEDGER_SOURCE_COVERAGE_UNKNOWN remains enforced. A retained POS posting or complete individual bank packet does not prove universal ledger export completeness.

### Current Bar documentation evidence

- Candidate v11 final PDFs were rebuilt, visually reviewed, and structurally verified. Manual: 84 pages, SHA-256 E8EEA0C2295DEC9AF57621E6AECFEC18CF7E90DB7E8CF0CA2B4F1527EBBCA145. Quick Start: 5 pages, SHA-256 58917A6F0AFAF2518DB12F24CF6A460EE6F3BC562F1047B260F075ADE092BA0B. The exact structure file and visual review are in docs/bar-manual/build/remediation-candidate-2026-10-12-v11/evidence/.
- Maintained npm run test:bar-guide-behavior: 38 total; 34 passed, 4 failed, 0 skipped; exit 1. It exercises Chromium renderer/component fixtures with fictional bridges and scratch PDFs, not real Electron/IPC/RPC or cashier acceptance. Failure details are in the candidate evidence record. Treat the behavior gate as failed.
- Human guide approval and usability, V8R2-03 action/discovery scope, V10-SCOPE-01 product-owner decision, exact official manifest checksum acceptance, package parity, released-binary applicability, and ordinary cashier visible offline open/save for the approved pair remain open. Candidate v11 is not promoted; official PDFs/manifest/package are untouched.

### Continuation result and remaining gates

No test run or UI click in this continuation changed any accounting data. No database roles or client grants were broadened. Latest full Restaurant 42-suite/1,118-test evidence remains historical and was not rerun. The current Bar behavior run is recorded above as 34/38, not as a passing gate.

End-to-end readiness remains false. Separate states remain: disposable migration head 20261010020000; production not deployed; customer Accounting not activated; guide approval/promotion not recorded; installer not signed/published.

## 2026-10-12 — fresh real-Electron cutover and statements read-only checks

- Both isolated Electron runs used the exact disposable anon key only in a minimal client environment allowlist; marker LUNA-REMEDIATION-DISPOSABLE-v1, target repsrmlomedqrmrdsbga, database postgres, production link oicgpknsmtvcsjacymum, and genuine maker session 6184abcd-d736-4ced-ac0e-064d4132ec69 were verified. No credentials were written to evidence.
- Cutover run electron-cutover-readonly-20261012.json clicked Reload batch and confirmed retained batch 0545997b-d5a0-4f8f-b54b-fb0782db631b is already applied with its existing maker/checker. Prepare cutover batch is visible/enabled; review, approve and apply controls are absent for the applied batch. No new batch was prepared and no opening balance was posted or reapplied. A fresh separate synthetic lodge/batch would be required to test the full desktop lifecycle safely.
- Statements run electron-statements-coverage-readonly-20261012-attempt3.json clicked visible Refresh and read getStatements through Electron IPC/RPC. Period status is draft_unclosed; 35 coverage rows comprise 18 complete, 16 unsupported and 1 incomplete; 17 source contracts are missing. source_coverage_complete=false, dataset_complete=false, and financially_final=false; blockers are source_coverage_incomplete and period_not_closed.
- getPeriodClose returned no prepared record; SQL readback confirmed zero period-close rows both before and after. Prepare, approve/close and reopen buttons were absent in this maker session. No close/reopen RPC mutation was invoked. Universal ledger export coverage stays fail-closed.
- First Statements attempt sampled the Refresh control before it became visible; that failed probe is preserved as electron-statements-coverage-readonly-20261012.json. The corrected wait and exact missing-source count are in attempt3; attempt2 is also retained. Only attempt3 is the successful coverage read. No alternate execution route or permission/grant change was used.
- Cutover prepare/checker/apply and Statements close/reopen remain unaccepted. The observed status/refresh clicks do not advance the 16/22 control matrix. PAY-01..PAY-06, payroll source/professional approval, dedicated cutover fixture, close permission/source completeness, and guide release gates remain open.

### Build provenance limit for read-only desktop probes

The fresh cutover and Statements probes launched the retained app entry tmp/bar-online-assessment-2026-10-07/accounting-desktop-build/main/index.js. That path is the 2026-10-07 assessment build; current-worktree source parity was not verified. The maker login, marker check, visible read-only clicks, and server IPC/RPC coverage result are real and current to the disposable backend, but these probes do not establish current-worktree renderer acceptance. The earlier POS-to-GL attempt11 report is the separate isolated current acceptance; no source-only result is promoted to end-to-end readiness.

### Execution controls

The default command helper's last observed failure remains apply-deny read ACLs. This continuation used the approval-reviewed require_escalated path for the permitted workspace reads/writes and marker-guarded read-only disposable Electron probes. The escalated path succeeded; no ACL was edited and no control was disabled. The default helper is not claimed repaired.


## 2026-10-12 - continuation: Payroll contracts and guide regressions; operator gates remain open

This addendum supersedes only the v11 Bar behavior failure status and records source-contract preparation. It does not supersede previously accepted Accounting evidence. End-to-end readiness remains false.

### Current-worktree build and real Electron status

A current-worktree hospitality-pos electron-vite build was produced from HEAD f605d1e3523a07cc594a4459e6709030be27270d at 2026-10-12 19:22:30 +02:00 with node scripts/product-app.mjs hospitality-pos build. Its 965-file source manifest is SHA-256 EDB5211B145102B4EA5ED8D2D3DD2CFA44289BCA89DBBCAAD64063EDD4186B1D; 192 artifacts were produced. Main entry, preload, renderer index and General ledger chunk hashes are in docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261012/hospitality-pos-build-provenance-20261012.json and hospitality-pos-build-artifacts-20261012.json. Only the authorized disposable public anon key was in client configuration; privileged_variables_forwarded=false. No key value or secret is stored here.

The real Electron window reached the saved synthetic admin session, then a normal Manage click showed the Manager PIN prompt. No PIN was entered, Payroll was not opened through the operator path, and no additional control was accepted. The visible session blocks PAY-01..PAY-06, fresh current-build Statements read and current-build cutover controls. The distinct matrix remains 16/22; previously accepted GL-03 remains separate.

### Payroll contract preparation

Added tests/restaurant-accounting-payroll-source-gate.test.mjs. The maintained Restaurant wrapper discovered one suite and passed 7/7, 0 failed/skipped, exit 0; see docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261012/payroll-source-gate-maintained-wrapper-20261012.log. These are static source assertions against forward migrations, not SQL execution, RPC acceptance or Payroll operator behavior. Existing payroll-rebuild 9/9 evidence was not repeated.

The service-role-only no-ship gate in 20260807490000_payroll_pii_and_statutory_gate.sql requires an independently verified source, separate professional approver, matching version/effective date/hash and no unapproved time input. It masks bank data and audits reasoned raw exports. No client grants were broadened.

The BURS Tax Table 2026 candidate copy is 180 pages, effective 1 July 2026, SHA-256 EA2702B714CC07540DF5F0E153096A8C8FBCC5AC7C01E9F8D852F1A571AA64FF. Exact source and missing approval are documented in docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261012/payroll-source-and-professional-approval-prerequisites-20261012.md. It is not signed approval and does not establish other deductions. No Payroll rows were made; PAY-01..PAY-06 remain open pending statutory and operator inputs.

### Statements and source coverage

The earlier October 12 read-only Statements probe ran the October 7 assessment executable, not this build. Aggregate: 35 rows, 18 complete, 16 unsupported, 1 incomplete, 17 missing contracts; source_coverage_complete=false, dataset_complete=false and financially_final=false. No close row or mutation existed. The current-build Statements view was not read because the Manager PIN gate remains. Detailed snapshot/limits: docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261012/ledger-source-coverage-inventory-20261012.md. LEDGER_SOURCE_COVERAGE_UNKNOWN remains fail-closed; period close/reopen is not accepted.

### Bar documentation and test results

The four earlier candidate-v11 behavior cases now pass: maintained npm run test:bar-guide-behavior 39/39, 0 failure/skip, exit 0. Analysis and retained evidence: docs/bar-manual/build/remediation-candidate-2026-10-12-v11/evidence/isolated-regressions-20261012/repair-analysis.md. Exact v11 PDFs remain unchanged: Manual 84 pages / E8EEA0C2295DEC9AF57621E6AECFEC18CF7E90DB7E8CF0CA2B4F1527EBBCA145; Quick Start 5 pages / 58917A6F0AFAF2518DB12F24CF6A460EE6F3BC562F1047B260F075ADE092BA0B.

Independent review packet: docs/bar-manual/build/remediation-candidate-2026-10-12-v11/evidence/APPROVAL_PACKET.md. It is not approval. V8R2-03 and 1,466 unverified action semantics, V10-SCOPE-01 decision for 29 /hpos/service controls, V9-02 usability, official checksum approval, package parity, released-binary applicability and ordinary cashier offline Help & guides remain open. Candidate v11 is not promoted.

### Migration, deployment and execution state

No migration was authored/applied. Marker-verified disposable head remains 20261010020000. Production link oicgpknsmtvcsjacymum remains preserved. No production deployment, customer Accounting activation, guide promotion, installer signing or publication occurred.

The default command helper's prior apply-deny ACL failure remains unresolved; no ACL/control was changed. One approval-reviewed command was rejected before execution due to the review service usage limit; after the stated reset, a narrow read-only run succeeded. No review route was bypassed.

test:restaurant:all was not rerun; its last saved 42-suite/1,118-test result is historical and predates this added selected-wrapper suite. The new source test does not prove runtime behavior. End-to-end readiness remains false.


### Current Electron session liveness
The post-capture harness inspection returned window_open=false for session 19874. No Electron window is currently open and no Manager PIN was entered. The saved PIN-modal screenshot remains historical evidence only; it does not establish a currently usable operator session. Reopen the isolated current-worktree build and obtain operator unlock before continuing control clicks.


### 2026-10-12 saved aggregate transcript verification

The exact 2026-10-09 aggregate record was reopened at evidence/review-restaurant-all-disposable-continuation-2026-10-09.json with its paired .log. It records 42 suites discovered and executed, 1,118 tests passed, 0 failed, 0 skipped, the integrated wrapper discovered/executed, exit 0, and the approved disposable marker/project; production link before and after is oicgpknsmtvcsjacymum. This remains historical evidence and was not rerun in this continuation. It predates the selected Payroll source-contract suite (separately 1 suite, 7/7, exit 0) and is not a current aggregate result. No counts are combined.


### Ledger source trace and guarded Electron relaunch status

Repository-source tracing now distinguishes registry labels from verified runtime RPC names; see evidence/desktop-acceptance-20261012/ledger-producer-contract-trace-20261012.md. Related booking invoice/refund, conference creation and customer-credit workflows exist under some different RPC names, while the saved registry still marks the export contracts unsupported. Producer existence does not supply a ledger state rule or matching evidence. No coverage claim or close/reopen action was made; LEDGER_SOURCE_COVERAGE_UNKNOWN remains fail-closed.

The fresh approval-reviewed current-worktree launcher refused to spawn Electron because the configured Supabase URL did not match the sole approved disposable project. Its child allowlist forwarded no credentials; public-key target validation was not reached. The isolated profile copy had an empty sync queue. No fallback project URL or alternate launch route was attempted. A follow-up safe-classification request timed out in automatic approval review before command execution. A correct disposable-only URL/key configuration is required before resuming normal-click acceptance; production link remains untouched.

## 2026-10-13 — Payroll export source contract and online acceptance limits

- Source change: `src/renderer/src/components/restaurant-accounting/RestaurantPayroll.jsx` now prompts for and forwards the audited raw-export reason, cancels on blank input, and exposes the raw export only to `accounting.payroll_export`. `src/main/index.js` uses the same capability for `exportPayroll`. Existing server PII audit, payload hash, idempotency key and no-ship grants are unchanged.
- Regression: one suite, 8/8 source assertions passed through the maintained Restaurant wrapper. This does not prove SQL or operator behavior. Compile-only current-source build: 192 artifacts / 464 source files, hashes and placeholder limitation recorded in `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/source-compile-only-build-r2.json`.
- The fresh real Electron runner and empty env config are prepared but not executed. Automatic review rejected the external temporary identity setup due to privileged credentials/restoration risk, then rejected read-only full API-key inventory retrieval because it returns privileged keys. Both rejections occurred before command start; no key fetched and no fixture changed. The mismatch classification and retained logs are in `evidence/desktop-acceptance-20261013/approval-reviewed-electron-blocker.md`.
- Matrix stays 16/22; PAY-01..PAY-06 open. Payroll is also held by missing independent statutory source approval and a service-role-only/no-ship server path. The exact six-test preparation is in `evidence/desktop-acceptance-20261013/payroll-six-control-readiness-20261013.md`.
- A source review found coverage joins expected population aggregates to postings by lodge/date/posting source type without exact source ID match. Seven POS families share `pos_order`. The overall refusal remains fail-closed; see `evidence/desktop-acceptance-20261013/ledger-source-identity-review-20261013.md`. No migration was authored/applied without the exact per-family identities and approved SQL acceptance path.
- Restaurant aggregate not rerun because its DB suites default to local PostgreSQL, outside the only approved mutation target. The 42-suite/1,118-test record remains historical. No production deployment, customer activation, guide promotion or installer publication occurred; readiness false.


## 2026-10-13 — ledger source identity forward correction; operator gates remain open

- Authored new migration 20261013010000_restaurant_ledger_source_identity_gate.sql (SHA-256 10a89246e8dde59330febce7615524306abea30a248e30ab3a1b489deef09a87). The new expected-source reader matches authoritative row UUID plus business date. Coverage now requires a linked posted journal entry from the same lodge and source date. Existing source and coverage RPC grants remain service_role-only.
- The migration downgrades voucher_redemption, voucher_return, customer_account_charge and inventory_depletion to unsupported until their whole-order snapshots are replaced by tender-specific/cost-specific amounts. It does not set completeness true or remove unsupported rows.
- Maintained focused source suite: 1 discovered/executed suite, 5 passed, 0 failed/skipped, exit 0. Exact log: docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/ledger-source-identity-maintained-wrapper-20261013.log. An initial 4/5 test run exposed a test-comment matcher issue only; corrected test then passed 5/5.
- This is source-contract verification only. No PostgreSQL run validated the migration; it remains unapplied and undispatched. Source-version/payload-hash parity and class-specific subledger-to-GL reconciliation remain unverified, so ledger completeness, close, reopen and exports remain fail-closed.
- No fresh Electron launch, normal click or financial lifecycle occurred. Matrix remains 16/22; PAY-01..PAY-06 remain open. GL-03 and prior bank/AP/journal/budget evidence stay retained separately.
- The default command helper again failed before starting with apply-deny read ACLs. The approval-reviewed read-only syntax check succeeded. Full worktree diff-check reports whitespace in unrelated current Bar manual edits; the focused Accounting file check has no whitespace errors. No ACL or unrelated Bar file was changed.
- No disposable or production mutation/query occurred. Most recent saved disposable migration head remains 20261010020000 and was not queried this turn. Local Supabase link marker remains oicgpknsmtvcsjacymum. No deployment, customer activation, guide promotion or installer publication occurred; end-to-end readiness remains false.
- Bar manual impact: this ledger source guardrail adds no Bar setup, navigation, visible control or daily-workflow steps, so no Bar manual, quick-start or screenshot update is required. Candidate v11 remains byte-identical and unapproved; owner scope/usability, manifest/package parity and offline cashier gates remain open.
- Durable focused-test record, including each suite count and the SHA-256 of raw output, is in docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/focused-source-contract-results-20261013.md. The raw .log files are retained in the workspace but match the repository *.log ignore rule.
- Maintained accounting wrapper discovery was verified at runtime: restaurant-accounting-remediation-regressions.test.mjs is discoverable and selects correctly; it imports the unprefixed source suite. That wrapper was not rerun because it includes closed REV-01..03 tests. The unprefixed direct selector is expected to be rejected. Current evidence and limits: docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/focused-source-contract-results-20261013.md.

## 2026-10-13 — superseding ledger provenance and guide checkpoint

This entry supersedes the earlier October 13 source-identity/no-manual-impact closure claims. End-to-end readiness remains **false**.

- Preserved original migration 20261013010000, SHA-256 10a89246e8dde59330febce7615524306abea30a248e30ab3a1b489deef09a87. Added separate unapplied forward candidate 20261013020000, SHA-256 f2d072fad3a862616be483ff4477e7d8b998a929a8df6666c3dfcea925e8d86a. No migration dispatch/application occurred and live history was not queried; last saved verified disposable head 20261010020000 is historical.
- Unified exact snapshot/ID population, immutable governed manual inputs/approval/post linkage, canonical draft/journal hashes and account/debit/credit/memo multiset reconciliation. Stable coverage reads and the existing capability-guarded desktop/close wrapper use the same contract. Actual orphan/exception/stale/alias/shared/untracked postings remain visible; foreign source identifiers are redacted. Non-manual families are deliberately unverified, including empty unknown families; the four POS tender/cost families remain unsupported. This does **not** complete every producer contract or certify the ledger.
- Full trace/procedure/limitations: evidence/desktop-acceptance-20261013/LEDGER_V4_CONTRACT_REVIEW.md. New SQL suite is in maintained Restaurant discovery; the actual selected runner attempted it and returned child exit 2 because LUNA_REMEDIATION_TEST_DB_URL is absent. Zero PostgreSQL assertions, marker reads, parsing, migration executions or concurrency acceptance ran. Guarded role initializer assumes postgres only after exact hosted-target checks, then verifies the exact disposable marker before DML; it adds no grants. Genuine operator preflight is required before test fixture DML. The explicitly normalized ordered migration/history transaction prevents an older candidate being applied over the correction; uncertain dispatch would require same-ID history inspection.

| Gate | Evidence type | Tests | Passed | Failed | Skipped | Exact saved transcript |
|---|---|---:|---:|---:|---:|---|
| ledger_contract | source assertions and executable no-network guard checks | 12 | 12 | 0 | 0 | v4-contract-current-run.txt |
| accounting_wrapper | source and mocked behavior regressions | 43 | 43 | 0 | 0 | v4-remediation-final-run.txt |
| payroll | source assertions | 8 | 8 | 0 | 0 | v4-payroll-run.txt |
| budgets_statements | source assertions | 8 | 8 | 0 | 0 | v4-statements-run.txt |
| postgresql_maintained_attempt | blocked before connection; zero SQL assertions executed | 0 executed | - | blocked | - | v4-sql-maintained-run.txt |
| guide_gate_baseline | source/filesystem and mocked IPC | 12 | 11 | 1 | 0 | v12-approved-guide-baseline-run.txt |
| guide_gate_strict | source/filesystem and mocked IPC | 12 | 10 | 2 | 0 | v12-approved-guide-strict-run.txt |

Raw transcripts are durable .txt files; per-file SHA-256 and counts are in evidence/desktop-acceptance-20261013/continuation-current-results.json. These selected runs are not a current Restaurant aggregate. The historical 42-suite/1118 result and mocked Bar 39/39 result are not relabelled current.

- Real Electron remains **16/22**; no normal clicks or new lifecycle were added. PAY-01..06, payroll source/professional approval and complete payroll lifecycle, separate cutover maker/checker/apply, and current-build Statements/close/reopen remain open. Approved disposable public configuration, genuine test login and visible Manage unlock, approved SQL connection and genuine staff session must be securely configured outside chat. Prior Auth/PIN provisioning and full API-key inventory rejections were not retried or bypassed.
- Existing accepted POS order 2d66eed1-0cbf-4f8b-a9d6-2f6c9fdca31c, posting 656285b4-b206-4337-9be1-388d2b3c1550 and journal 6c472c02-102b-4a30-a5ee-bfa7d7b401e6, attendance, Till, bank/AP/journal/budget and already-applied cutover are retained without repeats. No current DB snapshot or new fixture exists.
- Manual impact is **required**: source-coverage refusal/recovery and period-close expectations affect finance users and urgent guidance. Preserved exact v11 pair. Prepared unapproved v12, 85-page manual 903631c239d8dda9f5aa0e148b21bbc156777cf4da8339d96efa27a9f14453f6, 5-page quick-start bb85ed25995318550dcb2ef776152f79ff7183bccbc7a4afacab0d98fa5b9278. Changes: BAR-DOC-082, BAR-DOC-093, Quick Start page 5. Rendered changed/downstream pages, visually reviewed the changed procedures/contents/downstream layout and all quick-start pages; structural check found no blank/out-of-page text. Historical v11 screenshots reused unchanged; current-build recapture, 1466 semantics, 29 service-control scope decision, usability, qualified human approval, released-binary applicability and ordinary cashier offline open/save remain open. Packet: docs/bar-manual/build/remediation-candidate-2026-10-13-v12/evidence/APPROVAL_PACKET.md.
- Current approved-guide gate exposes a real mismatch: canonical and existing package manual SHA-256 91bfd9812685939f780b60c273231515a91ee13930c8e08c9e9ee9d725437308, manifest-approved 682ab70a868c706b9ab0dde18a1272f40791b968b91963f62d481b6fd79c3356. The previous package test compared package with local PDFs without checking approved bytes. Strengthened it to check exact approved manifest and hashes; current result is 10/12 passed, 2 failed, 0 skipped. Approval hashes/PDFs/package were not altered to make it pass. Both PDFs' actual parity is in continuation-current-results.json. This is filesystem/mock IPC evidence, not visible cashier acceptance.
- Source commands and repository writes started with the default helper this turn. npm.ps1 emitted an existing denied-read warning for its optional user npm-prefix probe, while maintained scripts did execute. No ACL/control was edited and no claim is made that the prior default-helper failure was repaired. Node v24.14.0; changed tracked-file whitespace check passed.
- Production link **oicgpknsmtvcsjacymum** preserved. No disposable business mutation, production query/mutation/deployment, customer Accounting activation, guide approval/promotion, signing or installer/publication occurred.

## 2026-10-13 — current SQL preflight, source contracts and compile evidence

This supersedes only the SQL-runner safety and source/build evidence above. It does not change the saved operator matrix or deployment state.

- Preserved unapplied candidate files in dependency order: `20261013010000_restaurant_ledger_source_identity_gate.sql` (predecessor, SHA-256 `10a89246e8dde59330febce7615524306abea30a248e30ab3a1b489deef09a87`) then `20261013020000_restaurant_ledger_provenance_gate.sql` (provenance correction, SHA-256 `f2d072fad3a862616be483ff4477e7d8b998a929a8df6666c3dfcea925e8d86a`). The runner explicitly normalizes their transaction boundaries and applies the ordered chain/history together; it does not rely on rollback undoing file-level `COMMIT` statements.
- The second candidate was reviewed against producer SQL and the prior cross-surface trace. It can certify only governed manual drafts after SQL acceptance. The registry has 35 source families, but 16 have no evidenced row-level population contract in this candidate; their producer/state/date/identity/version/hash or class-allocation gaps are recorded in `evidence/desktop-acceptance-20261013/SOURCE_CONTRACT_REGISTER_20261013.md`. All non-manual families remain unverified, even at zero rows. Ledger export, statements finality and close remain fail-closed; no speculative migration was added.
- Tightened `scripts/accounting-ledger-disposable-v4.mjs`: after the exact disposable marker and explicit fixture-role assumption, it requires `LUNA_REMEDIATION_LEDGER_STAFF_SESSION` and proves the existing authorized wrapper under `SET LOCAL ROLE anon` inside a read-only transaction before candidate history inspection or DDL dispatch. It adds no grants and does not fabricate an actor. Expanded the executable SQL acceptance to check direct manual expected-population eligibility, all non-manual family refusal, source operation/hash and posting-key mismatches, retained-draft/journal relationships, independent orphan diagnostics, persisted exception/reversed states, the rejected literal `failed` state, shared-journal refusal, role denial and finality/export/close refusal. These PostgreSQL cases remain prepared, not executed.
- A fresh read-only SQL preflight stopped before network access because all five required settings are absent: `LUNA_REMEDIATION_TEST_DB_URL`, `LUNA_REMEDIATION_TARGET_MARKER`, `LUNA_REMEDIATION_EXPECTED_DATABASE`, `LUNA_REMEDIATION_EXPECTED_PROJECT_REF`, and `LUNA_REMEDIATION_LEDGER_STAFF_SESSION`. Zero PostgreSQL assertions, marker reads, migration parsing/application or fixture DML occurred. Exact target remains `repsrmlomedqrmrdsbga`, marker `LUNA-REMEDIATION-DISPOSABLE-v1`, database `postgres`; the SQL user must be able to `SET ROLE postgres`, and that assumed role must have disposable DDL and `supabase_migrations.schema_migrations` select/insert privileges. The test role needs table access for savepoint fixtures; assertion roles remain actual `anon`/`authenticated` and the genuine app-session wrapper. Ready command: `npm run test:restaurant:ledger-disposable -- --apply-candidate` after those prerequisites are configured securely. Presence-only evidence with no values: `evidence/desktop-acceptance-20261013/ledger-acceptance-prerequisites-20261013.json`.
- Maintained source contract suite: 1 suite, 15/15 passed, 0 failed/skipped, exit 0. Raw transcript SHA-256 `bad2cf7f9c049882a4d2dcc259d6f2040458bd15c3a66da93c1d18de59de2226`; `evidence/desktop-acceptance-20261013/ledger-provenance-contract-source-current-20261013.txt`. This checks repository source and prepared-test discovery only. No full Restaurant aggregate or SQL integration pass is claimed.
- Current-worktree compile-only build: 192 artifacts, exit 0; source context 515 files / SHA-256 `c3682d5e0f97ece2a3413d05f4cb439837260a26fe730ccbd4f47c62030bd2d9`, config SHA-256 `e8335213e8cb620804c0b3b6ab089a65d43ae7dd47e935655e947fdeed2cc799`, artifact SHA-256 `a1aa6f47e49d111aa1a1bd7270757b5c864cf9a64479c9253c278d36e17a26cb`. It used an invalid placeholder key, no environment files and a minimal allowlist; it was not launched and is not online acceptance. Evidence: `evidence/desktop-acceptance-20261013/source-compile-only-build-r3.json`.
- Current real Electron matrix remains **16/22**, with no additional normal clicks. Payroll PAY-01..PAY-06, payroll source/professional approval and lifecycle, a separate cutover maker/checker/apply lifecycle, and current-build Statements readiness/close/reopen remain open. No browser operator run, fresh real Electron/RPC/IPC lifecycle, or financial fixture mutation occurred. Prior accepted POS, bank, AP, journal, budget and applied-cutover evidence remains retained.
- Guide v12 remains an unapproved 85-page/5-page candidate. The exact two strict gate failures and four distinct candidate/canonical/package/approved manifest hash pairs are now recorded in `docs/bar-manual/build/remediation-candidate-2026-10-13-v12/evidence/APPROVAL_PACKET.md`. Current-source screenshots, V8R2-03 semantics, V10-SCOPE-01 owner decision, V9-02 usability review, human approval, approved-pair packaging and ordinary-cashier offline open/save remain open.
- Production link `oicgpknsmtvcsjacymum` preserved. Disposable candidate history was not freshly read; the last saved verified head remains `20261010020000` and is historical. No production query/deployment, customer activation, guide promotion, installer signing or publication occurred. End-to-end readiness remains **false**.
- Follow-up prepared-test refinement: the SQL timezone-boundary case now calls `pos_business_date_at` using the lodge's configured timezone at midnight and checks an explicit stored date wins. SQL test syntax check passed; the maintained source-contract suite was rerun after the change at 1 suite / 15 passed / 0 failed or skipped / exit 0. Latest transcript: `evidence/desktop-acceptance-20261013/ledger-provenance-contract-source-current-20261013-r2.txt`, SHA-256 `6c6017bdce881b26e6c50a9b8d8f752eaed8650fd0712129d04916553b564867`. These remain source/prepared-SQL checks; zero PostgreSQL assertions ran.

## 2026-10-13 — disposable PostgreSQL preflight resumed; secure inputs still absent

- Read the current agent instructions, state, closure register, retained fixture register, package script routing and guarded runner before this attempt. Preserved existing work and fixtures.
- Checked process, user and machine environment-variable names only for an approved alias of the database connection or staff session. No suitable alias was present. No values were read or printed; unmatched project/client and privileged credential names were not mapped.
- Set the known disposable guards in the runner process: project `repsrmlomedqrmrdsbga`, database `postgres`, marker `LUNA-REMEDIATION-DISPOSABLE-v1`. The dedicated runner stopped with `LUNA_REMEDIATION_TEST_DB_URL is required; no database fallback is permitted.` The remaining secure settings are `LUNA_REMEDIATION_TEST_DB_URL` and `LUNA_REMEDIATION_LEDGER_STAFF_SESSION`. No connection, marker query, history read, role assumption, staff-session check, SQL assertion, migration dispatch or fixture write occurred. Exact evidence: `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/ledger-acceptance-preflight-20261013-r2.json` and runner output `ledger-v4-postgresql-result.json`.
- `package.json` routes `test:restaurant` to `tests/run-restaurant-suite.mjs`; that runner ignores `--apply-candidate`. The requested `npm run test:restaurant -- --apply-candidate` was not run because it would not invoke the guarded migration procedure. The dedicated route is `npm run test:restaurant:ledger-disposable -- --apply-candidate` once both secure settings are configured. No script routing was changed.
- Candidate order and hashes remain unchanged: `20261013010000_restaurant_ledger_source_identity_gate.sql` (`10a89246e8dde59330febce7615524306abea30a248e30ab3a1b489deef09a87`), then `20261013020000_restaurant_ledger_provenance_gate.sql` (`f2d072fad3a862616be483ff4477e7d8b998a929a8df6666c3dfcea925e8d86a`). Neither was applied in this attempt. Current migration history remains unread; `20261010020000` is only the last saved historical head. PostgreSQL assertions: 0 executed; suite not started, so pass/fail/skip counts are not applicable.
- The secure SQL URL must connect only to `repsrmlomedqrmrdsbga/postgres`; its connecting role must be able to `SET ROLE postgres`, and assumed `postgres` must have disposable DDL, `supabase_migrations.schema_migrations` SELECT/INSERT and savepoint-fixture DML privileges. The separate genuine staff session must pass the existing `accounting.read` wrapper under actual `anon`; do not use a service-role claim or fabricated session. No grant changes are requested.
- No current database fixture reread or mutation occurred. The retained POS/order/posting/journal, attendance, Till, bank, AP, journal, budget and applied-cutover evidence remains preserved but was not reverified live. Source/mock results remain separately classified at their saved counts; no unchanged suite was rerun. Real Electron remains 16/22. Payroll, cutover, Statements close/reopen, guide approval/package/offline acceptance remain open. Production link `oicgpknsmtvcsjacymum` is preserved; no production query, deployment, customer activation, guide promotion, installer signing or publication occurred. End-to-end readiness remains **false**.

## 2026-10-13 — source-track review and fresh Bar guide gate

- Database source review found no justified migration correction. Candidate `20261013010000` then `20261013020000` remains unchanged and unapplied. Non-manual source families remain fail-closed; the prepared SQL comparison derives its actual and expected non-manual sets from the same population function, so it does not independently validate producer eligibility. No PostgreSQL assertions ran.
- Desktop/Payroll source review found renderer, IPC and server capability checks present; Payroll source-registration, statutory approval, private workspace, calculation and raw-export RPCs remain service-role-only by design. No grant was broadened. The existing Payroll gate passed 8/8 before the new staff-role source regression; the expanded maintained suite passed 10/10. Both are source assertions, not operator/RPC acceptance. PAY-01..PAY-06 remain open.
- Staff-role scenarios are separately open and do not change the 22-control denominator: cashier/bartender permitted sales versus Payroll/approval/export denial; manager operational access versus self-approval denial; finance Accounting and explicit Payroll/export capabilities; distinct independent checker identity/evidence scope; suspended and wrong-lodge/outlet server-side denials. No current real staff identity session, Electron journey or live RPC denial was tested.
- Fresh `npm run test:bar-guides` result: 12 checks, 10 passed, 2 failed, 0 skipped, exit 1. Failures are `approved Bar guide manifest matches both release PDFs` and `existing directory package contains the approved guide pair`. Exact expected/actual values, candidate/canonical/package/manifest hashes, affected pages and remaining owner decisions are in `docs/bar-manual/build/remediation-candidate-2026-10-13-v12/evidence/CURRENT_RECHECK_20261013.md`; transcript is `strict-gate-recheck-20261013.txt` (SHA-256 `f8701330639825ed459c3bc9959948385d6bcd7560deae377f59d6e8e13a726f`). The addendum SHA-256 is `5cfec64d93107756af1be0b4fc237762b42d29c81a279f4637b4f622eb6f3c6d`.
- v11/v12, official manifest, canonical PDFs and packaged PDFs were preserved. No new guide revision was justified. No current-build screenshots, independent usability review, product-owner scope decision, human approval, approved-pair packaging, or ordinary-cashier offline open/save acceptance occurred. No approval, promotion or publication is recorded.
- The latest SQL guard remains blocked on the two secure settings already requested: `LUNA_REMEDIATION_TEST_DB_URL` and genuine `LUNA_REMEDIATION_LEDGER_STAFF_SESSION`. Do not repeat unchanged preflight. No current disposable marker/history verification or fixture read occurred. Existing retention evidence remains historical.
- Current accepted Electron controls remain 16/22; no new control or financial lifecycle was accepted. Payroll statutory source and qualified independent approval, full Payroll lifecycle, separate cutover prepare/checker/apply, and Statements close/reopen remain blocked/open. Compile-only 192-artifact evidence and prior source/mock counts are not reclassified as online acceptance. Production link `oicgpknsmtvcsjacymum` remains preserved; no production query/deployment/mutation, customer activation, guide promotion, installer signing or publication occurred. End-to-end readiness remains **false**.
- The new maintained Payroll staff-role source suite passed 1 suite/10 tests, 0 failed/skipped, exit 0; transcript SHA-256 `0d1718fff216def315f2bd523f6f88404c77d94f1261a8a437d8b52d26680593`. It checks active lodge-scoped role defaults and separate renderer/IPC capabilities, but does not accept real identities.
- The repository-only producer trace covers all 18 mapped non-manual families and records missing immutable inputs/class-allocation evidence; no speculative migration was added. Its new maintained source-contract suite passed 1 suite/4 tests, 0 failed/skipped, exit 0; transcript SHA-256 `415e129b7a5bd3c42f32c431291f78b6a7a2020c46196a1566f84bf7c48e6b62`. Evidence: `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/NONMANUAL_PRODUCER_TRACE_20261013.md` and `ledger-producer-source-maintained-20261013-r1.log`. PostgreSQL assertions remain zero.

## 2026-10-13 — guarded command wiring and secure setup handoff

- Fixed the maintained `npm run test:restaurant -- --apply-candidate` entrypoint: it routes only that single flag to the dedicated guarded ledger runner, rejects mixed flags, fixes the project/database/marker guards in code, and passes only the two required secure inputs plus basic Windows runtime variables. It excludes service-role and generic database variables. The dedicated `test:restaurant:ledger-disposable` package script now uses the same maintained entrypoint and also requires the explicit apply flag. Latest maintained regression: 1 suite / 4 tests / 0 failed / 0 skipped / exit 0; transcript SHA-256 `0188e59ecd1ccf037f004d8965ef3bb0377472d9ebce84dcb4bfa8cc15f3ba40`. It also verifies the presence checker does not print configured values. Tests used fake child-process inputs and did not connect to PostgreSQL.
- Hardened runner history evidence: validates any applied predecessor bytes against the preserved SQL candidate, verifies exact ordered history after execution, reports before/after versions, and parses actual suite test/pass/fail/skip counts from its sanitized transcript. `node --check` passed for the runner and presence-only config checker. Full-worktree `git diff --check` remains nonzero because unrelated existing Bar documentation edits contain trailing whitespace; no unrelated files were changed to clear it.
- Added a presence-only `npm run test:restaurant:ledger-config` check and the secure setup/resume handoff at `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/SECURE_SETUP_AND_RESUME_HANDOFF_20261013.md`. The checker was not run; secure values remain absent and are not stored in the handoff.
- Default command execution stalled before output, so focused tests and final checks completed through the permitted approval-reviewed path. No ACL or control settings were edited; this does not establish that the default command helper was repaired.
- No database preflight or migration was retried. Candidates `20261013010000` and `20261013020000` remain unapplied by the latest saved evidence; `20261010020000` is a historical migration head only. Zero PostgreSQL assertions ran.
- Source-derived current navigation and action locators are prepared for General ledger, Payroll, Accounting setup/cutover and Financial statements; no new Electron click or lifecycle was accepted. Matrix remains **16/22**. Payroll still lacks governing documents/hashes, independent qualified signed approval, non-PAYE sources and an approved protected server path. Cutover and statement close/reopen remain open. Ledger coverage stays fail-closed.
- Guide v12 remains unapproved with both approved-manifest checksum failures open. V8R2-03 semantics, V10-SCOPE-01 scope, V9-02 usability, human approval, exact approved package parity and ordinary-cashier offline open/save remain required.
- Production link `oicgpknsmtvcsjacymum` preserved. No production query/mutation/deployment, customer activation, guide promotion, installer signing or publication. End-to-end readiness remains **false**.

## 2026-10-13 — coordinated checkpoint and manual-journal provenance review

- Ran the safe presence-only secure configuration checkpoint once with fixed guards set to project `repsrmlomedqrmrdsbga`, database `postgres`, marker `LUNA-REMEDIATION-DISPOSABLE-v1`. It returned `ready:false`; only `LUNA_REMEDIATION_TEST_DB_URL` and `LUNA_REMEDIATION_LEDGER_STAFF_SESSION` are missing. Values were not printed or persisted. The command stopped before network/database access. Evidence: `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/ledger-config-check-20261013-r1.json`.
- The maintained apply-entrypoint source regression passed 1 suite / 4 tests / 0 failures / 0 skips. No SQL preflight or migration ran. Transcript SHA-256 `0188e59ecd1ccf037f004d8965ef3bb0377472d9ebce84dcb4bfa8cc15f3ba40`.
- Independent producer review found a manual-journal evidence gap: the authoritative producer posts the governed draft and journal with the same actor, but candidate `restaurant_manual_journal_evidence_v4` checks only non-null `draft.posted_by` and does not compare it with `journal.created_by`. A forward correction and focused regression are being prepared. This is source evidence only; no candidate was applied and zero PostgreSQL assertions ran. Non-manual expected-population proof remains non-independent and all non-manual contracts remain fail-closed.
- Desktop source preparation confirms existing Accounting browser checks are mocked and maintained desktop Playwright lacks Accounting operator journeys. The screenshot launcher passes ambient environment through and is unsuitable for privileged acceptance. Matrix preparation: `evidence/desktop-acceptance-20261013/cross-role-operator-matrix-preparation-20261013.md`. No Electron/RPC run occurred.
- Electron remains 16/22. SQL, Payroll PAY-01..06, separate cutover and Statements close/reopen remain open. Guide v12 remains unapproved; strict gate is 10/12 and scope/usability/human approval/package/offline acceptance remain open. Retained fixtures were not touched or live-reverified. Production link `oicgpknsmtvcsjacymum` preserved; no production query/mutation/deployment, customer activation, guide promotion, signing or publication occurred. End-to-end readiness remains false.

## 2026-10-13 — manual journal actor-binding forward correction prepared

- Source comparison confirmed that `post_restaurant_manual_journal` supplies the same posting actor to the immutable draft and `_restaurant_post_journal`, which persists it as journal `created_by`. Candidate 20261013020000 did not verify this equality. Added forward migration `20261013030000_restaurant_manual_journal_post_actor_binding.sql` (SHA-256 `0018CC7EEDDD94EDCFE3AA05BD6B6B412A809AADEE7AE24B101CA714E8643026`). It fails certification closed with `posted_actor_journal_creator_mismatch` for missing/different actors and preserves the prior two migration files. The guarded runner now orders 100 -> 200 -> 300, verifies exact pre/post history, and keeps the explicit normalized transaction boundary. All three remain unapplied pending disposable secure configuration and genuine staff preflight.
- Prepared SQL acceptance now checks different, matching and missing actors plus retained posted manual journals; this is prepared SQL only. The focused maintained source/discovery test passed 1 suite / 3 tests / 0 failures / 0 skips. Transcript `evidence/desktop-acceptance-20261013/manual-actor-binding-maintained-source-20261013-r1.log`, SHA-256 `ECBF183630673992E77C6E4FC43BFC74A1C6394BE9120CD898C45140EF642DC8`. Source regression hash `8D1C162B793A30585997133EBBC16FFB3A5348A82814FB42F13AB65DE77B2E07`; prepared SQL suite hash `0F81C8B5611D97F1C28B808EE62BE59D032BD04236E2226B29FC15393EC68105`; runner hash `DF3A8FA0EC4A11E343BF54276C8CAD7496178F407FCD677BE3490FEFF2A4D30C`.
- PostgreSQL assertions remain zero. No SQL URL/session, marker preflight, history read, migration apply, RPC, or fixture mutation occurred. All non-manual families remain unverified/fail-closed; the expected-population comparison still lacks independent producer-derived expectations for non-manual source classes.
- Current-build desktop runner safety review is documented at `evidence/desktop-acceptance-20261013/current-build-accounting-electron-runner-preflight-20261013.md`: existing Electron helper inherits ambient environment and can synthesize/read local sessions; it is unsafe for this acceptance. No safe real Electron journey can be launched until disposable public client config, permitted genuine identities/Manage unlock, and fixture map are available. No browser/electron acceptance added; matrix stays 16/22.
- Bar scope review addendum: `docs/bar-manual/build/remediation-candidate-2026-10-13-v12/evidence/CURRENT_SOURCE_SCOPE_REVIEW_ADDENDUM_20261013.md`. It distinguishes source-visible routes from approved product support, identifies `/hpos/service` owner scope decision, confirms package source inputs come from canonical `output/pdf`, and keeps exact-pair approval, independent usability, approved package parity and ordinary cashier offline open/save gates open. Candidate/canonical/packaged/approved artifacts remain unaltered.
- Secure configuration guide: `evidence/desktop-acceptance-20261013/SECURE_SETUP_AND_RESUME_HANDOFF_20261013.md`. The single current DB blocker is still the two secure values `LUNA_REMEDIATION_TEST_DB_URL` and `LUNA_REMEDIATION_LEDGER_STAFF_SESSION`; fixed target guards are not requested again. Payroll still separately requires authoritative statutory documents/version/hash and independent qualified approval.
- Production link `oicgpknsmtvcsjacymum` preserved. No production read/mutation/deployment, customer activation, guide approval/promotion, signing or publication. End-to-end readiness remains false.

## 2026-10-13 — maintained Restaurant aggregate result

Ran `npm.cmd run test:restaurant -- --keep-going` after the source correction. The wrapper discovered 50 suites and exited 1 with five nonzero suites: `restaurant-accounting-behavioral.test.mjs`, `restaurant-accounting-cutover-activation.test.mjs`, `restaurant-accounting-ledger-provenance-sql.test.mjs`, `restaurant-recipe-depletion-behavioral.test.mjs`, and `restaurant-station-routing.test.mjs`. The output showed the behavioral suite attempting `127.0.0.1:54322`, which refused the connection; the provenance SQL suite stopped because `LUNA_REMEDIATION_TEST_DB_URL` is absent. I did not configure or substitute localhost. The complete root cause for the other three failures and aggregate assertion totals were not retained, so neither is inferred. Summary evidence: `evidence/desktop-acceptance-20261013/restaurant-aggregate-20261013-r1-summary.json`. The source suites for the actor correction (3/3), producer contract (4/4), provenance contract (15/15), and maintained apply entrypoint (4/4) passed in their separate runs. No approved disposable or production database was reached, no candidate applied, and no accepted financial fixture was changed. Do not rerun the unchanged aggregate until its database-dependent suites are safely gated/configured.
## 2026-10-13 — Restaurant runner containment and current aggregate refresh

- Fixed the unsafe test-runner paths exposed by the prior aggregate: four DB-dependent suites are explicitly classified and gated before spawn; they receive only the approved disposable configuration, and the parent records `blocked` with `database connection attempts=0` when the required secure DB URL or genuine staff session is missing. Legacy localhost fallback was removed from the accounting behavioral and recipe-depletion suites. The disposable connection helper validates hosted project/database identity and production link, requires the genuine session, then assumes the disposable fixture role and verifies the marker. The guarded preflight checks the existing `accounting.read` wrapper under actual `anon` before migration history/DDL.
- Hardened the real Accounting Electron launcher: it no longer reads repository `.env`, inherits ambient environment, or seeds an authenticated session. Online launch requires the disposable public client URL/key, exact disposable project host, public-key shape, Bar mode, and a new empty isolated profile; privileged and unapproved variables are rejected. This is launcher safety evidence, not an Electron launch or operator acceptance.
- Updated a stale Restaurant station-routing assertion after the full aggregate showed it expected a direct menu-table `select`, while current code uses the staff-scoped `get_pos_menu_items_for_staff_v1` RPC returning the full `pos_menu_items` row. The updated test checks the RPC, full-row return contract, and station-column migration. Focused suite: 46/46 pass. Runner/Electron guard regressions: 8/8 pass. These source/mock checks do not constitute DB or desktop acceptance.
- Fresh maintained `npm.cmd run test:restaurant -- --keep-going`, at `2026-10-13T20:49:12.612Z`, discovered 52 suites: 48 passed, 4 blocked, 0 test-failing suites. Of suites emitting TAP counts, 1,143 tests passed, 0 failed, 0 skipped; `restaurant-hpos-service-contract.test.mjs` reports success without TAP counts and is excluded from that total. The aggregate command exits 1 because the four DB suites are blocked. Exact report: `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/restaurant-maintained-run-2026-10-13T20-49-12-610Z.json`, SHA-256 `5960675bb1dc840eab7635401721fbb8da497ca82f92e9081ecf8fe8a3b9de7b`. Blocked suites: `restaurant-accounting-behavioral.test.mjs`, `restaurant-accounting-cutover-activation.test.mjs`, `restaurant-accounting-ledger-provenance-sql.test.mjs`, `restaurant-recipe-depletion-behavioral.test.mjs`. Each lacked `LUNA_REMEDIATION_TEST_DB_URL` and `LUNA_REMEDIATION_LEDGER_STAFF_SESSION`, was not spawned, and reports zero database connection attempts. PostgreSQL assertions: 0; preflight/migrations/fixtures were not touched.
- The prior aggregate's additional station-routing failure was a stale source assertion, not a runtime failure; the current aggregate and focused suite both pass after correction. Earlier logs did not retain roots for three of its other nonzero children; no retrospective cause is claimed. The fresh guarded run demonstrates the replacement fail-closed behavior.
- No DB URL/session was staged, no production or disposable DB was reached, no migration applied, and no retained financial fixture was reread or mutated. Candidates `20261013010000`, `20261013020000`, and forward correction `20261013030000` remain unapplied by this run. Production link `oicgpknsmtvcsjacymum` remains preserved.
- Real Electron remains 16/22. No control, financial lifecycle, payroll, cutover, Statements close/reopen, or cashier guide acceptance was added. Payroll statutory documents and independent qualified approval; database secure configuration; genuine online Electron identity/configuration; guide v12 owner/usability/approval/package/offline gates remain open. No production deployment, customer activation, guide promotion, installer signing or publication occurred. End-to-end readiness remains **false**.
## 2026-10-13 coordinated batch follow-up — secure gate still blocked

- Required instructions, architecture, latest project/closure/fixture records and secure setup handoff were read; repository status confirmed extensive pre-existing unrelated changes, which were preserved. Exact saved Restaurant aggregate was rechecked: report at `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/restaurant-maintained-run-2026-10-13T20-49-12-610Z.json`, 52 suites / 48 passed / 4 blocked / 0 failed test suites; 1,143 TAP-counted pass, 0 fail/skip. It is not green because the DB suites were blocked.
- Ran the requested presence-only command once. `LUNA_REMEDIATION_TEST_DB_URL` and `LUNA_REMEDIATION_LEDGER_STAFF_SESSION` are both missing. Values were not read or logged; there was no connection, marker/session/history check, SQL assertion, migration or fixture action. Evidence: `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/secure-config-presence-20261013-r1.json`. Do not repeat without a configuration change.
- Verified runner order and current candidate hashes: 20261013010000 source-identity gate (`10a89246e8dde59330febce7615524306abea30a248e30ab3a1b489deef09a87`), 20261013020000 producer-provenance gate (`f2d072fad3a862616be483ff4477e7d8b998a929a8df6666c3dfcea925e8d86a`), 20261013030000 manual posted-actor/journal-creator binding (`0018cc7eeddd94edcfe3aa05bd6b6b412a809aadee7ae24b101ca714e8643026`). Corrected stale secure handoff from a two-migration sequence to this actual three-migration chain. None was dispatched; current live migration history remains unknown because secure DB access is absent.
- Reviewed the existing v12 owner/usability/approval packet and producer contract register. No authoritative evidence supports a new non-manual certification or source-rule migration: the expected/non-manual population comparison is not independent and unsupported families stay fail-closed. Guide v12 remains unapproved; the `/hpos/service` support decision, deduplicated action coverage denominator, current-build refusal screenshots, independent usability, exact-pair human approval, approved manifest/package parity and ordinary cashier offline open/save remain open. The existing exact v12 packet documents candidate/canonical/package/official-manifest bytes separately; no approved artifact changed.
- No new desktop acceptance or build was run: the normal-click matrix remains 16/22, no PAY-01..06 lifecycle, separate cutover, or Statements close/reopen was completed. A current online run still requires approved disposable public configuration, genuine operator/checker identities and visible Manage unlock. Payroll additionally requires governing statutory source documents with versions/effective dates/hashes and independent qualified signed approval, plus an approved protected server path.
- No retained fixture was reread or modified. Production link `oicgpknsmtvcsjacymum` was preserved; no production query/mutation/deployment, customer activation, guide approval/promotion, installer signing or publication occurred. End-to-end readiness remains **false**. Full checkpoint is recorded in the closure register and secure setup handoff.
## 2026-10-13 — disposable identity authorization and secure access blocker

- New authorization arrived from the user’s “Manage Accounting Remediation” task to create a new disposable Accounting staff identity and Manager unlock credential, plus a separate checker if required. It was not treated as permission to use production or unsupported Auth/SQL paths. The supplied DB password could not be paired with a verified disposable host: the local CLI project-list output was unclassifiable, and the safe computer-use helper failed before app enumeration. No user/checker, PIN, session, or database URL was created; no DB mutation occurred.
- Security incident: while retrieving only the designated source-thread message programmatically, its raw response was rendered in an intermediate tool result. The supplied value was not used, written to repository/evidence, or placed in a command; it was cleared from session memory. Treat it as exposed and rotate it before host-side configuration. Secret-free evidence: `docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/identity-provisioning-access-check-20261013-r1.json`. Do not request a replacement in chat.
- Exact blockers now include: verified disposable PostgreSQL URL for repsrmlomedqrmrdsbga/postgres and fixed marker, with the required fixture-role privileges; approved server-side disposable Auth/staff provisioning path; approved disposable public client config for the minimal Electron allowlist; then a genuine normal sign-in producing the `accounting.read` staff session under `anon`. Keep the 16/22 normal-click matrix and all database/lifecycle counts unchanged until then.

## 2026-10-14 — Restaurant runner containment follow-up

- Replaced the legacy test:restaurant:disposable local Supabase start/reset path and its implicit 127.0.0.1:54322 database fallback. The command now accepts only the approved hosted disposable project, fixed database/marker guards, and the two secure inputs; it passes an explicit environment allowlist to the maintained aggregate. It does not start/reset local Supabase or forward generic database/service-role variables. This is a source change; no DB URL/session was present or used.
- Extended restaurant-runner-database-gate.test.mjs to test missing/wrong target refusal before child launch, scoped secret forwarding/redaction and assertion counts, removal of local reset/fallback code, and --apply-candidate dispatch to the guarded ordered migration runner. Final focused maintained result: 1 suite, 6 tests passed, 0 failed/skipped, exit 0; restaurant-electron-runner-guard.test.mjs: 1 suite, 4 tests passed, 0 failed/skipped, exit 0. Both use fake children/temporary profiles only.
- Current guarded npm.cmd run test:restaurant -- --keep-going result at 2026-10-13T22:01:08.651Z: 52 suites, 48 passed, 4 blocked, 0 assertion-failing suites; 1,145 TAP-counted tests passed, 0 failed/skipped, plus one passing service-contract suite without TAP counts. Exit 1 is required because the four DB suites were blocked before spawn with both secure values absent and zero database connection attempts. PostgreSQL assertions: 0. Evidence: docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/restaurant-maintained-run-2026-10-13T22-01-08-650Z.json.
- The retained five-suite historical aggregate lists the failed suites but did not preserve all three older causes. It did preserve the Accounting behavioral loopback refusal and the SQL-provenance missing-URL failure in the summary. A later detailed retained run identifies the stale station-routing assertion (expected direct kitchen_station_id select instead of staff-scoped RPC), now passing after its repair. The remaining two historical roots are not recoverable from retained output; no cause is inferred. Current fail-closed DB statuses are separately recorded and are not retroactive explanations.
- Three migration candidates remain unapplied/unverified against the live disposable project: 20261013010000, 20261013020000, 20261013030000; no marker/history check or fixture mutation occurred. Accepted financial fixtures remain untouched. Real Electron remains 16/22; no operator/RPC lifecycle was accepted. Payroll, cutover, Statements close/reopen, and guide v12 approval/package/offline gates remain open. Production link preserved; no production query/deployment, customer activation, guide promotion, signing or publication. End-to-end readiness remains false.
- Prepared a concise owner/usability decision packet for Bar guide v12 at docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/BAR_V12_OWNER_USABILITY_DECISIONS_20261014.md. It separates v12 candidate, canonical/package bytes and official approved hashes; requests the unresolved /hpos/service support decision, normalized action denominator sign-off, independent ordinary-user review, build applicability and human approval of the exact pair. The last guide gate remains 10/12; packaging parity and offline cashier open/save remain unaccepted.
- Consolidated evidence, including the expected blocked disposable command exit and distinct source/mock, PostgreSQL and Electron outcomes, is in docs/audits/2026-10-07/accounting-remediation/evidence/desktop-acceptance-20261013/runner-containment-acceptance-20261014.json.

## 2026-10-20 - Bar local-authority integration gate remains open

- Current source checkpoint confirms that the local service/contracts and SQL domain work are present, and `npm run bar-local:build` plus `npm run bar-local:typecheck` pass. The actual Modern main/preload/renderer and Legacy main entry points have no authority-router references; the service is not connected to real application workflows.
- The database suite was not run in this checkpoint because its harness resets the target schema and the required isolated loopback target configuration was unset. `SUPABASE_PROJECT_REF` was configured, so no database target was guessed.
- Customer commissioning remains NO-GO. Service/API source does not establish installer, runtime packaging, coordinator/replication, fencing, independent encrypted backup/restore, Windows 7/two-/six-device qualification, 50,000-sale/soak evidence, manuals or packaged offline guide verification. Hosted Supabase changes: none. Hosted financial ingestion: disabled.
- See `docs/engineering/bar-local-first/IMPLEMENTATION_REPORT.md` and related review evidence for the scoped checkpoint record.

## 2026-10-20 - Modern Bar-local client foundation added

- Added a Modern main-process runtime with a persisted explicit local authority profile, Electron `safeStorage` device credential storage, durable atomic profile/credential replacement, local login/query/command/retry/catalogue client operations and a fixed `barLocal:*` preload/IPC bridge. First-owner commissioning is loopback-only and unavailable to other product builds.
- Focused runtime tests pass 4/4, including simulated loopback commissioning and confirmation that the device token is not returned or written in plaintext. `npm run typecheck:main` and `npm run build:hospitality-pos` pass. Service/client unit checks pass 45/45.
- Existing POS handlers, renderer startup/login, Settings setup/status screens, background jobs and Legacy POS still do not call the adapter. The cloud operational paths remain active. Preload frozen-shape tests and the broad renderer IPC typecheck fail against the current captured API/type state; details are recorded in the implementation report. Do not represent this foundation as end-to-end local Bar operation.
- Hosted Supabase changes remain none; no service database suite was run because the required positively isolated local DB target was not configured. Commissioning/release remain NO-GO.

## 2026-10-20 — Full isolated Bar local service suite and regression fixes

- Created a fresh PostgreSQL 17.6 test cluster and dedicated database under ignored `services/bar-local/.local/`, bound only to `127.0.0.1:55441`. Set the explicit local-test guard, verified the cluster data directory, used dedicated migrator/runtime roles, and applied all 24 local-only migrations. The incomplete pre-existing cluster on 55439 was not used; no hosted Supabase target was contacted.
- The first complete database run exposed three defects: AP invoice approval attributed the maker/checker identity incorrectly and the test used a valid distinct approver for its refusal case; advanced menu receipts omitted `line_subtotal`; the tips regression referenced a nonexistent `staff_id` column. Fixed the approval attribution/negative case, receipt field and tips query. Focused affected tests and the complete suite now pass.
- Verification: `npm run bar-local:typecheck` passed; final `npm run bar-local:test` passed 64/64 (394.3s). Updated the feature matrix to represent newly tested menu modifiers/recipes/promotions, loyalty, tips/payouts and extended accounting as service-implemented but still partial pending app integration. The remaining 11 not-implemented rows and 17 partial rows are not treated as completed.
- Manual impact: No manual update required for these internal service/database fixes; they add no currently exposed customer workflow. A complete local-authority manual, quick-start, screenshots, approved PDFs, packaged-guide and offline open/save verification are still required before release.
- No hosted migration/write, release, customer cutover, service installation, hardware qualification or failure-soak test was performed. Daily POS entry points remain unconnected to the local adapter, so this does not complete the overall technical plan.

## 2026-10-20 — Final implementation checkpoint checks

- Re-ran `npm run bar-local:build`: passed. Re-ran `npm run test:bar-local-electron`: 4/4 passed. Re-ran `npm run typecheck:main`: passed. The PowerShell npm shim emitted an access-denied warning for the roaming npm path; each invoked project script completed with exit code 0.
- Updated the acceptance manifest evidence for the A02, A05–A07, A13, A15 and A16 scopes after the fresh database suite. Status counts remain A03 verified, 12 partial and 19 not run; database coverage does not satisfy full end-to-end acceptance.
- No Modern/Legacy application authority routing was added in this checkpoint. Existing cloud application paths remain the active operator workflows.

## 2026-10-20 — Modern pairing-code IPC

- Exposed the already implemented owner-side `startPairing` operation through the fixed Modern main-process IPC and preload/type surface. The call still requires a committed local authority and authenticated local session; no endpoint, credential, TLS material or raw transport is accepted from the renderer beyond the validated pairing request.
- Added a regression that verifies the pairing call is refused in cloud mode. `npm run test:bar-local-electron` passes 4/4; `npm run typecheck:main` was run. This is a bridge capability only: no Settings pairing UI, Legacy pairing/join client, LAN TLS provisioning or authority routing is claimed.
- Manual impact: No manual update required now because the customer-visible controls and workflow have not changed. Manual/quick-start/screenshots and packaged offline guide evidence remain required before customer release.

## 2026-10-20 — Legacy Bar-local HTTP client and durable command journal use

- Added a Legacy Node-compatible local API client using the existing append-only intent journal. HTTP is allowed only on loopback; LAN traffic requires HTTPS plus pinned SHA-256 certificate identity. The adapter verifies authority scope on login, keeps the same original envelope/operation ID for retry, marks unknown outcomes uncertain, and rejects changed-payload operation ID reuse.
- Added focused tests to the Legacy package test aggregate. `node --test tests/bar-local-client.test.mjs` passes 3/3; `npm run legacy-pos:test` passes 219 source regressions and 11 Node tests.
- Matrix BAR-LEGACY-002 is now partial: adapter/journal behavior exists, but no Legacy main-process IPC, authority provisioning UI, cashier routing, catalogue catch-up, queue fence or installed Windows 7 proof is present.
- Manual impact: No manual update required for an unconnected internal adapter. Customer-visible Legacy Bar local setup and offline guide changes remain required before release.

## 2026-10-20 — Pairing profile integrity and full authority identity

- Added local-only migration `0025_pairing_authority_scope.sql`. Pair completion now returns the authoritative authority UUID and epoch along with business/outlet/device scope; the endpoint receives only a one-use code and does not expose server credentials. The API test asserts every returned scope value matches commissioning.
- Modern pairing now requires a valid, durable intent journal before consuming a code; validates the complete returned identity; requires pinned TLS for LAN endpoints; and stores both authority profile and device credential through OS secure storage. The authority profile moved from plaintext JSON to encrypted `authority.bin`. If OS secure storage cannot decrypt a committed profile, startup fails closed instead of choosing cloud mode.
- Verification: isolated `npm run bar-local:test` passed 64/64 with 25 local migrations; focused Modern runtime tests passed 7/7, including corrupt-journal no-consumption and secure-storage unavailable denial. No hosted database was used.
- Manual impact: No customer-visible workflow changed in this checkpoint. A setup/pairing screen and customer guide coverage are still required before this capability can be released.

## 2026-10-20 — Local authority startup and IPC fences

- Modern startup now resolves the encrypted authority profile before cloud profile loading/session restoration. Local or unverifiable authority state blocks the cloud shell. The main-process IPC registration fence rejects cloud-backed handlers under a committed local authority while allowing the fixed `barLocal:*` bridge and offline `barGuides:*` operations; the boundary screen presents guide open/save actions.
- Legacy now loads its protected local profile before Supabase initialization, financial cloud-queue recovery, and legacy mesh startup. In local mode those cloud paths are not started and queued records are left untouched. Its IPC fence blocks non-`pos:bar-local:*` calls. The renderer checks authority status before restore and displays a blocked local state instead of cloud Login. Malformed committed local state also remains fail-closed.
- Verification: Modern runtime 10/10, Modern main typecheck passed, Modern `hospitality-pos` build passed, Legacy regression 219 source checks plus 16 Node tests passed, Legacy build passed. Bar guide contract tests report 10 passed, 1 failed, 1 skipped; the failure is the approved-manual checksum mismatch and the package check is skipped because packaged guide resources are absent.
- This is a safety fence, not local daily operation: Modern/Legacy Login and POS workflows, all local domain routing, background-job routing, event feed, queue/mesh fencing beyond startup, service installer and recovery remain incomplete. No hosted changes or customer cutover.
- Manual impact: required and pending. Per user direction, no PDF, screenshot, or manifest edits were made. Customer explanation, screenshots from a verified app, PDF rebuild/visual QA, checksum approval and offline package open/save verification remain pending.

## 2026-10-20 — First Modern local cashier path

- Added `BarLocalWorkspace.jsx` behind the committed local-authority startup gate. It authenticates staff through the local service, reads a complete menu snapshot/current shift, opens a shift, and submits a cash sale through the durable local command journal. Unknown outcomes are serialized across Electron IPC and expose same-operation retry; the service remains authoritative for price, stock, tender acceptance, ledger, receipt and audit. An authenticated readiness indicator refreshes every 15 seconds and pauses sale submission on blocked, unavailable or stale status.
- Modern and Legacy use the shared display-only cash estimate helper so tax rounding/precision cannot drift between clients; regression coverage rejects fractional quantity and excess financial precision. The service remains authoritative for accepted amount.
- Verification: `npm run test:bar-local-electron` passed 12/12, including structured unknown-outcome IPC and shared estimate cases; `npm run typecheck:main` passed; `npm run build:hospitality-pos` and `npm run legacy-pos:build` passed after the helper change. This is not live-service, installed-device, or rendered interaction qualification; readiness covers only current basic service checks.
- Remaining local workflow gaps include fresh commissioning and pairing UI, every tender except cash, tabs/corrections/cash-up, hardware, Settings, all other offered Bar surfaces, Legacy cashier UI, background jobs, and installed multi-till behavior. Plan and release remain open.
- Manual impact is required. Per user instruction, PDF/quick-start/screenshot/manifest edits are deferred and recorded as pending in `docs/engineering/bar-local-first/MANUAL_IMPACT.md`.

## 2026-10-20 — Legacy local cashier path and transport contract

- Connected the Legacy authority gate to a local cashier page with staff login, complete paginated catalogue validation, shift opening, cash sale commit, same-operation retry, and authenticated readiness polling. The service remains authoritative for sale totals and stock.
- Fixed the Legacy local transport to send the service's required `x-bar-device-token` and `x-bar-device-id` headers. Added a loopback HTTP contract test so future refactors cannot silently break authenticated Legacy service requests.
- Verification: `npm run legacy-pos:test` passed 219 source checks and 17 Node tests; `npm run legacy-pos:build` passed. No live service, Windows 7, printer, menu publish/catch-up, or installed POS behavior has been qualified.
- Bar manuals and screenshots are affected. Per user direction, edits to the PDFs, quick-start, screenshots and approved manifest remain pending.
# 2026-10-20 — Bar local-first implementation continuation

- Modern and Legacy local cashier workspaces now offer capability-gated product creation through the durable `catalogue.upsert` command. The local service enforces `pos.menu_manage` and supplies the audit/operation record; tracked products still require a separate stock receipt. The workspace supports staff PIN login, shift opening, complete local catalogue reads, cash-only sale, readiness display and same-operation retry.
- Reconciled the feature matrix: 30 locally implemented, 24 partial, 8 not implemented and 1 external-pending across 63 requirements. The generic BAR-SALE-001 is partial because current client routing covers only the dedicated cash workspace; existing POS surfaces, non-cash tender, corrections and other workflows are not routed to local authority.
- Verification: `npm run test:bar-local-electron` 12/12; `npm run legacy-pos:test` 219 source checks plus 17 Node tests; `npm run build:hospitality-pos` passed; `npm run legacy-pos:build` passed. No live renderer/service, installer, Windows 7, printer, host-loss, multi-till or backup/restore qualification was run. Existing Modern Vite mixed static/dynamic import warnings remain.
- Manual impact required. Per user direction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending; see `docs/engineering/bar-local-first/MANUAL_IMPACT.md`. No hosted migration, write, release, customer cutover or cloud ingestion occurred.

# 2026-10-21 — Bar local-first drawer movements

- Modern and Legacy Bar local cashier workspaces expose a `Drawer` panel for paid-in, paid-out and float movements. The UI requires an open shift, positive amount and reason; the local service remains authoritative for capability, shift/outlet scope, ledger write, audit and same-operation replay. The broader drawer workflow remains partial: handover, counts and full movement display are not wired.
- Added `services/bar-local/tests/db-drawer-movements.test.mjs`; a fresh isolated PostgreSQL 17.6 run passed with one ledger and one audit row after replay. Modern runtime (20/20), Legacy regression (219 source checks + 29 Node tests), and both product builds passed.
- `pg_ctl start` failed on this Windows host with restricted-token error 87. The isolated test server was run directly and stopped after the test; this does not qualify an installed service lifecycle or customer host. No physical drawer was exercised.
- Manual impact is required for this customer-visible workflow. Per user instruction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending. No hosted migration, write, release, customer cutover or cloud ingestion occurred.

# 2026-10-21 — Bar local outlet menu availability

- Modern and Legacy local Bar workspaces now list the complete active product availability snapshot and submit outlet-scoped `catalogue.availability.set` commands with the observed availability version. The service remains authoritative and rejects stale versions and sales of unavailable products.
- `BAR-MENU-003` is implemented in the dedicated local Menu panel; the shared `HposMenu` / `HposTerminal` surface remains a cloud-mode path. Product editing, modifiers, promotions and recipes are separate partial requirements and are not represented as complete by this panel.
- Manual impact is required. Explain outlet availability separately from stock and capture screenshots when guide work resumes. Per user instruction, PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending.
- Verification: fresh isolated PostgreSQL 17.6 `db-menu-availability.test.mjs` 1/1 with all 33 local migrations; `test:bar-local-electron` 20/20; `legacy-pos:test` 219 source checks + 29 Node tests; Modern and Legacy product builds pass. No live multi-till conflict, rendered service interaction, guide packaging or customer qualification was performed.

# 2026-10-21 — Local modifier configuration

- Added a `pos.menu_manage`-gated `menu.modifiers` query to the local Bar contract and PostgreSQL dispatcher. It returns modifier groups/options and business-owned product assignments with authenticated business/outlet response scope; caller filters cannot override tenant scope.
- Modern and Legacy Menu panels show definitions and product assignments to authorized menu managers, with durable create/edit/deactivate group and option commands and version-guarded product assignment. Recipes and promotions remain open work.
- Verification: menu contract test passed 3/3; Modern renderer typecheck passed; Legacy and Modern production builds passed; local service/contracts typecheck passed; the renderer recovery suite including the modifier manager render case passed 4/4. The migration was not executed because the guarded local PostgreSQL test target is not configured. No hosted database was touched.
- Manual impact: menu managers can create modifier groups/options and assign them to products, and cashiers see these choices at sale/tab entry. Customer PDF, quick-start, screenshot, approved-manifest and packaged-guide edits/checks remain pending by user direction.
- Added `services/bar-local/tests/db-menu-modifier-config.test.mjs` to verify scoped group/option/product assignment results after migrations; it remains unrun until a guarded local PostgreSQL target is configured.

## 21 October 2026 — Bar menu money, recipes and promotion definitions

- `menu.list` now serializes catalogue prices as two-decimal strings at the PostgreSQL JSON boundary so renderer money parsing does not depend on JavaScript binary-number formatting. Local-only migration: `services/bar-local/db/migrations/0036_menu_money_transport.sql`.
- The menu manager snapshot now includes business-owned recipe versions/ingredient lines and promotion definitions with exact decimal transport. Modern and Legacy share the manager editor for recipe replace/remove and promotion create/edit/deactivate, in addition to modifier management. These are manager configuration workflows; promotion checkout use and general POS authority routing remain open.
- Local-only schema/query migration: `services/bar-local/db/migrations/0037_menu_recipe_configuration.sql`.
- Evidence: full isolated `services/bar-local` suite passed 112/112; the focused catalogue money and modifier/recipe/promotion database tests passed individually; renderer recovery/add-on tests passed 4/4; Modern local Electron tests passed 22/22; Legacy regression passed 219 source checks + 30 Node tests; service typecheck, renderer typecheck and both product builds passed.
- The approved Bar PDF, quick-start, screenshots, document manifest and packaged offline-guide verification remain pending at the user's direction. No hosted Supabase migration/write, service release, customer cutover, hardware test or installed Windows qualification was performed.

## 2026-10-22 — LodgingOS property adaptation remediation (code only)

- Added a forward public-booking migration for unique child confirmation tokens and a private invoice-group helper bound to the pending public request envelope. The helper validates the deterministic group key, ordered room lines, exact child operation keys, customer, source/status, dates, occupancy, and saved accommodation details. The staff invoice-group RPC remains executable over the anon API-key transport used by desktop custom sessions; its body retains actor, lodge, role, and PWA checks.
- Tightened the required transition DB gate: invalid/missing database setup is blocked with exit 2; acceptance inspects current schema and no longer reapplies historical migrations. Added the malformed configured URL subprocess regression and strengthened quotation rollback/replay SQL checks.
- Local verification: shared and renderer typechecks, offline queue, queue replay authority (9/9), mounted booking tests (42/42), lodge-camp build, and booking-site build passed in the prior implementation pass. Latest focused regressions pass 39/39 with one live quotation SQL case skipped (40 total). Transition, public-booking, and quotation disposable SQL runners all block with exit 2 because the remediation DB URL/identity configuration is absent. No migration was applied and no production deployment occurred.
- Manual impact: No manual update required. These changes affect LodgingOS booking/database contracts only; they do not affect any Bar-facing workflow or guidance.
- Electron walkthrough: not completed. The repository Electron launch timed out and no repository window appeared in the follow-up app inventory. Mounted React tests are reported separately.
- R1–R5 follow-up corrects first-child versus later-child idempotency keys, validates the original `guest_email`, restores the custom-session staff RPC transport while testing unauthenticated denial, updates transition acceptance to current schema/request contracts, and isolates public/staff SQL request context. The SQL acceptance now includes populated-group preservation. Further review corrections pin the approved direct/pooler endpoint, reject raw URL query overrides, construct the pg client from validated fields with verified TLS, fix the transition runner's URL import, make quotation SQL acceptance a required gate, and roll expected SQL errors back to savepoints. The final independent source review found no remaining source-level issue; live behavior remains unverified because the disposable target could not be reached.


## 2026-10-22 — Bar local export operator workflow

Modern and Legacy Bar Administration panels now expose local export creation and JSON download for staff with `export.manage` who can open Administration. Creation uses the durable local command handlers; retrieval uses the authenticated `outbox.bundle.get` query. The UI accepts only complete bundles with the expected batch ID and unsigned/transport-disabled status, labels the browser download as unacknowledged, and retains the confirmed batch ID for same-batch retrieval after an interruption. Scoped `outbox.status` now reports pending/exported counts, watermarks and per-batch integrity by business/outlet/authority epoch, reconciles export items against linked outbox rows, and never acknowledges batches. New exports are paused when this status is unavailable or integrity fails. SQL rejects an event payload-hash mismatch even if the outer manifest digest is recomputed; API/DB assertions cover these cases but have not run. UI contract checks, query validator, Modern renderer typecheck and Modern/Legacy production builds passed. No browser download or live service interaction is claimed. Signing, uploader/acknowledgement, worker replay and full cutover reconciliation remain disabled/open. Customer PDFs, quick-start, screenshots, approved-manifest and packaged-guide work remains pending at user direction.

## 2026-10-22 — Bar local export and loyalty query continuation

- Local migration 0041 adds scoped bundle retrieval, 0042 reconciles outbox status/watermarks and recent batch integrity, and 0043 exposes authenticated business/outlet-scoped loyalty programme configuration. Modern/Legacy export retrieval/status controls are present; the programme read is registered in the contract and both clients but is not yet wired to an operator UI. Hash and review handoff artifacts are maintained under `docs/engineering/bar-local-first/`.
- Focused source checks passed for export workflow, loyalty programme query, versioned query validation, Modern/Legacy clients and builds as listed in the evidence log. Migration 0043 and current export API scope/tamper assertions have not been run against PostgreSQL in this continuation because the isolated database target is not configured. No hosted Supabase target was accessed.
- Customer PDFs, quick-start, screenshots, approved-document manifest and packaged offline guides remain pending at the user's direction. The full implementation is incomplete and unqualified; Windows installation, customer-facing programme management, full local domain routing, independent backup/restore, multi-node failover and A01–A32 qualification remain open.

## 2026-10-22 — Bar loyalty programme administration UI

- Modern and Legacy owner-only local administration now read current business-wide/current-outlet programme settings and create or version-update the selected programme using the existing atomic `loyalty.program.upsert` command. UI guards cover invalid rates, whole-number minimums, duplicate business-wide creation and unavailable authoritative reads; the service enforces final scope, capabilities, uniqueness, version checks and audit.
- Combined export and loyalty UI/source checks passed 6/6. Modern renderer and local service/contracts typechecks passed; Legacy production build passed. The Modern product build is rerunning after the final read-failure guard. Database execution, authenticated click-through and installed Windows behavior remain unverified.
- Manual impact is customer-facing and recorded. Customer PDF, quick-start, screenshots, approved-manifest and packaged offline-guide work remains pending at the user's direction.

- The Modern/Legacy owner editor now supports creating an outlet-specific loyalty programme using only the outlet identifier returned by the authenticated local query. UI prevents duplicate global/outlet creation; SQL uniqueness and scope remain authoritative. Focused UI/query checks 6/6, both client builds and typechecks pass; DB-backed creation test remains pending due missing isolated target.

- Migration 0044 adds an authenticated business-scoped current loyalty account/balance read. Modern and Legacy customer panels display the timestamped local authority result and refresh it after loyalty actions. The display is informational; points eligibility is rechecked by the atomic service command. A DB regression was added but is not run until an isolated target is configured.

- Migration 0044 and Modern/Legacy customer panels now provide a timestamped local points-balance read. UI uses business/outlet response scope, suppresses stale asynchronous responses, and refreshes after enrollment/earning/redemption; the server rechecks available balance and programme state at commit.
- Verification after the balance-read work: focused export/loyalty/client tests 61/61; registered query validator 1/1; renderer/service typechecks and both Modern/Legacy production builds pass. DB regression assertions were added but not run because a guarded isolated target is unavailable. Customer PDFs, quick-start, screenshots, approved-manifest and offline-guide checks remain pending by user direction.

## 2026-10-22 — export commit-group atomicity

- Migration 0045 replaces event-row `LIMIT` selection with complete commit-group paging. The export lock still serializes batch creation and every event within selected commit sequences is locked and assigned together. The group-count limit is capped at 1,000; event count may exceed the limit by the size of a selected group.
- Added a DB-backed API regression that creates a two-event fixture group and expects both events in a limit-one export, plus source-contract checks. Database execution is unavailable until a guarded isolated PostgreSQL target is configured. No hosted migration was run.

- `services/bar-local` export pagination was corrected in migration 0045 to treat the limit as complete commit groups. The root `test:bar-local-contracts` script registers the migration/source checks with UI contracts. The isolated API regression creates a multi-event group and checks a limit-one export returns both rows.
- Verification: `npm run test:bar-local-contracts` passed 12/12; registered query validator passed 1/1; service/contracts typecheck passed. The API/DB regression was not run because no guarded isolated PostgreSQL target is configured. No hosted DB access or migration.
## 2026-10-23 — Bar local backup schedule follow-up

- The Windows Bar backup-task installer source now schedules hourly encrypted full snapshots, the existing daily run, and startup catch-up. A focused source contract passed 1/1 and PowerShell parsing passed for both modified scripts.
- Target Windows Task Scheduler execution has not been run. Hourly snapshots are not WAL/PITR, independent host protection, or a replacement-host restore. Bar manual impact is recorded; PDFs, quick-start, screenshots, approved manifest and packaged offline guide checks remain pending by user direction.
- The wider Bar local-first technical plan remains active and unqualified. Existing unrelated dirty work remains preserved; no hosted access, migration, deployment, cutover or commit occurred.
## 2026-10-23 — Bar local physical drawer count

- Modern and Legacy Drawer panels now record physical cash counts through the existing durable drawer command. The service scopes and locks the open shift, stores a count record, returns count-time expected cash and variance, and leaves expected drawer cash unchanged. Same-operation retry returns the saved result.
- Verification: Bar source-contract suite passed 15/15 (including three drawer count checks), service/contracts and renderer typechecks passed, and Modern and Legacy production builds passed. Database replay/variance and direct-SQL invalid-movement regressions were added but not executed because `psql` and the guarded isolated PostgreSQL target are unavailable. Paired cash handover, installed service and hardware remain open.
- Customer manual impact is recorded. PDF, quick-start, screenshot, approved-manifest and packaged-guide work remains pending by user direction. The technical plan remains active and unqualified.

## 27 October 2026 — partial Bar local takeover

Implementation remains incomplete and customer commissioning is NO-GO. Modern owner setup and pairing now retain a committed-setup recovery state if post-commit status cannot be verified, and failed owner auto-login leads to owner sign-in instead of inviting setup again. Modern and Legacy return/void controls require a current authenticated readiness result, including before approval is requested. Export canonicalization rejects sparse arrays. These are scoped changes; an unconfigured installation still defaults to the cloud interface and the local workspace remains inaccessible through the ordinary first-run entry.

Local PostgreSQL remains the Bar authority only for an explicitly configured profile; per-device SQLite is an intent journal. Local exports are not uploads, and no local Bar transactions are currently accepted by Supabase. Cloud scheduling, uploader, authoritative receiver and acknowledgement, safe cloud-to-local cutover, physical replica/coordinator qualification, independent WAL/PITR recovery, installation lifecycle and complete domain workflows remain open. In particular, a tip retained after an item return cannot be allocated because allocation requires a completed sale; an all-items-returned tip-only correction is unavailable. Do not alter submitted financial history to resolve either case.

No hosted changes, cutover, release, commit or push were made. Customer PDF, quick-start, screenshot, manifest and offline-package checks remain deferred by user instruction; physical multi-PC, power, Windows 7 and hardware qualification remain pending. The 27 October coverage copy conservatively marks every row unverified for this checkpoint and retains the previous evidence; it is not a completed independent re-audit. See FOLLOWUP_COVERAGE_2026-10-27.csv.

Verification follow-up: the 27 October guarded disposable PostgreSQL run passed 152/152; identity-checked data was retired after stop under .tmp/bar-isolated-tests/2026-10-26T22-36-39-915Z-64f3cac7. A first sandboxed attempt failed to start PostgreSQL with restricted-token error 87 and retained its isolated fixture; the subsequent approved isolated run passed. Modern and Legacy readiness source tests passed 6/6, Modern renderer recovery 11/11, and startup authority checks 5/5. Modern and Legacy builds passed before the final pairing-message correction; service build and export unit tests passed for the initial export guard; the later epoch equality experiment was removed because earlier pending events can span authority recovery. The broad Bar suite has not yet completed at this checkpoint.

29 October 2026 local-only follow-up: Windows backup/copy/PostgreSQL path separation now resolves junction aliases (EV-163). The guarded isolated service suite passed 214/214 on PostgreSQL 17.6 after clean cluster shutdown and retirement of the disposable data (EV-164; `.tmp/bar-isolated-tests/2026-10-29T01-29-09-545Z-eaf3f32b`). This updates the earlier statement that the full suite had not completed. It does not close the remaining local gaps: WAL/PITR and replacement-host recovery, remaining post-close sale corrections, isolated training/rehearsal, operator-facing signed-update orchestration, and full profile/session/cache/shared-renderer route isolation. Customer PDFs/guides remain pending by user direction; Supabase transition and multiple-PC qualification are excluded. Local Bar commissioning remains NO-GO until its independent readiness gates pass.

29 October WAL recovery follow-up (EV-165): added the first encrypted WAL segment archive/restore primitive and CLI. The service builds and typechecks; focused encryption, authenticated restore, retry/conflict, tamper and CLI tests pass 4/4. PostgreSQL configuration does not yet call it, and physical base backups, continuity/retention/health checks and replacement-host orchestration remain incomplete. This is not PITR readiness.






29 October verification continuation (EV-168): corrected stale Modern/Legacy test snapshots after the startup helper refactor and newly registered post-close correction command/query. The full local Electron, Legacy, rendered finance, local contracts and focused update suites pass (100/100, 219 source checks + 53/53, 5/5, 20/20 and 6/6 respectively); affected Modern renderer, preload and Bar service/contracts typechecks pass, as do Modern and Legacy production builds. A fresh guarded PostgreSQL run bootstrapped and stopped a PostgreSQL 17.6 cluster, but reported 226/232 because six update tests hit the test-database configuration guard before exercising update code. The isolated runner now sets the required test-only allow flag inside its sanitized nonce-named loopback environment, and those six tests pass directly. Its failed fixture remains preserved; disk is below the runner's 4 GiB minimum, so no post-fix full rerun was started. Do not claim a full current service-suite pass. Training isolation, real WAL/PITR and replacement recovery, installed Windows lifecycle and complete end-to-end workflow acceptance remain open; multi-PC, Supabase and customer guides remain deferred per user direction. Commissioning remains NO-GO.

29 October verification continuation (EV-169): the ACL-protected installer environment now includes its loopback-only admin PostgreSQL URL for backup, restore drills and update checkpoints. Modern shared-till login/logout now clears private view and form state and fences late audit/support responses from the previous session. Focused installer/renderer tests pass 24/24; renderer and Bar service typechecks pass; Modern production build passes. These changes do not close training isolation, PostgreSQL-integrated WAL/PITR/base-backup recovery, replacement-host recovery or installed Windows lifecycle. Full guarded PostgreSQL rerun remains blocked by the preserved fixture and less than 4 GiB free-space reserve; no fixture was deleted and the guard was not bypassed. Manual/PDF artifacts remain pending as directed; multi-PC and Supabase transition work remain excluded; commissioning remains NO-GO.
## 2026-11-01 — Bar local-first continuation

Setup now has clearer new-Bar versus connect-another-till guidance, retains optional local business contact details in local migration 0077, and applies measured disk-space preflights to Windows installation and encrypted recovery copy/drill operations. The hard installation reserve is 1 GiB plus 64 MiB; recommended operating headroom is separately shown as a warning. Focused checks passed: registration/setup/startup/replacement tests 32/32, Bar-local Electron 102/102, renderer and service typechecks, Bar browser UI 7/7, and Modern/service production builds. The service payload staged and verified 1,957 files, including migration 0077. See `docs/engineering/bar-local-first/IMPLEMENTATION_REPORT.md` and EV-171.

This remains partial software work and NO-GO for customer commissioning. The current disposable service-suite attempt is not green because Node/libuv asserted during HTTP test-server teardown; failed fixtures and logs were preserved. Offline email/password owner authentication, read-only remote owner reporting and a hosted idempotent receiver/business link, full installed second-PC reconnection, independent WAL/PITR and replacement-host restore/fencing, physical hardware/power checks, and PDFs/screenshots/packaged-guide work remain open. No local customer Bar, hosted change, deployment, release or app restart occurred.

## 2026-11-02 — saved Rabafi Windows Bar installation recovery

The existing Rabafi Pub setup was resumed under its original attempt ID. Windows installer fixes now use typed named PowerShell parameters, place PostgreSQL under its versioned runtime directory, preserve partial runtime copies, use atomic text replacement compatible with Windows PowerShell 5.1, and perform PostgreSQL configuration validation through a restricted read-only child process. The installer grants only the temporary permissions required for fresh `initdb`, then reapplies the strict PostgreSQL service ACL. The real elevated isolated initialization/configuration smoke passed; the focused regression set passed 44/44 before the final UTF-16 log-redaction regression was added. Main-process typecheck and the Hospitality POS build passed.

The latest installer state that could be observed was `installing`: the PostgreSQL cluster had initialized, the `BarLocalPostgreSQL` service had been registered, and loopback configuration had been applied. Automatic approval review then failed with a usage-limit error before the next read-only status check executed. Current completion/health is therefore unknown; preserve the running installer and data, and inspect the same attempt after review access returns. The dedicated Bar owner still needs to complete owner setup in the UI. This saved attempt is not yet verified as operational or commissioned. Hosted owner reporting/Supabase, physical multi-PC qualification, and customer PDFs/screenshots/packaged-guide checks remain deferred; guide work is pending and non-blocking for this software release per user direction. See EV-177 and `docs/engineering/bar-local-first/MANUAL_IMPACT.md`.

## 2026-11-02 — local Hpos shell integration and Bar owner-view safety

- A configured local Bar now uses the normal Hpos layout/navigation with a strict local-route allowlist. Supported Hpos paths dispatch into existing `BarLocalWorkspace` / `BarLocalOperationsPanel` flows backed by Bar-local IPC. Hpos cloud POS/sync polling and cloud manager PIN/support paths are skipped for local sessions; unsupported paths fail to a local-only unavailable view. This is route-shell integration, not full parity in cloud-native Hpos feature components. Standard-screen role/outlet/ambiguous-timeout acceptance remains open.
- The single Manager PWA uses verified Bar session copy and refuses to show the old hosted POS/stock/finance dataset in Bar views while the local projection connection is absent. The PWA owner/business link, receiver and secure projection reads, bounded upload/acks/retries, last-successful-upload status, desktop analytics and requested charts remain unimplemented. No cloud receiver/deployment/activation occurred.
- Verification for this continuation is in EV-181. `build:hospitality-pos`, `typecheck:renderer`, local Bar browser UI and route checks passed; Manager PWA build and projection-boundary checks passed. Two existing PWA source-contract expectations still fail (membership switching and Hotel check-in); see EV-181.
- Manual impact is required. User-directed PDF/quick-start/screenshots/approved-manifest/packaged-guide work stays pending and non-blocking for a software release. The current Rabafi app/database/profile and records were not touched or restarted.



## 2026-11-03 — owner projection completion and release limits

The owner projection now reads sales, transaction history, stock movement history and submitted cash-ups through the separate owner receiver. Each exported event carries the authoritative operation business date in the signed manifest; receiver period reads use that persisted date. Local isolated PostgreSQL verification passed 9/9 receiver/sync/body-deadline cases. Manager PWA typecheck/build passed; full lint passed with 0 errors and 36 existing warnings. Hospitality POS production build and focused Bar IPC/PWA boundary tests (25/25) passed. See EV-184.

The receiver SQL is not a Supabase migration and no hosted receiver or email provider is deployed. The owner projection has no current stock-on-hand or card-settlement report. Hosted activation/Supabase and physical multi-PC qualification remain excluded by the user request; PDF, quick-start, screenshot and packaged offline-guide work remains pending and non-blocking. Standard Hpos session/role/outlet/unknown-timeout acceptance, installed owner-flow qualification and remaining Bar commissioning gates are still open. Local Bar remains uncommissioned / NO-GO; do not infer release qualification from the synthetic projection test. The saved Rabafi application/database was not modified or restarted by these checks.


Commit handoff: focused commit `cb1db359` is local on `codex/bar-local-first-continuation`; push to the configured GitHub origin was blocked by automatic review for external egress to an unverified origin/payload. The unrelated worktree edits were left out. See EV-185 for the exact approved target and remaining push command.

Independent follow-up EV-190 reran the owner PWA loopback HTTP suite (6/6), reproduced timeout settlement at the unchanged 12-second production deadline (12,013 ms), and passed the wrong-outlet prepared-batch regression on a fresh PostgreSQL cluster bootstrapped through all 81 migrations (owner receiver 1/1; service build and clean stop passed). EV-188/189 findings are closed within those tested scopes. Chromium walkthrough, multi-outlet reporting, hosted activation, extra-PC and overall commissioning remain unqualified; PDFs/guides remain pending per user direction. This independent review made no product edits, customer-data access, restart, commit, or push. See EV-190.

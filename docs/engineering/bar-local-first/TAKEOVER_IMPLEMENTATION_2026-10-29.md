# Implementation takeover — 29 October 2026

This is the active implementation checkpoint, not a release or completion claim. The user authorized finishing the six remaining local software workflows. Extra-PC/Windows7/peripheral/power qualification and customer PDF/quick-start/screenshot/manifest edits remain deferred. Hosted writes, live cutover, release and commit/push remain outside scope.

## Changes made in this takeover

- Added an isolated practice supervisor, Modern launch/setup/reset UI and IPC, separate protected credentials/profile/journal/database/service, sample catalogue and service-enforced training isolation. Added startup/environment isolation and owned process shutdown. A real native integration test passed setup, restart, login, sample catalogue, endpoint isolation and reset before the latest shutdown hardening; rerun the latest version before final qualification.
- Fixed automatic setup payload omission of PostgreSQL `lib/dict_snowball.dll`; staging now includes `lib`. Require `pg_verifybackup.exe` too. Fixed production resumption incorrectly interpreting the universally created empty `test_guard` table as a disposable test database; populated/malformed guards remain refused.
- Added encrypted native physical base backups with `pg_basebackup` and `pg_verifybackup`, authenticated per-file manifests, encrypted WAL/history support and installer archive configuration, isolated paused point-in-time drills, protected portable recovery keys, durable jobs with stable request identities, a daily base schedule and Modern recovery controls. Writable restore verification remains strict; snapshot-specific verification explicitly cannot qualify activation.
- Strengthened planned replacement: deny old runtime logins, terminate all runtime backends regardless of application name, persist SQL fence, verify physical system identity/database and final WAL catchup, promote then advance authority epoch/revoke old sessions, and allow runtime login only on the new copy. Added distinct local standby listener configuration.
- Added shared original-device + fresh owner PIN replacement proof, read-only service identity projection, protected Modern/Legacy reconnect methods/IPC and sign-in controls. Profiles preserve original credentials and operation journals; no new empty authority can pass replacement proof.
- Preserved existing post-close compensating correction contracts/UI and signed offline update workflow; verify those alongside the new work rather than attributing all their implementation to this takeover.

## Executed evidence so far

- `.tmp/takeover-training-integration.log`: real native practice integration PASS (1/1, before latest shutdown changes).
- Focused initial setup/practice/config/policy tests: 16/16 PASS.
- `.tmp/takeover-infrastructure-tests.log`: 28/28 PASS (signed update safeguards, replication controls, encrypted WAL, practice isolation; before replacement strengthening).
- `.tmp/takeover-focused-tests.log`: 32/32 PASS (setup, replacement controls, snapshot security, encrypted recovery keys, practice).
- `.tmp/takeover-client-proof-tests.log`: current Modern runtime + replacement proof PASS; inspect exact count in the log.
- `.tmp/takeover-replacement-tests.log`: 16/16 PASS before latest enrollment listener addition; rerun current source.
- `.tmp/takeover-physical-recovery.log`: original integrated run emitted 4 correction passes and 1 recovery failure. Keep that failure historical; do not label the original run green.
- Synthetic recovery fixture `.tmp/pr-ba1ea734`, owned by `fixture-owner.json`, source `.tmp/bar-isolated-tests/2026-10-29T14-31-38-508Z-347ab33a`. Native physical base `ae655110-550f-4ffb-9080-a84baec6c822` passed `pg_verifybackup` and encryption. Target `2026-10-29T14:37:15.936Z` was recovered in a new isolated copy with probe rows exactly `[1,2]`, excluding later row3. **73/73 snapshot checks PASS**, activation unqualified, copy stopped and data removed; `.tmp/takeover-retained-recovery.log` and fixture `retained-fixture-verification.json` retain the result. Logs stay retained. Source cluster stayed stopped.
- Renderer type check passed after Modern and shared replacement screen additions; repeat after further UI edits.

## Active work / immediate continuation

1. Real planned replacement test is running via `.tmp/takeover-planned-replacement.log` in an owned fresh disposable primary/physical replica. Inspect its exact fixture log. The test must verify sale preservation, old NOLOGIN fence, new epoch and real owner/device HTTP reconnection. Never stop unowned app instances.
2. Run recovery job tests and latest focused checks after service build. Recheck API scope/capability/loopback negative cases for new routes.
3. Finish remaining integration issues; test client durable-intent recovery across replacement epochs and preserve original operation IDs/envelopes.
4. Restage current service/runtime payload and rerun native practice integration after latest shutdown changes. Run affected Modern/Legacy builds/checks and signed update/closed-day correction regressions.
5. Recovery retention/copy/export/import/replacement preparation still needs final assessment against the full six-feature scope. Automatic recovery pruning currently intentionally disabled; owner UI must state that. Do not call all six complete from current evidence.

## Environment and cleanup

User explicitly authorized freeing disk. Removed 42 positively identified stopped disposable test data directories, retained logs and retirement records: 7.36GiB reclaimed. No live/client database or application was removed. Failed new fixtures remain retained. Latest observed C: free was about5.7GiB. Available physical memory was about385MiB/12GiB, so run heavy tests sequentially. Do not lower the4GiB isolated database safety guard or kill unrelated processes to make tests pass.

Manual impact: new owner recovery/practice/reconnect screens and setup/recovery guidance require later customer manual updates. Those artifact edits are explicitly deferred by the user; no customer readiness claim is made.

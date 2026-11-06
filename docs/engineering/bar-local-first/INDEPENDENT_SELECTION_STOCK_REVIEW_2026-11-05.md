# Incremental independent review — 5 November 2026

Scope: the posted saved-Bar selection, startup retry and original Stock continuation. This supplements the earlier full reviews; it does not repeat or supersede unchanged historical acceptance evidence. No product implementation, customer SQL, hosted changes, credential resets or release actions were performed by the reviewer.

## Findings and verdict

| Claim | Independent result | Practical limit |
|---|---|---|
| Saved Bar can be explicitly selected despite parent/child storage-key mismatch | PASS for executed regression; live handoff pending | `electronRuntime.js:134–149` permits an existing recovery entry to select the child without granting a session. Distinct authenticated storage-key tests execute the real runtime, retain protected bytes, and reject malformed child authority. These are key-boundary simulations, not Windows safeStorage or live login acceptance. |
| Startup retry bypasses cache without a reset or arbitrary URL | PASS for handler/script and browser tests | `startupRetry.js` accepts one fixed action and checks the existing allowed application URL; `index.js:3607` installs it in the navigation handler. Real Electron failure/retry acceptance remains pending. |
| Original Stock screen is wired to local operations | PARTIAL | `LocalBarHposShell.jsx:159` mounts HposStock; `HposStock.jsx:165` selects nativeStockApi in local mode. Actual rendered Stock count recovery and manager-approved waste passed using a mocked bridge. End-to-end Electron/preload/service execution remains unverified. |
| Six Menu/Stock database tests passed | Retained author execution evidence inspected; not independently rerun | Retained results identify a fresh nonce cluster, the Windows error-87 direct-start fallback, successful bootstrap/build/tests and clean stop. The six test log entries and identity.json were inspected. Source assertions and author logs alone do not establish independent SQL acceptance. No reviewer DB run was started while prioritizing the user's live login issue. |
| Original Till is finished | FAIL / explicitly unfinished | `LocalBarHposShell.jsx:157` still mounts BarLocalWorkspace for the counter. Other operational routes also continue using replacement panels. Native Stock completion does not complete the all-original-screen requirement. |

Independent reruns:

1. `node --test --test-concurrency=1 tests/bar-local/chooser-storage-context.test.mjs tests/bar-local/workspace-selection.test.mjs tests/bar-local/startup-retry.test.mjs services/bar-local/tests/native-hpos-stock-adapter.test.mjs services/bar-local/tests/native-hpos-menu-adapter.test.mjs` — **19/19**, exit 0.
2. `node --test --test-force-exit --test-concurrency=1 services/bar-local/tests/mixed-profile-login-rendered.test.mjs services/bar-local/tests/native-hpos-stock-rendered-smoke.test.mjs` — **2/2**, exit 0. Mocked bridges; no customer database or real authentication.
3. `node --test --test-force-exit --test-concurrency=1 tests/bar-local/startup-browser.test.mjs` with BAR_LOCAL_CHROMIUM_EXECUTABLE_PATH set to an already-installed headless Chromium — **3/3**, exit 0. No download. An initial combined invocation failed the startup cases without this explicit browser selection and retained open test fixtures; that owned test invocation was stopped. Its two rendered successes were rerun separately to clean completion. The configured rerun supersedes that environmental failure, not a product defect.

The author's main/renderer typecheck claims were not independently repeated in this checkpoint. The authorized development rebuild did pass main and preload compilation; a build is not login or financial acceptance.

## Coordinated live restart

The user's screenshot showed the Restaurant login and Restaurant profile ID, with a wrong-password message. Terminal evidence confirmed cloud Restaurant auth and the old main process's continued SETUP_RECOVERY_REQUIRED response; it did not show a local Bar password rejection.

The user explicitly approved an idle-app restart. Stopped the owned development execution session 15297, verified the remaining repository Electron processes had exited, and restarted `npm.cmd run dev:restaurant-bar`. A graceful-close attempt against the earlier observed PID refused after that process had already disappeared; no other process was closed. No Windows service or database was stopped.

New execution session **37386** rebuilt main/preload, launched the app, reported renderer-module-ready, first React commit and completed authority check, restored the existing Restaurant session, and reached `#/choose-lodge`. The reviewer instructed the user to choose the saved Bar card's **Open Bar** action rather than the Restaurant or New Business entry. Existing records were not reset. Ordinary application startup ran its own configured cache/backup work.

Live Rabafi child selection, local credential authentication and original Stock behavior remain pending user interaction. Do not infer a successful Bar login from the source fix, browser mock, normal startup or preserved Restaurant session. No live schema migration was authorized or performed. Commissioning remains **NO-GO**.

Manual impact: this review changes no product workflow; internal evidence only. Implementation manual impact is tracked in the author's Stock/startup records. Customer PDFs, screenshots, manifest/packaged-guide changes and physical equipment/multi-PC qualification remain deferred by user direction.

## Follow-up: correct local login opened directly

After the restart, the user again reported an incorrect-password message. The last available session 37386 log still showed `auth:login` for the Restaurant, not a Bar service authentication. On the user's subsequent “go on”, that execution session was no longer available. Read-only process/port inventory found no running repository Electron/development server; the parent's saved workspace choice remained `cloud`.

Used the existing dedicated-workspace CLI option, without changing product source or saved selection records, to launch the already configured Bar:

```powershell
$env:BOROKO_PRODUCT = 'hospitality-pos'
node ./node_modules/electron-vite/bin/electron-vite.js dev -- --bar-local-workspace
```

The installed electron-vite CLI source was checked to confirm forwarding of arguments after `--`. This is a development launch workaround for reaching the existing child, not acceptance of the chooser UI or a permanent change to the parent's default business choice.

Execution session **40002** passed main/preload compilation, reported `[BOOT] bar_local authority: cloud startup disabled`, then renderer-module-ready, first React commit, completed authority check and window-ready-to-show. It remains running for the user's local owner sign-in. No reviewer authentication attempt or password handling occurred; credential acceptance is still pending. No database/service restart, reinstall, customer SQL or setup reset occurred. Do not describe the earlier Restaurant wrong-password response as a rejected local Bar password.

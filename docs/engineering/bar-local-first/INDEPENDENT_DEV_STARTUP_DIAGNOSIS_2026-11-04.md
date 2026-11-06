# Development startup failure — independent diagnosis, 4 November 2026

User screenshot: startup fallback persists with “The screen is taking longer than expected.” Terminal attachment `b61cc847-9985-4b14-823f-27904ce1532a/Pasted text.txt` was read as evidence, not instructions.

## Observed evidence

- User ran `npm run dev:restaurant-bar`. Main/preload builds succeeded and Vite served localhost:5173.
- Electron reported html-ready, Chromium disk-cache `Failing CreateMapBlock`, failure to create the cache entry for `/src/main.jsx`, critical cache error -8 and failure to save cache user data. Repeated module-load-failed preceded the 15-second React-mount watchdog. No renderer-module-ready appeared in the supplied log.
- Independent GET requests for `/src/main.jsx` and `/src/App.jsx` returned HTTP 200.
- An installed headless Chromium with a fresh disposable browser context, mocked IPC and blocked external network loaded the same initial module graph without page errors, failed requests or failed responses. It reached renderer-module-ready at 3,285 ms and react-first-commit at 3,545 ms. It ended on the expected Desktop App Required fixture screen, not an actual business login. This checks module loading/React startup only, not native Bar operation.
- Reproducible isolated diagnostic: `node docs/engineering/bar-local-first/evidence/independent-2026-11-04/dev-startup-probe.mjs`. No user profile, real Electron bridge, customer database or external service was used.
- C: had 370,335,744 bytes free (about 353 MiB). This is critically constrained for development/runtime cache and unsafe for database acceptance. No further builds/DB tests were started.
- The affected development profile's Chromium `Cache` folder is approximately 4.6 MB, eight files. Browser cache recovery alone will not solve the overall disk-capacity problem.

## Assessment and safe next action

The evidence strongly suggests an affected Electron Chromium cache/profile problem, with very low disk space a possible contributor. This remains an inference until the affected app is repaired and startup succeeds. The static build/development server is currently able to supply the initial modules to a clean browser. The log's separate cloud draft-lodge access denial happens after the initial module failure; it is not established as the cause of the pre-React startup failure or proof that local Bar fell back to cloud.

User was asked to close the app and stop its development terminal before any profile cache repair. Known Electron processes were still present at the initial check. No process was killed, application restarted, cache renamed/deleted, setup reset or database changed. Any subsequent repair must be restricted to the exact stopped development profile's regenerable Chromium cache, with reversible retention; never remove whole userData, sessions, authority credentials, journals or databases.

Luna received the diagnostic and explicit boundaries. Software follow-up: narrow main-owned startup retry that bypasses browser cache, actionable redacted module errors and a watchdog that does not replace a specific module failure with a generic timeout. Fresh-browser startup evidence is not installed-profile acceptance.

## Recovery after user stopped the app and freed space

User confirmed stopping the terminal process and freeing disk space. Independent process inventory found no Electron processes; C: had 5,426,806,784 bytes free (about 5.05 GiB). After checking the exact profile/cache path, rejecting reparse-point redirection and checking Electron was still stopped, renamed only `C:\Users\Botswapelo Studios\AppData\Roaming\Tsa Bonno Restaurant & Bar POS Dev Desk\Cache` to sibling `Cache.recovery-c0d58714`. The prior cache is retained reversibly. No credential/session/authority/journal/database files or entire profile directories were removed or reset.

Restarted the user-requested `npm.cmd run dev:restaurant-bar` for startup verification. This is ordinary application startup, not a disposable database test or migration. Startup verification result follows when its renderer loads.

The restart's main/preload builds passed. No Chromium cache errors or module-load-failed events appeared in the observed startup. The 15-second fallback watchdog still fired, but the renderer subsequently reported module-ready at process uptime 31,789 ms, first React commit at 31,951 ms, and authority-check-complete at 32,022 ms; initial HTML was ready at 10,657 ms. Thus cold development module loading took approximately 21.3 seconds after HTML and exceeded the current warning threshold. Navigation then reached `#/setup` for the selected profile. Ordinary application startup performed its existing automatic backup/cache work; no reviewer SQL, credential reset, business creation or reinstall was performed.

Application is left running (development execution session 15297). Asked the user to confirm the window is visible and past startup; actual user-visible acceptance is pending that confirmation. Logs establish recovery beyond the former pre-React module failure, not completed login/trading acceptance. Remaining free-space reading was 5,331,148,800 bytes (about 4.97 GiB).

## User-visible startup accepted; Bar selection blocked

The user confirmed the app is visible, Restaurant login works, and Bar login still fails. The observed failed email attempt used cloud `auth:login` with the existing `New Business` draft profile `07a6584c-91df-4c36-bdac-e0b396073660`; the cloud response was `account_not_found`. A subsequent Restaurant login succeeded. This is not evidence that the local Bar service rejected the owner's password: no local Bar authentication was observed in that attempt.

A later attempt in the same running parent app reached `barLocal:selectLocalBarWorkspace` and failed with `SETUP_RECOVERY_REQUIRED`. This is direct runtime evidence of the chooser blocker, independent of the earlier cloud login.

The metadata-only diagnostic `evidence/independent-2026-11-04/run-chooser-status-readonly.mjs --use-saved-bar-key-context` ran under the saved child `local-bar-workspace` Electron userData context and exited 0. Its public output was:

```json
{"entry":{"status":"ready","label":"Rabafi Pub","origin_profile_id":null},"encryption_available":true}
{"kind":"authority","readable":true,"authority_mode":"bar_local","valid":true}
{"kind":"setup","readable":true,"version":1,"phase":"complete","has_owner_object":true}
```

The diagnostic decrypted records only in memory and emitted selected public validation fields; it did not emit credentials, PINs, passwords, tokens, configuration contents or encryption keys. It imported the chooser and authority validators only, did not import application database/bootstrap code, connect to a database, call the service, attempt authentication or change business records. It requested the child profile's single-instance lock, created no window and terminated cleanly. Electron itself may initialize normal profile metadata; this should not be described as a guarantee of zero filesystem writes.

An earlier fresh temporary-profile diagnostic could not decrypt those same child records and returned `recovery`. That isolated result was explicitly corrected in user commentary: it was not proof of record damage because it used a different key context. The valid child-context result and the actual parent application's recovery refusal are now the relevant comparison.

Source trace: `chooserEntry.js` lines 18–25 decrypts protected records using the supplied `safeStorage`; lines 35–38 point at the dedicated child workspace. `electronRuntime.js` lines 455–457 supplies the current parent's `safeStorage`. `index.js` lines 388–440 chooses distinct parent and child userData roots before startup. Together with the executed results, these establish a cross-profile protected-record discovery mismatch. The saved authority validates in its own profile; this does not verify service readiness, credentials, a successful login or trading.

Sent Luna the confirmed blocker and requested correct-context discovery/selection, preservation of records and credential protection, validation of protected authority inside the selected child, and regression coverage with genuinely distinct storage contexts. No product code was changed by this review. The running app was not restarted for this diagnosis. Authenticated Bar login acceptance remains **FAIL/BLOCKED**, and overall commissioning remains **NO-GO**. This is diagnostic evidence only; no customer workflow change or manual update was made by the reviewer.

# Startup retry follow-up — 4 November 2026

The reported Electron launch failed before React mounted, with Chromium disk-cache errors. A separate fresh browser loaded the module graph; profile/cache damage is a hypothesis, not a confirmed repaired cause. The existing running app/profile was not modified in this change.

The HTML fallback now requests the exact `hospitality-startup://retry/` action in Electron. Main intercepts it, checks that the current page is an allowed application page, and calls `reloadIgnoringCache()` on that same webContents. No renderer-provided URL, storage deletion, session reset, process restart or database action is accepted. Browser-only fallback retains normal reload.

Module-load failure text remains visible after the startup watchdog. Logged module sources omit query strings and fragments. Stalled loads retain product-neutral recovery copy.

The watchdog now waits 45 seconds: independently observed cold development loading took 21.3 seconds after HTML paint, so the previous 15-second timer reported a stall during a successful load. Explicit module failures still surface immediately.

Verification: `node --test tests/bar-local/startup-retry.test.mjs` passed 3/3 (fixed action and allowed-page boundary, failure/watchdog precedence and redacted source, stalled renderer). These are isolated handler/script tests, not an actual Electron cache-repair acceptance. No disk-heavy build or database test was attempted because the workstation reserve is unavailable.

Subsequent real Chromium fallback checks passed 3/3 for delayed initial paint, module failure preserving its message after the watchdog and retrying the same page, and stalled-load recovery. The Electron handler itself is covered by the isolated boundary test; Chromium does not establish Electron cache-bypass acceptance. The reviewer separately repaired only regenerable cache and observed React mount in the existing development app; that running app was not restarted by this work.

Manual impact: startup Try again now bypasses cache while preserving saved data. Customer PDF/screenshot/packaging updates remain pending and non-blocking by explicit user direction. Actual affected Electron launch and cache-bypass recovery remain pending; no claim of a repaired workstation or completed release.

Native Stock source and rendered adapter checks have progressed; original Till adapter is still under development and is not routed into the application. SQL migrations 0082/0083 still require the guarded disposable PostgreSQL run. Do not apply them to Rabafi or bypass the disk reserve.

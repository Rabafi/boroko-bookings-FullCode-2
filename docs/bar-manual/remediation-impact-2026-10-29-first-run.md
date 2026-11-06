# Cloud Bar first-run remediation — 29 October 2026

Manual update required: empty catalogue guidance, manager PIN creation recovery and business-scoped App Issues history. Manuscript and quick-start source updated in this change.

Affected screenshots: new empty Till, Manage PIN dialog, App Issues empty/history state. Screenshot recapture, PDF regeneration, visual QA, approved manifest/checksums and installed packaged offline Open/Save checks remain pending. This is a development fix, not release completion or customer commissioning evidence. Approved binaries and manifest are intentionally not marked updated.

No cloud/local conversion, hosted migration, business data repair, PIN assignment or deployment was performed. Existing financial and inventory authority and PIN verification remain required. Untagged historical crash logs are preserved for support and excluded from business-scoped reads.

Final verification: `npm run test:bar-first-run` passed 6/6; `npm run build:hospitality-pos` passed after the final source edits. Adjacent onboarding/operator/error checks passed 19/20, with the existing BarTraining.jsx shared-error-banner failure. Scoped whitespace checks passed. No live renderer walkthrough or packaged guide checks were completed.

At the user’s later request an existing cloud archive RPC was invoked for Rabafi Pub, returning success:false. Read-back confirmed it and Botswapelo Restaurant remain active. The user then instructed leaving Rabafi Pub for now; all removal work stopped.

## 30 October continuation

Added recovery guidance for loads stopped during business/session changes. Source changes fence catalogue/fingerprint/outlet/stock/reconciliation results and background refresh/retry work to the original business and authenticated client. This prevents stale cache writes and wrongly attributed critical errors; selling still requires authoritative stock and financial checks. No new controls or permissions were introduced. Screenshots/PDF/manifest/packaged-guide acceptance remain pending before release.

First-run/scope tests: 17/17. Menu/reconciliation/persistence/multi-company tests: 23/23. Onboarding/operator/error checks: 20/20; current BarTraining already has HposNotice. Read-only linked RPC probes returned authentication denials for all four expected functions, confirming availability without creating sessions or changing company data. Authenticated live renderer behavior remains unverified.

Offline verification after the scope changes: replay authority 9/9 and offline queue regression pass. Syntax/whitespace checks pass. Logs: `.tmp/bar-scope-queue-replay-2026-10-30.log` and `.tmp/bar-scope-build-2026-10-30.log` (build result recorded after completion).

Final production build passed; the built main bundle includes the final late stock-failure scope guard. Customer PDF/screenshot/manifest and installed offline-guide verification remain pending before release.

# LodgingOS adaptation — local verification evidence

Date: 2026-10-22 (Africa/Gaborone). All results below are fresh local runs from the working tree unless identified as blocked.

## Passed

| Command | Result |
|---|---|
| node --test tests/public-booking-group-hardening.test.mjs tests/luna-disposable-database-gate.test.mjs tests/campsite-quotation-conversion-sql.test.mjs tests/verified-booking-contracts.test.mjs | 40 tests: 39 passed, 0 failed, 1 skipped. The skipped case is the live quotation SQL contract because no disposable database URL is configured. |
| node --check scripts/verify-property-transitions-disposable.mjs | Passed |
| node --check scripts/verify-public-booking-disposable.mjs | Passed |
| node --check scripts/verify-campsite-quotation-disposable.mjs | Passed |
| npm run typecheck:shared | Passed |
| npm run typecheck:renderer | Passed |
| npm run test:offline-queue-critical | Passed |
| npm run test:queue-replay-authority | 9/9 passed |
| npm run build | Passed for the lodge-camp product. Main, preload, and renderer bundles completed. |
| npm run test:run -- src/test/booking-tent-parity.test.jsx src/test/property-transition-settings-mounted.test.jsx (from booking-site) | 2 files, 42 tests passed |
| npm run build (from booking-site) | Passed |

The focused Node test command includes subprocess regressions that prove the transition and quotation gates fail closed with exit 2 instead of reporting a skip when database configuration is absent or invalid. It also covers the public-booking runner, the R1–R5 source-contract corrections, pg's effective connection parameters without opening a connection, and the transition runner's actual helper import path. The shared disposable helper pins the expected project and approved direct/pooler endpoint, rejects URL query overrides, constructs pg from validated fields, checks the pooler username, and verifies TLS certificates.

node --check scripts/verify-property-transitions-disposable.mjs and node --check tests/campsite-quotation-conversion-sql.test.mjs also passed in the implementation session.

The queue replay test logs expected simulated rejection and IPC/cache-stub diagnostics during its test cases, then exits 0 with all nine tests passing. Npm emitted a PowerShell shim warning that the roaming npm-cli path is access denied; the requested scripts still executed and returned the results above. The lodge-camp build also reports existing Vite dynamic/static import chunk warnings.

## Database status

No LUNA_REMEDIATION_TEST_DB_URL, marker, expected database, or expected project settings were configured in the process environment. `npm run test:property-transition-db`, `npm run test:public-booking-db`, and `npm run test:campsite-quotation-db` all block before SQL acceptance; their guarded runners report exit 2. A read-only Supabase Management API GET for the user-approved disposable project reference failed with HttpRequestException before the project identity or marker could be read. This does not establish that the project was deleted; it means the safety marker could not be revalidated here.

No SQL acceptance was run, no migration was applied, and no database writes were attempted. The property-transition, public-booking, and quotation SQL acceptance artifacts remain unexecuted against a live disposable target. The migration chain's disposable schema state is unverified for this handover.

The follow-up source correction addresses independent review findings R1–R5: child key ordinality, `guest_email` envelope validation, anon-key transport for custom-session staff RPC calls with in-body authorization retained, current-schema transition runner behavior, and isolated public/staff SQL acceptance contexts plus populated-group preservation. Follow-up reviews also identified project/endpoint pinning, TLS verification, strict quotation SQL gating, a missing savepoint around the expected quotation mismatch error, raw pg URL option overrides, and a transition-runner URL conversion error; local code and regressions now address these findings. Final independent source review found no remaining source-level issue in these fixes. Live disposable SQL acceptance remains pending.

## UI walkthrough distinction

The two booking-site test files mount production components; they are not an Electron walkthrough. The repository Electron executable was returned by app inventory but its launch request timed out. A fresh app inventory then showed no repository Electron window. No authenticated desktop walkthrough occurred and no harness screenshot is being represented as one.

## Deployment

No production migration, customer classification change, installer publication, or release deployment occurred. See DEPLOYMENT-pending.md for the current dependency chain and remaining release gates.



# Bar local authority dependency inventory

Date: 2026-10-29. This is a source-tree inventory; it is not an installer or production support statement.

## Current implementation

| Component | Version / location | Notes |
|---|---|---|
| Node.js | v24.14.0 on the current development host | Service engine declares `node >=20`; packaged runtime still needs pinning. |
| npm | 11.11.1 | Root install must currently use `--ignore-scripts` on this host because Electron native rebuild lacks Visual Studio. |
| PostgreSQL | 17.6 distribution extracted from the developer temp cache into ignored `services/bar-local/.local/pg17runtime`; fresh test data under ignored `services/bar-local/.local/pg17-test-data` | Test-only cluster on loopback `127.0.0.1:55441`, dedicated database and roles; all 25 migrations applied for the 64-test run. Not packaged and not a customer runtime. The older `127.0.0.1:55439` cluster had an incomplete runtime and was not used. |
| `@tsa-bonno/bar-local-service` | `services/bar-local` | Strict TypeScript; runtime dependencies `pg` and the local contracts package. |
| `@tsa-bonno/bar-contracts` | `packages/bar-contracts` | Strict TypeScript; no runtime dependencies. |
| `pg` | `^8.21.0` | Service runtime dependency; also a root dev dependency only. |
| `better-sqlite3` | `^12.10.0` | Root dependency; intended for the modern client durable intent journal. ABI must be verified in the packaged Electron runtime. |
| Electron | `^42.10.0` modern; `^22.3.27` Legacy | Legacy remains ia32; Modern and Legacy builds must keep separate identities/feeds. |
| TypeScript | `5.9.x` | Contract/service typecheck and compiled output only; customer startup must not need TypeScript. |

## Missing or undecided

| Need | Status | Gate |
|---|---|---|
| Pinned PostgreSQL Windows x64 distribution and licence notices | Not selected/packaged | Installer build and target-OS support matrix. |
| Node runtime or fully offline prerequisite installer for the service | Not selected | Offline installer. |
| Windows service wrapper, least-privilege account, startup ordering and reboot recovery | Not implemented | Installer lifecycle. |
| Local TLS certificate bootstrap, rotation, fingerprint display and client pinning | Partial: optional TLS exists; pinning/rotation not implemented | Multi-till LAN. |
| LAN discovery and safe manual-address fallback | Not implemented | Pairing workflow. |
| Supported replication/coordinator/fencing runtime | Not selected | A22/A23 and automatic failover. |
| Encrypted backup tooling | Encrypted `pg_dump` packages and secondary copies exist. A new AES-256-GCM streaming WAL segment archive/restore primitive and PostgreSQL-compatible CLI are implemented and focused-tested (EV-165), but PostgreSQL is not configured to call it. | No physical base-backup chain, scheduled WAL archive/restore integration, retention/continuity checks, recovery-point health, off-host verification or replacement-host recovery; A12/A28 remain open. |
| Owner-held recovery keys and isolated restore verification | Policy undecided | A28/A31. |
| Commercial entitlement issuer/public verification key | Test-only path; issuer format/key not supplied | Production activation. |
| Installer/package signing certificate and update feed | Not available | A16/A29. |
| Hardware qualification hosts (Windows 7 POSReady, modern x64, printers/drawers) | Not available | A21/A32 and release. |
| Approved customer manuals, screenshots, PDFs and packaged-guide evidence | Not updated for local authority | A19 and release. |

## Security boundaries

- No PostgreSQL credentials or service-role credentials are permitted in renderers, Legacy clients, PWA, public sites or logs.
- Service configuration, TLS private keys, entitlement verification keys and recovery material belong to the protected service account.
- Clients receive device-scoped credentials only.
- The root `pg` dev dependency is for developer tooling/tests; it does not establish service packaging.

## Build/test commands

- `npm run bar-local:build`
- `npm run bar-local:typecheck`
- `npm run bar-local:test`
- Root `npm test` and the existing Bar/hotel/lodge regressions remain separate gates.
- The service test aggregate requires the isolated local cluster environment described in `services/bar-local/README`/test harness; do not point it at hosted Supabase.


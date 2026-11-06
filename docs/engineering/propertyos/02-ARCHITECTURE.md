# Architecture and repository integration

Status: proposed target architecture grounded in inspected source; paths marked NEW do not exist yet. Read [data contracts](03-DATA-AND-CONTRACTS.md) before implementation.

## Verified starting point, 23 October 2026

| Existing path | Observed responsibility | PropertyOS integration requirement |
|---|---|---|
| `packages/product-config/index.js` | Three frozen product registrations | Extend ID/database-product typing without changing old IDs |
| `scripts/product-app.mjs` | Selects product for dev/build/dist/publish | Register fourth product; preserve explicit selection |
| `scripts/electron-product-entry.cjs` | Separate hard-coded allowed product set | Add intentional support; no fallback to Lodging |
| `electron.vite.config.js` | Injects product identity in main/preload/renderer; output `out/<id>/` | Compile PropertyOS separately; test entry consistency |
| `apps/*/product.json`, `electron-builder.json` | Product metadata, installer and release resources | NEW `apps/property-os/` pair |
| `src/shared/productIdentity.js` | Names, themes, route allowlists, app-data identities, family resolution | Extend all exhaustive boundaries; unknown real-estate types must not resolve to lodge |
| `src/shared/brandIdentity.js` | Shared branding source | New brand entry and assets, preserving legacy compatibility values |
| `src/renderer/src/App.jsx` | Product guards, route tree and layout selection | Early PropertyOS root with own providers and routes |
| `src/main/index.js` | Startup, IPC and product-specific infrastructure | Audit startup workers before adding a new product |
| `src/main/state.js` | Existing mutable runtime state | Do not treat active `lodgeId` as a property organisation |
| `src/preload/index.js` | Privileged desktop bridge | Typed namespaced allowlisted methods |
| `src/main/database.js`, `domains/*` | Compatibility facade and existing domain implementation | New property domains behind the same boundary pattern |
| `domains/profiles.js`, `authLogin.js`, `authSession.js` | Profile/session restoration and compatibility checks | New organisation context and explicit product auth adapter |
| `domains/cacheStore.js`, `sync*.js` | Hospitality cache and JSON/JSONL queues | Product-scoped stores and allowlisted operation routing |
| `commercialEntitlements.js`, `commercialPackages.js`, `commercialAccess.js` | Package/add-on catalogues and access logic | Isolate new module catalogue and approved billing model |
| `domains/admin.js`, `entitlements.js` | Commercial administration/runtime entitlements | Product-scoped server integration, typed errors |
| `src/shared/desktopIpcContracts.d.ts`, renderer desktop API types | Shared IPC types | New contracts without weakening existing checks |
| `manager-pwa/`, `booking-site/`, `legacy-pos/`, `services/bar-local/` | Separate surfaces and authority boundaries | Do not route PropertyOS through these business domains |

Inspected package declarations included TypeScript 5.9.3, React ^19.2.7, Electron ^42.10.0 and electron-vite ^5.0.0. These are a dated manifest snapshot, not installed-version proof or a requirement to upgrade. Use the current lockfile and actual Node engine constraints. Dependency selection belongs to W00/W02; do not install arbitrary latest versions.

## Logical execution path

```text
Electron PropertyOS renderer (React/TS)
  -> fixed typed preload API
  -> main-process PropertyOS handlers / auth-context adapter
  -> authoritative Supabase RPCs
  -> property namespace tables, ledger, audit and transactional outbox

Companion field/portal browser (React/TS)
  -> scoped Supabase reads/RPCs or narrow server endpoints
  -> same server commands and authorisation contracts

Background server worker
  -> leased outbox/schedule jobs
  -> provider adapter with stable operation identity
  -> verified callback/inquiry and authoritative reconciliation
```

Use TypeScript strict mode in new application and contract packages. Parse untrusted input at every runtime boundary; compile-time types do not validate IPC, cached JSON, webhooks or RPC results. Avoid `any`, swallowed errors and UI-derived financial totals. Pin a reviewed runtime-schema mechanism during W02; do not introduce a framework solely for this plan.

## Suggested new code boundaries

These locations are proposed and must be registered deliberately in build/typecheck configuration:

- NEW `packages/property-contracts/`: DTO schemas, error codes, command/query names, money/date types. No secrets, database client or side effects.
- NEW `src/main/property/`: organisation session adapter, query/command gateway, IPC handlers, scoped cache/queue and infrastructure composition.
- NEW `src/renderer/src/property/`: `PropertyApp.tsx`, layout, navigation, module workspaces and client service layer.
- NEW `apps/property-os/`: product metadata and builder configuration.
- NEW `property-web/`: portal/field/public entry points, only after W12 architecture decision. Existing product web apps retain their roles.
- NEW SQL migrations following the repository's active migration convention after D02; table namespace/prefix established below.
- NEW `tests/propertyos/`: contract, UI, integration, SQL and scenario suites, with guarded database harness.

Prefer these bounded modules to adding hundreds of branches inside existing monolithic files. Minimal shared hooks may dispatch into PropertyOS. App startup must choose product infrastructure before starting hospitality cache refresh, mesh, finance schedulers or lodge-scoped workers. Define a product service composition table; prove unselected services never start.

## Product identity and installer isolation

Proposed runtime ID: `property-os`; database product key: `property_os`; display name: `Tsa Bonno PropertyOS`. Proposed new app ID `com.tsabonno.propertyos` and app-data folder `tsa-bonno-propertyos` require collision and upgrade review in W01. Do not change existing Boroko compatibility identifiers.

The release repository, signing credentials, icons, public download URLs and version policy are unprovisioned. Do not guess a live feed or publish to an existing product feed. A local build may have updates explicitly unavailable with a clear reason. Packaging must include only the product output tree and approved resources; shared source in the bundle is not a licence or security boundary.

## Organisation isolation and identity

An organisation is the operating software customer, not necessarily the legal property owner. Use `organisation_id` as the PropertyOS tenant boundary. Legal owner entities are parties linked through ownership/management agreements. Maintain separate records for the same real-world property across unaffiliated organisations unless explicit sharing contracts are later designed.

Prefer Supabase Auth for new staff/portal identities, mapping authenticated subject to PropertyOS membership. D03 must prove compatibility with existing custom staff/session paths and deployments. Do not silently assume an existing `users.id` equals `auth.uid()`. Never accept a caller-provided actor ID as identity.

Every command verifies authenticated identity -> active membership -> requested organisation -> module entitlement -> capability -> property/client scope -> record state. RLS protects reads, tables and storage; SECURITY DEFINER routines have restricted grants, fixed search path and explicit checks. Entitlement visibility in React is never enforcement.

One user may join several organisations. Switching requires clearing in-memory query state, closing subscriptions, verifying the target membership and loading a distinct cache. Pending queues remain associated with their originating organisation and actor. First release does not allow offline organisation switching.

## Persistence topology decision

Preferred development model: dedicated logical `property_os` namespace and isolated disposable tests. D02 must choose same hosted project/separate schema versus separate project before hosted migrations. Consider grants/exposure, auth reuse, data residency, resource limits, backup/restore, release coupling and operating costs.

If a separate schema is not compatible with the deployed API configuration, choose an explicit `property_` table/RPC prefix with equivalent permissions, record the decision and generate one canonical mapping. Do not implement both naming models. Existing hospitality tables do not become PropertyOS storage by convenience.

## Offline and local security

Preserve the existing desktop JSON/JSONL operation pattern if it passes scope/durability review; do not casually replace it with SQLite. No Bar-local PostgreSQL authority is inherited. Server remains authoritative for PropertyOS.

First release: cached authorised reads and locally saved inspection/job drafts; online commit for financial, lease activation, offer decisions, contractual changes and approvals. W16 expands explicitly allowed operational replay only after duplicate/conflict acceptance passes. The companion browser queue is separate, product/organisation/actor scoped and tested against storage limits, eviction and multi-tab use.

Store session secrets using reviewed OS-secured storage; do not log tokens, bank details, identity documents or access codes. Minimise offline personal data, define cache expiry and logout/device-loss handling. Do not erase unsent evidence on logout: securely preserve it for authorised recovery without exposing it to the next user. D04 sets retention and revocation windows; offline cannot promise instant remote revocation.

## Providers and background work

Use typed adapters for messaging, bank imports, payments, e-signatures, screening and listing feeds. Provider identifiers are namespaced and unique. Outbound work is created transactionally with the business action, then executed by a server worker with a lease, retries and dead-letter visibility. An Electron process must not be the sole owner of organisation-wide rent generation or reminders.

Validate signatures/timestamps/replay on callbacks, preserve external IDs, separate receipt of an event from confirmation of settlement and support out-of-order/repeated events. Never retry an ambiguous payment with a new provider idempotency key. Reconcile by status inquiry before creating replacement work.

## Cross-surface compatibility and regression

All modules share DTO and authoritative command versions. Old clients fail safely on unsupported versions. Additive migrations precede new clients; delay removal of old fields/contracts until usage and queue compatibility are established. Existing hotel/lodge/POS routes, identities, entitlements and queues must remain intact.

Update `docs/ARCHITECTURE.md` only when architecture is implemented, distinguishing plan from reality. This plan is not evidence of a deployed fourth product.

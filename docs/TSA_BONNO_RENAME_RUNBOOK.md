# Tsa Bonno ecosystem rename runbook

Status: implementation and compatibility verification in progress  
Started: 2026-07-13

This runbook controls the migration from the former Boroko product family to the Tsa Bonno product family. It is intentionally separate from a mechanical search-and-replace: some old identifiers are customer-facing branding that must change, while others are compatibility contracts that must survive long enough to update installed clients safely.

## Confirmed canonical public names

The owner supplied the following canonical spellings for implementation:

| Scope | Public name |
| --- | --- |
| Ecosystem | Tsa Bonno HospitalityOS |
| Lodge application | Tsa Bonno LodgingOS |
| Hotel application | Tsa Bonno HotelOS |
| Restaurant and bar application | Tsa Bonno Restaurant & Bar POS |

Internal product-family keys are not public branding. `lodge-camp`, `hotel`, `hospitality-pos`, `lodge_camp`, `hospitality_pos`, entitlement keys, RPC names, table and column names, migration history, and idempotency payload fields remain stable unless a separately reviewed schema/API migration proves that changing them is necessary.

## Safety invariants

1. Existing Lodge customers must receive an in-place update, not a side-by-side application.
2. Lodge compatibility identity initially remains `com.boroko.bookings`, stored-data identity `boroko-bookings`, and the existing update channel. A bridge-release design is required before changing any of them.
3. Hotel and Restaurant & Bar POS keep distinct Windows identities and distinct release feeds. No product may publish into another product's feed.
4. Renaming a GitHub repository, Netlify site, Vercel project, Supabase project display name, or domain must not invalidate a URL still embedded in a released client.
5. Old public URLs require redirects or compatibility aliases before new URLs become canonical.
6. Supabase project display branding may change, but the project reference, API URL, database identifiers, RLS, RPC contracts, and migration history do not change merely for branding.
7. Secrets and access tokens must never enter source control, generated reports, terminal summaries, screenshots, or migration documentation. Rotate any credential found committed or copied into ordinary documentation.
8. Historical financial and audit records must not be rewritten solely to change branding. New customer-visible documents use the new brand; immutable historical evidence remains truthful.
9. All existing dirty-worktree changes belong to the user and must be preserved.

## Confirmed current external map

| Surface | Current identity | Migration requirement |
| --- | --- | --- |
| Source repository | `Rabafi/boroko-bookings-FullCode-2` | Rename only after local remotes, CI, deployment links, release scripts, and documentation are ready |
| Lodge releases | `Rabafi/boroko-bookings-releases` | Preserve as compatibility feed through at least the bridge release |
| Alternate Lodge releases | `Rabafi/boroko-lodge-camp-releases` | Determine whether this is active, obsolete, or a future feed before any rename |
| Hotel releases | `Rabafi/boroko-hotel-releases` | Rename with updater compatibility proof |
| Restaurant/POS releases | `Rabafi/boroko-hospitality-pos-releases` | Rename with updater compatibility proof |
| Legacy POS releases | `Rabafi/boroko-pos-legacy-releases` | Treat as a separate deployed product until scope is explicitly resolved |
| Marketing Netlify site | site ID `85265a3c-f9c1-4bf2-b1fd-3c6cbdd97098` | Preserve site ID; change display name/domain only with redirects and smoke tests |
| Booking Netlify site | site ID `29d20c46-e260-4f04-9025-aa606e2512bb` | Preserve site ID; change display name/domain only with redirects and smoke tests |
| Manager PWA Vercel project | `tsa-bonno-hospitalityos-manager`, project ID `prj_b9milxVRjSkmlcR2kQcuN4rz2Cq8` | Renamed and deployed; both `tsa-bonno-hospitalityos-manager.vercel.app` and legacy `boroko-bookings.vercel.app` are verified production domains |
| Supabase | project ref `oicgpknsmtvcsjacymum` | Branding migration `20260713013000` is deployed and all three live `product_family_label` RPC results are verified; preserve project ref and API endpoint |

The two existing Netlify sites were redeployed with renamed content and official logos on 2026-07-13 while retaining their site IDs and legacy `*.netlify.app` hostnames. Netlify couples a site's editable name to its default hostname, so those slugs remain compatibility endpoints until a new canonical domain/alias transition can preserve incoming links. The booking-confirmation Supabase Edge Function and marketing quote-download function were also redeployed with Tsa Bonno customer-facing copy. The linked Supabase dashboard display name is `Tsa Bonno HospitalityOS`, with the original project ref and API endpoint preserved.

## Repository-wide inventory baseline

Run:

```powershell
node scripts/audit-brand-migration.mjs
node scripts/audit-brand-migration.mjs --json > .tmp/tsa-bonno-brand-inventory.json
```

The initial scan covered 1,688 text-readable source files and found 3,014 legacy-brand occurrences across 397 files. After the application, web, packaging, asset, documentation, and deployment passes, the latest 2026-07-13 scan covered 1,299 files and found 1,310 raw occurrences across 214 files. That raw count still includes compatibility IDs, live legacy URLs/email/social handles, tests, migration history, release evidence, and documentation that must be individually classified. The scanner excludes dependencies, build outputs, temporary output, binary assets, and Git internals. Binary and rendered assets are tracked separately because their visible content requires rendering or visual inspection.

Every finding must end in one of these states:

- replaced with the confirmed Tsa Bonno public name;
- retained as an explicitly allowlisted compatibility identifier;
- retained as immutable migration or financial/audit history;
- retained temporarily with a named bridge-release removal condition;
- identified as third-party/customer content that must not be rewritten.

Absence from a simple grep is not completion. The final proof includes the structured inventory, visual asset review, compiled bundles, installers, live deployments, old/new URL tests, updater tests, and linked Supabase verification.

## Migration phases

### Phase 0: discovery and canonical contract

- Confirm exact public spellings and capitalization.
- Inventory textual references by line and binary assets by path.
- Inventory environment-variable names, app IDs, package names, user-data paths, protocol handlers, installer GUID behavior, artifact names, release feeds, URLs, email senders, auth callbacks, analytics/error-reporting labels, and support/report exports.
- Record current GitHub, Netlify, Vercel, Supabase, DNS, and email resources without exposing credentials.
- Classify every old identifier before editing.

### Phase 1: shared brand foundation

- Introduce one shared customer-facing brand catalogue consumed by all three compiled desktop products and web surfaces where practical.
- Add product-specific metadata for ecosystem, LodgingOS, HotelOS, and Restaurant & Bar POS.
- Add regression tests preventing customer-facing `Boroko` leakage while allowlisting compatibility contracts.
- Use the owner-supplied canonical SVGs in `logos/` for the ecosystem and each product. Generate color wordmarks, white-on-transparent dark-surface variants, product-specific Windows/PWA icons, favicons, social-card, and brochure assets; visually verify each rendered size. The generated wordmark PNG corners are contract-tested as transparent so dark padding cannot obscure the artwork.

### Phase 2: application surfaces

- Rename Lodge customer-facing UI while retaining the installed-app compatibility identity.
- Rename Hotel UI, metadata, installer presentation, exports, help, and diagnostics.
- Rename Restaurant & Bar POS UI, receipts, cash-up, kitchen/bar tickets, exports, diagnostics, and installer presentation.
- Review the shared Manager PWA for product-aware naming in each session family.
- Review Legacy POS separately; do not silently fold it into the modern Restaurant & Bar POS.
- Run focused product, financial, offline, release-architecture, and build gates after each application.

### Phase 3: public and operator surfaces

- Rename the marketing site, booking site, Manager PWA, legal pages, SEO metadata, structured data, sitemap, robots rules, analytics labels, error tracking, emails, PDFs, downloads, and support links.
- Preserve old URLs with redirects and canonical-link migration.
- Render and inspect responsive pages and generated documents.

### Phase 4: packaging and bridge releases

- Decide which internal package/workspace names remain compatibility-only.
- Preserve Lodge app ID and user-data path for the first branded release.
- Prove the branded Lodge installer updates an existing Boroko installation in place and retains local queue/cache/settings state.
- Publish separate Hotel and Restaurant/POS releases serially and verify `.exe`, `.blockmap`, and `latest.yml` assets.
- Change updater repositories only through a tested old-feed-to-new-feed transition.

Local packaging proof on 2026-07-13 produced branded v1.5.5 installers for LodgingOS, HotelOS, and Restaurant & Bar POS with exact Tsa Bonno Windows product metadata and branded icons. Independent asar inspection proved each package contains only its own `out/<product>/` compiled tree, the correct packaged main entry, the matching `product.json`, the preserved product update repository, and the official product logo/icon resources. Packaged bridge package names remain `boroko-bookings` / `boroko-hotel` / `boroko-hospitality-pos`, and NSIS keeps `deleteAppDataOnUninstall: false` while shortcut/uninstall labels use Tsa Bonno names. `tests/tsa-bonno-brand-migration.test.mjs` asserts those packaged contracts whenever the three `dist/*/win-unpacked` artifacts are present. The separate Tsa Bonno POS Legacy v1.1.0 installer and packaged executable are verified IA-32 (`0x014C`) with Tsa Bonno metadata, Restaurant & Bar logo assets, and a `latest.yml` that references the `-ia32.exe` artifact while preserving the `boroko-pos-legacy-releases` feed. Every installer reports `NotSigned`; none was published. No usable code-signing certificate (EKU 1.3.6.1.5.5.7.3.3) is present in CurrentUser/LocalMachine stores on the verification machine. Windows Sandbox/Hyper-V feature queries require elevation and were not changed.

Partial LodgingOS data retention proof (not a full installer upgrade): a disposable copy of `%APPDATA%\\boroko-bookings` was launched with `dist/lodge-camp/win-unpacked/Tsa Bonno LodgingOS.exe` under `BOROKO_TEST_USER_DATA_DIR`. Existing `profiles.json`, `lodge-id.json`, and `.updaterId` hashes remained identical; the real installed user-data directory was not modified. This is local-only evidence that the branded binary can open existing customer profile state. Full NSIS in-place upgrade, shortcut/uninstaller label replacement on a live install path, offline-queue exact-once replay across an installer upgrade, and clean-machine smoke remain mandatory before publication.

### Phase 5: external services

- Rename GitHub source/release repositories only after released-client URL analysis.
- Rename Netlify and Vercel display/project names; attach new domains before removing old domains.
- Update Supabase display branding without replacing the project reference.
- Update auth redirect allowlists, webhook targets, deployment environment values, repository secrets, status/monitoring labels, email senders, DNS, and analytics/error-tracking projects.
- Verify both old compatibility endpoints and new canonical endpoints.

### Phase 6: completion audit

- Resolve every structured brand-audit finding.
- Inspect every renamed binary/rendered asset.
- Run all ship-ready gates and all product builds.
- Test clean install and in-place update for each applicable product.
- Test offline queue preservation and exact-once replay across the Lodge bridge update.
- Smoke test the linked Supabase contracts and every live web surface.
- Update project state, architecture, product workspace, deployment evidence, and release runbook.
- Record remaining compatibility aliases with owners and removal dates.

## Completion evidence

This migration is complete only when the repository scan, visual review, compiled artifacts, installer/update behavior, live URLs, external service state, and linked database all agree with the confirmed Tsa Bonno identity, and every retained Boroko reference has a documented compatibility or historical reason.

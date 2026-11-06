# Bar manual impact — local native Hpos Menu

Date: 2026-11-04

## Impact

**Required.** The Bar Menu route now uses the familiar product wizard with local-authority behavior. It changes product creation and editing, shared stock linking, packs, availability, opening stock, and recovery for an interrupted save. Operators will see a local journal retry for an unknown outcome; local refused work is retained for recovery and cannot be discarded from this screen.

Affected customer tasks: add or edit a Bar product; choose or link its counted stock unit; configure 6/12/24 packs; set outlet availability; record initial stock; recover an interrupted save; configure modifiers, recipes and promotions; record a physical stock count; record waste with separate manager approval.

## Verification and pending work

- Focused adapter, command-contract and native route tests passed 18/18, and local migration parity checks passed 5/5; main and renderer typechecks passed; the local Bar service build passed. These source checks include the direct-link/pack recipe projection, preservation of product tax and stock settings during limited edits/archive, and link-mode stock identity retention. A stricter repository-wide renderer IPC inventory still exits with 7,504 TypeScript diagnostics (9/170 caller roots clean).
- The disposable PostgreSQL acceptance cases are authored but remain unrun because the required 4 GiB free-space preflight is not met. The migration is not applied and this feature is not commissioned.
- The local Stock panel now exposes physical count and manager-approved waste via the existing atomic local commands, alongside receipts. The stock command SQL behavior was not changed in this continuation.
- Native Menu modifier, recipe and promotion controls now call the existing journaled local commands. Recipe editing is disabled for products whose depletion recipe is locked by a direct stock link.
- Customer manual and quick-start PDF edits, screenshot recapture, visual PDF review, manifest checksum update, package inclusion, and offline-open/save verification are **pending by user direction and are not a release blocker**, as explicitly requested. Do not claim these artifacts describe or qualify the new workflow until that work is completed.
- The local Till panel was not changed in this continuation. Original Hpos Stock and Till are not yet mounted in local authority mode; their local parity and rendered acceptance remain open.


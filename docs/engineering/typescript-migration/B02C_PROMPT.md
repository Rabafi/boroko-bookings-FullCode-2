# B02-C implementation prompt

Copy the following into the implementing model's existing chat.

---

B02-B has been independently ACCEPTED with R1/R2 closed. Read docs/engineering/typescript-migration/evidence/B02B-acceptance.md and follow docs/engineering/typescript-migration/B02C_ASSIGNMENT.md in full. Also read AGENTS.md, PROJECT_STATE.md, docs/ARCHITECTURE.md and the migration PLAN.md. Historical audits do not authorize unrelated fixes.

Implement B02-C only: isolated browser renderer typechecking over src/renderer/src/utils/localDate.js, with comments/JSDoc only in that production module. The assignment defines exact editable paths, config, truthful types, negative fixture text/diagnostics, compiler inventory, meaningful guards, sensitivity probes, snapshot/log rules, required commands and rollback.

Preserve local date formatting, parser rollover/coercion, local calendar-day offsets, invalid-date behaviour and every runtime statement. Do not fix dates, introduce UTC conversion, add runtime validation, rename source, modify consumers or broaden checked coverage. This is one browser utility; React/JSX, assets/Vite globals and the large preload bridge remain separate assignments.

Key boundaries: explicit browser types:[]; DOM/DOM.Iterable allowed only in the new config; no Node/Electron/other ambient leakage; no window.api declaration. Valid/invalid fixtures compile only and contain browser calls: never execute them. All guard cases must call actual checker assertions. Exercise integrated weakened states in isolated/in-memory variants and verify intended failures, including widening the real formatLocalDate type without altering fixture markers. Restore any new fixture/config sabotage hash-exact and finish green.

Before edits, save actual snapshots/full status/hashes. Preserve all accepted B01/B02-A/B02-B executables and fixtures, root package-lock, unrelated dirty work and all reviews/acceptances. No installs, dependencies, npm ci, DB, real queues/profile/browser-storage operations, commit/push, signing or publication. The only permitted B02-B editorial is the full changed-entry rollback-field clarification explicitly assigned; never perform rollback.

Run real package scripts and final three product builds serially as assigned. Record durable bounded logs, diagnostics, provenance, exact scope and known failures honestly. Do not rerun the broad brand audit or produce new secret-bearing logs. Bar manual assessment: no update required if comment-only runtime equivalence holds.

Return the full packet/self-review with evidence and stop PENDING REVIEW. Do not self-approve, start another batch or message another chat.

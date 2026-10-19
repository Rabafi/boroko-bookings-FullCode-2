# Prompt to start B02-B

B02-A is independently ACCEPTED. Read docs/engineering/typescript-migration/evidence/B02A-acceptance.md, then implement ONLY docs/engineering/typescript-migration/B02B_ASSIGNMENT.md.

Start within that exact scope. Before editing, capture actual snapshots/hashes and full status. Preserve all dirty work and accepted B01/B02-A.

The task is a Node-only desktop-main checker over src/main/domains/fileStore.js, with comment/JSDoc-only production edits. Pin verified Node-24 typings directly: the reviewer observed Electron Node 24.19.0 and development Node 24.14.0, while current transitive typings are 25.5.0. Reconfirm versions and record the exact compatible dependency choice; no runtime upgrades or unrelated lockfile churn.

readJsonFile must return unknown: a shaped fallback does not validate successfully parsed JSON. Keep every read/write/error/fallback/encoding/serialization statement unchanged. No generic unsafe T return, casts, validators, async rewrites, queue/profile changes or financial work. Both valid and invalid fixtures are compile-only because they contain filesystem calls.

Implement the assigned NodeNext config, real-source fixtures, precise diagnostic checks, dependency-provenance inventory, active JS checking, and guard failure tests. Keep earlier checker code/configs/fixtures untouched. Use only verified synthetic scratch paths for runtime-equivalence probes and constrain cleanup.

Make only the two specified editorial clarifications for the prior brand comment/sabotage evidence. Do not rewrite historical reviews or fix the inherited-key getter behaviour.

Run prescribed final checks and product builds serially, saving safe durable logs. Do not rerun the broad brand audit or log environment contents. Return exact coverage, dependency delta, actual guard outcomes, runtime equivalence, manual impact, limitations, precise rollback and self-review.

STOP after B02-B with reviewer status PENDING. Other main modules, Electron IPC/preload/renderer, PWA/Legacy/Deno and B03 are not authorized.

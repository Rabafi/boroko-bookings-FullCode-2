# Deployment Evidence Matrix

As of: 2026-07-07

This file records release and deployment evidence for the current Enterprise/TSA Bonno worktree. It is not a substitute for the release runbook; it is the place where the runbook's deployment matrix is made explicit.

Status values:

- `proved`: current evidence proves the row for this worktree/date.
- `local-only`: local code/build/test evidence exists, but publication or production smoke is not proven.
- `not-proven`: no current evidence in this worktree proves the row.

| Surface | Local verification | Published or deployed | Smoke-tested | Current evidence | Remaining proof required |
| --- | --- | --- | --- | --- | --- |
| Supabase migrations | proved | proved for linked project through `20260707100000_payment_webhook_service_role_only.sql` | not-proven | `npm run db:push` previously reported `Remote database is up to date`; `npm run test:enterprise` includes SQL contract coverage. | Supabase lint/advisors and live RPC smoke for affected high-risk paths before production promotion. |
| Desktop app | proved | not-proven | not-proven | `npm run build` passes for main, preload, and renderer. | Build installer artifact, sign if required, install on a clean machine/profile, smoke Enterprise routes and critical finance/offline flows. |
| Legacy POS installer | not-proven | not-proven | not-proven | No current Legacy POS build/test was run in the latest Enterprise gate. | Run `npm run legacy-pos:test`, `npm run legacy-pos:build`, and `npm run legacy-pos:db:probe` when Legacy POS contract or release scope changes. |
| Manager PWA | proved | not-proven | not-proven | `npm run test:web-surfaces` runs Manager PWA lint/build; lint currently has 38 warnings and 0 errors. | Publish/deploy target build, confirm production Supabase target, and smoke manager workflows on deployed URL. |
| Public booking site | proved | not-proven | not-proven | `npm run test:web-surfaces` runs booking-site tests/build; booking-site tests pass with 32 tests. | Publish/deploy target build, confirm production Supabase target, and smoke public booking/guest portal flows on deployed URL. |
| Marketing site | proved | not-proven | not-proven | `npm run test:marketing-site` verifies Enterprise package metadata, Netlify `/enterprise` redirect, public request RPC wiring, manual-payment copy, published Enterprise pricing, and advertised add-on keys. | Publish/deploy and smoke the Enterprise/package request paths on the deployed URL. |
| Payment provider integration | local-only | not-proven | not-proven | Local security gates prove renderer/desktop cannot fake webhook settlement and server RPC is service-role-only. | Implement/configure real hosted checkout plus server-side webhook endpoint, provider credentials, reconciliation, duplicate webhook smoke, and live/provider test-mode evidence. |
| Channel/OTA provider integration | local-only | not-proven | not-proven | Local gates prove Channel Manager fails closed/manual-review without a live provider. | Connect real OTA provider adapter, prove provider acknowledgements, import/export handling, conflict/manual-review flow, and retry/dead-letter behavior. |
| Custom website deployment automation | local-only | not-proven | not-proven | Enterprise readiness screens expose unresolved launch gates. | Implement deployment automation, publish a generated/custom site, and smoke public routes/forms/booking handoff. |

Do not describe a surface as released, published, deployed, or operational unless the relevant row is `proved` for that claim.

# Test and build run summary — 2026-10-20

Workspace: `C:\Users\Botswapelo Studios\Documents\Work\Tsa Bonno HospitalityOS`

| Command | Exit/result | Notes |
|---|---|---|
| `npm run bar-local:build` | 0 | Contracts and service TypeScript compiled. |
| `npm run bar-local:typecheck` | 0 | Contracts and service strict typecheck passed. |
| `npm run build:hospitality-pos` | 0 | Existing Modern app source build passed; Vite emitted mixed static/dynamic import warnings. |
| `npm run legacy-pos:build` | 0 | Existing Legacy app source build passed. |
| `npm run legacy-pos:test` | 0; 219 passed, 0 failed | Source regression tests; do not interpret as local-service integration evidence. |
| `npm run test:bar` | 1 | 107 Bar regression files invoked. Multiple assertions failed; captured output exceeded the runner display limit. Specific observed failures included the Bar Till listener source hash mismatch at `tests/bar-guide-v9-regression.test.mjs:40`, several manual/PDF exact-candidate assertions, finance inventory/source anchor assertions, preload contract assertions, and Bar workflow source regressions. There is no verified attribution of these failures to local authority changes; the working tree contained existing edits before this checkpoint. |
| `npm run bar-local:test` | Not run | Test harness resets `bar_local`; required isolated loopback target variables unset while `SUPABASE_PROJECT_REF` was present. |

The detailed raw `npm run test:bar` output was not retained as a file by the command runner and was truncated in its returned display. This summary records the returned result without inventing a total number of failed assertions. No hosted Supabase operation was run.

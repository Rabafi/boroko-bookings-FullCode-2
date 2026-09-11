# Accounting Disposable Evidence Index (nonsecret)

Target: Supabase cloud project `repsrmlomedqrmrdsbga` (eu-west-1, Botswapelo
org). Linked production `oicgpknsmtvcsjacymum` was never written by this
work (one read-only tenant SELECT and read-only catalog probes excepted).
No credentials appear here or in the logs below; connection strings lived
only in process memory. Time zone for timestamps below is UTC.

## 1. Source snapshot (full SHA256, LF/CRLF as on disk)

Migrations of record:

- `supabase/migrations/20260730100000_shared_till_operator_attribution.sql`
  `DA19B27F35272CE2854AFB68AC32BA70C0744BDF2CD5602B11E24CEC06A5178D`
  (Task A CRLF-tolerant repair; canonical-LF `92E09D5632870F22540B8E69846F932D3E12118D0EB5EFAA7314D71805EE4A4A`)
- `supabase/migrations/20260906000000_fnb_live_function_drift_repair.sql`
  `2419A6F705A23AE2AB24A5F119C616E4E0613DAAD89FED563C8DA086F123F72F`
- `supabase/migrations/20260906001000_fnb_live_function_drift_repair_followup.sql`
  `90BB49EC38DF0309A8F3C63734DBE5A1A63FC3537861715D299FA32FC350F6A3`
- `supabase/migrations/20260907000000_fnb_live_function_drift_repair_final.sql`
  `844EFD87E34896ACE360A9C81C64114C3B1C6C1DC5D394A23822FA8FCE3653C5C`
- `supabase/migrations/20260909040000_payroll_month_end_interval_fix.sql`
  `3B43ED1782889496411DFB3FF069D6D2A870D127F3D347A55962F8A93CBD409F`
  (renamed from colliding `20260909000000`; content unchanged)
- `supabase/migrations/20260909060000_fnb_drift_full_block_verification.sql`
  `C34A62E52744ECCE443D385640B7200FAE0D38B8B9C68349D7B781FF30930D30`
  (renamed from `20260909050000` after a parallel author claimed that
  version for `bar_read_rpc_anon_grants`; content unchanged)
- Full per-file ledger: `migration-sha256.txt` retained with the disposable
  manifest (outside the repo); git HEAD `0010b612` plus 439 applied files
  recorded at execution time.

Test and runner snapshot:

- `tests/bar-migration-line-ending-portability.test.mjs`
  `2401551ED20B981D45D5F195D48B96594035F9D426A432EFA5EAA3881D935408` — 8/8
- `tests/bar-migration-drift-fresh-chain.test.mjs`
  `A584E367DE936F079165B4CE0917723F535BC5535A8E8B4ABE3FA756176869B7` — 9/9 (4 static + 5 DB-gated)
- `tests/restaurant-accounting-cutover-activation.test.mjs`
  `A4D7915568C0AC53157D0BFCBDD6E5CFB42ACADC487E58094B1AB0A2D766DFAB` — 19/19 on real roles
- `tests/restaurant-accounting-behavioral.test.mjs`
  `FF02C3F85ED75A4153DF69940E2CA43D8357B0480F593A315381AD51E7ACFFA2` — 11/11
- `tests/restaurant-recipe-depletion-behavioral.test.mjs`
  `898030F95FFEDFFDA78487BC24C1446575CDF667F7D78C0EB90D01162B432DEC` — 1/1
- `tests/helpers/disposable-prerequisites.mjs`
  `37773A48BA6CA4E4B4137C60A1BAA3FA508AD8F500ADE84912B09ABDB9D2AB04`
- `tests/pos-tab-settlement-atomic.sql`
  `93D751DBE74B9C39F66FEF33CFA03162F9A3EE140A0CD8EFE2773A9268546EAF`
  (+ `run-pos-settlement-sql.mjs` `789DC2DF…`, strict gate green)
- `tests/pos-till-attribution-demo.sql`
  `248DD53FB729D5A42118DAE6F9A9897ED675791A7EACA80DE00106FB90CB62C3`
  (+ runner `F3AD6E62…`): operator = shift waiter, audit actor = manager
- `tests/bar-accounting-matrix.test.mjs` 7/7,
  `tests/bar-accounting-activation.test.mjs` 24/24 (31/31 combined run)

## 2. Execution record (commands, exits, identities, SQLSTATEs)

All database commands below ran with `RESTAURANT_ACCOUNTING_DISPOSABLE_DB=1`,
a host-bound `RESTAURANT_ACCOUNTING_DISPOSABLE_ACK`, session-mode pooling
(port 5432, never transaction pooling), and an explicit ref guard refusing
any target except `repsrmlomedqrmrdsbga` (production ref refuses).

| When (UTC) | Command | Exit | Result |
|---|---|---|---|
| 2026-09-09 | `supabase projects create accounting-disposable-20260908-35198b` (eu-west-1) | 0 | ref `repsrmlomedqrmrdsbga`, ACTIVE_HEALTHY; no upgrade prompt |
| 2026-09-09 | tolerant chain runner, 434 files | 0 | applied; benign base-template conflicts logged (296) |
| 2026-09-09 | `migration repair` (434 versions, applied) + `db push --dry-run` | 0 | clean |
| 2026-09-09 | `node --test bar-migration-line-ending-portability` | 0 | 8/8 |
| 2026-09-09 | F5 cutover suite (4 tests incl. 15 subtests) | 0 | 19/19; roles verified `authenticated`/`anon` via `current_user`+`auth.role()`; SQLSTATEs 42501/22023/23505/55000 exactly as specified; concurrency singles verified |
| 2026-09-09 | behavioral suite | 0 | 11/11 after: payroll interval fix (new migration), budget full-matrix + 22000-conflict test fix, bank as-of bound test fix |
| 2026-09-09 | recipe suite | 0 | 1/1 after single-statement/email-param/balance-upsert/stock-method fixture fixes |
| 2026-09-09 | settlement runner (`STRICT_RELEASE=1`) | 0 | contract checks + behaviors A–D green after whitespace-robust checks, versioned fixtures, menu-row fixture |
| 2026-09-09 | attribution demo runner (strict) | 0 | operator = shift waiter, audit actor = manager on live defs |
| 2026-09-09/10 | drift fresh-chain suite | 0 | 9/9 (4 static + 5 DB-gated: no-op, stale repair via v1+v2 composition, verify-only raises, unknown/duplicate raises, CRLF repair, repeat clean, rollback evidence, contract intact) |
| 2026-09-10 | matrix + activation combined | 0 | 31/31 |
| 2026-09-10 | final F5 + behavioral certification | 0 | 30/30 on final hashes |

Safety refusals (separate from passes, by design): F5 without approval
refuses pre-connection with the exact missing element named (verified);
settlement/attribution runners skip with exit 0 unless strict mode, which
fails instead of skipping (both modes verified); drift DB cases skip
explicitly without approval while static coverage still runs.

## 3. Migration execution record (disposable history)

`supabase_migrations.schema_migrations` holds all 441 applied versions
(434 chain + payroll fix + 4 parallel product files + drift verification;
`test.tmp.sql.RELOCATED` is correctly ignored by tooling as
non-conforming). One history correction is recorded: versions
`20260906000000/601000/07000000` were stamped `applied` before their first
real application attempt and immediately reverted to `reverted` (truthful
state); all three have since genuinely applied (chain green) and are
stamped applied with matching bytes. No applied file was ever replayed
after a byte change (0/426 changed at resume; the July-30 repair predates
its application; the v2 verification file is new).

## 4. Reconciliation record (per migration, never counts-only)

Method: per-file expected objects (tables, functions with exact bodies and
signatures, policies, indexes, triggers, views, types, extensions, columns,
constraints) verified against pg_catalog, with static/dynamic DROP,
surgical-patch (`pg_get_functiondef` incl. `to_regprocedure` and signature
literals), table-rebuild, and rename supersession; search_path tracking;
case-insensitive and 63-char-truncated catalog comparison. Runner: temp
`disposable-reconcile.mjs` (outside repo); evidence
`tmp/disposable-reconcile*.log` + `disposable-reconcile/reconciliation.json`.

Result on the final snapshot: **437/441 files PASS** with dispositions;
1 accepted platform-template drift (below); 3 documented parallel-work
divergences (below). PASS and accepted/dispositioned items are listed
separately in the JSON; unexplained items are never passed.

### 4a. Accepted exception (not a PASS)

- File: `20260526101632_baseline_20260526_remote_schema.sql` (May dump).
- Expected: index `realtime.subscription_subscription_id_entity_filters_action_filter_key` (70 chars).
- Actual: `realtime.subscription_subscription_id_entity_filters_action_filter_selec` (63-char platform truncation) plus a diverged sibling set from the current Supabase template.
- Provenance: upstream platform-template drift between the May dump and the
  current Cloud base image; the May dump cannot pin Supabase-managed
  realtime/storage internals.
- Dependency impact: none — no chain file outside the baseline references
  that index name; realtime behavior is platform-owned; all app tables,
  functions, policies, and grants reconcile exactly.
- Reviewer disposition: accepted deviation, documented here; re-check if
  the baseline dump is ever regenerated.

### 4b. Documented parallel-work divergences (disk newer than applied)

Three newest product-lane files were edited by their author after clean
application, so disk bytes no longer match live definitions. Untouched by
this work (no auto-replay); outside the acceptance surface (no acceptance
suite exercises them); flagged for their owner to re-apply or forward-fix:

- `20260909000000_bar_atomic_product_with_stock.sql` (`save_bar_product_with_stock` body differs)
- `20260909010000_catalog_publication_jobs.sql` (`complete/fail_catalog_publication_job` signatures/bodies differ)
- `20260909020000_pos_modifier_requirements.sql` (`enforce_pos_modifier_requirements` set differs)

Note: `20260909050000_bar_read_rpc_anon_grants.sql` (same lane) reconciles
clean, but as an anon-grant expansion it needs explicit security review
before any production deployment — flagged, not approved here.

## 5. Target-qualified state summary (2026-09-10 00:10 UTC)

- Disposable `repsrmlomedqrmrdsbga`: chain green (441/441), history
  complete, reconciled per above, acceptance green per section 2.
  No activation, no real tenants, synthetic fixtures only.
- Production `oicgpknsmtvcsjacymum`: migration parity through
  `20260908020000` (deployed by a separate party 2026-09-09); live bodies
  spot-checked read-only (v3 attribution = new form; F&B hunks =
  already-correct forms). No grants changed here, no activation performed,
  no tenants selected. Pending production deployment of the repaired/new
  migrations is an explicit owner approval, not inferred.
- Statuses: authored = in tree; local-tested = suites above;
  disposable-applied/tested = this index; production-applied/verified,
  activated, signed, published = NOT DONE (owner gates).


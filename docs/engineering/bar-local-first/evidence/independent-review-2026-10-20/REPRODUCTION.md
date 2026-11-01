# Independent probe reproduction

All data/credentials are synthetic. Do not run against the author cluster, hosted Supabase, or customer data. The original reviewer cluster is stopped after review. Paths in target.json identify that stopped disposable review cluster, not a reusable production target. Create a new positively identified isolated cluster and adapt all target values/paths first.

The copied scripts originally ran from repository .tmp/bar-local-independent-review-20261020 and use imports relative to that directory. Copy them to an equivalent ignored directory or adjust imports deliberately; do not execute the evidence copies in place. Inspect every script before execution.

run-suite.mjs documents initial setup; on this Windows host its captured pg_ctl output handles caused a startup-runner hang after successful server startup. The reviewer stopped only that owned Node runner and resumed with resume-suite.mjs. For reproduction, start pg_ctl with redirected file/ignored handles (windowsHide true), then verify actual data_directory and port before bootstrap. Do not stop unrelated processes.

The service suite rebuilds production service/contracts and resets only the explicit disposable test schema. database-probes.mjs resets its configured isolated schema using the inspected harness. Run probes after the aggregate, never concurrently on one schema. restore-probe.mjs requires a new empty restore database and validates its cluster before creating it. No independent probe is a production setup/cutover script.

Probe process exit zero means evidence collected. Check per-case pass=false, THREW, wrong authority acceptance, unknown journal states, mismatched tenders and restored privileges. No fake component or process simulation is physical/installed qualification. Ephemeral backup key was intentionally not persisted; rerun the synthetic backup probe to produce another disposable package.

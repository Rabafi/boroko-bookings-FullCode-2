# Accounting Release-Readiness Packet (DRAFT — not approved, nothing activated)

Status: **DRAFT paperwork only.** No production migration, grant, tenant
activation, signing, version change, or publishing has occurred or is
authorized by this file. Fields are separated into **Proposed** (awaiting
owner decision), **Verified** (evidenced below), and **Pending**
(blocked on named work). The execution record stays in
`docs/ACCOUNTING_PILOT_RELEASE_EVIDENCE.md` (still empty by design).

Field discipline: a field moves from Proposed/Pending to Verified only on
cited evidence. A missing sign-off is a no-ship condition.

## 1. Decisions required from the owner (all Proposed/Pending)

| # | Field | State | Detail |
|---|---|---|---|
| 1 | Pilot tenant | **Pending selection** | Eligible (read-only verified 2026-09-08): Botswapelo Bar, Botswapelo Hotel, Botswapelo Lodge, Botswapelo Lounge, Botswapelo Restaurant, The Hills View Lodge PTY LTD. Owner selects exactly one; no automatic selection. |
| 2 | Activation effective date | **Pending** | Set only after readiness-true and cutover approval. Never defaults to today; never backdated automatically. |
| 3 | Cutover | **Pending tenant choice** | If the chosen tenant has historical financial activity, an evidence-backed cutover proposal goes to independent review first. "No history" only after authoritative eligibility checks, never to bypass cutover. |
| 4 | Configuration version | **Proposed** | Identifier must be tied to the exact reviewed chart, mappings, and configuration snapshot; stays `proposed` until the snapshot is approved. Format proposal: `chart-<yyyyMMdd>-<short-hash>` recorded in the cutover batch evidence. |
| 5 | Policy version | **Proposed** | `bar-accounting-financial-truth-v1` per `docs/ACCOUNTING_POLICY_DECISIONS.md`; re-verify against the final tested SQL contract before activation. |
| 6 | Product version | **Proposed `1.5.8`** | No `v1.5.8` tag exists (verified 2026-09-08); tree remains `1.5.7`. Do not bump, tag, or publish until go-approval. |
| 7 | Signing inputs | **Pending — all missing** | `CSC_LINK` MISSING, `CSC_KEY_PASSWORD` MISSING. No signature can be produced until provided via environment or approved secret store. Never in Markdown. |
| 8 | Publish token | **Pending — missing** | `GH_TOKEN` MISSING (`GH_TOKEN_FILE` also unset). `scripts/release.mjs publish` cannot run until provided. |
| 9 | Pilot operators | **Pending** | Named pilot operators required; access limited to them. |
| 10 | Pilot devices | **Pending selection** | Acceptance checklist prepared (section 4); mocked browser/hardware-adapter tests do not count. |
| 11 | Distribution channel | **Proposed** | A private/pilot channel (e.g., draft GitHub release in the existing releases repo, distributed directly to pilot devices). **Pending:** confirm updater configuration cannot offer the candidate to general users. |
| 12 | Abort owner + backup | **Pending designation** | Named person and backup required; not invented here. |
| 13 | Rollback | **Proposed** | Stop distribution; suspend new Accounting posting via the verified suspend mechanism; preserve journals, audit history, and pending operations; reconcile affected transactions. Revert the app only where schema compatibility is proven. No journal deletion, no blind migration reversal, no backup restore over newer financial activity. Core POS stays safe during suspension because posting suspension only stops new GL work, never sales capture. |

## 2. Verified facts (with evidence)

- Linked production project is `oicgpknsmtvcsjacymum`; remote migration parity holds through `20260908020000` (verified 2026-09-09 ~19:45 UTC — accounting cutover reads/grants, evidence binding, revision binding, and the starter dashboard have been deployed by a separate party since the 20260907000000 checkpoint). This work wrote nothing to production (one read-only tenant SELECT excepted). Still pending production deployment: the repaired July-30 attribution migration (remote runs pre-repair bytes), the three F&B drift repairs, the payroll interval fix, and all `20260909*` migrations — an explicit deployment approval is required.
- Disposable acceptance project `repsrmlomedqrmrdsbga` (same org/region) is isolated, healthy, and ref-guarded on every operation. Nonsecret manifest retained outside the repo; secrets never in reports. Full evidence: `docs/ACCOUNTING_DISPOSABLE_EVIDENCE_INDEX.md` (exact paths, full hashes, commands, exits, SQLSTATEs, migration and reconciliation records).
- Migration chain applies cleanly on the disposable: 441/441 timestamped files as of 2026-09-10 (includes the F&B drift full-block verification `20260909060000`, the payroll interval fix `20260909040000`, and parallel product files through `20260909050000_bar_read_rpc_anon_grants`); migration history stamped; `db push --dry-run` reports up to date.
- Per-migration object reconciliation: 437/441 files PASS with dispositions (existence + exact function bodies + surgical-patch/shutdown/rebuild/drop accounting); 1 accepted upstream platform-template drift (realtime subscription index renamed by Supabase, unreferenced — see evidence index 4a); 3 documented parallel-work divergences (disk newer than applied in `bar_atomic`, catalog-jobs, modifier-requirements lanes — see evidence index 4b, untouched, outside the acceptance surface).
- Real SQL acceptance on the disposable, all green: cutover maker/checker 19/19 on real `authenticated`/`anon` roles with exact SQLSTATEs; behavioral 11/11; recipe depletion 1/1; settlement strict gate (contract + behaviors A-D); migration portability 8/8; drift fresh-chain 9/9 (4 static + 5 DB-gated incl. v1+v2 composition, verify-only raises, unknown/duplicate raises, CRLF repair, repeat clean, rollback evidence, contract intact); matrix + activation 31/31 combined; live manager-unlock + PIN-staff attribution demo.
- July-30 operator-attribution repair verified live (old block zero, new block exactly once; signature/definer/search_path/grants unchanged) plus a live manager-unlock + PIN-staff order demo proving operator = shift-owning waiter and audit actor = unlocking manager.
- F&B drift repairs verified live per hunk (4 hunks applied, 4 already-correct no-ops, all post-verified).
- Payroll month-end interval fix verified live (stale literal gone, corrected literal present); budget/bank/recipe/settlement suites corrected to the reviewed server contracts.
- F5 safety gate verified refusing without approval (fails loudly, never skips).
- Abort criteria adopted verbatim (section 5).

## 3. Pending blockers (all must clear before go/no-go)

1. **Owner decisions in section 1**, backup/restore drill result, and the consolidated go/no-go approval naming exact tenant, configuration, cutover, artifact, devices, and scope. Disposable-path technical work (F1 full-block verification, F2 realisticDB coverage) is closed with evidence in the index; the only known migration-logic limitation is documented there (v2 cost/expenses stale branches abort loudly and atomically rather than repairing — unreachable in chain order after the v1 repairs, proven by composition test).
2. **Production deployment** with grant/readiness verification under normal client roles — explicitly not performed here. Target-qualified state (2026-09-10): production parity through `20260908020000` (separate party); pending there: the repaired July-30 bytes, the three F&B drift repairs, the full-block verification, the payroll interval fix, and all `20260909*` files. Do not redeploy historical accounting grants from stale paperwork; deploy the exact reviewed forward list only after approval.
3. **Pilot execution** per section 4 (real devices, real tenant) with evidence recorded in `ACCOUNTING_PILOT_RELEASE_EVIDENCE.md`.

## 4. Pilot device acceptance checklist (proposed)

Two-terminal concurrency on ledger-affecting operations; printer operation and receipt-vs-ledger agreement; interrupted connectivity during posting/activation with same-key retry and restart; recovery and reconciliation to authoritative state; restricted-operator denial journey; suspend-and-retained-history behavior. Real devices only.

## 5. Abort criteria (adopted — any one blocks or stops the pilot)

Unauthorized or cross-tenant access; duplicate, missing, or unbalanced
financial postings; unexplained reconciliation differences; approval of
unreviewed evidence or bypassed maker/checker controls; incorrect activation
identity, configuration, or effective date; unresolved financial outcomes
that cannot be safely reconciled; failed signature verification, wrong
update audience, or inability to recover required operational workflows.

## 6. Evidence slots (fill at execution; mirror into ACCOUNTING_PILOT_RELEASE_EVIDENCE.md)

Migration apply (disposable) | Grant/readiness verify | Clean install |
Upgrade + queue retention | Activation journey (operator) | Denied-role
journey | Connection-loss retry/restart | Two-client concurrency |
Backup/restore drill | Feed + signature verify.

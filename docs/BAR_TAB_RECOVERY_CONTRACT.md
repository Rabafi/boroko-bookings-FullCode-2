# Bar Tab Recovery Contract

Date: 2026-09-07 (second pass). Client executor: `src/shared/posTabRecovery.js`
(classifier + `replaySavedTabOperation` + `submitNewTabOperation` +
`listRecoveryEnvelopes` + `archiveRecoveryEnvelope`). UI:
`HposOpenChecks.jsx` (form entry path, replay entry path, recovery inbox).
Domain: `splitBillEvenly` / `transferPosTabWaiter` in
`src/main/domains/pos.js` (provenance-tagged results, `is_replay` bypass of
stale local pre-checks, post-commit cache-failure guard). IPC: both handlers
tag catch failures `outcome: 'unknown'`. Server: `split_pos_tab_evenly`
(op-row check before tab state; `unique (lodge_id, idempotency_key)`;
SQLSTATE 22000 key/payload-conflict raise; stored response replayed) and
`transfer_pos_tab_waiter` (per-key advisory lock; op-row check after tab
lock/auth but before mutation; `idempotency_conflict` on mismatch; stored
result replayed to the originating owner/proof).

## Durable envelope

`{ schemaVersion: 1, operationId, kind, tenantId, outletId, sourceTabId,
actorId, expectedVersion, payload, payloadFingerprint, request,
createdAt, lastCheckedAt, outcome, authoritativeResult, lastCode }`.
`request` is the exact dispatch argument object stored verbatim at submit
time. Keys are tenant-scoped; legacy tab-only keys remain readable.
Corrupt records quarantine; persistence failure blocks dispatch; resolved
attempts move to `hpos:resolved-tab-op:*` (archive, never delete).
Splits and transfers stay online-only.

## Provenance-aware classification

`classifyTabOperationOutcome(result, error, { keyPreviouslySent })`:

- Thrown transport errors, timeouts, crashes, null results → unknown,
  except explicit idempotency-conflict evidence → needs_review.
- Explicit domain `outcome: 'unknown'` always wins.
- `success: true` commits ONLY with server evidence
  (`tab`/`source_tab`/`new_tabs`/`replayed`); bare `{success:true}` is
  unknown, never manufactured commitment.
- `success: false` + review code (or 22000 *with* conflict text) →
  needs_review. Bare SQLSTATE or message text alone decides nothing else.
- `success: false` + verified terminal code → rejected on a FRESH key
  (synchronous pre-mutation rejection, nothing left the device under it).
- On a PREVIOUSLY SENT key, only `tab_version_conflict` stays terminal:
  a committed original would have replayed its stored result instead
  (op-row-first ordering on both RPCs). Every other replay failure is
  unknown — a still-running original, rotated Till proof, or new owner
  cannot be excluded. Generic `success:false` without a verified code is
  unknown on any key.

Terminal codes (verified pre-mutation in the deployed definitions):
`invalid_transfer`, `invalid_split`, `tab_version_required`,
`tab_version_conflict`, `tab_not_found`, `bar_scope_required`,
`waiter_shift_required`, `target_waiter_shift_required`,
`operator_proof_invalid`, `till_operator_session_expired`, `tab_not_owned`
(fresh keys only, except version conflict), `offline_*_blocked`
(local-validation provenance; nothing dispatched).

## Replay semantics

- Check status IS the replay: same request, same key, `is_replay: true`.
  The server returns the stored result for a committed key without
  duplicating, or executes a never-received intent exactly once under its
  key (unique constraint + advisory lock bound same-key effects to one).
  The UI labels this explicitly; it never claims a non-mutating probe.
- Replays never read editable form state, the tab cache, or shift listings;
  `is_replay` skips stale local pre-checks (missing cache row, cached
  waiter already equal to the saved target). The server re-validates
  everything.
- Replay authorization is per-operation (originating actor or manager role);
  unrelated tabs gain nothing. The server still enforces ownership/proof.
- Concurrent executions of one key share a single promise: two concurrent
  replay calls yield one dispatch.
- Corrected new keys require a stored terminal rejection, validated inside
  the corrected path itself (not just by hiding the button). Unknown
  outcomes never mint.
- Split closes its source tab and transfer may move ownership away from the
  actor: both resolve through the tenant-scoped recovery inbox, which lists
  pending operations independently of the active tab list, current
  ownership, and form state. Cross-tenant envelopes never surface.

## Known server-side limits (documented, not worked around)

- Transfer replay authenticates as the originating owner/proof; a new owner
  receives `tab_not_owned` (result non-disclosure by design). The client
  keeps the record for support inspection.
- Split idempotency hashes include the Till operator proof, which is stable
  per session: same-session replays match; post-rotation replays surface
  `idempotency_conflict` (needs_review, safe) instead of the stored result.
  Changing hash semantics server-side would break replay matching for
  existing rows and is not attempted.
- Old `split_pos_tab_evenly` revisions replay stored responses without a
  payload-hash check; client-side fingerprint discipline (block changed
  payload under a live key; new keys for corrections) covers both revisions.

## Verification

- `bar-tab-recovery-outcomes` 10/10: V01 repro cases, malformed success,
  fresh-vs-replay matrix, real domain fns (scripted RPC: terminal
  rejection + provenance, transport-error envelope, commit surviving cache
  failure, transfer replay bypass with verbatim args, local-validation
  no-dispatch).
- `bar-tab-recovery-executor` 10/10: verbatim replay, correction gating
  (refused while unknown, archived + new key after rejection), single
  dispatch under concurrency, storage/corrupt/tenant/auth guards,
  key retention across unknowns, inbox discovery, archive evidence.
- `bar-rendered-recovery` 1/1 covering 15 real-browser scenarios (R1–R6
  recovery, F1–F4 finance gating, A1–A5 activation).
- Live two-terminal, offline-restart, and duplicate-delivery acceptance
  still require WP7 hardware runs.

# Bar queue write strategy plan (point 5 — do later)

Status: Planned, not started. Owner runs this later with a fresh go-ahead.
Scope: Bar / hospitality-pos desktop queue only (`sync-queue.json`). Not the history log (fixed), not the phone app (fixed), not Legacy POS (separate queue), not the mesh protocol.

Citation rule: cite by symbol + quoted code, never by line number alone — line numbers drift.

Read before starting: `AGENTS.md`, `PROJECT_STATE.md` (top sections, esp. 2026-09-22 scale guards 1-4), `docs/ARCHITECTURE.md`, `docs/OFFLINE_MATRIX.md` (hotel only — Bar truth lives in code + `ARCHITECTURE.md`), this file in full.

## 1. Problem in plain words

Today, adding one sale reads the whole queue file and rewrites the whole file. Sending one sale writes the whole file 3 times (mark sending, mark sent, remove). With 10 sales this is fine. With 3,000 (a busy Till offline for weeks, the volume the WEEKS stress already tests), every ring waits on a multi-MB rewrite, and replay does 3x that while the operator waits.

Verified code (names, not line numbers):
- `queueOperation` does `readSyncQueue()` then `queue.push()` then `writeSyncQueue(queue)` — one full parse + one full serialize + fsync per enqueue.
- `writeReplayQueue` wraps every replay write with `absorbNewDiskQueueArrivals` (correct — stops a concurrent sale being erased — but each wrapper does another full `readSyncQueue()` first).
- Happy-path replay = 3 `writeSyncQueue` calls per item (`in_flight`, `committed`, remove).
- No `MAX_QUEUE` / truncation / size guard on the queue path (only `MAX_SYNC_RETRIES = 5`, which limits retries, not size).
- What fixes 1–4 already covered, so this plan must NOT redo: single-copy lock (fix 1), hot status tail-read + export single-read (fix 2), history-log trim (fix 3), phone-app full-storage message + export/clear (fix 4).

What fixes 1–4 did not change (and this plan must preserve): crash durability (`writeJsonFileDurable` tmp + fsync + rename, `.tmp` promotion on boot), two-phase replay journaling (`in_flight` before RPC, `committed` before remove), stable `_queue_id` / idempotency keys (never mint a fresh key on retry), incremental dead-letters, terminal-failure parking, POS submit journal, verified phone write-ahead.

## 2. Rules that cannot bend (from AGENTS.md)

- Same RPC contract on replay: same RPC name, same payload bytes, same stable operation / idempotency key.
- Never replace an ambiguous timeout with a new key.
- Queue operations, not a second business model. Offline replay preserves the contract desktop uses online.
- Fail closed on money, stock, and irreversible actions. No silent drops; failed work stays reviewable.
- Keep legacy queue compatibility (`normalizeQueueRows` accepts `queue` / `items` / `pending` shapes; legacy adapt paths in `syncShared.js` stay working).
- Keep mesh share shape (`isMeshShareableQueueItem` readers) working or migrate them together.
- Local-only change: no migration, no `db:push`, but needs relaunch (main process) + full offline test set.

## 3. Options

### A. Add-only log + memory index (recommended long-term)
- New sales append one line to a log file (like `offline-operation-log.jsonl` does today) instead of rewriting everything.
- The running app keeps an index in memory (id → file position). Status, replay, and shift checks read the index, not the whole file.
- Startup rebuilds the index from the log (like Legacy POS `rebuildFinancialQueueFromJournal`). Crash during a write leaves at most one half-line, which is ignored on rebuild.
- Pros: enqueue cost stops growing with queue size; replay writes shrink to lines, not full files.
- Cons: biggest change; needs new rebuild + compaction logic; needs the most testing.

### B. Limit + clear warning (interim guard, small)
- Set a soft warn count (e.g. 1,000) and a hard stop with a plain message (e.g. 5,000): "Queue full — sync or export before selling."
- Pros: days of work, stops the worst case from growing silently.
- Cons: does not make anything faster; blocks selling at the cap, which hurts remote bars.

### C. One file per sale (not recommended)
- Each queued sale becomes its own small file in a queue folder.
- Pros: no more whole-file rewrites.
- Cons: thousands of files break backup/export/health scans in new ways; atomic replay across files is harder; not worth it versus option A.

Recommendation: do A when ready. Use B only if weeks-offline bars need a guard before A lands.

## 4. Suggested build order (when owner says go)

1. Measure first: enqueue p95 + full replay time at 0 / 500 / 3,000 items on a real Till profile (temp copy). Write the numbers down; they are the pass bar.
2. Put the queue behind a small store interface (read / append / mark / remove / list) with the file format hidden behind it. No behavior change yet; existing tests must pass untouched.
3. Add the add-only log + index behind the interface, with:
   - fsync per append (same durability as today),
   - startup rebuild that ignores a torn last line,
   - periodic compaction (rewrite the log once, not per sale) guarded by the single-copy lock from fix 1,
   - the existing `absorbNewDiskQueueArrivals` semantics preserved for in-process arrivals.
4. Migrate existing `sync-queue.json` files once on first boot (read old array → append each item → keep a `.bak`). Never delete the backup in the same boot.
5. Soak: WEEKS stress volume, kill mid-replay recovery, queue-during-replay fence, dead-letter + terminal-refusal paths, mesh share reads, export bundle, System Health counts — all byte-identical replay payloads and keys.

## 5. Pass bar (do not call it done without these)

- Same replay bytes and keys: chaos replay converges with exactly-once money effects; journal complete.
- Crash safe: kill -9 before RPC, between `in_flight`/`committed`/remove, and mid-compaction — restart loses nothing and double-charges nothing.
- Speed: enqueue p95 at 3,000 items clearly beats today (record both numbers); replay wall time down; status poll no longer scales with queue length.
- Compatibility: old `sync-queue.json` shapes load; mesh peers still read the share summary; export bundle still opens.
- Tests: extend `tests/bar-offline-scale-guards.test.mjs` + `tests/offline-queue-regression.test.mjs`, keep `test:bar`, `test:offline-queue-critical`, `test:offline-pos-critical`, `npm test` green (only the known pre-existing guides checksum fail, which is a separate pending rebuild).
- Manual impact: none expected unless a new warning UI is added — then record the decision and update the Bar guide in the same change per `docs/bar-manual/maintenance.md`.

## 6. Do NOT do in this plan

- Change any RPC name, payload, or idempotency-key derivation.
- Touch Legacy POS queue, mesh wire format, or server migrations.
- Switch the desktop queue to SQLite (repo standard is JSON/JSONL-backed).
- Remove the fix-1 single-copy lock or the fix-2/fix-3 journal caps to "simplify" — they stay.

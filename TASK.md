# Task Status

Last reviewed: 2026-06-20

There is no single permanent repository-wide active task in this file.

The previous deposit and first-generation offline-idempotency task has been superseded by later implementation. Do not reapply it.

2026-07-03 note: external offline/sync audit notes were checked against the current repository. Severe claims about SQLite sync queues, no server-side idempotency, unauthenticated Legacy POS mesh, and direct booking-payment table writes were mostly false for this checkout. Use [PROJECT_STATE.md](PROJECT_STATE.md) for the current verified state.

For current orientation:

- Read [PROJECT_STATE.md](PROJECT_STATE.md).
- Inspect `git status` and the relevant diffs.
- Follow the user’s current request.
- Treat documents under `docs/` as historical reports or scoped plans according to their status banners.

When a temporary task is recorded here, it must include:

- owner or requesting thread;
- exact date;
- scope and excluded files;
- committed, uncommitted, deployed, or planned status;
- acceptance checks;
- a removal or supersession condition.

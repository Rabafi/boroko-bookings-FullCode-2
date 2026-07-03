# Claude Project Instructions

Last reviewed: 2026-07-03

The authoritative shared AI instructions are in [AGENTS.md](AGENTS.md). Read that file before making changes.

Also read:

- [PROJECT_STATE.md](PROJECT_STATE.md) for current implementation and worktree status.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for execution paths.
- [docs/SHIP_READY_RUNBOOK.md](docs/SHIP_READY_RUNBOOK.md) for release verification.

Do not treat `TASK.md`, an audit report, a handoff, or an implementation plan as current merely because it exists. Check its status banner and date, then verify its claims against current code and migrations.

Recent external offline/sync audit notes were verified on 2026-07-03 and several severe claims were false for the current checkout. Use `PROJECT_STATE.md` and current source files before repeating claims about SQLite queues, missing idempotency, unauthenticated mesh, or direct booking-payment table writes.

Preserve unrelated worktree changes. For financial or sync work, verify both online and offline paths and keep Supabase RPCs as the source of truth.

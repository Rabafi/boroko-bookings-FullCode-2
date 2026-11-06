# Demo company deletion — 28 October 2026

The user explicitly requested permanent deletion of Botswapelo Bar and Botswapelo Lounge and confirmed both were demo/test accounts.

## Verified scope and outcome

- Linked Supabase project: `oicgpknsmtvcsjacymum`. The terminal default referred to a different project and was not used.
- Botswapelo Bar: `b380ba5e-a761-4017-8515-4f1ff31785a7`.
- Botswapelo Lounge: `45f21c52-a095-4031-a06c-bd1717865ebd`.
- An administrative dependency inventory selected 18,933 rows across 60 public tables. It searched company UUID references and followed foreign-key dependents. Cross-company ownership checks found no conflicts.
- The server-side atomic deletion command first passed a deliberate rollback trial. Foreign-key enforcement remained enabled. Affected tables were exclusively locked; user triggers were temporarily suspended within the transaction to remove immutable demo evidence, then restored to their original states before commit. Unrelated row content hashes were compared before and after.
- The same fixed-target command committed successfully. Post-deletion scoped counts and staff queries returned no records; the command also checked every public base table for remaining company UUID references.
- 51 Auth identities with no surviving company memberships were hard-deleted through Supabase Auth. One identity shared with other companies was preserved; its demo staff memberships were removed.
- No Storage objects matched either company UUID or were owned by the 51 exclusive Auth identities.
- The verified running development POS process was stopped before local cleanup. Both demo sync and failed-sync queues were empty.
- Both profile folders, including caches, operation journals and queue files, and ten company-owned Lounge backup JSON files were removed from `Tsa Bonno Restaurant & Bar POS Dev Desk` app data. The profile registry and active-company file now retain Botswapelo Restaurant.
- A final read-only scan of known Boroko/Tsa Bonno app-data roots found zero files containing either target company UUID, with no unreadable files.

## Local browser preference incident

The first Chromium Local Storage rebuild removed the existing store but its restore helper failed to read piped input. This removed 17 target entries and also lost ten unrelated UI preference/login-hint entries. Those unrelated values could not be recovered. They included Restaurant saved email hints/session UI state, global email hints, display/sound preferences, an accounting preview setting and a date-specific daily-check UI entry. Restaurant profile cache and business records were not deleted. The user was informed during execution. The corrected helper uses a temporary checkpoint file before rebuilding storage and verifies restored contents; the empty rebuilt store was verified and the checkpoint file removed.

## Limits and implementation boundary

This was a one-off administrative deletion, not a newly released Command Central workflow. Permanent deletion remains disabled in the product. No application code, migration deployment, release, commit or push was performed.

Provider-managed historical backups/PITR and system logs were not erased. Copies on other PCs, disconnected devices, browser installations, or external exports were not available for inspection. No commissioned local-Bar authority profile was present in the inspected POS app-data folder; its local workspace choice was cloud. The disposable development PostgreSQL databases were not treated as either company's database.

Manual impact: **No manual update required**. This removes specifically authorized internal demo datasets and introduces no customer-facing workflow or supported feature.

Local evidence is under `output/company-demo-deletion/`: catalog, inventory, rollback result, committed result, Auth results, post-deletion verification and local cleanup results. These retain administrative identifiers and counts, not an export of deleted transactions or credential values.

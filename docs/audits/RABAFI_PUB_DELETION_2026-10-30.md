# Rabafi Pub permanent deletion — 30 October 2026

The user requested deletion of Rabafi Pub in continuation of the prior permanent company-data deletion request.

- Exact linked Supabase project: `oicgpknsmtvcsjacymum`.
- Exact company identity: Rabafi Pub, `5d360d46-2cbd-490d-9ac7-3c2f7aa95c86`.
- Live dependency inventory and rollback validation selected 13 rows across 11 public tables. There were no cross-company ownership conflicts. Foreign keys stayed enforced; unrelated rows were verified unchanged. The same atomic administrative command then committed successfully, restoring original user-trigger states before commit.
- The sole Auth identity is shared with other companies and was preserved. Its Rabafi Pub staff membership and sessions were deleted. No company-ID or exclusive-owner Storage objects were found.
- The local profile had empty pending and failed sync queues. Only a cloud workspace choice, with no commissioned local authority profile, was present in the inspected POS app-data folder.
- Deleted its local POS profile directory, including cache/journal/queue data, two company-owned backup files and three browser-storage entries. The profile registry retains Botswapelo Restaurant.
- Two unrelated browser-storage entries were preserved and restored with exact content comparison. The original Local Storage directory was retained in staging until the restored contents verified, then removed. A durable temporary checkpoint was also removed after verification.
- The unrelated Restaurant profile cache SHA-256 tree hash was verified unchanged. There was no browser-storage restore failure in this deletion.

Evidence: `output/rabafi-pub-deletion/`, including live lookup, metadata, rollback/commit results, local cleanup result and final verification reports. This is administrative evidence, not a transaction export.

No application workflow, migration, release, commit or push was introduced. Permanent deletion remains disabled in the product UI. Manual impact: **No manual update required**; this was an explicitly requested one-off administrative dataset deletion.

Provider-managed historical backups/PITR, service logs, disconnected devices and external exports were not erased. Local inspection covers the known Boroko/Tsa Bonno app-data roots on this PC.

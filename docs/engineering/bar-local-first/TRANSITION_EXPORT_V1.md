# Bar transition export, version 1

This is the local-only input envelope for synthetic cloud-to-local transition rehearsal. It is a read-only source artifact. The verifier is `services/bar-local/scripts/dry-run-transition-import.mjs`; it does not contact PostgreSQL, Supabase, or any service, and it does not import records.

## Required shape

The JSON root has:

- `format`: `tsa-bonno-bar-transition-export`
- `version`: `1`
- `source`: `business_id` and the complete, duplicate-free `outlet_ids` set represented by the export
- `snapshot`: a timezone-qualified ISO-8601 `exported_at` and `complete: true`; an incomplete or undated export is refused
- `collections`: arrays for every name listed in `COLLECTIONS` in the verifier, including explicit empty arrays. Every row needs a stable `source_id` and owning `business_id` matching the declared business. `outlet_id` is required for sales, tenders, returns, voids, stock movements/takes/transfers, tabs, cash-ups, tips/payouts, expenses and pending operations, and must match a declared outlet. Business-wide records may omit it.
- `relationships`: explicit relationship rules as an array, including when empty. Each rule has a non-empty unique `name`, `source_collection`, `source_field`, `target_collection`, boolean `nullable`, and a scope of `business`, `same_outlet` or `none` (default `business`). A reference is absent when its value is missing, `null` or an empty string. Absent references are accepted only for nullable rules; every present source reference must resolve to exactly one target `source_id`. Business and same-outlet scopes require both rows to carry matching business IDs; same-outlet also requires matching outlet IDs. `none` skips relationship-level scope equality but does not bypass each row's required business scope or the export's outlet inventory checks.
- `reconciliations`: explicit parent-to-child exact decimal checks as an array, including when empty. Each rule declares unique `name`, parent and child collections, parent identity key/amount field, child foreign-key/amount field, decimal `scale` (0–6), and `scope` (`business` or `same_outlet`). The verifier sums children with integer arithmetic and compares the exact result with every parent amount. Orphan children, invalid amounts, duplicate/missing parent keys, cross-scope rows, and mismatched totals are refused. The export producer must declare every applicable tender, return, credit, payout and other financial relationship; this generic validator cannot infer omitted rules.
- `control_totals.collection_counts`: exact row count for each collection
- `control_totals.measures`: source-computed decimal sum controls. Each item has a unique `name`, `collection`, `field`, `scale` (0–6), `rows`, and exact decimal-string `total`. The verifier recomputes each sum with integer arithmetic; it never parses money through floating point.

The collections preserve the source export's catalogue/UOM, sales/tenders/returns/voids, stock and stocktakes/transfers, customers/credit/vouchers, tabs, cash-ups, tips/payouts, expenses/journal, audit and pending-operation rows as opaque source records. The source exporter must include the necessary historical IDs and relationships; this validator does not infer missing history or fabricate opening balances.

The `businesses` collection must contain exactly one row whose `source_id` equals `source.business_id`. The `outlets` collection must contain exactly the declared outlet identity set, once each. A non-empty `pending_operations` collection is refused unless every row carries `resolution_status: "resolved"` and a non-empty `resolution_receipt_id`; an unresolved or ambiguous cloud operation cannot silently enter a transition rehearsal.

The relationship rules are validated as declared. An export generator or reviewer must still prove that the rule list covers every foreign-key relationship in its source schema; this validator cannot discover omitted relationships from opaque row payloads. Relationship summaries appear in the dry-run receipt with linked and nullable row counts.

## Run

```text
node services/bar-local/scripts/dry-run-transition-import.mjs <synthetic-export.json> <new-receipt.json>
```

The output path must not already exist. The receipt includes a canonical SHA-256 of the full input, the recomputed collection/control totals, rejected row reasons, and explicit `import_performed: false` / `database_contacted: false` fields. A refused input still produces a refusal receipt. Preserve the original input and receipt together; a changed export has a different hash and requires a new receipt.

This version is only a deterministic envelope, scope, business/outlet inventory, identity, count, explicitly declared relationship and parent-child decimal checks, pending-operation resolution marker and declared-measure validator. It does **not** yet validate source-specific foreign-key completeness, complete ledger balancing, accounting-period closure, vouchers/credit custody, queue semantics, whether all receipt-to-tender controls were declared, target-schema compatibility, or produce target import commands. `accepted_for_rehearsal` means only that these declared envelope checks passed; it is not an import or cutover approval. Do not use customer exports with this prototype or activate a local authority from its result.

## Synthetic regression

`node --test services/bar-local/tests/dry-run-transition-import.test.mjs` covers deterministic hashes, exact decimal collection and parent-child reconciliation, malformed control definitions, incomplete/undated snapshots, duplicate IDs/outlets, missing business ownership, missing/foreign outlet scope for operational rows, incorrect controls, missing business/outlet inventory, missing collections, unresolved pending-operation refusal, valid links, nullable versus required links, dangling references and cross-outlet refusal. The required next implementation is a source-specific, read-only exporter plus a complete fixed relationship/financial-control contract, followed by a separate idempotent target importer and audited activation gate.

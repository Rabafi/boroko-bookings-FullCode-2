# Original Stock integration — 4 November 2026

`/hpos/stock` now mounts the original HposStock page through a local-only compatibility adapter. Receiving and complete counts submit one atomic `stock.batch.record`; counts carry each baseline version. Stock metadata uses `catalogue.stock_item.save`, preserving financial and stock state. Waste approval binds the manager proof to the same operation ID; the PIN is not journaled. Unknown outcomes fence subsequent actions and offer original-ID replay. Local label printing remains disabled pending equipment integration.

Migration 0083 adds those commands and scoped history/aging queries. Batch movements use the existing ledger/lot event reasons. A stale line rolls back the whole batch; zero-variance counts retain audit evidence. Opening stock is recorded once under the original operation. These SQL claims describe source intent and have not yet been database-verified.

Verification completed:

- Menu/Stock adapters and route tests: 18/18.
- Original Menu and original Stock rendered Chromium checks: 2/2, including pack/sold-out hydration, unknown-count same-ID recovery and manager-PIN waste. The bridge is mocked; these are not Electron IPC or real service acceptance.
- Main and renderer typechecks, service build and selected contract parity checks passed after Stock integration.
- Initial Till adapter recovery/receipt/tax/modifier checks: 6/6. Original Till remains unwired and under development.

The guarded disposable PostgreSQL attempt initialized its own nonce cluster, but `pg_ctl start` failed with Windows restricted-token error 87. No service/bootstrap/test ran. The runner now has a narrowly matched Windows fallback that starts only its own nonce cluster directly and checks exact data-directory/port identity. Syntax passed; that fallback is unexecuted because subsequent runs failed the mandatory 4 GiB reserve. No customer database was opened. Migrations 0082/0083 and their database tests remain unverified. Never bypass the reserve or run acceptance against Rabafi.

Later verification supersedes that blocked attempt: after reserve recovered, the fallback successfully started its identity-checked disposable cluster and applied all 83 migrations. Real tests found that older dispatch wrappers intercepted the enhanced stock/menu query, and that fresh result envelopes included receipt metadata absent from saved results. Migration 0083 now routes those two queries to the enhanced handler; new commands return the stable result separately from their enriched receipt. SQL tests also now use the actual `packs` command contract and expect payload conflicts to raise the established database exception. Final run **6/6 passed**, service build passed, cluster cleanly stopped, successful disposable data retired by the guarded runner, logs retained at `.tmp/bar-isolated-tests/2026-11-04T21-47-24-576Z-2d12960f`. Coverage includes shared-pack sale depletion, link edit retention, one-time opening stock, replay, scope/capability denial, stock metadata preservation, whole-batch stale-count rollback, zero-variance audit and lot balances. Actual Electron/main/preload/service acceptance remains open.

Manual impact is required for the original Stock UI and recovery guidance. PDFs, screenshots and packaged approved-guide checks remain pending and non-blocking by explicit user instruction. Physical multi-PC and Supabase work remain excluded. No running app/profile was reset, no hosted activation occurred, and no push was attempted.

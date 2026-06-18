# Legacy POS Verification And Fix Handoff

Date: 2026-06-13

Scope: verification of the latest legacy Windows POS offline-first work, compared against the finished desktop POS and Boroko's financial-grade rules.

## Verification Result

Verified commands:

- `npm test` from `legacy-pos`: 175 passed, 0 failed.
- `npm run build` from `legacy-pos`: production Electron/Vite build completed successfully.

Verified as implemented:

- Legacy `pos:partial-return` calls/queues `create_pos_partial_return_with_pin`.
- Migration `supabase/migrations/20260613020000_legacy_pos_return_and_shift_rpcs.sql` adds `pos_override_log.return_order_id`, `pos_override_log.return_total`, and `pos_return_lines`.
- The new return RPC stores negative refund payment amounts and both legacy/desktop cash-up summarizers apply the order sign to payment rows.
- Desktop online partial returns now call `create_pos_partial_return_with_pin`.
- Legacy open/close shift handlers use stable-ID RPCs: `open_pos_shift_with_id` and `close_pos_shift_with_id`.
- Legacy offline close shift now patches the existing cached row instead of always adding a duplicate row.
- Legacy inventory select now includes desktop inventory fields: `category`, `reorder_level`, `lodge_id`, and `created_at`.
- `pos:get-inventory-diagnostics` exists and is exposed through preload.
- Bootstrap settings now uses `.maybeSingle()` and returns `settingsData`.
- `App.jsx` derives the lodge label from `settings?.lodge_name || settings?.company_name || user?.lodge_name`.
- Full-screen IPC now targets `BrowserWindow.fromWebContents(event.sender)` and the renderer initializes full-screen state on mount.

Important caveat:

- The 175 tests are still mostly structural/text checks. They did not catch the SQL migration-order issue, the multi-line return ledger bug, or the desktop offline return queue mismatch below. Passing tests and build do not yet mean this is financially release-safe.

## Remaining P0 Fixes

### P0-1: Shift idempotency migration order can fail on a fresh database

Evidence:

- The migration creates these indexes near the top:
  - `idx_pos_shifts_create_idempotency_key`
  - `idx_pos_shifts_close_idempotency_key`
- But it adds `pos_shifts.create_idempotency_key` and `pos_shifts.close_idempotency_key` near the bottom, after the index statements.
- Existing `pos_shifts` definitions in earlier migrations do not include those two columns.

Risk:

- On a database that does not already have these columns, the migration can fail before the new RPCs are installed.

Implementation plan:

1. Move this block before the shift idempotency indexes and before any function body that references the new columns:
   - `alter table public.pos_shifts add column if not exists create_idempotency_key text, add column if not exists close_idempotency_key text;`
2. Keep the unique partial indexes after the columns exist.
3. Add a regression test that checks `add column if not exists create_idempotency_key` appears before `idx_pos_shifts_create_idempotency_key`.
4. Re-run migration against a clean local/reset database if possible, not only the text tests.

### P0-2: Multi-line partial returns write the ledger against the wrong original line

Evidence:

- The RPC builds `v_return_items` in one loop.
- It writes `pos_return_lines` in a second loop.
- The second loop inserts `original_order_item_id = v_line_id`, but `v_line_id` is not updated inside that second loop.
- Result: on a multi-line return, all ledger inserts can use the last original line ID from the first loop.

Risk:

- Over-return protection can become wrong for multi-line returns.
- Only one ledger row may be written because the unique key sees repeated `(lodge_id, return_order_id, original_order_item_id)`.
- Future returns can be blocked incorrectly or allowed incorrectly.

Implementation plan:

1. Include the original line ID in each built return item:
   - `original_order_item_id`
   - optionally `original_order_id`
2. In the second loop, insert ledger rows using `nullif(v_line->>'original_order_item_id', '')::uuid`, not the outer `v_line_id` variable.
3. Use the actual `v_return_qty` stored on that return item for the ledger quantity.
4. Add a test/migration smoke check for a two-line partial return:
   - original line A quantity 2, line B quantity 3
   - return A quantity 1 and B quantity 2
   - ledger must contain exactly two rows with the correct original line IDs and quantities.
5. Consider rejecting requested quantity above remaining instead of silently clamping, so the cashier sees a clear message.

### P0-3: Desktop offline partial return still queues `create_pos_order`

Evidence:

- Desktop online path now calls `state.supabase.rpc('create_pos_partial_return_with_pin', { payload: rpcPayload })`.
- But desktop network-error/offline fallback calls `createPosOrder(...)`.
- `createPosOrder` queues `create_pos_order`, not `create_pos_partial_return_with_pin`.

Risk:

- This violates Boroko's rule: offline sync must replay the exact same RPC call as the online path.
- Desktop offline returns can bypass the database return ledger, database PIN validation, and return-specific idempotency.
- Legacy and desktop paths can diverge again.

Implementation plan:

1. Add a desktop helper equivalent to the legacy queue path:
   - queue `type: 'rpc'`
   - table/function: `create_pos_partial_return_with_pin`
   - data: `{ payload: rpcPayload }`
   - stable queue ID: `pos-return-${returnId}`
   - dependency on pending parent order when needed.
2. Keep the local return order/cache patch for offline UX, but mark it `_pending_sync: true`.
3. Patch success/failure handling in desktop sync:
   - add `create_pos_partial_return_with_pin` to `FINANCIAL_SYNC_TABLES`.
   - on success, mark local return order and override history synced.
   - on failure, mark return order/history as failed or manual review.
4. Do not call `createPosOrder` as the fallback for partial returns.
5. Add tests that fail if `createPosPartialReturnWithPin` queues or calls `create_pos_order` in any offline/network-error path.

## Remaining P1 Fixes

### P1-1: Bar outlet inventory visibility is still not fully proven

Current state:

- Backend inventory loading is improved and now has diagnostics.
- However, the legacy Terminal still sells `pos_menu_items`, not raw `inventory_items`.
- `MenuManagement.jsx` Bar Packs still lists `menuItems.filter((i) => i.inventory_item_id)`, not actual inventory rows.
- If Bar stock exists in desktop inventory but has not been linked to POS menu rows, it can still look missing in legacy POS.

Implementation plan:

1. In `MenuManagement.jsx`, load actual inventory rows with `window.api.pos.getInventory()`.
2. Filter inventory by selected/outlet Bar context, not only by existing menu items.
3. Add a "Link to Menu" or "Create POS Item" action for inventory rows that are not yet linked to `pos_menu_items`.
4. Make Bar Pack Template choose from inventory rows, not only menu rows.
5. Improve `pos:get-inventory-diagnostics`:
   - include outlet names from `outlets`
   - include actual Bar outlet ID/name count
   - include current user `allowed_outlet_ids`
   - include count of Bar inventory rows without linked POS menu items
6. Add Terminal/Menu empty states:
   - "Bar inventory is loaded but no POS menu items are linked."
   - "This staff profile is not assigned to the Bar outlet."
7. Add behavioral tests for desktop-created Bar inventory appearing in diagnostics and being linkable in legacy POS.

### P1-2: Lodge name header is improved but login/offline bootstrap still uses the wrong response key

Current state:

- `tryRestore()` checks `result?.settingsData`.
- `handleLogin()` and `handleOfflineUnlock()` still check `r?.settings`, but bootstrap returns `settingsData` and `settings` is a boolean.

Risk:

- On some login/offline-unlock paths, the header can stay blank if the first `getSettings()` call fails or returns stale/missing data.
- The lodge name is still a small secondary span after "Boroko POS Legacy"; the operator asked for the lodge name at the top.

Implementation plan:

1. Update all App bootstrap callbacks to use `settingsData`:
   - `if (r?.settingsData) setSettings(r.settingsData);`
2. Add a fallback object from `pos:get-settings` when no settings row exists but lodge context/user profile has a lodge display name.
3. Make the lodge name the main visible header title, for example:
   - primary: lodge name
   - secondary: "Boroko POS Legacy"
4. Add rendering tests for:
   - login path with `settingsData`
   - restore path with `settingsData`
   - offline unlock path with cached/fallback settings.

### P1-3: Inventory diagnostics should be visible to operators

Current state:

- `pos:get-inventory-diagnostics` exists, but no clear UI currently exposes it in Sync/Menu/Terminal.

Implementation plan:

1. Add an "Inventory Diagnostics" section to Sync or Menu.
2. Show simple operator text:
   - inventory loaded count
   - Bar outlet inventory count
   - linked POS menu count
   - staff outlet access status
3. Include a "Refresh inventory" action that runs bootstrap/reference-data reload while online.
4. Keep raw technical errors collapsed behind a details toggle.

### P1-4: Full-screen UI polish

Current state:

- IPC is correct now.
- Header button is still text-based.

Implementation plan:

1. Use lucide `Maximize2` / `Minimize2` icons.
2. Keep accessible labels/tooltips.
3. Ensure the button does not resize the header when toggled.

## Legacy POS App Update Implementation Plan

Current state:

- Finished desktop app already has automatic update infrastructure:
  - `electron-updater`
  - GitHub publish feed
  - update IPC
  - update card/settings UI
  - release script `scripts/release.mjs`
- Legacy POS currently only exposes `pos:get-app-version`.
- Legacy POS has no updater dependency, no publish feed, no update IPC, no download/install UI, and no release script.

Goal:

- Let sites update the legacy POS as easily as the desktop app, without interrupting cashiers or risking unsynced offline sales.

Implementation plan:

1. Release feed and packaging:
   - Add `electron-updater` to `legacy-pos/package.json`.
   - Add a dedicated publish config to `legacy-pos/package.json`, preferably a separate repo such as `Rabafi/boroko-pos-legacy-releases`.
   - Keep `deleteAppDataOnUninstall: false` so local cache, trusted session, and offline queue survive updates.
   - Keep NSIS installer target for normal operator installs.
2. Main-process updater:
   - Import `autoUpdater` in `legacy-pos/src/main/index.js`.
   - Use `autoDownload = false`.
   - Use `autoInstallOnAppQuit = true`.
   - Check on startup after a delay and then periodically, but only when online.
   - Add IPC:
     - `pos:update-check`
     - `pos:update-download`
     - `pos:update-install`
     - `pos:update-get-state`
   - Add event sends:
     - `pos:update-available`
     - `pos:update-not-available`
     - `pos:update-progress`
     - `pos:update-ready`
     - `pos:update-error`
3. Offline and trading safety:
   - Never force restart.
   - Before install/restart, check:
     - pending sync queue count
     - failed/manual-review queue count
     - active/open shift
     - open tabs/orders if applicable
   - If any are present, block or strongly warn:
     - "Finish shift and sync pending sales before installing."
   - Allow download while working, but install only on operator confirmation.
4. Preload bridge:
   - Expose `window.api.pos.updates` or equivalent:
     - `check()`
     - `download()`
     - `install()`
     - `getState()`
     - event listeners for available/progress/ready/error.
5. Renderer UI:
   - Show current version in Login, Sync, or header.
   - Show update status in a small non-blocking card:
     - "Update available"
     - "Download update"
     - "Restart to install"
   - In Sync screen, include update readiness plus the safety checks above.
   - Do not interrupt Terminal workflows with modal popups.
6. Release scripts:
   - Add scripts equivalent to desktop:
     - `legacy-pos:version:patch`
     - `legacy-pos:version:minor`
     - `legacy-pos:release:publish`
   - Prefer a dedicated `legacy-pos/scripts/release.mjs` that reads `GH_TOKEN` from `.env.release`, `.env.local`, `.env`, or environment.
   - Publish release notes to GitHub so operators can see what changed.
7. Tests:
   - Package has `electron-updater` and publish config.
   - Main process registers update IPC.
   - Preload exposes update API.
   - Renderer shows current version and update states.
   - Install is blocked/warned when pending sync or active shift exists.

Acceptance checklist:

- `npm test` from `legacy-pos` passes.
- `npm run build` from `legacy-pos` passes.
- A local unsigned POS installer still builds.
- A GitHub-published POS release creates update metadata.
- Installed POS detects the next published version.
- POS can download update while online.
- POS refuses or warns before restart when queue/shift safety checks fail.
- POS installs after operator confirmation and keeps local data/queue.

## Acceptance Checklist For Release Safety

- Migration runs cleanly on a fresh/reset database.
- Shift idempotency columns exist before indexes are created.
- Multi-line partial returns write one correct ledger row per original line.
- Over-return is impossible across repeated partial returns.
- Return payment rows reduce expected cash/card totals.
- Legacy and desktop online partial returns both use `create_pos_partial_return_with_pin`.
- Legacy and desktop offline partial returns both queue `create_pos_partial_return_with_pin`.
- `create_pos_partial_return_with_pin` is classified as financial sync work in desktop sync.
- Offline open -> close shift shows one local shift row.
- Legacy menu/inventory bootstrap loads desktop-created Supabase data and preserves cache on failures.
- Bar outlet inventory is visible, diagnosable, and linkable to POS menu items.
- Header visibly shows the lodge name at the top after login, restore, and offline unlock.
- Full-screen toggles the sender window.
- Legacy POS has a safe, manual, offline-aware update flow similar to the desktop app.

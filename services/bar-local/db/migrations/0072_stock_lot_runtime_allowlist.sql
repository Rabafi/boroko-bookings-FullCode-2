-- The lot waste/release command functions were added in 0070. Register them
-- in the reviewed runtime command allowlist for existing local databases.
INSERT INTO bar_local.runtime_function_allowlist (function_name)
VALUES ('cmd_stock_lot_waste'), ('cmd_stock_lot_release')
ON CONFLICT (function_name) DO NOTHING;

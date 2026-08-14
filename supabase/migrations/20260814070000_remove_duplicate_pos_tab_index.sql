-- Remove the redundant POS table uniqueness index. The canonical
-- pos_tabs_one_active_table_per_outlet index has the identical expression and
-- predicate; keeping both adds write cost without changing correctness.
drop index if exists public.pos_tabs_one_open_table_uidx;

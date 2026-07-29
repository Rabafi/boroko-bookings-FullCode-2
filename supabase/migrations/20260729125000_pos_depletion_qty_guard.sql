-- POS catalog guard for measured pours.
-- A direct-stock product consumes a positive quantity per sale.  Keep this
-- constraint NOT VALID so an old catalog row cannot block migration application;
-- every new or updated row is still checked immediately.
alter table public.pos_menu_items
  drop constraint if exists pos_menu_items_depletion_qty_positive;

alter table public.pos_menu_items
  add constraint pos_menu_items_depletion_qty_positive
  check (depletion_qty is null or depletion_qty > 0) not valid;

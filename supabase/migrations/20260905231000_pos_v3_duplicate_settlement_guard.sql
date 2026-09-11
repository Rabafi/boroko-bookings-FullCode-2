-- Reject duplicate tab settlements in create_pos_order_v3 (P0).
--
-- A tab that already has a completed/settled POS order must not accept a new
-- settlement: that pattern is how paid-but-left-open tabs were double
-- charged. Exact idempotent replays are unaffected (the claim block returns
-- the stored result before this check). Historical duplicates are left
-- untouched for audited void/refund reconciliation -- this migration writes
-- no business rows, it only tightens the gate for new settlements.
--
-- Gated follow-up (do NOT enable yet): once duplicates are reconciled,
-- enforce one completed settlement per tab with:
--   create unique index if not exists pos_orders_one_completed_settlement_per_tab
--     on public.pos_orders (lodge_id, tab_id)
--   where tab_id is not null and status in ('completed', 'settled');
-- Creating it while duplicates exist fails the build. Never backfill,
-- delete, or rewrite existing duplicate records to satisfy it.

begin;

do $do$
declare
  v_definition text;
  v_old text := $old$  insert into public.pos_orders ($old$;
  v_new text := $new$  -- Reject a second settlement for a tab that already has a recorded
  -- payment. Exact idempotent replays never reach here (the claim above
  -- returns the stored result first). Historical duplicates from the old
  -- non-atomic flow are deliberately left untouched for audited
  -- void/refund reconciliation; only new settlements are blocked.
  if v_tab_id is not null
     and exists (
       select 1
         from public.pos_orders o
        where o.tab_id = v_tab_id
          and o.lodge_id = v_lodge_id
          and o.status in ('completed', 'settled')
     ) then
    return jsonb_build_object('success', false, 'code', 'tab_already_settled',
      'error', 'This tab already has a recorded payment. Void or refund the duplicate through the audited workflow before settling it again.');
  end if;

  insert into public.pos_orders ($new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;
  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;
  if position('pos_tab_settled' in v_definition) = 0 then
    raise exception 'Atomic tab settlement is missing; apply 20260905230000 first';
  end if;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 order-insert anchor is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

commit;

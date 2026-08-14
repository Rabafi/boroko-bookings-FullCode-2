-- Forward-only linked-schema lint repairs.
-- The linked project has the migrations through 20260814010000 applied. These
-- corrections preserve the authoritative financial contracts while repairing
-- schema drift that the remote lint pass can execute against.

begin;

-- Supabase's index advisor function expects the optional HypoPG extension.
create extension if not exists hypopg with schema extensions;

-- POS orders carried tab_id in the client/RPC envelope but the authoritative
-- order row did not persist it. Persisting the link lets split/settlement
-- guards identify completed payments without guessing from table names.
alter table public.pos_orders
  add column if not exists tab_id uuid references public.pos_tabs(id) on delete set null;

create index if not exists pos_orders_tab_status_idx
  on public.pos_orders(lodge_id, tab_id, status, created_at);

-- Add the missing approval timestamp used by the maker-checker cutover RPC.
alter table public.restaurant_historical_cutover_batches
  add column if not exists approved_at timestamptz;

-- Keep the latest create_pos_order_v3 implementation, but make its tab link
-- server-authoritative and lodge/outlet scoped.
do $do$
declare
  v_definition text;
  v_old text;
  v_new text;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;

  v_old := $old$v_event_booking_id uuid := nullif(payload->>'event_booking_id', '')::uuid;$old$;
  v_new := $new$v_event_booking_id uuid := nullif(payload->>'event_booking_id', '')::uuid;
  v_tab_id uuid := nullif(payload->>'tab_id', '')::uuid;$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 tab declaration contract is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$  if v_outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  end if;$old$;
  v_new := $new$  if v_outlet_id is not null then
    perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);
  end if;
  if v_tab_id is not null and not exists (
    select 1
      from public.pos_tabs t
     where t.id = v_tab_id
       and t.lodge_id = v_lodge_id
       and t.outlet_id is not distinct from v_outlet_id
       and t.status in ('open','running','ready','delivered')
  ) then
    return jsonb_build_object('success', false, 'error', 'The selected open tab is missing or belongs to another lodge/outlet.');
  end if;$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 tab scope contract is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$payment_breakdown, service_mode, table_name, tab_name, waiter_name,$old$;
  v_new := $new$payment_breakdown, service_mode, table_name, tab_name, tab_id, waiter_name,$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 tab insert column contract is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  v_old := $old$nullif(payload->>'table_name', ''), nullif(payload->>'tab_name', ''),
    nullif(payload->>'waiter_name', ''),$old$;
  v_new := $new$nullif(payload->>'table_name', ''), nullif(payload->>'tab_name', ''), v_tab_id,
    nullif(payload->>'waiter_name', ''),$new$;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 tab insert value contract is ambiguous or missing';
  end if;
  v_definition := replace(v_definition, v_old, v_new);

  execute v_definition;
end
$do$;

-- Split guards must use the persisted authoritative order-to-tab link.
do $do$
declare
  v_definition text;
  v_old text := $old$if exists(select 1 from public.pos_payments where tab_id=v_source.id and lodge_id=v_source.lodge_id and status='completed') then return jsonb_build_object('success',false,'error','This tab has already received payments. Void the payment before splitting.'); end if;$old$;
  v_new text := $new$if exists(select 1 from public.pos_orders o where o.tab_id=v_source.id and o.lodge_id=v_source.lodge_id and o.status in('completed','settled')) then return jsonb_build_object('success',false,'error','This tab has already received payments. Void the payment before splitting.'); end if;$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.split_pos_tab_evenly(jsonb)'::regprocedure)
    into v_definition;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'split_pos_tab_evenly payment guard contract is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

-- Repair the stale lodge parameter in the expense transition RPC.
do $do$
declare
  v_definition text;
  v_old text := $old$lodge_id=p_lodge for update$old$;
  v_new text := $new$lodge_id=p_lodge_id for update$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.submit_expense(uuid,uuid,uuid,jsonb)'::regprocedure)
    into v_definition;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'submit_expense lodge predicate contract is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

-- Partial base-return uniqueness must be named in the ON CONFLICT target.
do $do$
declare
  v_definition text;
  v_old text := $old$on conflict (lodge_id, period_start, period_end) do update set$old$;
  v_new text := $new$on conflict (lodge_id, period_start, period_end) where amendment_of is null do update set$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.generate_tax_return(uuid,date,date,numeric)'::regprocedure)
    into v_definition;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'generate_tax_return conflict target contract is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

-- Avoid PL/pgSQL variable/column ambiguity when reading customer credit.
do $do$
declare
  v_definition text;
  v_old text := $old$select credit_limit into credit_limit from public.restaurant_customers where id=customer and lodge_id=p_lodge;$old$;
  v_new text := $new$select c.credit_limit into credit_limit from public.restaurant_customers c where c.id=customer and c.lodge_id=p_lodge;$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public._restaurant_post_pos_order_to_gl_v2(uuid,uuid)'::regprocedure)
    into v_definition;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception '_restaurant_post_pos_order_to_gl_v2 credit predicate contract is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

-- Reconciliation exceptions are timestamped by created_at, not occurred_at.
do $do$
declare
  v_definition text;
  v_old text := $old$occurred_at::date between p_period_start and p_period_end or occurred_at is null$old$;
  v_new text := $new$created_at::date between p_period_start and p_period_end or created_at is null$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.prepare_restaurant_period_close(uuid,date,date,text)'::regprocedure)
    into v_definition;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'prepare_restaurant_period_close exception timestamp contract is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

-- restaurant_bank_transactions already has previous_balance; do not expose
-- a second column with the same name through t.* plus lag(...).
do $do$
declare
  v_definition text;
  v_old text := $old$from (select t.*,lag(t.balance_after) over(order by t.transaction_date,t.id) previous_balance from public.restaurant_bank_transactions t where t.statement_import_id=v_r.statement_import_id and t.lodge_id=p_lodge_id) q$old$;
  v_new text := $new$from (select t.id,t.debit,t.credit,t.balance_after,lag(t.balance_after) over(order by t.transaction_date,t.id) as previous_balance from public.restaurant_bank_transactions t where t.statement_import_id=v_r.statement_import_id and t.lodge_id=p_lodge_id) q$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.complete_bank_reconciliation_v2(uuid,uuid,text)'::regprocedure)
    into v_definition;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'complete_bank_reconciliation_v2 sequence query contract is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

-- jsonb_object_length is not available on the linked PostgreSQL build; count
-- the actual month keys instead.
do $do$
declare
  v_definition text;
  v_old text := $old$jsonb_object_length(coalesce(row_data->'months', '{}'::jsonb))$old$;
  v_new text := $new$(select count(*) from jsonb_object_keys(coalesce(row_data->'months', '{}'::jsonb)))$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.get_restaurant_budget_export_v2(uuid,integer)'::regprocedure)
    into v_definition;
  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'get_restaurant_budget_export_v2 month-count contract is ambiguous or missing';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$do$;

commit;

-- A bill split changes several open tabs. It must be committed as one server
-- transaction, not as a sequence of client-side upserts that can half succeed.

create table if not exists public.pos_tab_split_operations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  source_tab_id uuid not null references public.pos_tabs(id) on delete restrict,
  idempotency_key uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  unique (lodge_id, idempotency_key)
);

alter table public.pos_tab_split_operations enable row level security;
drop policy if exists pos_tab_split_operations_lodge_scope_select on public.pos_tab_split_operations;
create policy pos_tab_split_operations_lodge_scope_select
  on public.pos_tab_split_operations for select
  using (public.app_lodge_access(lodge_id));

create or replace function public.split_pos_tab_evenly(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_source_id uuid := nullif(payload->>'source_tab_id', '')::uuid;
  v_split_count integer := coalesce(nullif(payload->>'split_count', '')::integer, 0);
  v_idempotency_key uuid := nullif(payload->>'idempotency_key', '')::uuid;
  v_source public.pos_tabs%rowtype;
  v_existing_response jsonb;
  v_names jsonb := coalesce(payload->'target_table_names', '[]'::jsonb);
  v_total numeric := 0;
  v_base_share numeric := 0;
  v_remainder numeric := 0;
  v_share numeric := 0;
  v_target_name text;
  v_target public.pos_tabs%rowtype;
  v_new_tabs jsonb := '[]'::jsonb;
  v_new_tab public.pos_tabs%rowtype;
  v_i integer;
  v_line jsonb;
  v_response jsonb;
begin
  if v_source_id is null or v_idempotency_key is null then
    return jsonb_build_object('success', false, 'error', 'Source tab and operation key are required.');
  end if;
  if v_split_count < 2 or v_split_count > 10 then
    return jsonb_build_object('success', false, 'error', 'Split count must be between 2 and 10.');
  end if;

  select response into v_existing_response
    from public.pos_tab_split_operations
   where idempotency_key = v_idempotency_key
   limit 1;
  if v_existing_response is not null then return v_existing_response; end if;

  select * into v_source from public.pos_tabs where id = v_source_id for update;
  if v_source.id is null then return jsonb_build_object('success', false, 'error', 'Source tab not found.'); end if;
  perform public.app_require_lodge_role(v_source.lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_source.lodge_id, v_source.outlet_id);
  if v_source.status not in ('open', 'running', 'ready', 'delivered') then
    return jsonb_build_object('success', false, 'error', 'Only an open tab can be split.');
  end if;

  if exists (
    select 1 from public.pos_payments
     where tab_id = v_source.id
       and lodge_id = v_source.lodge_id
       and status = 'completed'
  ) then
    return jsonb_build_object('success', false, 'error', 'This tab has already received payments. Void the payment before splitting.');
  end if;

  select coalesce(sum(coalesce((value->>'quantity')::numeric, 0) * coalesce((value->>'unit_price')::numeric, 0)), 0)
    into v_total from jsonb_array_elements(coalesce(v_source.items, '[]'::jsonb));
  if v_total <= 0 then return jsonb_build_object('success', false, 'error', 'No billable items to split.'); end if;
  v_base_share := trunc((v_total / v_split_count)::numeric, 2);
  v_remainder := round(v_total - (v_base_share * v_split_count), 2);

  for v_i in 0..v_split_count - 1 loop
    v_share := case when v_i = v_split_count - 1 then v_base_share + v_remainder else v_base_share end;
    v_target_name := nullif(btrim(coalesce(v_names->>v_i, '')), '');
    v_line := jsonb_build_array(jsonb_build_object(
      'item_name', format('Bill split %s/%s', v_i + 1, v_split_count),
      'quantity', 1, 'unit_price', v_share, 'category', 'split_adjustment'
    ));
    if v_target_name is not null then
      select * into v_target from public.pos_tabs
       where lodge_id = v_source.lodge_id
         and coalesce(outlet_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_source.outlet_id, '00000000-0000-0000-0000-000000000000'::uuid)
         and lower(btrim(table_name)) = lower(v_target_name)
         and status in ('open', 'running', 'ready', 'delivered')
       for update;
    else
      v_target.id := null;
    end if;
    if v_target.id is not null then
      update public.pos_tabs set
        items = coalesce(items, '[]'::jsonb) || v_line,
        notes = concat_ws(E'\n', notes, format('Even split %s/%s from %s', v_i + 1, v_split_count, coalesce(v_source.table_name, v_source.tab_name, 'source tab'))),
        updated_at = now()
      where id = v_target.id returning * into v_new_tab;
    else
      insert into public.pos_tabs (lodge_id, outlet_id, table_name, tab_name, customer_name, waiter_name, items, notes, status, opened_by, opened_by_name)
      values (v_source.lodge_id, v_source.outlet_id, v_target_name,
        coalesce(v_target_name, coalesce(v_source.table_name, v_source.tab_name, 'Tab') || format(' (split %s of %s)', v_i + 1, v_split_count)),
        v_source.customer_name, v_source.waiter_name, v_line,
        format('Even split %s/%s from %s', v_i + 1, v_split_count, coalesce(v_source.table_name, v_source.tab_name, 'source tab')),
        case when v_target_name is null then 'open' else 'running' end, v_source.opened_by, v_source.opened_by_name)
      returning * into v_new_tab;
    end if;
    v_new_tabs := v_new_tabs || jsonb_build_array(to_jsonb(v_new_tab));
  end loop;

  update public.pos_tabs set items = '[]'::jsonb,
    notes = concat_ws(E'\n', notes, format('Split evenly %s ways', v_split_count)),
    status = 'closed', closed_at = now(), updated_at = now()
  where id = v_source.id returning * into v_source;
  v_response := jsonb_build_object('success', true, 'source_tab', to_jsonb(v_source), 'new_tabs', v_new_tabs);
  insert into public.pos_tab_split_operations (lodge_id, source_tab_id, idempotency_key, response)
  values (v_source.lodge_id, v_source.id, v_idempotency_key, v_response);
  insert into public.pos_audit_log (lodge_id, outlet_id, actor_id, action, entity_type, entity_id, before_snapshot, after_snapshot, idempotency_key)
  values (v_source.lodge_id, v_source.outlet_id, auth.uid(), 'pos_bill_split_evenly', 'pos_tab', v_source.id,
    jsonb_build_object(
      'split_count', v_split_count,
      'total_amount', v_total,
      'source_items', v_source.items,
      'source_status', v_source.status,
      'source_table_name', v_source.table_name,
      'source_tab_name', v_source.tab_name,
      'source_waiter_name', v_source.waiter_name
    ), v_response, v_idempotency_key::text);
  return v_response;
end;
$$;

revoke all on function public.split_pos_tab_evenly(jsonb) from public;
grant execute on function public.split_pos_tab_evenly(jsonb) to authenticated, service_role;

-- Village-bar cash model: cash containers, drawer periods, movements, blind counts.
--
-- One shared drawer gets one reconciliation; per-operator sales attribution is
-- untouched. Money moves only through movements (drawer<->safe/pouch/outside);
-- counts (opening, handover, closing) are observations and never change a
-- balance. Expectations are always derived server-side from tenders, float,
-- retained tips and movements — never accepted from the operator. This file
-- does not touch the retired drawer-close contract and does not alter any
-- existing personal shift cash-up behavior; existing outlets keep
-- cash_model = 'personal_bank' until a manager deliberately switches them.
begin;

alter table public.outlets
  add column if not exists cash_model text not null default 'personal_bank'
  check (cash_model in ('shared_drawer', 'personal_bank'));

create table if not exists public.pos_cash_containers (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  kind text not null check (kind in ('drawer', 'pouch')),
  outlet_id uuid null references public.outlets(id),
  operator_id uuid null references public.users(id),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((kind = 'drawer' and outlet_id is not null and operator_id is null)
      or (kind = 'pouch' and operator_id is not null and outlet_id is null))
);
create unique index if not exists pos_cash_containers_drawer_uniq
  on public.pos_cash_containers (lodge_id, outlet_id) where kind = 'drawer' and is_active;
create unique index if not exists pos_cash_containers_pouch_uniq
  on public.pos_cash_containers (lodge_id, operator_id) where kind = 'pouch' and is_active;

create table if not exists public.pos_cash_periods (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  container_id uuid not null references public.pos_cash_containers(id),
  outlet_id uuid not null references public.outlets(id),
  business_date date not null,
  status text not null default 'open' check (status in ('open', 'submitted', 'approved', 'rejected')),
  opening_float numeric not null default 0 check (opening_float >= 0),
  opened_by uuid null references public.users(id),
  opened_at timestamptz not null default now(),
  submitted_by uuid null references public.users(id),
  submitted_at timestamptz null,
  counted_cash numeric null check (counted_cash is null or counted_cash >= 0),
  submit_notes text null,
  submit_idempotency_key text null check (submit_idempotency_key is null or (char_length(submit_idempotency_key) between 8 and 128)),
  open_idempotency_key text null check (open_idempotency_key is null or (char_length(open_idempotency_key) between 8 and 128)),
  reviewed_by uuid null references public.users(id),
  reviewed_at timestamptz null,
  review_notes text null,
  expected_cash_drawer numeric null,
  created_at timestamptz not null default now()
);
create unique index if not exists pos_cash_periods_one_live_per_container
  on public.pos_cash_periods (container_id) where status in ('open', 'submitted', 'rejected');
create unique index if not exists pos_cash_periods_submit_key_uniq
  on public.pos_cash_periods (lodge_id, submit_idempotency_key) where submit_idempotency_key is not null;
create unique index if not exists pos_cash_periods_open_key_uniq
  on public.pos_cash_periods (lodge_id, open_idempotency_key) where open_idempotency_key is not null;
create index if not exists pos_cash_periods_outlet_idx
  on public.pos_cash_periods (lodge_id, outlet_id, business_date);

create table if not exists public.pos_cash_movements (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  period_id uuid not null references public.pos_cash_periods(id),
  from_container_id uuid null references public.pos_cash_containers(id),
  to_container_id uuid null references public.pos_cash_containers(id),
  movement_type text not null check (movement_type in ('drop_to_safe', 'paid_out', 'float_topup', 'pouch_to_drawer', 'drawer_to_pouch')),
  amount numeric not null check (amount > 0),
  operator_id uuid null references public.users(id),
  actor_id uuid null references public.users(id),
  notes text null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  device_id text not null default 'shared-terminal',
  created_at timestamptz not null default now(),
  check (from_container_id is not null or to_container_id is not null)
);
create unique index if not exists pos_cash_movements_key_uniq
  on public.pos_cash_movements (lodge_id, idempotency_key);
create index if not exists pos_cash_movements_period_idx
  on public.pos_cash_movements (period_id, movement_type);

create table if not exists public.pos_cash_counts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  container_id uuid not null references public.pos_cash_containers(id),
  period_id uuid not null references public.pos_cash_periods(id),
  count_type text not null check (count_type in ('opening', 'handover', 'closing')),
  counted_cash numeric not null check (counted_cash >= 0),
  operator_id uuid null references public.users(id),
  actor_id uuid null references public.users(id),
  notes text null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  device_id text not null default 'shared-terminal',
  created_at timestamptz not null default now()
);
create unique index if not exists pos_cash_counts_key_uniq
  on public.pos_cash_counts (lodge_id, idempotency_key);
create index if not exists pos_cash_counts_period_idx
  on public.pos_cash_counts (period_id, count_type);

alter table public.pos_cash_containers enable row level security;
alter table public.pos_cash_periods enable row level security;
alter table public.pos_cash_movements enable row level security;
alter table public.pos_cash_counts enable row level security;

-- Internal expected-drawer math for one drawer period. Same tender source as
-- the shift preview (payment_breakdown lateral aggregate), scoped to the
-- outlet and the period window instead of one shift. Movements adjust the
-- drawer; handover/closing counts never do.
create or replace function public.pos_drawer_period_expected(p_lodge_id uuid, p_period_id uuid, p_as_of timestamptz)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_period record; v_by_method jsonb := '{}'::jsonb; v_cash numeric := 0;
  v_tips numeric := 0; v_drops numeric := 0; v_paid numeric := 0; v_floats numeric := 0;
  v_in numeric := 0; v_out numeric := 0; v_expected numeric := 0;
begin
  select * into v_period from public.pos_cash_periods where id = p_period_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Drawer period not found.'); end if;
  select coalesce(jsonb_object_agg(t.method, t.amount), '{}'::jsonb) into v_by_method
  from (
    select method, round(sum(amount), 2) as amount from (
      select lower(coalesce(p.value->>'method', o.payment_method, 'cash')) as method,
        coalesce((p.value->>'amount')::numeric, o.total, 0) as amount
      from public.pos_orders o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown) = 'array' and jsonb_array_length(o.payment_breakdown) > 0 then o.payment_breakdown else jsonb_build_array(jsonb_build_object('method', coalesce(o.payment_method, 'cash'), 'amount', o.total)) end) p(value)
      where o.lodge_id = p_lodge_id and o.outlet_id = v_period.outlet_id
        and o.created_at >= v_period.opened_at and o.created_at < p_as_of
        and o.status in ('completed', 'settled')
    ) x group by method
  ) t;
  v_cash := coalesce((v_by_method->>'cash')::numeric, 0);
  select coalesce(sum(cash_tip_retained), 0) into v_tips from public.pos_orders
   where lodge_id = p_lodge_id and outlet_id = v_period.outlet_id
     and created_at >= v_period.opened_at and created_at < p_as_of and status in ('completed', 'settled');
  select coalesce(sum(amount) filter (where movement_type = 'drop_to_safe'), 0),
         coalesce(sum(amount) filter (where movement_type = 'paid_out'), 0),
         coalesce(sum(amount) filter (where movement_type = 'float_topup'), 0),
         coalesce(sum(amount) filter (where movement_type = 'pouch_to_drawer'), 0),
         coalesce(sum(amount) filter (where movement_type = 'drawer_to_pouch'), 0)
    into v_drops, v_paid, v_floats, v_in, v_out
    from public.pos_cash_movements where lodge_id = p_lodge_id and period_id = p_period_id;
  v_expected := round(coalesce(v_period.opening_float, 0) + v_cash - v_tips - v_drops - v_paid + v_floats + v_in - v_out, 2);
  return jsonb_build_object('success', true, 'opening_float', v_period.opening_float,
    'cash_tenders', round(v_cash, 2), 'cash_tips_retained', round(v_tips, 2),
    'drops', round(v_drops, 2), 'paid_outs', round(v_paid, 2), 'float_topups', round(v_floats, 2),
    'pouch_in', round(v_in, 2), 'pouch_out', round(v_out, 2),
    'expected_by_method', v_by_method, 'expected_cash_drawer', v_expected);
end;
$$;
revoke all on function public.pos_drawer_period_expected(uuid, uuid, timestamptz) from public;

-- Resolve (or create) the active drawer container for an outlet.
create or replace function public.resolve_drawer_container(p_lodge_id uuid, p_outlet_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  select id into v_id from public.pos_cash_containers
   where lodge_id = p_lodge_id and kind = 'drawer' and outlet_id = p_outlet_id and is_active for update;
  if found then return v_id; end if;
  insert into public.pos_cash_containers (lodge_id, kind, outlet_id)
  values (p_lodge_id, 'drawer', p_outlet_id) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.resolve_drawer_container(uuid, uuid) from public;

-- Resolve (or create) the active pouch container for an operator.
create or replace function public.resolve_pouch_container(p_lodge_id uuid, p_operator_id uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  select id into v_id from public.pos_cash_containers
   where lodge_id = p_lodge_id and kind = 'pouch' and operator_id = p_operator_id and is_active for update;
  if found then return v_id; end if;
  insert into public.pos_cash_containers (lodge_id, kind, operator_id)
  values (p_lodge_id, 'pouch', p_operator_id) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.resolve_pouch_container(uuid, uuid) from public;

-- Open a drawer period, counting the starting change exactly once.
create or replace function public.open_pos_drawer_period(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_float numeric; v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_actor uuid := public.app_current_user_id();
  v_container uuid; v_period uuid; v_day date; v_float_check numeric;
begin
  if v_lodge_id is null or v_outlet_id is null then
    return jsonb_build_object('success', false, 'error', 'A business and outlet are required to open the drawer.');
  end if;
  begin v_float := round((payload->>'opening_float')::numeric, 2);
  exception when others then return jsonb_build_object('success', false, 'error', 'Count the starting change and enter it before opening the drawer (0.00 starts empty).'); end;
  if v_float is null or v_float < 0 then
    return jsonb_build_object('success', false, 'error', 'Count the starting change and enter it before opening the drawer (0.00 starts empty).');
  end if;
  if v_key is null or length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'Opening the drawer needs a valid retry key. Close and reopen this screen, then try again.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin']);
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your session could not be confirmed. Sign in again.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_outlet_id::text, 0));
  v_container := public.resolve_drawer_container(v_lodge_id, v_outlet_id);
  -- Exact retry after a lost response replays instead of failing: the opening
  -- count row carries the key, so a matching key with the same float is proof
  -- the open already happened.
  select p.id into v_period from public.pos_cash_periods p
   join public.pos_cash_counts c on c.period_id = p.id and c.count_type = 'opening'
   where p.lodge_id = v_lodge_id and p.container_id = v_container
     and c.idempotency_key = v_key || ':opening' for update;
  if found then
    select opening_float into v_float_check from public.pos_cash_periods where id = v_period;
    if v_float_check is distinct from v_float then
      return jsonb_build_object('success', false, 'error', 'This retry key was already used to open the drawer with a different starting float.', 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('success', true, 'period_id', v_period, 'container_id', v_container, 'replayed', true);
  end if;
  select id into v_period from public.pos_cash_periods
   where container_id = v_container and status in ('open', 'submitted', 'rejected') for update;
  if found then
    return jsonb_build_object('success', false, 'error', 'This drawer already has an open counting period. Close it before opening a new one.');
  end if;
  v_day := public.get_lodge_business_date(v_lodge_id);
  insert into public.pos_cash_periods (lodge_id, container_id, outlet_id, business_date, opening_float, opened_by, open_idempotency_key)
  values (v_lodge_id, v_container, v_outlet_id, v_day, v_float, v_actor, v_key) returning id into v_period;
  insert into public.pos_cash_counts (lodge_id, container_id, period_id, count_type, counted_cash, operator_id, actor_id, notes, idempotency_key, device_id)
  values (v_lodge_id, v_container, v_period, 'opening', v_float, v_actor, v_actor, v_notes, v_key || ':opening', coalesce(nullif(btrim(coalesce(payload->>'device_id', '')), ''), 'shared-terminal'));
  return jsonb_build_object('success', true, 'period_id', v_period, 'container_id', v_container, 'business_date', v_day, 'opening_float', v_float);
end;
$$;
revoke all on function public.open_pos_drawer_period(jsonb) from public;
grant execute on function public.open_pos_drawer_period(jsonb) to anon, authenticated, service_role;

-- Record one cash movement. Directions are enforced per type; a handover
-- count is not a movement and is refused here — record it as a count.
create or replace function public.record_pos_cash_movement(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_type text := lower(nullif(btrim(coalesce(payload->>'movement_type', '')), ''));
  v_amount numeric; v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_operator uuid := nullif(payload->>'operator_id', '')::uuid;
  v_pin text := payload->>'pin';
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_device text := coalesce(nullif(btrim(coalesce(payload->>'device_id', '')), ''), 'shared-terminal');
  v_actor uuid := public.app_current_user_id();
  v_from uuid; v_to uuid; v_period uuid; v_existing record; v_row record; v_check_outlet uuid;
begin
  if v_lodge_id is null or v_outlet_id is null or v_type is null or v_key is null then
    return jsonb_build_object('success', false, 'error', 'A business, outlet, movement kind and retry key are required.');
  end if;
  if v_type not in ('drop_to_safe', 'paid_out', 'float_topup', 'pouch_to_drawer', 'drawer_to_pouch') then
    return jsonb_build_object('success', false, 'error', 'Choose drop to safe, paid-out, float top-up or a pouch transfer.');
  end if;
  begin v_amount := round((payload->>'amount')::numeric, 2);
  exception when others then return jsonb_build_object('success', false, 'error', 'Enter the amount of cash moved.'); end;
  if v_amount is null or v_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Enter the amount of cash moved.');
  end if;
  if v_type = 'paid_out' and v_notes is null then
    return jsonb_build_object('success', false, 'error', 'Say what the paid-out cash was for.');
  end if;
  if length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'This movement needs a valid retry key. Close and reopen this screen, then try again.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your session could not be confirmed. Sign in again.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_key, 0));
  select * into v_existing from public.pos_cash_movements where lodge_id = v_lodge_id and idempotency_key = v_key for update;
  if found then
    select p.outlet_id into v_check_outlet from public.pos_cash_periods p where p.id = v_existing.period_id;
    if v_existing.movement_type is distinct from v_type
       or v_existing.amount is distinct from v_amount
       or coalesce(v_existing.notes, '') is distinct from coalesce(v_notes, '')
       or coalesce(v_check_outlet, '00000000-0000-0000-0000-000000000000'::uuid) is distinct from v_outlet_id then
      return jsonb_build_object('success', false, 'error', 'This retry key was already used for a different cash movement.', 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('success', true, 'movement_id', v_existing.id, 'replayed', true);
  end if;
  -- Operator proof: moving another person's money needs their PIN.
  if v_operator is not null and v_operator is distinct from v_actor then
    if not public._restaurant_validate_attendance_pin(v_lodge_id, v_operator, coalesce(v_pin, ''), v_device) then
      return jsonb_build_object('success', false, 'error', 'Incorrect staff PIN.');
    end if;
  end if;
  v_operator := coalesce(v_operator, v_actor);
  if v_type = 'drop_to_safe' then
    v_from := public.resolve_drawer_container(v_lodge_id, v_outlet_id); v_to := null;
  elsif v_type = 'paid_out' then
    v_from := public.resolve_drawer_container(v_lodge_id, v_outlet_id); v_to := null;
  elsif v_type = 'float_topup' then
    v_from := null; v_to := public.resolve_drawer_container(v_lodge_id, v_outlet_id);
  elsif v_type = 'pouch_to_drawer' then
    v_from := public.resolve_pouch_container(v_lodge_id, v_operator); v_to := public.resolve_drawer_container(v_lodge_id, v_outlet_id);
  else
    v_from := public.resolve_drawer_container(v_lodge_id, v_outlet_id); v_to := public.resolve_pouch_container(v_lodge_id, v_operator);
  end if;
  select id into v_period from public.pos_cash_periods
   where container_id = coalesce(v_to, v_from) and status = 'open' for update;
  if not found then
    -- Movements attach to the receiving side's open period; a pouch-only
    -- movement without any open drawer period has nowhere to reconcile.
    if v_to is not null then
      select id into v_period from public.pos_cash_periods where container_id = v_to and status = 'open' for update;
    else
      select id into v_period from public.pos_cash_periods where container_id = v_from and status = 'open' for update;
    end if;
  end if;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Open the drawer period first — count the starting change, then record movements.');
  end if;
  insert into public.pos_cash_movements (lodge_id, period_id, from_container_id, to_container_id, movement_type, amount, operator_id, actor_id, notes, idempotency_key, device_id)
  values (v_lodge_id, v_period, v_from, v_to, v_type, v_amount, v_operator, v_actor, v_notes, v_key, v_device)
  returning * into v_row;
  return jsonb_build_object('success', true, 'movement_id', v_row.id, 'period_id', v_period, 'replayed', false);
end;
$$;
revoke all on function public.record_pos_cash_movement(jsonb) from public;
grant execute on function public.record_pos_cash_movement(jsonb) to anon, authenticated, service_role;

-- Record a blind count observation: opening is written by the opener;
-- handover and closing counts never move money.
create or replace function public.record_pos_cash_count(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_period_id uuid := nullif(payload->>'period_id', '')::uuid;
  v_type text := lower(nullif(btrim(coalesce(payload->>'count_type', '')), ''));
  v_counted numeric; v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_operator uuid := nullif(payload->>'operator_id', '')::uuid;
  v_pin text := payload->>'pin';
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_device text := coalesce(nullif(btrim(coalesce(payload->>'device_id', '')), ''), 'shared-terminal');
  v_actor uuid := public.app_current_user_id();
  v_period record; v_existing record; v_row record;
begin
  if v_lodge_id is null or v_period_id is null or v_type is null or v_key is null then
    return jsonb_build_object('success', false, 'error', 'A business, drawer period, count kind and retry key are required.');
  end if;
  if v_type not in ('handover', 'closing') then
    return jsonb_build_object('success', false, 'error', 'Choose a handover count or a closing count. The opening count is recorded when the drawer opens.');
  end if;
  begin v_counted := round((payload->>'counted_cash')::numeric, 2);
  exception when others then return jsonb_build_object('success', false, 'error', 'Count the drawer and enter what is in it.'); end;
  if v_counted is null or v_counted < 0 then
    return jsonb_build_object('success', false, 'error', 'Count the drawer and enter what is in it.');
  end if;
  if length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'This count needs a valid retry key. Close and reopen this screen, then try again.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your session could not be confirmed. Sign in again.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_key, 0));
  select * into v_existing from public.pos_cash_counts where lodge_id = v_lodge_id and idempotency_key = v_key for update;
  if found then
    if v_existing.count_type is distinct from v_type
       or v_existing.counted_cash is distinct from v_counted
       or v_existing.period_id is distinct from v_period_id then
      return jsonb_build_object('success', false, 'error', 'This retry key was already used for a different count.', 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('success', true, 'count_id', v_existing.id, 'replayed', true);
  end if;
  select * into v_period from public.pos_cash_periods where id = v_period_id and lodge_id = v_lodge_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'This drawer period was not found. Refresh and try again.');
  end if;
  if v_period.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'This drawer period is already submitted. A manager reviews it in Cash & close.');
  end if;
  if v_operator is not null and v_operator is distinct from v_actor then
    if not public._restaurant_validate_attendance_pin(v_lodge_id, v_operator, coalesce(v_pin, ''), v_device) then
      return jsonb_build_object('success', false, 'error', 'Incorrect staff PIN.');
    end if;
  end if;
  v_operator := coalesce(v_operator, v_actor);
  insert into public.pos_cash_counts (lodge_id, container_id, period_id, count_type, counted_cash, operator_id, actor_id, notes, idempotency_key, device_id)
  values (v_lodge_id, v_period.container_id, v_period_id, v_type, v_counted, v_operator, v_actor, v_notes, v_key, v_device)
  returning * into v_row;
  return jsonb_build_object('success', true, 'count_id', v_row.id, 'period_id', v_period_id, 'replayed', false);
end;
$$;
revoke all on function public.record_pos_cash_count(jsonb) from public;
grant execute on function public.record_pos_cash_count(jsonb) to anon, authenticated, service_role;

-- Submit the period's blind closing count. The response carries no expected
-- figures — not even to managers. Expectations are revealed only at review.
create or replace function public.submit_pos_drawer_period_cashup(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_period_id uuid := nullif(payload->>'period_id', '')::uuid;
  v_counted numeric; v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_operator uuid := nullif(payload->>'operator_id', '')::uuid;
  v_pin text := payload->>'pin';
  v_key text := nullif(btrim(coalesce(payload->>'idempotency_key', '')), '');
  v_device text := coalesce(nullif(btrim(coalesce(payload->>'device_id', '')), ''), 'shared-terminal');
  v_actor uuid := public.app_current_user_id();
  v_period record; v_existing record;
begin
  if v_lodge_id is null or v_period_id is null or v_key is null then
    return jsonb_build_object('success', false, 'error', 'A business, drawer period and retry key are required.');
  end if;
  begin v_counted := round((payload->>'counted_cash')::numeric, 2);
  exception when others then return jsonb_build_object('success', false, 'error', 'Count the drawer and enter what is in it.'); end;
  if v_counted is null or v_counted < 0 then
    return jsonb_build_object('success', false, 'error', 'Count the drawer and enter what is in it.');
  end if;
  if length(v_key) < 8 or length(v_key) > 128 then
    return jsonb_build_object('success', false, 'error', 'This cash-up needs a valid retry key. Close and reopen this screen, then try again.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your session could not be confirmed. Sign in again.');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_lodge_id::text || ':' || v_key, 0));
  select * into v_existing from public.pos_cash_periods where lodge_id = v_lodge_id and submit_idempotency_key = v_key for update;
  if found then
    if v_existing.id is distinct from v_period_id
       or v_existing.counted_cash is distinct from v_counted
       or coalesce(v_existing.submit_notes, '') is distinct from coalesce(v_notes, '') then
      return jsonb_build_object('success', false, 'error', 'This retry key was already used for a different cash-up.', 'code', 'idempotency_conflict');
    end if;
    return jsonb_build_object('success', true, 'period_id', v_existing.id, 'status', v_existing.status, 'replayed', true);
  end if;
  select * into v_period from public.pos_cash_periods where id = v_period_id and lodge_id = v_lodge_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'This drawer period was not found. Refresh and try again.');
  end if;
  if v_period.status = 'submitted' then
    return jsonb_build_object('success', false, 'error', 'This cash-up is already submitted. A manager reviews it in Cash & close.');
  end if;
  if v_period.status = 'approved' then
    return jsonb_build_object('success', false, 'error', 'This drawer period is already closed.');
  end if;
  if v_period.status = 'rejected' and v_period.submit_idempotency_key is not null and v_key = v_period.submit_idempotency_key then
    return jsonb_build_object('success', false, 'error', 'This cash-up was returned for correction. Enter the corrected count — the same retry key cannot be reused.');
  end if;
  if v_operator is not null and v_operator is distinct from v_actor then
    if not public._restaurant_validate_attendance_pin(v_lodge_id, v_operator, coalesce(v_pin, ''), v_device) then
      return jsonb_build_object('success', false, 'error', 'Incorrect staff PIN.');
    end if;
  end if;
  v_operator := coalesce(v_operator, v_actor);
  update public.pos_cash_periods
     set status = 'submitted', counted_cash = v_counted, submit_notes = v_notes,
         submitted_by = v_operator, submitted_at = now(), submit_idempotency_key = v_key
   where id = v_period_id and lodge_id = v_lodge_id;
  insert into public.pos_cash_counts (lodge_id, container_id, period_id, count_type, counted_cash, operator_id, actor_id, notes, idempotency_key, device_id)
  values (v_lodge_id, v_period.container_id, v_period_id, 'closing', v_counted, v_operator, v_actor, v_notes, v_key || ':closing', v_device)
  on conflict do nothing;
  return jsonb_build_object('success', true, 'period_id', v_period_id, 'status', 'submitted', 'replayed', false);
end;
$$;
revoke all on function public.submit_pos_drawer_period_cashup(jsonb) from public;
grant execute on function public.submit_pos_drawer_period_cashup(jsonb) to anon, authenticated, service_role;

-- Manager review: approve snapshots the server-derived expectation and closes
-- the period (plus untouched outlet shifts); return sends it back for
-- correction. The counter and approver are recorded separately even when
-- they are the same person (honest self-review, never two-people theatre).
create or replace function public.review_pos_drawer_period_cashup(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_period_id uuid := nullif(payload->>'period_id', '')::uuid;
  v_decision text := lower(nullif(btrim(coalesce(payload->>'decision', '')), ''));
  v_notes text := nullif(btrim(coalesce(payload->>'notes', '')), '');
  v_pin text := payload->>'manager_pin';
  v_device text := coalesce(nullif(btrim(coalesce(payload->>'device_id', '')), ''), 'shared-terminal');
  v_actor uuid := public.app_current_user_id();
  v_period record; v_expected jsonb;
begin
  if v_lodge_id is null or v_period_id is null then
    return jsonb_build_object('success', false, 'error', 'A business and drawer period are required.');
  end if;
  if v_decision not in ('approve', 'reject') then
    return jsonb_build_object('success', false, 'error', 'Choose approve or return for correction.');
  end if;
  if v_decision = 'reject' and v_notes is null then
    return jsonb_build_object('success', false, 'error', 'Enter a correction note before returning this cash-up.');
  end if;
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your session could not be confirmed. Sign in again.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
  select * into v_period from public.pos_cash_periods where id = v_period_id and lodge_id = v_lodge_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'This drawer period was not found. Refresh and try again.');
  end if;
  if v_period.status <> 'submitted' then
    return jsonb_build_object('success', true, 'period_id', v_period_id, 'status', v_period.status, 'replayed', true);
  end if;
  if not public._restaurant_validate_manager_cashup_pin(v_lodge_id, v_actor, coalesce(v_pin, ''), v_device) then
    return jsonb_build_object('success', false, 'error', 'Incorrect manager PIN.');
  end if;
  if v_decision = 'reject' then
    update public.pos_cash_periods
       set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(), review_notes = v_notes,
           counted_cash = null, submit_notes = null, submitted_by = null, submitted_at = null, submit_idempotency_key = null
     where id = v_period_id and lodge_id = v_lodge_id;
    return jsonb_build_object('success', true, 'period_id', v_period_id, 'status', 'rejected');
  end if;
  v_expected := public.pos_drawer_period_expected(v_lodge_id, v_period_id, coalesce(v_period.submitted_at, now()));
  if coalesce((v_expected->>'success')::boolean, false) is not true then
    return v_expected;
  end if;
  update public.pos_cash_periods
     set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), review_notes = v_notes,
         expected_cash_drawer = (v_expected->>'expected_cash_drawer')::numeric
   where id = v_period_id and lodge_id = v_lodge_id;
  -- Close untouched outlet shifts so empty floats never linger; shifts that
  -- traded stay open and keep attributing sales to their sellers.
  update public.pos_shifts set status = 'closed', closed_at = now(),
    close_notes = coalesce(close_notes || ' ', '') || 'Closed by drawer period close.'
   where lodge_id = v_lodge_id and outlet_id = v_period.outlet_id and status = 'open'
     and not exists (select 1 from public.pos_orders o
       where o.lodge_id = v_lodge_id and o.shift_id = pos_shifts.id
         and o.created_at >= v_period.opened_at and coalesce(o.status, '') not in ('voided', 'cancelled'));
  return jsonb_build_object('success', true, 'period_id', v_period_id, 'status', 'approved',
    'expected_cash_drawer', v_expected->>'expected_cash_drawer',
    'variance', round(coalesce(v_period.counted_cash, 0) - (v_expected->>'expected_cash_drawer')::numeric, 2),
    'self_reviewed', v_period.submitted_by is not distinct from v_actor);
end;
$$;
revoke all on function public.review_pos_drawer_period_cashup(jsonb) from public;
grant execute on function public.review_pos_drawer_period_cashup(jsonb) to anon, authenticated, service_role;

-- Period state read. Managers see the full evidence including the derived
-- expectation; operators see movements and count confirmations but never
-- expected cash or variance (blind close preserved).
create or replace function public.get_pos_drawer_period_state(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_lodge_id uuid := nullif(payload->>'lodge_id', '')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_actor uuid := public.app_current_user_id();
  v_role text; v_container uuid; v_period record; v_expected jsonb;
begin
  if v_lodge_id is null or v_outlet_id is null then
    return jsonb_build_object('success', false, 'error', 'A business and outlet are required.');
  end if;
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your session could not be confirmed. Sign in again.');
  end if;
  select role into v_role from public.users where id = v_actor and lodge_id = v_lodge_id;
  select id into v_container from public.pos_cash_containers
   where lodge_id = v_lodge_id and kind = 'drawer' and outlet_id = v_outlet_id and is_active;
  if v_container is null then
    return jsonb_build_object('success', true, 'period', null, 'movements', '[]'::jsonb, 'counts', '[]'::jsonb);
  end if;
  select * into v_period from public.pos_cash_periods
   where container_id = v_container and status in ('open', 'submitted', 'rejected')
   order by opened_at desc limit 1;
  if not found then
    return jsonb_build_object('success', true, 'period', null, 'movements', '[]'::jsonb, 'counts', '[]'::jsonb);
  end if;
  if v_role in ('manager', 'admin', 'super_admin') then
    v_expected := public.pos_drawer_period_expected(v_lodge_id, v_period.id, coalesce(v_period.submitted_at, now()));
    return jsonb_build_object('success', true,
      'period', to_jsonb(v_period) - 'submit_idempotency_key',
      'expected', v_expected,
      'movements', coalesce((select jsonb_agg(m order by m.created_at) from public.pos_cash_movements m where m.period_id = v_period.id), '[]'::jsonb),
      'counts', coalesce((select jsonb_agg(c order by c.created_at) from public.pos_cash_counts c where c.period_id = v_period.id), '[]'::jsonb));
  end if;
  return jsonb_build_object('success', true,
    'period', jsonb_build_object('id', v_period.id, 'outlet_id', v_period.outlet_id, 'business_date', v_period.business_date,
      'status', v_period.status, 'opening_float', v_period.opening_float, 'opened_at', v_period.opened_at,
      'review_notes', v_period.review_notes),
    'movements', coalesce((select jsonb_agg(m order by m.created_at) from public.pos_cash_movements m where m.period_id = v_period.id), '[]'::jsonb),
    'counts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'count_type', c.count_type, 'operator_id', c.operator_id, 'created_at', c.created_at, 'notes', c.notes)) from public.pos_cash_counts c where c.period_id = v_period.id), '[]'::jsonb));
end;
$$;
revoke all on function public.get_pos_drawer_period_state(jsonb) from public;
grant execute on function public.get_pos_drawer_period_state(jsonb) to anon, authenticated, service_role;

-- Structural cash-model switch. Admin-only, blocked by any open financial
-- activity in the outlet, fully audited. Existing personal shifts keep their
-- rules; only newly opened drawer activity follows the new model.
create or replace function public.set_outlet_cash_model(p_outlet_id uuid, p_lodge_id uuid, p_cash_model text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_model text := lower(nullif(btrim(coalesce(p_cash_model, '')), ''));
  v_actor uuid := public.app_current_user_id();
  v_before public.outlets%rowtype; v_busy integer;
begin
  if p_outlet_id is null or p_lodge_id is null then
    return jsonb_build_object('success', false, 'error', 'A business and outlet are required.');
  end if;
  if v_model not in ('shared_drawer', 'personal_bank') then
    return jsonb_build_object('success', false, 'error', 'Choose one shared drawer or separate pouches.');
  end if;
  select * into v_before from public.outlets where id = p_outlet_id and lodge_id = p_lodge_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'This outlet does not belong to this business.');
  end if;
  if v_before.cash_model = v_model then
    return jsonb_build_object('success', true, 'outlet_id', p_outlet_id, 'cash_model', v_model, 'unchanged', true);
  end if;
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'super_admin']);
  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your session could not be confirmed. Sign in again.');
  end if;
  select * into v_before from public.outlets where id = p_outlet_id and lodge_id = p_lodge_id for update;
  select count(*) into v_busy from public.pos_shifts
   where lodge_id = p_lodge_id and outlet_id = p_outlet_id and status = 'open';
  if v_busy > 0 then
    return jsonb_build_object('success', false, 'error', 'Close every open Till shift in this outlet before changing how its cash is counted.');
  end if;
  select count(*) into v_busy from public.pos_cash_periods p
   join public.pos_cash_containers c on c.id = p.container_id
   where p.lodge_id = p_lodge_id and c.outlet_id = p_outlet_id and p.status in ('open', 'submitted', 'rejected');
  if v_busy > 0 then
    return jsonb_build_object('success', false, 'error', 'Finish the open drawer period in this outlet before changing how its cash is counted.');
  end if;
  select count(*) into v_busy from public.pos_cashup_submissions s
   join public.pos_shifts p on p.id = s.shift_id
   where s.lodge_id = p_lodge_id and p.outlet_id = p_outlet_id and s.status = 'submitted';
  if v_busy > 0 then
    return jsonb_build_object('success', false, 'error', 'Review every submitted cash-up in this outlet before changing how its cash is counted.');
  end if;
  update public.outlets set cash_model = v_model where id = p_outlet_id and lodge_id = p_lodge_id;
  insert into public.restaurant_outlet_control_audit (lodge_id, outlet_id, actor_id, action, before_state, after_state)
  values (p_lodge_id, p_outlet_id, v_actor, 'cash_model_changed',
    jsonb_build_object('cash_model', v_before.cash_model),
    jsonb_build_object('cash_model', v_model));
  return jsonb_build_object('success', true, 'outlet_id', p_outlet_id, 'cash_model', v_model);
end;
$$;
revoke all on function public.set_outlet_cash_model(uuid, uuid, text) from public;
grant execute on function public.set_outlet_cash_model(uuid, uuid, text) to anon, authenticated, service_role;

-- Clock-out in shared-drawer outlets: attendance may close while the drawer
-- stays open. The personal guards below still apply to every personal-bank
-- outlet and to shared-outlet sales recorded nowhere near a drawer.
create or replace function public.clock_out_staff(payload jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid; v_shift_id uuid:=nullif(payload->>'shift_id','')::uuid; v_actor uuid:=public.app_current_user_id(); v_shift public.restaurant_shifts%rowtype; v_pos uuid; v_cashup text; v_unreconciled boolean;
begin
 perform public.app_require_restaurant_lodge(v_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
 select * into v_shift from public.restaurant_shifts where id=v_shift_id and lodge_id=v_lodge_id and status='active' for update;
 if not found then return jsonb_build_object('success',false,'error','Active attendance shift not found. Refresh the list and try again.'); end if;
 if v_shift.staff_user_id is distinct from v_actor then perform public.app_require_restaurant_lodge(v_lodge_id,array['admin','manager','supervisor']); end if;
 select id into v_pos from public.pos_shifts where lodge_id=v_lodge_id and attendance_shift_id=v_shift.id and status='open' order by opened_at desc limit 1;
 if v_pos is null then select id into v_pos from public.pos_shifts where lodge_id=v_lodge_id and cashier_id=v_shift.staff_user_id and status='open' order by opened_at desc limit 1; end if;
 if v_pos is not null and coalesce((select o.cash_model from public.outlets o join public.pos_shifts p on p.outlet_id = o.id where p.id = v_pos), 'personal_bank') = 'shared_drawer' then v_pos := null; end if;
 if v_pos is not null then select status into v_cashup from public.pos_cashup_submissions where lodge_id=v_lodge_id and shift_id=v_pos; if coalesce(v_cashup,'') not in ('submitted','approved') then return jsonb_build_object('success',false,'error','Submit My Cash-up before clocking out.'); end if; end if;
 select exists(select 1 from public.pos_orders o left join public.pos_cashup_submissions c on c.lodge_id=o.lodge_id and c.shift_id=o.shift_id and c.status in ('submitted','approved') where o.lodge_id=v_lodge_id and o.cashier_id=v_shift.staff_user_id and o.created_at>=v_shift.clock_in and coalesce(o.status,'') not in ('voided','cancelled') and c.id is null and coalesce((select o2.cash_model from public.outlets o2 where o2.id = o.outlet_id), 'personal_bank') <> 'shared_drawer') into v_unreconciled;
 if v_unreconciled then return jsonb_build_object('success',false,'error','A sale recorded during this attendance shift still needs a submitted cash-up before clocking out.'); end if;
 update public.restaurant_shifts set clock_out=now(),status='completed',clocked_out_by=v_actor where id=v_shift_id; return jsonb_build_object('success',true);
end; $$;

commit;

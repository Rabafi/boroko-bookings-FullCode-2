-- Advanced Booking Engine Add-on
-- Tables, RPCs, RLS, and grants for server-side pricing and availability

-- ############################################################################
-- TABLES
-- ############################################################################

create table if not exists public.booking_engine_rules (
  id bigint primary key generated always as identity,
  lodge_id bigint not null,
  name text not null,
  rule_type text not null check (rule_type in ('availability', 'pricing', 'restriction', 'upsell')),
  active boolean not null default true,
  conditions jsonb not null default '{}'::jsonb,
  actions jsonb not null default '{}'::jsonb,
  priority int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, name)
);

create table if not exists public.booking_engine_upsells (
  id bigint primary key generated always as identity,
  lodge_id bigint not null,
  name text not null,
  description text default '',
  upsell_type text not null check (upsell_type in ('room_upgrade', 'addon_service', 'package')),
  active boolean not null default true,
  price_adjustment numeric(12,2) not null default 0,
  conditions jsonb not null default '{}'::jsonb,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ############################################################################
-- RLS
-- ############################################################################

alter table public.booking_engine_rules enable row level security;
alter table public.booking_engine_upsells enable row level security;

create policy "Lodge-scoped read booking_engine_rules"
  on public.booking_engine_rules for select
  using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge-scoped insert booking_engine_rules"
  on public.booking_engine_rules for insert
  with check (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge-scoped update booking_engine_rules"
  on public.booking_engine_rules for update
  using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge-scoped delete booking_engine_rules"
  on public.booking_engine_rules for delete
  using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge-scoped read booking_engine_upsells"
  on public.booking_engine_upsells for select
  using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge-scoped insert booking_engine_upsells"
  on public.booking_engine_upsells for insert
  with check (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge-scoped update booking_engine_upsells"
  on public.booking_engine_upsells for update
  using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge-scoped delete booking_engine_upsells"
  on public.booking_engine_upsells for delete
  using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

-- ############################################################################
-- RPC: calculate_booking_price
-- ############################################################################

create or replace function public.calculate_booking_price(
  p_lodge_id bigint,
  p_room_type_id bigint,
  p_check_in date,
  p_check_out date,
  p_num_guests int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total numeric(12,2) := 0;
  v_base_rate numeric(12,2) := 0;
  v_nights int;
  v_day date;
  v_day_rate numeric(12,2);
  v_adjustments jsonb := '[]'::jsonb;
  v_final_total numeric(12,2);
  v_rule record;
  v_conditions jsonb;
  v_actions jsonb;
begin
  perform app_require_lodge_role(p_lodge_id, 'receptionist');

  v_nights := p_check_out - p_check_in;
  if v_nights <= 0 then
    return json_build_object('error', 'check_out must be after check_in');
  end if;

  -- base rate: sum of daily applicable rates from rate_calendar_entries or room_types
  v_day := p_check_in;
  while v_day < p_check_out loop
    select coalesce(
      (select rate_amount from public.get_applicable_rate(p_room_type_id, v_day)),
      jsonb_build_object('rate_amount', 0)
    ) into v_day_rate;

    -- fallback to room_types.base_rate
    if v_day_rate is null or v_day_rate = 0 then
      select base_rate into v_day_rate
      from public.room_types
      where id = p_room_type_id and lodge_id = p_lodge_id;
    end if;

    v_base_rate := v_base_rate + coalesce(v_day_rate, 0);
    v_day := v_day + 1;
  end loop;

  v_total := v_base_rate;

  -- apply pricing rules
  for v_rule in
    select conditions, actions
    from public.booking_engine_rules
    where lodge_id = p_lodge_id
      and rule_type = 'pricing'
      and active = true
    order by priority desc, id
  loop
    v_conditions := v_rule.conditions;
    v_actions := v_rule.actions;

    -- if no occupancy filter or occupancy matches
    if (v_conditions->>'min_guests' is null or p_num_guests >= (v_conditions->>'min_guests')::int)
       and (v_conditions->>'max_guests' is null or p_num_guests <= (v_conditions->>'max_guests')::int)
       and (v_conditions->>'min_nights' is null or v_nights >= (v_conditions->>'min_nights')::int)
       and (v_conditions->>'room_type_id' is null or (v_conditions->>'room_type_id')::bigint = p_room_type_id)
    then
      if v_actions->>'type' = 'percentage_adjustment' then
        v_total := v_total * (1 + ((v_actions->>'value')::numeric / 100));
        v_adjustments := v_adjustments || jsonb_build_object(
          'type', 'pricing_rule', 'description', v_actions->>'description',
          'value', (v_total * (v_actions->>'value')::numeric / 100)::numeric(12,2)
        );
      elsif v_actions->>'type' = 'fixed_adjustment' then
        v_total := v_total + (v_actions->>'value')::numeric;
        v_adjustments := v_adjustments || jsonb_build_object(
          'type', 'pricing_rule', 'description', v_actions->>'description',
          'value', (v_actions->>'value')::numeric
        );
      end if;
    end if;
  end loop;

  v_final_total := greatest(v_total, 0);

  return json_build_object(
    'base_rate', v_base_rate::numeric(12,2),
    'total', v_final_total::numeric(12,2),
    'adjustments', v_adjustments,
    'final_total', v_final_total::numeric(12,2)
  );
end;
$$;

-- ############################################################################
-- RPC: check_availability_advanced
-- ############################################################################

create or replace function public.check_availability_advanced(
  p_lodge_id bigint,
  p_room_type_id bigint,
  p_check_in date,
  p_check_out date,
  p_num_rooms int default 1
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total_rooms int;
  v_booked int;
  v_maintenance int;
  v_available int;
  v_blocked_reasons jsonb := '[]'::jsonb;
  v_day date;
  v_day_available int;
  v_rule record;
  v_conditions jsonb;
begin
  perform app_require_lodge_role(p_lodge_id, 'receptionist');

  -- total rooms of this type
  select count(*) into v_total_rooms
  from public.rooms
  where room_type_id = p_room_type_id and lodge_id = p_lodge_id and active = true;

  if v_total_rooms = 0 then
    v_total_rooms := 10; -- fallback estimate
  end if;

  -- check each day
  v_day := p_check_in;
  while v_day < p_check_out loop
    select count(*) into v_booked
    from public.bookings b
    where b.room_type_id = p_room_type_id
      and b.lodge_id = p_lodge_id
      and b.status in ('confirmed', 'checked_in', 'pending')
      and b.check_in < v_day + 1
      and b.check_out > v_day;

    select count(*) into v_maintenance
    from public.room_downtime rd
    join public.rooms r on r.id = rd.room_id
    where r.room_type_id = p_room_type_id
      and r.lodge_id = p_lodge_id
      and rd.start_date <= v_day
      and (rd.end_date >= v_day or rd.end_date is null)
      and rd.status in ('out_of_order', 'out_of_service');

    v_day_available := v_total_rooms - v_booked - v_maintenance;

    if v_day_available < p_num_rooms then
      v_blocked_reasons := v_blocked_reasons || jsonb_build_object(
        'date', v_day,
        'available', v_day_available,
        'requested', p_num_rooms,
        'reason', 'Insufficient inventory'
      );
    end if;

    v_day := v_day + 1;
  end loop;

  -- apply restriction rules
  for v_rule in
    select conditions
    from public.booking_engine_rules
    where lodge_id = p_lodge_id
      and rule_type = 'restriction'
      and active = true
    order by priority desc, id
  loop
    v_conditions := v_rule.conditions;
    if (v_conditions->>'min_nights' is null or (p_check_out - p_check_in) >= (v_conditions->>'min_nights')::int)
       and (v_conditions->>'max_nights' is null or (p_check_out - p_check_in) <= (v_conditions->>'max_nights')::int)
       and (v_conditions->>'room_type_id' is null or (v_conditions->>'room_type_id')::bigint = p_room_type_id)
    then
      if v_conditions->>'type' = 'min_stay' and (p_check_out - p_check_in) < (v_conditions->>'value')::int then
        v_blocked_reasons := v_blocked_reasons || jsonb_build_object(
          'reason', 'Minimum stay required',
          'min_nights', (v_conditions->>'value')::int
        );
      end if;
      if v_conditions->>'type' = 'max_stay' and (p_check_out - p_check_in) > (v_conditions->>'value')::int then
        v_blocked_reasons := v_blocked_reasons || jsonb_build_object(
          'reason', 'Maximum stay exceeded',
          'max_nights', (v_conditions->>'value')::int
        );
      end if;
    end if;
  end loop;

  return json_build_object(
    'available', jsonb_array_length(v_blocked_reasons) = 0,
    'total_rooms', v_total_rooms,
    'blocked_reasons', v_blocked_reasons
  );
end;
$$;

-- ############################################################################
-- RPC: get_booking_upsells
-- ############################################################################

create or replace function public.get_booking_upsells(
  p_lodge_id bigint,
  p_room_type_id bigint,
  p_check_in date,
  p_check_out date,
  p_num_guests int
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upsells jsonb;
  v_rule record;
begin
  perform app_require_lodge_role(p_lodge_id, 'receptionist');

  v_upsells := (
    select jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'name', u.name,
        'description', u.description,
        'upsell_type', u.upsell_type,
        'price_adjustment', u.price_adjustment,
        'sort_order', u.sort_order
      ) order by u.sort_order, u.id
    )
    from public.booking_engine_upsells u
    where u.lodge_id = p_lodge_id and u.active = true
  );

  return coalesce(v_upsells, '[]'::jsonb);
end;
$$;

-- ############################################################################
-- RPC: create_booking_intent
-- ############################################################################

create or replace function public.create_booking_intent(
  p_lodge_id bigint,
  p_room_type_id bigint,
  p_check_in date,
  p_check_out date,
  p_num_guests int,
  p_price_estimate numeric(12,2)
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_session_id text;
begin
  perform app_require_lodge_role(p_lodge_id, 'receptionist');

  v_session_id := coalesce(
    (select current_setting('request.jwt.claims', true)::json->>'session_id'),
    'anonymous'
  );

  insert into public.analytics_events
    (lodge_id, event_type, event_data, source)
  values
    (p_lodge_id, 'booking_intent', jsonb_build_object(
      'room_type_id', p_room_type_id,
      'check_in', p_check_in,
      'check_out', p_check_out,
      'num_guests', p_num_guests,
      'price_estimate', p_price_estimate,
      'session_id', v_session_id
    ), 'booking_engine')
  returning id into v_id;

  return json_build_object('success', true, 'id', v_id);
end;
$$;

-- ############################################################################
-- RPC: get_booking_engine_rules
-- ############################################################################

create or replace function public.get_booking_engine_rules(
  p_lodge_id bigint
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
begin
  perform app_require_lodge_role(p_lodge_id, 'receptionist');

  select jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'lodge_id', r.lodge_id,
      'name', r.name,
      'rule_type', r.rule_type,
      'active', r.active,
      'conditions', r.conditions,
      'actions', r.actions,
      'priority', r.priority,
      'created_at', r.created_at,
      'updated_at', r.updated_at
    ) order by r.priority desc, r.name
  ) into v_rules
  from public.booking_engine_rules r
  where r.lodge_id = p_lodge_id;

  return coalesce(v_rules, '[]'::jsonb);
end;
$$;

-- ############################################################################
-- RPC: create_booking_engine_rule
-- ############################################################################

create or replace function public.create_booking_engine_rule(
  p_lodge_id bigint,
  p_name text,
  p_rule_type text,
  p_conditions jsonb default '{}'::jsonb,
  p_actions jsonb default '{}'::jsonb,
  p_priority int default 0,
  p_active boolean default true
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  perform app_require_lodge_role(p_lodge_id, 'manager');

  insert into public.booking_engine_rules
    (lodge_id, name, rule_type, conditions, actions, priority, active)
  values
    (p_lodge_id, p_name, p_rule_type, p_conditions, p_actions, p_priority, p_active)
  returning id into v_id;

  return json_build_object('success', true, 'id', v_id);
end;
$$;

-- ############################################################################
-- RPC: update_booking_engine_rule
-- ############################################################################

create or replace function public.update_booking_engine_rule(
  p_id bigint,
  p_lodge_id bigint,
  p_name text default null,
  p_rule_type text default null,
  p_conditions jsonb default null,
  p_actions jsonb default null,
  p_priority int default null,
  p_active boolean default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_lodge_role(p_lodge_id, 'manager');

  update public.booking_engine_rules
  set
    name = coalesce(p_name, name),
    rule_type = coalesce(p_rule_type, rule_type),
    conditions = coalesce(p_conditions, conditions),
    actions = coalesce(p_actions, actions),
    priority = coalesce(p_priority, priority),
    active = coalesce(p_active, active),
    updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return json_build_object('success', false, 'error', 'Rule not found');
  end if;

  return json_build_object('success', true);
end;
$$;

-- ############################################################################
-- RPC: delete_booking_engine_rule (soft delete)
-- ############################################################################

create or replace function public.delete_booking_engine_rule(
  p_id bigint,
  p_lodge_id bigint
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_lodge_role(p_lodge_id, 'manager');

  update public.booking_engine_rules
  set active = false, updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return json_build_object('success', false, 'error', 'Rule not found');
  end if;

  return json_build_object('success', true);
end;
$$;

-- ############################################################################
-- RPC: get_booking_upsells_list
-- ############################################################################

create or replace function public.get_booking_upsells_list(
  p_lodge_id bigint
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_upsells jsonb;
begin
  perform app_require_lodge_role(p_lodge_id, 'receptionist');

  select jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'lodge_id', u.lodge_id,
      'name', u.name,
      'description', u.description,
      'upsell_type', u.upsell_type,
      'active', u.active,
      'price_adjustment', u.price_adjustment,
      'conditions', u.conditions,
      'sort_order', u.sort_order,
      'created_at', u.created_at,
      'updated_at', u.updated_at
    ) order by u.sort_order, u.name
  ) into v_upsells
  from public.booking_engine_upsells u
  where u.lodge_id = p_lodge_id;

  return coalesce(v_upsells, '[]'::jsonb);
end;
$$;

-- ############################################################################
-- RPC: create_booking_upsell
-- ############################################################################

create or replace function public.create_booking_upsell(
  p_lodge_id bigint,
  p_name text,
  p_description text default '',
  p_upsell_type text default 'addon_service',
  p_price_adjustment numeric(12,2) default 0,
  p_conditions jsonb default '{}'::jsonb,
  p_sort_order int default 0,
  p_active boolean default true
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  perform app_require_lodge_role(p_lodge_id, 'manager');

  insert into public.booking_engine_upsells
    (lodge_id, name, description, upsell_type, price_adjustment, conditions, sort_order, active)
  values
    (p_lodge_id, p_name, p_description, p_upsell_type, p_price_adjustment, p_conditions, p_sort_order, p_active)
  returning id into v_id;

  return json_build_object('success', true, 'id', v_id);
end;
$$;

-- ############################################################################
-- RPC: update_booking_upsell
-- ############################################################################

create or replace function public.update_booking_upsell(
  p_id bigint,
  p_lodge_id bigint,
  p_name text default null,
  p_description text default null,
  p_upsell_type text default null,
  p_price_adjustment numeric(12,2) default null,
  p_conditions jsonb default null,
  p_sort_order int default null,
  p_active boolean default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_lodge_role(p_lodge_id, 'manager');

  update public.booking_engine_upsells
  set
    name = coalesce(p_name, name),
    description = coalesce(p_description, description),
    upsell_type = coalesce(p_upsell_type, upsell_type),
    price_adjustment = coalesce(p_price_adjustment, price_adjustment),
    conditions = coalesce(p_conditions, conditions),
    sort_order = coalesce(p_sort_order, sort_order),
    active = coalesce(p_active, active),
    updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return json_build_object('success', false, 'error', 'Upsell not found');
  end if;

  return json_build_object('success', true);
end;
$$;

-- ############################################################################
-- RPC: delete_booking_upsell (soft delete)
-- ############################################################################

create or replace function public.delete_booking_upsell(
  p_id bigint,
  p_lodge_id bigint
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  perform app_require_lodge_role(p_lodge_id, 'manager');

  update public.booking_engine_upsells
  set active = false, updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;

  if not found then
    return json_build_object('success', false, 'error', 'Upsell not found');
  end if;

  return json_build_object('success', true);
end;
$$;

-- ############################################################################
-- GRANTS
-- ############################################################################

grant usage on sequence public.booking_engine_rules_id_seq to authenticated, service_role;
grant usage on sequence public.booking_engine_upsells_id_seq to authenticated, service_role;
grant select, insert, update, delete on public.booking_engine_rules to authenticated, service_role;
grant select, insert, update, delete on public.booking_engine_upsells to authenticated, service_role;

grant execute on function public.calculate_booking_price(bigint, bigint, date, date, int) to authenticated, service_role;
grant execute on function public.check_availability_advanced(bigint, bigint, date, date, int) to authenticated, service_role;
grant execute on function public.get_booking_upsells(bigint, bigint, date, date, int) to authenticated, service_role;
grant execute on function public.create_booking_intent(bigint, bigint, date, date, int, numeric) to authenticated, service_role;
grant execute on function public.get_booking_engine_rules(bigint) to authenticated, service_role;
grant execute on function public.create_booking_engine_rule(bigint, text, text, jsonb, jsonb, int, boolean) to authenticated, service_role;
grant execute on function public.update_booking_engine_rule(bigint, bigint, text, text, jsonb, jsonb, int, boolean) to authenticated, service_role;
grant execute on function public.delete_booking_engine_rule(bigint, bigint) to authenticated, service_role;
grant execute on function public.get_booking_upsells_list(bigint) to authenticated, service_role;
grant execute on function public.create_booking_upsell(bigint, text, text, text, numeric, jsonb, int, boolean) to authenticated, service_role;
grant execute on function public.update_booking_upsell(bigint, bigint, text, text, text, numeric, jsonb, int, boolean) to authenticated, service_role;
grant execute on function public.delete_booking_upsell(bigint, bigint) to authenticated, service_role;

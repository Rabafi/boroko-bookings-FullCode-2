begin;

create table if not exists public.test_data_reset_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  triggered_by uuid,
  reset_mode text not null,
  reason text,
  deleted_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint test_data_reset_audit_mode_check
    check (reset_mode in ('recent_activity', 'tagged_test_data', 'full_demo_reset'))
);

create index if not exists test_data_reset_audit_lodge_created_idx
  on public.test_data_reset_audit (lodge_id, created_at desc);

alter table public.test_data_reset_audit enable row level security;

drop policy if exists "test_data_reset_audit_select_own_lodge" on public.test_data_reset_audit;
create policy "test_data_reset_audit_select_own_lodge"
  on public.test_data_reset_audit
  for select
  using (public.app_lodge_access(lodge_id));

create or replace function public.test_mode_enabled_for_lodge(p_lodge_id uuid)
returns boolean
language sql
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
      from public.lodge_features lf
     where lf.lodge_id = p_lodge_id
       and lf.feature_name = 'test_mode_enabled'
       and lf.enabled = true
       and coalesce(lf.expires_at, now() + interval '100 years') > now()
  );
$function$;

create or replace function public.get_test_data_reset_preview(
  p_lodge_id uuid,
  p_mode text default 'full_demo_reset',
  p_days int default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_mode text := coalesce(nullif(p_mode, ''), 'full_demo_reset');
  v_preview jsonb := '{}'::jsonb;
  v_booking_ids uuid[] := '{}'::uuid[];
  v_customer_ids uuid[] := '{}'::uuid[];
begin
  if not public.test_mode_enabled_for_lodge(p_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Test mode is not enabled for this lodge');
  end if;

  if v_mode not in ('recent_activity', 'tagged_test_data', 'full_demo_reset') then
    return jsonb_build_object('success', false, 'error', 'Unsupported reset mode');
  end if;

  if v_mode = 'recent_activity' then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id
       and coalesce(created_at, now()) >= v_cutoff;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id
       and coalesce(created_at, now()) >= v_cutoff;
  elsif v_mode = 'tagged_test_data' then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id
       and (
         lower(coalesce(source, '')) = 'test'
         or lower(coalesce(notes, '')) like '%[test]%'
         or lower(coalesce(notes, '')) like '%test booking%'
       );

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id
       and (
         lower(coalesce(email, '')) like '%+test@%'
         or lower(coalesce(name, '')) like '%test%'
       );
  else
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id;
  end if;

  v_preview := jsonb_build_object(
    'success', true,
    'mode', v_mode,
    'cutoff', case when v_mode = 'recent_activity' then v_cutoff else null end,
    'counts', jsonb_build_object(
      'bookings', coalesce(array_length(v_booking_ids, 1), 0),
      'payments', (select count(*) from public.payments where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
      'booking_charges', (select count(*) from public.booking_charges where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
      'invoices', (select count(*) from public.invoices where lodge_id = p_lodge_id and (booking_id = any(v_booking_ids) or booking_id is null)),
      'customers', coalesce(array_length(v_customer_ids, 1), 0),
      'quotations', (select count(*) from public.quotations where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
      'expenses', (select count(*) from public.expenses where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff or coalesce(date::timestamptz, now()) >= v_cutoff)),
      'pos_orders', (select count(*) from public.pos_orders where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
      'maintenance_tickets', (select count(*) from public.maintenance_tickets where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
      'conference_bookings', (select count(*) from public.conference_bookings where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
      'pool_day_use', (select count(*) from public.pool_day_use where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff))
    )
  );

  return v_preview;
end;
$function$;

create or replace function public.reset_test_data(
  p_lodge_id uuid,
  p_mode text default 'full_demo_reset',
  p_days int default 30,
  p_confirmation text default '',
  p_reason text default '',
  p_triggered_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_mode text := coalesce(nullif(p_mode, ''), 'full_demo_reset');
  v_booking_ids uuid[] := '{}'::uuid[];
  v_customer_ids uuid[] := '{}'::uuid[];
  v_counts jsonb;
begin
  if not public.test_mode_enabled_for_lodge(p_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Test mode is not enabled for this lodge');
  end if;

  if p_confirmation <> 'RESET TEST DATA' then
    return jsonb_build_object('success', false, 'error', 'Confirmation phrase did not match');
  end if;

  if v_mode not in ('recent_activity', 'tagged_test_data', 'full_demo_reset') then
    return jsonb_build_object('success', false, 'error', 'Unsupported reset mode');
  end if;

  if v_mode = 'recent_activity' then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id
       and coalesce(created_at, now()) >= v_cutoff;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id
       and coalesce(created_at, now()) >= v_cutoff;
  elsif v_mode = 'tagged_test_data' then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id
       and (
         lower(coalesce(source, '')) = 'test'
         or lower(coalesce(notes, '')) like '%[test]%'
         or lower(coalesce(notes, '')) like '%test booking%'
       );

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id
       and (
         lower(coalesce(email, '')) like '%+test@%'
         or lower(coalesce(name, '')) like '%test%'
       );
  else
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id;
  end if;

  v_counts := jsonb_build_object(
    'bookings', coalesce(array_length(v_booking_ids, 1), 0),
    'payments', (select count(*) from public.payments where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
    'booking_charges', (select count(*) from public.booking_charges where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
    'invoices', (select count(*) from public.invoices where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
    'customers', coalesce(array_length(v_customer_ids, 1), 0),
    'quotations', (select count(*) from public.quotations where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
    'expenses', (select count(*) from public.expenses where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff or coalesce(date::timestamptz, now()) >= v_cutoff)),
    'pos_orders', (select count(*) from public.pos_orders where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
    'maintenance_tickets', (select count(*) from public.maintenance_tickets where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
    'conference_bookings', (select count(*) from public.conference_bookings where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
    'pool_day_use', (select count(*) from public.pool_day_use where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff))
  );

  delete from public.booking_charges where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.payments where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.invoices where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.refund_approval_log where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.financial_audit_log where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.invoice_delivery_log where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.bookings where lodge_id = p_lodge_id and id = any(v_booking_ids);

  if v_mode = 'full_demo_reset' then
    delete from public.quotations where lodge_id = p_lodge_id;
    delete from public.expenses where lodge_id = p_lodge_id;
    delete from public.pos_orders where lodge_id = p_lodge_id;
    delete from public.maintenance_tickets where lodge_id = p_lodge_id;
    delete from public.conference_bookings where lodge_id = p_lodge_id;
    delete from public.pool_day_use where lodge_id = p_lodge_id;
  else
    delete from public.quotations where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
    delete from public.expenses where lodge_id = p_lodge_id and (coalesce(created_at, now()) >= v_cutoff or coalesce(date::timestamptz, now()) >= v_cutoff);
    delete from public.pos_orders where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
    delete from public.maintenance_tickets where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
    delete from public.conference_bookings where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
    delete from public.pool_day_use where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
  end if;

  delete from public.customers
   where lodge_id = p_lodge_id
     and id = any(v_customer_ids)
     and not exists (
       select 1 from public.bookings b
        where b.lodge_id = p_lodge_id
          and b.customer_id = public.customers.id
     );

  insert into public.test_data_reset_audit (
    lodge_id,
    triggered_by,
    reset_mode,
    reason,
    deleted_counts
  ) values (
    p_lodge_id,
    p_triggered_by,
    v_mode,
    nullif(p_reason, ''),
    v_counts
  );

  return jsonb_build_object(
    'success', true,
    'mode', v_mode,
    'deleted_counts', v_counts
  );
end;
$function$;

create or replace function public.get_test_data_reset_audit(
  p_lodge_id uuid,
  p_limit int default 20
)
returns table (
  id uuid,
  lodge_id uuid,
  triggered_by uuid,
  triggered_by_name text,
  reset_mode text,
  reason text,
  deleted_counts jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    a.id,
    a.lodge_id,
    a.triggered_by,
    u.name as triggered_by_name,
    a.reset_mode,
    a.reason,
    a.deleted_counts,
    a.created_at
  from public.test_data_reset_audit a
  left join public.users u on u.id = a.triggered_by
  where a.lodge_id = p_lodge_id
  order by a.created_at desc
  limit greatest(coalesce(p_limit, 20), 1);
$function$;

revoke all on function public.test_mode_enabled_for_lodge(uuid) from public, anon;
grant execute on function public.test_mode_enabled_for_lodge(uuid) to authenticated, service_role;

revoke all on function public.get_test_data_reset_preview(uuid, text, int) from public, anon;
grant execute on function public.get_test_data_reset_preview(uuid, text, int) to authenticated, service_role;

revoke all on function public.reset_test_data(uuid, text, int, text, text, uuid) from public, anon;
grant execute on function public.reset_test_data(uuid, text, int, text, text, uuid) to authenticated, service_role;

revoke all on function public.get_test_data_reset_audit(uuid, int) from public, anon;
grant execute on function public.get_test_data_reset_audit(uuid, int) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

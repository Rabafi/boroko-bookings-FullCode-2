-- Lodge Starter: narrow, view-only operating summary.
--
-- This endpoint deliberately stays separate from the Standard full-report and
-- export boundary. Financial values come from the signed payment ledger. When
-- evidence cannot be certified, monetary fields are NULL.

begin;

-- Keep the authoritative commercial catalogue aligned with the desktop
-- catalogue. Full reports remain a separate Standard feature; this adds only
-- the narrow basic_reports entitlement to accommodation products.
update public.commercial_package_prices package_price
set
  included_features = (
    select jsonb_agg(feature_key order by feature_key)
    from (
      select distinct feature_key
      from jsonb_array_elements_text(
        package_price.included_features || '["basic_reports"]'::jsonb
      ) as feature(feature_key)
    ) features
  ),
  sales_copy = case
    when package_price.product_id = 'lodge-camp'
      and package_price.commercial_package_key = 'starter'
      then 'Daily lodge operations plus a view-only 1, 7, or 30-day operating summary.'
    else package_price.sales_copy
  end
from public.commercial_catalog_versions catalog
where package_price.catalog_version_id = catalog.id
  and catalog.is_active = true
  and (
    (
      package_price.product_id = 'lodge-camp'
      and package_price.commercial_package_key in ('starter', 'standard', 'pro')
    )
    or (
      package_price.product_id = 'hotel'
      and package_price.commercial_package_key = 'hotel_core'
    )
  );

insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key, enabled
)
select
  package_price.catalog_version_id,
  package_price.product_id,
  package_price.commercial_package_key,
  'basic_reports',
  true
from public.commercial_package_prices package_price
join public.commercial_catalog_versions catalog
  on catalog.id = package_price.catalog_version_id
where catalog.is_active = true
  and package_price.included_features ? 'basic_reports'
  and (
    package_price.product_id = 'lodge-camp'
    or (
      package_price.product_id = 'hotel'
      and package_price.commercial_package_key = 'hotel_core'
    )
  )
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key)
do update set enabled = true;

-- Backfill currently valid accommodation licences. DO NOTHING deliberately
-- preserves an existing Command Central feature override, including a manual
-- disablement, rather than silently overwriting operator intent.
with eligible_licences as (
  select distinct l.lodge_id
  from public.licenses l
  join public.settings s on s.lodge_id = l.lodge_id and coalesce(s.deleted, false) = false
  where (
      (l.product_id = 'lodge-camp' and l.commercial_package_key in ('starter', 'standard', 'pro'))
      or (l.product_id = 'hotel' and l.commercial_package_key = 'hotel_core')
      or (
        l.product_id is null
        and l.commercial_package_key is null
        and lower(coalesce(s.property_type, s.business_type, 'lodge'))
          in ('guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort')
        and lower(coalesce(l.subscription_plan, 'starter'))
          in ('starter', 'standard', 'pro', 'premium', 'enterprise')
      )
    )
    and coalesce(l.is_active, true) = true
    and public._subscription_access_allowed(
      public._subscription_state(
        l.payment_status,
        l.next_due_date,
        l.expires_at,
        l.is_active,
        l.grace_period_days
      )
    )
), granted_lodges as (
  insert into public.lodge_features (
    lodge_id, feature_name, enabled, reason, granted_at, updated_at
  )
  select
    lodge_id,
    'basic_reports',
    true,
    'Accommodation package: view-only basic reports included',
    now(),
    now()
  from eligible_licences
  on conflict (lodge_id, feature_name) do nothing
  returning lodge_id
), source_licences as (
  select
    granted_lodges.lodge_id,
    source.id as license_id,
    source.subscription_plan
  from granted_lodges
  cross join lateral (
    select l.id, l.subscription_plan
    from public.licenses l
    where l.lodge_id = granted_lodges.lodge_id
      and coalesce(l.is_active, true) = true
    order by l.activated_at desc nulls last, l.issued_at desc nulls last, l.id desc
    limit 1
  ) source
)
insert into public.activation_audit_log (
  license_id,
  lodge_id,
  action,
  previous_plan,
  new_plan,
  previous_addons,
  new_addons,
  effective_features,
  activated_by,
  activation_reason
)
select
  license_id,
  lodge_id,
  'commercial_entitlement_backfill',
  subscription_plan,
  subscription_plan,
  '[]'::jsonb,
  '[]'::jsonb,
  jsonb_build_object('basic_reports', true),
  'system:migration',
  'Accommodation packages now include view-only basic reports'
from source_licences;

-- Extend the existing operational report gate with the Starter capability.
create or replace function public._restaurant_require_operational_report_access(
  p_lodge_id uuid,
  p_capability text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_get_actor_user_id();
  v_role text;
  v_override jsonb;
begin
  if auth.role() = 'service_role' then return v_actor; end if;

  select lower(coalesce(u.role, '')), u.capability_overrides -> p_capability
    into v_role, v_override
    from public.users u
   where u.id = v_actor
     and u.lodge_id = p_lodge_id
     and coalesce(u.status, 'active') = 'active';

  if not found then
    raise exception 'Operational report access denied' using errcode = '42501';
  end if;

  if v_override is not null and jsonb_typeof(v_override) = 'boolean' then
    if (v_override::text)::boolean is false then
      raise exception 'Operational report capability is disabled' using errcode = '42501';
    end if;
  elsif p_capability = 'pos.view'
    and v_role not in ('cashier', 'supervisor', 'manager', 'finance', 'admin', 'super_admin', 'owner') then
    raise exception 'POS report capability is required' using errcode = '42501';
  elsif p_capability in ('reports.view', 'reports.basic_view')
    and v_role not in ('manager', 'finance', 'admin', 'super_admin', 'owner') then
    raise exception 'Lodge report capability is required' using errcode = '42501';
  end if;

  return v_actor;
end
$$;

revoke all on function public._restaurant_require_operational_report_access(uuid, text)
  from public, anon, authenticated;
grant execute on function public._restaurant_require_operational_report_access(uuid, text)
  to service_role;

create or replace function public.get_starter_basic_report(
  p_lodge_id uuid,
  p_range_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_entitlement jsonb;
  v_timezone text := 'Africa/Gaborone';
  v_end date;
  v_start date;
  v_cutoff timestamptz := clock_timestamp();
  v_total_rooms bigint := 0;
  v_sellable_rooms bigint := 0;
  v_occupied_today bigint := 0;
  v_occupied_room_nights bigint := 0;
  v_arrivals bigint := 0;
  v_departures bigint := 0;
  v_bookings_created bigint := 0;
  v_cancelled bigint := 0;
  v_no_shows bigint := 0;
  v_gross_collections numeric := 0;
  v_refunds numeric := 0;
  v_net_collections numeric := 0;
  v_outstanding numeric := 0;
  v_by_method jsonb := '{}'::jsonb;
  v_trend jsonb := '[]'::jsonb;
  v_missing_booking_financials bigint := 0;
  v_missing_payment_fields bigint := 0;
  v_financial_certified boolean := false;
begin
  v_actor := public._restaurant_require_operational_report_access(
    p_lodge_id,
    'reports.basic_view'
  );

  if auth.role() <> 'service_role' then
    v_entitlement := public.get_lodge_entitlement(p_lodge_id);
    if coalesce((v_entitlement->>'expired')::boolean, true) then
      raise exception 'Basic reports require an active subscription or trial'
        using errcode = '42501';
    end if;
    if coalesce(v_entitlement->>'status', '') <> 'trial' and (
      coalesce(v_entitlement->>'product_id', '') not in ('', 'lodge-camp', 'hotel')
      or coalesce((v_entitlement->'effective_features'->>'basic_reports')::boolean, false) is false
    ) then
      raise exception 'Basic reports are not enabled for this accommodation package'
        using errcode = '42501';
    end if;
  end if;

  if p_range_days not in (1, 7, 30) then
    raise exception 'Basic report range must be one of 1, 7, or 30 days'
      using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(s.timezone), ''), 'Africa/Gaborone')
    into v_timezone
    from public.settings s
   where s.lodge_id = p_lodge_id
   limit 1;
  v_timezone := coalesce(v_timezone, 'Africa/Gaborone');
  v_end := (now() at time zone v_timezone)::date;
  v_start := v_end - (p_range_days - 1);

  select count(*), count(*) filter (where lower(coalesce(r.status, '')) <> 'maintenance')
    into v_total_rooms, v_sellable_rooms
    from public.rooms r
   where r.lodge_id = p_lodge_id;

  select count(distinct b.room_id)
    into v_occupied_today
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and b.room_id is not null
     and lower(coalesce(b.status, '')) not in ('cancelled', 'pending', 'no_show', 'no-show')
     and b.check_in <= v_end
     and b.check_out > v_end;

  select count(*)
    into v_occupied_room_nights
    from generate_series(v_start, v_end, interval '1 day') d
    join public.bookings b
      on b.lodge_id = p_lodge_id
     and b.room_id is not null
     and lower(coalesce(b.status, '')) not in ('cancelled', 'pending', 'no_show', 'no-show')
     and b.check_in <= d::date
     and b.check_out > d::date;

  select
    count(*) filter (
      where b.check_in between v_start and v_end
        and lower(coalesce(b.status, '')) not in ('cancelled', 'no_show', 'no-show')
    ),
    count(*) filter (
      where b.check_out between v_start and v_end
        and lower(coalesce(b.status, '')) not in ('cancelled', 'pending', 'no_show', 'no-show')
    ),
    count(*) filter (
      where (b.created_at at time zone v_timezone)::date between v_start and v_end
    ),
    count(*) filter (
      where b.cancelled_at is not null
        and (b.cancelled_at at time zone v_timezone)::date between v_start and v_end
    ),
    count(*) filter (
      where b.check_in between v_start and v_end
        and lower(coalesce(b.status, '')) in ('no_show', 'no-show')
    )
    into v_arrivals, v_departures, v_bookings_created, v_cancelled, v_no_shows
    from public.bookings b
   where b.lodge_id = p_lodge_id;

  -- Financial coverage is assessed before any monetary value is returned. The
  -- paid balance is derived from SUM(payments.amount), never a cached total.
  select count(*)
    into v_missing_booking_financials
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and lower(coalesce(b.status, '')) not in ('cancelled', 'pending')
     and (b.total_amount is null or b.charges_total is null);

  select count(*)
    into v_missing_payment_fields
    from public.payments p
   where p.lodge_id = p_lodge_id
     and (
       p.amount is null
       or nullif(btrim(p.method), '') is null
       or nullif(btrim(p.type), '') is null
       or (lower(p.type) = 'refund' and p.amount > 0)
       or (lower(p.type) <> 'refund' and p.amount < 0)
     );

  v_financial_certified := v_missing_booking_financials = 0
    and v_missing_payment_fields = 0;

  if v_financial_certified then
    select
      coalesce(sum(case when p.amount > 0 then p.amount else 0 end), 0),
      coalesce(sum(case when p.amount < 0 or lower(p.type) = 'refund' then abs(p.amount) else 0 end), 0),
      coalesce(sum(p.amount), 0)
      into v_gross_collections, v_refunds, v_net_collections
      from public.payments p
     where p.lodge_id = p_lodge_id
       and (p.paid_at at time zone v_timezone)::date between v_start and v_end;

    select coalesce(jsonb_object_agg(method, amount), '{}'::jsonb)
      into v_by_method
      from (
        select lower(btrim(p.method)) as method, round(sum(p.amount), 2) as amount
          from public.payments p
         where p.lodge_id = p_lodge_id
           and (p.paid_at at time zone v_timezone)::date between v_start and v_end
         group by lower(btrim(p.method))
      ) methods;

    with booking_ledger as (
      select
        b.id,
        coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) as gross_total,
        coalesce(sum(p.amount), 0) as net_paid
        from public.bookings b
        left join public.payments p
          on p.booking_id = b.id
         and p.lodge_id = p_lodge_id
       where b.lodge_id = p_lodge_id
         and lower(coalesce(b.status, '')) not in ('cancelled', 'pending')
       group by b.id, b.total_amount, b.charges_total
    )
    select coalesce(sum(greatest(gross_total - net_paid, 0)), 0)
      into v_outstanding
      from booking_ledger;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', d.day,
        'arrivals', d.arrivals,
        'departures', d.departures,
        'bookings_created', d.bookings_created
      ) order by d.day
    ),
    '[]'::jsonb
  )
    into v_trend
    from (
      select
        day::date as day,
        count(b.id) filter (
          where b.check_in = day::date
            and lower(coalesce(b.status, '')) not in ('cancelled', 'no_show', 'no-show')
        ) as arrivals,
        count(b.id) filter (
          where b.check_out = day::date
            and lower(coalesce(b.status, '')) not in ('cancelled', 'pending', 'no_show', 'no-show')
        ) as departures,
        count(b.id) filter (
          where (b.created_at at time zone v_timezone)::date = day::date
        ) as bookings_created
        from generate_series(v_start, v_end, interval '1 day') day
        left join public.bookings b
          on b.lodge_id = p_lodge_id
         and (
           b.check_in = day::date
           or b.check_out = day::date
           or (b.created_at at time zone v_timezone)::date = day::date
         )
       group by day::date
    ) d;

  return jsonb_build_object(
    'success', true,
    'data', jsonb_build_object(
      'schema_version', 'starter-basic-report-v1',
      'report_type', 'starter_basic_summary',
      'range_days', p_range_days,
      'period', jsonb_build_object(
        'start', v_start,
        'end', v_end,
        'business_timezone', v_timezone,
        'database_cutoff_at', v_cutoff
      ),
      'dataset_status', case when v_financial_certified then 'certified' else 'blocked' end,
      'complete', v_financial_certified,
      'source_coverage_status', case when v_financial_certified then 'complete' else 'incomplete_financial_source_rows' end,
      'operational', jsonb_build_object(
        'total_rooms', v_total_rooms,
        'sellable_rooms', v_sellable_rooms,
        'out_of_service_rooms', greatest(v_total_rooms - v_sellable_rooms, 0),
        'occupied_rooms_today', v_occupied_today,
        'available_rooms_today', greatest(v_sellable_rooms - v_occupied_today, 0),
        'occupied_room_nights', v_occupied_room_nights,
        'available_room_nights', greatest((v_sellable_rooms * p_range_days) - v_occupied_room_nights, 0),
        'occupancy_rate', case
          when v_sellable_rooms > 0
            then round((v_occupied_room_nights::numeric / (v_sellable_rooms * p_range_days)::numeric) * 100, 1)
          else 0
        end,
        'occupancy_basis', 'Booked room-nights divided by current sellable rooms for the selected period.',
        'arrivals', v_arrivals,
        'departures', v_departures,
        'bookings_created', v_bookings_created,
        'cancelled', v_cancelled,
        'no_shows', v_no_shows,
        'trend', v_trend
      ),
      'financial', case when v_financial_certified then jsonb_build_object(
        'certified', true,
        'gross_collections', round(v_gross_collections, 2),
        'refunds', round(v_refunds, 2),
        'net_collections', round(v_net_collections, 2),
        'outstanding', round(v_outstanding, 2),
        'by_payment_method', v_by_method
      ) else jsonb_build_object(
        'certified', false,
        'gross_collections', null,
        'refunds', null,
        'net_collections', null,
        'outstanding', null,
        'by_payment_method', null,
        'unavailable_reason', 'One or more active booking or payment ledger rows is incomplete. Financial values are withheld.'
      ) end,
      'read_only', true,
      'generated_by', v_actor
    )
  );
end
$$;

-- The desktop uses an application session over the anon key; authorization is
-- enforced inside the SECURITY DEFINER function before lodge data is read.
revoke all on function public.get_starter_basic_report(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.get_starter_basic_report(uuid, integer)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

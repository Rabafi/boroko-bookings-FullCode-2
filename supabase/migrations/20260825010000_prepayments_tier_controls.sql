-- Tiered Prepayments controls.
--
-- Customer credit remains the only financial source of truth. This migration
-- adds entitlement/capability gates and read-only portfolio helpers around the
-- existing customer_credit_ledger/RPC family; it does not create a second
-- balance or payment ledger.

begin;

-- Commercial package dependencies: Starter exposes the basic prepayment
-- workspace and its guarded core mutations, Standard adds portfolio,
-- reconciliation, and export, and Pro adds ageing, matching, and configuration.
-- Existing ledger rows are deliberately
-- never removed or rewritten during a downgrade.
update public.commercial_package_prices package_price
set included_features = (
  select jsonb_agg(feature_key order by feature_key)
  from (
    select distinct feature_key
    from jsonb_array_elements_text(
      package_price.included_features ||
      case package_price.commercial_package_key
        when 'starter' then '["prepayments_basic"]'::jsonb
        when 'standard' then '["prepayments_basic","prepayments_management"]'::jsonb
        when 'pro' then '["prepayments_basic","prepayments_management","prepayments_advanced"]'::jsonb
        when 'hotel_core' then '["prepayments_basic","prepayments_management","prepayments_advanced"]'::jsonb
        else '[]'::jsonb
      end
    ) as feature(feature_key)
  ) features
)
from public.commercial_catalog_versions catalog
where package_price.catalog_version_id = catalog.id
  and catalog.is_active = true
  and (
    (package_price.product_id = 'lodge-camp' and package_price.commercial_package_key in ('starter', 'standard', 'pro'))
    or (package_price.product_id = 'hotel' and package_price.commercial_package_key = 'hotel_core')
  );

insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key, enabled
)
select
  package_price.catalog_version_id,
  package_price.product_id,
  package_price.commercial_package_key,
  feature.feature_key,
  true
from public.commercial_package_prices package_price
join public.commercial_catalog_versions catalog
  on catalog.id = package_price.catalog_version_id
cross join lateral jsonb_array_elements_text(
  case package_price.commercial_package_key
    when 'starter' then '["prepayments_basic"]'::jsonb
    when 'standard' then '["prepayments_basic","prepayments_management"]'::jsonb
    when 'pro' then '["prepayments_basic","prepayments_management","prepayments_advanced"]'::jsonb
    when 'hotel_core' then '["prepayments_basic","prepayments_management","prepayments_advanced"]'::jsonb
    else '[]'::jsonb
  end
) as feature(feature_key)
where catalog.is_active = true
  and (
    (package_price.product_id = 'lodge-camp' and package_price.commercial_package_key in ('starter', 'standard', 'pro'))
    or (package_price.product_id = 'hotel' and package_price.commercial_package_key = 'hotel_core')
  )
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key)
do update set enabled = true;

-- Backfill only absent rows. A manually disabled lodge feature is an explicit
-- operator override and must not be silently re-enabled by this migration.
with eligible_licences as (
  select distinct l.lodge_id,
    case
      when l.product_id = 'hotel'
        or (l.product_id is null and lower(coalesce(s.property_type, s.business_type, '')) in ('hotel','resort')) then 'hotel_core'
      when l.product_id = 'lodge-camp' and l.commercial_package_key is not null then lower(l.commercial_package_key)
      when l.product_id = 'lodge-camp' or l.product_id is null then
        case
          when lower(coalesce(l.subscription_plan, 'starter')) in ('pro','premium','enterprise') then 'pro'
          when lower(coalesce(l.subscription_plan, 'starter')) = 'standard' then 'standard'
          else 'starter'
        end
    end as package_key
  from public.licenses l
  left join public.settings s on s.lodge_id = l.lodge_id and coalesce(s.deleted, false) = false
  where (
      (l.product_id = 'lodge-camp' and (l.commercial_package_key in ('starter', 'standard', 'pro') or l.commercial_package_key is null))
      or (l.product_id = 'hotel' and (l.commercial_package_key = 'hotel_core' or l.commercial_package_key is null))
      or (l.product_id is null and l.commercial_package_key is null
          and lower(coalesce(s.property_type, s.business_type, ''))
            in ('guest_house','bnb','lodge','camp','motel','hotel','resort'))
    )
    and coalesce(l.is_active, true) = true
    and public._subscription_access_allowed(
      public._subscription_state(
        l.payment_status, l.next_due_date, l.expires_at,
        l.is_active, l.grace_period_days
      )
    )
), package_features as (
  select lodge_id, 'prepayments_basic'::text as feature_name
  from eligible_licences
  union all
  select lodge_id, 'prepayments_management'
  from eligible_licences where package_key in ('standard', 'pro', 'hotel_core')
  union all
  select lodge_id, 'prepayments_advanced'
  from eligible_licences where package_key in ('pro', 'hotel_core')
)
insert into public.lodge_features (
  lodge_id, feature_name, enabled, reason, granted_at, updated_at
)
select lodge_id, feature_name, true, 'Prepayments package entitlement', now(), now()
from package_features
on conflict (lodge_id, feature_name) do nothing;

-- Capability + tenant + package gate used by every customer-credit read and
-- mutation below. The client capability is guidance only; this helper is the
-- authoritative boundary for direct RPC callers as well.
create or replace function public._prepayments_require_capability(
  p_lodge_id uuid,
  p_capability text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := public.app_current_user_id();
  v_role text := lower(coalesce(public.app_current_role(), ''));
  v_override jsonb;
  v_feature text;
  v_allowed boolean;
  v_entitlement jsonb;
begin
  if public.app_is_service_role() then return v_actor; end if;
  if p_lodge_id is null or not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied for this lodge.' using errcode = '42501';
  end if;
  if v_actor is null then
    raise exception 'An authenticated session is required.' using errcode = '42501';
  end if;

  select lower(coalesce(u.role, '')), u.capability_overrides -> p_capability
    into v_role, v_override
    from public.users u
   where u.id = v_actor
     and u.lodge_id = p_lodge_id
     and coalesce(u.status, 'active') = 'active';
  if not found then
    raise exception 'Access denied for this lodge.' using errcode = '42501';
  end if;

  v_feature := case
    when p_capability = 'prepayments.view' then 'prepayments_basic'
    when p_capability = 'prepayments.receive' then 'prepayments_basic'
    when p_capability in ('prepayments.allocate', 'prepayments.refund', 'prepayments.reverse') then 'prepayments_basic'
    when p_capability in ('prepayments.reconcile', 'prepayments.export') then 'prepayments_management'
    when p_capability in ('prepayments.age', 'prepayments.match', 'prepayments.configure') then 'prepayments_advanced'
    else null
  end;
  if v_feature is null then
    raise exception 'Unknown prepayments capability.' using errcode = '42501';
  end if;

  v_entitlement := public.get_lodge_entitlement(p_lodge_id);

  v_allowed := case p_capability
    -- These role sets intentionally mirror the existing customer-credit RPCs.
    -- Do not add aliases here unless app_require_lodge_role accepts them too.
    when 'prepayments.view' then v_role in ('receptionist','finance','manager','admin','super_admin')
    when 'prepayments.receive' then v_role in ('receptionist','finance','manager','admin','super_admin')
    when 'prepayments.allocate' then v_role in ('receptionist','finance','manager','admin','super_admin')
    -- The legacy RPCs allow manager for refund/reversal. Keep that access
    -- behind the management package; Starter remains admin/super_admin only.
    when 'prepayments.refund' then v_role in ('admin','super_admin')
      or (v_role = 'manager' and coalesce((v_entitlement->'effective_features'->>'prepayments_management')::boolean,false))
    when 'prepayments.reverse' then v_role in ('admin','super_admin')
      or (v_role = 'manager' and coalesce((v_entitlement->'effective_features'->>'prepayments_management')::boolean,false))
    when 'prepayments.reconcile' then v_role in ('finance','manager','admin','super_admin')
    when 'prepayments.export' then v_role in ('finance','manager','admin','super_admin')
    when 'prepayments.age' then v_role in ('finance','manager','admin','super_admin')
    when 'prepayments.match' then v_role in ('finance','manager','admin','super_admin')
    when 'prepayments.configure' then v_role in ('admin','super_admin')
    else false
  end;
  -- Capability overrides may revoke a role's capability, but cannot elevate
  -- a receptionist/finance user into refund, reversal, or configuration
  -- authority. Privileged financial actions remain role-bounded server-side.
  if v_override is not null and jsonb_typeof(v_override) = 'boolean'
     and (v_override::text)::boolean is false then
    v_allowed := false;
  end if;
  if not v_allowed then
    raise exception 'Prepayments capability % is required.', p_capability using errcode = '42501';
  end if;

  if coalesce((v_entitlement->'effective_features'->>v_feature)::boolean, false) is not true then
    raise exception 'Prepayments capability % is not enabled for this package.', p_capability using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- Advanced configuration is not financial truth: it only controls operator
-- guidance. It is still append-only-audited and changed atomically. Create
-- these relations before defining the read functions that reference them.
create table if not exists public.prepayment_configuration (
  lodge_id uuid primary key,
  aging_threshold_days jsonb not null default '[30,60,90]'::jsonb,
  matching_tolerance numeric(14,2) not null default 0.01,
  suggestion_window_days integer not null default 365,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint prepayment_configuration_thresholds_chk
    check (jsonb_typeof(aging_threshold_days) = 'array'),
  constraint prepayment_configuration_tolerance_chk
    check (matching_tolerance >= 0 and matching_tolerance <= 100000000),
  constraint prepayment_configuration_window_chk
    check (suggestion_window_days between 1 and 3650)
);

create table if not exists public.prepayment_configuration_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  actor_id uuid,
  idempotency_key text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint prepayment_configuration_audit_key_chk
    check (length(idempotency_key) between 8 and 128
      and idempotency_key ~ '^[A-Za-z0-9:_-]+$')
);
create unique index if not exists prepayment_configuration_audit_operation_uidx
  on public.prepayment_configuration_audit (lodge_id, idempotency_key);
create index if not exists prepayment_configuration_audit_lodge_created_idx
  on public.prepayment_configuration_audit (lodge_id, created_at desc);
alter table public.prepayment_configuration_audit enable row level security;
drop policy if exists prepayment_configuration_audit_lodge_select on public.prepayment_configuration_audit;
create policy prepayment_configuration_audit_lodge_select
  on public.prepayment_configuration_audit for select
  using (public.app_lodge_access(lodge_id));
revoke all on table public.prepayment_configuration_audit from public, anon, authenticated;
grant select on table public.prepayment_configuration_audit to service_role;
create or replace function public.prevent_prepayment_configuration_audit_mutation()
returns trigger language plpgsql security definer set search_path to 'public'
as $$ begin raise exception 'Prepayment configuration audit is append-only.' using errcode='55000'; end; $$;
drop trigger if exists prepayment_configuration_audit_immutable on public.prepayment_configuration_audit;
create trigger prepayment_configuration_audit_immutable
before update or delete on public.prepayment_configuration_audit
for each row execute function public.prevent_prepayment_configuration_audit_mutation();

alter table public.prepayment_configuration enable row level security;
drop policy if exists prepayment_configuration_lodge_select on public.prepayment_configuration;
create policy prepayment_configuration_lodge_select
  on public.prepayment_configuration for select
  using (public.app_lodge_access(lodge_id));
revoke all on table public.prepayment_configuration from public, anon, authenticated;
grant select on table public.prepayment_configuration to service_role;

create or replace function public.get_prepayment_aging(
  p_lodge_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_result jsonb;
  v_thresholds jsonb;
  v_threshold_1 integer;
  v_threshold_2 integer;
  v_threshold_3 integer;
  v_window_days integer;
begin
  v_actor := public._prepayments_require_capability(p_lodge_id, 'prepayments.age');
  p_as_of := coalesce(p_as_of, now());
  select coalesce((select c.aging_threshold_days from public.prepayment_configuration c where c.lodge_id = p_lodge_id), '[30,60,90]'::jsonb),
         coalesce((select c.suggestion_window_days from public.prepayment_configuration c where c.lodge_id = p_lodge_id), 365)
    into v_thresholds, v_window_days;
  if jsonb_typeof(v_thresholds) <> 'array' then
    v_thresholds := '[30,60,90]'::jsonb;
  elsif jsonb_array_length(v_thresholds) <> 3 then
    v_thresholds := '[30,60,90]'::jsonb;
  elsif exists (select 1 from jsonb_array_elements(v_thresholds) x where jsonb_typeof(x) <> 'number') then
    v_thresholds := '[30,60,90]'::jsonb;
  end if;
  v_threshold_1 := (v_thresholds->>0)::integer;
  v_threshold_2 := (v_thresholds->>1)::integer;
  v_threshold_3 := (v_thresholds->>2)::integer;
  with balances as (
    select l.customer_id,
      public.customer_credit_balance(p_lodge_id,l.customer_id) balance,
      coalesce(
        min(l.created_at) filter (where l.entry_type in ('receipt','adjustment_in','reversal_in')),
        max(l.created_at)
      ) first_receipt_at
    from public.customer_credit_ledger l where l.lodge_id=p_lodge_id and l.created_at<=p_as_of
    group by l.customer_id having public.customer_credit_balance(p_lodge_id,l.customer_id)>0
  ), bucketed as (
    select balance,
      greatest(0, floor(extract(epoch from (p_as_of-first_receipt_at))/86400)::integer) age_days,
      case
        when extract(epoch from (p_as_of-first_receipt_at))/86400 < v_threshold_1 then format('0-%s', v_threshold_1 - 1)
        when extract(epoch from (p_as_of-first_receipt_at))/86400 < v_threshold_2 then format('%s-%s', v_threshold_1, v_threshold_2 - 1)
        when extract(epoch from (p_as_of-first_receipt_at))/86400 < v_threshold_3 then format('%s-%s', v_threshold_2, v_threshold_3 - 1)
        else format('%s+', v_threshold_3)
      end bucket,
      case
        when extract(epoch from (p_as_of-first_receipt_at))/86400 < v_threshold_1 then 1
        when extract(epoch from (p_as_of-first_receipt_at))/86400 < v_threshold_2 then 2
        when extract(epoch from (p_as_of-first_receipt_at))/86400 < v_threshold_3 then 3
        else 4
      end bucket_order
    from balances
  ), grouped as (
    select bucket, bucket_order, count(*) customer_count, sum(balance) balance
    from bucketed
    group by bucket, bucket_order
  )
  select jsonb_build_object(
      'buckets', coalesce(jsonb_agg(jsonb_build_object(
        'bucket', bucket, 'customer_count', customer_count, 'balance', round(balance,2)
      ) order by bucket_order), '[]'::jsonb),
      'overdue_liability', round(coalesce(sum(balance) filter (where bucket_order = 4), 0), 2),
      'overdue_customer_count', coalesce(sum(customer_count) filter (where bucket_order = 4), 0),
      'aging_threshold_days', v_thresholds,
      'suggestion_window_days', v_window_days
    ) into v_result from grouped;
  return jsonb_build_object('success',true,'data',v_result || jsonb_build_object(
    'as_of',p_as_of,'read_only',true,'generated_by',v_actor,
    'alerts', case when coalesce((v_result->>'overdue_liability')::numeric,0) > 0 then
      jsonb_build_array(jsonb_build_object(
        'type','overdue_liability','severity','attention',
        'message',format('Credit liability is at or beyond the %s-day ageing threshold.', v_threshold_3),
        'amount',round((v_result->>'overdue_liability')::numeric,2),
        'customer_count',(v_result->>'overdue_customer_count')::integer
      )) else '[]'::jsonb end
  ));
end;
$$;

create or replace function public.get_prepayment_reconciliation(
  p_lodge_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_actor uuid; v_result jsonb;
begin
  v_actor := public._prepayments_require_capability(p_lodge_id, 'prepayments.reconcile');
  if p_start_at is null or p_end_at is null or p_end_at < p_start_at then
    raise exception 'A valid prepayment reconciliation date range is required.' using errcode='22023';
  end if;
  select jsonb_build_object(
    'receipts',coalesce(sum(amount) filter(where entry_type in ('receipt','adjustment_in','reversal_in')),0),
    'allocations',coalesce(sum(amount) filter(where entry_type='booking_allocation'),0),
    'refunds',coalesce(sum(amount) filter(where entry_type='refund'),0),
    'reversal_out',coalesce(sum(amount) filter(where entry_type='reversal_out'),0),
    'reversal_in',coalesce(sum(amount) filter(where entry_type='reversal_in'),0),
    'entry_count',count(*), 'source','customer_credit_ledger',
    'start_at',p_start_at,'end_at',p_end_at,'financial_certified',true
  ) into v_result from public.customer_credit_ledger
  where lodge_id=p_lodge_id and created_at between p_start_at and p_end_at;
  return jsonb_build_object('success',true,'data',v_result || jsonb_build_object('read_only',true,'generated_by',v_actor));
end;
$$;

create or replace function public.get_prepayment_matching_suggestions(
  p_lodge_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_actor uuid; v_suggestions jsonb;
  v_window_days integer;
  v_tolerance numeric;
  v_unmatched_customers integer;
  v_alerts jsonb := '[]'::jsonb;
begin
  v_actor := public._prepayments_require_capability(p_lodge_id, 'prepayments.match');
  select coalesce((select c.suggestion_window_days from public.prepayment_configuration c where c.lodge_id = p_lodge_id), 365),
         coalesce((select c.matching_tolerance from public.prepayment_configuration c where c.lodge_id = p_lodge_id), 0.01)
    into v_window_days, v_tolerance;
  p_limit := greatest(1, least(coalesce(p_limit,50),200));
  select coalesce(jsonb_agg(candidate.suggestion order by candidate.balance desc,candidate.check_in asc), '[]'::jsonb)
    into v_suggestions
  from (
    select jsonb_build_object(
      'customer_id',c.customer_id,'customer_name',c.customer_name,'credit_balance',round(c.balance,2),
      'booking_id',b.id,'booking_number',b.booking_number,
      'outstanding',round(b.outstanding,2),
      'suggested_amount',round(least(c.balance,b.outstanding),2),
      'reason','Same customer has available prepayment and an outstanding booking',
      'auto_applied',false
    ) suggestion, c.balance, b.check_in
    from (
    select l.customer_id,coalesce(cu.name,'Unknown') customer_name,
      public.customer_credit_balance(p_lodge_id,l.customer_id) balance
    from public.customer_credit_ledger l left join public.customers cu on cu.id=l.customer_id
    where l.lodge_id=p_lodge_id group by l.customer_id,cu.name
    having public.customer_credit_balance(p_lodge_id,l.customer_id)>0
  ) c
  join (
    select b.id, b.booking_number, b.customer_id, b.lodge_id, b.check_in,
      greatest(0, coalesce(b.total_amount,0)+coalesce(b.charges_total,0)
        - coalesce(sum(p.amount),0)) as outstanding
    from public.bookings b
    left join public.payments p
      on p.booking_id=b.id and p.lodge_id=p_lodge_id
    where b.lodge_id=p_lodge_id
      and lower(coalesce(b.status,'')) not in ('cancelled','checked_out')
      and b.check_in between (current_date - v_window_days) and (current_date + v_window_days)
    group by b.id, b.booking_number, b.customer_id, b.lodge_id,
      b.check_in, b.total_amount, b.charges_total
  ) b on b.lodge_id=p_lodge_id and b.customer_id=c.customer_id
    and b.outstanding>v_tolerance
    order by c.balance desc,b.check_in asc
    limit p_limit
  ) candidate;
  select count(*)::integer into v_unmatched_customers
  from (
    select l.customer_id,
      public.customer_credit_balance(p_lodge_id,l.customer_id) balance,
      min(l.created_at) filter (where l.entry_type in ('receipt','adjustment_in','reversal_in')) first_receipt_at,
      coalesce(bool_or(l.entry_type = 'booking_allocation'), false) has_allocation
    from public.customer_credit_ledger l
    where l.lodge_id = p_lodge_id
    group by l.customer_id
  ) unmatched
  where balance > 0 and has_allocation = false
    and first_receipt_at < now() - make_interval(days => v_window_days);
  if v_unmatched_customers > 0 then
    v_alerts := jsonb_build_array(jsonb_build_object(
      'type','unmatched_deposits','severity','attention',
      'message',format('%s customer deposit balance(s) have no allocation within the %s-day suggestion window.', v_unmatched_customers, v_window_days),
      'customer_count',v_unmatched_customers
    ));
  end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'suggestions',v_suggestions,'read_only',true,'auto_mutation',false,'generated_by',v_actor,
    'suggestion_window_days',v_window_days,'matching_tolerance',v_tolerance,'alerts',v_alerts));
end;
$$;

create or replace function public.get_prepayment_export(
  p_lodge_id uuid,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_actor uuid; v_rows jsonb;
begin
  v_actor := public._prepayments_require_capability(p_lodge_id, 'prepayments.export');
  if p_start_at is null or p_end_at is null or p_end_at < p_start_at then
    raise exception 'A bounded prepayment export date range is required.' using errcode='22023';
  end if;
  if p_end_at - p_start_at > interval '366 days' then
    raise exception 'Prepayment exports are limited to a maximum 366-day range.' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(
    to_jsonb(l) || jsonb_build_object('customer_name', coalesce(c.name, 'Unknown'))
    order by l.created_at,l.id
  ),'[]'::jsonb) into v_rows
    from public.customer_credit_ledger l
    left join public.customers c on c.id = l.customer_id and c.lodge_id = l.lodge_id
   where l.lodge_id=p_lodge_id
     and (p_start_at is null or l.created_at>=p_start_at)
     and (p_end_at is null or l.created_at<=p_end_at);
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'entries',v_rows,'start_at',p_start_at,'end_at',p_end_at,
    'source','customer_credit_ledger','financial_certified',true,'read_only',true,'generated_by',v_actor));
end;
$$;

revoke all on function public._prepayments_require_capability(uuid, text)
  from public, anon, authenticated;
grant execute on function public._prepayments_require_capability(uuid, text) to service_role;

create or replace function public._prepayments_require_operation_key(p_key text)
returns void
language plpgsql immutable security definer set search_path to 'public'
as $$
begin
  if p_key is null or length(p_key) < 8 or length(p_key) > 128
     or p_key !~ '^[A-Za-z0-9:_-]+$' then
    raise exception 'A stable operation ID between 8 and 128 letters, digits, :, _, or - is required.'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public._prepayments_require_reason(p_reason text, p_action text)
returns void
language plpgsql immutable security definer set search_path to 'public'
as $$
begin
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required for prepayment %.', p_action using errcode = '22023';
  end if;
end;
$$;

revoke all on function public._prepayments_require_operation_key(text), public._prepayments_require_reason(text,text)
  from public, anon, authenticated;
grant execute on function public._prepayments_require_operation_key(text), public._prepayments_require_reason(text,text)
  to service_role;

create table if not exists public.prepayment_export_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  actor_id uuid,
  artifact_sha256 text not null,
  file_name text not null,
  row_count integer not null,
  start_at timestamptz,
  end_at timestamptz,
  created_at timestamptz not null default now(),
  constraint prepayment_export_audit_hash_chk
    check (artifact_sha256 ~ '^[A-Fa-f0-9]{64}$'),
  constraint prepayment_export_audit_file_chk
    check (length(file_name) between 1 and 255 and file_name !~ '[\\/\r\n]'),
  constraint prepayment_export_audit_row_count_chk
    check (row_count between 0 and 10000000),
  constraint prepayment_export_audit_range_chk
    check (end_at is null or start_at is null or end_at >= start_at)
);
create unique index if not exists prepayment_export_audit_artifact_uidx
  on public.prepayment_export_audit (lodge_id, artifact_sha256);
create index if not exists prepayment_export_audit_lodge_created_idx
  on public.prepayment_export_audit (lodge_id, created_at desc);
alter table public.prepayment_export_audit enable row level security;
drop policy if exists prepayment_export_audit_lodge_select on public.prepayment_export_audit;
create policy prepayment_export_audit_lodge_select
  on public.prepayment_export_audit for select
  using (public.app_lodge_access(lodge_id));
revoke all on table public.prepayment_export_audit from public, anon, authenticated;
grant select on table public.prepayment_export_audit to service_role;
create or replace function public.prevent_prepayment_export_audit_mutation()
returns trigger language plpgsql security definer set search_path to 'public'
as $$ begin raise exception 'Prepayment export audit is append-only.' using errcode='55000'; end; $$;
drop trigger if exists prepayment_export_audit_immutable on public.prepayment_export_audit;
create trigger prepayment_export_audit_immutable
before update or delete on public.prepayment_export_audit
for each row execute function public.prevent_prepayment_export_audit_mutation();

create or replace function public.record_prepayment_export_audit(
  p_lodge_id uuid,
  p_artifact_sha256 text,
  p_file_name text,
  p_row_count integer,
  p_start_at timestamptz default null,
  p_end_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_id uuid;
  v_inserted_count integer := 0;
begin
  v_actor := public._prepayments_require_capability(p_lodge_id, 'prepayments.export');
  if p_artifact_sha256 is null or p_artifact_sha256 !~ '^[A-Fa-f0-9]{64}$' then
    raise exception 'A SHA-256 export artifact hash is required.' using errcode = '22023';
  end if;
  if p_file_name is null or length(p_file_name) not between 1 and 255
     or p_file_name ~ '[\\/\r\n]' then
    raise exception 'A safe export file name is required.' using errcode = '22023';
  end if;
  if p_row_count is null or p_row_count not between 0 and 10000000 then
    raise exception 'Export row count is outside the allowed range.' using errcode = '22023';
  end if;
  if p_end_at is not null and p_start_at is not null and p_end_at < p_start_at then
    raise exception 'Export date range is invalid.' using errcode = '22023';
  end if;
  insert into public.prepayment_export_audit (
    lodge_id, actor_id, artifact_sha256, file_name, row_count, start_at, end_at
  ) values (
    p_lodge_id, v_actor, lower(p_artifact_sha256), p_file_name, p_row_count, p_start_at, p_end_at
  ) on conflict (lodge_id, artifact_sha256) do nothing;
  get diagnostics v_inserted_count = row_count;
  select id into v_id from public.prepayment_export_audit
   where lodge_id = p_lodge_id and artifact_sha256 = lower(p_artifact_sha256);
  return jsonb_build_object('success',true,'audit_id',v_id,'idempotent',v_inserted_count = 0);
end;
$$;

create or replace function public.get_prepayment_config(p_lodge_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_actor uuid;
begin
  v_actor := public._prepayments_require_capability(p_lodge_id, 'prepayments.age');
  return jsonb_build_object(
    'success', true,
    'config', coalesce((select jsonb_build_object(
      'aging_threshold_days', aging_threshold_days,
      'matching_tolerance', matching_tolerance,
      'suggestion_window_days', suggestion_window_days,
      'updated_by', updated_by, 'updated_at', updated_at
    ) from public.prepayment_configuration where lodge_id = p_lodge_id),
    jsonb_build_object('aging_threshold_days','[30,60,90]'::jsonb,
      'matching_tolerance',0.01,'suggestion_window_days',365)),
    'generated_by', v_actor
  );
end;
$$;

create or replace function public.set_prepayment_config(
  p_lodge_id uuid,
  p_config jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_claim jsonb;
  v_thresholds jsonb := coalesce(p_config->'aging_threshold_days','[30,60,90]'::jsonb);
  v_tolerance numeric := coalesce((p_config->>'matching_tolerance')::numeric, 0.01);
  v_window integer := coalesce((p_config->>'suggestion_window_days')::integer, 365);
  v_threshold_1 numeric;
  v_threshold_2 numeric;
  v_threshold_3 numeric;
  v_before jsonb;
begin
  v_actor := public._prepayments_require_capability(p_lodge_id, 'prepayments.configure');
  perform public.app_reject_pwa_financial_mutation();
  perform public._prepayments_require_operation_key(p_idempotency_key);
  if jsonb_typeof(v_thresholds) <> 'array' then
    raise exception 'Aging thresholds must be a JSON array of exactly three day values.' using errcode = '22023';
  end if;
  if jsonb_array_length(v_thresholds) <> 3 then
    raise exception 'Provide exactly three ascending ageing thresholds, for example 30, 60, 90.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(v_thresholds) x where jsonb_typeof(x) <> 'number') then
    raise exception 'Ageing thresholds must contain numbers only.' using errcode = '22023';
  end if;
  v_threshold_1 := (v_thresholds->>0)::numeric;
  v_threshold_2 := (v_thresholds->>1)::numeric;
  v_threshold_3 := (v_thresholds->>2)::numeric;
  if v_threshold_1 <> trunc(v_threshold_1)
     or v_threshold_2 <> trunc(v_threshold_2)
     or v_threshold_3 <> trunc(v_threshold_3)
     or v_threshold_1 <= 0 or v_threshold_2 <= v_threshold_1
     or v_threshold_3 <= v_threshold_2 or v_threshold_3 > 3650 then
    raise exception 'Ageing thresholds must be whole, positive, strictly ascending day values (maximum 3650).' using errcode = '22023';
  end if;
  if v_tolerance < 0 or v_tolerance > 100000000 or v_window not between 1 and 3650 then
    raise exception 'Prepayment configuration values are outside the allowed range.' using errcode = '22023';
  end if;
  v_claim := public._claim_financial_operation(
    p_lodge_id, p_idempotency_key, 'set_prepayment_config', p_lodge_id,
    md5(coalesce(p_config,'{}'::jsonb)::text)
  );
  if not coalesce((v_claim->>'success')::boolean, false) then return v_claim; end if;
  if coalesce((v_claim->>'found')::boolean, false) then
    return (v_claim->'operation_result') || jsonb_build_object('idempotent', true);
  end if;
  perform 1 from public.prepayment_configuration
   where lodge_id = p_lodge_id
   for update;
  select jsonb_build_object('aging_threshold_days', aging_threshold_days,
      'matching_tolerance', matching_tolerance,
      'suggestion_window_days', suggestion_window_days)
    into v_before from public.prepayment_configuration where lodge_id = p_lodge_id;
  insert into public.prepayment_configuration (
    lodge_id, aging_threshold_days, matching_tolerance, suggestion_window_days,
    updated_by, updated_at
  ) values (p_lodge_id, v_thresholds, round(v_tolerance,2), v_window, v_actor, now())
  on conflict (lodge_id) do update set
    aging_threshold_days = excluded.aging_threshold_days,
    matching_tolerance = excluded.matching_tolerance,
    suggestion_window_days = excluded.suggestion_window_days,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into public.prepayment_configuration_audit (
    lodge_id, actor_id, idempotency_key, before_snapshot, after_snapshot
  ) values (
    p_lodge_id, v_actor, p_idempotency_key, coalesce(v_before,'{}'::jsonb),
    jsonb_build_object('aging_threshold_days', v_thresholds,
      'matching_tolerance', round(v_tolerance,2),
      'suggestion_window_days', v_window)
  );
  perform public._record_financial_operation(
    p_lodge_id, p_idempotency_key, 'set_prepayment_config', p_lodge_id,
    md5(coalesce(p_config,'{}'::jsonb)::text),
    jsonb_build_object('success',true,'config',jsonb_build_object(
      'aging_threshold_days',v_thresholds,'matching_tolerance',round(v_tolerance,2),
      'suggestion_window_days',v_window))
  );
  return jsonb_build_object('success',true,'idempotent',false,'config',jsonb_build_object(
    'aging_threshold_days',v_thresholds,'matching_tolerance',round(v_tolerance,2),
    'suggestion_window_days',v_window));
end;
$$;

-- Portfolio and reconciliation are read-only projections over the signed
-- customer-credit ledger. Matching suggestions are advisory and never write.
create or replace function public.get_prepayment_portfolio(
  p_lodge_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_actor uuid;
  v_rows jsonb;
  v_total numeric;
  v_overdue numeric;
  v_overdue_customers integer;
  v_unmatched_customers integer;
  v_thresholds jsonb;
  v_threshold_1 integer;
  v_threshold_2 integer;
  v_threshold_3 integer;
  v_window_days integer;
  v_alerts jsonb := '[]'::jsonb;
begin
  v_actor := public._prepayments_require_capability(p_lodge_id, 'prepayments.reconcile');
  p_as_of := coalesce(p_as_of, now());
  select coalesce((select c.aging_threshold_days from public.prepayment_configuration c where c.lodge_id = p_lodge_id), '[30,60,90]'::jsonb),
         coalesce((select c.suggestion_window_days from public.prepayment_configuration c where c.lodge_id = p_lodge_id), 365)
    into v_thresholds, v_window_days;
  if jsonb_typeof(v_thresholds) <> 'array' then
    v_thresholds := '[30,60,90]'::jsonb;
  elsif jsonb_array_length(v_thresholds) <> 3 then
    v_thresholds := '[30,60,90]'::jsonb;
  elsif exists (select 1 from jsonb_array_elements(v_thresholds) x where jsonb_typeof(x) <> 'number') then
    v_thresholds := '[30,60,90]'::jsonb;
  end if;
  v_threshold_1 := (v_thresholds->>0)::integer;
  v_threshold_2 := (v_thresholds->>1)::integer;
  v_threshold_3 := (v_thresholds->>2)::integer;
  select coalesce(sum(balance),0), coalesce(jsonb_agg(jsonb_build_object(
      'customer_id', customer_id, 'customer_name', customer_name,
      'balance', round(balance,2), 'last_activity', last_activity,
      'age_days', age_days,
      'aging_bucket', case
        when age_days < v_threshold_1 then format('0-%s', v_threshold_1 - 1)
        when age_days < v_threshold_2 then format('%s-%s', v_threshold_1, v_threshold_2 - 1)
        when age_days < v_threshold_3 then format('%s-%s', v_threshold_2, v_threshold_3 - 1)
        else format('%s+', v_threshold_3)
      end
    ) order by balance desc), '[]'::jsonb),
    coalesce(sum(balance) filter (where age_days >= v_threshold_3),0),
    coalesce(count(*) filter (where age_days >= v_threshold_3),0)::integer,
    coalesce(count(*) filter (where age_days > v_window_days and has_allocation = false),0)::integer
    into v_total, v_rows, v_overdue, v_overdue_customers, v_unmatched_customers
    from (
      select l.customer_id, coalesce(c.name,'Unknown') customer_name,
        public.customer_credit_balance(p_lodge_id,l.customer_id) balance,
        max(l.created_at) last_activity,
        greatest(0, floor(extract(epoch from (p_as_of - coalesce(
          min(l.created_at) filter (where l.entry_type in ('receipt','adjustment_in','reversal_in')),
          max(l.created_at)
        )))/86400)::integer) age_days,
        coalesce(bool_or(l.entry_type = 'booking_allocation'), false) has_allocation
      from public.customer_credit_ledger l
      left join public.customers c on c.id = l.customer_id
      where l.lodge_id = p_lodge_id and l.created_at <= p_as_of
      group by l.customer_id,c.name
      having public.customer_credit_balance(p_lodge_id,l.customer_id) > 0
    ) balances;
  if v_overdue > 0 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'type','overdue_liability','severity','attention',
      'message',format('Credit liability is at or beyond the %s-day ageing threshold.', v_threshold_3),
      'amount',round(v_overdue,2),'customer_count',v_overdue_customers
    ));
  end if;
  if v_unmatched_customers > 0 then
    v_alerts := v_alerts || jsonb_build_array(jsonb_build_object(
      'type','unmatched_deposits','severity','attention',
      'message',format('%s customer deposit balance(s) have no allocation within the %s-day suggestion window.', v_unmatched_customers, v_window_days),
      'customer_count',v_unmatched_customers
    ));
  end if;
  return jsonb_build_object('success',true,'data',jsonb_build_object(
    'total_liability',round(v_total,2),'customer_count',jsonb_array_length(v_rows),
    'customers',v_rows,'as_of',p_as_of,'source','customer_credit_ledger',
    'financial_certified',true,'read_only',true,'generated_by',v_actor,
    'aging_threshold_days',v_thresholds,'suggestion_window_days',v_window_days,
    'alerts',v_alerts));
end;
$$;

-- Reads are explicitly view-gated; money remains in the customer-credit
-- ledger and therefore remains readable under the lower Starter tier.
do $$
declare v_signature text; v_definition text; v_pos integer; v_marker text := E'begin\n';
begin
  for v_signature in select * from (values
    ('public.get_customer_credit_balance(uuid,uuid)'),
    ('public.get_customer_credit_history(uuid,uuid,integer,integer)'),
    ('public.get_customer_credit_summary(uuid,text,integer,integer)'),
    ('public.get_customer_credit_cash_flow(uuid,timestamptz,timestamptz)')
  ) signatures(signature) loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    v_pos := strpos(lower(v_definition), v_marker);
    if v_pos = 0 then raise exception 'Could not locate customer-credit function body'; end if;
    v_definition := substr(v_definition, 1, v_pos + length(v_marker) - 1)
      || E'  perform public._prepayments_require_capability(p_lodge_id, ''prepayments.view'');\n'
      || substr(v_definition, v_pos + length(v_marker));
    execute v_definition;
  end loop;
end;
$$;

-- Existing mutation bodies retain their atomic locks, ledger writes, audit
-- records, and financial-operation idempotency. Only the new capability gate
-- is inserted ahead of the established PWA/replay guards.
-- refund_customer_credit additionally invokes
-- _prepayments_require_reason(p_notes, ''refund''); reverse_customer_credit_entry
-- invokes _prepayments_require_reason(p_notes, ''reverse'').
do $$
declare v_signature text; v_capability text; v_reason_action text; v_definition text; v_pos integer; v_marker text := E'begin\n'; v_guard text;
begin
  for v_signature, v_capability, v_reason_action in select signature, capability, reason_action from (values
    ('public.record_customer_credit(uuid,uuid,numeric,text,text,text,text,uuid)','prepayments.receive',null::text),
    ('public.apply_customer_credit_to_booking(uuid,uuid,uuid,numeric,text,text,uuid,timestamptz)','prepayments.allocate',null::text),
    ('public.refund_customer_credit(uuid,uuid,numeric,text,text,text,text,uuid,uuid)','prepayments.refund','refund'),
    ('public.reverse_customer_credit_entry(uuid,uuid,text,text,uuid)','prepayments.reverse','reverse')
  ) capabilities(signature, capability, reason_action) loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    v_pos := strpos(lower(v_definition), v_marker);
    if v_pos = 0 then raise exception 'Could not locate customer-credit mutation body'; end if;
    v_guard := format(E'  perform public._prepayments_require_capability(p_lodge_id, ''%s'');\n  perform public._prepayments_require_operation_key(p_idempotency_key);\n', v_capability);
    if v_reason_action is not null then
      v_guard := v_guard || format(E'  perform public._prepayments_require_reason(p_notes, ''%s'');\n', v_reason_action);
    end if;
    v_definition := substr(v_definition, 1, v_pos + length(v_marker) - 1)
      || v_guard
      || substr(v_definition, v_pos + length(v_marker));
    execute v_definition;
  end loop;
end;
$$;

revoke all on function public.get_prepayment_config(uuid), public.set_prepayment_config(uuid,jsonb,text),
  public.get_prepayment_portfolio(uuid,timestamptz), public.get_prepayment_aging(uuid,timestamptz),
  public.get_prepayment_reconciliation(uuid,timestamptz,timestamptz),
  public.get_prepayment_matching_suggestions(uuid,integer), public.get_prepayment_export(uuid,timestamptz,timestamptz)
  from public, anon, authenticated;
grant execute on function public.get_prepayment_config(uuid) to anon, authenticated, service_role;
grant execute on function public.set_prepayment_config(uuid,jsonb,text) to anon, authenticated, service_role;
grant execute on function public.get_prepayment_portfolio(uuid,timestamptz) to anon, authenticated, service_role;
grant execute on function public.get_prepayment_aging(uuid,timestamptz) to anon, authenticated, service_role;
grant execute on function public.get_prepayment_reconciliation(uuid,timestamptz,timestamptz) to anon, authenticated, service_role;
grant execute on function public.get_prepayment_matching_suggestions(uuid,integer) to anon, authenticated, service_role;
grant execute on function public.get_prepayment_export(uuid,timestamptz,timestamptz) to anon, authenticated, service_role;
revoke all on function public.record_prepayment_export_audit(uuid,text,text,integer,timestamptz,timestamptz),
  public.prevent_prepayment_export_audit_mutation(),
  public.prevent_prepayment_configuration_audit_mutation()
  from public, anon, authenticated;
grant execute on function public.record_prepayment_export_audit(uuid,text,text,integer,timestamptz,timestamptz)
  to authenticated, service_role;
grant execute on function public.prevent_prepayment_export_audit_mutation(),
  public.prevent_prepayment_configuration_audit_mutation() to service_role;

notify pgrst, 'reload schema';
commit;

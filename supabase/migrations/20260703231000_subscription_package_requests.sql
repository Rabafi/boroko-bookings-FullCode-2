-- Phase 2: Dedicated commercial request data model
-- subscription_package_requests replaces the support-ticket bridge for upgrade/addon requests.

create table if not exists public.subscription_package_requests (
  id              uuid primary key default gen_random_uuid(),
  source          text not null default 'desktop_app',
  request_type    text not null default 'plan_upgrade',
  lodge_id        uuid,
  existing_license_id uuid,
  company_name    text not null default '',
  property_name   text not null default '',
  contact_name    text not null default '',
  contact_email   text not null default '',
  contact_phone   text not null default '',
  country         text not null default '',
  property_type   text not null default 'lodge',
  current_plan    text,
  requested_plan  text not null default 'Starter',
  requested_addons jsonb not null default '[]'::jsonb,
  room_count      integer,
  user_count      integer,
  expected_monthly_bookings integer,
  pricing_snapshot jsonb,
  quote_number    text,
  quote_pdf_path_or_url text,
  notes           text not null default '',
  status          text not null default 'draft',
  submitted_at    timestamptz not null default now(),
  reviewed_at     timestamptz,
  reviewed_by     text,
  activated_at    timestamptz,
  activated_by    text,
  activation_payload jsonb,
  rejection_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.subscription_package_requests is 'Commercial subscription upgrade and add-on requests. Replaces support-ticket bridge.';

create index if not exists idx_subscription_package_requests_status on public.subscription_package_requests (status);
create index if not exists idx_subscription_package_requests_lodge on public.subscription_package_requests (lodge_id);
create index if not exists idx_subscription_package_requests_submitted on public.subscription_package_requests (submitted_at desc);

-- RPC: Submit a new subscription package request (client-facing, anon or authenticated)
create or replace function public.submit_subscription_request(
  p_source          text default 'desktop_app',
  p_request_type    text default 'plan_upgrade',
  p_lodge_id        uuid default null,
  p_existing_license_id uuid default null,
  p_company_name    text default '',
  p_property_name   text default '',
  p_contact_name    text default '',
  p_contact_email   text default '',
  p_contact_phone   text default '',
  p_country         text default '',
  p_property_type   text default 'lodge',
  p_current_plan    text default null,
  p_requested_plan  text default 'Starter',
  p_requested_addons jsonb default '[]'::jsonb,
  p_room_count      integer default null,
  p_user_count      integer default null,
  p_expected_monthly_bookings integer default null,
  p_pricing_snapshot jsonb default null,
  p_quote_number    text default null,
  p_notes           text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
begin
  insert into public.subscription_package_requests (
    source, request_type, lodge_id, existing_license_id,
    company_name, property_name, contact_name, contact_email, contact_phone,
    country, property_type, current_plan, requested_plan, requested_addons,
    room_count, user_count, expected_monthly_bookings,
    pricing_snapshot, quote_number, notes, status, submitted_at, created_at, updated_at
  ) values (
    p_source, p_request_type, p_lodge_id, p_existing_license_id,
    p_company_name, p_property_name, p_contact_name, p_contact_email, p_contact_phone,
    p_country, p_property_type, p_current_plan, p_requested_plan, p_requested_addons,
    p_room_count, p_user_count, p_expected_monthly_bookings,
    p_pricing_snapshot, p_quote_number, p_notes, 'submitted', v_now, v_now, v_now
  ) returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'submitted_at', v_now);
end;
$$;

-- RPC: Admin gets all subscription requests (paginated)
create or replace function public.get_subscription_requests(
  p_status  text default null,
  p_limit   integer default 50,
  p_offset  integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_total integer;
begin
  select count(*) into v_total
  from public.subscription_package_requests r
  where (p_status is null or r.status = p_status);

  select coalesce(jsonb_agg(row_to_json(r) order by r.submitted_at desc), '[]'::jsonb)
  into v_rows
  from (
    select * from public.subscription_package_requests r
    where (p_status is null or r.status = p_status)
    order by r.submitted_at desc
    limit p_limit offset p_offset
  ) r;

  return jsonb_build_object('rows', v_rows, 'total', v_total);
end;
$$;

-- RPC: Admin updates request status
create or replace function public.update_subscription_request_status(
  p_request_id   uuid,
  p_status       text,
  p_reviewed_by  text default null,
  p_rejection_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_valid_statuses text[] := array['draft','submitted','quoted','invoice_sent','payment_under_review','approved','activated','rejected','expired'];
begin
  if p_request_id is null then
    return jsonb_build_object('success', false, 'error', 'Request ID is required');
  end if;

  if p_status is null or not (p_status = any(v_valid_statuses)) then
    return jsonb_build_object('success', false, 'error', 'Invalid status: ' || coalesce(p_status, 'null'));
  end if;

  update public.subscription_package_requests set
    status = p_status,
    reviewed_at = case when p_status in ('quoted','invoice_sent','payment_under_review','approved','rejected','activated') then v_now else reviewed_at end,
    reviewed_by = case when p_status in ('quoted','invoice_sent','payment_under_review','approved','rejected','activated') then coalesce(p_reviewed_by, reviewed_by) else reviewed_by end,
    activated_at = case when p_status = 'activated' then v_now else activated_at end,
    activated_by = case when p_status = 'activated' then coalesce(p_reviewed_by, activated_by) else activated_by end,
    rejection_reason = case when p_status = 'rejected' then p_rejection_reason else rejection_reason end,
    updated_at = v_now
  where id = p_request_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  return jsonb_build_object('success', true, 'id', p_request_id, 'status', p_status, 'updated_at', v_now);
end;
$$;

-- RPC: Admin activates a request (sets activation payload and status)
create or replace function public.activate_subscription_request(
  p_request_id        uuid,
  p_activated_by      text default 'admin',
  p_activation_payload jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_request record;
begin
  select * into v_request
  from public.subscription_package_requests
  where id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  if v_request.status not in ('approved', 'payment_under_review') then
    return jsonb_build_object('success', false, 'error', 'Request must be approved or payment_under_review before activation');
  end if;

  update public.subscription_package_requests set
    status = 'activated',
    activated_at = v_now,
    activated_by = p_activated_by,
    activation_payload = p_activation_payload,
    updated_at = v_now
  where id = p_request_id;

  return jsonb_build_object(
    'success', true,
    'id', p_request_id,
    'status', 'activated',
    'activated_at', v_now,
    'activated_by', p_activated_by
  );
end;
$$;

-- RPC: Get a single request by ID (for detail view)
create or replace function public.get_subscription_request_by_id(
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  select row_to_json(r) into v_row
  from public.subscription_package_requests r
  where r.id = p_request_id;

  if v_row is null then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  return jsonb_build_object('success', true, 'request', v_row);
end;
$$;

-- RPC: Public submit (anonymous, for booking-site)
create or replace function public.submit_public_subscription_request(
  p_company_name    text default '',
  p_property_name   text default '',
  p_contact_name    text default '',
  p_contact_email   text default '',
  p_contact_phone   text default '',
  p_country         text default '',
  p_property_type   text default 'lodge',
  p_requested_plan  text default 'Starter',
  p_requested_addons jsonb default '[]'::jsonb,
  p_room_count      integer default null,
  p_user_count      integer default null,
  p_expected_monthly_bookings integer default null,
  p_notes           text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_now timestamptz := now();
  v_quote_number text;
begin
  -- Generate quote number: QT-YYYYMMDD-HHMMSSms
  v_quote_number := 'QT-' || to_char(v_now, 'YYYYMMDD-HH24MISS') || lpad(extract(milliseconds from v_now)::text, 3, '0');

  insert into public.subscription_package_requests (
    source, request_type, company_name, property_name,
    contact_name, contact_email, contact_phone,
    country, property_type, current_plan, requested_plan, requested_addons,
    room_count, user_count, expected_monthly_bookings,
    notes, quote_number, status, submitted_at, created_at, updated_at
  ) values (
    'public_website', 'new_subscription', p_company_name, p_property_name,
    p_contact_name, p_contact_email, p_contact_phone,
    p_country, p_property_type, null, p_requested_plan, p_requested_addons,
    p_room_count, p_user_count, p_expected_monthly_bookings,
    p_notes, v_quote_number, 'submitted', v_now, v_now, v_now
  ) returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'quote_number', v_quote_number, 'submitted_at', v_now);
end;
$$;

-- RLS: Allow anon to submit public requests
alter table public.subscription_package_requests enable row level security;

create policy "Anon can insert public subscription requests"
  on public.subscription_package_requests
  for insert
  to anon
  with check (true);

create policy "Authenticated users can read own subscription requests"
  on public.subscription_package_requests
  for select
  to authenticated
  using (
    lodge_id is null
    or lodge_id::text = current_setting('request.jwt.claims', true)::jsonb->>'lodge_id'
    or current_setting('request.jwt.claims', true)::jsonb->>'is_master_admin' = 'true'
  );

-- updated_at trigger
create or replace function public.handle_subscription_package_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscription_package_requests_updated_at on public.subscription_package_requests;
create trigger subscription_package_requests_updated_at
  before update on public.subscription_package_requests
  for each row
  execute function public.handle_subscription_package_requests_updated_at();

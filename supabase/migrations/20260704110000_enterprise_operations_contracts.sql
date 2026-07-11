-- Enterprise operations contracts for commercial add-ons and hotel-grade workflows.
-- These tables store setup/readiness records, requests, documents, and controlled
-- queues. They do not settle payments or perform live OTA/channel integration.

create table if not exists public.enterprise_workflow_records (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  workflow_key text not null,
  record_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, workflow_key, record_key)
);

create table if not exists public.enterprise_workflow_events (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  workflow_key text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.enterprise_payment_link_requests (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid,
  quotation_id uuid,
  customer_id uuid,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'BWP',
  purpose text not null default 'balance',
  status text not null default 'requested',
  provider text,
  provider_reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_channel_sync_items (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  channel_key text not null,
  sync_type text not null,
  source_key text,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, channel_key, idempotency_key)
);

create table if not exists public.enterprise_guest_messages (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid,
  customer_id uuid,
  template_key text,
  channel text not null default 'manual',
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_guest_portal_requests (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid,
  customer_id uuid,
  request_type text not null,
  status text not null default 'new',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_revenue_recommendations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  room_type_id uuid,
  rate_plan_id uuid,
  recommendation_date date not null default current_date,
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_guest_crm_notes (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  customer_id uuid,
  note_type text not null default 'preference',
  visibility text not null default 'staff',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_documents (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  document_type text not null,
  subject_type text,
  subject_id uuid,
  document_number text,
  status text not null default 'draft',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enterprise_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  report_key text not null,
  period_start date,
  period_end date,
  basis text not null default 'estimate',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists enterprise_workflow_records_lodge_idx
  on public.enterprise_workflow_records(lodge_id, workflow_key);
create index if not exists enterprise_workflow_events_lodge_idx
  on public.enterprise_workflow_events(lodge_id, workflow_key, created_at desc);
create index if not exists enterprise_payment_link_requests_lodge_idx
  on public.enterprise_payment_link_requests(lodge_id, status, created_at desc);
create index if not exists enterprise_channel_sync_items_lodge_idx
  on public.enterprise_channel_sync_items(lodge_id, status, created_at desc);
create index if not exists enterprise_guest_messages_lodge_idx
  on public.enterprise_guest_messages(lodge_id, status, created_at desc);
create index if not exists enterprise_guest_portal_requests_lodge_idx
  on public.enterprise_guest_portal_requests(lodge_id, status, created_at desc);
create index if not exists enterprise_revenue_recommendations_lodge_idx
  on public.enterprise_revenue_recommendations(lodge_id, status, recommendation_date);
create index if not exists enterprise_guest_crm_notes_lodge_idx
  on public.enterprise_guest_crm_notes(lodge_id, customer_id, created_at desc);
create index if not exists enterprise_documents_lodge_idx
  on public.enterprise_documents(lodge_id, document_type, created_at desc);
create index if not exists enterprise_report_snapshots_lodge_idx
  on public.enterprise_report_snapshots(lodge_id, report_key, created_at desc);

alter table public.enterprise_workflow_records enable row level security;
alter table public.enterprise_workflow_events enable row level security;
alter table public.enterprise_payment_link_requests enable row level security;
alter table public.enterprise_channel_sync_items enable row level security;
alter table public.enterprise_guest_messages enable row level security;
alter table public.enterprise_guest_portal_requests enable row level security;
alter table public.enterprise_revenue_recommendations enable row level security;
alter table public.enterprise_guest_crm_notes enable row level security;
alter table public.enterprise_documents enable row level security;
alter table public.enterprise_report_snapshots enable row level security;

create or replace function public.enterprise_validate_workflow_key(p_workflow_key text)
returns text
language plpgsql
stable
as $$
declare
  v_key text := nullif(btrim(coalesce(p_workflow_key, '')), '');
begin
  if v_key not in (
    'custom_website',
    'payment_gateway',
    'channel_manager',
    'guest_messaging',
    'guest_portal',
    'multi_property',
    'revenue_manager',
    'advanced_reporting',
    'guest_crm',
    'operations_compliance',
    'multi_outlet_pos'
  ) then
    raise exception 'Unknown Enterprise workflow';
  end if;
  return v_key;
end;
$$;

create or replace function public.get_enterprise_workflow_records(
  p_lodge_id uuid,
  p_workflow_key text
)
returns setof public.enterprise_workflow_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow_key text := public.enterprise_validate_workflow_key(p_workflow_key);
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  return query
    select *
      from public.enterprise_workflow_records
     where lodge_id = p_lodge_id
       and workflow_key = v_workflow_key
     order by updated_at desc;
end;
$$;

create or replace function public.upsert_enterprise_workflow_record(
  p_lodge_id uuid,
  p_workflow_key text,
  p_record_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow_key text := public.enterprise_validate_workflow_key(p_workflow_key);
  v_record_key text := nullif(btrim(coalesce(p_record_key, '')), '');
  v_record_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  if v_record_key is null then
    return jsonb_build_object('success', false, 'error', 'Record key is required');
  end if;

  insert into public.enterprise_workflow_records (
    lodge_id, workflow_key, record_key, payload, status, updated_at
  )
  values (
    p_lodge_id,
    v_workflow_key,
    v_record_key,
    coalesce(p_payload, '{}'::jsonb),
    coalesce(nullif(p_payload->>'status', ''), 'draft'),
    now()
  )
  on conflict (lodge_id, workflow_key, record_key)
  do update set
    payload = excluded.payload,
    status = excluded.status,
    updated_at = now()
  returning id into v_record_id;

  insert into public.enterprise_workflow_events (lodge_id, workflow_key, event_type, payload)
  values (p_lodge_id, v_workflow_key, 'record_upserted', jsonb_build_object('record_id', v_record_id, 'record_key', v_record_key));

  return jsonb_build_object('success', true, 'record_id', v_record_id);
end;
$$;

create or replace function public.append_enterprise_workflow_event(
  p_lodge_id uuid,
  p_workflow_key text,
  p_event_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workflow_key text := public.enterprise_validate_workflow_key(p_workflow_key);
  v_event_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  insert into public.enterprise_workflow_events (lodge_id, workflow_key, event_type, payload)
  values (p_lodge_id, v_workflow_key, nullif(btrim(coalesce(p_event_type, 'note')), ''), coalesce(p_payload, '{}'::jsonb))
  returning id into v_event_id;

  return jsonb_build_object('success', true, 'event_id', v_event_id);
end;
$$;

create or replace function public.create_payment_link_request(
  p_lodge_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_amount numeric := coalesce(nullif(p_payload->>'amount', '')::numeric, 0);
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  if v_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Payment link amount must be greater than zero');
  end if;

  insert into public.enterprise_payment_link_requests (
    lodge_id, booking_id, quotation_id, customer_id, amount, currency, purpose, status, provider, payload
  )
  values (
    p_lodge_id,
    nullif(p_payload->>'booking_id', '')::uuid,
    nullif(p_payload->>'quotation_id', '')::uuid,
    nullif(p_payload->>'customer_id', '')::uuid,
    v_amount,
    coalesce(nullif(p_payload->>'currency', ''), 'BWP'),
    coalesce(nullif(p_payload->>'purpose', ''), 'balance'),
    'requested',
    nullif(p_payload->>'provider', ''),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  insert into public.enterprise_workflow_events (lodge_id, workflow_key, event_type, payload)
  values (p_lodge_id, 'payment_gateway', 'payment_link_requested', jsonb_build_object('request_id', v_id, 'amount', v_amount));

  return jsonb_build_object('success', true, 'request_id', v_id, 'status', 'requested');
end;
$$;

create or replace function public.create_channel_sync_item(
  p_lodge_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_channel_key text := nullif(btrim(coalesce(p_payload->>'channel_key', '')), '');
  v_idempotency_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  if v_channel_key is null then
    return jsonb_build_object('success', false, 'error', 'Channel key is required');
  end if;
  if v_idempotency_key is null then
    return jsonb_build_object('success', false, 'error', 'Channel sync idempotency key is required');
  end if;

  insert into public.enterprise_channel_sync_items (
    lodge_id, channel_key, sync_type, source_key, payload, idempotency_key, status
  )
  values (
    p_lodge_id,
    v_channel_key,
    coalesce(nullif(p_payload->>'sync_type', ''), 'manual_review'),
    nullif(p_payload->>'source_key', ''),
    coalesce(p_payload, '{}'::jsonb),
    v_idempotency_key,
    'queued'
  )
  on conflict (lodge_id, channel_key, idempotency_key)
  do update set
    payload = excluded.payload,
    updated_at = now()
  returning id into v_id;

  insert into public.enterprise_workflow_events (lodge_id, workflow_key, event_type, payload)
  values (p_lodge_id, 'channel_manager', 'channel_sync_queued', jsonb_build_object('sync_item_id', v_id, 'channel_key', v_channel_key));

  return jsonb_build_object('success', true, 'sync_item_id', v_id, 'status', 'queued');
end;
$$;

create or replace function public.create_enterprise_document(
  p_lodge_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_document_type text := nullif(btrim(coalesce(p_payload->>'document_type', '')), '');
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  if v_document_type is null then
    return jsonb_build_object('success', false, 'error', 'Document type is required');
  end if;

  insert into public.enterprise_documents (
    lodge_id, document_type, subject_type, subject_id, document_number, status, payload
  )
  values (
    p_lodge_id,
    v_document_type,
    nullif(p_payload->>'subject_type', ''),
    nullif(p_payload->>'subject_id', '')::uuid,
    coalesce(nullif(p_payload->>'document_number', ''), upper(v_document_type) || '-' || to_char(now(), 'YYYYMMDDHH24MISS')),
    coalesce(nullif(p_payload->>'status', ''), 'draft'),
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  insert into public.enterprise_workflow_events (lodge_id, workflow_key, event_type, payload)
  values (p_lodge_id, 'advanced_reporting', 'document_created', jsonb_build_object('document_id', v_id, 'document_type', v_document_type));

  return jsonb_build_object('success', true, 'document_id', v_id);
end;
$$;

revoke all on function public.get_enterprise_workflow_records(uuid, text) from public;
revoke all on function public.upsert_enterprise_workflow_record(uuid, text, text, jsonb) from public;
revoke all on function public.append_enterprise_workflow_event(uuid, text, text, jsonb) from public;
revoke all on function public.create_payment_link_request(uuid, jsonb) from public;
revoke all on function public.create_channel_sync_item(uuid, jsonb) from public;
revoke all on function public.create_enterprise_document(uuid, jsonb) from public;

grant execute on function public.get_enterprise_workflow_records(uuid, text) to authenticated, service_role;
grant execute on function public.upsert_enterprise_workflow_record(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.append_enterprise_workflow_event(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.create_payment_link_request(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_channel_sync_item(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_enterprise_document(uuid, jsonb) to authenticated, service_role;

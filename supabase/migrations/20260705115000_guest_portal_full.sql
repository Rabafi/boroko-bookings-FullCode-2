-- Guest Portal: config, sessions, and self-service request management
-- Enhances enterprise_guest_portal_requests table from enterprise_operations_contracts

create table if not exists public.guest_portal_config (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  portal_enabled boolean not null default false,
  allowed_actions jsonb not null default '["view_booking"]'::jsonb,
  branding jsonb not null default '{}'::jsonb,
  required_upload_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id)
);

create table if not exists public.guest_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  customer_id uuid not null,
  booking_id uuid,
  token text not null,
  expires_at timestamptz not null,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  unique (token)
);

create index if not exists guest_portal_sessions_token_idx
  on public.guest_portal_sessions(token);
create index if not exists guest_portal_sessions_lodge_idx
  on public.guest_portal_sessions(lodge_id, customer_id);
create index if not exists guest_portal_config_lodge_idx
  on public.guest_portal_config(lodge_id);

alter table public.guest_portal_config enable row level security;
alter table public.guest_portal_sessions enable row level security;

-- RPC: get guest portal config
create or replace function public.get_guest_portal_config(p_lodge_id uuid)
returns setof public.guest_portal_config
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  return query
    select *
      from public.guest_portal_config
     where lodge_id = p_lodge_id;
end;
$$;

-- RPC: update guest portal config
create or replace function public.update_guest_portal_config(
  p_lodge_id uuid,
  p_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  insert into public.guest_portal_config (
    lodge_id, portal_enabled, allowed_actions, branding, required_upload_fields
  )
  values (
    p_lodge_id,
    coalesce((p_config->>'portal_enabled')::boolean, false),
    coalesce(p_config->'allowed_actions', '["view_booking"]'::jsonb),
    coalesce(p_config->'branding', '{}'::jsonb),
    coalesce(p_config->'required_upload_fields', '[]'::jsonb)
  )
  on conflict (lodge_id)
  do update set
    portal_enabled       = coalesce((p_config->>'portal_enabled')::boolean, guest_portal_config.portal_enabled),
    allowed_actions      = coalesce(p_config->'allowed_actions', guest_portal_config.allowed_actions),
    branding             = coalesce(p_config->'branding', guest_portal_config.branding),
    required_upload_fields = coalesce(p_config->'required_upload_fields', guest_portal_config.required_upload_fields),
    updated_at           = now();

  return jsonb_build_object('success', true);
end;
$$;

-- RPC: create guest portal session (generates secure token)
create or replace function public.create_guest_portal_session(
  p_customer_email text,
  p_booking_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer record;
  v_booking record;
  v_lodge_id uuid;
  v_token text;
  v_session_id uuid;
begin
  if nullif(btrim(p_customer_email), '') is null then
    return jsonb_build_object('success', false, 'error', 'Customer email is required');
  end if;

  select c.id, c.name, c.lodge_id into v_customer
    from public.customers c
   where c.email = p_customer_email;

  if not found then
    return jsonb_build_object('success', false, 'error', 'No customer found with this email');
  end if;

  if nullif(btrim(p_booking_reference), '') is not null then
    select b.id, b.check_in, b.check_out, b.status into v_booking
      from public.bookings b
     where b.lodge_id = v_customer.lodge_id
       and b.customer_id = v_customer.id
       and (b.id::text = p_booking_reference or b.booking_reference = p_booking_reference);
  end if;

  v_lodge_id := v_customer.lodge_id;
  v_token := encode(gen_random_bytes(32), 'hex');

  insert into public.guest_portal_sessions (
    lodge_id, customer_id, booking_id, token, expires_at, last_activity_at
  )
  values (
    v_lodge_id,
    v_customer.id,
    v_booking.id,
    v_token,
    now() + interval '7 days',
    now()
  )
  returning id into v_session_id;

  return jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'token', v_token,
    'expires_at', (now() + interval '7 days')::text,
    'customer_name', v_customer.name,
    'lodge_id', v_lodge_id
  );
end;
$$;

-- RPC: validate guest portal session
create or replace function public.validate_guest_portal_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  if nullif(btrim(p_token), '') is null then
    return jsonb_build_object('success', false, 'error', 'Token is required');
  end if;

  select s.*, c.name as customer_name, c.email as customer_email, b.check_in, b.check_out, b.status as booking_status
    into v_session
    from public.guest_portal_sessions s
    join public.customers c on c.id = s.customer_id
    left join public.bookings b on b.id = s.booking_id
   where s.token = p_token;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid session token');
  end if;

  if v_session.expires_at < now() then
    return jsonb_build_object('success', false, 'error', 'Session has expired');
  end if;

  update public.guest_portal_sessions
    set last_activity_at = now()
  where id = v_session.id;

  return jsonb_build_object(
    'success', true,
    'session_id', v_session.id,
    'customer_id', v_session.customer_id,
    'customer_name', v_session.customer_name,
    'customer_email', v_session.customer_email,
    'booking_id', v_session.booking_id,
    'lodge_id', v_session.lodge_id,
    'expires_at', v_session.expires_at::text
  );
end;
$$;

-- RPC: submit guest portal request
create or replace function public.submit_guest_portal_request(
  p_token text,
  p_request_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_request_id uuid;
begin
  if nullif(btrim(p_token), '') is null then
    return jsonb_build_object('success', false, 'error', 'Session token is required');
  end if;

  select s.* into v_session
    from public.guest_portal_sessions s
   where s.token = p_token and s.expires_at >= now();

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  insert into public.enterprise_guest_portal_requests (
    lodge_id, booking_id, customer_id, request_type, status, payload
  )
  values (
    v_session.lodge_id,
    v_session.booking_id,
    v_session.customer_id,
    nullif(btrim(coalesce(p_request_type, '')), ''),
    'new',
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_request_id;

  return jsonb_build_object('success', true, 'request_id', v_request_id, 'status', 'new');
end;
$$;

-- RPC: get guest portal booking details (for portal display)
create or replace function public.get_guest_portal_booking_details(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_data jsonb;
begin
  select s.* into v_session
    from public.guest_portal_sessions s
   where s.token = p_token and s.expires_at >= now();

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  if v_session.booking_id is null then
    return jsonb_build_object('success', false, 'error', 'No booking linked to this session');
  end if;

  select jsonb_build_object(
    'booking_id', b.id,
    'customer_id', b.customer_id,
    'customer_name', c.name,
    'room_number', r.room_number,
    'room_type', r.room_type,
    'check_in', b.check_in,
    'check_out', b.check_out,
    'status', b.status,
    'total_amount', b.total_amount,
    'amount_paid', b.amount_paid,
    'balance', greatest(0, coalesce(b.total_amount, 0) - coalesce(b.amount_paid, 0)),
    'booking_reference', b.booking_reference
  ) into v_data
    from public.bookings b
    join public.customers c on c.id = b.customer_id
    left join public.rooms r on r.id = b.room_id
   where b.id = v_session.booking_id;

  return jsonb_build_object('success', true, 'booking', v_data);
end;
$$;

-- RPC: get guest portal documents visible to guest
create or replace function public.get_guest_portal_documents(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_docs jsonb;
begin
  select s.* into v_session
    from public.guest_portal_sessions s
   where s.token = p_token and s.expires_at >= now();

  if not found then
    return jsonb_build_object('success', false, 'error', 'Invalid or expired session');
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', d.id,
      'document_type', d.document_type,
      'document_number', d.document_number,
      'status', d.status,
      'created_at', d.created_at
    ) order by d.created_at desc
  ) into v_docs
    from public.enterprise_documents d
   where d.lodge_id = v_session.lodge_id
     and (
       (v_session.customer_id is not null and d.subject_type = 'customer' and d.subject_id = v_session.customer_id)
       or
       (v_session.booking_id is not null and d.subject_type = 'booking' and d.subject_id = v_session.booking_id)
     )
     and d.status = 'final';

  return jsonb_build_object('success', true, 'documents', coalesce(v_docs, '[]'::jsonb));
end;
$$;

-- RPC: get pending portal requests for a lodge
create or replace function public.get_pending_guest_portal_requests(p_lodge_id uuid)
returns setof public.enterprise_guest_portal_requests
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);
  return query
    select *
      from public.enterprise_guest_portal_requests
     where lodge_id = p_lodge_id
       and status = 'new'
     order by created_at desc;
end;
$$;

revoke all on function public.get_guest_portal_config(uuid) from public;
revoke all on function public.update_guest_portal_config(uuid, jsonb) from public;
revoke all on function public.create_guest_portal_session(text, text) from public;
revoke all on function public.validate_guest_portal_session(text) from public;
revoke all on function public.submit_guest_portal_request(text, text, jsonb) from public;
revoke all on function public.get_guest_portal_booking_details(text) from public;
revoke all on function public.get_guest_portal_documents(text) from public;
revoke all on function public.get_pending_guest_portal_requests(uuid) from public;

grant execute on function public.get_guest_portal_config(uuid) to authenticated, service_role;
grant execute on function public.update_guest_portal_config(uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_guest_portal_session(text, text) to authenticated, service_role;
grant execute on function public.validate_guest_portal_session(text) to authenticated, service_role;
grant execute on function public.submit_guest_portal_request(text, text, jsonb) to authenticated, service_role;
grant execute on function public.get_guest_portal_booking_details(text) to authenticated, service_role;
grant execute on function public.get_guest_portal_documents(text) to authenticated, service_role;
grant execute on function public.get_pending_guest_portal_requests(uuid) to authenticated, service_role;

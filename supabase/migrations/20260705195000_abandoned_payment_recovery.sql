-- Abandoned Payment Recovery
-- Tracks payment sessions that were started but not completed,
-- enabling proactive recovery, expiration, and notification workflows.

create type abandoned_payment_status as enum ('pending', 'recovered', 'expired', 'cancelled');

create table if not exists abandoned_payment_sessions (
  id              bigint generated always as identity primary key,
  lodge_id        bigint not null,
  booking_id      uuid references bookings(id) on delete set null,
  amount          numeric not null,
  currency        text not null default 'BWP',
  payment_provider text,
  session_token   text not null,
  status          abandoned_payment_status not null default 'pending',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  recovered_at    timestamptz,
  notification_sent    boolean not null default false,
  notification_count   int not null default 0,
  metadata        jsonb not null default '{}'::jsonb,
  constraint uq_abandoned_session_token unique (session_token)
);

create index if not exists idx_abandoned_sessions_lodge_status
  on abandoned_payment_sessions (lodge_id, status);

-- RPC: log_abandoned_session
create or replace function log_abandoned_session(
  p_lodge_id       bigint,
  p_amount         numeric,
  p_session_token  text,
  p_booking_id     uuid default null,
  p_payment_provider text default null,
  p_expires_at     timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session abandoned_payment_sessions;
begin
  perform app_require_lodge_role(p_lodge_id);

  insert into abandoned_payment_sessions
    (lodge_id, booking_id, amount, payment_provider, session_token, expires_at)
  values
    (p_lodge_id, p_booking_id, p_amount, p_payment_provider, p_session_token, p_expires_at)
  returning * into v_session;

  return row_to_jsonb(v_session);
end;
$$;

-- RPC: get_abandoned_sessions
create or replace function get_abandoned_sessions(
  p_lodge_id       bigint,
  p_status_filter  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions jsonb;
begin
  perform app_require_lodge_role(p_lodge_id);

  select coalesce(jsonb_agg(row_to_jsonb(s) order by s.created_at desc), '[]'::jsonb)
    into v_sessions
    from abandoned_payment_sessions s
   where s.lodge_id = p_lodge_id
     and (p_status_filter is null or s.status = p_status_filter::abandoned_payment_status);

  return v_sessions;
end;
$$;

-- RPC: recover_abandoned_session
create or replace function recover_abandoned_session(
  p_lodge_id       bigint,
  p_session_token  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session abandoned_payment_sessions;
begin
  perform app_require_lodge_role(p_lodge_id);

  update abandoned_payment_sessions
     set status = 'recovered',
         recovered_at = now()
   where lodge_id = p_lodge_id
     and session_token = p_session_token
     and status = 'pending'
  returning * into v_session;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Session not found or not pending');
  end if;

  return row_to_jsonb(v_session);
end;
$$;

-- RPC: expire_abandoned_sessions
create or replace function expire_abandoned_sessions(
  p_lodge_id       bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  perform app_require_lodge_role(p_lodge_id);

  update abandoned_payment_sessions
     set status = 'expired'
   where lodge_id = p_lodge_id
     and status = 'pending'
     and expires_at is not null
     and expires_at < now();

  get diagnostics v_count = row_count;

  return jsonb_build_object('success', true, 'expired_count', v_count);
end;
$$;

-- RPC: get_pending_recovery_sessions
create or replace function get_pending_recovery_sessions(
  p_lodge_id       bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sessions jsonb;
begin
  perform app_require_lodge_role(p_lodge_id);

  select coalesce(jsonb_agg(row_to_jsonb(s) order by s.created_at desc), '[]'::jsonb)
    into v_sessions
    from abandoned_payment_sessions s
   where s.lodge_id = p_lodge_id
     and s.status = 'pending'
     and (s.notification_sent = false or s.notification_count < 3);

  return v_sessions;
end;
$$;

-- RLS
alter table abandoned_payment_sessions enable row level security;

create policy "Lodge users can read abandoned sessions"
  on abandoned_payment_sessions for select
  using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge users can insert abandoned sessions"
  on abandoned_payment_sessions for insert
  with check (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

create policy "Lodge users can update abandoned sessions"
  on abandoned_payment_sessions for update
  using (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

-- Grant execute to authenticated and service_role
grant execute on function log_abandoned_session(bigint, numeric, text, uuid, text, timestamptz)
  to authenticated, service_role;

grant execute on function get_abandoned_sessions(bigint, text)
  to authenticated, service_role;

grant execute on function recover_abandoned_session(bigint, text)
  to authenticated, service_role;

grant execute on function expire_abandoned_sessions(bigint)
  to authenticated, service_role;

grant execute on function get_pending_recovery_sessions(bigint)
  to authenticated, service_role;

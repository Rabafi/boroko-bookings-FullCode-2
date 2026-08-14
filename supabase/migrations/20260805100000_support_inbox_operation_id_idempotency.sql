-- Support-inbox operation idempotency.
--
-- The Manager PWA queues support requests and replies in its device-local
-- queue. A flush that succeeds on the server but loses its response can
-- otherwise replay the same request and create a duplicate ticket or
-- duplicate message. This migration gives the inbox a client-held operation
-- key so replays resolve to the original row instead of duplicating work.
--
-- The key is optional: legacy callers that do not supply one keep the
-- previous insert behaviour.

begin;

alter table public.support_tickets
  add column if not exists client_operation_id text,
  add column if not exists client_payload_hash text;

create unique index if not exists support_tickets_client_operation_uidx
  on public.support_tickets (lodge_id, client_operation_id)
  where client_operation_id is not null;

alter table public.support_ticket_messages
  add column if not exists client_operation_id text,
  add column if not exists client_payload_hash text;

create unique index if not exists support_ticket_messages_client_operation_uidx
  on public.support_ticket_messages (lodge_id, ticket_id, client_operation_id)
  where client_operation_id is not null;

drop function if exists public.create_support_ticket(jsonb);
create or replace function public.create_support_ticket(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_operation_id text := nullif(btrim(coalesce(payload->>'operation_id', payload->>'client_operation_id', '')), '');
  v_hash text;
  v_existing_hash text;
  v_lodge_name text := nullif(payload->>'lodge_name', '');
  v_source text := coalesce(nullif(payload->>'source', ''), 'manager_pwa');
  v_description text := nullif(payload->>'description', '');
  v_sender_type text := coalesce(nullif(payload->>'sender_type', ''), nullif(payload->>'requester_surface', ''), 'manager_pwa');
  v_sender_name text := coalesce(nullif(payload->>'sender_name', ''), nullif(payload->>'requester_name', ''), 'Manager PWA');
  v_sender_role text := coalesce(nullif(payload->>'sender_role', ''), nullif(payload->>'requester_role', ''), 'manager');
  v_sender_user_id text := coalesce(nullif(payload->>'sender_user_id', ''), nullif(payload->>'requester_user_id', ''));
  v_sender_surface text := coalesce(nullif(payload->>'sender_surface', ''), nullif(payload->>'requester_surface', ''), 'manager_pwa');
  v_title text := nullif(payload->>'title', '');
  v_category text := coalesce(nullif(payload->>'category', ''), 'General');
  v_priority text := coalesce(nullif(payload->>'priority', ''), 'Normal');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);

  if v_operation_id is not null then
    if length(v_operation_id) < 8 or length(v_operation_id) > 128 then
      return jsonb_build_object('success', false, 'error', 'operation_id must be between 8 and 128 characters');
    end if;
    perform pg_advisory_xact_lock(hashtextextended(format('support-ticket:%s:%s', v_lodge_id, v_operation_id), 0));
    v_hash := encode(sha256(convert_to(jsonb_build_object(
      'lodge_id', v_lodge_id,
      'lodge_name', v_lodge_name,
      'title', v_title,
      'description', v_description,
      'category', v_category,
      'priority', v_priority,
      'sender_type', v_sender_type,
      'sender_name', v_sender_name,
      'sender_role', v_sender_role,
      'sender_user_id', v_sender_user_id,
      'requester_type', v_sender_type,
      'requester_name', v_sender_name,
      'requester_role', v_sender_role,
      'requester_user_id', v_sender_user_id,
      'sender_surface', v_sender_surface,
      'source', v_source
    )::text, 'UTF8')), 'hex');
    select id, client_payload_hash into v_id, v_existing_hash
      from public.support_tickets
     where lodge_id = v_lodge_id and client_operation_id = v_operation_id
     for update;
    if found then
      if v_existing_hash is null or v_existing_hash <> v_hash then
        return jsonb_build_object('success', false, 'error', 'This request was already submitted with different details.', 'code', 'idempotency_conflict');
      end if;
      return jsonb_build_object('success', true, 'id', v_id, 'replayed', true);
    end if;
  end if;

  insert into public.support_tickets (
    lodge_id,
    lodge_name,
    title,
    description,
    category,
    priority,
    status,
    client_operation_id,
    client_payload_hash
  ) values (
    v_lodge_id,
    v_lodge_name,
    v_title,
    v_description,
    v_category,
    v_priority,
    'open',
    v_operation_id,
    v_hash
  )
  returning id into v_id;

  if nullif(btrim(coalesce(v_description, '')), '') is not null then
    insert into public.support_ticket_messages (
      ticket_id,
      lodge_id,
      body,
      sender_type,
      sender_name,
      sender_role,
      sender_user_id,
      sender_surface,
      metadata,
      client_operation_id,
      client_payload_hash
    ) values (
      v_id,
      v_lodge_id,
      v_description,
      v_sender_type,
      v_sender_name,
      v_sender_role,
      v_sender_user_id,
      v_sender_surface,
      jsonb_build_object('source', v_source),
      case when v_operation_id is not null then v_operation_id || ':initial' else null end,
      case when v_operation_id is not null then encode(sha256(convert_to(jsonb_build_object(
        'lodge_id', v_lodge_id,
        'ticket_id', v_id,
        'body', v_description,
        'sender_type', v_sender_type,
        'sender_name', v_sender_name,
        'sender_role', v_sender_role,
        'sender_user_id', v_sender_user_id,
        'sender_surface', v_sender_surface,
        'metadata', jsonb_build_object('source', v_source),
        'status', null
      )::text, 'UTF8')), 'hex') else null end
    );
  end if;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

drop function if exists public.add_lodge_support_ticket_message(uuid, uuid, text, text, text, text, text, text, jsonb, text);
create or replace function public.add_lodge_support_ticket_message(
  p_ticket_id uuid,
  p_lodge_id uuid,
  p_body text,
  p_sender_type text default 'desktop',
  p_sender_name text default null,
  p_sender_role text default null,
  p_sender_user_id text default null,
  p_sender_surface text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_status text default null,
  p_operation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_operation_id text := nullif(btrim(coalesce(p_operation_id, '')), '');
  v_existing_message_id uuid;
  v_existing_body text;
  v_existing_hash text;
  v_sender_type text := lower(replace(coalesce(nullif(btrim(p_sender_type), ''), 'desktop'), '-', '_'));
  v_sender_name text := coalesce(nullif(btrim(p_sender_name), ''), 'Front desk');
  v_sender_role text := nullif(btrim(p_sender_role), '');
  v_sender_user_id text := nullif(btrim(p_sender_user_id), '');
  v_sender_surface text := coalesce(nullif(btrim(p_sender_surface), ''), v_sender_type);
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_payload_hash text;
  v_next_status text;
  v_current_status text;
  v_is_manager boolean;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'manager', 'admin', 'super_admin']
  );

  if v_body is null then
    return jsonb_build_object('success', false, 'error', 'Message cannot be empty');
  end if;

  if v_status not in ('', 'open', 'acknowledged', 'in_progress', 'resolved', 'closed') then
    return jsonb_build_object('success', false, 'error', 'Invalid request status');
  end if;

  if v_operation_id is not null then
    if length(v_operation_id) < 8 or length(v_operation_id) > 128 then
      return jsonb_build_object('success', false, 'error', 'operation_id must be between 8 and 128 characters');
    end if;
    perform pg_advisory_xact_lock(hashtextextended(format('support-message:%s:%s:%s', p_lodge_id, p_ticket_id, v_operation_id), 0));
    v_payload_hash := encode(sha256(convert_to(jsonb_build_object(
      'lodge_id', p_lodge_id,
      'ticket_id', p_ticket_id,
      'body', v_body,
      'sender_type', v_sender_type,
      'sender_name', v_sender_name,
      'sender_role', v_sender_role,
      'sender_user_id', v_sender_user_id,
      'sender_surface', v_sender_surface,
      'metadata', coalesce(p_metadata, '{}'::jsonb),
      'status', nullif(v_status, '')
    )::text, 'UTF8')), 'hex');
    select id, body, client_payload_hash into v_existing_message_id, v_existing_body, v_existing_hash
      from public.support_ticket_messages
     where lodge_id = p_lodge_id and ticket_id = p_ticket_id and client_operation_id = v_operation_id;
    if found then
      if v_existing_hash is distinct from v_payload_hash then
        return jsonb_build_object('success', false, 'error', 'This operation was already used for a different message.', 'code', 'idempotency_conflict');
      end if;
      return jsonb_build_object('success', true, 'id', p_ticket_id, 'message_id', v_existing_message_id, 'replayed', true);
    end if;
  end if;

  select status
    into v_current_status
    from public.support_tickets
   where id = p_ticket_id
     and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  v_is_manager := v_sender_type in ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager');
  v_next_status := case
    when v_status <> '' then v_status
    when v_is_manager and v_current_status in ('resolved', 'closed') then 'in_progress'
    when (not v_is_manager) and coalesce(v_current_status, 'open') = 'open' then 'acknowledged'
    else v_current_status
  end;

  insert into public.support_ticket_messages (
    ticket_id,
    lodge_id,
    body,
    sender_type,
    sender_name,
    sender_role,
    sender_user_id,
    sender_surface,
    metadata,
    client_operation_id,
    client_payload_hash
  ) values (
    p_ticket_id,
    p_lodge_id,
    v_body,
    v_sender_type,
    v_sender_name,
    v_sender_role,
    v_sender_user_id,
    v_sender_surface,
    coalesce(p_metadata, '{}'::jsonb),
    v_operation_id,
    case when v_operation_id is not null then coalesce(v_payload_hash, encode(sha256(convert_to(jsonb_build_object(
      'lodge_id', p_lodge_id,
      'ticket_id', p_ticket_id,
      'body', v_body,
      'sender_type', v_sender_type,
      'sender_name', v_sender_name,
      'sender_role', v_sender_role,
      'sender_user_id', v_sender_user_id,
      'sender_surface', v_sender_surface,
      'metadata', coalesce(p_metadata, '{}'::jsonb),
      'status', nullif(v_status, '')
    )::text, 'UTF8')), 'hex')) else null end
  );

  update public.support_tickets
     set status = v_next_status,
         admin_notes = case when v_is_manager then admin_notes else v_body end,
         updated_at = now(),
         resolved_at = case
           when v_next_status in ('resolved', 'closed') then now()
           when v_next_status in ('open', 'acknowledged', 'in_progress') then null
           else resolved_at
         end
   where id = p_ticket_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'id', p_ticket_id);
end;
$$;

revoke all on function public.create_support_ticket(jsonb) from public;
grant execute on function public.create_support_ticket(jsonb) to anon, authenticated, service_role;

revoke all on function public.add_lodge_support_ticket_message(uuid, uuid, text, text, text, text, text, text, jsonb, text, text) from public;
grant execute on function public.add_lodge_support_ticket_message(uuid, uuid, text, text, text, text, text, text, jsonb, text, text) to anon, authenticated, service_role;

commit;

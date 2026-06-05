create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  lodge_id uuid not null,
  body text not null check (char_length(btrim(body)) > 0),
  sender_type text not null default 'system',
  sender_name text not null default 'Boroko User',
  sender_role text,
  sender_user_id text,
  sender_surface text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_created_idx
  on public.support_ticket_messages (ticket_id, created_at, id);

create index if not exists support_ticket_messages_lodge_created_idx
  on public.support_ticket_messages (lodge_id, created_at desc);

alter table public.support_ticket_messages enable row level security;

drop policy if exists support_ticket_messages_select_own_lodge on public.support_ticket_messages;
create policy support_ticket_messages_select_own_lodge
  on public.support_ticket_messages
  for select
  using (public.app_lodge_access(lodge_id));

drop function if exists public.get_lodge_support_tickets(uuid, integer);

create function public.get_lodge_support_tickets(p_lodge_id uuid, p_limit integer default 50)
returns table (
  id uuid,
  lodge_id uuid,
  lodge_name text,
  title text,
  description text,
  category text,
  priority text,
  status text,
  admin_notes text,
  created_at timestamptz,
  updated_at timestamptz,
  resolved_at timestamptz,
  requester_name text,
  requester_role text,
  requester_user_id text,
  messages jsonb
)
language sql
security definer
set search_path to 'public'
as $$
  select
    s.id,
    s.lodge_id,
    s.lodge_name,
    s.title,
    s.description,
    s.category,
    s.priority,
    s.status,
    coalesce(s.admin_notes, '') as admin_notes,
    s.created_at,
    s.updated_at,
    s.resolved_at,
    coalesce(first_manager.sender_name, '') as requester_name,
    coalesce(first_manager.sender_role, '') as requester_role,
    coalesce(first_manager.sender_user_id, '') as requester_user_id,
    coalesce(thread.messages, '[]'::jsonb) as messages
  from public.support_tickets s
  left join lateral (
    select
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'ticket_id', m.ticket_id,
          'lodge_id', m.lodge_id,
          'body', m.body,
          'sender_type', m.sender_type,
          'sender_name', m.sender_name,
          'sender_role', m.sender_role,
          'sender_user_id', m.sender_user_id,
          'sender_surface', m.sender_surface,
          'metadata', m.metadata,
          'created_at', m.created_at
        )
        order by m.created_at asc, m.id asc
      ) as messages
    from public.support_ticket_messages m
    where m.ticket_id = s.id
  ) thread on true
  left join lateral (
    select m.sender_name, m.sender_role, m.sender_user_id
    from public.support_ticket_messages m
    where m.ticket_id = s.id
      and m.sender_type in ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
    order by m.created_at asc, m.id asc
    limit 1
  ) first_manager on true
  where s.lodge_id = p_lodge_id
    and public.app_lodge_access(p_lodge_id)
  order by coalesce(s.updated_at, s.created_at) desc, s.id desc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

create or replace function public.create_support_ticket(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_description text := nullif(payload->>'description', '');
  v_sender_type text := coalesce(nullif(payload->>'sender_type', ''), nullif(payload->>'requester_surface', ''), 'manager_pwa');
  v_sender_name text := coalesce(nullif(payload->>'sender_name', ''), nullif(payload->>'requester_name', ''), 'Manager PWA');
  v_sender_role text := coalesce(nullif(payload->>'sender_role', ''), nullif(payload->>'requester_role', ''), 'manager');
  v_sender_user_id text := coalesce(nullif(payload->>'sender_user_id', ''), nullif(payload->>'requester_user_id', ''));
  v_sender_surface text := coalesce(nullif(payload->>'sender_surface', ''), nullif(payload->>'requester_surface', ''), 'manager_pwa');
begin
  perform public.app_require_lodge_role(v_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);

  insert into public.support_tickets (
    lodge_id,
    lodge_name,
    title,
    description,
    category,
    priority,
    status
  ) values (
    v_lodge_id,
    nullif(payload->>'lodge_name', ''),
    nullif(payload->>'title', ''),
    v_description,
    coalesce(nullif(payload->>'category', ''), 'General'),
    coalesce(nullif(payload->>'priority', ''), 'Normal'),
    'open'
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
      metadata
    ) values (
      v_id,
      v_lodge_id,
      v_description,
      v_sender_type,
      v_sender_name,
      v_sender_role,
      v_sender_user_id,
      v_sender_surface,
      jsonb_build_object('source', coalesce(nullif(payload->>'source', ''), 'create_support_ticket'))
    );
  end if;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

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
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_sender_type text := lower(replace(coalesce(nullif(btrim(p_sender_type), ''), 'desktop'), '-', '_'));
  v_sender_name text := coalesce(nullif(btrim(p_sender_name), ''), 'Front desk');
  v_sender_role text := nullif(btrim(p_sender_role), '');
  v_sender_user_id text := nullif(btrim(p_sender_user_id), '');
  v_sender_surface text := coalesce(nullif(btrim(p_sender_surface), ''), v_sender_type);
  v_status text := lower(btrim(coalesce(p_status, '')));
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
    metadata
  ) values (
    p_ticket_id,
    p_lodge_id,
    v_body,
    v_sender_type,
    v_sender_name,
    v_sender_role,
    v_sender_user_id,
    v_sender_surface,
    coalesce(p_metadata, '{}'::jsonb)
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

create or replace function public.update_lodge_support_ticket(
  p_ticket_id uuid,
  p_lodge_id uuid,
  p_status text default null,
  p_admin_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_note text := nullif(btrim(coalesce(p_admin_notes, '')), '');
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'manager', 'admin', 'super_admin']
  );

  if v_status not in ('', 'open', 'acknowledged', 'in_progress', 'resolved', 'closed') then
    return jsonb_build_object('success', false, 'error', 'Invalid request status');
  end if;

  update public.support_tickets
     set status = case when v_status = '' then status else v_status end,
         admin_notes = case when p_admin_notes is null then admin_notes else v_note end,
         updated_at = now(),
         resolved_at = case
           when v_status in ('resolved', 'closed') then now()
           when v_status in ('open', 'acknowledged', 'in_progress') then null
           else resolved_at
         end
   where id = p_ticket_id
     and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  if p_admin_notes is not null and v_note is not null and not exists (
    select 1
      from public.support_ticket_messages m
     where m.ticket_id = p_ticket_id
       and m.sender_type in ('desktop', 'front_desk', 'admin', 'super_admin', 'command_central', 'support')
       and m.body = v_note
  ) then
    insert into public.support_ticket_messages (
      ticket_id,
      lodge_id,
      body,
      sender_type,
      sender_name,
      sender_role,
      sender_surface,
      metadata
    ) values (
      p_ticket_id,
      p_lodge_id,
      v_note,
      'desktop',
      'Front desk',
      'front desk',
      'desktop',
      jsonb_build_object('source', 'update_lodge_support_ticket')
    );
  end if;

  return jsonb_build_object('success', true, 'id', p_ticket_id);
end;
$$;

insert into public.support_ticket_messages (
  ticket_id,
  lodge_id,
  body,
  sender_type,
  sender_name,
  sender_role,
  sender_surface,
  metadata,
  created_at
)
select
  s.id,
  s.lodge_id,
  s.description,
  'manager_pwa',
  'Manager PWA',
  'manager',
  'manager_pwa',
  jsonb_build_object('backfilled', true, 'source', 'support_tickets.description'),
  coalesce(s.created_at, now())
from public.support_tickets s
where nullif(btrim(coalesce(s.description, '')), '') is not null
  and not exists (
    select 1
      from public.support_ticket_messages m
     where m.ticket_id = s.id
       and m.body = s.description
       and m.sender_type in ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
  );

insert into public.support_ticket_messages (
  ticket_id,
  lodge_id,
  body,
  sender_type,
  sender_name,
  sender_role,
  sender_surface,
  metadata,
  created_at
)
select
  s.id,
  s.lodge_id,
  s.admin_notes,
  'desktop',
  'Front desk',
  'front desk',
  'desktop',
  jsonb_build_object('backfilled', true, 'source', 'support_tickets.admin_notes'),
  coalesce(s.updated_at, s.resolved_at, s.created_at, now())
from public.support_tickets s
where nullif(btrim(coalesce(s.admin_notes, '')), '') is not null
  and not exists (
    select 1
      from public.support_ticket_messages m
     where m.ticket_id = s.id
       and m.body = s.admin_notes
       and m.sender_type in ('desktop', 'front_desk', 'admin', 'super_admin', 'command_central', 'support')
  );

grant execute on function public.create_support_ticket(jsonb) to anon, authenticated, service_role;
grant execute on function public.get_lodge_support_tickets(uuid, integer) to anon, authenticated, service_role;
grant execute on function public.add_lodge_support_ticket_message(uuid, uuid, text, text, text, text, text, text, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.update_lodge_support_ticket(uuid, uuid, text, text) to anon, authenticated, service_role;

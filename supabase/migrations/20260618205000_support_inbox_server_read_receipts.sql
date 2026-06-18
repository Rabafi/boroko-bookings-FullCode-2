-- Server-authoritative read cursors for the shared manager/front-desk inbox.
--
-- Device-local storage is not durable enough for unread state: app updates,
-- storage eviction, reinstalls, and switching devices can make historical
-- messages appear new again. These cursors are shared per lodge and audience.

begin;

create table if not exists public.support_ticket_read_receipts (
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  lodge_id uuid not null,
  audience text not null check (audience in ('manager', 'front_desk')),
  last_read_message_id uuid references public.support_ticket_messages(id) on delete set null,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (ticket_id, audience)
);

create index if not exists support_ticket_read_receipts_lodge_audience_idx
  on public.support_ticket_read_receipts (lodge_id, audience, updated_at desc);

alter table public.support_ticket_read_receipts enable row level security;

drop policy if exists support_ticket_read_receipts_select_own_lodge
  on public.support_ticket_read_receipts;
create policy support_ticket_read_receipts_select_own_lodge
  on public.support_ticket_read_receipts
  for select
  using (public.app_lodge_access(lodge_id));

revoke all on table public.support_ticket_read_receipts from public, anon, authenticated;
grant select, insert, update, delete on table public.support_ticket_read_receipts to service_role;

create or replace function public.mark_lodge_support_ticket_read(
  p_ticket_id uuid,
  p_lodge_id uuid,
  p_audience text,
  p_message_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_audience text := lower(replace(btrim(coalesce(p_audience, '')), '-', '_'));
  v_message record;
  v_existing record;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'manager', 'admin', 'super_admin']
  );

  if v_audience in ('manager_pwa', 'pwa', 'mobile', 'mobile_manager') then
    v_audience := 'manager';
  elsif v_audience in ('desktop', 'desk', 'reception', 'receptionist') then
    v_audience := 'front_desk';
  end if;

  if v_audience not in ('manager', 'front_desk') then
    return jsonb_build_object('success', false, 'error', 'Invalid inbox audience');
  end if;

  perform 1
    from public.support_tickets t
   where t.id = p_ticket_id
     and t.lodge_id = p_lodge_id
   for share;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  select m.id, m.created_at
    into v_message
    from public.support_ticket_messages m
   where m.ticket_id = p_ticket_id
     and m.lodge_id = p_lodge_id
     and (p_message_id is null or m.id = p_message_id)
     and (
       (
         v_audience = 'manager'
         and lower(coalesce(m.sender_type, '')) not in
           ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
       )
       or
       (
         v_audience = 'front_desk'
         and lower(coalesce(m.sender_type, '')) in
           ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
       )
     )
   order by m.created_at desc, m.id desc
   limit 1;

  if not found then
    return jsonb_build_object(
      'success', true,
      'ticket_id', p_ticket_id,
      'audience', v_audience,
      'message_id', null,
      'unchanged', true
    );
  end if;

  select r.last_read_message_id, rm.created_at
    into v_existing
    from public.support_ticket_read_receipts r
    left join public.support_ticket_messages rm on rm.id = r.last_read_message_id
   where r.ticket_id = p_ticket_id
     and r.audience = v_audience
   for update of r;

  if found
     and v_existing.created_at is not null
     and (v_existing.created_at, v_existing.last_read_message_id)
         >= (v_message.created_at, v_message.id) then
    return jsonb_build_object(
      'success', true,
      'ticket_id', p_ticket_id,
      'audience', v_audience,
      'message_id', v_existing.last_read_message_id,
      'unchanged', true
    );
  end if;

  insert into public.support_ticket_read_receipts (
    ticket_id,
    lodge_id,
    audience,
    last_read_message_id,
    last_read_at,
    updated_at
  ) values (
    p_ticket_id,
    p_lodge_id,
    v_audience,
    v_message.id,
    now(),
    now()
  )
  on conflict (ticket_id, audience) do update
    set lodge_id = excluded.lodge_id,
        last_read_message_id = excluded.last_read_message_id,
        last_read_at = excluded.last_read_at,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'audience', v_audience,
    'message_id', v_message.id,
    'read_at', now()
  );
end;
$$;

revoke all on function public.mark_lodge_support_ticket_read(uuid, uuid, text, uuid)
  from public;
grant execute on function public.mark_lodge_support_ticket_read(uuid, uuid, text, uuid)
  to anon, authenticated, service_role;

-- Treat the current history as already acknowledged. Only messages created
-- after this migration should become newly unread.
insert into public.support_ticket_read_receipts (
  ticket_id,
  lodge_id,
  audience,
  last_read_message_id,
  last_read_at,
  updated_at
)
select
  t.id,
  t.lodge_id,
  audience.name,
  latest.id,
  now(),
  now()
from public.support_tickets t
cross join (values ('manager'), ('front_desk')) as audience(name)
join lateral (
  select m.id
    from public.support_ticket_messages m
   where m.ticket_id = t.id
     and (
       (
         audience.name = 'manager'
         and lower(coalesce(m.sender_type, '')) not in
           ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
       )
       or
       (
         audience.name = 'front_desk'
         and lower(coalesce(m.sender_type, '')) in
           ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
       )
     )
   order by m.created_at desc, m.id desc
   limit 1
) latest on true
on conflict (ticket_id, audience) do nothing;

drop function if exists public.get_lodge_support_tickets(uuid, integer);

create function public.get_lodge_support_tickets(
  p_lodge_id uuid,
  p_limit integer default 50
)
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
  messages jsonb,
  manager_read_message_id uuid,
  manager_read_at timestamptz,
  front_desk_read_message_id uuid,
  front_desk_read_at timestamptz,
  manager_has_unread boolean,
  front_desk_has_unread boolean
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
    coalesce(thread.messages, '[]'::jsonb) as messages,
    manager_receipt.last_read_message_id as manager_read_message_id,
    manager_receipt.last_read_at as manager_read_at,
    desk_receipt.last_read_message_id as front_desk_read_message_id,
    desk_receipt.last_read_at as front_desk_read_at,
    exists (
      select 1
        from public.support_ticket_messages unread_manager
       where unread_manager.ticket_id = s.id
         and lower(coalesce(unread_manager.sender_type, '')) not in
           ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
         and (
           manager_receipt.last_read_message_id is null
           or (unread_manager.created_at, unread_manager.id)
              > (manager_read_message.created_at, manager_read_message.id)
         )
    ) as manager_has_unread,
    exists (
      select 1
        from public.support_ticket_messages unread_desk
       where unread_desk.ticket_id = s.id
         and lower(coalesce(unread_desk.sender_type, '')) in
           ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
         and (
           desk_receipt.last_read_message_id is null
           or (unread_desk.created_at, unread_desk.id)
              > (desk_read_message.created_at, desk_read_message.id)
         )
    ) as front_desk_has_unread
  from public.support_tickets s
  left join lateral (
    select jsonb_agg(
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
       and lower(coalesce(m.sender_type, '')) in
         ('manager', 'manager_pwa', 'pwa', 'mobile', 'mobile_manager')
     order by m.created_at asc, m.id asc
     limit 1
  ) first_manager on true
  left join public.support_ticket_read_receipts manager_receipt
    on manager_receipt.ticket_id = s.id
   and manager_receipt.audience = 'manager'
  left join public.support_ticket_messages manager_read_message
    on manager_read_message.id = manager_receipt.last_read_message_id
  left join public.support_ticket_read_receipts desk_receipt
    on desk_receipt.ticket_id = s.id
   and desk_receipt.audience = 'front_desk'
  left join public.support_ticket_messages desk_read_message
    on desk_read_message.id = desk_receipt.last_read_message_id
  where s.lodge_id = p_lodge_id
    and public.app_lodge_access(p_lodge_id)
  order by coalesce(s.updated_at, s.created_at) desc, s.id desc
  limit greatest(coalesce(p_limit, 50), 1);
$$;

revoke all on function public.get_lodge_support_tickets(uuid, integer) from public;
grant execute on function public.get_lodge_support_tickets(uuid, integer)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

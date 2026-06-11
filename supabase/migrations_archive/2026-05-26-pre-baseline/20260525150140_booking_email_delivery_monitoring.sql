begin;

create table if not exists public.booking_email_delivery_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid,
  booking_id uuid references public.bookings(id) on delete set null,
  reference text,
  delivery_type text not null default 'booking_confirmation_email',
  delivery_status text not null,
  recipient text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint booking_email_delivery_log_type_check
    check (delivery_type in ('booking_confirmation_email')),
  constraint booking_email_delivery_log_status_check
    check (delivery_status in (
      'sent',
      'failed',
      'smtp_missing',
      'token_invalid',
      'guest_mismatch',
      'booking_not_found'
    ))
);

create index if not exists booking_email_delivery_log_lodge_created_idx
  on public.booking_email_delivery_log (lodge_id, created_at desc);
create index if not exists booking_email_delivery_log_booking_created_idx
  on public.booking_email_delivery_log (booking_id, created_at desc);
create index if not exists booking_email_delivery_log_status_created_idx
  on public.booking_email_delivery_log (delivery_status, created_at desc);

alter table public.booking_email_delivery_log enable row level security;

drop policy if exists "booking_email_delivery_log_select_own_lodge" on public.booking_email_delivery_log;
create policy "booking_email_delivery_log_select_own_lodge"
  on public.booking_email_delivery_log
  for select
  using (lodge_id is not null and public.app_lodge_access(lodge_id));

create or replace function public.record_booking_email_delivery(
  p_lodge_id uuid,
  p_booking_id uuid,
  p_reference text,
  p_delivery_status text,
  p_recipient text default null,
  p_error_message text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.app_is_service_role() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  insert into public.booking_email_delivery_log (
    lodge_id,
    booking_id,
    reference,
    delivery_status,
    recipient,
    error_message,
    metadata
  ) values (
    p_lodge_id,
    p_booking_id,
    nullif(btrim(coalesce(p_reference, '')), ''),
    p_delivery_status,
    nullif(btrim(coalesce(p_recipient, '')), ''),
    nullif(btrim(coalesce(p_error_message, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

create or replace function public.get_booking_email_delivery_history(
  p_lodge_id uuid,
  p_booking_id uuid default null,
  p_limit int default 100
)
returns table (
  id uuid,
  lodge_id uuid,
  booking_id uuid,
  reference text,
  delivery_type text,
  delivery_status text,
  recipient text,
  error_message text,
  metadata jsonb,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager', 'super_admin']);

  return query
  select
    l.id,
    l.lodge_id,
    l.booking_id,
    l.reference,
    l.delivery_type,
    l.delivery_status,
    l.recipient,
    l.error_message,
    l.metadata,
    l.created_at
  from public.booking_email_delivery_log l
  where l.lodge_id = p_lodge_id
    and (p_booking_id is null or l.booking_id = p_booking_id)
  order by l.created_at desc, l.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
end;
$function$;

revoke all on table public.booking_email_delivery_log from public, anon;
grant select on table public.booking_email_delivery_log to authenticated, service_role;
grant insert on table public.booking_email_delivery_log to service_role;

revoke all on function public.record_booking_email_delivery(uuid, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_booking_email_delivery(uuid, uuid, text, text, text, text, jsonb) to service_role;

revoke all on function public.get_booking_email_delivery_history(uuid, uuid, int) from public, anon;
grant execute on function public.get_booking_email_delivery_history(uuid, uuid, int) to authenticated, service_role;

commit;

begin;

create table if not exists public.refund_approval_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  approved_by uuid not null references public.users(id),
  requested_by uuid references public.users(id),
  refund_amount numeric not null,
  retained_amount numeric not null,
  retained_percent numeric not null,
  method text not null,
  notes text,
  proof_reference text,
  approval_note text,
  created_at timestamptz not null default now()
);

create index if not exists refund_approval_log_lodge_created_idx
  on public.refund_approval_log (lodge_id, created_at desc);
create index if not exists refund_approval_log_booking_idx
  on public.refund_approval_log (booking_id, created_at desc);

alter table public.refund_approval_log enable row level security;

drop policy if exists "refund_approval_log_select_own_lodge" on public.refund_approval_log;
create policy "refund_approval_log_select_own_lodge"
  on public.refund_approval_log
  for select
  using (public.app_lodge_access(lodge_id));

create table if not exists public.invoice_delivery_log (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid references public.bookings(id) on delete set null,
  invoice_number text,
  delivery_type text not null,
  delivery_status text not null default 'completed',
  recipient text,
  file_path text,
  render_version text,
  initiated_by uuid references public.users(id),
  metadata jsonb not null default '{}'::jsonb,
  previous_hash text,
  entry_hash text,
  created_at timestamptz not null default now(),
  constraint invoice_delivery_log_type_check check (delivery_type in ('invoice_email', 'receipt_pdf', 'receipt_print')),
  constraint invoice_delivery_log_status_check check (delivery_status in ('completed', 'failed'))
);

create index if not exists invoice_delivery_log_lodge_created_idx
  on public.invoice_delivery_log (lodge_id, created_at desc);
create index if not exists invoice_delivery_log_booking_idx
  on public.invoice_delivery_log (booking_id, created_at desc);
create unique index if not exists invoice_delivery_log_entry_hash_uidx
  on public.invoice_delivery_log (entry_hash)
  where entry_hash is not null;

alter table public.invoice_delivery_log enable row level security;

drop policy if exists "invoice_delivery_log_select_own_lodge" on public.invoice_delivery_log;
create policy "invoice_delivery_log_select_own_lodge"
  on public.invoice_delivery_log
  for select
  using (public.app_lodge_access(lodge_id));

create or replace function public._invoice_delivery_log_hash()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_previous_hash text;
begin
  if new.previous_hash is null then
    select l.entry_hash
      into v_previous_hash
      from public.invoice_delivery_log l
     where l.lodge_id = new.lodge_id
     order by l.created_at desc, l.id desc
     limit 1;

    new.previous_hash := v_previous_hash;
  end if;

  new.entry_hash := encode(
    digest(
      coalesce(new.previous_hash, '') || '|' ||
      coalesce(new.lodge_id::text, '') || '|' ||
      coalesce(new.booking_id::text, '') || '|' ||
      coalesce(new.invoice_number, '') || '|' ||
      coalesce(new.delivery_type, '') || '|' ||
      coalesce(new.delivery_status, '') || '|' ||
      coalesce(new.recipient, '') || '|' ||
      coalesce(new.file_path, '') || '|' ||
      coalesce(new.render_version, '') || '|' ||
      coalesce(new.initiated_by::text, '') || '|' ||
      coalesce(new.metadata::text, '') || '|' ||
      coalesce(new.created_at::text, ''),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$function$;

drop trigger if exists trg_invoice_delivery_log_hash on public.invoice_delivery_log;
create trigger trg_invoice_delivery_log_hash
  before insert on public.invoice_delivery_log
  for each row
  execute function public._invoice_delivery_log_hash();

create table if not exists public.financial_validation_runs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  triggered_by uuid references public.users(id),
  trigger_source text not null default 'manual',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint financial_validation_runs_trigger_check
    check (trigger_source in ('manual', 'scheduled', 'startup'))
);

create index if not exists financial_validation_runs_lodge_created_idx
  on public.financial_validation_runs (lodge_id, created_at desc);

alter table public.financial_validation_runs enable row level security;

drop policy if exists "financial_validation_runs_select_own_lodge" on public.financial_validation_runs;
create policy "financial_validation_runs_select_own_lodge"
  on public.financial_validation_runs
  for select
  using (public.app_lodge_access(lodge_id));

create or replace function public.approve_booking_refund(
  p_booking_id uuid,
  p_lodge_id uuid,
  p_retained_percent numeric default 0,
  p_method text default 'refund',
  p_notes text default '',
  p_requested_by uuid default null,
  p_approved_by uuid default null,
  p_proof_reference text default '',
  p_approval_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_approver_role text;
  v_refund jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if p_approved_by is null then
    return jsonb_build_object('success', false, 'error', 'Refund approval is required');
  end if;

  select role
    into v_approver_role
    from public.users
   where id = p_approved_by
     and lodge_id = p_lodge_id
   limit 1;

  if coalesce(v_approver_role, '') not in ('manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'Approver does not have refund approval rights');
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_refund := public.record_booking_refund(
    p_booking_id,
    p_lodge_id,
    p_retained_percent,
    p_method,
    trim(both from concat(
      coalesce(nullif(p_notes, ''), ''),
      case
        when coalesce(nullif(p_proof_reference, ''), '') <> '' then ' | Proof: ' || p_proof_reference
        else ''
      end,
      case
        when coalesce(nullif(p_approval_note, ''), '') <> '' then ' | Approval: ' || p_approval_note
        else ''
      end
    )),
    p_requested_by,
    'refund-approval:' || p_booking_id::text || ':' || md5(
      coalesce(p_approved_by::text, '') || ':' ||
      coalesce(p_retained_percent::text, '') || ':' ||
      coalesce(p_method, '') || ':' ||
      coalesce(p_notes, '') || ':' ||
      coalesce(p_proof_reference, '')
    )
  );

  if coalesce((v_refund->>'success')::boolean, false) = false then
    return v_refund;
  end if;

  insert into public.refund_approval_log (
    lodge_id,
    booking_id,
    approved_by,
    requested_by,
    refund_amount,
    retained_amount,
    retained_percent,
    method,
    notes,
    proof_reference,
    approval_note
  ) values (
    p_lodge_id,
    p_booking_id,
    p_approved_by,
    p_requested_by,
    coalesce((v_refund->>'refund_amount')::numeric, 0),
    coalesce((v_refund->>'retained_amount')::numeric, 0),
    coalesce((v_refund->>'retained_percent')::numeric, 0),
    coalesce(nullif(p_method, ''), 'refund'),
    nullif(p_notes, ''),
    nullif(p_proof_reference, ''),
    nullif(p_approval_note, '')
  );

  return v_refund || jsonb_build_object('approved_by', p_approved_by);
end;
$function$;

create or replace function public.get_refund_approval_log(
  p_lodge_id uuid,
  p_booking_id uuid default null,
  p_limit int default 50
)
returns table (
  id uuid,
  lodge_id uuid,
  booking_id uuid,
  invoice_number text,
  approved_by uuid,
  approved_by_name text,
  requested_by uuid,
  requested_by_name text,
  refund_amount numeric,
  retained_amount numeric,
  retained_percent numeric,
  method text,
  notes text,
  proof_reference text,
  approval_note text,
  created_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    r.id,
    r.lodge_id,
    r.booking_id,
    b.invoice_number,
    r.approved_by,
    approver.name as approved_by_name,
    r.requested_by,
    requester.name as requested_by_name,
    r.refund_amount,
    r.retained_amount,
    r.retained_percent,
    r.method,
    r.notes,
    r.proof_reference,
    r.approval_note,
    r.created_at
  from public.refund_approval_log r
  left join public.bookings b on b.id = r.booking_id
  left join public.users approver on approver.id = r.approved_by
  left join public.users requester on requester.id = r.requested_by
  where r.lodge_id = p_lodge_id
    and (p_booking_id is null or r.booking_id = p_booking_id)
  order by r.created_at desc
  limit greatest(coalesce(p_limit, 50), 1);
$function$;

create or replace function public.record_invoice_delivery(
  p_lodge_id uuid,
  p_booking_id uuid default null,
  p_invoice_number text default null,
  p_delivery_type text default 'invoice_email',
  p_delivery_status text default 'completed',
  p_recipient text default null,
  p_file_path text default null,
  p_render_version text default null,
  p_initiated_by uuid default null,
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
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  insert into public.invoice_delivery_log (
    lodge_id,
    booking_id,
    invoice_number,
    delivery_type,
    delivery_status,
    recipient,
    file_path,
    render_version,
    initiated_by,
    metadata
  ) values (
    p_lodge_id,
    p_booking_id,
    nullif(p_invoice_number, ''),
    p_delivery_type,
    p_delivery_status,
    nullif(p_recipient, ''),
    nullif(p_file_path, ''),
    nullif(p_render_version, ''),
    p_initiated_by,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

create or replace function public.get_invoice_delivery_history(
  p_lodge_id uuid,
  p_booking_id uuid default null,
  p_limit int default 100
)
returns table (
  id uuid,
  lodge_id uuid,
  booking_id uuid,
  invoice_number text,
  delivery_type text,
  delivery_status text,
  recipient text,
  file_path text,
  render_version text,
  initiated_by uuid,
  initiated_by_name text,
  metadata jsonb,
  previous_hash text,
  entry_hash text,
  created_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    l.id,
    l.lodge_id,
    l.booking_id,
    l.invoice_number,
    l.delivery_type,
    l.delivery_status,
    l.recipient,
    l.file_path,
    l.render_version,
    l.initiated_by,
    u.name as initiated_by_name,
    l.metadata,
    l.previous_hash,
    l.entry_hash,
    l.created_at
  from public.invoice_delivery_log l
  left join public.users u on u.id = l.initiated_by
  where l.lodge_id = p_lodge_id
    and (p_booking_id is null or l.booking_id = p_booking_id)
  order by l.created_at desc, l.id desc
  limit greatest(coalesce(p_limit, 100), 1);
$function$;

create or replace function public.record_financial_validation_run(
  p_lodge_id uuid,
  p_trigger_source text default 'manual',
  p_triggered_by uuid default null,
  p_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['finance', 'manager', 'admin', 'super_admin']
  );

  insert into public.financial_validation_runs (
    lodge_id,
    triggered_by,
    trigger_source,
    summary
  ) values (
    p_lodge_id,
    p_triggered_by,
    case
      when p_trigger_source in ('manual', 'scheduled', 'startup') then p_trigger_source
      else 'manual'
    end,
    coalesce(p_summary, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$function$;

create or replace function public.get_financial_validation_runs(
  p_lodge_id uuid,
  p_limit int default 30
)
returns table (
  id uuid,
  lodge_id uuid,
  triggered_by uuid,
  triggered_by_name text,
  trigger_source text,
  summary jsonb,
  created_at timestamptz
)
language sql
security definer
set search_path to 'public'
as $function$
  select
    v.id,
    v.lodge_id,
    v.triggered_by,
    u.name as triggered_by_name,
    v.trigger_source,
    v.summary,
    v.created_at
  from public.financial_validation_runs v
  left join public.users u on u.id = v.triggered_by
  where v.lodge_id = p_lodge_id
  order by v.created_at desc
  limit greatest(coalesce(p_limit, 30), 1);
$function$;

revoke all on function public.approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text) from public, anon;
grant execute on function public.approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text) to authenticated, service_role;

revoke all on function public.get_refund_approval_log(uuid, uuid, int) from public, anon;
grant execute on function public.get_refund_approval_log(uuid, uuid, int) to authenticated, service_role;

revoke all on function public.record_invoice_delivery(uuid, uuid, text, text, text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function public.record_invoice_delivery(uuid, uuid, text, text, text, text, text, text, uuid, jsonb) to authenticated, service_role;

revoke all on function public.get_invoice_delivery_history(uuid, uuid, int) from public, anon;
grant execute on function public.get_invoice_delivery_history(uuid, uuid, int) to authenticated, service_role;

revoke all on function public.record_financial_validation_run(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.record_financial_validation_run(uuid, text, uuid, jsonb) to authenticated, service_role;

revoke all on function public.get_financial_validation_runs(uuid, int) from public, anon;
grant execute on function public.get_financial_validation_runs(uuid, int) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

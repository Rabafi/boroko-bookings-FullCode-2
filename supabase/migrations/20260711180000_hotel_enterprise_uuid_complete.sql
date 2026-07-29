-- Hotel Enterprise: rewrite incomplete modules onto uuid lodge_id and complete RPC contracts.
-- Covers: hotel folio ledger, check-in/out workflow, night-audit helpers, rate applicability,
-- corporate aging (already uuid), booking-engine availability (uuid path), channel dashboard.

begin;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Hotel folio ledger — rebuild on uuid (table was empty / unusable)
-- ═══════════════════════════════════════════════════════════════════════════

drop policy if exists hotel_folios_lodge_isolation on public.hotel_folios;
drop policy if exists folio_line_items_lodge_isolation on public.folio_line_items;

-- Drop dependent RPCs first (all overloads)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_hotel_folio','get_hotel_folios','get_folio_line_items','add_folio_charge',
        'add_folio_payment','transfer_folio_charge','split_folio','void_folio_line',
        'close_folio','reopen_folio','lock_folio','get_folio_balance','app_generate_folio_number'
      )
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

drop table if exists public.folio_line_items cascade;
drop table if exists public.hotel_folios cascade;

create table public.hotel_folios (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid references public.bookings(id) on delete set null,
  guest_id uuid references public.customers(id) on delete set null,
  folio_type text not null default 'guest'
    check (folio_type in ('guest', 'master', 'company', 'department', 'incidental')),
  folio_number text not null,
  label text not null default '',
  status text not null default 'open'
    check (status in ('open', 'closed', 'locked', 'void')),
  balance numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, folio_number)
);

create table public.folio_line_items (
  id uuid primary key default gen_random_uuid(),
  folio_id uuid not null references public.hotel_folios(id) on delete cascade,
  lodge_id uuid not null,
  amount numeric(12,2) not null default 0,
  line_type text not null
    check (line_type in ('charge', 'payment', 'transfer_in', 'transfer_out', 'void', 'adjustment')),
  description text not null default '',
  reference_type text,
  reference_id uuid,
  audit_before jsonb,
  audit_after jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index hotel_folios_lodge_booking_idx on public.hotel_folios (lodge_id, booking_id);
create index folio_line_items_folio_idx on public.folio_line_items (folio_id, created_at desc);
create index folio_line_items_lodge_idx on public.folio_line_items (lodge_id);

alter table public.hotel_folios enable row level security;
alter table public.folio_line_items enable row level security;

create policy hotel_folios_lodge_isolation on public.hotel_folios
  for all using (public.app_lodge_access(lodge_id))
  with check (public.app_lodge_access(lodge_id));

create policy folio_line_items_lodge_isolation on public.folio_line_items
  for all using (public.app_lodge_access(lodge_id))
  with check (public.app_lodge_access(lodge_id));

create or replace function public.app_generate_folio_number(p_lodge_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_seq integer;
begin
  select coalesce(max(
    nullif(regexp_replace(split_part(folio_number, '-', 3), '[^0-9]', '', 'g'), '')::int
  ), 0) + 1
    into v_seq
  from public.hotel_folios
  where lodge_id = p_lodge_id;

  return 'FOL-' || to_char(now(), 'YYMM') || '-' || lpad(v_seq::text, 6, '0');
end;
$$;

create or replace function public.create_hotel_folio(
  p_lodge_id uuid,
  p_booking_id uuid default null,
  p_guest_id uuid default null,
  p_folio_type text default 'guest',
  p_label text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_folio public.hotel_folios%rowtype;
  v_guest uuid := p_guest_id;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  if p_booking_id is not null then
    if not exists (
      select 1 from public.bookings b where b.id = p_booking_id and b.lodge_id = p_lodge_id
    ) then
      return jsonb_build_object('success', false, 'error', 'Booking not found');
    end if;
    if v_guest is null then
      select customer_id into v_guest from public.bookings where id = p_booking_id;
    end if;
  end if;

  insert into public.hotel_folios (
    lodge_id, booking_id, guest_id, folio_type, folio_number, label, status, balance
  ) values (
    p_lodge_id,
    p_booking_id,
    v_guest,
    coalesce(nullif(p_folio_type, ''), 'guest'),
    public.app_generate_folio_number(p_lodge_id),
    coalesce(p_label, ''),
    'open',
    0
  )
  returning * into v_folio;

  return jsonb_build_object('success', true, 'folio', to_jsonb(v_folio));
end;
$$;

create or replace function public.get_hotel_folios(
  p_lodge_id uuid,
  p_booking_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  select coalesce(jsonb_agg(to_jsonb(hf) order by hf.created_at desc), '[]'::jsonb)
    into v_result
  from public.hotel_folios hf
  where hf.lodge_id = p_lodge_id
    and (p_booking_id is null or hf.booking_id = p_booking_id);

  return v_result;
end;
$$;

create or replace function public.get_folio_line_items(
  p_lodge_id uuid,
  p_folio_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  if not exists (
    select 1 from public.hotel_folios hf where hf.id = p_folio_id and hf.lodge_id = p_lodge_id
  ) then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(to_jsonb(fli) order by fli.created_at desc), '[]'::jsonb)
    into v_result
  from public.folio_line_items fli
  where fli.folio_id = p_folio_id and fli.lodge_id = p_lodge_id;

  return v_result;
end;
$$;

create or replace function public.add_folio_charge(
  p_lodge_id uuid,
  p_folio_id uuid,
  p_amount numeric,
  p_description text default '',
  p_reference_type text default null,
  p_reference_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_folio public.hotel_folios%rowtype;
  v_line public.folio_line_items%rowtype;
  v_user_id uuid := public.app_current_user_id();
  v_before jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  select * into v_folio from public.hotel_folios
  where id = p_folio_id and lodge_id = p_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found'); end if;
  if v_folio.status in ('locked', 'closed', 'void') then
    return jsonb_build_object('success', false, 'error', 'Folio is ' || v_folio.status);
  end if;
  if coalesce(p_amount, 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'Amount is required');
  end if;

  v_before := to_jsonb(v_folio);
  insert into public.folio_line_items (
    folio_id, lodge_id, amount, line_type, description, reference_type, reference_id, created_by, audit_before
  ) values (
    p_folio_id, p_lodge_id, p_amount, 'charge', coalesce(p_description, ''),
    p_reference_type, p_reference_id, v_user_id, v_before
  ) returning * into v_line;

  update public.hotel_folios
     set balance = balance + p_amount, updated_at = now()
   where id = p_folio_id
   returning * into v_folio;

  update public.folio_line_items
     set audit_after = to_jsonb(v_folio)
   where id = v_line.id;

  return jsonb_build_object('success', true, 'line_item', to_jsonb(v_line), 'folio', to_jsonb(v_folio));
end;
$$;

create or replace function public.add_folio_payment(
  p_lodge_id uuid,
  p_folio_id uuid,
  p_amount numeric,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_folio public.hotel_folios%rowtype;
  v_line public.folio_line_items%rowtype;
  v_user_id uuid := public.app_current_user_id();
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  select * into v_folio from public.hotel_folios
  where id = p_folio_id and lodge_id = p_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found'); end if;
  if v_folio.status in ('locked', 'closed', 'void') then
    return jsonb_build_object('success', false, 'error', 'Folio is ' || v_folio.status);
  end if;
  if coalesce(p_amount, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Payment amount must be positive');
  end if;

  insert into public.folio_line_items (
    folio_id, lodge_id, amount, line_type, description, created_by
  ) values (
    p_folio_id, p_lodge_id, p_amount, 'payment', coalesce(p_description, 'Payment'), v_user_id
  ) returning * into v_line;

  update public.hotel_folios
     set balance = balance - p_amount, updated_at = now()
   where id = p_folio_id
   returning * into v_folio;

  return jsonb_build_object('success', true, 'line_item', to_jsonb(v_line), 'folio', to_jsonb(v_folio));
end;
$$;

create or replace function public.transfer_folio_charge(
  p_lodge_id uuid,
  p_source_folio_id uuid,
  p_target_folio_id uuid,
  p_amount numeric,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_source public.hotel_folios%rowtype;
  v_target public.hotel_folios%rowtype;
  v_out public.folio_line_items%rowtype;
  v_in public.folio_line_items%rowtype;
  v_user_id uuid := public.app_current_user_id();
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  select * into v_source from public.hotel_folios
  where id = p_source_folio_id and lodge_id = p_lodge_id for update;
  select * into v_target from public.hotel_folios
  where id = p_target_folio_id and lodge_id = p_lodge_id for update;
  if v_source.id is null or v_target.id is null then
    return jsonb_build_object('success', false, 'error', 'Source or target folio not found');
  end if;
  if coalesce(p_amount, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Transfer amount must be positive');
  end if;

  insert into public.folio_line_items (folio_id, lodge_id, amount, line_type, description, created_by)
  values (p_source_folio_id, p_lodge_id, p_amount, 'transfer_out', coalesce(p_description, 'Transfer out'), v_user_id)
  returning * into v_out;

  insert into public.folio_line_items (folio_id, lodge_id, amount, line_type, description, created_by)
  values (p_target_folio_id, p_lodge_id, p_amount, 'transfer_in', coalesce(p_description, 'Transfer in'), v_user_id)
  returning * into v_in;

  update public.hotel_folios set balance = balance - p_amount, updated_at = now() where id = p_source_folio_id;
  update public.hotel_folios set balance = balance + p_amount, updated_at = now() where id = p_target_folio_id;

  return jsonb_build_object('success', true, 'transfer_out', to_jsonb(v_out), 'transfer_in', to_jsonb(v_in));
end;
$$;

create or replace function public.split_folio(
  p_lodge_id uuid,
  p_source_folio_id uuid,
  p_target_folio_type text,
  p_amount numeric,
  p_target_label text default '',
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_source public.hotel_folios%rowtype;
  v_target jsonb;
  v_transfer jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  select * into v_source from public.hotel_folios
  where id = p_source_folio_id and lodge_id = p_lodge_id for update;
  if not found then return jsonb_build_object('success', false, 'error', 'Source folio not found'); end if;
  if v_source.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Source folio must be open');
  end if;

  v_target := public.create_hotel_folio(
    p_lodge_id, v_source.booking_id, v_source.guest_id,
    coalesce(nullif(p_target_folio_type, ''), 'incidental'),
    coalesce(p_target_label, 'Split folio')
  );
  if coalesce((v_target->>'success')::boolean, false) is not true then
    return v_target;
  end if;

  v_transfer := public.transfer_folio_charge(
    p_lodge_id,
    p_source_folio_id,
    (v_target->'folio'->>'id')::uuid,
    p_amount,
    coalesce(p_description, 'Split transfer')
  );

  return jsonb_build_object(
    'success', true,
    'source_folio_id', p_source_folio_id,
    'target_folio', v_target->'folio',
    'transfer', v_transfer
  );
end;
$$;

create or replace function public.void_folio_line(
  p_lodge_id uuid,
  p_line_item_id uuid,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_line public.folio_line_items%rowtype;
  v_folio public.hotel_folios%rowtype;
  v_void public.folio_line_items%rowtype;
  v_user_id uuid := public.app_current_user_id();
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['supervisor', 'manager', 'admin', 'super_admin', 'finance']
  );

  select fli.* into v_line
  from public.folio_line_items fli
  join public.hotel_folios hf on hf.id = fli.folio_id
  where fli.id = p_line_item_id and hf.lodge_id = p_lodge_id
  for update of fli;

  if not found then return jsonb_build_object('success', false, 'error', 'Line item not found'); end if;

  select * into v_folio from public.hotel_folios where id = v_line.folio_id for update;
  if v_folio.status = 'locked' then
    return jsonb_build_object('success', false, 'error', 'Folio is locked');
  end if;
  if v_line.line_type = 'void' then
    return jsonb_build_object('success', false, 'error', 'Line already void');
  end if;

  -- reverse balance effect
  if v_line.line_type in ('charge', 'transfer_in') then
    update public.hotel_folios set balance = balance - v_line.amount, updated_at = now() where id = v_line.folio_id;
  elsif v_line.line_type in ('payment', 'transfer_out') then
    update public.hotel_folios set balance = balance + v_line.amount, updated_at = now() where id = v_line.folio_id;
  end if;

  insert into public.folio_line_items (
    folio_id, lodge_id, amount, line_type, description, audit_before, created_by
  ) values (
    v_line.folio_id, p_lodge_id, v_line.amount, 'void',
    coalesce(nullif(p_reason, ''), 'Voided') || ' — original: ' || v_line.description,
    to_jsonb(v_line), v_user_id
  ) returning * into v_void;

  return jsonb_build_object('success', true, 'void', to_jsonb(v_void));
end;
$$;

create or replace function public.close_folio(p_lodge_id uuid, p_folio_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_folio public.hotel_folios%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor', 'manager', 'admin', 'super_admin', 'finance']);
  update public.hotel_folios set status = 'closed', updated_at = now()
   where id = p_folio_id and lodge_id = p_lodge_id and status = 'open'
   returning * into v_folio;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found or not open'); end if;
  return jsonb_build_object('success', true, 'folio', to_jsonb(v_folio));
end;
$$;

create or replace function public.reopen_folio(p_lodge_id uuid, p_folio_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_folio public.hotel_folios%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'finance']);
  update public.hotel_folios set status = 'open', updated_at = now()
   where id = p_folio_id and lodge_id = p_lodge_id and status = 'closed'
   returning * into v_folio;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found or not closed'); end if;
  return jsonb_build_object('success', true, 'folio', to_jsonb(v_folio));
end;
$$;

create or replace function public.lock_folio(p_lodge_id uuid, p_folio_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_folio public.hotel_folios%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin', 'finance']);
  update public.hotel_folios set status = 'locked', updated_at = now()
   where id = p_folio_id and lodge_id = p_lodge_id and status in ('open', 'closed')
   returning * into v_folio;
  if not found then return jsonb_build_object('success', false, 'error', 'Folio not found or already locked'); end if;
  return jsonb_build_object('success', true, 'folio', to_jsonb(v_folio));
end;
$$;

create or replace function public.get_folio_balance(p_lodge_id uuid, p_folio_id uuid)
returns numeric
language plpgsql security definer set search_path to 'public'
as $$
declare v_balance numeric;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'cashier', 'supervisor', 'manager', 'admin', 'super_admin', 'finance']);
  select balance into v_balance from public.hotel_folios where id = p_folio_id and lodge_id = p_lodge_id;
  if not found then raise exception 'Folio not found' using errcode = 'P0002'; end if;
  return v_balance;
end;
$$;

-- Auto-create guest folio when booking checks in (helper used by check-in RPC)
create or replace function public.ensure_guest_folio_for_booking(p_lodge_id uuid, p_booking_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_guest uuid;
begin
  select id into v_id
  from public.hotel_folios
  where lodge_id = p_lodge_id and booking_id = p_booking_id and folio_type = 'guest' and status <> 'void'
  order by created_at
  limit 1;
  if v_id is not null then return v_id; end if;

  select customer_id into v_guest from public.bookings where id = p_booking_id and lodge_id = p_lodge_id;
  insert into public.hotel_folios (lodge_id, booking_id, guest_id, folio_type, folio_number, label)
  values (
    p_lodge_id, p_booking_id, v_guest, 'guest',
    public.app_generate_folio_number(p_lodge_id),
    'Guest folio'
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Check-in / check-out workflow — uuid rebuild
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_checkin_checklist','complete_checkin_step','reset_checkin_step',
        'get_checkout_checklist','complete_checkout_step','reset_checkout_step',
        'get_checkin_config','update_checkin_config','initialize_checkin_checklist',
        'initialize_checkout_checklist','complete_hotel_checkin','complete_hotel_checkout'
      )
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

drop table if exists public.checkin_checklist_items cascade;
drop table if exists public.checkout_checklist_items cascade;
drop table if exists public.checkin_config cascade;

create table public.checkin_config (
  lodge_id uuid primary key,
  required_steps jsonb not null default '["id_capture","registration_card","deposit_check","room_assignment"]'::jsonb,
  optional_steps jsonb not null default '["signature","key_handoff"]'::jsonb,
  require_id_capture boolean not null default true,
  require_registration_card boolean not null default true,
  require_deposit_check boolean not null default true,
  require_room_assignment boolean not null default true,
  require_signature boolean not null default false,
  require_key_handoff boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.checkin_checklist_items (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  step_key text not null,
  step_label text not null,
  required boolean not null default true,
  completed boolean not null default false,
  completed_by uuid,
  completed_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (booking_id, step_key)
);

create table public.checkout_checklist_items (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  step_key text not null,
  step_label text not null,
  required boolean not null default true,
  completed boolean not null default false,
  completed_by uuid,
  completed_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (booking_id, step_key)
);

create index checkin_checklist_lodge_booking_idx on public.checkin_checklist_items (lodge_id, booking_id);
create index checkout_checklist_lodge_booking_idx on public.checkout_checklist_items (lodge_id, booking_id);

alter table public.checkin_config enable row level security;
alter table public.checkin_checklist_items enable row level security;
alter table public.checkout_checklist_items enable row level security;

create policy checkin_config_lodge on public.checkin_config
  for all using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id));
create policy checkin_items_lodge on public.checkin_checklist_items
  for all using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id));
create policy checkout_items_lodge on public.checkout_checklist_items
  for all using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id));

create or replace function public.get_checkin_config(p_lodge_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_config jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  select to_jsonb(cc) into v_config from public.checkin_config cc where cc.lodge_id = p_lodge_id;
  if v_config is null then
    insert into public.checkin_config (lodge_id) values (p_lodge_id)
    on conflict (lodge_id) do nothing;
    select to_jsonb(cc) into v_config from public.checkin_config cc where cc.lodge_id = p_lodge_id;
  end if;
  return jsonb_build_object('success', true, 'config', v_config);
end;
$$;

create or replace function public.update_checkin_config(p_lodge_id uuid, p_config jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin']);
  insert into public.checkin_config (
    lodge_id, required_steps, optional_steps,
    require_id_capture, require_registration_card, require_deposit_check,
    require_room_assignment, require_signature, require_key_handoff, updated_at
  ) values (
    p_lodge_id,
    coalesce(p_config->'required_steps', '["id_capture","registration_card","deposit_check","room_assignment"]'::jsonb),
    coalesce(p_config->'optional_steps', '["signature","key_handoff"]'::jsonb),
    coalesce((p_config->>'require_id_capture')::boolean, true),
    coalesce((p_config->>'require_registration_card')::boolean, true),
    coalesce((p_config->>'require_deposit_check')::boolean, true),
    coalesce((p_config->>'require_room_assignment')::boolean, true),
    coalesce((p_config->>'require_signature')::boolean, false),
    coalesce((p_config->>'require_key_handoff')::boolean, false),
    now()
  )
  on conflict (lodge_id) do update set
    required_steps = excluded.required_steps,
    optional_steps = excluded.optional_steps,
    require_id_capture = excluded.require_id_capture,
    require_registration_card = excluded.require_registration_card,
    require_deposit_check = excluded.require_deposit_check,
    require_room_assignment = excluded.require_room_assignment,
    require_signature = excluded.require_signature,
    require_key_handoff = excluded.require_key_handoff,
    updated_at = now();
  return public.get_checkin_config(p_lodge_id);
end;
$$;

create or replace function public.initialize_checkin_checklist(p_lodge_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_cfg public.checkin_config%rowtype;
  v_steps jsonb;
  v_step text;
  v_labels jsonb := '{
    "id_capture":"Capture guest ID",
    "registration_card":"Registration card",
    "deposit_check":"Deposit / payment check",
    "room_assignment":"Confirm room assignment",
    "signature":"Guest signature",
    "key_handoff":"Key handoff",
    "minibar_check":"Minibar check",
    "folio_settlement":"Settle guest folio",
    "room_inspection":"Room inspection",
    "key_return":"Key return"
  }'::jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  if not exists (select 1 from public.bookings where id = p_booking_id and lodge_id = p_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  perform public.get_checkin_config(p_lodge_id);
  select * into v_cfg from public.checkin_config where lodge_id = p_lodge_id;

  for v_step in
    select jsonb_array_elements_text(coalesce(v_cfg.required_steps, '[]'::jsonb))
  loop
    insert into public.checkin_checklist_items (lodge_id, booking_id, step_key, step_label, required)
    values (p_lodge_id, p_booking_id, v_step, coalesce(v_labels->>v_step, v_step), true)
    on conflict (booking_id, step_key) do nothing;
  end loop;

  for v_step in
    select jsonb_array_elements_text(coalesce(v_cfg.optional_steps, '[]'::jsonb))
  loop
    insert into public.checkin_checklist_items (lodge_id, booking_id, step_key, step_label, required)
    values (p_lodge_id, p_booking_id, v_step, coalesce(v_labels->>v_step, v_step), false)
    on conflict (booking_id, step_key) do nothing;
  end loop;

  return public.get_checkin_checklist(p_booking_id, p_lodge_id);
end;
$$;

create or replace function public.get_checkin_checklist(p_booking_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_items jsonb;
  v_config jsonb;
  v_all_required_done boolean;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);

  if not exists (select 1 from public.checkin_checklist_items where booking_id = p_booking_id and lodge_id = p_lodge_id) then
    perform public.initialize_checkin_checklist(p_lodge_id, p_booking_id);
  end if;

  select coalesce(jsonb_agg(to_jsonb(ci) order by ci.created_at), '[]'::jsonb)
    into v_items
  from public.checkin_checklist_items ci
  where ci.booking_id = p_booking_id and ci.lodge_id = p_lodge_id;

  select to_jsonb(cc) into v_config from public.checkin_config cc where cc.lodge_id = p_lodge_id;

  select not exists (
    select 1 from public.checkin_checklist_items
    where booking_id = p_booking_id and lodge_id = p_lodge_id and required = true and completed = false
  ) into v_all_required_done;

  return jsonb_build_object(
    'success', true,
    'items', v_items,
    'config', v_config,
    'ready_to_check_in', coalesce(v_all_required_done, false)
  );
end;
$$;

create or replace function public.complete_checkin_step(
  p_step_id uuid,
  p_lodge_id uuid,
  p_completed_by uuid default null,
  p_data jsonb default null
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_booking_id uuid;
  v_actor uuid := coalesce(p_completed_by, public.app_current_user_id());
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  update public.checkin_checklist_items
     set completed = true,
         completed_by = v_actor,
         completed_at = now(),
         data = coalesce(p_data, data)
   where id = p_step_id and lodge_id = p_lodge_id
   returning booking_id into v_booking_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Step not found'); end if;
  return jsonb_build_object('success', true, 'step_id', p_step_id, 'booking_id', v_booking_id);
end;
$$;

create or replace function public.reset_checkin_step(p_step_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  update public.checkin_checklist_items
     set completed = false, completed_by = null, completed_at = null
   where id = p_step_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Step not found'); end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.complete_hotel_checkin(p_lodge_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ready boolean;
  v_folio_id uuid;
  v_room_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);

  select (public.get_checkin_checklist(p_booking_id, p_lodge_id)->>'ready_to_check_in')::boolean into v_ready;
  if not coalesce(v_ready, false) then
    return jsonb_build_object('success', false, 'error', 'Required check-in steps are incomplete');
  end if;

  update public.bookings
     set status = 'checked_in', updated_at = now()
   where id = p_booking_id and lodge_id = p_lodge_id and status in ('confirmed', 'pending', 'checked_in')
   returning room_id into v_room_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found or not check-in eligible');
  end if;

  if v_room_id is not null then
    update public.rooms set status = 'occupied'
     where id = v_room_id and lodge_id = p_lodge_id;
  end if;

  v_folio_id := public.ensure_guest_folio_for_booking(p_lodge_id, p_booking_id);

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'status', 'checked_in',
    'folio_id', v_folio_id
  );
end;
$$;

create or replace function public.initialize_checkout_checklist(p_lodge_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_labels jsonb := '{
    "minibar_check":"Minibar / incidentals check",
    "folio_settlement":"Settle guest folio",
    "room_inspection":"Room inspection",
    "key_return":"Key return"
  }'::jsonb;
  v_step text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  foreach v_step in array array['minibar_check','folio_settlement','room_inspection','key_return']
  loop
    insert into public.checkout_checklist_items (lodge_id, booking_id, step_key, step_label, required)
    values (p_lodge_id, p_booking_id, v_step, coalesce(v_labels->>v_step, v_step), true)
    on conflict (booking_id, step_key) do nothing;
  end loop;
  return public.get_checkout_checklist(p_booking_id, p_lodge_id);
end;
$$;

create or replace function public.get_checkout_checklist(p_booking_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_items jsonb;
  v_ready boolean;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  if not exists (select 1 from public.checkout_checklist_items where booking_id = p_booking_id and lodge_id = p_lodge_id) then
    perform public.initialize_checkout_checklist(p_lodge_id, p_booking_id);
  end if;
  select coalesce(jsonb_agg(to_jsonb(ci) order by ci.created_at), '[]'::jsonb)
    into v_items
  from public.checkout_checklist_items ci
  where ci.booking_id = p_booking_id and ci.lodge_id = p_lodge_id;

  select not exists (
    select 1 from public.checkout_checklist_items
    where booking_id = p_booking_id and lodge_id = p_lodge_id and required and not completed
  ) into v_ready;

  return jsonb_build_object('success', true, 'items', v_items, 'ready_to_check_out', coalesce(v_ready, false));
end;
$$;

create or replace function public.complete_checkout_step(
  p_step_id uuid,
  p_lodge_id uuid,
  p_completed_by uuid default null,
  p_data jsonb default null
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_booking_id uuid; v_actor uuid := coalesce(p_completed_by, public.app_current_user_id());
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  update public.checkout_checklist_items
     set completed = true, completed_by = v_actor, completed_at = now(), data = coalesce(p_data, data)
   where id = p_step_id and lodge_id = p_lodge_id
   returning booking_id into v_booking_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Step not found'); end if;
  return jsonb_build_object('success', true, 'step_id', p_step_id, 'booking_id', v_booking_id);
end;
$$;

create or replace function public.reset_checkout_step(p_step_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  update public.checkout_checklist_items
     set completed = false, completed_by = null, completed_at = null
   where id = p_step_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Step not found'); end if;
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.complete_hotel_checkout(p_lodge_id uuid, p_booking_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ready boolean;
  v_room_id uuid;
  v_open_balance numeric := 0;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner','admin','manager','super_admin','receptionist']);
  select (public.get_checkout_checklist(p_booking_id, p_lodge_id)->>'ready_to_check_out')::boolean into v_ready;
  if not coalesce(v_ready, false) then
    return jsonb_build_object('success', false, 'error', 'Required check-out steps are incomplete');
  end if;

  select coalesce(sum(balance), 0) into v_open_balance
  from public.hotel_folios
  where lodge_id = p_lodge_id and booking_id = p_booking_id and status = 'open';

  if v_open_balance > 0.009 then
    return jsonb_build_object('success', false, 'error', 'Open folio balance remains', 'balance', v_open_balance);
  end if;

  update public.bookings
     set status = 'checked_out', updated_at = now()
   where id = p_booking_id and lodge_id = p_lodge_id and status in ('checked_in', 'confirmed')
   returning room_id into v_room_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found or not check-out eligible');
  end if;

  if v_room_id is not null then
    update public.rooms
       set status = 'available',
           housekeeping_status = coalesce(housekeeping_status, 'dirty')
     where id = v_room_id and lodge_id = p_lodge_id;
  end if;

  update public.hotel_folios
     set status = 'closed', updated_at = now()
   where lodge_id = p_lodge_id and booking_id = p_booking_id and status = 'open';

  return jsonb_build_object('success', true, 'booking_id', p_booking_id, 'status', 'checked_out');
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Rate plan applicability for bookings (uuid)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_applicable_room_rate(
  p_lodge_id uuid,
  p_room_id uuid,
  p_date date default current_date,
  p_corporate_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_room public.rooms%rowtype;
  v_plan public.rate_plans%rowtype;
  v_override numeric;
  v_rate numeric;
  v_source text := 'room_base';
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist','manager','admin','super_admin','finance','cashier']
  );

  select * into v_room from public.rooms where id = p_room_id and lodge_id = p_lodge_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  -- room rate override takes precedence when present
  if to_regclass('public.room_rate_overrides') is not null then
    execute $q$
      select rate_per_night from public.room_rate_overrides
      where lodge_id = $1 and (room_id = $2 or room_id is null)
        and $3::date between start_date and end_date
      order by case when room_id is not null then 0 else 1 end, created_at desc
      limit 1
    $q$ into v_override using p_lodge_id, p_room_id, p_date;
  end if;

  if v_override is not null then
    return jsonb_build_object('success', true, 'rate', v_override, 'source', 'rate_override');
  end if;

  -- active rate plan for room type / corporate
  if to_regclass('public.rate_plans') is not null then
    select rp.* into v_plan
    from public.rate_plans rp
    where rp.lodge_id = p_lodge_id
      and coalesce(rp.status, 'active') = 'active'
      and (rp.room_type_id is null or rp.room_type_id = v_room.room_type_id)
      and (rp.corporate_account_id is null or rp.corporate_account_id = p_corporate_account_id)
      and (rp.valid_from is null or rp.valid_from <= p_date)
      and (rp.valid_to is null or rp.valid_to >= p_date)
    order by
      case when rp.corporate_account_id is not null then 0 else 1 end,
      case when rp.room_type_id is not null then 0 else 1 end,
      rp.rate_amount
    limit 1;

    if found then
      return jsonb_build_object(
        'success', true,
        'rate', coalesce(v_plan.rate_amount, 0),
        'source', 'rate_plan',
        'rate_plan_id', v_plan.id,
        'rate_plan_name', v_plan.name
      );
    end if;
  end if;

  v_rate := coalesce(v_room.rate_per_night, 0);
  return jsonb_build_object('success', true, 'rate', v_rate, 'source', v_source);
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Channel manager operational dashboard (uuid-safe)
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.get_channel_dashboard(p_lodge_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_pending integer := 0;
  v_imported integer := 0;
  v_rejected integer := 0;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager','admin','super_admin']);
  if to_regclass('public.channel_reservation_imports') is not null then
    select
      count(*) filter (where coalesce(status, '') in ('pending', 'new', 'queued')),
      count(*) filter (where coalesce(status, '') in ('imported', 'confirmed')),
      count(*) filter (where coalesce(status, '') in ('rejected', 'failed'))
      into v_pending, v_imported, v_rejected
    from public.channel_reservation_imports
    where lodge_id = p_lodge_id;
  end if;
  return jsonb_build_object(
    'success', true,
    'pending', coalesce(v_pending, 0),
    'imported', coalesce(v_imported, 0),
    'rejected', coalesce(v_rejected, 0),
    'mode', 'manual_review'
  );
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Grants
-- ═══════════════════════════════════════════════════════════════════════════

grant execute on function public.app_generate_folio_number(uuid) to authenticated, service_role;
grant execute on function public.create_hotel_folio(uuid, uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public.get_hotel_folios(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_folio_line_items(uuid, uuid) to authenticated, service_role;
grant execute on function public.add_folio_charge(uuid, uuid, numeric, text, text, uuid) to authenticated, service_role;
grant execute on function public.add_folio_payment(uuid, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.transfer_folio_charge(uuid, uuid, uuid, numeric, text) to authenticated, service_role;
grant execute on function public.split_folio(uuid, uuid, text, numeric, text, text) to authenticated, service_role;
grant execute on function public.void_folio_line(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.close_folio(uuid, uuid) to authenticated, service_role;
grant execute on function public.reopen_folio(uuid, uuid) to authenticated, service_role;
grant execute on function public.lock_folio(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_folio_balance(uuid, uuid) to authenticated, service_role;
grant execute on function public.ensure_guest_folio_for_booking(uuid, uuid) to authenticated, service_role;

grant execute on function public.get_checkin_config(uuid) to authenticated, service_role;
grant execute on function public.update_checkin_config(uuid, jsonb) to authenticated, service_role;
grant execute on function public.initialize_checkin_checklist(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_checkin_checklist(uuid, uuid) to authenticated, service_role;
grant execute on function public.complete_checkin_step(uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.reset_checkin_step(uuid, uuid) to authenticated, service_role;
grant execute on function public.complete_hotel_checkin(uuid, uuid) to authenticated, service_role;
grant execute on function public.initialize_checkout_checklist(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_checkout_checklist(uuid, uuid) to authenticated, service_role;
grant execute on function public.complete_checkout_step(uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.reset_checkout_step(uuid, uuid) to authenticated, service_role;
grant execute on function public.complete_hotel_checkout(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_applicable_room_rate(uuid, uuid, date, uuid) to authenticated, service_role;
grant execute on function public.get_channel_dashboard(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

-- Forward-only repair: use public.users.id as the canonical business actor.
-- Desktop app sessions, staff lists, and app_current_user_id() all use this ID
-- domain. The Phase 4-6 tables incorrectly referenced auth.users(id).

begin;

-- Drop the incorrect auth.users foreign keys before translating any existing
-- rows. Abort rather than discard an actor that cannot be mapped safely.
alter table public.staff_schedules drop constraint if exists staff_schedules_staff_id_fkey;
alter table public.staff_schedules drop constraint if exists staff_schedules_created_by_fkey;
alter table public.staff_attendance drop constraint if exists staff_attendance_staff_id_fkey;
alter table public.staff_attendance drop constraint if exists staff_attendance_clocked_in_by_fkey;
alter table public.staff_attendance drop constraint if exists staff_attendance_manager_override_by_fkey;
alter table public.staff_leave drop constraint if exists staff_leave_staff_id_fkey;
alter table public.staff_leave drop constraint if exists staff_leave_approved_by_fkey;
alter table public.event_settlements drop constraint if exists event_settlements_settled_by_fkey;
alter table public.financial_ledger drop constraint if exists financial_ledger_created_by_fkey;

do $$
begin
  if exists (
    select 1 from public.staff_schedules s
    where not exists (
      select 1 from public.users u
      where u.lodge_id = s.lodge_id
        and (u.id = s.staff_id or u.auth_user_id = s.staff_id)
    )
  ) then
    raise exception 'Cannot migrate staff_schedules: one or more staff IDs have no public.users mapping';
  end if;

  if exists (
    select 1 from public.staff_attendance a
    where not exists (
      select 1 from public.users u
      where u.lodge_id = a.lodge_id
        and (u.id = a.staff_id or u.auth_user_id = a.staff_id)
    )
  ) then
    raise exception 'Cannot migrate staff_attendance: one or more staff IDs have no public.users mapping';
  end if;

  if exists (
    select 1 from public.staff_leave l
    where not exists (
      select 1 from public.users u
      where u.lodge_id = l.lodge_id
        and (u.id = l.staff_id or u.auth_user_id = l.staff_id)
    )
  ) then
    raise exception 'Cannot migrate staff_leave: one or more staff IDs have no public.users mapping';
  end if;

  if exists (
    select 1 from public.event_settlements s
    where s.settled_by is not null
      and not exists (
        select 1 from public.users u
        where u.lodge_id = s.lodge_id
          and (u.id = s.settled_by or u.auth_user_id = s.settled_by)
      )
  ) then
    raise exception 'Cannot migrate event_settlements: one or more actor IDs have no public.users mapping';
  end if;

  if exists (
    select 1 from public.financial_ledger l
    where l.created_by is not null
      and not exists (
        select 1 from public.users u
        where u.lodge_id = l.lodge_id
          and (u.id = l.created_by or u.auth_user_id = l.created_by)
      )
  ) then
    raise exception 'Cannot migrate financial_ledger: one or more actor IDs have no public.users mapping';
  end if;
end $$;

update public.staff_schedules s
set staff_id = u.id
from public.users u
where u.lodge_id = s.lodge_id
  and u.auth_user_id = s.staff_id
  and s.staff_id is distinct from u.id;

update public.staff_attendance a
set staff_id = u.id
from public.users u
where u.lodge_id = a.lodge_id
  and u.auth_user_id = a.staff_id
  and a.staff_id is distinct from u.id;

update public.staff_leave l
set staff_id = u.id
from public.users u
where u.lodge_id = l.lodge_id
  and u.auth_user_id = l.staff_id
  and l.staff_id is distinct from u.id;

update public.staff_schedules s
set created_by = u.id
from public.users u
where s.created_by is not null
  and u.lodge_id = s.lodge_id
  and u.auth_user_id = s.created_by
  and s.created_by is distinct from u.id;

update public.staff_attendance a
set clocked_in_by = u.id
from public.users u
where a.clocked_in_by is not null
  and u.lodge_id = a.lodge_id
  and u.auth_user_id = a.clocked_in_by
  and a.clocked_in_by is distinct from u.id;

update public.staff_attendance a
set manager_override_by = u.id
from public.users u
where a.manager_override_by is not null
  and u.lodge_id = a.lodge_id
  and u.auth_user_id = a.manager_override_by
  and a.manager_override_by is distinct from u.id;

update public.staff_leave l
set approved_by = u.id
from public.users u
where l.approved_by is not null
  and u.lodge_id = l.lodge_id
  and u.auth_user_id = l.approved_by
  and l.approved_by is distinct from u.id;

update public.event_settlements s
set settled_by = u.id
from public.users u
where s.settled_by is not null
  and u.lodge_id = s.lodge_id
  and u.auth_user_id = s.settled_by
  and s.settled_by is distinct from u.id;

update public.financial_ledger l
set created_by = u.id
from public.users u
where l.created_by is not null
  and u.lodge_id = l.lodge_id
  and u.auth_user_id = l.created_by
  and l.created_by is distinct from u.id;

alter table public.staff_schedules
  add constraint staff_schedules_staff_id_fkey foreign key (staff_id) references public.users(id) on delete cascade,
  add constraint staff_schedules_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;
alter table public.staff_attendance
  add constraint staff_attendance_staff_id_fkey foreign key (staff_id) references public.users(id) on delete cascade,
  add constraint staff_attendance_clocked_in_by_fkey foreign key (clocked_in_by) references public.users(id) on delete set null,
  add constraint staff_attendance_manager_override_by_fkey foreign key (manager_override_by) references public.users(id) on delete set null;
alter table public.staff_leave
  add constraint staff_leave_staff_id_fkey foreign key (staff_id) references public.users(id) on delete cascade,
  add constraint staff_leave_approved_by_fkey foreign key (approved_by) references public.users(id) on delete set null;
alter table public.event_settlements
  add constraint event_settlements_settled_by_fkey foreign key (settled_by) references public.users(id) on delete set null;
alter table public.financial_ledger
  add constraint financial_ledger_created_by_fkey foreign key (created_by) references public.users(id) on delete set null;

create or replace function public.validate_workforce_staff_lodge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.users u
    where u.id = new.staff_id and u.lodge_id = new.lodge_id
  ) then
    raise exception 'Staff member does not belong to this lodge.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_staff_schedules_lodge_scope on public.staff_schedules;
create trigger trg_staff_schedules_lodge_scope
before insert or update of lodge_id, staff_id on public.staff_schedules
for each row execute function public.validate_workforce_staff_lodge();

drop trigger if exists trg_staff_attendance_lodge_scope on public.staff_attendance;
create trigger trg_staff_attendance_lodge_scope
before insert or update of lodge_id, staff_id on public.staff_attendance
for each row execute function public.validate_workforce_staff_lodge();

drop trigger if exists trg_staff_leave_lodge_scope on public.staff_leave;
create trigger trg_staff_leave_lodge_scope
before insert or update of lodge_id, staff_id on public.staff_leave
for each row execute function public.validate_workforce_staff_lodge();

create or replace function public.enforce_self_clock_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := public.app_current_user_id();
begin
  if v_actor_id is null then
    raise exception 'An authenticated application session is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.users u
    where u.id = new.staff_id and u.lodge_id = new.lodge_id
  ) then
    raise exception 'Staff member does not belong to this lodge.' using errcode = '23514';
  end if;

  new.clocked_in_by := v_actor_id;

  if v_actor_id = new.staff_id then
    return new;
  end if;

  if not exists (
    select 1 from public.users u
    where u.id = v_actor_id
      and u.lodge_id = new.lodge_id
      and lower(u.role) in ('manager', 'admin', 'super_admin')
  ) then
    raise exception 'Only managers can clock in other staff members.' using errcode = '42501';
  end if;

  new.manager_override_by := v_actor_id;
  new.manager_override_reason := coalesce(
    nullif(btrim(new.manager_override_reason), ''),
    'Manager clock-in override'
  );
  return new;
end;
$$;

-- Read models now join the canonical public staff directory.
create or replace function public.get_staff_schedule(p_lodge_id uuid, p_date date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager','admin','super_admin','receptionist','operations']);
  select jsonb_agg(jsonb_build_object(
    'id', s.id, 'staff_id', s.staff_id,
    'staff_name', coalesce(u.name, u.email, 'Unknown'),
    'schedule_date', s.schedule_date, 'shift_label', s.shift_label,
    'start_time', s.start_time, 'end_time', s.end_time,
    'role_at_shift', s.role_at_shift, 'notes', s.notes
  ) order by s.shift_label, coalesce(u.name, u.email)) into v_result
  from public.staff_schedules s
  left join public.users u on u.id = s.staff_id and u.lodge_id = s.lodge_id
  where s.lodge_id = p_lodge_id and s.schedule_date = p_date;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.get_staff_schedule_range(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager','admin','super_admin','receptionist','operations']);
  select jsonb_agg(jsonb_build_object(
    'id', s.id, 'staff_id', s.staff_id,
    'staff_name', coalesce(u.name, u.email, 'Unknown'),
    'schedule_date', s.schedule_date, 'shift_label', s.shift_label,
    'start_time', s.start_time, 'end_time', s.end_time,
    'role_at_shift', s.role_at_shift
  ) order by s.schedule_date, s.shift_label, coalesce(u.name, u.email)) into v_result
  from public.staff_schedules s
  left join public.users u on u.id = s.staff_id and u.lodge_id = s.lodge_id
  where s.lodge_id = p_lodge_id and s.schedule_date between p_start_date and p_end_date;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.get_staff_attendance_today(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager','admin','super_admin','receptionist','operations']);
  select jsonb_agg(jsonb_build_object(
    'id', a.id, 'staff_id', a.staff_id,
    'staff_name', coalesce(u.name, u.email, 'Unknown'),
    'clock_in_at', a.clock_in_at, 'clock_out_at', a.clock_out_at,
    'actual_shift_label', a.actual_shift_label, 'notes', a.notes,
    'is_clocked_in', a.clock_out_at is null
  ) order by a.clock_in_at desc) into v_result
  from public.staff_attendance a
  left join public.users u on u.id = a.staff_id and u.lodge_id = a.lodge_id
  where a.lodge_id = p_lodge_id and date(a.clock_in_at) = current_date;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.get_staff_attendance_range(p_lodge_id uuid, p_start_date date, p_end_date date, p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager','admin','super_admin','receptionist','operations']);
  select jsonb_agg(jsonb_build_object(
    'id', a.id, 'staff_id', a.staff_id,
    'staff_name', coalesce(u.name, u.email, 'Unknown'),
    'clock_in_at', a.clock_in_at, 'clock_out_at', a.clock_out_at,
    'actual_shift_label', a.actual_shift_label,
    'duration_hours', case when a.clock_out_at is not null then round(extract(epoch from (a.clock_out_at-a.clock_in_at))/3600,2) end,
    'notes', a.notes
  ) order by a.clock_in_at desc) into v_result
  from public.staff_attendance a
  left join public.users u on u.id = a.staff_id and u.lodge_id = a.lodge_id
  where a.lodge_id = p_lodge_id
    and date(a.clock_in_at) between p_start_date and p_end_date
    and (p_staff_id is null or a.staff_id = p_staff_id);
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.get_staff_leave_requests(p_lodge_id uuid, p_status text default null, p_staff_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_result jsonb;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager','admin','super_admin','receptionist','operations']);
  select jsonb_agg(jsonb_build_object(
    'id', l.id, 'staff_id', l.staff_id,
    'staff_name', coalesce(u.name, u.email, 'Unknown'),
    'leave_type', l.leave_type, 'start_date', l.start_date,
    'end_date', l.end_date, 'total_days', l.total_days,
    'reason', l.reason, 'status', l.status,
    'approved_by', l.approved_by, 'approved_at', l.approved_at,
    'rejection_reason', l.rejection_reason, 'created_at', l.created_at
  ) order by l.created_at desc) into v_result
  from public.staff_leave l
  left join public.users u on u.id = l.staff_id and u.lodge_id = l.lodge_id
  where l.lodge_id = p_lodge_id
    and (p_status is null or l.status = p_status)
    and (p_staff_id is null or l.staff_id = p_staff_id);
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.upsert_staff_schedule(
  p_lodge_id uuid, p_staff_id uuid, p_schedule_date date,
  p_shift_label text, p_start_time time, p_end_time time,
  p_role_at_shift text default null, p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager','admin','super_admin']);
  insert into public.staff_schedules (
    lodge_id, staff_id, schedule_date, shift_label, start_time, end_time,
    role_at_shift, notes, created_by
  ) values (
    p_lodge_id, p_staff_id, p_schedule_date, p_shift_label, p_start_time,
    p_end_time, p_role_at_shift, p_notes, public.app_current_user_id()
  ) returning id into v_id;
  return jsonb_build_object('success', true, 'schedule_id', v_id);
end;
$$;

create or replace function public.approve_staff_leave(p_id uuid, p_lodge_id uuid, p_status text, p_rejection_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public.app_require_feature(p_lodge_id, 'workforce_management', array['manager','admin','super_admin']);
  if p_status not in ('approved', 'rejected') then
    return jsonb_build_object('success', false, 'error', 'Status must be approved or rejected');
  end if;
  update public.staff_leave set
    status = p_status,
    approved_by = public.app_current_user_id(),
    approved_at = case when p_status = 'approved' then now() else null end,
    rejection_reason = case when p_status = 'rejected' then nullif(btrim(p_rejection_reason), '') else null end,
    updated_at = now()
  where id = p_id and lodge_id = p_lodge_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Leave request not found');
  end if;
  return jsonb_build_object('success', true);
end;
$$;

-- Tighten adjustment metadata even when the amount is zero.
alter table public.event_settlements drop constraint if exists event_settlements_adjustment_check;
alter table public.event_settlements add constraint event_settlements_adjustment_check check (
  (
    coalesce(adjustment_amount, 0) = 0
    and adjustment_type is null
  )
  or
  (
    coalesce(adjustment_amount, 0) > 0
    and adjustment_type in ('credit', 'waiver', 'discount')
    and nullif(btrim(coalesce(adjustment_reason, '')), '') is not null
  )
);

-- Claim package applications before checking mutable event state. A retry of a
-- completed operation must return its stored result, while a new key must not
-- add charges to a terminal event. Package application is financially
-- meaningful, so the idempotency key is mandatory and payload-bound.
create or replace function public.apply_venue_package_to_event(
  p_package_id uuid,
  p_event_booking_id uuid,
  p_lodge_id uuid,
  p_quantity int default 1,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pkg record;
  v_item jsonb;
  v_count int := 0;
  v_claim jsonb;
  v_result jsonb;
  v_request_hash text;
  v_source_prefix text;
  v_event_lodge_id uuid;
  v_event_status text;
begin
  perform public.app_require_feature(p_lodge_id, 'venue_management', array['manager', 'admin', 'super_admin']);

  if p_quantity < 1 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be at least 1');
  end if;
  if p_idempotency_key is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 128 then
    return jsonb_build_object('success', false, 'error', 'Idempotency key must be 8 to 128 characters');
  end if;

  v_request_hash := encode(sha256(convert_to(
    concat_ws('|', p_lodge_id::text, p_package_id::text, p_event_booking_id::text, p_quantity::text),
    'UTF8'
  )), 'hex');

  -- The row lock serializes package additions with settlement for this event.
  select lodge_id, status into v_event_lodge_id, v_event_status
  from public.conference_bookings
  where id = p_event_booking_id
  for update;
  if not found or v_event_lodge_id is distinct from p_lodge_id then
    return jsonb_build_object('success', false, 'error', 'Event booking not found or belongs to a different lodge');
  end if;

  v_claim := public._claim_financial_operation(
    p_lodge_id,
    btrim(p_idempotency_key),
    'apply_venue_package',
    p_event_booking_id,
    v_request_hash
  );
  if (v_claim->>'success')::boolean is not true then
    return v_claim;
  end if;
  if (v_claim->>'found')::boolean is true then
    return coalesce(v_claim->'operation_result', jsonb_build_object('success', true));
  end if;

  if lower(coalesce(v_event_status, '')) in ('completed', 'cancelled') then
    return jsonb_build_object('success', false, 'error', 'Cannot add a package to a terminal event booking');
  end if;

  select * into v_pkg
  from public.venue_packages
  where id = p_package_id and lodge_id = p_lodge_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Package not found');
  end if;

  -- A hash-derived source keeps references short and distinct when the same
  -- package is intentionally purchased more than once with different keys.
  v_source_prefix := 'package-' || left(
    encode(sha256(convert_to(btrim(p_idempotency_key), 'UTF8')), 'hex'),
    20
  );
  for v_item in select * from jsonb_array_elements(v_pkg.items)
  loop
    insert into public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference
    ) values (
      p_lodge_id, p_event_booking_id,
      coalesce(v_item->>'line_type', 'package'),
      v_item->>'description',
      coalesce(v_item->>'category', v_pkg.category),
      coalesce((v_item->>'quantity')::numeric, 1) * p_quantity,
      coalesce((v_item->>'unit_price')::numeric, 0),
      coalesce((v_item->>'quantity')::numeric, 1) * p_quantity * coalesce((v_item->>'unit_price')::numeric, 0),
      v_source_prefix || '-item-' || v_count
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    insert into public.event_booking_line_items (
      lodge_id, event_booking_id, line_type, description, category,
      quantity, unit_price, subtotal, source_reference
    ) values (
      p_lodge_id, p_event_booking_id, 'package', v_pkg.package_name, v_pkg.category,
      p_quantity, v_pkg.base_price, p_quantity * v_pkg.base_price,
      v_source_prefix || '-base'
    );
    v_count := 1;
  end if;

  perform public.recalculate_event_totals(p_event_booking_id, p_lodge_id);
  v_result := jsonb_build_object(
    'success', true,
    'items_added', v_count,
    'event_booking_id', p_event_booking_id
  );
  perform public._record_financial_operation(
    p_lodge_id,
    btrim(p_idempotency_key),
    'apply_venue_package',
    p_event_booking_id,
    v_request_hash,
    v_result
  );
  return v_result;
end;
$$;

grant execute on function public.apply_venue_package_to_event(uuid, uuid, uuid, int, text) to authenticated;

commit;

-- Accommodation group invoices.
-- A group invoice is a customer-facing invoice wrapper over multiple normal
-- room bookings. It does not replace the per-room booking records that drive
-- availability, room profitability, housekeeping, payments, and refunds.

create table if not exists public.booking_invoice_groups (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  group_key text not null,
  customer_id uuid references public.customers(id) on delete set null,
  invoice_number text not null,
  issued_at timestamptz not null default now(),
  due_date date,
  notes text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, group_key)
);

create table if not exists public.booking_invoice_group_lines (
  group_id uuid not null references public.booking_invoice_groups(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  lodge_id uuid not null,
  line_order integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (group_id, booking_id),
  unique (booking_id)
);

create unique index if not exists booking_invoice_groups_lodge_invoice_uidx
  on public.booking_invoice_groups(lodge_id, invoice_number);

create index if not exists booking_invoice_group_lines_lodge_idx
  on public.booking_invoice_group_lines(lodge_id, group_id);

create index if not exists booking_invoice_group_lines_booking_idx
  on public.booking_invoice_group_lines(booking_id);

alter table public.booking_invoice_groups enable row level security;
alter table public.booking_invoice_group_lines enable row level security;

drop policy if exists booking_invoice_groups_select_own_lodge on public.booking_invoice_groups;
create policy booking_invoice_groups_select_own_lodge
  on public.booking_invoice_groups
  for select
  using (public.app_lodge_access(lodge_id));

drop policy if exists booking_invoice_group_lines_select_own_lodge on public.booking_invoice_group_lines;
create policy booking_invoice_group_lines_select_own_lodge
  on public.booking_invoice_group_lines
  for select
  using (public.app_lodge_access(lodge_id));

create or replace function public.create_booking_invoice_group(
  p_lodge_id uuid,
  p_group_key text,
  p_customer_id uuid,
  p_booking_ids uuid[],
  p_invoice_number text default null,
  p_notes text default null,
  p_created_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_group_id uuid;
  v_invoice_number text := nullif(btrim(coalesce(p_invoice_number, '')), '');
  v_group_key text := nullif(btrim(coalesce(p_group_key, '')), '');
  v_booking_count integer := coalesce(array_length(p_booking_ids, 1), 0);
  v_valid_count integer;
  v_existing public.booking_invoice_groups%rowtype;
  v_idx integer := 1;
  v_booking_id uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'manager', 'admin', 'super_admin']);

  if v_group_key is null then
    return jsonb_build_object('success', false, 'error', 'Group key is required');
  end if;

  if v_booking_count < 2 then
    return jsonb_build_object('success', false, 'error', 'A group invoice requires at least two booking lines');
  end if;

  select count(*) into v_valid_count
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and b.customer_id is not distinct from p_customer_id
     and b.id = any(p_booking_ids);

  if v_valid_count <> v_booking_count then
    return jsonb_build_object('success', false, 'error', 'All group invoice bookings must belong to the same lodge and customer');
  end if;

  select *
    into v_existing
    from public.booking_invoice_groups
   where lodge_id = p_lodge_id
     and group_key = v_group_key
   limit 1;

  if found then
    v_group_id := v_existing.id;
    v_invoice_number := v_existing.invoice_number;
  else
    if v_invoice_number is null then
      v_invoice_number := public.get_next_invoice_number(p_lodge_id);
    end if;

    insert into public.booking_invoice_groups (
      lodge_id, group_key, customer_id, invoice_number, due_date, notes, created_by
    ) values (
      p_lodge_id,
      v_group_key,
      p_customer_id,
      v_invoice_number,
      (select min(check_in) from public.bookings where id = any(p_booking_ids)),
      nullif(p_notes, ''),
      p_created_by
    )
    returning id into v_group_id;
  end if;

  foreach v_booking_id in array p_booking_ids loop
    insert into public.booking_invoice_group_lines (
      group_id, booking_id, lodge_id, line_order
    ) values (
      v_group_id, v_booking_id, p_lodge_id, v_idx
    )
    on conflict (booking_id) do update
      set group_id = excluded.group_id,
          lodge_id = excluded.lodge_id,
          line_order = excluded.line_order;
    v_idx := v_idx + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'group_id', v_group_id,
    'group_key', v_group_key,
    'invoice_number', v_invoice_number,
    'booking_ids', p_booking_ids
  );
end;
$$;

grant execute on function public.create_booking_invoice_group(uuid, text, uuid, uuid[], text, text, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Import batch tracking: tags imported records and enables undo
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Import batches ledger
create table if not exists public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  lodge_id      uuid not null,
  imported_by   uuid,
  filename      text,
  entity_type   text not null default 'bookings',
  row_count     int not null default 0,
  error_count   int not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.import_batches enable row level security;

create policy import_batches_lodge_access on public.import_batches
  for all using (public.app_lodge_access(lodge_id));

grant select, insert, update, delete on public.import_batches to authenticated;

-- 2. Add import_batch_id to bookings
alter table public.bookings
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

create index if not exists bookings_import_batch_idx on public.bookings(import_batch_id)
  where import_batch_id is not null;

-- 3. Add import_batch_id to customers (for undo of auto-created customers)
alter table public.customers
  add column if not exists import_batch_id uuid references public.import_batches(id) on delete set null;

-- 4. RPC: undo an import batch (deletes bookings + auto-created customers tagged with batch)
create or replace function public.undo_import_batch(p_batch_id uuid, p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_batch       record;
  v_deleted_bookings  int;
  v_deleted_customers int;
begin
  select * into v_batch from public.import_batches
   where id = p_batch_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Import batch not found');
  end if;

  -- Delete bookings tagged with this batch
  delete from public.bookings
   where import_batch_id = p_batch_id and lodge_id = p_lodge_id;
  get diagnostics v_deleted_bookings = row_count;

  -- Delete customers that were auto-created by this batch (and have no other bookings)
  delete from public.customers c
   where c.import_batch_id = p_batch_id
     and c.lodge_id = p_lodge_id
     and not exists (
       select 1 from public.bookings b where b.customer_id = c.id
     );
  get diagnostics v_deleted_customers = row_count;

  -- Remove the batch record itself
  delete from public.import_batches where id = p_batch_id;

  return jsonb_build_object(
    'success', true,
    'deleted_bookings', v_deleted_bookings,
    'deleted_customers', v_deleted_customers
  );
end;
$$;

grant execute on function public.undo_import_batch(uuid, uuid) to authenticated;

-- 5. RPC: check for duplicate bookings before import
create or replace function public.check_import_duplicates(p_lodge_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row        jsonb;
  v_idx        int := 0;
  v_duplicates jsonb := '[]'::jsonb;
  v_room       record;
  v_conflict   uuid;
begin
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;

    -- Look up room
    select id into v_room
      from public.rooms
     where lodge_id = p_lodge_id
       and lower(trim(room_number::text)) = lower(trim(v_row->>'room_number'))
     limit 1;

    if not found then continue; end if;

    -- Check for overlapping non-cancelled booking on same room
    select b.id into v_conflict
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.room_id = v_room.id
       and b.status <> 'cancelled'
       and not (b.check_out <= (v_row->>'check_in')::date or b.check_in >= (v_row->>'check_out')::date)
     limit 1;

    if v_conflict is not null then
      v_duplicates := v_duplicates || jsonb_build_object(
        'row', v_idx,
        'room_number', v_row->>'room_number',
        'check_in', v_row->>'check_in',
        'check_out', v_row->>'check_out',
        'guest_name', v_row->>'guest_name'
      );
    end if;
  end loop;

  return jsonb_build_object('duplicates', v_duplicates);
end;
$$;

grant execute on function public.check_import_duplicates(uuid, jsonb) to authenticated;

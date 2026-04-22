-- Creates the quotations table.
-- All quotation mutation RPCs (create_quotation, update_quotation,
-- mark_quotation_sent, convert_quotation_to_booking) depend on this table.

create table if not exists public.quotations (
  id                   uuid        primary key default gen_random_uuid(),
  quotation_number     text        not null,
  lodge_id             uuid        not null,
  customer_id          uuid,
  customer_name        text        not null default '',
  customer_phone       text        not null default '',
  room_id              uuid,
  room_name            text        not null default '',
  check_in             date,
  check_out            date,
  adults               integer     not null default 1,
  children             integer     not null default 0,
  subtotal             numeric     not null default 0,
  tax_amount           numeric     not null default 0,
  total_amount         numeric     not null default 0,
  currency             text        not null default 'BWP',
  notes                text        not null default '',
  status               text        not null default 'draft',
  valid_until          date,
  parent_quotation_id  uuid,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint quotations_status_check
    check (status in ('draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled')),

  constraint quotations_lodge_id_quotation_number_key
    unique (lodge_id, quotation_number)
);

-- ── Ensure status constraint is correct even if table pre-existed ────────────
-- CREATE TABLE IF NOT EXISTS skips the whole statement when the table already
-- exists, leaving any old constraint untouched. Explicitly replace it here.

alter table public.quotations
  drop constraint if exists quotations_status_check;

alter table public.quotations
  add constraint quotations_status_check
  check (status in ('draft', 'sent', 'accepted', 'converted', 'expired', 'cancelled'));

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists idx_quotations_lodge_id
  on public.quotations (lodge_id);

create index if not exists idx_quotations_customer_id
  on public.quotations (customer_id)
  where customer_id is not null;

create index if not exists idx_quotations_status
  on public.quotations (lodge_id, status);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.quotations enable row level security;

-- All mutations go through security-definer RPCs; direct writes are blocked.
-- Reads are allowed so the client can fetch its own lodge's quotations.
drop policy if exists "lodge members can read own quotations" on public.quotations;

create policy "lodge members can read own quotations"
  on public.quotations
  for select
  using (
    lodge_id = (
      select lodge_id from public.users
       where id = auth.uid()
      limit 1
    )
  );

-- ── Grants ────────────────────────────────────────────────────────────────────

revoke all privileges on table public.quotations from anon, authenticated;
grant select on table public.quotations to anon, authenticated;

revoke truncate, references, trigger on table public.quotations
  from anon, authenticated;

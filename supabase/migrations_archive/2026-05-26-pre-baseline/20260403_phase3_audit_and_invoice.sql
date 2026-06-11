-- Phase 3 — Step 1 + 2: Financial Audit Trail & Invoice Summary RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Decisions applied:
--   • Actor: current_setting('app.actor_id', true) — set by pre-request hook
--     from the validated app_sessions row. Falls back to null (anonymous trigger path).
--   • Invoice consistency: get_invoice_summary RPC, not a view.
--     Consistent with existing RLS + SECURITY DEFINER RPC architecture.
--
-- Changes:
--   A. Extend handle_pgrst_request to also set app.actor_id from validated session.
--   B. Create financial_audit_log table (append-only by policy).
--   C. Trigger on payments → inserts audit rows automatically.
--   D. Trigger on booking_charges (insert+delete) → inserts audit rows.
--   E. update_booking extended to write audit row on total_amount change.
--   F. get_invoice_summary RPC — authoritative invoice read path.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ══════════════════════════════════════════════════════════════════════════════
-- A. EXTEND PRE-REQUEST HOOK — set app.actor_id alongside app.session_token
-- ══════════════════════════════════════════════════════════════════════════════
-- The existing hook (Phase 1) already sets app.session_token.
-- This extension resolves the session row and stores the validated user_id
-- as app.actor_id so all triggers and RPCs can read a trusted actor without
-- re-querying app_sessions themselves.
--
-- Falls back to empty string (not null) to satisfy set_config type requirement.
-- Callers should treat '' as "no actor" (anonymous / system path).

create or replace function public.handle_pgrst_request()
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_token   text;
  v_actor   text;
  v_session public.app_sessions%rowtype;
begin
  -- ── Token resolution (unchanged from Phase 1) ───────────────────────────
  v_token := coalesce(
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session',        '')), ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session-token',  '')), ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x_boroko_session',        '')), ''),
    ''
  );
  perform set_config('app.session_token', v_token, true);

  -- ── Actor resolution (Phase 3 addition) ────────────────────────────────
  -- Resolve the user_id from the session row so triggers can capture a
  -- trusted actor without needing a separate session lookup.
  v_actor := '';
  if v_token <> '' then
    select s.user_id::text
      into v_actor
      from public.app_sessions s
     where s.token          = v_token
       and s.expires_at     > now()
       and s.revoked_at    is null
     limit 1;
    v_actor := coalesce(v_actor, '');
  end if;
  perform set_config('app.actor_id', v_actor, true);
end;
$function$;

-- Grants unchanged — authenticator only
revoke all on function public.handle_pgrst_request() from public, anon, authenticated;
grant execute on function public.handle_pgrst_request() to authenticator;


-- ══════════════════════════════════════════════════════════════════════════════
-- B. FINANCIAL AUDIT LOG TABLE
-- ══════════════════════════════════════════════════════════════════════════════
-- Append-only: no UPDATE/DELETE granted to any role.
-- Rows are written via triggers (payments, booking_charges) and directly inside
-- update_booking when total_amount changes.
-- Soft tamper-resistance: trigger + rpc paths. Physical deletion requires
-- direct DB admin access (not exposed via any RPC or API).

create table if not exists public.financial_audit_log (
  id               uuid        primary key default gen_random_uuid(),
  lodge_id         uuid        not null,
  booking_id       uuid,                    -- null for non-booking actions
  action           text        not null,    -- see allowed values below
  actor_id         uuid,                    -- resolved from app.actor_id GUC; null = system/trigger
  amount_delta     numeric,                 -- positive = money in, negative = money out; null = no amount
  before_snapshot  jsonb,                   -- relevant scalar fields BEFORE the change
  after_snapshot   jsonb,                   -- relevant scalar fields AFTER the change
  idempotency_key  text,                    -- payment idempotency_key if applicable
  created_at       timestamptz not null default now()
);

-- action must be one of a fixed set — enforced by check constraint
alter table public.financial_audit_log
  add constraint financial_audit_log_action_check
  check (action in (
    'payment_recorded',
    'refund_recorded',
    'charge_added',
    'charge_deleted',
    'booking_total_edited',
    'booking_status_changed'
  ));

create index if not exists financial_audit_log_lodge_id_idx    on public.financial_audit_log (lodge_id);
create index if not exists financial_audit_log_booking_id_idx  on public.financial_audit_log (booking_id);
create index if not exists financial_audit_log_created_at_idx  on public.financial_audit_log (created_at desc);

-- RLS: authenticated sessions may read their lodge's rows; no direct write
alter table public.financial_audit_log enable row level security;

create policy "audit_log_select_own_lodge" on public.financial_audit_log
  for select
  using (public.app_lodge_access(lodge_id));

-- No INSERT policy — only trust paths: triggers (SECURITY DEFINER) and RPCs
-- Writing directly via REST is impossible without a policy.


-- ══════════════════════════════════════════════════════════════════════════════
-- C. TRIGGER: payments → financial_audit_log
-- ══════════════════════════════════════════════════════════════════════════════
-- Fires AFTER INSERT so the payment row is already committed to the table.
-- Reads actor_id from the GUC set by handle_pgrst_request().
-- type = 'refund' → action = 'refund_recorded'; otherwise 'payment_recorded'.

create or replace function public._audit_payment_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_raw text;
  v_actor     uuid;
  v_action    text;
  v_before    jsonb;
begin
  -- Resolve actor from GUC; coerce empty string → null
  v_actor_raw := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor := case when v_actor_raw ~ '^[0-9a-f\-]{36}$' then v_actor_raw::uuid else null end;

  v_action := case
    when lower(coalesce(new.type, '')) = 'refund' then 'refund_recorded'
    else 'payment_recorded'
  end;

  -- Capture booking state at the moment of payment for context
  select jsonb_build_object(
      'amount_paid',    b.amount_paid,
      'total_amount',   b.total_amount,
      'charges_total',  b.charges_total,
      'payment_status', b.payment_status
    )
    into v_before
    from public.bookings b
   where b.id = new.booking_id
   limit 1;

  insert into public.financial_audit_log (
    lodge_id, booking_id, action, actor_id,
    amount_delta, before_snapshot, after_snapshot,
    idempotency_key
  ) values (
    new.lodge_id,
    new.booking_id,
    v_action,
    v_actor,
    new.amount,       -- positive = payment, negative = refund
    v_before,
    jsonb_build_object(
      'payment_id',     new.id,
      'payment_type',   new.type,
      'payment_method', new.method,
      'amount',         new.amount,
      'paid_at',        new.paid_at
    ),
    new.idempotency_key
  );
  return null; -- AFTER trigger; return value ignored
end;
$function$;

drop trigger if exists trig_audit_payment_insert on public.payments;
create trigger trig_audit_payment_insert
  after insert on public.payments
  for each row execute function public._audit_payment_insert();


-- ══════════════════════════════════════════════════════════════════════════════
-- D. TRIGGER: booking_charges → financial_audit_log
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public._audit_booking_charge()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_actor_raw text;
  v_actor     uuid;
  v_action    text;
  v_row       public.booking_charges%rowtype;
  v_before    jsonb;
begin
  v_actor_raw := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor     := case when v_actor_raw ~ '^[0-9a-f\-]{36}$' then v_actor_raw::uuid else null end;

  if (tg_op = 'INSERT') then
    v_row    := new;
    v_action := 'charge_added';
    v_before := null;
  else
    v_row    := old;
    v_action := 'charge_deleted';
    v_before := jsonb_build_object(
      'charge_id',   v_row.id,
      'description', v_row.description,
      'category',    v_row.category,
      'amount',      v_row.amount
    );
  end if;

  -- Booking snapshot (charges_total at time of trigger)
  select jsonb_build_object(
      'amount_paid',    b.amount_paid,
      'total_amount',   b.total_amount,
      'charges_total',  b.charges_total,
      'payment_status', b.payment_status
    )
    into v_before
    from public.bookings b
   where b.id = v_row.booking_id
   limit 1;

  insert into public.financial_audit_log (
    lodge_id, booking_id, action, actor_id,
    amount_delta, before_snapshot, after_snapshot
  ) values (
    v_row.lodge_id,
    v_row.booking_id,
    v_action,
    v_actor,
    case tg_op when 'INSERT' then v_row.amount else -v_row.amount end,
    v_before,
    jsonb_build_object(
      'charge_id',   v_row.id,
      'description', v_row.description,
      'category',    v_row.category,
      'quantity',    v_row.quantity,
      'unit_price',  v_row.unit_price,
      'amount',      v_row.amount
    )
  );
  return null;
end;
$function$;

drop trigger if exists trig_audit_charge_change on public.booking_charges;
create trigger trig_audit_charge_change
  after insert or delete on public.booking_charges
  for each row execute function public._audit_booking_charge();


-- ══════════════════════════════════════════════════════════════════════════════
-- E. UPDATE update_booking — write audit row on total_amount / status change
-- ══════════════════════════════════════════════════════════════════════════════
-- This replaces the Phase 2.1 version, adds only the audit INSERT block.
-- All existing guards (overpayment, overlap, server-side status) are preserved.

create or replace function public.update_booking(
  p_id       uuid,
  p_lodge_id uuid,
  payload    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current    public.bookings%rowtype;
  v_room_id    uuid;
  v_check_in   date;
  v_check_out  date;
  v_new_total  numeric;
  v_new_status text;
  v_conflict   uuid;
  v_total_owed numeric;
  v_actor_raw  text;
  v_actor      uuid;
  v_financial_changed boolean;
begin
  -- Row-level lock (prevents concurrent payment racing a total edit)
  select *
    into v_current
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_room_id   := coalesce((payload->>'room_id')::uuid, v_current.room_id);
  v_check_in  := coalesce((payload->>'check_in')::date, v_current.check_in);
  v_check_out := coalesce((payload->>'check_out')::date, v_current.check_out);

  v_new_total := case
    when payload ? 'total_amount'
      then coalesce((payload->>'total_amount')::numeric, 0)
    else v_current.total_amount
  end;

  -- B1 guard (Phase 2.1): block total edit below amount_paid
  v_total_owed := v_new_total + coalesce(v_current.charges_total, 0);
  if v_total_owed < coalesce(v_current.amount_paid, 0) then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Cannot reduce booking total to %s: guest has already paid %s. '
        'Record a refund first, then adjust the total.',
        round(v_new_total::numeric, 2),
        round(coalesce(v_current.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  -- Overlap check (excludes self)
  select b.id
    into v_conflict
    from public.bookings b
   where b.lodge_id = p_lodge_id
     and b.room_id  = v_room_id
     and b.id      <> p_id
     and b.status  <> 'cancelled'
     and not (b.check_out <= v_check_in or b.check_in >= v_check_out)
   limit 1;

  if v_conflict is not null then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  end if;

  -- Derive payment_status server-side
  v_new_status := public.compute_payment_status(
    coalesce(v_current.amount_paid, 0),
    v_new_total,
    coalesce(v_current.charges_total, 0)
  );

  update public.bookings
     set customer_id    = coalesce((payload->>'customer_id')::uuid, customer_id),
         room_id        = v_room_id,
         check_in       = v_check_in,
         check_out      = v_check_out,
         adults         = case when payload ? 'adults'   then coalesce((payload->>'adults')::int,   1) else adults   end,
         children       = case when payload ? 'children' then coalesce((payload->>'children')::int, 0) else children end,
         total_amount   = v_new_total,
         payment_status = v_new_status,
         notes          = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         updated_at     = now()
   where id = p_id
     and lodge_id = p_lodge_id;

  -- ── Phase 3: Audit row on financial/status change ───────────────────────
  v_financial_changed :=
    (payload ? 'total_amount' and v_new_total <> v_current.total_amount) or
    (v_new_status <> coalesce(v_current.payment_status, 'unpaid'));

  if v_financial_changed then
    v_actor_raw := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
    v_actor := case when v_actor_raw ~ '^[0-9a-f\-]{36}$' then v_actor_raw::uuid else null end;

    insert into public.financial_audit_log (
      lodge_id, booking_id, action, actor_id,
      amount_delta, before_snapshot, after_snapshot
    ) values (
      p_lodge_id,
      p_id,
      'booking_total_edited',
      v_actor,
      v_new_total - v_current.total_amount,
      jsonb_build_object(
        'total_amount',   v_current.total_amount,
        'amount_paid',    v_current.amount_paid,
        'charges_total',  v_current.charges_total,
        'payment_status', v_current.payment_status
      ),
      jsonb_build_object(
        'total_amount',   v_new_total,
        'amount_paid',    v_current.amount_paid,
        'charges_total',  v_current.charges_total,
        'payment_status', v_new_status
      )
    );
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status);
end;
$function$;

grant execute on function public.update_booking(uuid, uuid, jsonb) to anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- F. get_invoice_summary RPC — authoritative invoice read path
-- ══════════════════════════════════════════════════════════════════════════════
-- Amount/status fields sourced from bookings (the server-side source of truth).
-- Never from any client-supplied or locally-computed value.
-- Requires a valid lodge session (app_lodge_access check).
-- Accepts optional p_booking_id to fetch a single invoice or null to list all
-- for the lodge.

create or replace function public.get_invoice_summary(
  p_lodge_id  uuid,
  p_booking_id uuid default null
)
returns table (
  invoice_id      uuid,
  invoice_number  text,
  booking_id      uuid,
  lodge_id        uuid,
  issued_at       timestamptz,
  due_date        date,
  notes           text,
  -- Guest info
  guest_name      text,
  customer_email  text,
  -- Booking dates
  check_in        date,
  check_out       date,
  -- Financial: all authoritative from bookings
  total_amount    numeric,
  charges_total   numeric,
  amount_paid     numeric,
  balance_due     numeric,
  payment_status  text,
  booking_status  text,
  -- Payment ledger summary
  payment_count   bigint,
  last_payment_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- Enforce lodge access using existing session guard
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select
    i.id                                                           as invoice_id,
    i.invoice_number,
    b.id                                                           as booking_id,
    b.lodge_id,
    i.issued_at,
    i.due_date,
    i.notes,
    -- Guest: prefer customer name, fall back to booking guest_name column if present
    coalesce(c.name, b.guest_name, 'Guest')                        as guest_name,
    coalesce(c.email, '')                                          as customer_email,
    b.check_in,
    b.check_out,
    -- Financial: always from bookings (authoritative)
    coalesce(b.total_amount, 0)                                    as total_amount,
    coalesce(b.charges_total, 0)                                   as charges_total,
    coalesce(b.amount_paid, 0)                                     as amount_paid,
    -- balance_due computed fresh; cannot drift
    greatest(0, coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)) as balance_due,
    coalesce(b.payment_status, 'unpaid')                           as payment_status,
    coalesce(b.status, 'confirmed')                                as booking_status,
    -- Payment ledger count
    coalesce(pay_agg.payment_count, 0)                             as payment_count,
    pay_agg.last_payment_at
  from public.invoices i
  join public.bookings b
    on b.id = i.booking_id
   and b.lodge_id = p_lodge_id
  left join public.customers c
    on c.id = b.customer_id
  left join lateral (
    select
      count(*)            as payment_count,
      max(p.paid_at)      as last_payment_at
    from public.payments p
    where p.booking_id = b.id
      and p.lodge_id   = p_lodge_id
  ) pay_agg on true
  where i.lodge_id = p_lodge_id
    and (p_booking_id is null or b.id = p_booking_id)
  order by i.issued_at desc;
end;
$function$;

grant execute on function public.get_invoice_summary(uuid, uuid) to anon, authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- HELPER: get_financial_audit_log — paginated read for desktop/admin UI
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.get_financial_audit_log(
  p_lodge_id   uuid,
  p_booking_id uuid    default null,
  p_limit      integer default 100,
  p_offset     integer default 0
)
returns table (
  id              uuid,
  lodge_id        uuid,
  booking_id      uuid,
  action          text,
  actor_id        uuid,
  amount_delta    numeric,
  before_snapshot jsonb,
  after_snapshot  jsonb,
  idempotency_key text,
  created_at      timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select
    l.id, l.lodge_id, l.booking_id, l.action, l.actor_id,
    l.amount_delta, l.before_snapshot, l.after_snapshot,
    l.idempotency_key, l.created_at
  from public.financial_audit_log l
  where l.lodge_id   = p_lodge_id
    and (p_booking_id is null or l.booking_id = p_booking_id)
  order by l.created_at desc
  limit  least(coalesce(p_limit,  100), 500)
  offset coalesce(p_offset, 0);
end;
$function$;

grant execute on function public.get_financial_audit_log(uuid, uuid, integer, integer) to anon, authenticated;


notify pgrst, 'reload schema';

commit;

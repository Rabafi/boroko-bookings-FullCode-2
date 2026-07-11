begin;

-- Owner-grade controls deliberately live beside the POS ledger.  A settlement is
-- an external confirmation, never a replacement for a recorded POS payment.
create table if not exists public.restaurant_settlement_reconciliations (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  outlet_id uuid,
  business_date date not null,
  channel text not null check (channel in ('card', 'mobile_money', 'delivery_platform', 'bank', 'voucher')),
  provider text,
  expected_amount numeric not null check (expected_amount >= 0),
  settled_amount numeric not null check (settled_amount >= 0),
  variance_amount numeric generated always as (settled_amount - expected_amount) stored,
  reference text,
  notes text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved')),
  recorded_by uuid not null,
  reviewed_by uuid,
  reviewed_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, idempotency_key)
);

create table if not exists public.restaurant_reservation_deposits (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  reservation_id uuid not null references public.restaurant_reservations(id) on delete restrict,
  amount numeric not null check (amount > 0),
  method text not null check (method in ('cash', 'card', 'mobile_money', 'bank_transfer', 'voucher')),
  status text not null default 'held' check (status in ('held', 'applied', 'refunded', 'forfeited')),
  reference text,
  notes text,
  received_by uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, idempotency_key)
);

create table if not exists public.restaurant_customer_feedback (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  customer_id uuid references public.restaurant_customers(id) on delete set null,
  order_id uuid,
  rating integer check (rating between 1 and 5),
  channel text not null default 'in_store' check (channel in ('in_store', 'phone', 'online', 'delivery_platform')),
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'resolved')),
  follow_up_note text,
  created_by uuid not null,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.restaurant_settlement_reconciliations enable row level security;
alter table public.restaurant_reservation_deposits enable row level security;
alter table public.restaurant_customer_feedback enable row level security;

create policy restaurant_settlements_lodge_scope on public.restaurant_settlement_reconciliations for all using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id));
create policy restaurant_reservation_deposits_lodge_scope on public.restaurant_reservation_deposits for all using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id));
create policy restaurant_feedback_lodge_scope on public.restaurant_customer_feedback for all using (public.app_lodge_access(lodge_id)) with check (public.app_lodge_access(lodge_id));

create or replace function public.record_restaurant_settlement(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid := (p_payload->>'lodge_id')::uuid; v_actor uuid := auth.uid(); v_id uuid; v_expected numeric := coalesce((p_payload->>'expected_amount')::numeric, 0); v_settled numeric := coalesce((p_payload->>'settled_amount')::numeric, 0); v_key text := nullif(p_payload->>'idempotency_key', ''); v_existing public.restaurant_settlement_reconciliations%rowtype;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager','supervisor']);
  if v_key is null or length(v_key) < 8 then raise exception 'A stable settlement idempotency key is required'; end if;
  if v_expected < 0 or v_settled < 0 then raise exception 'Settlement amounts cannot be negative'; end if;
  select * into v_existing from public.restaurant_settlement_reconciliations where lodge_id = v_lodge_id and idempotency_key = v_key;
  if found then
    if v_existing.channel <> p_payload->>'channel' or v_existing.expected_amount <> v_expected or v_existing.settled_amount <> v_settled then raise exception 'Settlement idempotency key was already used with a different payload'; end if;
    return jsonb_build_object('success', true, 'id', v_existing.id, 'duplicate', true);
  end if;
  insert into public.restaurant_settlement_reconciliations (lodge_id, outlet_id, business_date, channel, provider, expected_amount, settled_amount, reference, notes, recorded_by, idempotency_key)
  values (v_lodge_id, nullif(p_payload->>'outlet_id','')::uuid, coalesce((p_payload->>'business_date')::date, current_date), p_payload->>'channel', nullif(p_payload->>'provider',''), v_expected, v_settled, nullif(p_payload->>'reference',''), nullif(p_payload->>'notes',''), v_actor, v_key)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end; $$;

create or replace function public.get_restaurant_settlements(p_lodge_id uuid, p_business_date date default current_date)
returns setof public.restaurant_settlement_reconciliations language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['admin','manager','supervisor']);
  return query select * from public.restaurant_settlement_reconciliations where lodge_id = p_lodge_id and business_date = p_business_date order by created_at desc;
end; $$;

create or replace function public.record_restaurant_reservation_deposit(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid := (p_payload->>'lodge_id')::uuid; v_reservation uuid := (p_payload->>'reservation_id')::uuid; v_actor uuid := auth.uid(); v_id uuid; v_key text := nullif(p_payload->>'idempotency_key', ''); v_existing public.restaurant_reservation_deposits%rowtype;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager','supervisor']);
  if v_key is null or length(v_key) < 8 then raise exception 'A stable deposit idempotency key is required'; end if;
  if coalesce((p_payload->>'amount')::numeric, 0) <= 0 then raise exception 'Deposit amount must be positive'; end if;
  if not exists (select 1 from public.restaurant_reservations where id = v_reservation and lodge_id = v_lodge_id) then raise exception 'Reservation not found for restaurant'; end if;
  select * into v_existing from public.restaurant_reservation_deposits where lodge_id = v_lodge_id and idempotency_key = v_key;
  if found then
    if v_existing.reservation_id <> v_reservation or v_existing.amount <> (p_payload->>'amount')::numeric or v_existing.method <> p_payload->>'method' then raise exception 'Deposit idempotency key was already used with a different payload'; end if;
    return jsonb_build_object('success', true, 'id', v_existing.id, 'duplicate', true, 'status', v_existing.status);
  end if;
  insert into public.restaurant_reservation_deposits (lodge_id, reservation_id, amount, method, reference, notes, received_by, idempotency_key)
  values (v_lodge_id, v_reservation, (p_payload->>'amount')::numeric, p_payload->>'method', nullif(p_payload->>'reference',''), nullif(p_payload->>'notes',''), v_actor, v_key)
  returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id, 'status', 'held');
end; $$;

create or replace function public.record_restaurant_feedback(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid := (p_payload->>'lodge_id')::uuid; v_actor uuid := auth.uid(); v_id uuid;
begin
  perform public.app_require_restaurant_lodge(v_lodge_id, array['admin','manager','supervisor','cashier']);
  if nullif(btrim(coalesce(p_payload->>'message','')), '') is null and (p_payload->>'rating') is null then raise exception 'Feedback needs a rating or a message'; end if;
  insert into public.restaurant_customer_feedback (lodge_id, customer_id, order_id, rating, channel, message, created_by)
  values (v_lodge_id, nullif(p_payload->>'customer_id','')::uuid, nullif(p_payload->>'order_id','')::uuid, nullif(p_payload->>'rating','')::integer, coalesce(nullif(p_payload->>'channel',''), 'in_store'), nullif(p_payload->>'message',''), v_actor) returning id into v_id;
  return jsonb_build_object('success', true, 'id', v_id);
end; $$;

revoke all on function public.record_restaurant_settlement(jsonb), public.get_restaurant_settlements(uuid, date), public.record_restaurant_reservation_deposit(jsonb), public.record_restaurant_feedback(jsonb) from public;
grant execute on function public.record_restaurant_settlement(jsonb), public.get_restaurant_settlements(uuid, date), public.record_restaurant_reservation_deposit(jsonb), public.record_restaurant_feedback(jsonb) to authenticated, service_role;
commit;

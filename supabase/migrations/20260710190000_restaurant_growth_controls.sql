begin;

-- Restaurant growth controls: stored value, staff tips, inventory lots, and
-- reservation policy. Each financial movement is an immutable, role-gated row.
create table if not exists public.restaurant_tip_payouts (
  id uuid primary key default gen_random_uuid(), lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  business_date date not null, staff_id uuid, staff_name text not null, amount numeric not null check (amount > 0),
  method text not null check (method in ('cash','bank','mobile_money')), reference text, notes text,
  paid_by uuid not null, idempotency_key text not null, created_at timestamptz not null default now(), unique(lodge_id,idempotency_key)
);
create table if not exists public.restaurant_inventory_lots (
  id uuid primary key default gen_random_uuid(), lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade, outlet_id uuid,
  lot_code text not null, received_quantity numeric not null check (received_quantity > 0), remaining_quantity numeric not null check (remaining_quantity >= 0),
  unit_cost numeric not null default 0, expires_on date, received_at timestamptz not null default now(), received_by uuid not null, notes text,
  unique(lodge_id, inventory_item_id, lot_code)
);
create table if not exists public.restaurant_reservation_policies (
  lodge_id uuid primary key references public.settings(lodge_id) on delete cascade,
  cancellation_cutoff_hours integer not null default 24 check (cancellation_cutoff_hours between 0 and 720),
  no_show_forfeit_percent numeric not null default 100 check (no_show_forfeit_percent between 0 and 100),
  reminder_hours_before integer not null default 24 check (reminder_hours_before between 1 and 168),
  updated_by uuid not null, updated_at timestamptz not null default now()
);
create table if not exists public.restaurant_reservation_reminders (
  id uuid primary key default gen_random_uuid(), lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  reservation_id uuid not null references public.restaurant_reservations(id) on delete cascade, scheduled_for timestamptz not null,
  channel text not null default 'whatsapp_assisted' check(channel = 'whatsapp_assisted'), status text not null default 'pending' check(status in ('pending','opened','skipped')),
  created_at timestamptz not null default now(), unique(reservation_id, scheduled_for)
);
alter table public.restaurant_tip_payouts enable row level security;
alter table public.restaurant_inventory_lots enable row level security;
alter table public.restaurant_reservation_policies enable row level security;
alter table public.restaurant_reservation_reminders enable row level security;
create policy restaurant_tip_payouts_scope on public.restaurant_tip_payouts for all using(public.app_lodge_access(lodge_id)) with check(public.app_lodge_access(lodge_id));
create policy restaurant_inventory_lots_scope on public.restaurant_inventory_lots for all using(public.app_lodge_access(lodge_id)) with check(public.app_lodge_access(lodge_id));
create policy restaurant_reservation_policies_scope on public.restaurant_reservation_policies for all using(public.app_lodge_access(lodge_id)) with check(public.app_lodge_access(lodge_id));
create policy restaurant_reservation_reminders_scope on public.restaurant_reservation_reminders for all using(public.app_lodge_access(lodge_id)) with check(public.app_lodge_access(lodge_id));

create or replace function public.create_restaurant_gift_card(p_payload jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge uuid := (p_payload->>'lodge_id')::uuid; v_actor uuid := auth.uid(); v_code text := upper(btrim(p_payload->>'code')); v_amount numeric := coalesce((p_payload->>'amount')::numeric,0); v_id uuid;
begin
 perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager','supervisor']);
 if v_code is null or length(v_code) < 4 or v_amount <= 0 then raise exception 'Gift card code and positive amount are required'; end if;
 insert into public.restaurant_vouchers(lodge_id,code,initial_value,remaining_value,customer_id,expires_at,status) values(v_lodge,v_code,v_amount,v_amount,nullif(p_payload->>'customer_id','')::uuid,nullif(p_payload->>'expires_at','')::timestamptz,'active') returning id into v_id;
 return jsonb_build_object('success',true,'id',v_id,'code',v_code,'remaining_value',v_amount);
end; $$;
create or replace function public.record_restaurant_tip_payout(p_payload jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge uuid := (p_payload->>'lodge_id')::uuid; v_actor uuid := auth.uid(); v_id uuid; v_key text := nullif(p_payload->>'idempotency_key','');
begin
 perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager']);
 if v_key is null or length(v_key)<8 then raise exception 'Stable payout idempotency key is required'; end if;
 if coalesce((p_payload->>'amount')::numeric,0)<=0 then raise exception 'Tip payout must be positive'; end if;
 insert into public.restaurant_tip_payouts(lodge_id,business_date,staff_id,staff_name,amount,method,reference,notes,paid_by,idempotency_key)
 values(v_lodge,coalesce((p_payload->>'business_date')::date,current_date),nullif(p_payload->>'staff_id','')::uuid,coalesce(nullif(p_payload->>'staff_name',''),'Unassigned'),(p_payload->>'amount')::numeric,p_payload->>'method',nullif(p_payload->>'reference',''),nullif(p_payload->>'notes',''),v_actor,v_key) returning id into v_id;
 return jsonb_build_object('success',true,'id',v_id);
exception when unique_violation then return jsonb_build_object('success',true,'duplicate',true);
end; $$;
create or replace function public.upsert_restaurant_reservation_policy(p_payload jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge uuid := (p_payload->>'lodge_id')::uuid; v_actor uuid := auth.uid();
begin
 perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager']);
 insert into public.restaurant_reservation_policies(lodge_id,cancellation_cutoff_hours,no_show_forfeit_percent,reminder_hours_before,updated_by)
 values(v_lodge,coalesce((p_payload->>'cancellation_cutoff_hours')::int,24),coalesce((p_payload->>'no_show_forfeit_percent')::numeric,100),coalesce((p_payload->>'reminder_hours_before')::int,24),v_actor)
 on conflict(lodge_id) do update set cancellation_cutoff_hours=excluded.cancellation_cutoff_hours,no_show_forfeit_percent=excluded.no_show_forfeit_percent,reminder_hours_before=excluded.reminder_hours_before,updated_by=v_actor,updated_at=now();
 return jsonb_build_object('success',true);
end; $$;
create or replace function public.record_restaurant_inventory_lot(p_payload jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge uuid := (p_payload->>'lodge_id')::uuid; v_actor uuid := auth.uid(); v_id uuid;
begin
 perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager','supervisor']);
 if coalesce((p_payload->>'received_quantity')::numeric,0)<=0 then raise exception 'Lot quantity must be positive'; end if;
 insert into public.restaurant_inventory_lots(lodge_id,inventory_item_id,outlet_id,lot_code,received_quantity,remaining_quantity,unit_cost,expires_on,received_by,notes)
 values(v_lodge,(p_payload->>'inventory_item_id')::uuid,nullif(p_payload->>'outlet_id','')::uuid,upper(btrim(p_payload->>'lot_code')),(p_payload->>'received_quantity')::numeric,(p_payload->>'received_quantity')::numeric,coalesce((p_payload->>'unit_cost')::numeric,0),nullif(p_payload->>'expires_on','')::date,v_actor,nullif(p_payload->>'notes','')) returning id into v_id;
 return jsonb_build_object('success',true,'id',v_id);
end; $$;
create or replace function public.get_restaurant_expiry_lots(p_lodge_id uuid,p_days integer default 14) returns setof public.restaurant_inventory_lots language plpgsql security definer set search_path to 'public' as $$
begin perform public.app_require_restaurant_lodge(p_lodge_id,array['admin','manager','supervisor','cashier']); return query select * from public.restaurant_inventory_lots where lodge_id=p_lodge_id and remaining_quantity>0 and expires_on is not null and expires_on<=current_date+greatest(1,least(p_days,365)) order by expires_on; end; $$;
revoke all on function public.create_restaurant_gift_card(jsonb),public.record_restaurant_tip_payout(jsonb),public.upsert_restaurant_reservation_policy(jsonb),public.record_restaurant_inventory_lot(jsonb),public.get_restaurant_expiry_lots(uuid,integer) from public;
grant execute on function public.create_restaurant_gift_card(jsonb),public.record_restaurant_tip_payout(jsonb),public.upsert_restaurant_reservation_policy(jsonb),public.record_restaurant_inventory_lot(jsonb),public.get_restaurant_expiry_lots(uuid,integer) to authenticated,service_role;
commit;

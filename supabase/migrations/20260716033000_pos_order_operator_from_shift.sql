-- A shared terminal is logged in as a manager, but the Till shift is opened
-- only after a staff PIN and attendance verification.  The shift owner is
-- therefore the authoritative cashier for every sale on that shift; the
-- manager session is an actor/approval context, not sales attribution.

create or replace function public.assign_pos_order_operator_from_shift()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_shift record;
begin
  if new.shift_id is null then
    return new;
  end if;

  select s.cashier_id, s.cashier_name
    into v_shift
    from public.pos_shifts s
   where s.id = new.shift_id
     and s.lodge_id = new.lodge_id
   for key share;

  if not found or v_shift.cashier_id is null then
    raise exception 'POS order requires a valid Till shift with an assigned operator';
  end if;

  new.cashier_id := v_shift.cashier_id;
  new.cashier_name := coalesce(v_shift.cashier_name, new.cashier_name);
  return new;
end;
$$;

drop trigger if exists trg_pos_orders_assign_operator_from_shift on public.pos_orders;
create trigger trg_pos_orders_assign_operator_from_shift
before insert or update of shift_id, cashier_id, cashier_name on public.pos_orders
for each row execute function public.assign_pos_order_operator_from_shift();

-- Repair only rows with a provable, linked Till-shift owner.  Rows without a
-- shift remain untouched rather than guessing historical responsibility.
insert into public.pos_audit_log (
  lodge_id, outlet_id, shift_id, order_id, actor_id, operator_id,
  action, entity_type, entity_id, amount_delta, before_snapshot,
  after_snapshot, details
)
select
  o.lodge_id, o.outlet_id, o.shift_id, o.id, null, s.cashier_id,
  'pos_order_operator_repaired', 'pos_order', o.id, 0,
  jsonb_build_object('cashier_id', o.cashier_id, 'cashier_name', o.cashier_name),
  jsonb_build_object('cashier_id', s.cashier_id, 'cashier_name', s.cashier_name),
  jsonb_build_object('reason', 'Shared Till sales must be attributed to the verified shift operator')
from public.pos_orders o
join public.pos_shifts s on s.id = o.shift_id and s.lodge_id = o.lodge_id
where s.cashier_id is not null
  and (o.cashier_id is distinct from s.cashier_id or o.cashier_name is distinct from s.cashier_name);

update public.pos_orders o
   set cashier_id = s.cashier_id,
       cashier_name = s.cashier_name,
       updated_at = now()
  from public.pos_shifts s
 where s.id = o.shift_id
   and s.lodge_id = o.lodge_id
   and s.cashier_id is not null
   and (o.cashier_id is distinct from s.cashier_id or o.cashier_name is distinct from s.cashier_name);

revoke all on function public.assign_pos_order_operator_from_shift() from public;

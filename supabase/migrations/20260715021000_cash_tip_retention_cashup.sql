-- Cash tips paid on an all-cash sale may leave the drawer with the waiter.
-- They remain part of the customer payment and receipt, but are not cash due
-- at handover and must not become payable a second time in the tip ledger.
begin;

alter table public.pos_orders
  add column if not exists cash_tip_retained numeric not null default 0
  check (cash_tip_retained >= 0 and cash_tip_retained <= tip_total);

alter table public.pos_cashup_submissions
  add column if not exists cash_tips_retained numeric not null default 0
  check (cash_tips_retained >= 0);

create or replace function public.set_pos_order_cash_tip_retained()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- Only an entirely cash-paid sale can release a cash tip immediately. Split,
  -- card, mobile-money and account tips remain payable through the tip ledger.
  new.cash_tip_retained := case
    when new.transaction_type = 'sale'
      and lower(coalesce(new.payment_method, '')) = 'cash'
      and coalesce(new.tip_total, 0) > 0
      then least(coalesce(new.tip_total, 0), greatest(coalesce(new.total, 0), 0))
    else 0
  end;
  return new;
end;
$$;

drop trigger if exists set_pos_order_cash_tip_retained on public.pos_orders;
create trigger set_pos_order_cash_tip_retained
before insert or update of payment_method, tip_total, total, transaction_type on public.pos_orders
for each row execute function public.set_pos_order_cash_tip_retained();

create or replace function public.set_pos_cashup_submission_cash_tip_retained()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_opening_float numeric := 0; v_cash_tips_retained numeric := 0;
begin
  select coalesce(opening_float, 0) into v_opening_float
  from public.pos_shifts where id = new.shift_id and lodge_id = new.lodge_id;
  select coalesce(sum(cash_tip_retained), 0) into v_cash_tips_retained
  from public.pos_orders where shift_id = new.shift_id and lodge_id = new.lodge_id
    and status in ('completed', 'settled');
  new.cash_tips_retained := v_cash_tips_retained;
  new.expected_cash_drawer := round(v_opening_float + coalesce((new.expected_by_method->>'cash')::numeric, 0) - v_cash_tips_retained, 2);
  return new;
end;
$$;

drop trigger if exists set_pos_cashup_submission_cash_tip_retained on public.pos_cashup_submissions;
create trigger set_pos_cashup_submission_cash_tip_retained
before insert or update of expected_by_method, shift_id on public.pos_cashup_submissions
for each row execute function public.set_pos_cashup_submission_cash_tip_retained();

-- Bring already-open shifts into the same rule so a waiter is never shown a
-- false shortage after this migration is deployed.
update public.pos_orders o
set cash_tip_retained = least(coalesce(o.tip_total, 0), greatest(coalesce(o.total, 0), 0))
from public.pos_shifts s
where s.id = o.shift_id
  and s.status = 'open'
  and o.transaction_type = 'sale'
  and lower(coalesce(o.payment_method, '')) = 'cash'
  and coalesce(o.tip_total, 0) > 0;

create or replace function public.get_pos_shift_cashup_preview_v2(p_shift_id uuid, p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_shift record; v_expected_by_method jsonb := '{}'::jsonb; v_gross_sales numeric := 0;
  v_discounts numeric := 0; v_tax numeric := 0; v_tips numeric := 0; v_cash_tips_retained numeric := 0;
  v_returns numeric := 0; v_net_sales numeric := 0; v_order_count integer := 0;
  v_return_count integer := 0; v_void_count integer := 0; v_expected_cash numeric := 0;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  select s.* into v_shift from public.pos_shifts s where s.id = p_shift_id and s.lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Shift not found'); end if;

  select
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.gross_total else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.discount_total else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.tax_total else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.tip_total else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'sale' and o.status <> 'voided' then o.cash_tip_retained else 0 end), 0),
    coalesce(sum(case when o.transaction_type = 'return' and o.status <> 'voided' then abs(o.total) else 0 end), 0),
    coalesce(sum(case when o.status <> 'voided' then o.total else 0 end), 0),
    count(*) filter (where o.transaction_type = 'sale' and o.status <> 'voided'),
    count(*) filter (where o.transaction_type = 'return' and o.status <> 'voided'),
    count(*) filter (where o.status = 'voided')
  into v_gross_sales, v_discounts, v_tax, v_tips, v_cash_tips_retained, v_returns, v_net_sales, v_order_count, v_return_count, v_void_count
  from public.pos_orders o
  where o.shift_id = p_shift_id and o.lodge_id = p_lodge_id and o.status in ('completed', 'settled', 'voided');

  select coalesce(jsonb_object_agg(t.method, t.amount), '{}'::jsonb) into v_expected_by_method
  from (
    select method, round(sum(amount), 2) as amount from (
      select lower(coalesce(p.value->>'method', o.payment_method, 'cash')) as method,
        coalesce((p.value->>'amount')::numeric, o.total, 0) as amount
      from public.pos_orders o
      cross join lateral jsonb_array_elements(case when jsonb_typeof(o.payment_breakdown) = 'array' and jsonb_array_length(o.payment_breakdown) > 0 then o.payment_breakdown else jsonb_build_array(jsonb_build_object('method', coalesce(o.payment_method, 'cash'), 'amount', o.total)) end) p(value)
      where o.shift_id = p_shift_id and o.lodge_id = p_lodge_id and o.status in ('completed', 'settled')
    ) x group by method
  ) t;

  v_expected_cash := round(coalesce(v_shift.opening_float, 0) + coalesce((v_expected_by_method->>'cash')::numeric, 0) - v_cash_tips_retained, 2);
  return jsonb_build_object('success', true, 'shift_id', p_shift_id, 'status', v_shift.status,
    'business_date', public.get_lodge_business_date(p_lodge_id), 'opening_float', coalesce(v_shift.opening_float, 0),
    'gross_sales', round(v_gross_sales, 2), 'discounts', round(v_discounts, 2), 'vat', round(v_tax, 2),
    'tips', round(v_tips, 2), 'cash_tips_retained', round(v_cash_tips_retained, 2), 'returns', round(v_returns, 2),
    'net_sales', round(v_net_sales, 2), 'expected_by_method', v_expected_by_method, 'expected_cash_drawer', v_expected_cash,
    'order_count', v_order_count, 'return_count', v_return_count, 'void_count', v_void_count);
end;
$$;

create or replace function public.get_restaurant_tip_balances(p_lodge_id uuid, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['admin','manager']);
  return coalesce((with earned as (
    select cashier_id staff_id, sum(tip_total) earned, sum(cash_tip_retained) cash_retained,
      sum(tip_total) filter (where created_at >= current_date and created_at < current_date + interval '1 day') earned_today
    from public.pos_orders where lodge_id=p_lodge_id and cashier_id is not null
      and created_at >= current_date-greatest(1,least(coalesce(p_days,30),365))
      and coalesce(status,'') not in ('voided','cancelled') and coalesce(tip_total,0)>0 group by cashier_id
  ), paid as (
    select staff_id,sum(amount) paid from public.restaurant_tip_payouts where lodge_id=p_lodge_id
      and business_date >= current_date-greatest(1,least(coalesce(p_days,30),365)) group by staff_id
  ) select jsonb_agg(jsonb_build_object('staff_id',u.id,'staff_name',u.name,'earned',coalesce(e.earned,0),
    'earned_today',coalesce(e.earned_today,0),'cash_retained',coalesce(e.cash_retained,0),'paid',coalesce(p.paid,0),
    'available',greatest(coalesce(e.earned,0)-coalesce(e.cash_retained,0)-coalesce(p.paid,0),0)) order by u.name)
  from public.users u left join earned e on e.staff_id=u.id left join paid p on p.staff_id=u.id
  where u.lodge_id=p_lodge_id and u.status='active' and (coalesce(e.earned,0)>0 or coalesce(p.paid,0)>0)), '[]'::jsonb);
end;
$$;

-- Existing submitted handovers are recalculated from the authoritative open shift.
update public.pos_cashup_submissions s
set cash_tips_retained = coalesce((select sum(o.cash_tip_retained) from public.pos_orders o where o.shift_id=s.shift_id and o.lodge_id=s.lodge_id and o.status in ('completed','settled')), 0),
    expected_cash_drawer = coalesce((select sh.opening_float from public.pos_shifts sh where sh.id=s.shift_id), 0)
      + coalesce((s.expected_by_method->>'cash')::numeric, 0)
      - coalesce((select sum(o.cash_tip_retained) from public.pos_orders o where o.shift_id=s.shift_id and o.lodge_id=s.lodge_id and o.status in ('completed','settled')), 0)
where s.status='submitted' and exists (select 1 from public.pos_shifts sh where sh.id=s.shift_id and sh.status='open');

create or replace function public.get_my_pos_cashup_submission(p_lodge_id uuid, p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_actor uuid := public.app_current_user_id(); v_shift public.pos_shifts%rowtype; v_row public.pos_cashup_submissions%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  select * into v_shift from public.pos_shifts where id = p_shift_id and lodge_id = p_lodge_id;
  if not found then return jsonb_build_object('success', false, 'error', 'Shift not found'); end if;
  if v_shift.cashier_id is distinct from v_actor then return jsonb_build_object('success', false, 'error', 'You can only view your own cash-up submission.'); end if;
  select * into v_row from public.pos_cashup_submissions where lodge_id = p_lodge_id and shift_id = p_shift_id;
  if not found then return jsonb_build_object('success', true, 'submission', null); end if;
  return jsonb_build_object('success', true, 'submission', jsonb_build_object('id',v_row.id,'status',v_row.status,'counted_by_method',v_row.counted_by_method,'expected_cash_drawer',v_row.expected_cash_drawer,'cash_tips_retained',v_row.cash_tips_retained,'submitted_at',v_row.submitted_at,'notes',v_row.notes,'review_notes',v_row.review_notes));
end;
$$;

create or replace function public.get_pending_pos_cashup_submissions(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['supervisor','manager','admin','super_admin']);
  return jsonb_build_object('success', true, 'submissions', coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'shift_id', s.shift_id, 'outlet_id', s.outlet_id, 'outlet_name', o.name, 'cashier_id', s.cashier_id,
    'cashier_name', coalesce(u.name, sh.cashier_name), 'expected_cash_drawer', s.expected_cash_drawer,
    'cash_tips_retained', s.cash_tips_retained, 'counted_by_method', s.counted_by_method,
    'expected_by_method', s.expected_by_method, 'notes', s.notes, 'submitted_at', s.submitted_at
  ) order by s.submitted_at asc) from public.pos_cashup_submissions s left join public.outlets o on o.id=s.outlet_id left join public.users u on u.id=s.cashier_id left join public.pos_shifts sh on sh.id=s.shift_id where s.lodge_id=p_lodge_id and s.status='submitted'), '[]'::jsonb));
end;
$$;

commit;

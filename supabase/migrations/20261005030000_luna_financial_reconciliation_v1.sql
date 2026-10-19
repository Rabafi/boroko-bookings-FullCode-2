-- Complete financial reconciliation from one MVCC snapshot.
-- Forward-only; no row mutation or inferred repair is performed.

begin;

create index if not exists payments_lodge_booking_reconciliation_idx
  on public.payments (lodge_id, booking_id);
create index if not exists booking_charges_lodge_booking_reconciliation_idx
  on public.booking_charges (lodge_id, booking_id) include (amount, voided_at);
create index if not exists invoices_lodge_booking_reconciliation_idx
  on public.invoices (lodge_id, booking_id) include (invoice_number);
create index if not exists pos_orders_lodge_folio_reconciliation_idx
  on public.pos_orders (lodge_id, payment_method, status) include (total, folio_charge_id, transaction_type);
create index if not exists pos_return_lines_lodge_return_reconciliation_idx
  on public.pos_return_lines (lodge_id, return_order_id, original_order_item_id);
create index if not exists customer_credit_lodge_booking_reconciliation_idx
  on public.customer_credit_ledger (lodge_id, booking_id, entry_type);

create or replace function public.get_financial_reconciliation_v1(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['finance','manager','admin','super_admin']
  );

  with
  bookings_scope as materialized (
    select b.id, b.lodge_id, b.invoice_number, b.total_amount, b.amount_paid,
           b.charges_total, b.status, b.check_in, b.check_out, b.updated_at
      from public.bookings b
     where b.lodge_id = p_lodge_id
  ),
  payment_totals as (
    select p.booking_id, round(sum(p.amount), 2) as net_paid
      from public.payments p
     where p.lodge_id = p_lodge_id
     group by p.booking_id
  ),
  charge_totals as (
    select c.booking_id,
           round(sum(c.amount) filter (where c.voided_at is null), 2) as active_charges
      from public.booking_charges c
     where c.lodge_id = p_lodge_id
     group by c.booking_id
  ),
  invoice_totals as (
    select i.booking_id, count(*)::bigint as invoice_rows,
           count(*) filter (where nullif(btrim(i.invoice_number), '') is not null)::bigint as numbered_rows,
           count(distinct i.invoice_number) filter (where nullif(btrim(i.invoice_number), '') is not null)::bigint as distinct_numbers
      from public.invoices i
     where i.lodge_id = p_lodge_id
     group by i.booking_id
  ),
  payment_mismatch_rows as (
    select b.id as booking_id, b.invoice_number, b.status,
           round(coalesce(b.amount_paid, 0), 2) as booking_amount_paid,
           round(coalesce(p.net_paid, 0), 2) as payment_ledger_total,
           round(coalesce(b.amount_paid, 0) - coalesce(p.net_paid, 0), 2) as difference,
           b.updated_at
      from bookings_scope b
      left join payment_totals p on p.booking_id = b.id
     where abs(round(coalesce(b.amount_paid, 0) - coalesce(p.net_paid, 0), 2)) > 0.01
  ),
  charge_mismatch_rows as (
    select b.id as booking_id, b.invoice_number, b.status,
           round(coalesce(b.charges_total, 0), 2) as booking_charges_total,
           round(coalesce(c.active_charges, 0), 2) as charge_ledger_total,
           round(coalesce(b.charges_total, 0) - coalesce(c.active_charges, 0), 2) as difference,
           b.updated_at
      from bookings_scope b
      left join charge_totals c on c.booking_id = b.id
     where abs(round(coalesce(b.charges_total, 0) - coalesce(c.active_charges, 0), 2)) > 0.01
  ),
  invoice_gap_rows as (
    select b.id as booking_id, b.invoice_number, b.status, b.check_in, b.check_out,
           coalesce(i.invoice_rows, 0) as invoice_rows,
           case
             when nullif(btrim(coalesce(b.invoice_number, '')), '') is null then 'missing_booking_invoice_number'
             when coalesce(i.invoice_rows, 0) = 0 then 'missing_invoice_row'
             when not exists (
               select 1 from public.invoices x
                where x.lodge_id = p_lodge_id and x.booking_id = b.id
                  and x.invoice_number = b.invoice_number
             ) then 'invoice_number_mismatch'
             else null
           end as issue
      from bookings_scope b
      left join invoice_totals i on i.booking_id = b.id
     where lower(coalesce(b.status, '')) <> 'cancelled'
       and (
         nullif(btrim(coalesce(b.invoice_number, '')), '') is null
         or coalesce(i.invoice_rows, 0) = 0
         or not exists (
           select 1 from public.invoices x
            where x.lodge_id = p_lodge_id and x.booking_id = b.id
              and x.invoice_number = b.invoice_number
         )
       )
  ),
  duplicate_invoice_rows as (
    select i.id as invoice_id, i.booking_id, i.invoice_number, i.issued_at,
           'duplicate_invoice_for_booking'::text as issue
      from public.invoices i
     where i.lodge_id = p_lodge_id
       and i.booking_id is not null
       and exists (
         select 1 from public.invoices other
          where other.lodge_id = i.lodge_id and other.booking_id = i.booking_id
            and other.id <> i.id
       )
    union all
    select i.id as invoice_id, i.booking_id, i.invoice_number, i.issued_at,
           'duplicate_invoice_number'::text as issue
      from public.invoices i
     where i.lodge_id = p_lodge_id
       and nullif(btrim(coalesce(i.invoice_number, '')), '') is not null
       and exists (
         select 1 from public.invoices other
          where other.lodge_id = i.lodge_id and other.invoice_number = i.invoice_number
            and other.id <> i.id
       )
  ),
  orphan_invoice_rows as (
    select i.id as invoice_id, i.booking_id, i.invoice_number, i.issued_at,
           'invoice_has_no_lodge_booking'::text as issue
      from public.invoices i
     where i.lodge_id = p_lodge_id
       and not exists (
         select 1 from bookings_scope b where b.id = i.booking_id
       )
  ),
  active_pos_orders as materialized (
    select o.id, o.lodge_id, o.booking_id, o.event_booking_id, o.status, o.total, o.payment_method,
           o.folio_charge_id, o.created_at, o.transaction_type, o.original_order_id,
           o.tip_total
      from public.pos_orders o
     where o.lodge_id = p_lodge_id
  ),
  folio_pos_mismatch_rows as (
    select o.id as order_id, o.booking_id, o.event_booking_id,
           round(o.total,2) as order_total, o.folio_charge_id,
           round(coalesce(case when o.event_booking_id is not null then event_charge.subtotal else booking_charge.amount end,0),2) as folio_charge_total,
           o.created_at,
           case
             when o.event_booking_id is not null and o.booking_id is not null then 'multiple_folio_scope'
             when o.event_booking_id is not null and not exists (
               select 1 from public.conference_bookings event
                where event.id=o.event_booking_id and event.lodge_id=p_lodge_id
             ) then 'orphan_event_booking'
             when o.event_booking_id is not null and o.folio_charge_id is null then 'missing_folio_charge'
             when o.event_booking_id is not null and event_charge.id is null then 'missing_event_charge'
             when o.event_booking_id is not null and event_charge.voided_at is not null then 'linked_charge_voided'
             when o.event_booking_id is null and o.booking_id is null then 'missing_booking'
             when o.event_booking_id is null and not exists (select 1 from bookings_scope b where b.id=o.booking_id) then 'orphan_booking'
             when o.event_booking_id is null and o.folio_charge_id is null then 'missing_folio_charge'
             when o.event_booking_id is null and booking_charge.id is null then 'missing_charge_row'
             when o.event_booking_id is null and booking_charge.voided_at is not null then 'linked_charge_voided'
             when abs(round(o.total - case when o.event_booking_id is not null then event_charge.subtotal else booking_charge.amount end,2)) > 0.01 then 'amount_mismatch'
             else null
           end as issue
      from active_pos_orders o
      left join public.booking_charges booking_charge
        on booking_charge.id=o.folio_charge_id and booking_charge.lodge_id=p_lodge_id
      left join public.event_booking_line_items event_charge
        on event_charge.id=o.folio_charge_id and event_charge.lodge_id=p_lodge_id
       and event_charge.event_booking_id=o.event_booking_id
     where lower(coalesce(o.payment_method,''))='folio'
       and lower(coalesce(o.status,'')) in ('completed','settled')
       and lower(coalesce(o.transaction_type,'sale'))<>'void'
       and lower(coalesce(o.status,'')) not in ('voided','cancelled','void')
       and (
         (o.event_booking_id is not null and (
           o.booking_id is not null
           or not exists (select 1 from public.conference_bookings event where event.id=o.event_booking_id and event.lodge_id=p_lodge_id)
           or o.folio_charge_id is null or event_charge.id is null or event_charge.voided_at is not null
           or (event_charge.id is not null and abs(round(o.total-event_charge.subtotal,2))>0.01)
         ))
         or (o.event_booking_id is null and (
           o.booking_id is null
           or not exists (select 1 from bookings_scope b where b.id=o.booking_id)
           or o.folio_charge_id is null or booking_charge.id is null or booking_charge.voided_at is not null
           or (booking_charge.id is not null and abs(round(o.total-booking_charge.amount,2))>0.01)
         ))
       )
  ),
  pos_void_mismatch_rows as (
    select o.id as order_id, o.booking_id, o.event_booking_id, o.folio_charge_id, o.status,
           o.transaction_type, round(o.total,2) as order_total,
           round(coalesce(case when o.event_booking_id is not null then event_charge.subtotal else booking_charge.amount end,0),2) as charge_total,
           case
             when lower(coalesce(o.status,'')) in ('voided','cancelled','void') then 'void_order_has_active_charge'
             else 'active_order_has_void_charge'
           end as issue
      from active_pos_orders o
      left join public.booking_charges booking_charge
        on booking_charge.id=o.folio_charge_id and booking_charge.lodge_id=p_lodge_id
      left join public.event_booking_line_items event_charge
        on event_charge.id=o.folio_charge_id and event_charge.lodge_id=p_lodge_id
       and event_charge.event_booking_id=o.event_booking_id
     where o.folio_charge_id is not null
       and (
         (lower(coalesce(o.status,'')) in ('voided','cancelled','void') and (
           (o.event_booking_id is not null and event_charge.id is not null and event_charge.voided_at is null)
           or (o.event_booking_id is null and booking_charge.id is not null and booking_charge.voided_at is null)
         ))
         or (lower(coalesce(o.status,'')) not in ('voided','cancelled','void') and (
           (o.event_booking_id is not null and event_charge.id is not null and event_charge.voided_at is not null)
           or (o.event_booking_id is null and booking_charge.id is not null and booking_charge.voided_at is not null)
         ))
       )
  ),
  active_return_quantities as (
    select r.original_order_item_id, sum(r.quantity) as returned_quantity
      from public.pos_return_lines r
      join active_pos_orders ret on ret.id = r.return_order_id
     where lower(coalesce(ret.transaction_type,'')) = 'return'
       and lower(coalesce(ret.status,'')) not in ('voided','cancelled','void')
     group by r.original_order_item_id
  ),
  pos_return_mismatch_rows as (
    select ret.id as return_order_id, ret.original_order_id, ret.booking_id,
           round(ret.total,2) as return_total,
           round(coalesce(lines.expected_total,0),2) as return_lines_total,
           ret.status,
           case
             when original.id is null then 'return_missing_original_sale'
             when lower(coalesce(original.transaction_type,'sale')) <> 'sale' then 'return_original_not_sale'
             when lower(coalesce(ret.status,'')) not in ('completed','settled') then 'return_not_completed'
             when coalesce(lines.line_count,0) = 0 then 'return_has_no_lines'
             when ret.total >= 0 then 'return_total_not_negative'
             when abs(round(ret.total - coalesce(lines.expected_total,0),2)) > 0.01 then 'return_amount_differs_from_lines'
             else 'return_lineage_invalid'
           end as issue
      from active_pos_orders ret
      left join active_pos_orders original
        on original.id = ret.original_order_id and original.lodge_id = p_lodge_id
      left join lateral (
        select count(*)::bigint as line_count,
               coalesce(sum(coalesce(i.net_subtotal,i.subtotal) + coalesce(i.tax_allocated,0)),0)
                 + coalesce(ret.tip_total,0) as expected_total,
               bool_and(i.id is not null and i.order_id = ret.id) as all_lines_present
          from public.pos_order_items i
         where i.lodge_id = p_lodge_id and i.order_id = ret.id
      ) lines on true
     where lower(coalesce(ret.transaction_type,'')) = 'return'
       and lower(coalesce(ret.status,'')) not in ('voided','cancelled','void')
       and (
         original.id is null
         or lower(coalesce(original.transaction_type,'sale')) <> 'sale'
         or lower(coalesce(ret.status,'')) not in ('completed','settled')
         or coalesce(lines.line_count,0) = 0
         or ret.total >= 0
         or abs(round(ret.total - coalesce(lines.expected_total,0),2)) > 0.01
       )
    union all
    select distinct ret.id as return_order_id, ret.original_order_id, ret.booking_id,
           round(ret.total,2) as return_total, null::numeric as return_lines_total,
           ret.status, 'return_line_points_to_different_sale'::text as issue
      from public.pos_return_lines r
      join active_pos_orders ret on ret.id = r.return_order_id
      left join public.pos_order_items original_line
        on original_line.id = r.original_order_item_id
       and original_line.order_id = ret.original_order_id
       and original_line.lodge_id = p_lodge_id
     where lower(coalesce(ret.transaction_type,'')) = 'return'
       and lower(coalesce(ret.status,'')) not in ('voided','cancelled','void')
       and original_line.id is null
    union all
    select distinct original.id as return_order_id, original.id as original_order_id, original.booking_id,
           null::numeric as return_total, null::numeric as return_lines_total,
           original.status, 'original_item_over_returned'::text as issue
      from active_return_quantities q
      join public.pos_order_items i on i.id = q.original_order_item_id and i.lodge_id = p_lodge_id
      join active_pos_orders original on original.id = i.order_id
     where q.returned_quantity > i.quantity
  ),
  credit_link_mismatch_rows as (
    select l.id as entry_id, l.booking_id, l.payment_id, l.customer_id,
           l.entry_type, l.amount, 'credit_ledger_link_mismatch'::text as issue
      from public.customer_credit_ledger l
      left join public.customers c
        on c.id = l.customer_id and c.lodge_id = l.lodge_id
      left join bookings_scope b
        on b.id = l.booking_id and b.lodge_id = l.lodge_id and b.id is not null
      left join public.payments p
        on p.id = l.payment_id and p.lodge_id = l.lodge_id
     where l.lodge_id = p_lodge_id
       and (
         c.id is null
         or (l.booking_id is not null and (b.id is null or b.id is distinct from l.booking_id))
         or (l.entry_type = 'booking_allocation' and (
              p.id is null or p.booking_id is distinct from l.booking_id
              or p.method <> 'customer_credit' or round(p.amount,2) <> round(l.amount,2)
            ))
         or (l.reverses_entry_id is not null and not exists (
              select 1 from public.customer_credit_ledger original
               where original.id = l.reverses_entry_id
                 and original.lodge_id = l.lodge_id
                 and original.customer_id = l.customer_id
                 and original.amount = l.amount
            ))
       )
  ),
  credit_allocation_totals as (
    select b.id as booking_id,
           coalesce(p.net_customer_credit,0) as payment_total,
           coalesce(l.net_allocation,0) as allocation_total
      from bookings_scope b
      left join (
        select p.booking_id, round(sum(p.amount),2) as net_customer_credit
          from public.payments p
         where p.lodge_id = p_lodge_id and p.method = 'customer_credit'
         group by p.booking_id
      ) p on p.booking_id = b.id
      left join (
        select ledger.booking_id,
               round(sum(case
                 when ledger.entry_type = 'booking_allocation' then ledger.amount
                 when ledger.entry_type = 'reversal_in' and original.entry_type = 'booking_allocation' then -ledger.amount
                 else 0 end),2) as net_allocation
          from public.customer_credit_ledger ledger
          left join public.customer_credit_ledger original
            on original.id = ledger.reverses_entry_id and original.lodge_id = ledger.lodge_id
         where ledger.lodge_id = p_lodge_id
           and ledger.booking_id is not null
         group by ledger.booking_id
      ) l on l.booking_id = b.id
  ),
  credit_allocation_mismatch_rows as (
    select c.booking_id, c.payment_total, c.allocation_total,
           round(c.payment_total - c.allocation_total,2) as difference,
           'customer_credit_booking_allocation_mismatch'::text as issue
      from credit_allocation_totals c
     where abs(round(c.payment_total - c.allocation_total,2)) > 0.01
  ),
  credit_mismatch_rows as (
    select to_jsonb(x) as sample from credit_link_mismatch_rows x
    union all
    select to_jsonb(x) as sample from credit_allocation_mismatch_rows x
  ),
  mismatch_counts as (
    select
      (select count(*) from payment_mismatch_rows)::bigint as payment_mismatches,
      (select count(*) from charge_mismatch_rows)::bigint as charge_mismatches,
      (select count(*) from invoice_gap_rows)::bigint as invoice_gaps,
      (select count(*) from duplicate_invoice_rows)::bigint as duplicate_invoices,
      (select count(*) from orphan_invoice_rows)::bigint as orphan_invoices,
      (select count(*) from folio_pos_mismatch_rows)::bigint as folio_pos_mismatches,
      (select count(*) from pos_return_mismatch_rows)::bigint as pos_return_mismatches,
      (select count(*) from credit_mismatch_rows)::bigint as credit_mismatches,
      (select count(*) from pos_void_mismatch_rows)::bigint as pos_void_mismatches
  ),
  examined_counts as (
    select
      (select count(*) from bookings_scope)::bigint as bookings,
      (select count(*) from public.payments where lodge_id = p_lodge_id)::bigint as payments,
      (select count(*) from public.booking_charges where lodge_id = p_lodge_id)::bigint as charges,
      (select count(*) from public.invoices where lodge_id = p_lodge_id)::bigint as invoices,
      (select count(*) from active_pos_orders)::bigint as pos_orders,
      (select count(*) from active_pos_orders where lower(coalesce(transaction_type,''))='return')::bigint as pos_returns,
      (select count(*) from public.customer_credit_ledger where lodge_id = p_lodge_id)::bigint as customer_credit_entries
  ),
  financial_totals as (
    select
      coalesce((select sum(total_amount) from bookings_scope),0)::numeric(30,2) as booking_total_amount,
      coalesce((select sum(amount_paid) from bookings_scope),0)::numeric(30,2) as booking_amount_paid,
      coalesce((select sum(net_paid) from payment_totals),0)::numeric(30,2) as payment_ledger_net,
      coalesce((select sum(charges_total) from bookings_scope),0)::numeric(30,2) as booking_charges_total,
      coalesce((select sum(amount) from public.booking_charges where lodge_id=p_lodge_id and voided_at is null),0)::numeric(30,2) as active_booking_charge_net,
      coalesce((select sum(total) from active_pos_orders where lower(coalesce(status,'')) in ('completed','settled') and lower(coalesce(status,'')) not in ('voided','cancelled','void')),0)::numeric(30,2) as pos_net_total,
      coalesce((select sum(case
        when entry_type in ('receipt','adjustment_in','reversal_in') then amount
        when entry_type in ('booking_allocation','refund','adjustment_out','reversal_out') then -amount
        else 0 end)
        from public.customer_credit_ledger where lodge_id=p_lodge_id),0)::numeric(30,2) as customer_credit_net
  ),
  samples as (
    select
      coalesce((select jsonb_agg(to_jsonb(s)) from (select * from payment_mismatch_rows order by abs(difference) desc, booking_id limit 50) s),'[]'::jsonb) as payment_mismatches,
      coalesce((select jsonb_agg(to_jsonb(s)) from (select * from charge_mismatch_rows order by abs(difference) desc, booking_id limit 50) s),'[]'::jsonb) as charge_mismatches,
      coalesce((select jsonb_agg(to_jsonb(s)) from (select * from invoice_gap_rows order by booking_id limit 50) s),'[]'::jsonb) as invoice_gaps,
      coalesce((select jsonb_agg(to_jsonb(s)) from (select * from duplicate_invoice_rows order by invoice_id, issue limit 50) s),'[]'::jsonb) as duplicate_invoices,
      coalesce((select jsonb_agg(to_jsonb(s)) from (select * from orphan_invoice_rows order by invoice_id limit 50) s),'[]'::jsonb) as orphan_invoices,
      coalesce((select jsonb_agg(to_jsonb(s)) from (select * from folio_pos_mismatch_rows order by order_id limit 50) s),'[]'::jsonb) as folio_pos_mismatches,
      coalesce((select jsonb_agg(to_jsonb(s)) from (select * from pos_return_mismatch_rows order by return_order_id limit 50) s),'[]'::jsonb) as pos_return_mismatches,
      coalesce((select jsonb_agg(sample) from (select sample from credit_mismatch_rows order by sample->>'issue' limit 50) s),'[]'::jsonb) as credit_mismatches,
      coalesce((select jsonb_agg(to_jsonb(s)) from (select * from pos_void_mismatch_rows order by order_id limit 50) s),'[]'::jsonb) as pos_void_mismatches
  )
  select jsonb_build_object(
    'success', true,
    'schema_version', 1,
    'calculation_version', 'financial-reconciliation-v1',
    'complete', true,
    'lodge_id', p_lodge_id,
    'generated_at', transaction_timestamp(),
    'examined_counts', to_jsonb(ec),
    'mismatch_counts', to_jsonb(mc),
    'totals', jsonb_build_object(
      'booking_total_amount', ft.booking_total_amount::text,
      'booking_amount_paid', ft.booking_amount_paid::text,
      'payment_ledger_net', ft.payment_ledger_net::text,
      'booking_charges_total', ft.booking_charges_total::text,
      'active_booking_charge_net', ft.active_booking_charge_net::text,
      'pos_net_total', ft.pos_net_total::text,
      'customer_credit_net', ft.customer_credit_net::text
    ),
    'samples', to_jsonb(s),
    'sample_limit', 50,
    'samples_truncated', (
      mc.payment_mismatches > 50 or mc.charge_mismatches > 50 or mc.invoice_gaps > 50
      or mc.duplicate_invoices > 50 or mc.orphan_invoices > 50 or mc.folio_pos_mismatches > 50
      or mc.pos_return_mismatches > 50 or mc.credit_mismatches > 50 or mc.pos_void_mismatches > 50
    )
  )
    into v_result
    from examined_counts ec
    cross join mismatch_counts mc
    cross join financial_totals ft
    cross join samples s;

  return v_result;
end;
$$;

revoke all on function public.get_financial_reconciliation_v1(uuid) from public, anon;
grant execute on function public.get_financial_reconciliation_v1(uuid) to anon, authenticated, service_role;

commit;
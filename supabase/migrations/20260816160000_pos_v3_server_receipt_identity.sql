-- A completed POS receipt must use the number assigned by the database row.
-- create_pos_order_v3 already writes through the daily-number trigger, but its
-- response previously omitted that immutable identity. Do not generate a
-- client-side fallback: return the authoritative row values and repair only
-- stored idempotent responses that can be proven to belong to that same row.

begin;

do $do$
declare
  v_definition text;
  v_old text := $old$    'id', v_order_id,
    'total', v_total,$old$;
  v_new text := $new$    'id', v_order_id,
    'receipt_number', (
      select o.receipt_number
        from public.pos_orders o
       where o.id = v_order_id
         and o.lodge_id = v_lodge_id
    ),
    'order_number', (
      select o.order_number
        from public.pos_orders o
       where o.id = v_order_id
         and o.lodge_id = v_lodge_id
    ),
    'daily_order_number', (
      select o.daily_order_number
        from public.pos_orders o
       where o.id = v_order_id
         and o.lodge_id = v_lodge_id
    ),
    'business_date', (
      select o.business_date
        from public.pos_orders o
       where o.id = v_order_id
         and o.lodge_id = v_lodge_id
    ),
    'total', v_total,$new$;
  v_occurrences integer;
begin
  select pg_get_functiondef('public.create_pos_order_v3(jsonb)'::regprocedure)
    into v_definition;

  if v_definition is null then
    raise exception 'create_pos_order_v3(jsonb) is not installed';
  end if;

  v_occurrences := (length(v_definition) - length(replace(v_definition, v_old, ''))) / length(v_old);
  if v_occurrences <> 1 then
    raise exception 'create_pos_order_v3 receipt response contract is ambiguous or missing';
  end if;

  execute replace(v_definition, v_old, v_new);
end
$do$;

-- Retried offline/timeout operations return the immutable response stored when
-- the sale committed. Enrich only create_pos_order_v3 records that are bound
-- to a real, same-lodge order with an already-issued server number. This
-- never updates an order, its payment, stock, or assigned receipt number.
update public.financial_operation_idempotency fi
   set operation_result = fi.operation_result || jsonb_build_object(
     'receipt_number', o.receipt_number,
     'order_number', o.order_number,
     'daily_order_number', o.daily_order_number,
     'business_date', o.business_date
   )
  from public.pos_orders o
 where fi.operation_type = 'create_pos_order_v3'
   and fi.entity_id = o.id
   and fi.lodge_id = o.lodge_id
   and o.receipt_number is not null
   and (
     nullif(btrim(coalesce(fi.operation_result->>'receipt_number', '')), '') is null
     or fi.operation_result->>'receipt_number' is distinct from o.receipt_number
   );

commit;

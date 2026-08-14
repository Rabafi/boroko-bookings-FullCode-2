-- Rename the PL/pgSQL operation variable so ON CONFLICT column names cannot
-- be confused with it by the linked lint parser.

begin;

do $do$
declare
  v_definition text;
  v_occurrences integer;
begin
  select pg_get_functiondef('public._restaurant_post_pos_order_to_gl_v2(uuid,uuid)'::regprocedure)
    into v_definition;

  v_occurrences := (length(v_definition) - length(replace(v_definition, 'operation_id uuid;', ''))) / length('operation_id uuid;');
  if v_occurrences <> 1 then raise exception 'operation_id declaration contract is ambiguous or missing'; end if;
  v_definition := replace(v_definition, 'operation_id uuid;', 'v_operation_id uuid;');

  v_occurrences := (length(v_definition) - length(replace(v_definition, 'operation_id:=p_order_id;', ''))) / length('operation_id:=p_order_id;');
  if v_occurrences <> 1 then raise exception 'operation_id assignment contract is ambiguous or missing'; end if;
  v_definition := replace(v_definition, 'operation_id:=p_order_id;', 'v_operation_id:=p_order_id;');

  v_occurrences := (length(v_definition) - length(replace(v_definition, ',1,operation_id,payload_hash,', ''))) / length(',1,operation_id,payload_hash,');
  if v_occurrences <> 1 then raise exception 'account ledger operation_id contract is ambiguous or missing'; end if;
  v_definition := replace(v_definition, ',1,operation_id,payload_hash,', ',1,v_operation_id,payload_hash,');

  v_occurrences := (length(v_definition) - length(replace(v_definition, 'financial_post.operation_id,case when is_return then tender_amount', ''))) / length('financial_post.operation_id,case when is_return then tender_amount');
  if v_occurrences <> 1 then raise exception 'voucher ledger operation_id contract is ambiguous or missing'; end if;
  v_definition := replace(v_definition, 'financial_post.operation_id,case when is_return then tender_amount', 'v_operation_id,case when is_return then tender_amount');

  v_occurrences := (length(v_definition) - length(replace(v_definition, 'business_date,(journal->''data''->>''entry_id'')::uuid,operation_id,payload_hash,', ''))) / length('business_date,(journal->''data''->>''entry_id'')::uuid,operation_id,payload_hash,');
  if v_occurrences <> 1 then raise exception 'source posting operation_id contract is ambiguous or missing'; end if;
  v_definition := replace(v_definition, 'business_date,(journal->''data''->>''entry_id'')::uuid,operation_id,payload_hash,', 'business_date,(journal->''data''->>''entry_id'')::uuid,v_operation_id,payload_hash,');

  execute v_definition;
end
$do$;

commit;

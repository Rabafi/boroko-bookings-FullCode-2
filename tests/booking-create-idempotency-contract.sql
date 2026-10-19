do $luna_booking_contract$
declare
  v_multi_room_definition text;
  v_update_quotation_definition text;
  v_update_quotation_short_definition text;
begin
  if to_regclass('public.booking_create_intents') is null
     or to_regclass('public.campsite_booking_create_intents') is null
     or to_regclass('public.booking_group_create_intents') is null then
    raise exception 'Immutable booking create-intent tables are missing';
  end if;
  if to_regprocedure('public.create_booking(uuid,uuid,uuid,date,date,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text,boolean)') is null
     or to_regprocedure('public.create_booking_record(jsonb)') is null
     or to_regprocedure('public.create_booking_record_pre_intent_v1(jsonb)') is null
     or to_regprocedure('public.convert_quotation_to_booking(uuid,uuid,numeric,text,uuid)') is null
     or to_regprocedure('public.convert_quotation_to_booking_pre_intent_v1(uuid,uuid,numeric,text,uuid)') is null
     or to_regprocedure('public.create_campsite_booking(uuid,uuid,uuid,date,date,integer,integer,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text)') is null
     or to_regprocedure('public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text)') is null
     or to_regprocedure('public.create_online_booking(text,jsonb)') is null
     or to_regprocedure('public.update_quotation(uuid,uuid,jsonb,timestamptz)') is null
     or to_regprocedure('public.update_quotation(uuid,uuid,jsonb)') is null then
    raise exception 'One or more authoritative booking creation RPC signatures are missing';
  end if;
  if has_function_privilege('authenticated', 'public.create_booking_pre_intent_v1(uuid,uuid,uuid,date,date,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_booking_pre_intent_v1(uuid,uuid,uuid,date,date,integer,integer,numeric,text,text,uuid,numeric,uuid,text,text,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_booking_record_pre_intent_v1(jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_booking_record_pre_intent_v1(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.convert_quotation_to_booking_pre_intent_v1(uuid,uuid,numeric,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.convert_quotation_to_booking_pre_intent_v1(uuid,uuid,numeric,text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_online_booking_legacy(text,jsonb)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.create_booking_record(jsonb)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.convert_quotation_to_booking(uuid,uuid,numeric,text,uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.get_booking_create_intent_diagnostics(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_booking_create_intent_diagnostics(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_quotation_pre_conversion_guard_v1(uuid,uuid,jsonb,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.update_quotation_pre_conversion_guard_v1(uuid,uuid,jsonb,timestamptz)', 'EXECUTE') then
    raise exception 'An unsafe legacy booking creation overload remains client-callable or a guarded session RPC is inaccessible';
  end if;
  select pg_get_functiondef('public.create_multi_room_booking(uuid,uuid,date,date,jsonb,numeric,numeric,text,text,uuid,text,text)'::regprocedure)
    into v_multi_room_definition;
  if position('booking-group-key:' in v_multi_room_definition) = 0
     or position('booking-group-operation:' in v_multi_room_definition) = 0
     or position('idempotency_conflict' in v_multi_room_definition) = 0 then
    raise exception 'Multi-room operation and group keys are not independently serialized and conflict checked';
  end if;
  select pg_get_functiondef('public.update_quotation(uuid,uuid,jsonb,timestamptz)'::regprocedure)
    into v_update_quotation_definition;
  select pg_get_functiondef('public.update_quotation(uuid,uuid,jsonb)'::regprocedure)
    into v_update_quotation_short_definition;
  if position('if v_quote.status=''converted'' then' in v_update_quotation_definition) = 0
     or position('update_quotation_pre_conversion_guard_v1' in v_update_quotation_definition)
        < position('if v_quote.status=''converted'' then' in v_update_quotation_definition)
     or position('update_quotation(' in v_update_quotation_short_definition) = 0 then
    raise exception 'Converted quotations remain mutable through an update_quotation overload';
  end if;
  if has_table_privilege('authenticated', 'public.booking_group_create_intents', 'INSERT')
     or has_table_privilege('anon', 'public.booking_create_intents', 'INSERT')
     or has_table_privilege('authenticated', 'public.booking_create_intents', 'INSERT')
     or has_table_privilege('anon', 'public.campsite_booking_create_intents', 'INSERT') then
    raise exception 'Booking create-intent rows can be forged outside their RPC contracts';
  end if;
end
$luna_booking_contract$;
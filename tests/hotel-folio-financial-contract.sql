do $luna_hotel_contract$
begin
  if to_regclass('public.hotel_folio_transfer_pairs') is null
     or to_regclass('public.hotel_folio_mutation_audit') is null then
    raise exception 'Hotel folio intent and pair tables are missing';
  end if;
  if to_regprocedure('public.hotel_folio_mutation_v1(uuid,text,text,jsonb)') is null
     or to_regprocedure('public.get_hotel_folio_integrity_diagnostics(uuid)') is null then
    raise exception 'Keyed Hotel folio mutation or integrity diagnostic RPC is missing';
  end if;
  if not has_function_privilege('anon', 'public.hotel_folio_mutation_v1(uuid,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.hotel_folio_mutation_v1(uuid,text,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.get_folio_line_items(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.get_hotel_folio_integrity_diagnostics(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_folio_line_items(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_hotel_folio_integrity_diagnostics(uuid)', 'EXECUTE') then
    raise exception 'Hotel staff-session RPC grants are missing for a supported client role';
  end if;
  if has_table_privilege('authenticated', 'public.hotel_folio_transfer_pairs', 'INSERT')
     or has_table_privilege('authenticated', 'public.hotel_folio_mutation_audit', 'INSERT') then
    raise exception 'Authenticated clients can bypass the Hotel folio RPC through direct ledger writes';
  end if;
  if to_regclass('public.folio_line_items_one_reversal_per_original_uidx') is null
     or to_regclass('public.folio_line_items_transfer_leg_once_uidx') is null
     or not exists (select 1 from pg_trigger where tgname = 'trg_hotel_folio_validate_lineage_v1' and not tgisinternal) then
    raise exception 'Hotel folio paired reversal/transfer constraints are missing';
  end if;
end
$luna_hotel_contract$;
-- Preserve Restaurant vs Bar identity during first-company bootstrap.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.bootstrap_company_settings(jsonb)'::regprocedure) into v_definition;
  if position('public_offer_events,' || chr(10) || '    setup_complete,' in v_definition) = 0 then raise exception 'Could not locate bootstrap insert columns'; end if;
  v_definition := replace(v_definition,
    'public_offer_events,' || chr(10) || '    setup_complete,',
    'public_offer_events,' || chr(10) || '    operating_profile,' || chr(10) || '    setup_complete,');
  if position('coalesce((p_payload->>''public_offer_events'')::boolean, false),' || chr(10) || '    true,' in v_definition) = 0 then raise exception 'Could not locate bootstrap insert values'; end if;
  v_definition := replace(v_definition,
    'coalesce((p_payload->>''public_offer_events'')::boolean, false),' || chr(10) || '    true,',
    'coalesce((p_payload->>''public_offer_events'')::boolean, false),' || chr(10) || '    coalesce(p_payload->''operating_profile'', ''{}''::jsonb),' || chr(10) || '    true,');
  if position('public_offer_events = excluded.public_offer_events,' in v_definition) = 0 then raise exception 'Could not locate bootstrap update list'; end if;
  v_definition := replace(v_definition,
    'public_offer_events = excluded.public_offer_events,',
    'public_offer_events = excluded.public_offer_events,' || chr(10) || '    operating_profile = excluded.operating_profile,');
  execute v_definition;
end $$;

-- Exact repair for the affected company, proven from its retained setup backup.
update public.settings
set operating_profile = jsonb_set(coalesce(operating_profile, '{}'::jsonb), '{hospitality_mode}', '"bar_only"'::jsonb, true),
    updated_at = now()
where lodge_id = 'b380ba5e-a761-4017-8515-4f1ff31785a7'::uuid
  and lodge_name = 'Botswapelo Bar';

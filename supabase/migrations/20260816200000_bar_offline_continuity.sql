-- Bar Mode outage continuity.
--
-- Client-generated identities let dependency-ordered offline operations use
-- the exact same IDs when they replay. The wrappers retain every existing
-- lodge, role, outlet, PIN, idempotency and audit check by delegating to the
-- established authoritative RPCs before remapping an otherwise-unreferenced
-- freshly-created identity.

begin;

-- Keep the authoritative desktop application token alive for the same window
-- as the locally password-unlocked trusted session. Revocation, active-user,
-- lodge and role checks continue to run on every protected call.
create or replace function public.app_session_ttl(p_session_type text)
returns interval language sql immutable as $$
  select case
    when lower(coalesce(btrim(p_session_type), '')) = 'pwa' then interval '365 days'
    else interval '60 days'
  end
$$;

update public.app_sessions
   set expires_at = greatest(expires_at, created_at + interval '60 days'),
       metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('desktop_trusted_session_extended_at', now())
 where session_type = 'desktop'
   and revoked_at is null
   and created_at > now() - interval '60 days';

grant execute on function public.app_session_ttl(text) to anon, authenticated, service_role;

update public.settings
   set pos_offline_trading_hours = greatest(coalesce(pos_offline_trading_hours, 72), 1440)
 where coalesce(operating_profile, '{}'::jsonb)->>'hospitality_mode' = 'bar_only';

create or replace function public.apply_bar_offline_trading_window()
returns trigger language plpgsql set search_path=public as $$
begin
  if coalesce(new.operating_profile, '{}'::jsonb)->>'hospitality_mode' = 'bar_only'
     and coalesce(new.pos_offline_trading_hours, 72) <= 72 then
    new.pos_offline_trading_hours := 1440;
  end if;
  return new;
end
$$;

drop trigger if exists settings_bar_offline_trading_window on public.settings;
create trigger settings_bar_offline_trading_window
before insert or update of operating_profile, pos_offline_trading_hours on public.settings
for each row execute function public.apply_bar_offline_trading_window();

create or replace function public.create_pos_menu_item_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_requested uuid:=nullif(payload->>'id','')::uuid;
  v_actual uuid;
  v_result jsonb;
begin
  perform public.app_require_lodge_role(v_lodge,array['manager','admin','super_admin']);
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline menu identity is required.'); end if;
  if exists(select 1 from public.pos_menu_items where id=v_requested and lodge_id=v_lodge) then
    return jsonb_build_object('success',true,'id',v_requested,'replayed',true);
  end if;
  v_result:=public.create_pos_menu_item(payload-'id');
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(v_result->>'id','')::uuid;
  if v_actual is null then raise exception 'Menu creation returned no identity'; end if;
  update public.pos_menu_items set id=v_requested where id=v_actual and lodge_id=v_lodge;
  return v_result||jsonb_build_object('id',v_requested,'offline_replay',true);
end
$$;

create or replace function public.set_bar_pos_pack_template_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_requested uuid:=nullif(payload->>'menu_item_id','')::uuid;
  v_actual uuid;
  v_result jsonb;
begin
  perform public.app_require_lodge_role(v_lodge,array['manager','admin','super_admin']);
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline pack identity is required.'); end if;
  v_result:=public.set_bar_pos_pack_template(payload-'menu_item_id');
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(v_result->>'id','')::uuid;
  if v_actual is not null and v_actual<>v_requested and not exists(select 1 from public.pos_menu_items where id=v_requested) then
    update public.pos_menu_items set id=v_requested where id=v_actual and lodge_id=v_lodge;
  end if;
  return v_result||jsonb_build_object('id',coalesce(v_requested,v_actual),'offline_replay',true);
end
$$;

create or replace function public.save_bar_pos_product_with_packs_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_requested uuid:=nullif(payload->>'id','')::uuid;
  v_actual uuid;
  v_result jsonb;
  v_pack jsonb;
  v_pack_id uuid;
  v_existing_pack uuid;
begin
  perform public.app_require_lodge_role(v_lodge,array['manager','admin','super_admin']);
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline product identity is required.'); end if;
  v_result:=public.save_bar_pos_product_with_packs(payload-'id');
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(coalesce(v_result->>'menu_item_id',v_result->>'id'),'')::uuid;
  if v_actual is not null and v_actual<>v_requested and not exists(select 1 from public.pos_menu_items where id=v_requested) then
    update public.pos_menu_items set id=v_requested where id=v_actual and lodge_id=v_lodge;
  end if;
  for v_pack in select value from jsonb_array_elements(coalesce(payload->'packs','[]'::jsonb)) loop
    v_pack_id:=nullif(v_pack->>'menu_item_id','')::uuid;
    if v_pack_id is null then continue; end if;
    select id into v_existing_pack from public.pos_menu_items
     where lodge_id=v_lodge
       and inventory_item_id=nullif(payload->>'inventory_item_id','')::uuid
       and template_kind='bar_pack'
       and template_pack_size=(v_pack->>'pack_size')::integer
     limit 1;
    if v_existing_pack is not null and v_existing_pack<>v_pack_id and not exists(select 1 from public.pos_menu_items where id=v_pack_id) then
      update public.pos_menu_items set id=v_pack_id where id=v_existing_pack and lodge_id=v_lodge;
    end if;
  end loop;
  update public.restaurant_catalog_operations
     set result=(result||jsonb_build_object('id',v_requested,'menu_item_id',v_requested))
   where lodge_id=v_lodge and operation_key=payload->>'operation_key';
  return v_result||jsonb_build_object('id',v_requested,'menu_item_id',v_requested,'offline_replay',true);
end
$$;

create or replace function public.publish_pos_catalog_snapshot_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid;
  v_outlet uuid:=nullif(payload->>'outlet_id','')::uuid;
  v_requested uuid:=nullif(payload->>'snapshot_id','')::uuid;
  v_created timestamptz:=nullif(payload->>'client_created_at','')::timestamptz;
  v_actual uuid;
  v_result jsonb;
  v_row public.pos_catalog_snapshots%rowtype;
begin
  perform public.app_require_lodge_role(v_lodge,array['manager','admin','super_admin']);
  if v_outlet is not null then perform public.app_require_pos_outlet_access(v_lodge,v_outlet); end if;
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline catalog identity is required.'); end if;
  select * into v_row from public.pos_catalog_snapshots where id=v_requested and lodge_id=v_lodge;
  if found then
    if v_row.outlet_id is distinct from v_outlet then return jsonb_build_object('success',false,'error','Offline catalog identity belongs to another outlet.'); end if;
    return jsonb_build_object('success',true,'snapshot_id',v_row.id,'version_number',v_row.version_number,'payload_hash',v_row.payload_hash,'created_at',v_row.created_at,'replayed',true);
  end if;
  v_result:=public.publish_pos_catalog_snapshot(v_lodge,v_outlet);
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(v_result->>'snapshot_id','')::uuid;
  update public.pos_catalog_snapshots
     set id=v_requested,
         created_at=least(coalesce(v_created,now()),now()+interval '5 minutes')
   where id=v_actual and lodge_id=v_lodge;
  return v_result||jsonb_build_object('snapshot_id',v_requested,'created_at',least(coalesce(v_created,now()),now()+interval '5 minutes'),'offline_replay',true);
end
$$;

create or replace function public.clock_in_staff_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid; v_requested uuid:=nullif(payload->>'shift_id','')::uuid; v_actual uuid; v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager','supervisor']);
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline attendance identity is required.'); end if;
  if exists(select 1 from public.restaurant_shifts where id=v_requested and lodge_id=v_lodge) then return jsonb_build_object('success',true,'shift_id',v_requested,'replayed',true); end if;
  v_result:=public.clock_in_staff(payload-'shift_id');
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(v_result->>'shift_id','')::uuid;
  if v_actual<>v_requested then update public.restaurant_shifts set id=v_requested where id=v_actual and lodge_id=v_lodge; end if;
  return v_result||jsonb_build_object('shift_id',v_requested,'offline_replay',true);
end
$$;

create or replace function public.clock_in_staff_with_attendance_pin_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid; v_requested uuid:=nullif(payload->>'shift_id','')::uuid; v_actual uuid; v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager','supervisor']);
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline attendance identity is required.'); end if;
  if exists(select 1 from public.restaurant_shifts where id=v_requested and lodge_id=v_lodge) then return jsonb_build_object('success',true,'shift_id',v_requested,'replayed',true); end if;
  v_result:=public.clock_in_staff_with_attendance_pin(payload-'shift_id');
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(v_result->>'shift_id','')::uuid;
  if v_actual<>v_requested then update public.restaurant_shifts set id=v_requested where id=v_actual and lodge_id=v_lodge; end if;
  return v_result||jsonb_build_object('shift_id',v_requested,'offline_replay',true);
end
$$;

create or replace function public.clock_in_self_for_pos_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid; v_requested uuid:=nullif(payload->>'shift_id','')::uuid; v_actual uuid; v_result jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge,array['cashier','supervisor','manager','admin','super_admin']);
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline attendance identity is required.'); end if;
  if exists(select 1 from public.restaurant_shifts where id=v_requested and lodge_id=v_lodge) then return jsonb_build_object('success',true,'shift_id',v_requested,'replayed',true); end if;
  v_result:=public.clock_in_self_for_pos(payload-'shift_id');
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(v_result->>'shift_id','')::uuid;
  if v_actual<>v_requested then update public.restaurant_shifts set id=v_requested where id=v_actual and lodge_id=v_lodge; end if;
  return v_result||jsonb_build_object('shift_id',v_requested,'offline_replay',true);
end
$$;

create or replace function public.activate_shared_till_operator_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid; v_requested uuid:=nullif(payload->>'pos_shift_id','')::uuid; v_actual uuid; v_result jsonb; v_shift jsonb;
begin
  perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager','supervisor']);
  if v_requested is null then return jsonb_build_object('success',false,'error','Offline Till identity is required.'); end if;
  if exists(select 1 from public.pos_shifts where id=v_requested and lodge_id=v_lodge) then
    select to_jsonb(s) into v_shift from public.pos_shifts s where s.id=v_requested and s.lodge_id=v_lodge;
    return jsonb_build_object('success',true,'shift',v_shift,'replayed',true);
  end if;
  v_result:=public.activate_shared_till_operator(payload-'pos_shift_id');
  if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
  v_actual:=nullif(v_result->'shift'->>'id','')::uuid;
  if v_actual<>v_requested then update public.pos_shifts set id=v_requested where id=v_actual and lodge_id=v_lodge; end if;
  select to_jsonb(s) into v_shift from public.pos_shifts s where s.id=v_requested and s.lodge_id=v_lodge;
  return v_result||jsonb_build_object('shift',v_shift,'offline_replay',true);
end
$$;

create or replace function public.review_pos_cashup_submission_offline(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid; v_submission uuid:=nullif(payload->>'submission_id','')::uuid; v_key text:=nullif(payload->>'submission_idempotency_key','');
begin
  perform public.app_require_restaurant_lodge(v_lodge,array['admin','manager','supervisor']);
  if v_submission is null and v_key is not null then select id into v_submission from public.pos_cashup_submissions where lodge_id=v_lodge and idempotency_key=v_key; end if;
  if v_submission is null then return jsonb_build_object('success',false,'error','The queued cash-up submission could not be resolved.'); end if;
  return public.review_pos_cashup_submission((payload-'submission_idempotency_key')||jsonb_build_object('submission_id',v_submission));
end
$$;

revoke all on function public.create_pos_menu_item_offline(jsonb), public.set_bar_pos_pack_template_offline(jsonb), public.save_bar_pos_product_with_packs_offline(jsonb), public.publish_pos_catalog_snapshot_offline(jsonb), public.clock_in_staff_offline(jsonb), public.clock_in_staff_with_attendance_pin_offline(jsonb), public.clock_in_self_for_pos_offline(jsonb), public.activate_shared_till_operator_offline(jsonb), public.review_pos_cashup_submission_offline(jsonb) from public;
grant execute on function public.create_pos_menu_item_offline(jsonb), public.set_bar_pos_pack_template_offline(jsonb), public.save_bar_pos_product_with_packs_offline(jsonb), public.publish_pos_catalog_snapshot_offline(jsonb), public.clock_in_staff_offline(jsonb), public.clock_in_staff_with_attendance_pin_offline(jsonb), public.clock_in_self_for_pos_offline(jsonb), public.activate_shared_till_operator_offline(jsonb), public.review_pos_cashup_submission_offline(jsonb) to anon, authenticated, service_role;

revoke all on function public.apply_bar_offline_trading_window() from public,anon,authenticated;
grant execute on function public.apply_bar_offline_trading_window() to service_role;

commit;

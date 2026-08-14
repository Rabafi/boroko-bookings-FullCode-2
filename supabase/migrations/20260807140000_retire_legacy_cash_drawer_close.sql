-- The original lodge-wide cash-drawer close accepted an operator-edited POS
-- movement and auto-closed another session. Retire it in favor of shift/till
-- cash-up RPCs that calculate expected tender totals from immutable events.

begin;

alter table public.restaurant_cash_drawer_sessions
  add column if not exists outlet_id uuid,
  add column if not exists shift_id uuid,
  add column if not exists operator_id uuid,
  add column if not exists operation_key text;

create unique index if not exists restaurant_cash_drawer_open_operation_uidx
  on public.restaurant_cash_drawer_sessions(lodge_id,operation_key)
  where operation_key is not null;

create or replace function public.open_cash_drawer_session(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_lodge uuid:=nullif(payload->>'lodge_id','')::uuid;v_outlet uuid:=nullif(payload->>'outlet_id','')::uuid;v_shift uuid:=nullif(payload->>'shift_id','')::uuid;v_operator uuid:=nullif(payload->>'operator_id','')::uuid;v_key text:=nullif(btrim(payload->>'operation_key'),'');v_id uuid:=gen_random_uuid();v_existing public.restaurant_cash_drawer_sessions%rowtype;
begin
  perform public.app_require_lodge_role(v_lodge,array['cashier','supervisor','manager','admin','super_admin']);
  if v_key is not null then select * into v_existing from public.restaurant_cash_drawer_sessions where lodge_id=v_lodge and operation_key=v_key for update; if found then return jsonb_build_object('success',true,'session_id',v_existing.id,'replayed',true); end if; end if;
  if exists(select 1 from public.restaurant_cash_drawer_sessions where lodge_id=v_lodge and status='open') then raise exception 'An open cash session already exists. Close or explicitly abandon it through the governed shift workflow before opening another.' using errcode='55000'; end if;
  insert into public.restaurant_cash_drawer_sessions(id,lodge_id,outlet_id,shift_id,operator_id,operation_key,opening_float,status,opened_by) values(v_id,v_lodge,v_outlet,v_shift,v_operator,v_key,greatest(coalesce((payload->>'opening_float')::numeric,0),0),'open',public.app_current_user_id());
  return jsonb_build_object('success',true,'session_id',v_id,'outlet_id',v_outlet,'shift_id',v_shift,'operator_id',v_operator);
end
$$;

create or replace function public.close_cash_drawer_session(payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  raise exception 'Legacy cash drawer close is retired. Use the shift cash-up RPC; expected tenders are server-calculated and the operator enters only the physical count.' using errcode='55000';
end
$$;

create or replace function public.get_open_cash_drawer(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_session jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
  select jsonb_build_object('id',id,'opening_float',opening_float,'opened_at',opened_at,'status',status,'outlet_id',outlet_id,'shift_id',shift_id,'operator_id',operator_id,'operation_key',operation_key) into v_session from public.restaurant_cash_drawer_sessions where lodge_id=p_lodge_id and status='open' order by opened_at desc limit 1;
  return coalesce(v_session,'null'::jsonb);
end
$$;

revoke all on function public.open_cash_drawer_session(jsonb),public.close_cash_drawer_session(jsonb),public.get_open_cash_drawer(uuid) from public,anon,authenticated;
grant execute on function public.open_cash_drawer_session(jsonb),public.close_cash_drawer_session(jsonb),public.get_open_cash_drawer(uuid) to authenticated,service_role;

commit;

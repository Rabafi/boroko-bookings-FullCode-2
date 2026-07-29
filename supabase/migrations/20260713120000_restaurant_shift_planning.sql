-- Restaurant and Bar labour planning. Planning rows are operational metadata;
-- actual clock-in/out and POS sales remain in the existing authoritative ledgers.
create table if not exists public.restaurant_shift_plans (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  outlet_id uuid null references public.outlets(id) on delete set null,
  staff_name text not null,
  role text not null default 'cashier',
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  notes text,
  status text not null default 'planned' check (status in ('planned','confirmed','cancelled')),
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists restaurant_shift_plans_lodge_date_idx
  on public.restaurant_shift_plans(lodge_id, shift_date, start_time);
alter table public.restaurant_shift_plans enable row level security;
drop policy if exists restaurant_shift_plans_select on public.restaurant_shift_plans;
create policy restaurant_shift_plans_select on public.restaurant_shift_plans
  for select using (public.app_lodge_access(lodge_id));
drop policy if exists restaurant_shift_plans_insert on public.restaurant_shift_plans;
create policy restaurant_shift_plans_insert on public.restaurant_shift_plans
  for insert with check (public.app_lodge_access(lodge_id));
drop policy if exists restaurant_shift_plans_update on public.restaurant_shift_plans;
create policy restaurant_shift_plans_update on public.restaurant_shift_plans
  for update using (public.app_lodge_access(lodge_id));
drop policy if exists restaurant_shift_plans_delete on public.restaurant_shift_plans;
create policy restaurant_shift_plans_delete on public.restaurant_shift_plans
  for delete using (public.app_lodge_access(lodge_id));

create or replace function public.get_restaurant_shift_plans(p_lodge_id uuid, p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_rows jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  select coalesce(jsonb_agg(to_jsonb(s) order by s.shift_date, s.start_time), '[]'::jsonb)
    into v_rows from public.restaurant_shift_plans s
   where s.lodge_id = p_lodge_id
     and s.shift_date between coalesce(p_start_date, current_date) and coalesce(p_end_date, current_date + 14);
  return coalesce(v_rows, '[]'::jsonb);
end; $$;

create or replace function public.upsert_restaurant_shift_plan(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid; v_id uuid := coalesce(nullif(payload->>'id','')::uuid, gen_random_uuid()); v_row public.restaurant_shift_plans%rowtype;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager','admin','super_admin']);
  if btrim(coalesce(payload->>'staff_name','')) = '' then return jsonb_build_object('success',false,'error','Staff name is required'); end if;
  if nullif(payload->>'shift_date','') is null or nullif(payload->>'start_time','') is null or nullif(payload->>'end_time','') is null then return jsonb_build_object('success',false,'error','Date, start time and end time are required'); end if;
  insert into public.restaurant_shift_plans(id,lodge_id,outlet_id,staff_name,role,shift_date,start_time,end_time,notes,status,created_by,updated_at)
  values (v_id,v_lodge_id,nullif(payload->>'outlet_id','')::uuid,btrim(payload->>'staff_name'),coalesce(nullif(payload->>'role',''),'cashier'),(payload->>'shift_date')::date,(payload->>'start_time')::time,(payload->>'end_time')::time,payload->>'notes',coalesce(nullif(payload->>'status',''),'planned'),auth.uid(),now())
  on conflict (id) do update set outlet_id=excluded.outlet_id,staff_name=excluded.staff_name,role=excluded.role,shift_date=excluded.shift_date,start_time=excluded.start_time,end_time=excluded.end_time,notes=excluded.notes,status=excluded.status,updated_at=now();
  select * into v_row from public.restaurant_shift_plans where id=v_id and lodge_id=v_lodge_id;
  return jsonb_build_object('success',true,'plan',to_jsonb(v_row));
end; $$;

create or replace function public.delete_restaurant_shift_plan(p_lodge_id uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager','admin','super_admin']);
  delete from public.restaurant_shift_plans where id=p_id and lodge_id=p_lodge_id;
  return jsonb_build_object('success',true);
end; $$;

revoke all on function public.get_restaurant_shift_plans(uuid,date,date) from public;
revoke all on function public.upsert_restaurant_shift_plan(jsonb) from public;
revoke all on function public.delete_restaurant_shift_plan(uuid,uuid) from public;
grant execute on function public.get_restaurant_shift_plans(uuid,date,date) to anon,authenticated,service_role;
grant execute on function public.upsert_restaurant_shift_plan(jsonb) to anon,authenticated,service_role;
grant execute on function public.delete_restaurant_shift_plan(uuid,uuid) to anon,authenticated,service_role;

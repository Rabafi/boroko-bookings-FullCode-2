alter table public.pos_promotions
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists minimum_spend numeric not null default 0,
  add column if not exists customer_segment text;

create or replace function public.upsert_pos_promotions(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_lodge_id uuid := nullif(payload->>'lodge_id','')::uuid; v_promotions jsonb := coalesce(payload->'promotions','[]'::jsonb); v_promotion jsonb; v_count integer := 0;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager','admin','super_admin']);
  if jsonb_typeof(v_promotions) <> 'array' then return jsonb_build_object('success',false,'error','promotions must be an array'); end if;
  perform pg_advisory_xact_lock(pg_catalog.hashtextextended(v_lodge_id::text || ':pos-promotions',0));
  update public.pos_promotions set active=false,updated_at=now() where lodge_id=v_lodge_id;
  for v_promotion in select value from jsonb_array_elements(v_promotions) loop
    if nullif(btrim(coalesce(v_promotion->>'name','')),'') is null then return jsonb_build_object('success',false,'error','Every promotion requires a name'); end if;
    insert into public.pos_promotions(id,lodge_id,name,discount_type,discount_value,applies_to_category,active,starts_at,ends_at,minimum_spend,customer_segment,updated_at)
    values(coalesce(nullif(v_promotion->>'id','')::uuid,gen_random_uuid()),v_lodge_id,btrim(v_promotion->>'name'),case when lower(coalesce(v_promotion->>'discount_type','amount'))='percent' then 'percent' else 'amount' end,greatest(0,coalesce(nullif(v_promotion->>'discount_value','')::numeric,0)),coalesce(nullif(v_promotion->>'applies_to_category',''),'All'),coalesce((v_promotion->>'active')::boolean,true),nullif(v_promotion->>'starts_at','')::timestamptz,nullif(v_promotion->>'ends_at','')::timestamptz,greatest(0,coalesce(nullif(v_promotion->>'minimum_spend','')::numeric,0)),nullif(v_promotion->>'customer_segment',''),now())
    on conflict(id) do update set name=excluded.name,discount_type=excluded.discount_type,discount_value=excluded.discount_value,applies_to_category=excluded.applies_to_category,active=excluded.active,starts_at=excluded.starts_at,ends_at=excluded.ends_at,minimum_spend=excluded.minimum_spend,customer_segment=excluded.customer_segment,updated_at=now()
    where public.pos_promotions.lodge_id=v_lodge_id;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('success',true,'count',v_count);
end; $$;
revoke all on function public.upsert_pos_promotions(jsonb) from public;
grant execute on function public.upsert_pos_promotions(jsonb) to anon,authenticated,service_role;

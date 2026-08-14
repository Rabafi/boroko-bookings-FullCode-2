-- Expose tax adjustment evidence through a capability-gated read used by the
-- Tax working-paper page.  Financial adjustment rows remain service-owned.

begin;

create or replace function public.get_restaurant_tax_adjustments(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_rows jsonb;
begin
  perform public._restaurant_require_capability(p_lodge_id,'accounting.read');
  select coalesce(jsonb_agg(to_jsonb(a) order by a.business_date desc,a.created_at desc,a.id desc),'[]'::jsonb)
    into v_rows
    from public.restaurant_tax_adjustments a
   where a.lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'data',v_rows,'complete',true,'source','server-authoritative-tax-adjustments');
end
$$;

revoke all on function public.get_restaurant_tax_adjustments(uuid) from public,anon;
grant execute on function public.get_restaurant_tax_adjustments(uuid) to authenticated,service_role;

commit;

begin;
create or replace function public.get_restaurant_tip_balances(p_lodge_id uuid, p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['admin','manager']);
  return coalesce((with earned as (select cashier_id staff_id, sum(tip_total) earned, sum(tip_total) filter (where created_at >= current_date and created_at < current_date + interval '1 day') earned_today from public.pos_orders where lodge_id=p_lodge_id and cashier_id is not null and created_at >= current_date-greatest(1,least(coalesce(p_days,30),365)) and coalesce(status,'') not in ('voided','cancelled') and coalesce(tip_total,0)>0 group by cashier_id), paid as (select staff_id,sum(amount) paid from public.restaurant_tip_payouts where lodge_id=p_lodge_id and business_date >= current_date-greatest(1,least(coalesce(p_days,30),365)) group by staff_id) select jsonb_agg(jsonb_build_object('staff_id',u.id,'staff_name',u.name,'earned',coalesce(e.earned,0),'earned_today',coalesce(e.earned_today,0),'paid',coalesce(p.paid,0),'available',greatest(coalesce(e.earned,0)-coalesce(p.paid,0),0)) order by u.name) from public.users u left join earned e on e.staff_id=u.id left join paid p on p.staff_id=u.id where u.lodge_id=p_lodge_id and u.status='active' and (coalesce(e.earned,0)>0 or coalesce(p.paid,0)>0)), '[]'::jsonb);
end; $$;
commit;

create or replace function public.clock_out_staff(payload jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge_id uuid:=nullif(payload->>'lodge_id','')::uuid; v_shift_id uuid:=nullif(payload->>'shift_id','')::uuid; v_actor uuid:=public.app_current_user_id(); v_shift public.restaurant_shifts%rowtype; v_pos uuid; v_cashup text; v_unreconciled boolean;
begin
 perform public.app_require_restaurant_lodge(v_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
 select * into v_shift from public.restaurant_shifts where id=v_shift_id and lodge_id=v_lodge_id and status='active' for update;
 if not found then return jsonb_build_object('success',false,'error','Active attendance shift not found. Refresh and try again.'); end if;
 if v_shift.staff_user_id is distinct from v_actor then perform public.app_require_restaurant_lodge(v_lodge_id,array['admin','manager','supervisor']); end if;
 select id into v_pos from public.pos_shifts where lodge_id=v_lodge_id and attendance_shift_id=v_shift.id and status='open' order by opened_at desc limit 1;
 if v_pos is null then select id into v_pos from public.pos_shifts where lodge_id=v_lodge_id and cashier_id=v_shift.staff_user_id and status='open' order by opened_at desc limit 1; end if;
 if v_pos is not null then select status into v_cashup from public.pos_cashup_submissions where lodge_id=v_lodge_id and shift_id=v_pos; if coalesce(v_cashup,'') not in ('submitted','approved') then return jsonb_build_object('success',false,'error','Submit My Cash-up before clocking out.'); end if; end if;
 select exists(select 1 from public.pos_orders o left join public.pos_cashup_submissions c on c.lodge_id=o.lodge_id and c.shift_id=o.shift_id and c.status in ('submitted','approved') where o.lodge_id=v_lodge_id and o.cashier_id=v_shift.staff_user_id and o.created_at>=v_shift.clock_in and coalesce(o.status,'') not in ('voided','cancelled') and c.id is null) into v_unreconciled;
 if v_unreconciled then return jsonb_build_object('success',false,'error','A sale recorded during this attendance shift still needs a submitted cash-up before clocking out.'); end if;
 update public.restaurant_shifts set clock_out=now(),status='completed',clocked_out_by=v_actor where id=v_shift_id; return jsonb_build_object('success',true);
end; $$;

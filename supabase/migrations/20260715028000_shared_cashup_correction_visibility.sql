-- A manager-operated shared terminal must show the selected worker why a
-- handover was returned, without allowing the manager to alter that record.
create or replace function public.get_staff_pos_cashup_submission(p_lodge_id uuid, p_shift_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_row public.pos_cashup_submissions%rowtype;
begin
  perform public.app_require_restaurant_lodge(p_lodge_id, array['admin','manager','supervisor']);
  select * into v_row from public.pos_cashup_submissions
  where lodge_id = p_lodge_id and shift_id = p_shift_id;
  if not found then return jsonb_build_object('success', true, 'submission', null); end if;
  return jsonb_build_object('success', true, 'submission', jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'expected_cash_drawer', v_row.expected_cash_drawer,
    'cash_tips_retained', v_row.cash_tips_retained, 'counted_by_method', v_row.counted_by_method,
    'notes', v_row.notes, 'review_notes', v_row.review_notes, 'submitted_at', v_row.submitted_at,
    'reviewed_at', v_row.reviewed_at
  ));
end;
$$;

revoke all on function public.get_staff_pos_cashup_submission(uuid, uuid) from public;
grant execute on function public.get_staff_pos_cashup_submission(uuid, uuid) to authenticated, service_role;

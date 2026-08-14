-- Bar/POS authorization hardening.
--
-- The financial read/write bodies already contain the calculation and
-- concurrency rules. Keep those bodies intact and put a small, auditable
-- authorization wrapper in front of them so a later body replacement cannot
-- accidentally reopen lodge-wide or anonymous access.

begin;

-- A null outlet is a company-wide query. Cashiers and supervisors must never
-- be able to use it as an outlet-selector bypass; the desktop also fails closed
-- before calling the export for those roles.
alter function public.get_pos_financial_report_export_v2(uuid, date, date, uuid)
  rename to get_pos_financial_report_export_v2_unscoped;

create or replace function public.get_pos_financial_report_export_v2(
  p_lodge_id uuid,
  p_start_date date,
  p_end_date date,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_role text;
begin
  begin
    v_actor := public._restaurant_require_operational_report_access(p_lodge_id, 'pos.view');
  exception when insufficient_privilege then
    v_actor := public._restaurant_require_operational_report_access(p_lodge_id, 'reports.view');
  end;

  select lower(role)
    into v_role
    from public.users
   where id = v_actor
     and lodge_id = p_lodge_id;

  if p_outlet_id is null and v_role in ('cashier', 'supervisor') then
    raise exception 'A cashier or supervisor POS export requires one assigned outlet'
      using errcode = '42501';
  end if;

  if p_outlet_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  end if;

  return public.get_pos_financial_report_export_v2_unscoped(
    p_lodge_id,
    p_start_date,
    p_end_date,
    p_outlet_id
  );
end;
$$;

revoke all on function public.get_pos_financial_report_export_v2_unscoped(uuid, date, date, uuid)
  from public, anon, authenticated;
grant execute on function public.get_pos_financial_report_export_v2_unscoped(uuid, date, date, uuid)
  to service_role;
revoke all on function public.get_pos_financial_report_export_v2(uuid, date, date, uuid)
  from public, anon;
grant execute on function public.get_pos_financial_report_export_v2(uuid, date, date, uuid)
  to authenticated, service_role;

-- Owner Digest is an operator-facing summary, not a second financial ledger.
-- Rebuild it from the certified POS report envelope and make every monetary
-- field explicitly unavailable when the report is incomplete. The previous
-- implementation summed pos_orders directly and returned zero fallbacks.
create or replace function public.generate_owner_digest(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_timezone text := 'Africa/Gaborone';
  v_today date;
  v_report jsonb;
  v_data jsonb;
  v_controls jsonb;
  v_complete boolean := false;
  v_summary jsonb;
  v_digest_id uuid := gen_random_uuid();
begin
  v_actor := public._restaurant_require_operational_report_access(p_lodge_id, 'reports.view');
  select coalesce(nullif(btrim(s.timezone), ''), 'Africa/Gaborone')
    into v_timezone
    from public.settings s
   where s.lodge_id = p_lodge_id
   limit 1;
  v_timezone := coalesce(v_timezone, 'Africa/Gaborone');
  v_today := (now() at time zone v_timezone)::date;

  v_report := public.get_pos_financial_report_export_v2(p_lodge_id, v_today, v_today, null);
  v_data := coalesce(v_report->'data', '{}'::jsonb);
  v_controls := coalesce(v_data->'control_totals', '{}'::jsonb);
  v_complete := coalesce((v_data->>'source_coverage_complete')::boolean, false)
    and coalesce(v_data->>'dataset_status', '') = 'certified';

  select jsonb_build_object(
    'date', v_today,
    'generated_at', clock_timestamp(),
    'generated_by', v_actor,
    'financial_complete', v_complete,
    'financial_source', 'pos_financial_detail_v3',
    'financial_reason', case when v_complete then null else 'POS report source is incomplete or contains unresolved financial evidence' end,
    'report_run_id', v_data->'report_run_id',
    'total_revenue', case when v_complete then v_controls->'net_recorded_sales' else null end,
    'total_orders', case when v_complete then v_controls->'completed_sale_count' else null end,
    'avg_order', case when v_complete then v_controls->'average_completed_sale' else null end,
    'pending_orders', (select count(*) from public.pos_orders o where o.lodge_id = p_lodge_id and coalesce(o.business_date, (o.created_at at time zone v_timezone)::date) = v_today and lower(coalesce(o.status, '')) = 'pending'),
    'active_alerts', (select count(*) from public.restaurant_alerts a where a.lodge_id = p_lodge_id and a.is_resolved = false),
    'low_stock_items', (select count(*) from public.inventory_items i where i.lodge_id = p_lodge_id and i.current_stock <= i.reorder_level),
    'open_checklists', (select count(*) from public.restaurant_checklists c where c.lodge_id = p_lodge_id and c.status = 'pending' and c.checklist_date >= (v_today || 'T00:00:00')::timestamp at time zone v_timezone),
    'expenses_complete', false,
    'total_expenses', null,
    'staff_on_duty', (select count(*) from public.restaurant_shifts s where s.lodge_id = p_lodge_id and s.status = 'active'),
    'top_items', '[]'::jsonb
  ) into v_summary;

  insert into public.restaurant_owner_digest (id, lodge_id, digest_date, summary)
  values (v_digest_id, p_lodge_id, now(), v_summary);

  return jsonb_build_object('success', true, 'digest', v_summary);
end;
$$;

revoke all on function public.generate_owner_digest(uuid) from public, anon;
grant execute on function public.generate_owner_digest(uuid) to authenticated, service_role;

-- Read access to tabs follows the same POS outlet contract as orders. The
-- previous function checked only lodge membership, which allowed a scoped POS
-- operator to omit p_outlet_id and receive every outlet's open checks.
alter function public.get_restaurant_pos_tabs_financial_truth(uuid, uuid, text)
  rename to get_restaurant_pos_tabs_financial_truth_unscoped;

create or replace function public.get_restaurant_pos_tabs_financial_truth(
  p_lodge_id uuid,
  p_outlet_id uuid default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_pos_outlet_access(p_lodge_id, p_outlet_id);
  return public.get_restaurant_pos_tabs_financial_truth_unscoped(
    p_lodge_id,
    p_outlet_id,
    p_status
  );
end;
$$;

revoke all on function public.get_restaurant_pos_tabs_financial_truth_unscoped(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_restaurant_pos_tabs_financial_truth_unscoped(uuid, uuid, text)
  to service_role;
revoke all on function public.get_restaurant_pos_tabs_financial_truth(uuid, uuid, text)
  from public, anon;
grant execute on function public.get_restaurant_pos_tabs_financial_truth(uuid, uuid, text)
  to authenticated, service_role;

-- Tab status changes are POS-management writes. Enforce the outlet before the
-- update and append a before/after audit event in the same transaction.
alter function public.update_pos_tab_status(uuid, text, text)
  rename to update_pos_tab_status_unscoped;

create or replace function public.update_pos_tab_status(
  p_tab_id uuid,
  p_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before public.pos_tabs%rowtype;
  v_result jsonb;
begin
  select *
    into v_before
    from public.pos_tabs
   where id = p_tab_id
   for update;

  if v_before.id is null then
    return jsonb_build_object('success', false, 'error', 'Open table tab not found.');
  end if;

  perform public.app_require_lodge_role(
    v_before.lodge_id,
    array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']
  );
  perform public.app_require_pos_outlet_access(v_before.lodge_id, v_before.outlet_id);

  v_result := public.update_pos_tab_status_unscoped(p_tab_id, p_status, p_notes);

  if coalesce((v_result->>'success')::boolean, false) then
    insert into public.pos_audit_log (
      lodge_id,
      outlet_id,
      actor_id,
      action,
      entity_type,
      entity_id,
      before_snapshot,
      after_snapshot,
      created_at
    ) values (
      v_before.lodge_id,
      v_before.outlet_id,
      public.app_current_user_id(),
      'tab_status_updated',
      'pos_tab',
      v_before.id,
      to_jsonb(v_before),
      v_result->'tab',
      now()
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.update_pos_tab_status_unscoped(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.update_pos_tab_status_unscoped(uuid, text, text)
  to service_role;
revoke all on function public.update_pos_tab_status(uuid, text, text)
  from public, anon;
grant execute on function public.update_pos_tab_status(uuid, text, text)
  to authenticated, service_role;

-- There is no anonymous POS session. In particular, do not let an unauthenticated
-- client invoke the tab upsert RPC even though the authenticated body still
-- performs lodge/outlet checks.
revoke all on function public.upsert_pos_tab(jsonb) from anon;
grant execute on function public.upsert_pos_tab(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;

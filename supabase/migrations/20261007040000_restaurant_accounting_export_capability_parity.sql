-- ACC-02: server defaults now match the desktop capability snapshot aliases.
-- Explicit per-user boolean overrides still take precedence; payroll stays private.
begin;

create or replace function public._restaurant_actor_has_capability(p_lodge_id uuid,p_capability text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.app_get_actor_user_id();
  v_role text;
  v_raw_role text;
  v_overrides jsonb;
  v_override jsonb;
  v_default boolean := false;
begin
  if auth.role() = 'service_role' then return true; end if;

  select lower(btrim(coalesce(u.role,''))), coalesce(u.capability_overrides,'{}'::jsonb)
    into v_raw_role, v_overrides
    from public.users u
   where u.id = v_actor and u.lodge_id = p_lodge_id and coalesce(u.status,'active') = 'active';
  if not found then return false; end if;

  -- Match only aliases explicitly normalized by src/shared/accessControl.js.
  -- Unrecognized role strings retain no accounting export default.
  v_role := case v_raw_role
    when 'owner' then 'admin'
    when 'administrator' then 'admin'
    when 'superadmin' then 'super_admin'
    when 'accounts' then 'finance'
    when 'accounting' then 'finance'
    else v_raw_role
  end;

  v_default := case p_capability
    when 'accounting.read' then v_role in ('finance','manager','admin','super_admin')
    when 'accounting.manage' then v_role in ('finance','admin','super_admin')
    when 'accounting.ap_pay' then v_role in ('finance','admin','super_admin')
    when 'accounting.bank_approve' then v_role in ('finance','admin','super_admin')
    when 'accounting.tax_file' then v_role in ('finance','admin','super_admin')
    when 'accounting.payroll_view' then v_role in ('admin','super_admin')
    when 'accounting.payroll_manage' then v_role in ('admin','super_admin')
    when 'accounting.export' then v_role in ('finance','manager','admin','super_admin')
    when 'accounting.payroll_export' then v_role in ('admin','super_admin')
    when 'accounting.close' then v_role in ('finance','admin','super_admin')
    else false
  end;

  v_override := v_overrides -> p_capability;
  if v_override is not null and jsonb_typeof(v_override) = 'boolean' then
    return (v_override::text)::boolean;
  end if;
  return v_default;
end
$$;

commit;
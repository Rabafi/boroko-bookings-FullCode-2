-- Restaurant & Bar setup progress is manager-confirmed and server-audited.
-- It deliberately records confirmations as append-only events so a new venue's
-- readiness cannot be silently rewritten on a workstation.

create table if not exists public.restaurant_setup_progress_events (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  stage_key text not null,
  status text not null check (status in ('confirmed', 'not_started')),
  notes text,
  acted_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create index if not exists restaurant_setup_progress_events_lodge_stage_created_idx
  on public.restaurant_setup_progress_events (lodge_id, stage_key, created_at desc);

alter table public.restaurant_setup_progress_events enable row level security;

create policy restaurant_setup_progress_events_lodge_scope_select
  on public.restaurant_setup_progress_events for select
  using (public.app_lodge_access(lodge_id));

create or replace function public.get_restaurant_setup_progress(p_lodge_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'stage_key', latest.stage_key,
      'status', latest.status,
      'notes', latest.notes,
      'acted_by', latest.acted_by,
      'created_at', latest.created_at
    ) order by latest.stage_key)
    from (
      select distinct on (stage_key) stage_key, status, notes, acted_by, created_at
      from public.restaurant_setup_progress_events
      where lodge_id = p_lodge_id
      order by stage_key, created_at desc, id desc
    ) latest
  ), '[]'::jsonb);
end;
$$;

create or replace function public.set_restaurant_setup_stage(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lodge_id uuid := nullif(p_payload->>'lodge_id', '')::uuid;
  v_stage_key text := btrim(coalesce(p_payload->>'stage_key', ''));
  v_status text := btrim(coalesce(p_payload->>'status', ''));
  v_notes text := nullif(btrim(coalesce(p_payload->>'notes', '')), '');
  v_actor uuid := public.app_current_user_id();
  v_event_id uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'Your staff session could not be verified. Sign in again before updating setup progress.');
  end if;

  if v_stage_key not in (
    'business_profile', 'tax_service', 'outlets', 'staff_accounts', 'staff_roles',
    'staff_pins', 'floor_plan', 'menu_categories', 'menu_pricing', 'modifiers_combos',
    'kitchen_stations', 'inventory', 'suppliers_purchasing', 'recipes_prep',
    'payments_tips', 'receipt_hardware', 'daily_checklists', 'guest_policy',
    'data_backup', 'go_live_review'
  ) then
    return jsonb_build_object('success', false, 'error', 'That setup stage is not recognised.');
  end if;

  if v_status not in ('confirmed', 'not_started') then
    return jsonb_build_object('success', false, 'error', 'Setup stage status must be confirmed or not_started.');
  end if;

  insert into public.restaurant_setup_progress_events (lodge_id, stage_key, status, notes, acted_by)
  values (v_lodge_id, v_stage_key, v_status, v_notes, v_actor)
  returning id into v_event_id;

  return jsonb_build_object('success', true, 'event_id', v_event_id);
end;
$$;

revoke all on function public.get_restaurant_setup_progress(uuid) from public;
revoke all on function public.set_restaurant_setup_stage(jsonb) from public;
grant execute on function public.get_restaurant_setup_progress(uuid) to authenticated, service_role;
grant execute on function public.set_restaurant_setup_stage(jsonb) to authenticated, service_role;

-- Product-scoped release governance. Legacy app_releases rows remain visible
-- for history but are never eligible for a product updater gate.

alter table public.app_releases add column if not exists product_id text;
alter table public.app_releases drop constraint if exists app_releases_version_key;
alter table public.app_releases add constraint app_releases_product_id_check check (product_id is null or product_id in ('lodge-camp', 'hotel', 'hospitality-pos'));
create unique index if not exists app_releases_product_version_unique on public.app_releases(product_id, version) where product_id is not null;
create index if not exists app_releases_product_channel_status_created on public.app_releases(product_id, channel, status, created_at desc) where product_id is not null;

create or replace function public.app_create_product_release(
  p_product_id text, p_version text, p_release_notes text default '', p_channel text default 'stable', p_force_update boolean default false, p_min_version text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Access denied: service role required' using errcode = '42501'; end if;
  if p_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') or length(btrim(coalesce(p_version, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'A valid product and version are required');
  end if;
  insert into public.app_releases(product_id, version, release_notes, channel, force_update, min_version)
  values (p_product_id, btrim(p_version), coalesce(p_release_notes, ''), coalesce(p_channel, 'stable'), coalesce(p_force_update, false), nullif(btrim(coalesce(p_min_version, '')), ''));
  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'version', btrim(p_version));
end;
$$;

create or replace function public.app_check_product_update_availability(
  p_product_id text, p_current_version text, p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_release public.app_releases%rowtype; v_current int[]; v_target int[]; v_available boolean := false;
begin
  if p_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then return jsonb_build_object('ok', false, 'error', 'Invalid product update channel'); end if;
  select * into v_release from public.app_releases where product_id = p_product_id and channel = 'stable' and status in ('rolling_out', 'full') order by created_at desc limit 1;
  if not found then return jsonb_build_object('ok', true, 'update_available', false, 'product_id', p_product_id); end if;
  begin v_current := string_to_array(p_current_version, '.')::int[]; exception when others then v_current := array[0,0,0]; end;
  begin v_target := string_to_array(v_release.version, '.')::int[]; exception when others then v_target := array[0,0,0]; end;
  while array_length(v_current, 1) < 3 loop v_current := v_current || 0; end loop;
  while array_length(v_target, 1) < 3 loop v_target := v_target || 0; end loop;
  if v_target > v_current then
    v_available := v_release.status = 'full' or v_release.rollout_pct >= 100 or (v_release.rollout_pct > 0 and p_device_id is not null and (abs(hashtext(p_device_id)) % 100) < v_release.rollout_pct);
  end if;
  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'update_available', v_available, 'latest_version', v_release.version, 'release_notes', v_release.release_notes, 'force_update', v_release.force_update, 'channel', v_release.channel);
end;
$$;

create or replace function public.app_get_product_releases(p_product_id text)
returns setof public.app_releases
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Access denied: service role required' using errcode = '42501'; end if;
  return query select * from public.app_releases where product_id = p_product_id order by created_at desc;
end;
$$;

create or replace function public.app_update_product_release(
  p_product_id text, p_version text, p_rollout_pct int default null, p_status text default null, p_release_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.app_is_service_role() then raise exception 'Access denied: service role required' using errcode = '42501'; end if;
  if p_product_id not in ('lodge-camp', 'hotel', 'hospitality-pos') then return jsonb_build_object('ok', false, 'error', 'Invalid product'); end if;
  if p_rollout_pct is not null and (p_rollout_pct < 0 or p_rollout_pct > 100) then return jsonb_build_object('ok', false, 'error', 'Rollout must be between 0 and 100'); end if;
  if p_status is not null and p_status not in ('draft', 'rolling_out', 'full', 'paused', 'retired') then return jsonb_build_object('ok', false, 'error', 'Invalid release status'); end if;
  update public.app_releases set rollout_pct = coalesce(p_rollout_pct, rollout_pct), status = coalesce(p_status, status), release_notes = coalesce(p_release_notes, release_notes), updated_at = now()
   where product_id = p_product_id and version = p_version;
  if not found then return jsonb_build_object('ok', false, 'error', 'Product release was not found'); end if;
  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'version', p_version);
end;
$$;

revoke all on function public.app_create_product_release(text, text, text, text, boolean, text), public.app_check_product_update_availability(text, text, text), public.app_get_product_releases(text), public.app_update_product_release(text, text, int, text, text) from public, anon, authenticated;
grant execute on function public.app_create_product_release(text, text, text, text, boolean, text), public.app_get_product_releases(text), public.app_update_product_release(text, text, int, text, text) to service_role;
-- Updater clients use the normal Supabase client before a user session exists.
-- The check function is deliberately read-only and returns only the release
-- gate metadata for the requested product, so it is safe for anon/authenticated
-- callers while all release writes remain service-role-only.
grant execute on function public.app_check_product_update_availability(text, text, text) to anon, authenticated, service_role;
notify pgrst, 'reload schema';

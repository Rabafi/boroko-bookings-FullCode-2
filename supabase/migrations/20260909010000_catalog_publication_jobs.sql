-- Catalog publication job claiming and completion.
-- The atomic product/stock save creates one job row per affected outlet in
-- the same transaction. Any online desktop worker claims pending jobs (or
-- expired claims) with a claim token + lease; completion requires BOTH the
-- token and an unexpired lease, so an expired worker is rejected even before
-- another worker reclaims the job. Tenant and outlet access are enforced
-- server-side on both calls.
--
-- Limitation stated: desktop-claimed workers pause when all desktops are
-- closed. Pending jobs survive restarts and are reclaimed by the next worker
-- run (post-save sweep or explicit retry); choose an independently running
-- worker before promising publication without an open desktop.
-- Older versions never overwrite newer catalogs: claiming takes the highest
-- pending version per outlet and marks lower pending rows superseded.

begin;

create or replace function public.claim_catalog_publication_job(p_lodge_id uuid, p_outlet_id uuid, p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_token uuid:=gen_random_uuid();
  v_lease integer:=greatest(30,coalesce(p_lease_seconds,300));
  v_job public.catalog_publication_jobs%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['manager','admin','super_admin','cashier']);
  perform public.app_require_pos_outlet_access(p_lodge_id,p_outlet_id);
  if p_lodge_id is null or p_outlet_id is null then
    return jsonb_build_object('success',false,'error','Lodge and outlet are required');
  end if;

  -- Supersede older pending rows when a newer job exists for the outlet.
  update public.catalog_publication_jobs target
     set state='superseded', updated_at=now()
   where target.lodge_id=p_lodge_id
     and target.outlet_id=p_outlet_id
     and target.state='pending'
     and exists (
       select 1 from public.catalog_publication_jobs newer
        where newer.lodge_id=p_lodge_id
          and newer.outlet_id=p_outlet_id
          and newer.state='pending'
          and newer.version > target.version
     );

  -- Atomic claim: highest-version pending row, or an expired claim.
  update public.catalog_publication_jobs target
     set state='claimed', claim_token=v_token,
         lease_expires_at=now()+make_interval(secs=>v_lease),
         attempts=target.attempts+1, updated_at=now()
   where target.id = (
     select id from public.catalog_publication_jobs
      where lodge_id=p_lodge_id
        and outlet_id=p_outlet_id
        and (state='pending' or (state='claimed' and lease_expires_at < now()))
      order by version desc
      limit 1
     for update skip locked
   )
  returning * into v_job;

  if not found then
    return jsonb_build_object('success',true,'claimed',false);
  end if;
  return jsonb_build_object('success',true,'claimed',true,
    'job_id',v_job.id,'operation_key',v_job.operation_key,
    'outlet_id',v_job.outlet_id,'version',v_job.version,
    'claim_token',v_token,'attempts',v_job.attempts);
end
$$;

create or replace function public.complete_catalog_publication_job(p_job_id uuid, p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_updated integer;
  v_job public.catalog_publication_jobs%rowtype;
  v_applied bigint;
begin
  if p_job_id is null or p_claim_token is null then
    return jsonb_build_object('success',false,'error','Job identity and claim token are required');
  end if;
  select * into v_job from public.catalog_publication_jobs where id=p_job_id;
  if not found then
    return jsonb_build_object('success',false,'error','Publication job was not found');
  end if;
  perform public.app_require_lodge_role(v_job.lodge_id,array['manager','admin','super_admin','cashier']);
  perform public.app_require_pos_outlet_access(v_job.lodge_id,v_job.outlet_id);

  -- Token AND unexpired lease: an expired worker is rejected even if no
  -- other worker has reclaimed the job yet.
  update public.catalog_publication_jobs
     set state='published', updated_at=now()
   where id=p_job_id
     and state='claimed'
     and claim_token=p_claim_token
     and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('success',false,'error','Claim expired or already completed. Reclaim the job and retry.');
  end if;

  select applied_version into v_applied
    from public.catalog_publication_state where outlet_id=v_job.outlet_id;
  if v_applied is not null and v_applied > v_job.version then
    -- A newer catalog already covers this outlet: the snapshot mutation is
    -- derived from live tables so nothing regressed; report supersession
    -- instead of a fresh publication.
    return jsonb_build_object('success',true,'published',false,'superseded',true,'job_id',p_job_id);
  end if;

  insert into public.catalog_publication_state(outlet_id,applied_version,updated_at)
  values(v_job.outlet_id,v_job.version,now())
  on conflict(outlet_id) do update
    set applied_version=excluded.applied_version, updated_at=now()
    where excluded.applied_version > public.catalog_publication_state.applied_version;

  return jsonb_build_object('success',true,'published',true,'job_id',p_job_id);
end
$$;

create or replace function public.fail_catalog_publication_job(p_job_id uuid, p_claim_token uuid, p_error text default null, p_permanent boolean default false)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_updated integer;
  v_job public.catalog_publication_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null then
    return jsonb_build_object('success',false,'error','Job identity and claim token are required');
  end if;
  select * into v_job from public.catalog_publication_jobs where id=p_job_id;
  if not found then
    return jsonb_build_object('success',false,'error','Publication job was not found');
  end if;
  perform public.app_require_lodge_role(v_job.lodge_id,array['manager','admin','super_admin','cashier']);
  perform public.app_require_pos_outlet_access(v_job.lodge_id,v_job.outlet_id);
  update public.catalog_publication_jobs
     set state=case when coalesce(p_permanent,false) then 'failed' else 'pending' end,
         claim_token=null, lease_expires_at=null,
         last_error=left(coalesce(p_error,'publication failed'),500), updated_at=now()
   where id=p_job_id
     and state='claimed'
     and claim_token=p_claim_token
     and lease_expires_at > now();
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    return jsonb_build_object('success',false,'error','Claim expired or already completed.');
  end if;
  if coalesce(p_permanent,false) then
    return jsonb_build_object('success',true,'failed',true,'job_id',p_job_id);
  end if;
  return jsonb_build_object('success',true,'requeued',true,'job_id',p_job_id);
end
$$;

revoke all on function public.claim_catalog_publication_job(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.complete_catalog_publication_job(uuid,uuid) from public,anon,authenticated;
revoke all on function public.fail_catalog_publication_job(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.claim_catalog_publication_job(uuid,uuid,integer) to authenticated,service_role;
grant execute on function public.complete_catalog_publication_job(uuid,uuid) to authenticated,service_role;
grant execute on function public.fail_catalog_publication_job(uuid,uuid,text,boolean) to authenticated,service_role;

commit;

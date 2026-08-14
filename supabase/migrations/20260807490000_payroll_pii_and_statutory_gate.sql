-- Financial truth gate 9/9: payroll statutory provenance, independent
-- approval, restricted PII access, and selected-version exports.

begin;

create table if not exists public.restaurant_payroll_source_documents (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  document_kind text not null check (document_kind in ('statutory_rule','employment_policy','approved_payroll_version')),
  storage_object_id text not null,
  document_uri text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_count bigint not null check (byte_count > 0),
  mime_type text not null,
  issued_by text,
  governed_version text not null,
  effective_from date not null,
  effective_to date,
  registered_by uuid references public.users(id),
  registered_at timestamptz not null default now(),
  independently_verified_by uuid references public.users(id),
  independently_verified_at timestamptz,
  unique(lodge_id, storage_object_id, sha256),
  check(effective_to is null or effective_to >= effective_from)
);
alter table public.restaurant_payroll_source_documents enable row level security;
revoke all on table public.restaurant_payroll_source_documents from public, anon, authenticated;
grant select, insert, update on table public.restaurant_payroll_source_documents to service_role;

alter table public.restaurant_payroll_statutory_configurations
  add column if not exists source_document_id uuid references public.restaurant_payroll_source_documents(id) on delete restrict,
  add column if not exists professional_approval_reference text,
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_rule_hash text,
  add column if not exists effective_policy_version text;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='restaurant_payroll_statutory_approval_status_chk') then
    alter table public.restaurant_payroll_statutory_configurations add constraint restaurant_payroll_statutory_approval_status_chk check(approval_status in ('pending','approved','revoked'));
  end if;
end
$$;

create table if not exists public.restaurant_payroll_raw_export_audit (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  pay_period_id uuid not null references public.restaurant_pay_periods(id) on delete restrict,
  export_id uuid,
  actor_id uuid references public.users(id),
  capability text not null,
  reason text not null,
  payload_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.restaurant_payroll_raw_export_audit enable row level security;
revoke all on table public.restaurant_payroll_raw_export_audit from public, anon, authenticated;
grant select, insert on table public.restaurant_payroll_raw_export_audit to service_role;

create or replace function public.register_restaurant_payroll_source_document_v1(
  p_lodge_id uuid, p_document_kind text, p_storage_object_id text, p_document_uri text,
  p_sha256 text, p_byte_count bigint, p_mime_type text, p_issued_by text,
  p_governed_version text, p_effective_from date, p_effective_to date
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := public.app_get_actor_user_id(); v_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Payroll source-document registration is service-role-only during no-ship' using errcode='42501'; end if;
  if p_document_kind not in ('statutory_rule','employment_policy','approved_payroll_version') or nullif(btrim(p_storage_object_id),'') is null or nullif(btrim(p_document_uri),'') is null or p_sha256 !~ '^[0-9a-fA-F]{64}$' or coalesce(p_byte_count,0)<=0 or nullif(btrim(p_governed_version),'') is null or p_effective_from is null then
    raise exception 'A governed payroll source document, SHA-256, size, version and effective date are required' using errcode='22023';
  end if;
  insert into public.restaurant_payroll_source_documents(lodge_id,document_kind,storage_object_id,document_uri,sha256,byte_count,mime_type,issued_by,governed_version,effective_from,effective_to,registered_by)
  values(p_lodge_id,p_document_kind,btrim(p_storage_object_id),btrim(p_document_uri),lower(p_sha256),p_byte_count,btrim(p_mime_type),nullif(btrim(p_issued_by),''),btrim(p_governed_version),p_effective_from,p_effective_to,v_actor)
  on conflict(lodge_id,storage_object_id,sha256) do update set document_uri=excluded.document_uri,byte_count=excluded.byte_count,mime_type=excluded.mime_type,issued_by=excluded.issued_by,governed_version=excluded.governed_version,effective_from=excluded.effective_from,effective_to=excluded.effective_to
  returning id into v_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',v_id,'sha256',lower(p_sha256),'storage_object_id',p_storage_object_id));
end
$$;

create or replace function public.verify_restaurant_payroll_source_document_v1(p_lodge_id uuid, p_document_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := public.app_get_actor_user_id(); v_doc public.restaurant_payroll_source_documents%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Payroll source-document verification is service-role-only during no-ship' using errcode='42501'; end if;
  select * into v_doc from public.restaurant_payroll_source_documents where id=p_document_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Payroll source document was not found' using errcode='P0002'; end if;
  if v_doc.registered_by=v_actor then raise exception 'Source-document verification requires an independent approver' using errcode='42501'; end if;
  update public.restaurant_payroll_source_documents set independently_verified_by=v_actor,independently_verified_at=now() where id=p_document_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('id',p_document_id,'verified_by',v_actor,'verified_at',now()));
end
$$;

create or replace function public.approve_restaurant_payroll_statutory_configuration_v1(
  p_lodge_id uuid, p_configuration_id uuid, p_document_id uuid, p_approval_reference text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := public.app_get_actor_user_id(); v_cfg public.restaurant_payroll_statutory_configurations%rowtype; v_doc public.restaurant_payroll_source_documents%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'Payroll statutory approval is service-role-only during no-ship' using errcode='42501'; end if;
  select * into v_cfg from public.restaurant_payroll_statutory_configurations where id=p_configuration_id and lodge_id=p_lodge_id for update;
  if v_cfg.id is null then raise exception 'Payroll statutory configuration was not found' using errcode='P0002'; end if;
  select * into v_doc from public.restaurant_payroll_source_documents where id=p_document_id and lodge_id=p_lodge_id for update;
  if v_doc.id is null or v_doc.document_kind<>'statutory_rule' or v_doc.independently_verified_at is null then raise exception 'An independently verified statutory source document is required' using errcode='23503'; end if;
  if v_cfg.configured_by=v_actor or v_doc.registered_by=v_actor then raise exception 'Statutory approval must be independent from configuration and document registration' using errcode='42501'; end if;
  if v_doc.governed_version<>v_cfg.rule_version or v_doc.effective_from<>v_cfg.effective_from then raise exception 'Statutory document version/effective date does not match configuration' using errcode='23514'; end if;
  if nullif(btrim(p_approval_reference),'') is null then raise exception 'Professional approval reference is required' using errcode='22023'; end if;
  update public.restaurant_payroll_statutory_configurations set source_document_id=p_document_id,professional_approval_reference=btrim(p_approval_reference),approval_status='approved',approved_rule_hash=v_doc.sha256,effective_policy_version=v_doc.governed_version,policy_approved_by=v_actor,policy_approved_at=now(),source_document_hash=v_doc.sha256 where id=p_configuration_id;
  return jsonb_build_object('success',true,'data',jsonb_build_object('configuration_id',p_configuration_id,'approval_status','approved','approved_rule_hash',v_doc.sha256,'approval_reference',p_approval_reference));
end
$$;

create or replace function public.calculate_restaurant_payroll_v3(p_lodge_id uuid, p_pay_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := public.app_get_actor_user_id(); v_period public.restaurant_pay_periods%rowtype; v_cfg public.restaurant_payroll_statutory_configurations%rowtype; v_result jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Payroll calculation is service-role-only during no-ship' using errcode='42501'; end if;
  select * into v_period from public.restaurant_pay_periods where id=p_pay_period_id and lodge_id=p_lodge_id for update;
  if not found then raise exception 'Pay period was not found' using errcode='P0002'; end if;
  select * into v_cfg from public.restaurant_payroll_statutory_configurations where id=v_period.statutory_configuration_id and lodge_id=p_lodge_id;
  if not found or v_cfg.approval_status<>'approved' or v_cfg.source_document_id is null or v_cfg.policy_approved_by is null or v_cfg.source_document_hash !~ '^[0-9a-fA-F]{64}$' then raise exception 'Payroll calculation is blocked until the rule version has independent professional approval' using errcode='42501'; end if;
  if exists(select 1 from public.restaurant_payroll_time_inputs t where t.pay_period_id=p_pay_period_id and t.lodge_id=p_lodge_id and t.approved_at is null) then raise exception 'Payroll has unapproved time inputs' using errcode='23514'; end if;
  v_result := public.calculate_restaurant_payroll_v2(p_lodge_id,p_pay_period_id);
  return v_result || jsonb_build_object('statutory_evidence',jsonb_build_object('configuration_id',v_cfg.id,'rule_version',v_cfg.rule_version,'source_document_id',v_cfg.source_document_id,'source_document_hash',v_cfg.source_document_hash,'approval_reference',v_cfg.professional_approval_reference));
end
$$;

create or replace function public.get_restaurant_payroll_workspace_v3(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := public.app_get_actor_user_id(); v_data jsonb; v_terms jsonb;
begin
  if auth.role()<>'service_role' then raise exception 'Payroll workspace is service-role-only during no-ship' using errcode='42501'; end if;
  v_data := coalesce((public.get_restaurant_payroll_workspace_v2(p_lodge_id))->'data','{}'::jsonb);
  select coalesce(jsonb_agg((to_jsonb(t) - 'bank_account_name' - 'bank_account_number' - 'bank_branch_code') || jsonb_build_object('bank_account_number_masked',case when nullif(t.bank_account_number,'') is null then null else repeat('*',greatest(length(t.bank_account_number)-4,0))||right(t.bank_account_number,4) end) order by t.effective_from desc),'[]'::jsonb) into v_terms from public.restaurant_payroll_employment_terms t where t.lodge_id=p_lodge_id;
  return jsonb_build_object('success',true,'data',v_data || jsonb_build_object('terms',v_terms,'pii_policy','bank details are restricted to the dedicated payment-export operation','bank_details','masked','generated_by',v_actor));
end
$$;

create or replace function public.export_restaurant_payroll_payments_v4(p_lodge_id uuid, p_pay_period_id uuid, p_operation_id uuid, p_debit_account_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid := public._restaurant_require_capability(p_lodge_id,'accounting.payroll_export'); v_result jsonb; v_hash text;
begin
  if auth.role()<>'service_role' and nullif(btrim(p_reason),'') is null then raise exception 'A reason is required for raw payroll payment export' using errcode='22023'; end if;
  v_result := public.export_restaurant_payroll_payments_v3(p_lodge_id,p_pay_period_id,p_operation_id,p_debit_account_id);
  v_hash := encode(digest(coalesce(v_result,'{}'::jsonb)::text,'sha256'),'hex');
  insert into public.restaurant_payroll_raw_export_audit(lodge_id,pay_period_id,export_id,actor_id,capability,reason,payload_hash) values(p_lodge_id,p_pay_period_id,nullif(v_result->'data'->>'export_id','')::uuid,v_actor,'accounting.payroll_export',coalesce(nullif(btrim(p_reason),''),'service-role controlled export'),v_hash);
  return v_result || jsonb_build_object('restricted_export',true,'audit_hash',v_hash,'warning','Contains raw bank details. Save and dispose securely.');
end
$$;

revoke all on function public.register_restaurant_payroll_source_document_v1(uuid,text,text,text,text,bigint,text,text,text,date,date),public.verify_restaurant_payroll_source_document_v1(uuid,uuid),public.approve_restaurant_payroll_statutory_configuration_v1(uuid,uuid,uuid,text),public.calculate_restaurant_payroll_v3(uuid,uuid),public.get_restaurant_payroll_workspace_v3(uuid),public.export_restaurant_payroll_payments_v4(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.register_restaurant_payroll_source_document_v1(uuid,text,text,text,text,bigint,text,text,text,date,date),public.verify_restaurant_payroll_source_document_v1(uuid,uuid),public.approve_restaurant_payroll_statutory_configuration_v1(uuid,uuid,uuid,text),public.calculate_restaurant_payroll_v3(uuid,uuid),public.get_restaurant_payroll_workspace_v3(uuid),public.export_restaurant_payroll_payments_v4(uuid,uuid,uuid,uuid,text) to service_role;

commit;

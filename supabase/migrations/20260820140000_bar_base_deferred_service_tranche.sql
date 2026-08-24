-- Bar POS Base deferred service tranche.
-- All writes in this migration are lodge/outlet scoped, idempotent and
-- auditable.  No client is granted direct table access for the proof or
-- handover records.

begin;

alter table public.pos_prep_tickets
  add column if not exists service_mode text not null default 'counter';
alter table public.restaurant_shifts
  add column if not exists outlet_id uuid references public.outlets(id) on delete set null;

create table if not exists public.pos_shift_handover_notes (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  shift_id uuid not null references public.restaurant_shifts(id) on delete restrict,
  outlet_id uuid references public.outlets(id) on delete set null,
  note text not null,
  author_id uuid,
  author_name text,
  operation_id text not null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, shift_id, operation_id)
  ,check (payload_hash ~ '^[a-f0-9]{64}$')
);
create index if not exists pos_shift_handover_notes_scope_idx
  on public.pos_shift_handover_notes (lodge_id, shift_id, created_at desc);
alter table public.pos_shift_handover_notes
  drop constraint if exists pos_shift_handover_notes_shift_id_fkey;
alter table public.pos_shift_handover_notes
  add constraint pos_shift_handover_notes_shift_id_fkey
  foreign key (shift_id) references public.restaurant_shifts(id) on delete restrict;
create or replace function public.prevent_pos_handover_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Shift handover evidence is immutable.' using errcode='55006';
end;
$$;
drop trigger if exists pos_shift_handover_notes_immutable on public.pos_shift_handover_notes;
create trigger pos_shift_handover_notes_immutable
  before update or delete on public.pos_shift_handover_notes
  for each row execute function public.prevent_pos_handover_mutation();
alter table public.pos_shift_handover_notes enable row level security;
revoke all on public.pos_shift_handover_notes from anon, authenticated;

create table if not exists public.pos_void_reason_templates (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  label text not null,
  code text not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, code)
);
create index if not exists pos_void_reason_templates_scope_idx
  on public.pos_void_reason_templates (lodge_id, active, label);
alter table public.pos_void_reason_templates enable row level security;
revoke all on public.pos_void_reason_templates from anon, authenticated;

create table if not exists public.pos_ticket_status_operations (
  lodge_id uuid not null,
  ticket_id uuid not null references public.pos_prep_tickets(id) on delete cascade,
  operation_id text not null,
  payload_hash text not null,
  status text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (lodge_id, ticket_id, operation_id)
  ,check (payload_hash ~ '^[a-f0-9]{64}$')
);
alter table public.pos_ticket_status_operations enable row level security;
revoke all on public.pos_ticket_status_operations from anon, authenticated;

create table if not exists public.pos_cashup_proof_attachments (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid references public.outlets(id) on delete set null,
  submission_id uuid not null references public.pos_cashup_submissions(id) on delete restrict,
  storage_bucket text not null default 'private-cashup-proofs',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_count bigint not null,
  sha256 text not null,
  idempotency_key text not null,
  payload_hash text not null default '',
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (lodge_id, submission_id, idempotency_key),
  unique (storage_bucket, storage_path),
  check (byte_count > 0 and byte_count <= 8388608),
  check (mime_type in ('application/pdf','image/jpeg','image/png')),
  check (sha256 ~ '^[a-f0-9]{64}$'),
  check (payload_hash ~ '^[a-f0-9]{64}$' or payload_hash = '')
);
create index if not exists pos_cashup_proof_scope_idx
  on public.pos_cashup_proof_attachments (lodge_id, outlet_id, submission_id, created_at desc);
alter table public.pos_cashup_proof_attachments enable row level security;
revoke all on public.pos_cashup_proof_attachments from anon, authenticated;
alter table public.pos_cashup_proof_attachments
  add column if not exists payload_hash text not null default '';
alter table public.pos_cashup_proof_attachments
  drop constraint if exists pos_cashup_proof_attachments_submission_id_fkey;
alter table public.pos_cashup_proof_attachments
  add constraint pos_cashup_proof_attachments_submission_id_fkey
  foreign key (submission_id) references public.pos_cashup_submissions(id) on delete restrict;
create or replace function public.prevent_pos_cashup_proof_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Cash-up proof evidence is immutable.' using errcode='55006';
end;
$$;
drop trigger if exists pos_cashup_proof_attachments_immutable on public.pos_cashup_proof_attachments;
create trigger pos_cashup_proof_attachments_immutable
  before update or delete on public.pos_cashup_proof_attachments
  for each row execute function public.prevent_pos_cashup_proof_mutation();

create table if not exists public.pos_void_reason_template_operations (
  lodge_id uuid not null,
  operation_id text not null,
  payload_hash text not null,
  template_id uuid,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (lodge_id, operation_id)
  ,check (payload_hash ~ '^[a-f0-9]{64}$')
);
alter table public.pos_void_reason_template_operations enable row level security;
revoke all on public.pos_void_reason_template_operations from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('private-cashup-proofs', 'private-cashup-proofs', false, 8388608,
        array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public = false, file_size_limit = 8388608,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage is private and scoped to the submission cashier or a supervisor with
-- access to the submission outlet.  The helper deliberately returns false
-- when the app-session context is absent; that makes an untrusted Storage
-- request fail closed rather than fall back to lodge-wide access.
create or replace function public.pos_cashup_proof_storage_access(
  p_object_name text,
  p_for_write boolean default false
)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_parts text[] := string_to_array(coalesce(p_object_name, ''), '/');
  v_lodge uuid;
  v_submission uuid;
  v_outlet uuid;
  v_cashier uuid;
  v_status text;
  v_actor uuid := public.app_current_user_id();
  v_role text := lower(coalesce(public.app_current_role(), ''));
begin
  if public.app_is_service_role() then return true; end if;
  if array_length(v_parts, 1) <> 4
     or v_parts[2] <> 'cashups'
     or v_parts[4] !~ '^[a-f0-9-]+\.(pdf|jpg|jpeg|png)$' then
    return false;
  end if;
  begin
    v_lodge := v_parts[1]::uuid;
    v_submission := v_parts[3]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if v_lodge is distinct from public.app_current_lodge_id() then return false; end if;
  select c.outlet_id, c.cashier_id, c.status into v_outlet, v_cashier, v_status
    from public.pos_cashup_submissions c
   where c.id = v_submission and c.lodge_id = v_lodge;
  if not found or (p_for_write and v_status <> 'submitted') then
    return false;
  end if;
  begin
    perform public.app_require_pos_outlet_access(v_lodge, v_outlet);
  exception when others then
    return false;
  end;
  if v_role in ('manager','admin','super_admin','supervisor') then return true; end if;
  return v_role = 'cashier' and v_actor is not null and v_actor = v_cashier;
end;
$$;

revoke all on function public.pos_cashup_proof_storage_access(text, boolean) from public;
grant execute on function public.pos_cashup_proof_storage_access(text, boolean) to anon, authenticated, service_role;
drop policy if exists private_cashup_proofs_insert on storage.objects;
create policy private_cashup_proofs_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'private-cashup-proofs'
    and public.pos_cashup_proof_storage_access(name, true)
  );
drop policy if exists private_cashup_proofs_select on storage.objects;
create policy private_cashup_proofs_select on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'private-cashup-proofs'
    and public.pos_cashup_proof_storage_access(name, false)
  );
drop policy if exists private_cashup_proofs_delete on storage.objects;
-- Evidence is immutable.  There is intentionally no client DELETE policy.

create or replace function public.get_pos_void_reason_templates(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_rows jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  insert into public.pos_void_reason_templates (lodge_id, label, code, created_by)
  values
    (p_lodge_id, 'Duplicate sale', 'duplicate_sale', null),
    (p_lodge_id, 'Wrong item or quantity', 'wrong_item_or_quantity', null),
    (p_lodge_id, 'Guest cancellation', 'guest_cancellation', null),
    (p_lodge_id, 'Payment or tender error', 'payment_tender_error', null)
  on conflict (lodge_id, code) do nothing;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.label), '[]'::jsonb)
    into v_rows from public.pos_void_reason_templates t
   where t.lodge_id = p_lodge_id and t.active;
  return v_rows;
end;
$$;

create or replace function public.save_pos_void_reason_template(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge uuid := nullif(payload->>'lodge_id','')::uuid;
declare v_code text := lower(regexp_replace(coalesce(payload->>'code',''), '[^a-z0-9]+', '_', 'g'));
declare v_label text := nullif(btrim(payload->>'label'),'');
declare v_operation text := nullif(btrim(coalesce(payload->>'idempotency_key','')),'');
declare v_active boolean := case when lower(coalesce(payload->>'active','true')) = 'false' then false else true end;
declare v_hash text := encode(digest(jsonb_build_object('lodge_id',v_lodge,'code',v_code,'label',v_label,'active',v_active)::text,'sha256'),'hex');
declare v_row public.pos_void_reason_templates%rowtype;
declare v_operation_row public.pos_void_reason_template_operations%rowtype;
declare v_result jsonb;
begin
  if v_operation is null or length(v_operation) > 128 then
    return jsonb_build_object('success',false,'error','A stable template operation key (max 128 characters) is required.');
  end if;
  perform public.app_require_lodge_role(v_lodge, array['manager','admin','super_admin']);
  if v_code = '' or v_label is null or length(v_label) > 80 then
    return jsonb_build_object('success',false,'error','A short template label is required.');
  end if;
  perform pg_advisory_xact_lock(hashtext(v_lodge::text || ':' || v_operation));
  select * into v_operation_row
    from public.pos_void_reason_template_operations
   where lodge_id=v_lodge and operation_id=v_operation
   for update;
  if found then
    if v_operation_row.payload_hash is distinct from v_hash then
      return jsonb_build_object('success',false,'code','idempotency_conflict','error','This template key was already used for different values.');
    end if;
    return v_operation_row.result || jsonb_build_object('replayed',true);
  end if;
  insert into public.pos_void_reason_templates (lodge_id, code, label, active, created_by)
  values (v_lodge, v_code, v_label, v_active, public.app_current_user_id())
  on conflict (lodge_id, code) do update set label=excluded.label, active=excluded.active, updated_at=now()
  returning * into v_row;
  v_result := jsonb_build_object('success',true,'template',to_jsonb(v_row));
  insert into public.pos_void_reason_template_operations(lodge_id,operation_id,payload_hash,template_id,result)
  values(v_lodge,v_operation,v_hash,v_row.id,v_result);
  insert into public.pos_audit_log (lodge_id, actor_id, action, entity_type, entity_id, idempotency_key, details)
  values (v_lodge, public.app_current_user_id(), 'void_reason_template_saved', 'pos_void_reason_template', v_row.id,
          v_operation, jsonb_build_object('code',v_code,'label',v_label,'active',v_active));
  return v_result;
end;
$$;

create or replace function public.get_pos_shift_handover_notes(p_lodge_id uuid, p_shift_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_rows jsonb;
declare v_role text := lower(coalesce(public.app_current_role(),''));
declare v_actor uuid := public.app_current_user_id();
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  if p_shift_id is not null then
    perform public.app_require_pos_outlet_access(p_lodge_id, (select s.outlet_id from public.restaurant_shifts s where s.id=p_shift_id and s.lodge_id=p_lodge_id));
  end if;
  select coalesce(jsonb_agg(to_jsonb(n) order by n.created_at desc), '[]'::jsonb) into v_rows
    from public.pos_shift_handover_notes n
    join public.restaurant_shifts s on s.id=n.shift_id and s.lodge_id=n.lodge_id
   where n.lodge_id=p_lodge_id
     and (p_shift_id is null or n.shift_id=p_shift_id)
     and (v_role in ('supervisor','manager','admin','super_admin')
          or s.staff_user_id=v_actor)
     and (v_role in ('manager','admin','super_admin')
          or s.staff_user_id=v_actor
          or s.outlet_id = any(coalesce((select u.allowed_outlet_ids from public.users u where u.id=v_actor and u.lodge_id=p_lodge_id), '{}'::uuid[])));
  return v_rows;
end;
$$;

create or replace function public.upsert_pos_shift_handover_note(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge uuid := nullif(payload->>'lodge_id','')::uuid;
declare v_shift uuid := nullif(payload->>'shift_id','')::uuid;
declare v_operation text := nullif(btrim(coalesce(payload->>'operation_id','')),'');
declare v_note text := nullif(btrim(coalesce(payload->>'note','')),'');
declare v_actor uuid := public.app_current_user_id();
declare v_shift_row public.restaurant_shifts%rowtype;
declare v_row public.pos_shift_handover_notes%rowtype;
declare v_hash text := encode(digest(jsonb_build_object('lodge_id',v_lodge,'shift_id',v_shift,'note',v_note)::text,'sha256'),'hex');
begin
  if v_operation is null or length(v_operation) > 128 then raise exception 'A stable handover operation key (max 128 characters) is required.' using errcode='22023'; end if;
  if v_note is null or length(v_note) > 1000 then raise exception 'Handover note must contain 1 to 1000 characters.' using errcode='22023'; end if;
  perform public.app_require_lodge_role(v_lodge, array['cashier','supervisor','manager','admin','super_admin']);
  select * into v_shift_row from public.restaurant_shifts where id=v_shift and lodge_id=v_lodge and status='active' for update;
  if not found then return jsonb_build_object('success',false,'error','Only an active shift can receive a handover note.'); end if;
  perform public.app_require_pos_outlet_access(v_lodge, v_shift_row.outlet_id);
  if v_actor is distinct from v_shift_row.staff_user_id then
    perform public.app_require_lodge_role(v_lodge, array['supervisor','manager','admin','super_admin']);
  end if;
  select * into v_row from public.pos_shift_handover_notes where lodge_id=v_lodge and shift_id=v_shift and operation_id=v_operation;
  if found then
    if v_row.payload_hash is distinct from v_hash then return jsonb_build_object('success',false,'code','idempotency_conflict','error','This handover key was already used for different note text.'); end if;
    return jsonb_build_object('success',true,'note',to_jsonb(v_row),'replayed',true);
  end if;
  insert into public.pos_shift_handover_notes(lodge_id,shift_id,outlet_id,note,author_id,author_name,operation_id,payload_hash)
  values(v_lodge,v_shift,v_shift_row.outlet_id,v_note,v_actor,(select name from public.users where id=v_actor),v_operation,v_hash)
  returning * into v_row;
  insert into public.pos_audit_log(lodge_id,outlet_id,shift_id,actor_id,operator_id,action,entity_type,entity_id,idempotency_key,details)
  values(v_lodge,v_shift_row.outlet_id,v_shift,v_actor,v_shift_row.staff_user_id,'shift_handover_note_saved','pos_shift_handover_note',v_row.id,v_operation,jsonb_build_object('note_length',length(v_note)));
  return jsonb_build_object('success',true,'note',to_jsonb(v_row));
end;
$$;

create or replace function public.attach_pos_cashup_proof(payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_lodge uuid := nullif(payload->>'lodge_id','')::uuid;
declare v_submission uuid := nullif(payload->>'submission_id','')::uuid;
declare v_path text := nullif(payload->>'storage_path','');
declare v_key text := nullif(btrim(coalesce(payload->>'idempotency_key','')),'');
declare v_file_name text := nullif(btrim(coalesce(payload->>'file_name','')),'');
declare v_mime text := lower(nullif(btrim(coalesce(payload->>'mime_type','')),''));
declare v_sha text := lower(nullif(btrim(coalesce(payload->>'sha256','')),''));
declare v_bytes bigint;
declare v_object_mime text;
declare v_object_size bigint;
declare v_object_size_text text;
declare v_hash text;
declare v_row public.pos_cashup_submissions%rowtype;
declare v_attachment public.pos_cashup_proof_attachments%rowtype;
declare v_outlet uuid;
begin
  if v_key is null or length(v_key) > 128 then raise exception 'A stable proof attachment key (max 128 characters) is required.' using errcode='22023'; end if;
  if v_file_name is null or length(v_file_name) > 120 or v_file_name ~ '[\\/]' then return jsonb_build_object('success',false,'error','The proof file name is invalid.'); end if;
  if v_mime not in ('application/pdf','image/jpeg','image/png') then return jsonb_build_object('success',false,'error','Only PDF, JPEG, or PNG proof files are accepted.'); end if;
  if v_sha is null or v_sha !~ '^[a-f0-9]{64}$' then return jsonb_build_object('success',false,'error','A SHA-256 proof hash is required.'); end if;
  if coalesce(payload->>'byte_count','') !~ '^[0-9]+$' then return jsonb_build_object('success',false,'error','Proof file size is invalid.'); end if;
  v_bytes := (payload->>'byte_count')::bigint;
  if v_bytes <= 0 or v_bytes > 8388608 then return jsonb_build_object('success',false,'error','Proof file size is invalid.'); end if;
  perform public.app_require_lodge_role(v_lodge, array['cashier','supervisor','manager','admin','super_admin']);
  select * into v_row from public.pos_cashup_submissions where id=v_submission and lodge_id=v_lodge for update;
  if not found then return jsonb_build_object('success',false,'error','Cash-up submission not found in this lodge.'); end if;
  if v_row.status <> 'submitted' then return jsonb_build_object('success',false,'error','A proof can only be attached before cash-up approval.'); end if;
  v_outlet := v_row.outlet_id;
  perform public.app_require_pos_outlet_access(v_lodge, v_outlet);
  if public.app_current_user_id() is distinct from v_row.cashier_id then
    perform public.app_require_lodge_role(v_lodge, array['supervisor','manager','admin','super_admin']);
  end if;
  if v_path is null or v_path !~ ('^'||v_lodge::text||'/cashups/'||v_submission::text||'/[a-f0-9-]+\.(pdf|jpg|jpeg|png)$') then
    return jsonb_build_object('success',false,'error','The proof storage path is not a valid lodge/cash-up object.');
  end if;
  v_hash := encode(digest(jsonb_build_object('lodge_id',v_lodge,'submission_id',v_submission,'storage_path',v_path,'file_name',v_file_name,'mime_type',v_mime,'byte_count',v_bytes,'sha256',v_sha)::text,'sha256'),'hex');
  select * into v_attachment from public.pos_cashup_proof_attachments where lodge_id=v_lodge and submission_id=v_submission and idempotency_key=v_key;
  if found then
    if v_attachment.payload_hash is distinct from v_hash then return jsonb_build_object('success',false,'code','idempotency_conflict','error','This proof key was already used for a different file.'); end if;
    return jsonb_build_object('success',true,'attachment',to_jsonb(v_attachment),'replayed',true);
  end if;
  if exists(select 1 from public.pos_cashup_proof_attachments where storage_bucket='private-cashup-proofs' and storage_path=v_path) then
    return jsonb_build_object('success',false,'error','This durable proof object is already registered.');
  end if;
  select o.metadata->>'mimetype', o.metadata->>'size'
    into v_object_mime, v_object_size_text
    from storage.objects o
   where o.bucket_id='private-cashup-proofs' and o.name=v_path;
  if not found then return jsonb_build_object('success',false,'error','The durable proof upload could not be confirmed.'); end if;
  if lower(coalesce(v_object_mime,'')) <> v_mime or coalesce(v_object_size_text,'') !~ '^[0-9]+$' then
    return jsonb_build_object('success',false,'error','The durable proof metadata did not match the uploaded file.');
  end if;
  v_object_size := v_object_size_text::bigint;
  if v_object_size <> v_bytes or v_object_size <= 0 or v_object_size > 8388608 then
    return jsonb_build_object('success',false,'error','The durable proof size did not match the uploaded file.');
  end if;
  insert into public.pos_cashup_proof_attachments(lodge_id,outlet_id,submission_id,storage_path,file_name,mime_type,byte_count,sha256,idempotency_key,uploaded_by,payload_hash)
  values(v_lodge,v_outlet,v_submission,v_path,v_file_name,v_mime,v_bytes,v_sha,v_key,public.app_current_user_id(),v_hash)
  returning * into v_attachment;
  insert into public.pos_audit_log(lodge_id,outlet_id,shift_id,actor_id,operator_id,action,entity_type,entity_id,idempotency_key,details)
  values(v_lodge,v_outlet,v_row.shift_id,public.app_current_user_id(),v_row.cashier_id,'cashup_proof_attached','pos_cashup_proof_attachment',v_attachment.id,v_key,jsonb_build_object('sha256',v_attachment.sha256,'byte_count',v_attachment.byte_count,'storage_bucket',v_attachment.storage_bucket));
  return jsonb_build_object('success',true,'attachment',to_jsonb(v_attachment));
end;
$$;

-- Returns only scoped immutable metadata.  A caller must still request a
-- short-lived signed read through the main process; no permanent/public URL
-- is stored or returned as evidence.
create or replace function public.get_pos_cashup_proof_attachments(p_lodge_id uuid, p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_row public.pos_cashup_submissions%rowtype;
declare v_role text := lower(coalesce(public.app_current_role(),''));
declare v_actor uuid := public.app_current_user_id();
declare v_rows jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['cashier','supervisor','manager','admin','super_admin']);
  select * into v_row from public.pos_cashup_submissions where id=p_submission_id and lodge_id=p_lodge_id;
  if not found then return jsonb_build_object('success',false,'error','Cash-up submission not found in this lodge.'); end if;
  perform public.app_require_pos_outlet_access(p_lodge_id, v_row.outlet_id);
  if v_actor is distinct from v_row.cashier_id then
    perform public.app_require_lodge_role(p_lodge_id, array['supervisor','manager','admin','super_admin']);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'file_name',a.file_name,'mime_type',a.mime_type,'byte_count',a.byte_count,'sha256',a.sha256,'created_at',a.created_at,'storage_bucket',a.storage_bucket,'storage_path',a.storage_path) order by a.created_at desc),'[]'::jsonb)
    into v_rows from public.pos_cashup_proof_attachments a
   where a.lodge_id=p_lodge_id and a.submission_id=p_submission_id;
  return jsonb_build_object('success',true,'attachments',v_rows);
end;
$$;

-- Idempotent, auditable ticket status transitions for board actions.
create or replace function public.update_pos_prep_ticket_status(
  p_ticket_id uuid, p_status text, p_lodge_id uuid, p_operation_id text
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_status text := lower(coalesce(nullif(p_status,''),'new'));
declare v_row public.pos_prep_tickets%rowtype;
declare v_before public.pos_prep_tickets%rowtype;
declare v_result jsonb;
declare v_hash text := encode(digest(jsonb_build_object('lodge_id',p_lodge_id,'ticket_id',p_ticket_id,'status',v_status)::text,'sha256'),'hex');
declare v_existing public.pos_ticket_status_operations%rowtype;
begin
  perform public.app_require_lodge_role(p_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
  if p_operation_id is null or btrim(p_operation_id)='' or length(p_operation_id) > 128 then return jsonb_build_object('success',false,'error','A stable ticket operation key (max 128 characters) is required.'); end if;
  if v_status not in ('new','preparing','ready','served','cancelled') then return jsonb_build_object('success',false,'error','Invalid prep ticket status.'); end if;
  select * into v_before from public.pos_prep_tickets where id=p_ticket_id and lodge_id=p_lodge_id for update;
  if not found then return jsonb_build_object('success',false,'error','Prep ticket not found.'); end if;
  perform public.app_require_pos_outlet_access(p_lodge_id, v_before.outlet_id);
  select * into v_existing from public.pos_ticket_status_operations where lodge_id=p_lodge_id and ticket_id=p_ticket_id and operation_id=p_operation_id for update;
  if found then
    if v_existing.payload_hash is distinct from v_hash then return jsonb_build_object('success',false,'code','idempotency_conflict','error','This ticket operation key was already used for another status.'); end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;
  if v_before.status = v_status then
    v_row := v_before;
  elsif v_before.status in ('new','pending') and v_status in ('preparing','cancelled') then
    update public.pos_prep_tickets set status=v_status, updated_at=now() where id=p_ticket_id and lodge_id=p_lodge_id returning * into v_row;
  elsif v_before.status = 'preparing' and v_status in ('ready','cancelled') then
    update public.pos_prep_tickets set status=v_status, updated_at=now() where id=p_ticket_id and lodge_id=p_lodge_id returning * into v_row;
  elsif v_before.status = 'ready' and v_status in ('served','cancelled') then
    update public.pos_prep_tickets set status=v_status, updated_at=now() where id=p_ticket_id and lodge_id=p_lodge_id returning * into v_row;
  else
    return jsonb_build_object('success',false,'code','invalid_transition','error','Ticket status can only move forward; served and cancelled tickets are terminal.');
  end if;
  v_result := jsonb_build_object('success',true,'ticket',to_jsonb(v_row));
  insert into public.pos_ticket_status_operations(lodge_id,ticket_id,operation_id,payload_hash,status,result) values(p_lodge_id,p_ticket_id,p_operation_id,v_hash,v_status,v_result);
  insert into public.pos_audit_log(lodge_id,outlet_id,actor_id,action,entity_type,entity_id,idempotency_key,details) values(p_lodge_id,v_row.outlet_id,public.app_current_user_id(),'ticket_status_updated','pos_ticket',p_ticket_id,p_operation_id,jsonb_build_object('before_status',v_before.status,'after_status',v_status));
  return v_result;
end;
$$;

-- Bar-specific DTO; the shared attendance contract remains unchanged for
-- kiosk, cash-up, and My Shift surfaces.
create or replace function public.get_pos_bar_active_shifts(p_lodge_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_role text := lower(coalesce(public.app_current_role(),''));
declare v_actor uuid := public.app_current_user_id();
begin
  perform public.app_require_lodge_role(p_lodge_id,array['cashier','supervisor','manager','admin','super_admin']);
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'staff_user_id',s.staff_user_id,'staff_name',s.staff_name,'role',s.role,'clock_in',s.clock_in,'expected_hours',s.expected_hours,'status',s.status,'outlet_id',s.outlet_id,'handover_notes',coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from public.pos_shift_handover_notes n where n.lodge_id=p_lodge_id and n.shift_id=s.id),'[]'::jsonb)) order by s.clock_in desc)
    from public.restaurant_shifts s
   where s.lodge_id=p_lodge_id and s.status='active'
     and (v_role in ('manager','admin','super_admin')
          or s.staff_user_id=v_actor
          or s.outlet_id = any(coalesce((select u.allowed_outlet_ids from public.users u where u.id=v_actor and u.lodge_id=p_lodge_id), '{}'::uuid[])))
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.get_pos_void_reason_templates(uuid), public.save_pos_void_reason_template(jsonb), public.get_pos_shift_handover_notes(uuid,uuid), public.upsert_pos_shift_handover_note(jsonb), public.attach_pos_cashup_proof(jsonb), public.get_pos_cashup_proof_attachments(uuid,uuid), public.update_pos_prep_ticket_status(uuid,text,uuid,text), public.get_pos_bar_active_shifts(uuid) from public;
grant execute on function public.get_pos_void_reason_templates(uuid), public.get_pos_shift_handover_notes(uuid,uuid), public.attach_pos_cashup_proof(jsonb), public.get_pos_cashup_proof_attachments(uuid,uuid), public.update_pos_prep_ticket_status(uuid,text,uuid,text), public.get_pos_bar_active_shifts(uuid) to anon, authenticated, service_role;
grant execute on function public.save_pos_void_reason_template(jsonb), public.upsert_pos_shift_handover_note(jsonb) to anon, authenticated, service_role;

-- The legacy three-argument ticket RPC had no outlet, transition, or retry
-- guard.  Every desktop, PWA, and Legacy POS caller now supplies the stable
-- operation key to the guarded contract, so remove the bypass.
revoke all on function public.update_pos_prep_ticket_status(uuid,text,uuid) from public, anon, authenticated, service_role;
drop function if exists public.update_pos_prep_ticket_status(uuid,text,uuid);

commit;

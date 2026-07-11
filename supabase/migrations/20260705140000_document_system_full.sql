-- Document System: templates, rendering, and document lifecycle.
-- Enhances existing enterprise_documents table with templating infrastructure.

-- ── 1. Document Templates ─────────────────────────────────────────────────────
create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null references public.settings(lodge_id) on delete cascade,
  template_key text not null,
  name text not null,
  document_type text not null check (document_type in ('folio', 'invoice', 'registration_card', 'statement', 'receipt', 'contract', 'cancellation_note')),
  content_template jsonb not null default '{}'::jsonb,
  variables jsonb default '[]'::jsonb,
  branding jsonb default '{}'::jsonb,
  numbering_prefix text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, template_key)
);

alter table public.document_templates enable row level security;

create policy document_templates_lodge_policy on public.document_templates
  using (public.app_lodge_access(lodge_id));

grant select on public.document_templates to authenticated;
revoke insert, update, delete on public.document_templates from authenticated, anon;

create index if not exists document_templates_lodge_type_idx on public.document_templates (lodge_id, document_type);

-- ── 2. Enterprise Documents Enhancements ──────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'enterprise_documents' and column_name = 'template_key') then
    alter table public.enterprise_documents add column template_key text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'enterprise_documents' and column_name = 'rendered_content') then
    alter table public.enterprise_documents add column rendered_content jsonb default '{}'::jsonb;
  end if;
end $$;

-- ── 3. RPCs ───────────────────────────────────────────────────────────────────

-- Create document template
create or replace function public.create_document_template(
  p_lodge_id uuid,
  p_template_key text,
  p_name text,
  p_document_type text,
  p_content_template jsonb default '{}'::jsonb,
  p_variables jsonb default '[]'::jsonb,
  p_branding jsonb default '{}'::jsonb,
  p_numbering_prefix text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  insert into public.document_templates (
    lodge_id, template_key, name, document_type,
    content_template, variables, branding, numbering_prefix, active
  )
  values (
    p_lodge_id, p_template_key, p_name, p_document_type,
    p_content_template, p_variables, p_branding, p_numbering_prefix, true
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'template_id', v_id);
end;
$$;

grant execute on function public.create_document_template(uuid, text, text, text, jsonb, jsonb, jsonb, text) to authenticated;

-- Update document template
create or replace function public.update_document_template(
  p_lodge_id uuid,
  p_template_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.document_templates
  set
    name = coalesce(nullif(p_payload->>'name', ''), name),
    content_template = coalesce(nullif(p_payload->>'content_template', '')::jsonb, content_template),
    variables = coalesce(nullif(p_payload->>'variables', '')::jsonb, variables),
    branding = coalesce(nullif(p_payload->>'branding', '')::jsonb, branding),
    numbering_prefix = coalesce(nullif(p_payload->>'numbering_prefix', ''), numbering_prefix),
    active = coalesce((p_payload->>'active')::boolean, active),
    updated_at = now()
  where id = p_template_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Template not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_document_template(uuid, uuid, jsonb) to authenticated;

-- Delete document template
create or replace function public.delete_document_template(
  p_lodge_id uuid,
  p_template_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  delete from public.document_templates
  where id = p_template_id and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Template not found');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.delete_document_template(uuid, uuid) to authenticated;

-- Render document
create or replace function public.render_document(
  p_template_key text,
  p_lodge_id uuid,
  p_subject_type text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template record;
  v_document_id uuid;
  v_document_number text;
  v_rendered jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select * into v_template
  from public.document_templates
  where template_key = p_template_key and lodge_id = p_lodge_id and active = true;

  if v_template is null then
    return jsonb_build_object('success', false, 'error', 'Active template not found');
  end if;

  v_document_number := coalesce(
    v_template.numbering_prefix || '-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(nextval('public.seq_document_number'::regclass)::text, 4, '0'),
    upper(v_template.document_type) || '-' || to_char(now(), 'YYYYMMDDHH24MISS')
  );

  v_rendered := jsonb_build_object(
    'template_key', p_template_key,
    'document_type', v_template.document_type,
    'document_number', v_document_number,
    'subject_type', p_subject_type,
    'subject_id', p_subject_id,
    'content', v_template.content_template,
    'branding', v_template.branding,
    'rendered_at', now()
  );

  insert into public.enterprise_documents (
    lodge_id, document_type, subject_type, subject_id,
    document_number, template_key, status, payload, rendered_content
  )
  values (
    p_lodge_id, v_template.document_type, p_subject_type, p_subject_id,
    v_document_number, p_template_key, 'draft', '{}'::jsonb, v_rendered
  )
  returning id into v_document_id;

  return jsonb_build_object(
    'success', true,
    'document_id', v_document_id,
    'document_number', v_document_number,
    'rendered', v_rendered
  );
end;
$$;

grant execute on function public.render_document(text, uuid, text, uuid) to authenticated;

-- Publish document
create or replace function public.publish_document(
  p_document_id uuid,
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  update public.enterprise_documents
  set status = 'final', updated_at = now()
  where id = p_document_id and lodge_id = p_lodge_id and status = 'draft';

  if not found then
    return jsonb_build_object('success', false, 'error', 'Document not found or not in draft status');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.publish_document(uuid, uuid) to authenticated;

-- Get document history
create or replace function public.get_document_history(
  p_lodge_id uuid,
  p_subject_type text,
  p_subject_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_documents jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select jsonb_agg(jsonb_build_object(
    'id', ed.id,
    'document_type', ed.document_type,
    'document_number', ed.document_number,
    'template_key', ed.template_key,
    'status', ed.status,
    'rendered_content', ed.rendered_content,
    'created_at', ed.created_at,
    'updated_at', ed.updated_at
  ) order by ed.created_at desc) into v_documents
  from public.enterprise_documents ed
  where ed.lodge_id = p_lodge_id
    and ed.subject_type = p_subject_type
    and ed.subject_id = p_subject_id;

  return coalesce(v_documents, '[]'::jsonb);
end;
$$;

grant execute on function public.get_document_history(uuid, text, uuid) to authenticated;

-- Get document dashboard
create or replace function public.get_document_dashboard(
  p_lodge_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent jsonb;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['owner', 'admin', 'manager', 'super_admin']);

  select jsonb_agg(jsonb_build_object(
    'id', ed.id,
    'document_type', ed.document_type,
    'document_number', ed.document_number,
    'template_key', ed.template_key,
    'status', ed.status,
    'created_at', ed.created_at
  ) order by ed.created_at desc) into v_recent
  from public.enterprise_documents ed
  where ed.lodge_id = p_lodge_id
  limit 50;

  return jsonb_build_object(
    'recent_documents', coalesce(v_recent, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_document_dashboard(uuid) to authenticated;

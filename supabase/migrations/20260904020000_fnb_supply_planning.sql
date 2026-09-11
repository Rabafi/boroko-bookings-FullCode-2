-- F&B Phases 4-5: food-safety controls, supplier invoice three-way matching,
-- and occupancy-driven demand / prep planning.
--
-- - Food-safety evidence is immutable: logs and corrective actions are only
--   appended; corrective actions close explicitly with actor + note.
-- - Three-way matching compares ordered / received / invoiced quantities with
--   variance approval and an explicit accounting-handoff flag. It never posts
--   financial ledgers directly; handoff is a traceable handover to the
--   canonical expense/accounting workflow.
-- - Demand recommendations are read-only and advisory. Creating prep batches
--   or draft purchase orders always requires an explicit approval RPC with a
--   stable operation ID. Freshness, confidence, source, and exceptions are
--   returned so the UI can label estimates honestly.

begin;

-- ── Food safety ───────────────────────────────────────────────────────────
create table if not exists public.fnb_food_safety_templates (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  name text not null,
  check_type text not null default 'temperature',
  min_temp_c numeric,
  max_temp_c numeric,
  frequency text,
  is_active boolean not null default true,
  operation_id text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fnb_food_safety_template_operation_uidx
  on public.fnb_food_safety_templates (lodge_id, operation_id);

alter table public.fnb_food_safety_templates enable row level security;
revoke all on table public.fnb_food_safety_templates from public, anon, authenticated;
grant select, insert, update, delete on table public.fnb_food_safety_templates to service_role;

create table if not exists public.fnb_temperature_logs (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  template_id uuid references public.fnb_food_safety_templates(id) on delete set null,
  location_label text not null,
  temp_c numeric not null,
  recorded_at timestamptz not null default now(),
  within_range boolean not null default true,
  notes text,
  operation_id text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists fnb_temperature_log_operation_uidx
  on public.fnb_temperature_logs (lodge_id, operation_id);
create index if not exists fnb_temperature_log_lodge_idx
  on public.fnb_temperature_logs (lodge_id, recorded_at desc);

alter table public.fnb_temperature_logs enable row level security;
revoke all on table public.fnb_temperature_logs from public, anon, authenticated;
grant select, insert on table public.fnb_temperature_logs to service_role;

alter table public.fnb_temperature_logs
  add column if not exists payload_hash text;

create table if not exists public.fnb_corrective_actions (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  temperature_log_id uuid references public.fnb_temperature_logs(id) on delete set null,
  title text not null,
  detail text,
  status text not null default 'open',
  closed_by uuid,
  closed_at timestamptz,
  close_note text,
  operation_id text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint fnb_corrective_status_check check (status in ('open','in_progress','closed'))
);

create unique index if not exists fnb_corrective_operation_uidx
  on public.fnb_corrective_actions (lodge_id, operation_id);
create index if not exists fnb_corrective_status_idx
  on public.fnb_corrective_actions (lodge_id, status);

alter table public.fnb_corrective_actions enable row level security;
revoke all on table public.fnb_corrective_actions from public, anon, authenticated;
grant select, insert, update on table public.fnb_corrective_actions to service_role;

create table if not exists public.fnb_allergen_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  matrix_version text not null,
  acknowledged_by uuid not null,
  acknowledged_at timestamptz not null default now(),
  operation_id text not null
);

create unique index if not exists fnb_allergen_ack_operation_uidx
  on public.fnb_allergen_acknowledgements (lodge_id, operation_id);

alter table public.fnb_allergen_acknowledgements enable row level security;
revoke all on table public.fnb_allergen_acknowledgements from public, anon, authenticated;
grant select, insert on table public.fnb_allergen_acknowledgements to service_role;

-- ── Supplier invoice three-way matching ───────────────────────────────────
create table if not exists public.fnb_supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  supplier_id uuid,
  purchase_order_id uuid,
  supplier_name text not null,
  invoice_number text not null,
  invoice_date date,
  status text not null default 'draft',
  variance_approved boolean not null default false,
  variance_approved_by uuid,
  accounting_handed_off boolean not null default false,
  accounting_handed_off_at timestamptz,
  expense_id uuid,
  operation_id text not null,
  payload_hash text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fnb_supplier_invoice_status_check check (
    status in ('draft','pending_approval','approved','voided','handed_off')
  )
);

-- Hardening columns for real three-way matching (supplier + PO linkage,
-- authoritative ordered quantities, replay-conflict detection, canonical
-- expense linkage). IF NOT EXISTS keeps this restart-safe.
alter table public.fnb_supplier_invoices
  add column if not exists supplier_id uuid,
  add column if not exists purchase_order_id uuid,
  add column if not exists expense_id uuid,
  add column if not exists payload_hash text;

create unique index if not exists fnb_supplier_invoice_number_uidx
  on public.fnb_supplier_invoices (lodge_id, supplier_name, invoice_number);
create unique index if not exists fnb_supplier_invoice_operation_uidx
  on public.fnb_supplier_invoices (lodge_id, operation_id);

alter table public.fnb_supplier_invoices enable row level security;
revoke all on table public.fnb_supplier_invoices from public, anon, authenticated;
grant select, insert, update on table public.fnb_supplier_invoices to service_role;

create table if not exists public.fnb_supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.fnb_supplier_invoices(id) on delete cascade,
  lodge_id uuid not null,
  inventory_item_id uuid,
  item_name text not null,
  ordered_qty numeric not null default 0,
  received_qty numeric not null default 0,
  invoiced_qty numeric not null default 0,
  unit_cost numeric not null default 0,
  invoiced_unit_cost numeric not null default 0,
  operation_id text not null
);

alter table public.fnb_supplier_invoice_lines
  add column if not exists inventory_item_id uuid,
  add column if not exists invoiced_unit_cost numeric not null default 0;

create unique index if not exists fnb_supplier_invoice_line_operation_uidx
  on public.fnb_supplier_invoice_lines (invoice_id, operation_id);

alter table public.fnb_supplier_invoice_lines enable row level security;
revoke all on table public.fnb_supplier_invoice_lines from public, anon, authenticated;
grant select, insert, update on table public.fnb_supplier_invoice_lines to service_role;

-- ── Demand approvals (explicit approval → prep/PO draft request) ──────────
create table if not exists public.fnb_demand_approvals (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  outlet_id uuid,
  recommendation_key text not null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  approved_by uuid,
  operation_id text not null,
  created_at timestamptz not null default now(),
  constraint fnb_demand_approval_action_check check (action in ('prep_batch','draft_purchase_order'))
);

create unique index if not exists fnb_demand_approval_operation_uidx
  on public.fnb_demand_approvals (lodge_id, operation_id);

alter table public.fnb_demand_approvals enable row level security;
revoke all on table public.fnb_demand_approvals from public, anon, authenticated;
grant select, insert on table public.fnb_demand_approvals to service_role;

alter table public.fnb_demand_approvals
  add column if not exists payload_hash text;

-- ── Food-safety write contracts ───────────────────────────────────────────
create or replace function public.create_fnb_temperature_log(
  p_lodge_id uuid,
  p_payload jsonb,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_role text := '';
  v_module_denial text;
  v_outlet_denial text;
  v_existing public.fnb_temperature_logs%rowtype;
  v_row public.fnb_temperature_logs%rowtype;
  v_template public.fnb_food_safety_templates%rowtype;
  v_template_id uuid;
  v_outlet uuid;
  v_temp numeric;
  v_within boolean := true;
  v_range_checked boolean := false;
  v_hash text;
begin
  if p_operation_id is null or btrim(p_operation_id) = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A stable operation ID is required.');
  end if;
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  v_module_denial := public._fnb_require_module(v_lodge, 'food-safety');
  if v_module_denial is not null then
    return jsonb_build_object('success', false, 'code', v_module_denial,
      'error', case v_module_denial
        when 'MODULE_DISABLED' then 'Food safety is currently disabled. An administrator can enable it in Food & Beverage → More tools.'
        when 'ENTITLEMENT_UNVERIFIED' then 'The licence for food safety could not be verified. Reconnect and retry.'
        else 'This lodge does not include food safety. Request access to use it.' end);
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot record food-safety checks.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_lodge limit 1;

  begin v_temp := (p_payload->>'temp_c')::numeric; exception when others then v_temp := null; end;
  if v_temp is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A temperature reading is required.');
  end if;
  if v_temp < -50 or v_temp > 150 then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'That reading is outside any plausible food range (-50 to 150°C). Check the probe and retry.');
  end if;
  if coalesce(btrim(p_payload->>'location_label'), '') = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A location label is required.');
  end if;
  begin v_outlet := nullif(p_payload->>'outlet_id', '')::uuid; exception when others then v_outlet := null; end;
  v_outlet_denial := public._fnb_require_outlet(v_lodge, v_user, v_outlet);
  if v_outlet_denial is not null then
    return jsonb_build_object('success', false, 'code', v_outlet_denial, 'error', 'That outlet is not available to you in this lodge.');
  end if;

  -- Template is required: without a range there is nothing to check against,
  -- so template-less "within range" readings are rejected as unevidenced.
  begin v_template_id := nullif(p_payload->>'template_id', '')::uuid; exception when others then v_template_id := null; end;
  if v_template_id is null then
    return jsonb_build_object('success', false, 'code', 'TEMPLATE_REQUIRED', 'error', 'Choose a check template so the reading is evaluated against its range.');
  end if;
  select * into v_template from public.fnb_food_safety_templates
   where id = v_template_id and lodge_id = v_lodge and coalesce(is_active, true) = true limit 1;
  if not found then
    return jsonb_build_object('success', false, 'code', 'TEMPLATE_UNKNOWN', 'error', 'That check template does not exist in this lodge.');
  end if;
  if v_template.min_temp_c is not null and v_temp < v_template.min_temp_c then v_within := false; end if;
  if v_template.max_temp_c is not null and v_temp > v_template.max_temp_c then v_within := false; end if;
  v_range_checked := (v_template.min_temp_c is not null or v_template.max_temp_c is not null);

  v_hash := md5(coalesce(v_lodge::text, '') || '|' || coalesce(v_outlet::text, '') || '|' ||
    v_template.id::text || '|' || btrim(p_payload->>'location_label') || '|' || v_temp::text);

  select * into v_existing from public.fnb_temperature_logs where lodge_id = v_lodge and operation_id = p_operation_id limit 1;
  if found then
    if coalesce(v_existing.payload_hash, '') <> '' and v_existing.payload_hash <> v_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT',
        'error', 'This operation ID was already used with a different reading. Use a new operation ID.');
    end if;
    return jsonb_build_object('success', true, 'replayed', true, 'log', to_jsonb(v_existing));
  end if;

  insert into public.fnb_temperature_logs (lodge_id, outlet_id, template_id, location_label, temp_c, recorded_at, within_range, notes, operation_id, created_by, payload_hash)
  values (
    v_lodge, v_outlet, v_template.id,
    btrim(p_payload->>'location_label'), v_temp,
    coalesce(nullif(p_payload->>'recorded_at', '')::timestamptz, now()),
    v_within,
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''),
    p_operation_id, v_user, v_hash
  ) returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_lodge, 'temperature_log', v_row.id, case when v_within then 'logged_in_range' else 'logged_out_of_range' end, v_user, nullif(v_role, ''), to_jsonb(v_row), p_operation_id);

  -- Out-of-range readings open a corrective action automatically so nothing
  -- unsafe disappears silently. The action must be closed explicitly.
  if not v_within then
    insert into public.fnb_corrective_actions (lodge_id, outlet_id, temperature_log_id, title, detail, status, operation_id, created_by)
    values (v_lodge, v_outlet, v_row.id, 'Out-of-range temperature at ' || v_row.location_label,
      format('Recorded %s°C at %s (template %s). Investigate cold-chain and record the outcome.', v_temp, v_row.location_label, v_template.name),
      'open', p_operation_id || ':corrective', v_user)
    on conflict (lodge_id, operation_id) do nothing;
  end if;

  return jsonb_build_object('success', true, 'replayed', false, 'log', to_jsonb(v_row),
    'within_range', v_within, 'range_checked', v_range_checked, 'template', v_template.name);
end;
$$;

revoke all on function public.create_fnb_temperature_log(uuid, jsonb, text) from public;
grant execute on function public.create_fnb_temperature_log(uuid, jsonb, text) to anon, authenticated, service_role;

create or replace function public.close_fnb_corrective_action(
  p_action_id uuid,
  p_close_note text,
  p_operation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.fnb_corrective_actions%rowtype;
  v_user uuid;
  v_session public.app_sessions%rowtype;
  v_auth uuid;
  v_role text := '';
  v_outlet_denial text;
begin
  if p_action_id is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A corrective-action ID is required.');
  end if;
  if coalesce(btrim(p_close_note), '') = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A close-out note is required as audit evidence.');
  end if;
  select * into v_row from public.fnb_corrective_actions where id = p_action_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Corrective action not found.');
  end if;
  if not public.app_lodge_access(v_row.lodge_id) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  select * into v_session from public.app_current_session_row();
  if v_session.id is not null then
    v_user := v_session.user_id;
  else
    begin v_auth := public.app_authenticated_user_id(); exception when undefined_function then v_auth := null; end;
    if v_auth is not null then
      select u.id into v_user from public.users u where u.auth_user_id = v_auth and u.lodge_id = v_row.lodge_id and coalesce(u.status,'active')='active' limit 1;
    end if;
  end if;
  if v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_row.lodge_id limit 1;
  if v_role not in ('manager','admin','owner','super_admin','administrator','supervisor') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Closing a corrective action requires a supervisor or above.');
  end if;
  -- Close-out is handover continuity (not new work): no module gate, but the
  -- actor must still be scoped to the action's outlet.
  v_outlet_denial := public._fnb_require_outlet(v_row.lodge_id, v_user, v_row.outlet_id);
  if v_outlet_denial is not null then
    return jsonb_build_object('success', false, 'code', v_outlet_denial, 'error', 'That corrective action belongs to an outlet you cannot serve.');
  end if;
  if v_row.status = 'closed' then
    return jsonb_build_object('success', true, 'already_closed', true, 'action', to_jsonb(v_row));
  end if;

  update public.fnb_corrective_actions
     set status = 'closed', closed_by = v_user, closed_at = now(), close_note = btrim(p_close_note)
   where id = p_action_id
  returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_row.lodge_id, 'corrective_action', v_row.id, 'closed', v_user, nullif(v_role, ''), to_jsonb(v_row), p_operation_id);

  return jsonb_build_object('success', true, 'action', to_jsonb(v_row));
end;
$$;

revoke all on function public.close_fnb_corrective_action(uuid, text, text) from public;
grant execute on function public.close_fnb_corrective_action(uuid, text, text) to anon, authenticated, service_role;

-- ── Invoice matching contracts ────────────────────────────────────────────
create or replace function public.capture_fnb_supplier_invoice(
  p_lodge_id uuid,
  p_payload jsonb,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_role text := '';
  v_module_denial text;
  v_outlet_denial text;
  v_existing public.fnb_supplier_invoices%rowtype;
  v_row public.fnb_supplier_invoices%rowtype;
  v_lines jsonb;
  v_line jsonb;
  v_outlet uuid;
  v_supplier uuid;
  v_po uuid;
  v_po_supplier uuid;
  v_po_lodge uuid;
  v_po_status text := '';
  v_supplier_name text;
  v_item_id uuid;
  v_item_name text;
  v_po_qty numeric;
  v_po_cost numeric;
  v_received numeric;
  v_invoiced numeric;
  v_invoiced_cost numeric;
  v_inv_lodge uuid;
  v_outcome text := 'draft';
  v_hash text;
  v_seen uuid[] := '{}';
begin
  if p_operation_id is null or btrim(p_operation_id) = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A stable operation ID is required.');
  end if;
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  v_module_denial := public._fnb_require_module(v_lodge, 'invoice-matching');
  if v_module_denial is not null then
    return jsonb_build_object('success', false, 'code', v_module_denial,
      'error', case v_module_denial
        when 'MODULE_DISABLED' then 'Invoice matching is currently disabled. An administrator can enable it in Food & Beverage → More tools.'
        when 'ENTITLEMENT_UNVERIFIED' then 'The licence for invoice matching could not be verified. Reconnect and retry.'
        else 'This lodge does not include invoice matching. Request access to use it.' end);
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'inventory.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot capture supplier invoices.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_lodge limit 1;

  begin v_outlet := nullif(p_payload->>'outlet_id', '')::uuid; exception when others then v_outlet := null; end;
  v_outlet_denial := public._fnb_require_outlet(v_lodge, v_user, v_outlet);
  if v_outlet_denial is not null then
    return jsonb_build_object('success', false, 'code', v_outlet_denial, 'error', 'That outlet is not available to you in this lodge.');
  end if;

  -- Real three-way linkage: the supplier and purchase order are resolved
  -- server-side and must both belong to this lodge. Ordered quantities and
  -- prices come from the authoritative PO lines — never from the client.
  begin v_supplier := nullif(p_payload->>'supplier_id', '')::uuid; exception when others then v_supplier := null; end;
  begin v_po := nullif(p_payload->>'purchase_order_id', '')::uuid; exception when others then v_po := null; end;
  if v_supplier is null then
    return jsonb_build_object('success', false, 'code', 'SUPPLIER_REQUIRED', 'error', 'Choose a supplier from the lodge supplier list.');
  end if;
  if v_po is null then
    return jsonb_build_object('success', false, 'code', 'PURCHASE_ORDER_REQUIRED', 'error', 'Choose the purchase order this invoice claims against.');
  end if;
  select name into v_supplier_name from public.restaurant_suppliers where id = v_supplier and lodge_id = v_lodge limit 1;
  if not found then
    return jsonb_build_object('success', false, 'code', 'SUPPLIER_SCOPE_DENIED', 'error', 'That supplier does not belong to this lodge.');
  end if;
  begin
    select lodge_id, supplier_id, lower(coalesce(status, ''))
      into v_po_lodge, v_po_supplier, v_po_status
      from public.restaurant_purchase_orders where id = v_po limit 1;
  exception when undefined_table then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Purchase orders are unavailable in this database.');
  end;
  if not found or v_po_lodge is distinct from v_lodge then
    return jsonb_build_object('success', false, 'code', 'PURCHASE_ORDER_SCOPE_DENIED', 'error', 'That purchase order does not belong to this lodge.');
  end if;
  if v_po_supplier is distinct from v_supplier then
    return jsonb_build_object('success', false, 'code', 'SUPPLIER_MISMATCH', 'error', 'That purchase order belongs to a different supplier.');
  end if;

  if coalesce(btrim(p_payload->>'invoice_number'), '') = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'The supplier invoice number is required.');
  end if;
  v_lines := coalesce(p_payload->'lines', '[]'::jsonb);
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Add at least one line with received and invoiced quantities.');
  end if;

  -- Payload hash over authoritative references (PO + received/invoiced), so a
  -- replay with different quantities conflicts instead of replaying stale.
  v_hash := md5(coalesce(v_lodge::text, '') || '|' || v_po::text || '|' ||
    btrim(p_payload->>'invoice_number') || '|' || v_lines::text);

  select * into v_existing from public.fnb_supplier_invoices where lodge_id = v_lodge and operation_id = p_operation_id limit 1;
  if found then
    if coalesce(v_existing.payload_hash, '') <> '' and v_existing.payload_hash <> v_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT',
        'error', 'This operation ID was already used with different invoice details. Use a new operation ID.');
    end if;
    return jsonb_build_object('success', true, 'replayed', true, 'invoice', to_jsonb(v_existing));
  end if;

  insert into public.fnb_supplier_invoices (lodge_id, outlet_id, supplier_id, purchase_order_id, supplier_name, invoice_number, invoice_date, status, operation_id, created_by, payload_hash)
  values (
    v_lodge, v_outlet, v_supplier, v_po, v_supplier_name,
    btrim(p_payload->>'invoice_number'),
    nullif(p_payload->>'invoice_date', '')::date,
    'draft', p_operation_id, v_user, v_hash
  ) returning * into v_row;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    begin v_item_id := nullif(v_line->>'inventory_item_id', '')::uuid; exception when others then v_item_id := null; end;
    if v_item_id is null then
      raise exception 'Each line needs a lodge inventory item.' using errcode = 'P0001';
    end if;
    -- Authoritative ordered quantity + price from the PO line.
    begin
      select poi.quantity, poi.unit_cost, ii.name, ii.lodge_id
        into v_po_qty, v_po_cost, v_item_name, v_inv_lodge
        from public.restaurant_purchase_order_items poi
        join public.inventory_items ii on ii.id = poi.inventory_item_id
       where poi.purchase_order_id = v_po and poi.inventory_item_id = v_item_id
       limit 1;
    exception when undefined_table then
      raise exception 'Purchase-order lines are unavailable.' using errcode = 'P0001';
    end;
    if not found or v_inv_lodge is distinct from v_lodge then
      raise exception 'A line item is not on purchase order %.', v_po using errcode = 'P0001';
    end if;
    if v_item_id = any(v_seen) then
      raise exception 'Duplicate line for item %.', v_item_name using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_item_id;
    begin v_received := nullif(btrim(coalesce(v_line->>'received_qty', '')), '')::numeric; exception when others then v_received := null; end;
    begin v_invoiced := nullif(btrim(coalesce(v_line->>'invoiced_qty', '')), '')::numeric; exception when others then v_invoiced := null; end;
    begin v_invoiced_cost := nullif(btrim(coalesce(v_line->>'invoiced_unit_cost', '')), '')::numeric; exception when others then v_invoiced_cost := null; end;
    if v_received is null or v_received < 0 then
      raise exception 'Received quantity for % is required.', v_item_name using errcode = 'P0001';
    end if;
    if v_invoiced is null or v_invoiced < 0 then
      raise exception 'Invoiced quantity for % is required.', v_item_name using errcode = 'P0001';
    end if;
    if v_invoiced_cost is null or v_invoiced_cost < 0 then
      raise exception 'Invoiced unit cost for % is required.', v_item_name using errcode = 'P0001';
    end if;
    insert into public.fnb_supplier_invoice_lines (invoice_id, lodge_id, inventory_item_id, item_name, ordered_qty, received_qty, invoiced_qty, unit_cost, invoiced_unit_cost, operation_id)
    values (
      v_row.id, v_lodge, v_item_id, v_item_name,
      coalesce(v_po_qty, 0), v_received, v_invoiced,
      coalesce(v_po_cost, 0), v_invoiced_cost,
      p_operation_id || ':' || v_item_id::text
    );
  end loop;

  -- Genuine three-way comparison: authoritative PO quantity/price vs the
  -- confirmed received quantity vs the invoiced quantity/price. Any mismatch
  -- moves to variance approval; it is never auto-approved.
  perform 1 from public.fnb_supplier_invoice_lines
   where invoice_id = v_row.id
     and (ordered_qty <> received_qty or received_qty <> invoiced_qty or unit_cost <> invoiced_unit_cost)
   limit 1;
  if found then
    v_outcome := 'pending_approval';
    update public.fnb_supplier_invoices set status = 'pending_approval', updated_at = now() where id = v_row.id returning * into v_row;
  end if;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_lodge, 'supplier_invoice', v_row.id, 'captured:' || v_outcome, v_user, nullif(v_role, ''), to_jsonb(v_row), p_operation_id);

  return jsonb_build_object('success', true, 'replayed', false, 'invoice', to_jsonb(v_row), 'match_outcome', v_outcome,
    'purchase_order_id', v_po, 'note', 'Ordered quantities and prices are the purchase order''s own records, not typed values.');
exception when others then
  -- P0001 raises above carry operator-actionable messages; anything else is a
  -- validation failure with the database message preserved.
  if SQLSTATE = 'P0001' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', coalesce(SQLERRM, 'Invoice capture failed.'));
  end if;
  return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', coalesce(SQLERRM, 'Invoice capture failed. Check line quantities and retry.'));
end;
$$;

revoke all on function public.capture_fnb_supplier_invoice(uuid, jsonb, text) from public;
grant execute on function public.capture_fnb_supplier_invoice(uuid, jsonb, text) to anon, authenticated, service_role;

create or replace function public.approve_fnb_invoice_match(
  p_invoice_id uuid,
  p_approve boolean,
  p_note text default null,
  p_operation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.fnb_supplier_invoices%rowtype;
  v_user uuid;
  v_session public.app_sessions%rowtype;
  v_auth uuid;
  v_role text := '';
begin
  if p_invoice_id is null or p_approve is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'An invoice decision is required.');
  end if;
  select * into v_row from public.fnb_supplier_invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Supplier invoice not found.');
  end if;
  if not public.app_lodge_access(v_row.lodge_id) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  select * into v_session from public.app_current_session_row();
  if v_session.id is not null then
    v_user := v_session.user_id;
  else
    begin v_auth := public.app_authenticated_user_id(); exception when undefined_function then v_auth := null; end;
    if v_auth is not null then
      select u.id into v_user from public.users u where u.auth_user_id = v_auth and u.lodge_id = v_row.lodge_id and coalesce(u.status,'active')='active' limit 1;
    end if;
  end if;
  if v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_row.lodge_id limit 1;
  if not public._fnb_can_manage(v_row.lodge_id, v_user) then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Variance approval requires a manager or administrator.');
  end if;
  -- Approval is handover continuity (not new work): no module gate, but the
  -- actor must still be scoped to the invoice's outlet.
  if public._fnb_require_outlet(v_row.lodge_id, v_user, v_row.outlet_id) is not null then
    return jsonb_build_object('success', false, 'code', 'OUTLET_SCOPE_DENIED', 'error', 'That invoice belongs to an outlet you cannot serve.');
  end if;
  if v_row.status not in ('draft','pending_approval') then
    return jsonb_build_object('success', false, 'code', 'INVALID_STATE', 'error', format('Invoice is already %s.', v_row.status), 'status', v_row.status);
  end if;
  if p_approve and coalesce(btrim(p_note), '') = '' then
    -- Variance approval needs a note when quantities or prices mismatch.
    perform 1 from public.fnb_supplier_invoice_lines
     where invoice_id = v_row.id
       and (ordered_qty <> received_qty or received_qty <> invoiced_qty or unit_cost <> invoiced_unit_cost)
     limit 1;
    if found then
      return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'An approval note is required when quantities or prices vary.');
    end if;
  end if;

  update public.fnb_supplier_invoices
     set status = case when p_approve then 'approved' else 'voided' end,
         variance_approved = p_approve,
         variance_approved_by = case when p_approve then v_user else null end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_row.lodge_id, 'supplier_invoice', v_row.id, case when p_approve then 'variance_approved' else 'voided' end, v_user, nullif(v_role, ''), jsonb_build_object('invoice', to_jsonb(v_row), 'note', p_note), p_operation_id);

  return jsonb_build_object('success', true, 'invoice', to_jsonb(v_row));
end;
$$;

revoke all on function public.approve_fnb_invoice_match(uuid, boolean, text, text) from public;
grant execute on function public.approve_fnb_invoice_match(uuid, boolean, text, text) to anon, authenticated, service_role;

create or replace function public.handoff_fnb_invoice_to_accounting(
  p_invoice_id uuid,
  p_operation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.fnb_supplier_invoices%rowtype;
  v_user uuid;
  v_session public.app_sessions%rowtype;
  v_auth uuid;
  v_role text := '';
  v_expense_id uuid;
begin
  if p_invoice_id is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'An invoice ID is required.');
  end if;
  select * into v_row from public.fnb_supplier_invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('success', false, 'code', 'NOT_FOUND', 'error', 'Supplier invoice not found.');
  end if;
  if not public.app_lodge_access(v_row.lodge_id) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  select * into v_session from public.app_current_session_row();
  if v_session.id is not null then
    v_user := v_session.user_id;
  else
    begin v_auth := public.app_authenticated_user_id(); exception when undefined_function then v_auth := null; end;
    if v_auth is not null then
      select u.id into v_user from public.users u where u.auth_user_id = v_auth and u.lodge_id = v_row.lodge_id and coalesce(u.status,'active')='active' limit 1;
    end if;
  end if;
  if v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_row.lodge_id limit 1;
  if not public._fnb_can_manage(v_row.lodge_id, v_user) then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Accounting handoff requires a manager or administrator.');
  end if;
  if public._fnb_require_outlet(v_row.lodge_id, v_user, v_row.outlet_id) is not null then
    return jsonb_build_object('success', false, 'code', 'OUTLET_SCOPE_DENIED', 'error', 'That invoice belongs to an outlet you cannot serve.');
  end if;
  if v_row.status <> 'approved' then
    return jsonb_build_object('success', false, 'code', 'INVALID_STATE', 'error', 'Only an approved invoice can be handed to accounting.', 'status', v_row.status);
  end if;
  if v_row.accounting_handed_off then
    return jsonb_build_object('success', true, 'already_handed_off', true, 'invoice', to_jsonb(v_row), 'expense_id', v_row.expense_id);
  end if;

  -- Real accounting handoff: exactly one canonical expense row in the
  -- authoritative expenses ledger, valued at the INVOICED (supplier-claimed)
  -- totals. The expense references this invoice so spend reporting reconciles.
  insert into public.expenses (lodge_id, date, description, category, amount, notes, outlet_id)
  select v_row.lodge_id,
    coalesce(v_row.invoice_date, (now() at time zone 'Africa/Gaborone')::date),
    'Supplier invoice ' || v_row.invoice_number || ' — ' || v_row.supplier_name,
    'Food & Beverage',
    coalesce(sum(l.invoiced_qty * l.invoiced_unit_cost), 0),
    'F&B three-way matched invoice ' || v_row.id::text ||
      ' (PO ' || coalesce(v_row.purchase_order_id::text, 'n/a') || ', variance approved)',
    v_row.outlet_id
    from public.fnb_supplier_invoice_lines l
   where l.invoice_id = v_row.id
  returning id into v_expense_id;

  update public.fnb_supplier_invoices
     set status = 'handed_off', accounting_handed_off = true, accounting_handed_off_at = now(),
         expense_id = v_expense_id, updated_at = now()
   where id = v_row.id
  returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_row.lodge_id, 'supplier_invoice', v_row.id, 'accounting_handoff', v_user, nullif(v_role, ''),
    jsonb_build_object('invoice', to_jsonb(v_row), 'expense_id', v_expense_id), p_operation_id);

  return jsonb_build_object('success', true, 'invoice', to_jsonb(v_row), 'expense_id', v_expense_id,
    'note', 'Posted one canonical expense for the invoiced total. Cost and spend reports now include it.');
end;
$$;

revoke all on function public.handoff_fnb_invoice_to_accounting(uuid, text) from public;
grant execute on function public.handoff_fnb_invoice_to_accounting(uuid, text) to anon, authenticated, service_role;

-- ── Demand recommendations (read-only, advisory) ──────────────────────────
create or replace function public.get_fnb_demand_recommendations(
  p_lodge_id uuid,
  p_date date default current_date,
  p_outlet_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_occupancy numeric := null;
  v_arrivals integer := 0;
  v_events integer := 0;
  v_res_covers integer := 0;
  v_hist_covers numeric := null;
  v_room_count integer := 0;
  v_low_stock integer := 0;
  v_recs jsonb := '[]'::jsonb;
  v_exceptions jsonb := '[]'::jsonb;
  v_confidence text := 'low';
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;

  -- Occupancy + arrivals from bookings. Column truth: bookings(check_in,
  -- check_out, status), rooms(id, lodge_id) with NO deleted column.
  -- v_low_stock is reused below for low-stock; room count uses v_room_count.
  begin
    if to_regclass('public.bookings') is not null then
      execute 'select count(*)::integer from public.bookings where lodge_id = $1 and check_in <= $2 and check_out > $2 and coalesce(status, '''') in (''confirmed'',''checked_in'')'
        into v_arrivals using v_lodge, p_date;
      if to_regclass('public.rooms') is not null then
        execute 'select count(*)::integer from public.rooms where lodge_id = $1'
          into v_room_count using v_lodge;
        if coalesce(v_room_count, 0) > 0 then
          v_occupancy := round((v_arrivals::numeric / greatest(v_room_count, 1)::numeric) * 100, 1);
        else
          v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object('code', 'ROOMS_UNAVAILABLE', 'message', 'Room count is unavailable, so occupancy is uncertified.'));
        end if;
      else
        v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object('code', 'ROOMS_UNAVAILABLE', 'message', 'Room count is unavailable, so occupancy is uncertified.'));
      end if;
    else
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object('code', 'BOOKINGS_UNAVAILABLE', 'message', 'Booking occupancy is unavailable.'));
    end if;
  exception when others then
    v_occupancy := null;
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object('code', 'OCCUPANCY_FAILED', 'message', 'Occupancy could not be certified.'));
  end;

  -- Events.
  begin
    if to_regclass('public.events') is not null then
      execute 'select count(*)::integer from public.events where lodge_id = $1 and (event_date = $2 or (start_date <= $2 and end_date >= $2))'
        into v_events using v_lodge, p_date;
    elsif to_regclass('public.conference_bookings') is not null then
      execute 'select count(*)::integer from public.conference_bookings where lodge_id = $1 and (booking_date = $2 or (start_date <= $2 and end_date >= $2))'
        into v_events using v_lodge, p_date;
    end if;
  exception when others then v_events := 0; end;

  -- Reservation covers.
  begin
    if to_regclass('public.restaurant_reservations') is not null then
      if p_outlet_id is null then
        execute 'select coalesce(sum(party_size), 0)::integer from public.restaurant_reservations where lodge_id = $1 and reservation_date = $2 and status in (''booked'',''confirmed'',''waiting'')'
          into v_res_covers using v_lodge, p_date;
      else
        execute 'select coalesce(sum(party_size), 0)::integer from public.restaurant_reservations where lodge_id = $1 and reservation_date = $2 and (outlet_id = $3 or outlet_id is null) and status in (''booked'',''confirmed'',''waiting'')'
          into v_res_covers using v_lodge, p_date, p_outlet_id;
      end if;
    end if;
  exception when others then v_res_covers := 0; end;

  -- Historic covers: same weekday, last 4 weeks, from POS orders where present.
  begin
    if to_regclass('public.pos_orders') is not null then
      execute 'select round(avg(daily_covers), 1) from (select created_at::date as d, count(*) as daily_covers from public.pos_orders where lodge_id = $1 and created_at::date between $2 - interval ''28 days'' and $2 - interval ''1 day'' and extract(dow from created_at) = extract(dow from $2::timestamptz) group by 1) s'
        into v_hist_covers using v_lodge, p_date;
    else
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object('code', 'HISTORY_UNAVAILABLE', 'message', 'Historic covers are unavailable.'));
    end if;
  exception when others then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object('code', 'HISTORY_FAILED', 'message', 'Historic covers could not be certified.'));
  end;

  -- Low-stock count. Column truth: inventory_items has NO is_active column.
  begin
    if to_regclass('public.inventory_items') is not null then
      execute 'select count(*)::integer from public.inventory_items where lodge_id = $1 and coalesce(current_stock, 0) <= coalesce(reorder_level, 0)'
        into v_low_stock using v_lodge;
    else
      v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object('code', 'INVENTORY_UNAVAILABLE', 'message', 'Low-stock signals are unavailable.'));
    end if;
  exception when others then
    v_exceptions := v_exceptions || jsonb_build_array(jsonb_build_object('code', 'INVENTORY_FAILED', 'message', 'Low-stock signals could not be certified.'));
  end;

  if v_occupancy is not null and v_hist_covers is not null then
    v_confidence := 'medium';
    if v_events = 0 then v_confidence := 'high'; end if;
  elsif v_occupancy is not null or v_hist_covers is not null then
    v_confidence := 'low';
  end if;

  v_recs := v_recs
    || jsonb_build_array(jsonb_build_object(
      'key', 'covers:' || p_date::text,
      'title', format('Plan for ~%s covers on %s', coalesce(v_res_covers, 0) + coalesce(v_hist_covers::integer, 0), p_date::text),
      'detail', format('Reservations: %s covers. Same-weekday history: %s. Occupancy signal: %s. Events: %s.', coalesce(v_res_covers, 0), coalesce(v_hist_covers::text, 'unavailable'), coalesce(v_occupancy::text || '%', 'unavailable'), v_events),
      'action', 'prep_batch',
      'source', 'occupancy+events+reservations+history',
      'confidence', v_confidence
    ))
    || jsonb_build_array(jsonb_build_object(
      'key', 'stock:' || p_date::text,
      'title', format('Review %s low-stock item(s) before service', coalesce(v_low_stock, 0)),
      'detail', 'Low-stock signals come from Lodge Inventory on-hand vs reorder level. Create a draft purchase order only after review.',
      'action', 'draft_purchase_order',
      'source', 'inventory on-hand',
      'confidence', case when v_low_stock > 0 then 'high' else 'medium' end
    ));

  return jsonb_build_object(
    'success', true,
    'lodge_id', v_lodge,
    'outlet_id', p_outlet_id,
    'date', p_date,
    'occupancy_pct', v_occupancy,
    'arrivals', v_arrivals,
    'events', v_events,
    'reservation_covers', v_res_covers,
    'historic_covers', v_hist_covers,
    'low_stock', v_low_stock,
    'recommendations', v_recs,
    'confidence', v_confidence,
    'freshness', now(),
    'source', 'server-advisory',
    'exceptions', v_exceptions,
    'note', 'Advisory only. Explicit approval is required to create prep batches or draft purchase orders.'
  );
end;
$$;

revoke all on function public.get_fnb_demand_recommendations(uuid, date, uuid) from public;
grant execute on function public.get_fnb_demand_recommendations(uuid, date, uuid) to anon, authenticated, service_role;

-- Explicit approval → traceable prep/PO draft request (idempotent).
create or replace function public.approve_fnb_demand_recommendation(
  p_lodge_id uuid,
  p_recommendation_key text,
  p_action text,
  p_payload jsonb,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_role text := '';
  v_module_denial text;
  v_outlet_denial text;
  v_existing public.fnb_demand_approvals%rowtype;
  v_row public.fnb_demand_approvals%rowtype;
  v_outlet uuid;
  v_hash text;
begin
  if p_operation_id is null or btrim(p_operation_id) = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A stable operation ID is required.');
  end if;
  if p_action not in ('prep_batch','draft_purchase_order') then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Unknown approval action.');
  end if;
  if coalesce(btrim(p_recommendation_key), '') = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A recommendation key is required.');
  end if;
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  v_module_denial := public._fnb_require_module(v_lodge, 'demand-planning');
  if v_module_denial is not null then
    return jsonb_build_object('success', false, 'code', v_module_denial,
      'error', case v_module_denial
        when 'MODULE_DISABLED' then 'Demand planning is currently disabled. An administrator can enable it in Food & Beverage → More tools.'
        when 'ENTITLEMENT_UNVERIFIED' then 'The licence for demand planning could not be verified. Reconnect and retry.'
        else 'This lodge does not include demand planning. Request access to use it.' end);
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_lodge limit 1;
  if not public._fnb_can_manage(v_lodge, v_user) then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Demand approvals require a manager or administrator.');
  end if;

  begin v_outlet := nullif(p_payload->>'outlet_id', '')::uuid; exception when others then v_outlet := null; end;
  v_outlet_denial := public._fnb_require_outlet(v_lodge, v_user, v_outlet);
  if v_outlet_denial is not null then
    return jsonb_build_object('success', false, 'code', v_outlet_denial, 'error', 'That outlet is not available to you in this lodge.');
  end if;

  v_hash := md5(coalesce(v_lodge::text, '') || '|' || btrim(p_recommendation_key) || '|' || p_action || '|' || coalesce(p_payload, '{}'::jsonb)::text);

  select * into v_existing from public.fnb_demand_approvals where lodge_id = v_lodge and operation_id = p_operation_id limit 1;
  if found then
    if coalesce(v_existing.payload_hash, '') <> '' and v_existing.payload_hash <> v_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT',
        'error', 'This operation ID was already used for a different approval. Use a new operation ID.');
    end if;
    return jsonb_build_object('success', true, 'replayed', true, 'approval', to_jsonb(v_existing));
  end if;

  insert into public.fnb_demand_approvals (lodge_id, outlet_id, recommendation_key, action, payload, approved_by, operation_id, payload_hash)
  values (v_lodge, v_outlet, btrim(p_recommendation_key), p_action, coalesce(p_payload, '{}'::jsonb), v_user, p_operation_id, v_hash)
  returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_lodge, 'demand_approval', v_row.id, 'approved:' || p_action, v_user, nullif(v_role, ''), to_jsonb(v_row), p_operation_id);

  return jsonb_build_object('success', true, 'replayed', false, 'approval', to_jsonb(v_row),
    'note', 'Recorded as an approved draft request. Create the prep batch or purchase order in its canonical workflow.');
end;
$$;

revoke all on function public.approve_fnb_demand_recommendation(uuid, text, text, jsonb, text) from public;
grant execute on function public.approve_fnb_demand_recommendation(uuid, text, text, jsonb, text) to anon, authenticated, service_role;

-- ── Food-safety template management ───────────────────────────────────────
create or replace function public.create_fnb_food_safety_template(
  p_lodge_id uuid,
  p_payload jsonb,
  p_operation_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_role text := '';
  v_module_denial text;
  v_existing public.fnb_food_safety_templates%rowtype;
  v_row public.fnb_food_safety_templates%rowtype;
  v_outlet uuid;
  v_min numeric;
  v_max numeric;
begin
  if p_operation_id is null or btrim(p_operation_id) = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A stable operation ID is required.');
  end if;
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  v_module_denial := public._fnb_require_module(v_lodge, 'food-safety');
  if v_module_denial is not null then
    return jsonb_build_object('success', false, 'code', v_module_denial, 'error', 'Food safety is not available to this lodge right now.');
  end if;
  if not public._fnb_can_manage(v_lodge, v_user) then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Check templates require a manager or administrator.');
  end if;
  select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user and u.lodge_id = v_lodge limit 1;
  if coalesce(btrim(p_payload->>'name'), '') = '' then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'A template name is required.');
  end if;
  begin v_outlet := nullif(p_payload->>'outlet_id', '')::uuid; exception when others then v_outlet := null; end;
  if public._fnb_require_outlet(v_lodge, v_user, v_outlet) is not null then
    return jsonb_build_object('success', false, 'code', 'OUTLET_SCOPE_DENIED', 'error', 'That outlet is not available to you in this lodge.');
  end if;
  begin v_min := nullif(btrim(coalesce(p_payload->>'min_temp_c', '')), '')::numeric; exception when others then v_min := null; end;
  begin v_max := nullif(btrim(coalesce(p_payload->>'max_temp_c', '')), '')::numeric; exception when others then v_max := null; end;
  if v_min is null and v_max is null then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'Set at least a minimum or maximum temperature.');
  end if;
  if v_min is not null and v_max is not null and v_max < v_min then
    return jsonb_build_object('success', false, 'code', 'VALIDATION_FAILED', 'error', 'The maximum cannot be below the minimum.');
  end if;

  select * into v_existing from public.fnb_food_safety_templates where lodge_id = v_lodge and operation_id = p_operation_id limit 1;
  if found then
    return jsonb_build_object('success', true, 'replayed', true, 'template', to_jsonb(v_existing));
  end if;

  insert into public.fnb_food_safety_templates (lodge_id, outlet_id, name, check_type, min_temp_c, max_temp_c, frequency, operation_id, created_by)
  values (v_lodge, v_outlet, btrim(p_payload->>'name'),
    coalesce(nullif(btrim(coalesce(p_payload->>'check_type', 'temperature')), ''), 'temperature'),
    v_min, v_max, nullif(btrim(coalesce(p_payload->>'frequency', '')), ''),
    p_operation_id, v_user)
  returning * into v_row;

  insert into public.fnb_audit_log (lodge_id, entity_type, entity_id, action, actor_id, actor_role, after_snapshot, operation_id)
  values (v_lodge, 'food_safety_template', v_row.id, 'created', v_user, nullif(v_role, ''), to_jsonb(v_row), p_operation_id);

  return jsonb_build_object('success', true, 'replayed', false, 'template', to_jsonb(v_row));
end;
$$;

revoke all on function public.create_fnb_food_safety_template(uuid, jsonb, text) from public;
grant execute on function public.create_fnb_food_safety_template(uuid, jsonb, text) to anon, authenticated, service_role;

-- ── Operational reads (queues + retained history) ─────────────────────────
create or replace function public.get_fnb_food_safety_templates(p_lodge_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_rows jsonb := '[]'::jsonb;
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot view food-safety templates.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) into v_rows
    from (select * from public.fnb_food_safety_templates where lodge_id = v_lodge and coalesce(is_active, true) = true order by name limit 200) t;
  return jsonb_build_object('success', true, 'lodge_id', v_lodge, 'templates', v_rows, 'source', 'server');
end;
$$;

revoke all on function public.get_fnb_food_safety_templates(uuid) from public;
grant execute on function public.get_fnb_food_safety_templates(uuid) to anon, authenticated, service_role;

create or replace function public.get_fnb_corrective_queue(
  p_lodge_id uuid,
  p_include_closed boolean default false,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_rows jsonb := '[]'::jsonb;
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'pos.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot view corrective actions.');
  end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_rows
    from (
      select * from public.fnb_corrective_actions
       where lodge_id = v_lodge
         and (p_include_closed is true or status <> 'closed')
       order by created_at desc
       limit greatest(least(coalesce(p_limit, 50), 200), 1)
    ) a;
  return jsonb_build_object('success', true, 'lodge_id', v_lodge, 'actions', v_rows, 'source', 'server');
end;
$$;

revoke all on function public.get_fnb_corrective_queue(uuid, boolean, integer) from public;
grant execute on function public.get_fnb_corrective_queue(uuid, boolean, integer) to anon, authenticated, service_role;

create or replace function public.get_fnb_supplier_invoices(
  p_lodge_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_caller record;
  v_lodge uuid;
  v_user uuid;
  v_rows jsonb := '[]'::jsonb;
begin
  select * into v_caller from public._fnb_resolve_caller(p_lodge_id);
  v_lodge := v_caller.lodge_id;
  v_user := v_caller.user_id;
  if v_lodge is null or v_user is null then
    return jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Sign in again and retry.');
  end if;
  if not public.app_lodge_access(v_lodge) and not public.app_is_service_role() then
    return jsonb_build_object('success', false, 'code', 'LODGE_SCOPE_DENIED', 'error', 'Access denied for this lodge.');
  end if;
  if not public._fnb_has_capability(v_lodge, v_user, 'inventory.manage') then
    return jsonb_build_object('success', false, 'code', 'CAPABILITY_DENIED', 'error', 'Your role cannot view supplier invoices.');
  end if;
  select coalesce(jsonb_agg(inv order by inv.created_at desc), '[]'::jsonb) into v_rows
    from (
      select i.*,
        (select coalesce(jsonb_agg(to_jsonb(l) order by l.item_name), '[]'::jsonb)
           from public.fnb_supplier_invoice_lines l where l.invoice_id = i.id) as lines
        from public.fnb_supplier_invoices i
       where i.lodge_id = v_lodge
       order by i.created_at desc
       limit greatest(least(coalesce(p_limit, 50), 200), 1)
    ) inv;
  return jsonb_build_object('success', true, 'lodge_id', v_lodge, 'invoices', v_rows, 'source', 'server');
end;
$$;

revoke all on function public.get_fnb_supplier_invoices(uuid, integer) from public;
grant execute on function public.get_fnb_supplier_invoices(uuid, integer) to anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;

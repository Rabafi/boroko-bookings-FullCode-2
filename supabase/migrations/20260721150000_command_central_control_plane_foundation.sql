-- Command Central control-plane foundation.
-- All mutation-facing tables are service-role-only. Desktop access remains
-- behind the master-admin IPC boundary; browser clients receive no grants.

create table if not exists public.command_central_operations (
  operation_id uuid primary key,
  operation_type text not null,
  target_lodge_id uuid,
  product_id text,
  request_hash text not null,
  status text not null check (status in ('started', 'completed', 'failed')),
  result jsonb,
  actor_id uuid,
  actor_email text,
  reason text not null check (length(btrim(reason)) >= 8),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists command_central_operations_replay_idx
  on public.command_central_operations(operation_id, request_hash);

create table if not exists public.commercial_accounts (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  product_id text not null check (product_id in ('lodge-camp', 'hotel', 'hospitality-pos')),
  currency text not null default 'BWP',
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lodge_id, product_id)
);

create table if not exists public.commercial_invoices (
  id uuid primary key default gen_random_uuid(),
  commercial_account_id uuid not null references public.commercial_accounts(id),
  invoice_number text not null unique,
  status text not null default 'draft' check (status in ('draft', 'posted', 'paid', 'void', 'written_off')),
  currency text not null default 'BWP',
  issued_at timestamptz,
  due_date date,
  subtotal numeric not null default 0 check (subtotal >= 0),
  tax_total numeric not null default 0 check (tax_total >= 0),
  total numeric not null default 0 check (total >= 0),
  balance_due numeric not null default 0 check (balance_due >= 0),
  pricing_snapshot jsonb not null default '{}'::jsonb,
  operation_id uuid unique references public.command_central_operations(operation_id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

create table if not exists public.commercial_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  commercial_invoice_id uuid not null references public.commercial_invoices(id) on delete restrict,
  line_type text not null check (line_type in ('subscription', 'addon', 'adjustment', 'credit')),
  description text not null,
  quantity numeric not null default 1 check (quantity > 0),
  unit_amount numeric not null,
  line_total numeric not null,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.commercial_payments (
  id uuid primary key default gen_random_uuid(),
  commercial_account_id uuid not null references public.commercial_accounts(id),
  received_at timestamptz not null default now(),
  amount numeric not null check (amount > 0),
  currency text not null default 'BWP',
  method text not null,
  reference text,
  operation_id uuid unique references public.command_central_operations(operation_id),
  created_at timestamptz not null default now()
);

create table if not exists public.commercial_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  commercial_payment_id uuid not null references public.commercial_payments(id) on delete restrict,
  commercial_invoice_id uuid not null references public.commercial_invoices(id) on delete restrict,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (commercial_payment_id, commercial_invoice_id)
);

create table if not exists public.commercial_credit_notes (
  id uuid primary key default gen_random_uuid(),
  commercial_invoice_id uuid not null references public.commercial_invoices(id) on delete restrict,
  credit_number text not null unique,
  amount numeric not null check (amount > 0),
  reason text not null check (length(btrim(reason)) >= 8),
  operation_id uuid unique references public.command_central_operations(operation_id),
  issued_at timestamptz not null default now()
);

create table if not exists public.company_lifecycle_requests (
  id uuid primary key default gen_random_uuid(),
  lodge_id uuid not null,
  action text not null check (action in ('archive', 'restore', 'deletion_requested', 'anonymize')),
  status text not null check (status in ('requested', 'approved', 'completed', 'rejected', 'cancelled')),
  reason text not null check (length(btrim(reason)) >= 8),
  impact_preview jsonb not null default '{}'::jsonb,
  requested_by uuid,
  approved_by uuid,
  operation_id uuid unique references public.command_central_operations(operation_id),
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz
);

alter table public.command_central_operations enable row level security;
alter table public.commercial_accounts enable row level security;
alter table public.commercial_invoices enable row level security;
alter table public.commercial_invoice_lines enable row level security;
alter table public.commercial_payments enable row level security;
alter table public.commercial_payment_allocations enable row level security;
alter table public.commercial_credit_notes enable row level security;
alter table public.company_lifecycle_requests enable row level security;

revoke all on public.command_central_operations, public.commercial_accounts,
  public.commercial_invoices, public.commercial_invoice_lines,
  public.commercial_payments, public.commercial_payment_allocations,
  public.commercial_credit_notes, public.company_lifecycle_requests
  from public, anon, authenticated;

create or replace function public.command_central_claim_operation(
  p_operation_id uuid,
  p_operation_type text,
  p_target_lodge_id uuid,
  p_product_id text,
  p_request_hash text,
  p_reason text,
  p_actor_id uuid default null,
  p_actor_email text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_existing public.command_central_operations%rowtype;
begin
  if not public.app_is_service_role() then raise exception 'Unauthorized' using errcode = '42501'; end if;
  if p_operation_id is null or length(btrim(coalesce(p_request_hash, ''))) < 16 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'error', 'A stable operation ID and request hash are required');
  end if;
  select * into v_existing from public.command_central_operations where operation_id = p_operation_id for update;
  if found then
    if v_existing.request_hash <> p_request_hash then
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_OPERATION', 'error', 'Operation ID was already used with different input');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'status', v_existing.status, 'result', v_existing.result);
  end if;
  insert into public.command_central_operations(operation_id, operation_type, target_lodge_id, product_id, request_hash, status, reason, actor_id, actor_email)
  values (p_operation_id, p_operation_type, p_target_lodge_id, p_product_id, p_request_hash, 'started', p_reason, p_actor_id, p_actor_email);
  return jsonb_build_object('ok', true, 'replayed', false);
end;
$$;

revoke all on function public.command_central_claim_operation(uuid, text, uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.command_central_claim_operation(uuid, text, uuid, text, text, text, uuid, text) to service_role;

notify pgrst, 'reload schema';

-- Hotel-Specific Roles and Permissions
-- Creates role templates for hotel-specific staff roles.

-- ── 1. Hotel Role Templates Table ─────────────────────────────────────────────
create table if not exists public.hotel_role_templates (
  id uuid primary key default gen_random_uuid(),
  role_key text not null unique,
  role_name text not null,
  description text,
  category text not null check (category in ('front_office', 'housekeeping', 'maintenance', 'finance', 'revenue', 'sales', 'management')),
  capabilities jsonb not null default '[]'::jsonb,
  is_system_role boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.hotel_role_templates enable row level security;

create policy hotel_role_templates_read_policy on public.hotel_role_templates
  for select using (true);

revoke insert, update, delete on public.hotel_role_templates from authenticated, anon;

create index if not exists hotel_role_templates_category_idx on public.hotel_role_templates (category);

-- ── 2. Seed Role Templates ────────────────────────────────────────────────────
insert into public.hotel_role_templates (role_key, role_name, description, category, capabilities, is_system_role) values
  ('night_auditor', 'Night Auditor', 'End-of-day reconciliation, folio review, and audit reporting', 'front_office',
   '["front_desk_dashboard.view", "bookings.view", "folios.view", "night_audit.close", "audit.view", "reports.view"]'::jsonb, true),
  ('housekeeping_supervisor', 'Housekeeping Supervisor', 'Inspect rooms, assign tasks, manage linen and lost & found', 'housekeeping',
   '["housekeeping.assign", "housekeeping.inspect", "housekeeping.manage", "rooms.view", "linen.manage", "lost_found.manage"]'::jsonb, true),
  ('housekeeper', 'Housekeeper', 'Manage own housekeeping assignments', 'housekeeping',
   '["housekeeping.manage"]'::jsonb, true),
  ('maintenance_tech', 'Maintenance Technician', 'View and manage maintenance tickets and out-of-order rooms', 'maintenance',
   '["maintenance.view", "maintenance.manage", "maintenance.ooo"]'::jsonb, true),
  ('revenue_manager', 'Revenue Manager', 'Manage rate plans, rate calendar, promo codes, and revenue reports', 'revenue',
   '["rate_plans.view", "rate_plans.manage", "rate_calendar.manage", "promo_codes.manage", "reports.view", "revenue_manager.view"]'::jsonb, true),
  ('finance_debtors', 'Finance / Debtors Clerk', 'Manage corporate accounts, billing, folios, and expenses', 'finance',
   '["corporate_accounts.view", "corporate_accounts.manage", "corporate_billing.manage", "folios.view", "reports.view", "expenses.view"]'::jsonb, true),
  ('group_sales', 'Group Sales Coordinator', 'Manage group operations, corporate accounts, and conference bookings', 'sales',
   '["group_operations.manage", "corporate_accounts.view", "bookings.view", "conference.view"]'::jsonb, true),
  ('general_manager', 'General Manager', 'Full access to all capabilities', 'management',
   (select jsonb_agg(distinct value) from jsonb_array_elements_text((select jsonb_agg(distinct unnest) from (select unnest(array_cat(array_agg(distinct value), array['general_manager.full_access'])) from jsonb_array_elements_text(
     (select jsonb_agg(distinct c) from public.hotel_role_templates, jsonb_array_elements_text(capabilities) as c)
   )) as sub))), true),
  ('reservations_agent', 'Reservations Agent', 'Create and manage bookings, view rooms and rate plans', 'front_office',
   '["bookings.view", "bookings.manage", "rooms.view", "rate_plans.view", "guests.view"]'::jsonb, true),
  ('front_office_manager', 'Front Office Manager', 'Full front desk including check-in/out, room moves, folios', 'front_office',
   '["bookings.view", "bookings.manage", "checkin.manage", "checkout.manage", "early_checkin.manage", "late_checkout.manage", "room_moves.manage", "folios.view", "front_desk_dashboard.view"]'::jsonb, true)
on conflict (role_key) do nothing;

-- ── 3. RPCs ───────────────────────────────────────────────────────────────────

-- Get hotel role templates
create or replace function public.get_hotel_role_templates()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_templates jsonb;
begin
  select jsonb_agg(jsonb_build_object(
    'id', hrt.id,
    'role_key', hrt.role_key,
    'role_name', hrt.role_name,
    'description', hrt.description,
    'category', hrt.category,
    'capabilities', hrt.capabilities,
    'is_system_role', hrt.is_system_role
  ) order by hrt.category, hrt.role_name) into v_templates
  from public.hotel_role_templates hrt;

  return coalesce(v_templates, '[]'::jsonb);
end;
$$;

grant execute on function public.get_hotel_role_templates() to authenticated;

-- Get role capabilities
create or replace function public.get_role_capabilities(
  p_role_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capabilities jsonb;
begin
  select hrt.capabilities into v_capabilities
  from public.hotel_role_templates hrt
  where hrt.role_key = p_role_key;

  return coalesce(v_capabilities, '[]'::jsonb);
end;
$$;

grant execute on function public.get_role_capabilities(text) to authenticated;

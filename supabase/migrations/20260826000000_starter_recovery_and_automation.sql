-- Starter recovery workspace + weekly automation entitlement.
--
-- The disposable restore contract below deliberately accepts one already
-- decrypted JSONB payload.  PostgreSQL is not a safe 256 MiB transport, so
-- this contract enforces an honest 8 MiB server payload limit.  A future
-- chunked transport must assemble and validate data before calling this RPC;
-- this migration does not create unused staging tables.
--
-- The restore RPC is service-role only.  The trusted Command Central path must
-- authenticate the operator as a master admin and enforce the exact
-- command_central.recovery.manage capability before using its service-role
-- client.  The passphrase never reaches PostgreSQL.  No anon/authenticated
-- execute grant is provided here.

-- ---------------------------------------------------------------------------
-- 1. Commercial entitlement (customer-owned Starter automation)
-- ---------------------------------------------------------------------------
update public.commercial_package_prices package_price
   set included_features = coalesce(package_price.included_features, '[]'::jsonb)
                          || '["starter_backup_automation"]'::jsonb
 where (
      (
        package_price.product_id = 'lodge-camp'
        and package_price.commercial_package_key in ('starter', 'standard', 'pro')
      ) or (
        package_price.product_id = 'hotel'
        and package_price.commercial_package_key = 'hotel_core'
      )
    )
   and not (coalesce(package_price.included_features, '[]'::jsonb) ? 'starter_backup_automation');

insert into public.commercial_package_entitlements (
  catalog_version_id, product_id, commercial_package_key, feature_key, enabled
)
select package_price.catalog_version_id,
       package_price.product_id,
       package_price.commercial_package_key,
       'starter_backup_automation',
       true
  from public.commercial_package_prices package_price
 where (
     package_price.product_id = 'lodge-camp'
     and package_price.commercial_package_key in ('starter', 'standard', 'pro')
   ) or (
     package_price.product_id = 'hotel'
     and package_price.commercial_package_key = 'hotel_core'
   )
on conflict (catalog_version_id, product_id, commercial_package_key, feature_key)
do update set enabled = excluded.enabled;

-- ---------------------------------------------------------------------------
-- 2. Quarantine marker for disposable recovery lodges
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'settings'
       and column_name = 'is_disposable_recovery'
  ) then
    alter table public.settings
      add column is_disposable_recovery boolean not null default false;
  end if;
end;
$$;

create index if not exists settings_is_disposable_recovery_idx
  on public.settings (is_disposable_recovery)
  where is_disposable_recovery = true;

-- Consumers that enumerate live lodges (fleet, billing, public offers) must
-- exclude rows where coalesce(settings.is_disposable_recovery, false) = true.
-- The marker is set in the same transaction as every recovery restore.

-- ---------------------------------------------------------------------------
-- 3. Operation and immutable audit records
-- ---------------------------------------------------------------------------
create table if not exists public.starter_recovery_operations (
  operation_id text primary key,
  source_lodge_id uuid not null,
  recovery_lodge_id uuid not null,
  actor_id uuid,
  actor_email text,
  reason text not null,
  ticket_ref text not null,
  target_mode text not null default 'disposable',
  status text not null default 'executing',
  package_sha256 text not null,
  package_bytes integer not null,
  payload_sha256 text not null,
  table_counts jsonb not null,
  per_table_hashes jsonb not null,
  unresolved_room_type_refs integer not null default 0,
  unresolved_floor_section_refs integer not null default 0,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint starter_recovery_operation_id_chk
    check (operation_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  constraint starter_recovery_reason_chk
    check (length(btrim(reason)) between 8 and 512),
  constraint starter_recovery_ticket_chk
    check (length(btrim(ticket_ref)) between 3 and 128),
  constraint starter_recovery_mode_chk
    check (target_mode = 'disposable'),
  constraint starter_recovery_status_chk
    check (status in ('executing', 'verified', 'failed', 'discarded')),
  constraint starter_recovery_package_sha_chk
    check (package_sha256 ~ '^[0-9a-f]{64}$'),
  constraint starter_recovery_payload_sha_chk
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint starter_recovery_package_bytes_chk
    check (package_bytes between 1 and 8388608),
  constraint starter_recovery_counts_object_chk
    check (jsonb_typeof(table_counts) = 'object'),
  constraint starter_recovery_hashes_object_chk
    check (jsonb_typeof(per_table_hashes) = 'object'),
  constraint starter_recovery_room_type_refs_chk
    check (unresolved_room_type_refs >= 0),
  constraint starter_recovery_floor_section_refs_chk
    check (unresolved_floor_section_refs >= 0)
);

-- Keep reruns/upgrades compatible with an operation table created by an
-- earlier revision of this migration.
alter table public.starter_recovery_operations
  add column if not exists unresolved_room_type_refs integer not null default 0;
alter table public.starter_recovery_operations
  add column if not exists unresolved_floor_section_refs integer not null default 0;

alter table public.starter_recovery_operations enable row level security;
drop policy if exists starter_recovery_operations_service_select
  on public.starter_recovery_operations;
create policy starter_recovery_operations_service_select
  on public.starter_recovery_operations
  for select
  using (auth.role() = 'service_role');
revoke all on table public.starter_recovery_operations from public, anon, authenticated, service_role;

create table if not exists public.starter_recovery_audit_log (
  id uuid primary key default gen_random_uuid(),
  operation_id text not null
    references public.starter_recovery_operations(operation_id) on delete restrict,
  lodge_id uuid not null,
  recovery_lodge_id uuid not null,
  event_type text not null,
  actor_id uuid,
  actor_email text,
  package_sha256 text not null,
  payload_sha256 text not null,
  table_counts jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint starter_recovery_audit_event_chk
    check (length(btrim(event_type)) between 3 and 64),
  constraint starter_recovery_audit_metadata_object_chk
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists starter_recovery_audit_operation_idx
  on public.starter_recovery_audit_log (operation_id, created_at desc);
create index if not exists starter_recovery_audit_lodge_idx
  on public.starter_recovery_audit_log (lodge_id, created_at desc);

alter table public.starter_recovery_audit_log enable row level security;
drop policy if exists starter_recovery_audit_service_select
  on public.starter_recovery_audit_log;
create policy starter_recovery_audit_service_select
  on public.starter_recovery_audit_log
  for select
  using (auth.role() = 'service_role');
revoke all on table public.starter_recovery_audit_log from public, anon, authenticated, service_role;

create or replace function public.prevent_starter_recovery_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  raise exception 'Starter recovery audit is append-only.' using errcode = '55000';
end;
$$;

create or replace function public.validate_starter_recovery_audit_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(new.metadata::text, '') ~* '(passphrase|password|secret|private[_ ]key|service[_ ]role[_ ]key|access[_ ]token|refresh[_ ]token)' then
    raise exception 'Starter recovery audit metadata contains a prohibited secret.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists starter_recovery_audit_immutable
  on public.starter_recovery_audit_log;
create trigger starter_recovery_audit_immutable
before update or delete on public.starter_recovery_audit_log
for each row execute function public.prevent_starter_recovery_audit_mutation();

drop trigger if exists starter_recovery_audit_secret_guard
  on public.starter_recovery_audit_log;
create trigger starter_recovery_audit_secret_guard
before insert on public.starter_recovery_audit_log
for each row execute function public.validate_starter_recovery_audit_insert();

revoke all on function public.prevent_starter_recovery_audit_mutation() from public, anon, authenticated, service_role;
revoke all on function public.validate_starter_recovery_audit_insert() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Strict server-side payload validation
-- ---------------------------------------------------------------------------
create or replace function public._starter_recovery_validate_payload(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tables jsonb;
  v_counts jsonb;
  v_hashes jsonb;
  v_table text;
  v_row jsonb;
  v_field text;
  v_expected_fields text[];
  v_expected_top_level text[] := array[
    'operation_id', 'source_lodge_id', 'recovery_lodge_id', 'reason',
    'ticket_ref', 'target_mode', 'package_sha256', 'package_bytes',
    'tables', 'counts', 'per_table_hashes', 'actor_id', 'actor_email'
  ];
  v_required_tables text[] := array[
    'settings', 'rooms', 'customers', 'bookings', 'quotations',
    'signed_payment_ledger', 'maintenance'
  ];
  v_protected_fields text[] := array[
    'amount_paid', 'payment_status', 'idempotency_key',
    'create_idempotency_key', 'lodge_mesh_secret', 'password',
    'password_hash', 'pin', 'pin_hash', 'access_token',
    'refresh_token', 'service_role_key', 'private_key',
    'secret_key', 'passphrase'
  ];
  v_uuid_fields text[] := array[
    'id', 'lodge_id', 'room_id', 'customer_id', 'quotation_id',
    'converted_booking_id', 'booking_id', 'conference_booking_id',
    'room_type_id', 'floor_section_id', 'recorded_by', 'created_by', '_source_id'
  ];
  v_numeric_fields text[] := array[
    'rate_per_night', 'max_occupancy', 'adults', 'children',
    'total_amount', 'deposit_amount', 'event_daily_rate',
    'charges_total', 'vat_rate', 'amount', 'subtotal', 'tax_amount',
    'labour_cost', 'parts_cost', 'total_cost', 'capacity_adults',
    'capacity_children', 'max_tents', 'max_vehicles', 'rate_per_person',
    'rate_per_tent', 'rate_per_vehicle', 'booking_number'
  ];
  v_integer_fields text[] := array[
    'max_occupancy', 'adults', 'children', 'capacity_adults',
    'capacity_children', 'max_tents', 'max_vehicles'
  ];
  v_boolean_fields text[] := array[
    'setup_complete', 'vat_enabled', 'deleted', 'is_blacklisted',
    'is_exclusive_event', 'assistant_enabled', 'public_offer_rooms',
    'public_offer_multi_room', 'public_offer_full_lodge', 'public_offer_day_use',
    'public_offer_events', 'public_offer_campsites', 'is_powered',
    'shared_facilities'
  ];
  v_array_fields text[] := array['photos', 'amenities', 'accommodation_lines'];
  v_object_fields text[] := array['booking_faq', 'operating_profile'];
  v_required_fields text[];
  v_count integer;
  v_declared_count integer;
  v_hash text;
  v_package_bytes text;
  v_recovery_lodge_id text;
  v_amount numeric;
  v_type text;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Recovery payload must be a JSON object.' using errcode = '22023';
  end if;

  -- An 8 MiB JSONB argument is the explicit safe boundary for this one-RPC
  -- contract.  It is not a claim that the backend accepts 256 MiB.
  if pg_column_size(p_payload) > 8388608 then
    raise exception 'Recovery payload exceeds the 8 MiB server limit.' using errcode = '22023';
  end if;

  for v_field in select key from jsonb_each(p_payload) loop
    if not (v_field = any(v_expected_top_level)) then
      raise exception 'Recovery payload contains an unsupported top-level field: %', v_field using errcode = '22023';
    end if;
    if lower(v_field) = any(v_protected_fields) then
      raise exception 'Recovery payload contains a protected field: %', v_field using errcode = '22023';
    end if;
  end loop;

  v_recovery_lodge_id := nullif(btrim(p_payload->>'recovery_lodge_id'), '');
  if v_recovery_lodge_id is null
     or v_recovery_lodge_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A valid recovery lodge UUID is required.' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'source_lodge_id'), '') is null
     or p_payload->>'source_lodge_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A valid source lodge UUID is required.' using errcode = '22023';
  end if;
  if lower(p_payload->>'source_lodge_id') = lower(v_recovery_lodge_id) then
    raise exception 'Source and recovery lodge IDs must differ.' using errcode = '22023';
  end if;
  if p_payload->>'operation_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A UUID v4 operation ID is required.' using errcode = '22023';
  end if;
  if coalesce(p_payload->>'target_mode', 'disposable') <> 'disposable' then
    raise exception 'Only disposable recovery targets are supported.' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'reason'), '') is null or length(btrim(p_payload->>'reason')) not between 8 and 512 then
    raise exception 'A reason between 8 and 512 characters is required.' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'ticket_ref'), '') is null or length(btrim(p_payload->>'ticket_ref')) not between 3 and 128 then
    raise exception 'A ticket reference between 3 and 128 characters is required.' using errcode = '22023';
  end if;
  if p_payload->>'package_sha256' !~ '^[0-9a-f]{64}$' then
    raise exception 'A lowercase package SHA-256 is required.' using errcode = '22023';
  end if;
  if p_payload ? 'actor_id' then
    if jsonb_typeof(p_payload->'actor_id') <> 'string'
       or p_payload->>'actor_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'actor_id must be a valid user UUID.' using errcode = '22023';
    end if;
  end if;
  if p_payload ? 'actor_email' then
    if jsonb_typeof(p_payload->'actor_email') <> 'string'
       or length(btrim(p_payload->>'actor_email')) not between 3 and 320
       or p_payload->>'actor_email' !~* '^[^[:space:]@]+@[^[:space:]@]+$' then
      raise exception 'actor_email must be a valid operator email.' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'package_bytes' then
    if jsonb_typeof(p_payload->'package_bytes') <> 'number'
       or p_payload->>'package_bytes' !~ '^[0-9]+$' then
      raise exception 'package_bytes must be an integer.' using errcode = '22023';
    end if;
    v_package_bytes := p_payload->>'package_bytes';
    if v_package_bytes::bigint not between 1 and 8388608 then
      raise exception 'package_bytes exceeds the 8 MiB server limit.' using errcode = '22023';
    end if;
  end if;

  v_tables := p_payload->'tables';
  v_counts := p_payload->'counts';
  v_hashes := p_payload->'per_table_hashes';
  if jsonb_typeof(v_tables) <> 'object'
     or jsonb_typeof(v_counts) <> 'object'
     or jsonb_typeof(v_hashes) <> 'object' then
    raise exception 'tables, counts, and per_table_hashes objects are required.' using errcode = '22023';
  end if;

  for v_field in select key from jsonb_each(v_tables) loop
    if not (v_field = any(v_required_tables)) then
      raise exception 'Recovery payload contains an unsupported table: %', v_field using errcode = '22023';
    end if;
  end loop;
  for v_field in select key from jsonb_each(v_counts) loop
    if not (v_field = any(v_required_tables)) then
      raise exception 'Recovery counts contain an unsupported table: %', v_field using errcode = '22023';
    end if;
  end loop;
  for v_field in select key from jsonb_each(v_hashes) loop
    if not (v_field = any(v_required_tables)) then
      raise exception 'Recovery hashes contain an unsupported table: %', v_field using errcode = '22023';
    end if;
  end loop;

  for v_table in select unnest(v_required_tables) loop
    if not (v_tables ? v_table)
       or jsonb_typeof(v_tables->v_table) <> 'array' then
      raise exception 'Recovery table % must be an array.', v_table using errcode = '22023';
    end if;
    if not (v_counts ? v_table)
       or jsonb_typeof(v_counts->v_table) <> 'number'
       or (v_counts->>v_table) !~ '^[0-9]+$' then
      raise exception 'Recovery count for % must be an integer.', v_table using errcode = '22023';
    end if;
    v_count := jsonb_array_length(v_tables->v_table);
    v_declared_count := (v_counts->>v_table)::integer;
    if v_count > 100000 or v_declared_count > 100000 or v_count <> v_declared_count then
      raise exception 'Recovery table % exceeds its 100,000 row ceiling or count mismatch.', v_table using errcode = '22023';
    end if;
    if not (v_hashes ? v_table)
       or jsonb_typeof(v_hashes->v_table) <> 'string'
       or (v_hashes->>v_table) !~ '^[0-9a-f]{64}$' then
      raise exception 'Recovery hash for % must be a lowercase SHA-256.', v_table using errcode = '22023';
    end if;
    if v_table = 'settings' and v_count <> 1 then
      raise exception 'A recovery payload must contain exactly one settings row.' using errcode = '22023';
    end if;

    v_expected_fields := case v_table
      when 'settings' then array[
        'id','lodge_id','lodge_name','company_name','address','city','country',
        'phone','email','website','vat_number','currency','setup_complete',
        'created_at','updated_at','business_type','property_type','vat_enabled',
        'vat_rate','deleted','slug','booking_tagline','booking_description',
        'whatsapp_number','booking_check_in_from','booking_check_out_until',
        'booking_cancellation_policy','booking_payment_terms','booking_house_rules',
        'booking_faq','assistant_enabled','timezone','public_offer_rooms',
        'public_offer_multi_room','public_offer_full_lodge','public_offer_day_use',
        'public_offer_events','public_offer_campsites','operating_profile','_source_id'
      ]
      when 'rooms' then array[
        'id','lodge_id','room_number','room_type','rate_per_night','max_occupancy',
        'status','housekeeping_status','housekeeping_notes','description',
        'created_at','updated_at','amenities','room_type_id','floor_section_id',
        'accommodation_kind','capacity_adults','capacity_children','max_tents',
        'max_vehicles','is_powered','site_surface','shared_facilities','rate_mode',
        'rate_per_person','rate_per_tent','rate_per_vehicle','_source_id'
      ]
      when 'customers' then array[
        'id','lodge_id','name','email','phone','id_number','address','nationality',
        'notes','is_blacklisted','blacklist_reason','created_at','updated_at','_source_id'
      ]
      when 'bookings' then array[
        'id','lodge_id','room_id','customer_id','check_in','check_out','adults',
        'children','total_amount','deposit_amount','payment_method','status','notes','updated_at',
        'created_at','is_exclusive_event','event_daily_rate','quotation_id',
        'charges_total','source','vat_enabled','vat_rate','cancel_reason',
        'cancelled_at','invoice_number','booking_number','created_by','_source_id'
      ]
      when 'quotations' then array[
        'id','lodge_id','customer_id','customer_name','room_id','room_name',
        'check_in','check_out','adults','children','total_amount','currency',
        'notes','status','valid_until','converted_booking_id','created_at',
        'updated_at','customer_phone','subtotal','tax_amount','quotation_type',
        'event_name','event_daily_rate','accommodation_lines','parent_quotation_id',
        'created_by','quotation_number','_source_id'
      ]
      when 'signed_payment_ledger' then array[
        'id','booking_id','conference_booking_id','lodge_id','amount','method',
        'type','paid_at','recorded_by','notes','created_at','_source_id',
        '_unresolved_conference_ref'
      ]
      when 'maintenance' then array[
        'id','lodge_id','room_id','title','description','priority','status',
        'reported_date','notes','created_at','labour_cost','parts_cost',
        'total_cost','vendor_name','cost_notes','_source_id'
      ]
      else array[]::text[]
    end;

    v_required_fields := case v_table
      when 'settings' then array['id','lodge_id']
      when 'rooms' then array['id','lodge_id','room_number','room_type','rate_per_night','max_occupancy']
      when 'customers' then array['id','lodge_id','name']
      when 'bookings' then array['id','lodge_id','check_in','check_out','total_amount','charges_total']
      when 'quotations' then array['id','lodge_id','total_amount']
      when 'signed_payment_ledger' then array['id','lodge_id','amount','type','paid_at']
      when 'maintenance' then array['id','lodge_id','room_id','title','reported_date']
      else array[]::text[]
    end;

    for v_row in select value from jsonb_array_elements(v_tables->v_table) loop
      if jsonb_typeof(v_row) <> 'object' then
        raise exception 'Every % row must be a JSON object.', v_table using errcode = '22023';
      end if;
      for v_field in select key from jsonb_each(v_row) loop
        if lower(v_field) = any(v_protected_fields) then
          raise exception 'Protected field % is not accepted in %.', v_field, v_table using errcode = '22023';
        end if;
        if not (v_field = any(v_expected_fields)) then
          raise exception 'Unsupported field % in %.', v_field, v_table using errcode = '22023';
        end if;
      end loop;
      foreach v_field in array v_required_fields loop
        if v_row->>v_field is null or btrim(v_row->>v_field) = '' then
          raise exception 'Required field % is missing in %.', v_field, v_table using errcode = '22023';
        end if;
      end loop;
      if v_row->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'Row ID in % must be a UUID.', v_table using errcode = '22023';
      end if;
      if v_row->>'lodge_id' <> v_recovery_lodge_id then
        raise exception 'Row in % is outside the requested recovery lodge.', v_table using errcode = '22023';
      end if;

      for v_field in select key from jsonb_each(v_row) loop
        if v_field = any(v_uuid_fields) then
          if v_row->v_field is not null
             and jsonb_typeof(v_row->v_field) <> 'null'
             and (jsonb_typeof(v_row->v_field) <> 'string'
                  or v_row->>v_field !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') then
            raise exception 'UUID field % in % is invalid.', v_field, v_table using errcode = '22023';
          end if;
        elsif v_field = any(v_numeric_fields) then
          if v_row->v_field is not null and jsonb_typeof(v_row->v_field) <> 'null'
             and jsonb_typeof(v_row->v_field) <> 'number' then
            raise exception 'Numeric field % in % must be a JSON number.', v_field, v_table using errcode = '22023';
          end if;
          if v_field = any(v_integer_fields)
             and v_row->v_field is not null
             and jsonb_typeof(v_row->v_field) = 'number'
             and v_row->>v_field !~ '^-?[0-9]+$' then
            raise exception 'Integer field % in % must be integral.', v_field, v_table using errcode = '22023';
          end if;
        elsif v_field = any(v_boolean_fields) then
          if v_row->v_field is not null and jsonb_typeof(v_row->v_field) <> 'null'
             and jsonb_typeof(v_row->v_field) <> 'boolean' then
            raise exception 'Boolean field % in % must be a JSON boolean.', v_field, v_table using errcode = '22023';
          end if;
        elsif v_field = any(v_array_fields) then
          if v_row->v_field is not null and jsonb_typeof(v_row->v_field) <> 'null'
             and jsonb_typeof(v_row->v_field) <> 'array' then
            raise exception 'Array field % in % must be a JSON array.', v_field, v_table using errcode = '22023';
          end if;
        elsif v_field = any(v_object_fields) then
          if v_row->v_field is not null and jsonb_typeof(v_row->v_field) <> 'null'
             and jsonb_typeof(v_row->v_field) <> 'object' then
            raise exception 'Object field % in % must be a JSON object.', v_field, v_table using errcode = '22023';
          end if;
        elsif v_row->v_field is not null and jsonb_typeof(v_row->v_field) <> 'null'
              and jsonb_typeof(v_row->v_field) <> 'string' then
          raise exception 'Field % in % must be a JSON string.', v_field, v_table using errcode = '22023';
        end if;
      end loop;

      if v_table = 'signed_payment_ledger' then
        v_amount := (v_row->>'amount')::numeric;
        v_type := lower(v_row->>'type');
        if v_type not in ('deposit','payment','refund','retention_fee') then
          raise exception 'Unsupported signed payment type %.', v_type using errcode = '22023';
        end if;
        if v_type = 'refund' and v_amount >= 0 then
          raise exception 'Refund ledger entries must be negative.' using errcode = '22023';
        elsif v_type <> 'refund' and v_amount <= 0 then
          raise exception 'Payment ledger entries must be positive.' using errcode = '22023';
        end if;
        if nullif(v_row->>'conference_booking_id','') is not null
           or nullif(v_row->>'_unresolved_conference_ref','') is not null then
          raise exception 'Conference payment references are outside the disposable restore scope.' using errcode = '22023';
        end if;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public._starter_recovery_validate_payload(jsonb)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Atomic disposable restore
-- ---------------------------------------------------------------------------
create or replace function public.admin_execute_starter_disposable_restore(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation_id text;
  v_source_lodge_id uuid;
  v_recovery_lodge_id uuid;
  v_reason text;
  v_ticket_ref text;
  v_package_sha256 text;
  v_package_bytes integer;
  v_payload_sha256 text;
  v_tables jsonb;
  v_counts jsonb;
  v_hashes jsonb;
  v_actor uuid := public.app_current_user_id();
  v_actor_email text;
  v_payload_actor uuid;
  v_existing public.starter_recovery_operations%rowtype;
  v_elem jsonb;
  v_result jsonb;
  v_amount numeric;
  v_type text;
  v_id uuid;
  v_unresolved_room_type_refs integer := 0;
  v_unresolved_floor_section_refs integer := 0;
begin
  -- This is intentionally stronger than a UI capability check.  The only
  -- callable role is service_role; Command Central must have already checked
  -- master-admin identity + command_central.recovery.manage.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Disposable recovery is restricted to the Command Central service path.' using errcode = '42501';
  end if;

  perform public._starter_recovery_validate_payload(p_payload);

  v_operation_id := p_payload->>'operation_id';
  v_source_lodge_id := (p_payload->>'source_lodge_id')::uuid;
  v_recovery_lodge_id := (p_payload->>'recovery_lodge_id')::uuid;
  v_reason := btrim(p_payload->>'reason');
  v_ticket_ref := btrim(p_payload->>'ticket_ref');
  v_payload_actor := nullif(p_payload->>'actor_id','')::uuid;
  v_actor_email := nullif(lower(btrim(p_payload->>'actor_email')), '');
  if v_payload_actor is not null and v_actor is not null and v_payload_actor <> v_actor then
    raise exception 'Payload actor_id does not match the authenticated operator.' using errcode = '42501';
  end if;
  v_actor := coalesce(v_actor, v_payload_actor);
  v_package_sha256 := p_payload->>'package_sha256';
  v_package_bytes := coalesce((p_payload->>'package_bytes')::integer, pg_column_size(p_payload));
  v_payload_sha256 := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  v_tables := p_payload->'tables';
  v_counts := p_payload->'counts';
  v_hashes := p_payload->'per_table_hashes';

  -- Room-type and floor-section dimension rows are intentionally outside the
  -- seven-table package.  Count source references for the report, then leave
  -- the target foreign keys NULL: never cross-lodge-link and never invent
  -- placeholder dimensions merely to make a restore appear complete.
  select count(*) filter (where nullif(elem->>'room_type_id','') is not null),
         count(*) filter (where nullif(elem->>'floor_section_id','') is not null)
    into v_unresolved_room_type_refs, v_unresolved_floor_section_refs
    from jsonb_array_elements(v_tables->'rooms') as item(elem);

  if not exists (
    select 1 from public.settings s
     where s.lodge_id = v_source_lodge_id
       and coalesce(s.is_disposable_recovery, false) = false
  ) then
    raise exception 'Source lodge is missing or already quarantined.' using errcode = '22023';
  end if;
  if exists (select 1 from public.settings s where s.lodge_id = v_recovery_lodge_id) then
    raise exception 'Recovery lodge ID is already in use.' using errcode = '23505';
  end if;

  -- Serialize retries for the same operation before comparing payload metadata.
  perform pg_advisory_xact_lock(hashtextextended(v_operation_id, 0));
  select * into v_existing
    from public.starter_recovery_operations
   where operation_id = v_operation_id
   for update;
  if found then
    if v_existing.source_lodge_id is distinct from v_source_lodge_id
       or v_existing.recovery_lodge_id is distinct from v_recovery_lodge_id
       or v_existing.reason is distinct from v_reason
       or v_existing.ticket_ref is distinct from v_ticket_ref
       or v_existing.package_sha256 is distinct from v_package_sha256
       or v_existing.package_bytes is distinct from v_package_bytes
       or v_existing.payload_sha256 is distinct from v_payload_sha256
       or v_existing.actor_id is distinct from v_actor
       or v_existing.actor_email is distinct from v_actor_email
       or v_existing.target_mode <> 'disposable' then
      raise exception 'Operation ID was reused with a different payload.' using errcode = '23505';
    end if;
    if v_existing.status = 'verified' then
      return coalesce(v_existing.result, '{}'::jsonb)
        || jsonb_build_object('success', true, 'idempotent', true);
    end if;
    raise exception 'Recovery operation is not retryable in status %.', v_existing.status using errcode = '55000';
  end if;

  insert into public.starter_recovery_operations (
    operation_id, source_lodge_id, recovery_lodge_id, actor_id, actor_email, reason,
    ticket_ref, target_mode, status, package_sha256, package_bytes,
    payload_sha256, table_counts, per_table_hashes,
    unresolved_room_type_refs, unresolved_floor_section_refs
  ) values (
    v_operation_id, v_source_lodge_id, v_recovery_lodge_id, v_actor, v_actor_email, v_reason,
    v_ticket_ref, 'disposable', 'executing', v_package_sha256, v_package_bytes,
    v_payload_sha256, v_counts, v_hashes,
    v_unresolved_room_type_refs, v_unresolved_floor_section_refs
  );

  -- Settings is the quarantine anchor.  Secrets and credentials are never
  -- included in the allowlist or copied into the recovery lodge.
  insert into public.settings (
    lodge_id, lodge_name, company_name, address, city, country, phone, email,
    website, vat_number, currency, setup_complete, created_at, updated_at,
    business_type, property_type, vat_enabled, vat_rate, deleted, slug,
    booking_tagline, booking_description, whatsapp_number,
    booking_check_in_from, booking_check_out_until, booking_cancellation_policy,
    booking_payment_terms, booking_house_rules, booking_faq, assistant_enabled,
    timezone, public_offer_rooms, public_offer_multi_room, public_offer_full_lodge,
    public_offer_day_use, public_offer_events, public_offer_campsites,
    operating_profile, is_disposable_recovery
  )
  select v_recovery_lodge_id,
         coalesce(nullif(s->>'lodge_name',''), 'Disposable Recovery Lodge') || ' [RECOVERY]',
         s->>'company_name', s->>'address', s->>'city', s->>'country',
         s->>'phone', s->>'email', s->>'website', s->>'vat_number',
         coalesce(nullif(s->>'currency',''), 'BWP'), true,
         coalesce((s->>'created_at')::timestamptz, now()), now(),
         s->>'business_type', s->>'property_type',
         coalesce((s->>'vat_enabled')::boolean, false),
         coalesce((s->>'vat_rate')::numeric, 0), false,
         left(coalesce(nullif(s->>'slug',''), 'recovery') || '-recovery-' || left(v_recovery_lodge_id::text, 8), 255),
         s->>'booking_tagline', s->>'booking_description', s->>'whatsapp_number',
         s->>'booking_check_in_from', s->>'booking_check_out_until',
         s->>'booking_cancellation_policy', s->>'booking_payment_terms',
         s->>'booking_house_rules', coalesce(s->'booking_faq', '[]'::jsonb),
         coalesce((s->>'assistant_enabled')::boolean, false), s->>'timezone',
         coalesce((s->>'public_offer_rooms')::boolean, true),
         coalesce((s->>'public_offer_multi_room')::boolean, false),
         coalesce((s->>'public_offer_full_lodge')::boolean, false),
         coalesce((s->>'public_offer_day_use')::boolean, false),
         coalesce((s->>'public_offer_events')::boolean, false),
         coalesce((s->>'public_offer_campsites')::boolean, true),
         coalesce(s->'operating_profile', '{}'::jsonb), true
    from jsonb_array_elements(v_tables->'settings') as setting(s);

  -- FK-safe parent tables first.  authoritative room columns are
  -- rate_per_night and max_occupancy (not legacy aliases).  Dimension rows
  -- are not part of this package, so source dimension IDs are not copied.
  insert into public.rooms (
    id, lodge_id, room_number, room_type, rate_per_night, max_occupancy, status,
    housekeeping_status, housekeeping_notes, description, created_at, updated_at,
    amenities, room_type_id, floor_section_id, accommodation_kind,
    capacity_adults, capacity_children, max_tents, max_vehicles, is_powered,
    site_surface, shared_facilities, rate_mode, rate_per_person, rate_per_tent,
    rate_per_vehicle
  )
  select (elem->>'id')::uuid, v_recovery_lodge_id, elem->>'room_number',
         elem->>'room_type', (elem->>'rate_per_night')::numeric,
         (elem->>'max_occupancy')::integer, coalesce(elem->>'status','available'),
         elem->>'housekeeping_status', elem->>'housekeeping_notes',
         coalesce(elem->>'description',''),
         coalesce((elem->>'created_at')::timestamptz, now()), now(),
         case when elem->'amenities' is null then '{}'::text[]
              else array(select jsonb_array_elements_text(elem->'amenities')) end,
         null::uuid,
         null::uuid,
         coalesce(elem->>'accommodation_kind','room'),
         nullif(elem->>'capacity_adults','')::integer,
         nullif(elem->>'capacity_children','')::integer,
         nullif(elem->>'max_tents','')::integer,
         nullif(elem->>'max_vehicles','')::integer,
         coalesce((elem->>'is_powered')::boolean, false), elem->>'site_surface',
         coalesce((elem->>'shared_facilities')::boolean, false),
         coalesce(elem->>'rate_mode','site'),
         coalesce((elem->>'rate_per_person')::numeric, 0),
         coalesce((elem->>'rate_per_tent')::numeric, 0),
         coalesce((elem->>'rate_per_vehicle')::numeric, 0)
    from jsonb_array_elements(v_tables->'rooms') as item(elem);

  insert into public.customers (
    id, lodge_id, name, email, phone, id_number, address, nationality, notes,
    is_blacklisted, blacklist_reason, created_at, updated_at
  )
  select (elem->>'id')::uuid, v_recovery_lodge_id, elem->>'name', elem->>'email',
         elem->>'phone', elem->>'id_number', elem->>'address', elem->>'nationality',
         elem->>'notes', coalesce((elem->>'is_blacklisted')::boolean, false),
         elem->>'blacklist_reason', coalesce((elem->>'created_at')::timestamptz, now()),
         coalesce((elem->>'updated_at')::timestamptz, now())
    from jsonb_array_elements(v_tables->'customers') as item(elem);

  if exists (
    select 1
      from jsonb_array_elements(v_tables->'bookings') as item(elem)
     where nullif(elem->>'room_id','') is not null
       and not exists (
         select 1 from public.rooms r
          where r.id = (elem->>'room_id')::uuid and r.lodge_id = v_recovery_lodge_id
       )
  ) then
    raise exception 'A booking references a room outside the recovery set.' using errcode = '23503';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_tables->'bookings') as item(elem)
     where nullif(elem->>'customer_id','') is not null
       and not exists (
         select 1 from public.customers c
          where c.id = (elem->>'customer_id')::uuid and c.lodge_id = v_recovery_lodge_id
       )
  ) then
    raise exception 'A booking references a customer outside the recovery set.' using errcode = '23503';
  end if;

  -- Booking quotation_id is intentionally NULL here: bookings and quotations
  -- have a mutual FK.  Both sides are linked only after both parent inserts.
  -- booking_number is generated by the production trigger/sequence and
  -- created_by points to excluded staff accounts, so neither is copied.
  insert into public.bookings (
    id, lodge_id, room_id, customer_id, check_in, check_out, adults, children,
    total_amount, deposit_amount, payment_method, status, notes, updated_at, created_at,
    is_exclusive_event, event_daily_rate, charges_total, vat_enabled, vat_rate,
    cancel_reason, cancelled_at, invoice_number
  )
  select (elem->>'id')::uuid, v_recovery_lodge_id,
         nullif(elem->>'room_id','')::uuid, nullif(elem->>'customer_id','')::uuid,
         (elem->>'check_in')::date, (elem->>'check_out')::date,
         coalesce((elem->>'adults')::integer, 1), coalesce((elem->>'children')::integer, 0),
         (elem->>'total_amount')::numeric,
         nullif(elem->>'deposit_amount','')::numeric, elem->>'payment_method', coalesce(elem->>'status','confirmed'),
         elem->>'notes', coalesce((elem->>'updated_at')::timestamptz, now()),
         coalesce((elem->>'created_at')::timestamptz, now()),
         coalesce((elem->>'is_exclusive_event')::boolean, false),
         nullif(elem->>'event_daily_rate','')::numeric,
         coalesce((elem->>'charges_total')::numeric, 0),
         coalesce((elem->>'vat_enabled')::boolean, false),
         coalesce((elem->>'vat_rate')::numeric, 0), elem->>'cancel_reason',
         nullif(elem->>'cancelled_at','')::timestamptz, elem->>'invoice_number'
    from jsonb_array_elements(v_tables->'bookings') as item(elem);

  if exists (
    select 1
      from jsonb_array_elements(v_tables->'quotations') as item(elem)
     where nullif(elem->>'customer_id','') is not null
       and not exists (
         select 1 from public.customers c
          where c.id = (elem->>'customer_id')::uuid and c.lodge_id = v_recovery_lodge_id
       )
  ) then
    raise exception 'A quotation references a customer outside the recovery set.' using errcode = '23503';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_tables->'quotations') as item(elem)
     where nullif(elem->>'room_id','') is not null
       and not exists (
         select 1 from public.rooms r
          where r.id = (elem->>'room_id')::uuid and r.lodge_id = v_recovery_lodge_id
       )
  ) then
    raise exception 'A quotation references a room outside the recovery set.' using errcode = '23503';
  end if;

  insert into public.quotations (
    id, quotation_number, lodge_id, customer_id, customer_name, room_id, room_name,
    check_in, check_out, adults, children, total_amount, currency, notes, status,
    valid_until, created_at, updated_at, customer_phone, subtotal, tax_amount,
    quotation_type, event_name, event_daily_rate, accommodation_lines
  )
  select (elem->>'id')::uuid,
         left('REC-' || replace(elem->>'id','-',''), 60),
         v_recovery_lodge_id, nullif(elem->>'customer_id','')::uuid,
         coalesce(nullif(elem->>'customer_name',''), c.name, 'Recovered guest'),
         nullif(elem->>'room_id','')::uuid,
         coalesce(nullif(elem->>'room_name',''), r.room_number, ''),
         nullif(elem->>'check_in','')::date, nullif(elem->>'check_out','')::date,
         coalesce((elem->>'adults')::integer, 1), coalesce((elem->>'children')::integer, 0),
         (elem->>'total_amount')::numeric, coalesce(nullif(elem->>'currency',''), 'BWP'),
         coalesce(elem->>'notes',''), coalesce(elem->>'status','draft'),
         nullif(elem->>'valid_until','')::date,
         coalesce((elem->>'created_at')::timestamptz, now()),
         coalesce((elem->>'updated_at')::timestamptz, now()), elem->>'customer_phone',
         nullif(elem->>'subtotal','')::numeric, nullif(elem->>'tax_amount','')::numeric,
         coalesce(nullif(elem->>'quotation_type',''), 'room'), elem->>'event_name',
         nullif(elem->>'event_daily_rate','')::numeric,
         case when jsonb_typeof(elem->'accommodation_lines') = 'array'
              then elem->'accommodation_lines' else null end
    from jsonb_array_elements(v_tables->'quotations') as item(elem)
    left join public.customers c
      on c.id = nullif(elem->>'customer_id','')::uuid
     and c.lodge_id = v_recovery_lodge_id
    left join public.rooms r
      on r.id = nullif(elem->>'room_id','')::uuid
     and r.lodge_id = v_recovery_lodge_id;

  -- Complete the mutual quotation/booking relation only with target-lodge IDs.
  for v_elem in select value from jsonb_array_elements(v_tables->'quotations') loop
    v_id := nullif(v_elem->>'converted_booking_id','')::uuid;
    if v_id is not null then
      if not exists (select 1 from public.bookings b where b.id = v_id and b.lodge_id = v_recovery_lodge_id) then
        raise exception 'A quotation references a booking outside the recovery set.' using errcode = '23503';
      end if;
      update public.quotations
         set converted_booking_id = v_id,
             updated_at = now()
       where id = (v_elem->>'id')::uuid
         and lodge_id = v_recovery_lodge_id;
    end if;
    v_id := nullif(v_elem->>'parent_quotation_id','')::uuid;
    if v_id is not null then
      if not exists (select 1 from public.quotations q where q.id = v_id and q.lodge_id = v_recovery_lodge_id) then
        raise exception 'A quotation references a parent quotation outside the recovery set.' using errcode = '23503';
      end if;
      update public.quotations
         set parent_quotation_id = v_id,
             updated_at = now()
       where id = (v_elem->>'id')::uuid
         and lodge_id = v_recovery_lodge_id;
    end if;
  end loop;
  for v_elem in select value from jsonb_array_elements(v_tables->'bookings') loop
    v_id := nullif(v_elem->>'quotation_id','')::uuid;
    if v_id is not null then
      if not exists (select 1 from public.quotations q where q.id = v_id and q.lodge_id = v_recovery_lodge_id) then
        raise exception 'A booking references a quotation outside the recovery set.' using errcode = '23503';
      end if;
      update public.bookings
         set quotation_id = v_id,
             updated_at = now()
       where id = (v_elem->>'id')::uuid
         and lodge_id = v_recovery_lodge_id;
    end if;
  end loop;

  -- Validate signed deltas and target booking references before ledger insert.
  for v_elem in select value from jsonb_array_elements(v_tables->'signed_payment_ledger') loop
    v_amount := (v_elem->>'amount')::numeric;
    v_type := lower(v_elem->>'type');
    if v_type = 'refund' and v_amount >= 0 then
      raise exception 'Refund ledger entries must be negative.' using errcode = '22023';
    elsif v_type <> 'refund' and v_amount <= 0 then
      raise exception 'Payment ledger entries must be positive.' using errcode = '22023';
    end if;
    v_id := nullif(v_elem->>'booking_id','')::uuid;
    if v_id is not null
       and not exists (select 1 from public.bookings b where b.id = v_id and b.lodge_id = v_recovery_lodge_id) then
      raise exception 'A payment references a booking outside the recovery set.' using errcode = '23503';
    end if;
    if nullif(v_elem->>'conference_booking_id','') is not null
       or nullif(v_elem->>'_unresolved_conference_ref','') is not null then
      raise exception 'Conference payment references are outside the disposable recovery scope.' using errcode = '22023';
    end if;
  end loop;

  insert into public.payments (
    id, lodge_id, booking_id, amount, method, type, paid_at, notes, created_at
  )
  select (elem->>'id')::uuid, v_recovery_lodge_id,
         nullif(elem->>'booking_id','')::uuid, (elem->>'amount')::numeric,
         coalesce(nullif(elem->>'method',''), 'cash'), lower(elem->>'type'),
         coalesce((elem->>'paid_at')::timestamptz, now()), elem->>'notes',
         coalesce((elem->>'created_at')::timestamptz, now())
    from jsonb_array_elements(v_tables->'signed_payment_ledger') as item(elem);

  -- A maintenance ticket requires a target room in the current schema.
  if exists (
    select 1
      from jsonb_array_elements(v_tables->'maintenance') as item(elem)
     where not exists (
       select 1 from public.rooms r
        where r.id = (elem->>'room_id')::uuid and r.lodge_id = v_recovery_lodge_id
     )
  ) then
    raise exception 'A maintenance ticket references a room outside the recovery set.' using errcode = '23503';
  end if;
  insert into public.maintenance_tickets (
    id, lodge_id, room_id, title, description, priority, status, reported_date,
    notes, created_at, labour_cost, parts_cost, total_cost, vendor_name, cost_notes
  )
  select (elem->>'id')::uuid, v_recovery_lodge_id, (elem->>'room_id')::uuid,
         elem->>'title', elem->>'description', coalesce(elem->>'priority','medium'),
         coalesce(elem->>'status','open'), (elem->>'reported_date')::date,
         elem->>'notes', coalesce((elem->>'created_at')::timestamptz, now()),
         nullif(elem->>'labour_cost','')::numeric, nullif(elem->>'parts_cost','')::numeric,
         nullif(elem->>'total_cost','')::numeric, elem->>'vendor_name', elem->>'cost_notes'
    from jsonb_array_elements(v_tables->'maintenance') as item(elem);

  -- Financial truth is reconstructed from signed ledger deltas.  The import
  -- payload cannot set amount_paid or payment_status, and these values are
  -- derived only after all target-lodge payments exist.
  with ledger_totals as (
    select b.id,
           round(coalesce(sum(p.amount), 0), 2) as amount_paid,
           b.total_amount,
           b.charges_total
      from public.bookings b
      left join public.payments p
        on p.booking_id = b.id
       and p.lodge_id = v_recovery_lodge_id
     where b.lodge_id = v_recovery_lodge_id
     group by b.id, b.total_amount, b.charges_total
  )
  update public.bookings b
     set amount_paid = t.amount_paid,
         payment_status = public.compute_payment_status(t.amount_paid, t.total_amount, t.charges_total),
         updated_at = now()
    from ledger_totals t
   where b.id = t.id
     and b.lodge_id = v_recovery_lodge_id;

  v_result := jsonb_build_object(
    'success', true,
    'idempotent', false,
    'operation_id', v_operation_id,
    'source_lodge_id', v_source_lodge_id,
    'recovery_lodge_id', v_recovery_lodge_id,
    'actor_id', v_actor,
    'actor_email', v_actor_email,
    'target_mode', 'disposable',
    'quarantined', true,
    'warnings', jsonb_build_object(
      'unresolved_room_type_references', v_unresolved_room_type_refs,
      'unresolved_floor_section_references', v_unresolved_floor_section_refs,
      'dimension_rows_not_in_package', true
    ),
    'package_sha256', v_package_sha256,
    'payload_sha256', v_payload_sha256,
    'table_counts', jsonb_build_object(
      'settings', (select count(*) from public.settings where lodge_id = v_recovery_lodge_id),
      'rooms', (select count(*) from public.rooms where lodge_id = v_recovery_lodge_id),
      'customers', (select count(*) from public.customers where lodge_id = v_recovery_lodge_id),
      'bookings', (select count(*) from public.bookings where lodge_id = v_recovery_lodge_id),
      'quotations', (select count(*) from public.quotations where lodge_id = v_recovery_lodge_id),
      'signed_payment_ledger', (select count(*) from public.payments where lodge_id = v_recovery_lodge_id),
      'maintenance', (select count(*) from public.maintenance_tickets where lodge_id = v_recovery_lodge_id)
    ),
    'ledger_reconciliation', jsonb_build_object(
      'payment_count', (select count(*) from public.payments where lodge_id = v_recovery_lodge_id),
      'gross_positive', (select coalesce(sum(amount) filter (where amount > 0), 0) from public.payments where lodge_id = v_recovery_lodge_id),
      'refund_negative', (select coalesce(sum(amount) filter (where amount < 0), 0) from public.payments where lodge_id = v_recovery_lodge_id),
      'net_delta', (select coalesce(sum(amount), 0) from public.payments where lodge_id = v_recovery_lodge_id)
    )
  );
  update public.starter_recovery_operations
     set status = 'verified', result = v_result, updated_at = now()
   where operation_id = v_operation_id;
  insert into public.starter_recovery_audit_log (
    operation_id, lodge_id, recovery_lodge_id, event_type, actor_id, actor_email,
    package_sha256, payload_sha256, table_counts, metadata
  ) values (
    v_operation_id, v_source_lodge_id, v_recovery_lodge_id, 'verified', v_actor, v_actor_email,
    v_package_sha256, v_payload_sha256, v_result->'table_counts',
    jsonb_build_object(
      'target_mode', 'disposable',
      'quarantined', true,
      'warnings', jsonb_build_object(
        'unresolved_room_type_references', v_unresolved_room_type_refs,
        'unresolved_floor_section_references', v_unresolved_floor_section_refs,
        'dimension_rows_not_in_package', true
      )
    )
  );
  return v_result;
-- Do not add an EXCEPTION handler here.  PostgreSQL rolls back the complete
-- transaction, including operation, target rows, and audit row, on failure.
-- A durable failed-attempt audit requires a separate out-of-transaction
-- logging design; falsely claiming that a rolled-back failure was audited is
-- worse than returning the error to the trusted caller.
end;
$$;

revoke all on function public.admin_execute_starter_disposable_restore(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_execute_starter_disposable_restore(jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Authoritative post-restore verification
-- ---------------------------------------------------------------------------
create or replace function public.admin_verify_starter_disposable_restore(p_operation_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_operation public.starter_recovery_operations%rowtype;
  v_counts jsonb;
  v_manifest_counts jsonb;
  v_quarantined boolean;
  v_isolated boolean;
  v_payment_count bigint;
  v_gross_positive numeric;
  v_refund_negative numeric;
  v_net_delta numeric;
  v_counts_match boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Disposable recovery verification is service-role only.' using errcode = '42501';
  end if;
  if p_operation_id is null
     or p_operation_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A UUID v4 operation ID is required.' using errcode = '22023';
  end if;
  select * into v_operation
    from public.starter_recovery_operations
   where operation_id = p_operation_id;
  if not found then
    raise exception 'Recovery operation was not found.' using errcode = '22023';
  end if;

  v_counts := jsonb_build_object(
    'settings', (select count(*) from public.settings where lodge_id = v_operation.recovery_lodge_id),
    'rooms', (select count(*) from public.rooms where lodge_id = v_operation.recovery_lodge_id),
    'customers', (select count(*) from public.customers where lodge_id = v_operation.recovery_lodge_id),
    'bookings', (select count(*) from public.bookings where lodge_id = v_operation.recovery_lodge_id),
    'quotations', (select count(*) from public.quotations where lodge_id = v_operation.recovery_lodge_id),
    'signed_payment_ledger', (select count(*) from public.payments where lodge_id = v_operation.recovery_lodge_id),
    'maintenance', (select count(*) from public.maintenance_tickets where lodge_id = v_operation.recovery_lodge_id)
  );
  v_manifest_counts := coalesce(v_operation.table_counts, '{}'::jsonb);
  v_counts_match := v_counts = v_manifest_counts;
  select coalesce(s.is_disposable_recovery, false)
    into v_quarantined
    from public.settings s
   where s.lodge_id = v_operation.recovery_lodge_id
   limit 1;
  v_quarantined := coalesce(v_quarantined, false);

  -- Check all restored cross-lodge references, including nullable booking
  -- payment references.  This is an isolation probe, not a UI assertion.
  v_isolated := not exists (
    select 1 from public.bookings b
    left join public.rooms r on r.id = b.room_id
    left join public.customers c on c.id = b.customer_id
    left join public.quotations q on q.id = b.quotation_id
    where b.lodge_id = v_operation.recovery_lodge_id
      and (
        (b.room_id is not null and (r.id is null or r.lodge_id <> v_operation.recovery_lodge_id))
        or (b.customer_id is not null and (c.id is null or c.lodge_id <> v_operation.recovery_lodge_id))
        or (b.quotation_id is not null and (q.id is null or q.lodge_id <> v_operation.recovery_lodge_id))
      )
  ) and not exists (
    select 1 from public.quotations q
    left join public.bookings b on b.id = q.converted_booking_id
    where q.lodge_id = v_operation.recovery_lodge_id
      and q.converted_booking_id is not null
      and (b.id is null or b.lodge_id <> v_operation.recovery_lodge_id)
  ) and not exists (
    select 1 from public.payments p
    left join public.bookings b on b.id = p.booking_id
    where p.lodge_id = v_operation.recovery_lodge_id
      and p.booking_id is not null
      and (b.id is null or b.lodge_id <> v_operation.recovery_lodge_id)
  ) and not exists (
    select 1 from public.maintenance_tickets m
    left join public.rooms r on r.id = m.room_id
    where m.lodge_id = v_operation.recovery_lodge_id
      and (r.id is null or r.lodge_id <> v_operation.recovery_lodge_id)
  );

  select count(*),
         coalesce(sum(amount) filter (where amount > 0), 0),
         coalesce(sum(amount) filter (where amount < 0), 0),
         coalesce(sum(amount), 0)
    into v_payment_count, v_gross_positive, v_refund_negative, v_net_delta
    from public.payments
   where lodge_id = v_operation.recovery_lodge_id;

  return jsonb_build_object(
    'success', (v_operation.status = 'verified' and v_counts_match and v_quarantined and v_isolated),
    'status', v_operation.status,
    'operation_id', v_operation.operation_id,
    'source_lodge_id', v_operation.source_lodge_id,
    'recovery_lodge_id', v_operation.recovery_lodge_id,
    'actor_id', v_operation.actor_id,
    'actor_email', v_operation.actor_email,
    'target_mode', v_operation.target_mode,
    'quarantined', v_quarantined,
    'isolation_ok', v_isolated,
    'counts', v_counts,
    'manifest_counts', v_manifest_counts,
    'counts_match', v_counts_match,
    'warnings', jsonb_build_object(
      'unresolved_room_type_references',
        coalesce(v_operation.unresolved_room_type_refs, 0),
      'unresolved_floor_section_references',
        coalesce(v_operation.unresolved_floor_section_refs, 0),
      'dimension_rows_not_in_package', true
    ),
    'ledger_reconciliation', jsonb_build_object(
      'payment_count', v_payment_count,
      'gross_positive', v_gross_positive,
      'refund_negative', v_refund_negative,
      'net_delta', v_net_delta
    ),
    'package_sha256', v_operation.package_sha256,
    'package_bytes', v_operation.package_bytes,
    'payload_sha256', v_operation.payload_sha256,
    'per_table_hashes', v_operation.per_table_hashes,
    'idempotency', jsonb_build_object(
      'operation_id', v_operation.operation_id,
      'payload_sha256', v_operation.payload_sha256,
      'replay_is_safe', (v_operation.status = 'verified')
    )
  );
end;
$$;

revoke all on function public.admin_verify_starter_disposable_restore(text)
  from public, anon, authenticated;
grant execute on function public.admin_verify_starter_disposable_restore(text)
  to service_role;

notify pgrst, 'reload schema';

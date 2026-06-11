--
-- PostgreSQL database dump
--

\restrict 1IsXc1BpiF4mZd94uUpOXs1rvfdzeHMCdsTq8erhSJnhISCAFw6Au5NPIwtrYB4

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: -
--

CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


--
-- Name: _audit_booking_charge(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._audit_booking_charge() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_actor_raw text;
  v_actor     uuid;
  v_action    text;
  v_row       public.booking_charges%rowtype;
  v_before    jsonb;
  v_effective_quantity numeric;
  v_effective_unit_price numeric;
begin
  v_actor_raw := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor     := case when v_actor_raw ~ '^[0-9a-f\-]{36}$' then v_actor_raw::uuid else null end;

  if (tg_op = 'INSERT') then
    v_row    := new;
    v_action := 'charge_added';
    v_before := null;
  else
    v_row    := old;
    v_action := 'charge_deleted';
    v_before := null;
  end if;

  v_effective_quantity := coalesce(v_row.quantity, 1);
  v_effective_unit_price := case
    when nullif(v_effective_quantity, 0) is null then null
    else round(coalesce(v_row.amount, 0) / nullif(v_effective_quantity, 0), 2)
  end;

  select jsonb_build_object(
      'amount_paid',    b.amount_paid,
      'total_amount',   b.total_amount,
      'charges_total',  b.charges_total,
      'payment_status', b.payment_status
    )
    into v_before
    from public.bookings b
   where b.id = v_row.booking_id
   limit 1;

  insert into public.financial_audit_log (
    lodge_id, booking_id, action, actor_id,
    amount_delta, before_snapshot, after_snapshot
  ) values (
    v_row.lodge_id,
    v_row.booking_id,
    v_action,
    v_actor,
    case tg_op when 'INSERT' then v_row.amount else -v_row.amount end,
    v_before,
    jsonb_build_object(
      'charge_id',   v_row.id,
      'description', v_row.description,
      'category',    v_row.category,
      'quantity',    v_effective_quantity,
      'unit_price',  v_effective_unit_price,
      'amount',      v_row.amount,
      'outlet_id',   v_row.outlet_id
    )
  );
  return null;
end;
$_$;


--
-- Name: _audit_payment_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._audit_payment_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_actor_raw text;
  v_actor     uuid;
  v_action    text;
  v_before    jsonb;
begin
  v_actor_raw := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor := case when v_actor_raw ~ '^[0-9a-f\-]{36}$' then v_actor_raw::uuid else null end;
  v_action := case when lower(coalesce(new.type, '')) = 'refund' then 'refund_recorded' else 'payment_recorded' end;

  select jsonb_build_object('amount_paid', b.amount_paid, 'total_amount', b.total_amount, 'charges_total', b.charges_total, 'payment_status', b.payment_status)
  into v_before from public.bookings b where b.id = new.booking_id limit 1;

  insert into public.financial_audit_log (lodge_id, booking_id, action, actor_id, amount_delta, before_snapshot, after_snapshot, idempotency_key)
  values (new.lodge_id, new.booking_id, v_action, v_actor, new.amount, v_before,
    jsonb_build_object('payment_id', new.id, 'payment_type', new.type, 'payment_method', new.method, 'amount', new.amount, 'paid_at', new.paid_at),
    new.idempotency_key);
  return null;
end;
$_$;


--
-- Name: _generate_license_key(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._generate_license_key() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(12); -- Added extensions prefix
  v_result text := 'BB-';
  v_index integer;
BEGIN
  FOR v_index IN 0..11 LOOP
    v_result := v_result || substr(v_chars, (get_byte(v_bytes, v_index) % length(v_chars)) + 1, 1);
    IF v_index IN (3, 7) THEN
      v_result := v_result || '-';
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;


--
-- Name: _invoice_delivery_log_hash(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._invoice_delivery_log_hash() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_previous_hash text;
begin
  if new.previous_hash is null then
    select l.entry_hash
      into v_previous_hash
      from public.invoice_delivery_log l
     where l.lodge_id = new.lodge_id
     order by l.created_at desc, l.id desc
     limit 1;

    new.previous_hash := v_previous_hash;
  end if;

  new.entry_hash := encode(
    digest(
      coalesce(new.previous_hash, '') || '|' ||
      coalesce(new.lodge_id::text, '') || '|' ||
      coalesce(new.booking_id::text, '') || '|' ||
      coalesce(new.invoice_number, '') || '|' ||
      coalesce(new.delivery_type, '') || '|' ||
      coalesce(new.delivery_status, '') || '|' ||
      coalesce(new.recipient, '') || '|' ||
      coalesce(new.file_path, '') || '|' ||
      coalesce(new.render_version, '') || '|' ||
      coalesce(new.initiated_by::text, '') || '|' ||
      coalesce(new.metadata::text, '') || '|' ||
      coalesce(new.created_at::text, ''),
      'sha256'
    ),
    'hex'
  );
  return new;
end;
$$;


--
-- Name: _is_pwa_role_eligible(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._is_pwa_role_eligible(p_role text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select lower(coalesce(btrim(p_role), '')) in ('manager', 'admin');
$$;


--
-- Name: _license_plan_features(text, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._license_plan_features(p_plan text, p_trial boolean DEFAULT false, p_expired boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_plan text := lower(coalesce(btrim(p_plan), 'starter'));
begin
  if p_expired then
    return jsonb_build_object(
      'reports', false, 'expenses', false, 'staff', false, 'pwa', false,
      'audit', false, 'conference', false, 'pool', false, 'import', false,
      'pos', false, 'inventory', false, 'supplies', false,
      'online_booking', false
    );
  end if;
  if p_trial then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'pwa', true,
      'audit', true, 'conference', true, 'pool', true, 'import', true,
      'pos', true, 'inventory', true, 'supplies', true,
      'online_booking', true
    );
  end if;
  if v_plan in ('pro', 'premium') then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'pwa', true,
      'audit', true, 'conference', true, 'pool', true, 'import', true,
      'pos', true, 'inventory', true, 'supplies', true,
      'online_booking', true
    );
  end if;
  if v_plan = 'standard' then
    return jsonb_build_object(
      'reports', true, 'expenses', true, 'staff', true, 'pwa', false,
      'audit', true, 'conference', true, 'pool', true, 'import', true,
      'pos', false, 'inventory', false, 'supplies', false,
      'online_booking', false
    );
  end if;
  -- Starter
  return jsonb_build_object(
    'reports', false, 'expenses', false, 'staff', false, 'pwa', false,
    'audit', false, 'conference', false, 'pool', false, 'import', false,
    'pos', false, 'inventory', false, 'supplies', false,
    'online_booking', false
  );
end;
$$;


--
-- Name: _normalize_subscription_plan(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._normalize_subscription_plan(p_plan text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  v_plan text := lower(coalesce(btrim(p_plan), 'starter'));
begin
  if v_plan in ('premium', 'pro') then
    return 'Pro';
  end if;
  if v_plan = 'standard' then
    return 'Standard';
  end if;
  return 'Starter';
end;
$$;


--
-- Name: _offline_valid_until(text, timestamp with time zone, date, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._offline_valid_until(p_state text, p_expires_at timestamp with time zone, p_next_due_date date, p_grace_days integer, p_lease_days integer) RETURNS timestamp with time zone
    LANGUAGE plpgsql STABLE
    AS $$
declare
  v_state text := lower(coalesce(btrim(p_state), 'active'));
  v_lease_days integer := greatest(least(coalesce(p_lease_days, 7), 30), 1);
  v_candidate timestamptz := now() + make_interval(days => v_lease_days);
  v_grace_end timestamptz;
begin
  if v_state not in ('active', 'grace_period') then
    return now();
  end if;
  if p_next_due_date is not null then
    v_grace_end := (p_next_due_date + greatest(coalesce(p_grace_days, 7), 0))::timestamptz + interval '1 day';
    if v_grace_end < v_candidate then
      v_candidate := v_grace_end;
    end if;
  end if;
  if p_expires_at is not null and p_expires_at < v_candidate then
    v_candidate := p_expires_at;
  end if;
  return v_candidate;
end;
$$;


--
-- Name: _record_subscription_event(uuid, text, uuid, uuid, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._record_subscription_event(p_lodge_id uuid, p_lodge_key text, p_license_id uuid, p_invoice_id uuid, p_event_type text, p_event_status text, p_plan_name text, p_plan_version_code text, p_details jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_event_id uuid;
  v_actor_raw text := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor uuid := case when v_actor_raw ~ '^[0-9a-fA-F-]{36}$' then v_actor_raw::uuid else null end;
begin
  insert into public.subscription_events (
    lodge_id, lodge_key, license_id, invoice_id, event_type, event_status,
    plan_name, plan_version_code, actor_id, details
  ) values (
    p_lodge_id, p_lodge_key, p_license_id, p_invoice_id, p_event_type,
    coalesce(nullif(btrim(p_event_status), ''), 'completed'),
    p_plan_name, p_plan_version_code, v_actor, coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_event_id;
  return v_event_id;
end;
$_$;


--
-- Name: _restore_pos_order_stock(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._restore_pos_order_stock(p_order_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_line record;
  v_restored jsonb := '[]'::jsonb;
  v_delta numeric;
  v_new_stock numeric;
begin
  for v_line in
    select
      poi.quantity,
      coalesce(poi.inventory_item_id, pmi.inventory_item_id) as inventory_item_id,
      greatest(1, coalesce(poi.depletion_qty, pmi.depletion_qty, 1)) as depletion_qty
    from public.pos_order_items poi
    left join public.pos_menu_items pmi
      on pmi.id = poi.menu_item_id
     and pmi.lodge_id = p_lodge_id
    where poi.order_id = p_order_id
      and poi.lodge_id = p_lodge_id
  loop
    if v_line.inventory_item_id is not null then
      v_delta := greatest(0, coalesce(v_line.quantity, 0)) * greatest(1, coalesce(v_line.depletion_qty, 1));

      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) + v_delta
       where id = v_line.inventory_item_id
         and lodge_id = p_lodge_id
       returning current_stock into v_new_stock;

      v_restored := v_restored || jsonb_build_array(jsonb_build_object(
        'inventory_item_id', v_line.inventory_item_id,
        'restored_qty', v_delta,
        'new_stock', v_new_stock
      ));
    end if;
  end loop;

  return v_restored;
end;
$$;


--
-- Name: _subscription_access_allowed(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._subscription_access_allowed(p_state text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
  select coalesce(lower(btrim(p_state)), '') in ('active', 'grace_period');
$$;


--
-- Name: _subscription_state(text, date, timestamp with time zone, boolean, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._subscription_state(p_payment_status text, p_next_due_date date, p_expires_at timestamp with time zone, p_is_active boolean, p_grace_days integer DEFAULT 7) RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
declare
  v_payment_status text := lower(coalesce(btrim(p_payment_status), 'active'));
  v_grace_days integer := greatest(coalesce(p_grace_days, 7), 0);
  v_grace_end date;
begin
  if coalesce(p_is_active, true) = false then
    return 'inactive';
  end if;
  if v_payment_status = 'cancelled' then
    return 'cancelled';
  end if;
  if p_expires_at is not null and p_expires_at < now() then
    return 'expired';
  end if;
  if v_payment_status in ('suspended', 'paused') then
    return 'suspended';
  end if;
  if v_payment_status in ('trial', 'free') then
    return 'active';
  end if;
  if p_next_due_date is not null and p_next_due_date < current_date then
    v_grace_end := p_next_due_date + v_grace_days;
    if v_grace_end < current_date then
      return 'suspended';
    end if;
    return 'grace_period';
  end if;
  if v_payment_status = 'overdue' then
    if p_next_due_date is not null then
      v_grace_end := p_next_due_date + v_grace_days;
      if v_grace_end < current_date then
        return 'suspended';
      end if;
    end if;
    return 'grace_period';
  end if;
  return 'active';
end;
$$;


--
-- Name: activate_license_key(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.activate_license_key(p_lodge_id uuid, p_license_key text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_license public.licenses%rowtype;
  v_bound_lodge uuid;
  v_subscription_state text;
begin
  select * into v_license
  from public.licenses l
  where upper(btrim(l.license_key)) = upper(btrim(p_license_key))
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'License key not found. Please check and try again.');
  end if;
  if coalesce(v_license.is_active, true) = false then
    return jsonb_build_object('success', false, 'error', 'This license key has been deactivated.');
  end if;

  v_subscription_state := public._subscription_state(v_license.payment_status, v_license.next_due_date, v_license.expires_at, v_license.is_active, v_license.grace_period_days);
  if v_subscription_state in ('cancelled', 'expired', 'suspended') then
    return jsonb_build_object('success', false, 'error', 'This license key is not currently eligible for activation.');
  end if;

  v_bound_lodge := v_license.lodge_id;
  if v_bound_lodge is not null and v_bound_lodge <> p_lodge_id then
    return jsonb_build_object('success', false, 'error', 'This license key is already registered to another installation.');
  end if;

  update public.licenses
  set is_active = false,
      subscription_state = 'superseded',
      notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded during activation]'))
  where lodge_id = p_lodge_id
    and id <> v_license.id
    and coalesce(is_active, true) = true;

  update public.licenses
  set lodge_id = p_lodge_id,
      activated_at = coalesce(activated_at, now()),
      subscription_state = public._subscription_state(payment_status, next_due_date, expires_at, is_active, grace_period_days)
  where id = v_license.id;

  perform public._record_subscription_event(
    p_lodge_id, p_lodge_id::text, v_license.id, null,
    'license_activated', 'completed',
    public._normalize_subscription_plan(v_license.subscription_plan),
    coalesce(v_license.plan_version_code, '2026.04'),
    jsonb_build_object('license_key', v_license.license_key)
  );

  return public.get_lodge_entitlement(p_lodge_id);
end;
$$;


--
-- Name: add_booking_charge(uuid, uuid, text, text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_booking_charge(p_booking_id uuid, p_lodge_id uuid, p_description text, p_category text DEFAULT 'other'::text, p_quantity numeric DEFAULT 1, p_unit_price numeric DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_charge_id uuid;
  v_amount numeric;
begin
  perform public.app_reject_pwa_financial_mutation();

  if coalesce(p_unit_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Charge unit price must be greater than zero');
  end if;

  if not exists (
    select 1 from public.bookings
    where id = p_booking_id
      and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_amount := coalesce(p_quantity, 1) * coalesce(p_unit_price, 0);

  insert into public.booking_charges (
    booking_id, lodge_id, description, category, quantity, unit_price, amount
  ) values (
    p_booking_id,
    p_lodge_id,
    p_description,
    coalesce(nullif(p_category, ''), 'other'),
    coalesce(p_quantity, 1),
    coalesce(p_unit_price, 0),
    v_amount
  )
  returning id into v_charge_id;

  return jsonb_build_object('success', true, 'id', v_charge_id);
end;
$$;


--
-- Name: add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_booking_charge(p_booking_id uuid, p_lodge_id uuid, p_description text, p_category text DEFAULT 'other'::text, p_quantity numeric DEFAULT 1, p_unit_price numeric DEFAULT 0, p_outlet_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_charge_id uuid;
  v_amount numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if coalesce(p_unit_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Charge unit price must be greater than zero');
  end if;

  if not exists (
    select 1
      from public.bookings
     where id = p_booking_id
       and lodge_id = p_lodge_id
  ) then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_amount := coalesce(p_quantity, 1) * coalesce(p_unit_price, 0);

  insert into public.booking_charges (
    booking_id,
    lodge_id,
    description,
    category,
    quantity,
    unit_price,
    amount,
    outlet_id
  ) values (
    p_booking_id,
    p_lodge_id,
    p_description,
    coalesce(nullif(p_category, ''), 'other'),
    coalesce(p_quantity, 1),
    coalesce(p_unit_price, 0),
    v_amount,
    p_outlet_id
  )
  returning id into v_charge_id;

  return jsonb_build_object('success', true, 'id', v_charge_id);
end;
$$;


--
-- Name: add_booking_charge(uuid, uuid, text, text, numeric, numeric, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_booking_charge(p_booking_id uuid, p_lodge_id uuid, p_description text, p_category text DEFAULT 'other'::text, p_quantity numeric DEFAULT 1, p_unit_price numeric DEFAULT 0, p_outlet_id uuid DEFAULT NULL::uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_charge_id uuid;
  v_amount numeric;
  v_booking public.bookings%rowtype;
  v_effective_quantity numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if coalesce(p_unit_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Charge unit price must be greater than zero');
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
   for update;

  if v_booking.id is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_expected_updated_at is not null and v_booking.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  v_effective_quantity := coalesce(nullif(p_quantity, 0), 1);
  v_amount := v_effective_quantity * coalesce(p_unit_price, 0);

  insert into public.booking_charges (
    booking_id,
    lodge_id,
    description,
    category,
    quantity,
    amount,
    outlet_id
  ) values (
    p_booking_id,
    p_lodge_id,
    p_description,
    coalesce(nullif(p_category, ''), 'other'),
    v_effective_quantity,
    v_amount,
    p_outlet_id
  )
  returning id into v_charge_id;

  return jsonb_build_object('success', true, 'id', v_charge_id, 'amount', v_amount);
end;
$$;


--
-- Name: add_inventory_purchase(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_inventory_purchase(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_purchase_id uuid;
  v_item_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric;
  v_total numeric;
  v_unit_cost numeric;
  v_new_stock numeric;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  v_item_id := (payload->>'item_id')::uuid;
  v_qty := coalesce((payload->>'quantity_purchased')::numeric, 0);
  v_total := coalesce((payload->>'total_cost')::numeric, 0);
  v_unit_cost := coalesce((payload->>'unit_cost')::numeric, case when v_qty > 0 then v_total / v_qty else 0 end);

  insert into public.inventory_purchases (
    lodge_id,
    item_id,
    date,
    quantity_purchased,
    total_cost,
    unit_cost,
    notes
  ) values (
    v_lodge_id,
    v_item_id,
    (payload->>'date')::date,
    v_qty,
    v_total,
    v_unit_cost,
    nullif(payload->>'notes', '')
  )
  returning id into v_purchase_id;

  update public.inventory_items
     set current_stock = coalesce(current_stock, 0) + v_qty,
         latest_unit_cost = v_unit_cost
   where id = v_item_id
     and lodge_id = v_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'Inventory item not found';
  end if;

  return jsonb_build_object('success', true, 'id', v_purchase_id, 'new_stock', v_new_stock);
end;
$$;


--
-- Name: add_pool_day_use(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_pool_day_use(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id            uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id      uuid := (payload->>'lodge_id')::uuid;
  v_adults        integer := greatest(coalesce((payload->>'adults')::integer, 1), 0);
  v_children      integer := greatest(coalesce((payload->>'children')::integer, 0), 0);
  v_fee_per_adult numeric := coalesce((payload->>'fee_per_adult')::numeric, 0);
  v_fee_per_child numeric := coalesce((payload->>'fee_per_child')::numeric, 0);
  v_total         numeric;
begin
  if exists (
    select 1 from public.pool_day_use
    where id = v_id
      and lodge_id = v_lodge_id
  ) then
    select total into v_total
    from public.pool_day_use
    where id = v_id
      and lodge_id = v_lodge_id;
    return jsonb_build_object('success', true, 'id', v_id, 'total', v_total, 'idempotent', true);
  end if;

  if v_fee_per_adult < 0 or v_fee_per_adult > 999999.99 then
    raise exception 'Adult day-use fee must be between P0.00 and P999,999.99';
  end if;

  if v_fee_per_child < 0 or v_fee_per_child > 999999.99 then
    raise exception 'Child day-use fee must be between P0.00 and P999,999.99';
  end if;

  v_total := (v_adults * v_fee_per_adult) + (v_children * v_fee_per_child);

  insert into public.pool_day_use (
    id, lodge_id, date, guest_name, phone,
    adults, children, fee_per_adult, fee_per_child,
    total, payment_method, notes
  ) values (
    v_id,
    v_lodge_id,
    (payload->>'date')::date,
    coalesce(payload->>'guest_name', 'Walk-in'),
    nullif(payload->>'phone', ''),
    v_adults,
    v_children,
    v_fee_per_adult,
    v_fee_per_child,
    v_total,
    coalesce(payload->>'payment_method', 'cash'),
    nullif(payload->>'notes', '')
  );

  return jsonb_build_object('success', true, 'id', v_id, 'total', v_total);
end;
$$;


--
-- Name: add_supply_purchase(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_supply_purchase(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_purchase_id uuid;
  v_unit_cost numeric;
  v_item_id uuid;
  v_lodge_id uuid;
  v_qty numeric;
  v_total numeric;
  v_new_stock numeric;
begin
  v_item_id := (payload->>'item_id')::uuid;
  v_lodge_id := (payload->>'lodge_id')::uuid;
  v_qty := coalesce((payload->>'quantity_purchased')::numeric, 0);
  v_total := coalesce((payload->>'total_cost')::numeric, 0);
  v_unit_cost := coalesce(
    (payload->>'unit_cost')::numeric,
    case
      when v_qty > 0 then v_total / v_qty
      else 0
    end
  );

  insert into public.supply_purchases (
    lodge_id,
    item_id,
    date,
    quantity_purchased,
    total_cost,
    unit_cost,
    notes
  ) values (
    v_lodge_id,
    v_item_id,
    (payload->>'date')::date,
    v_qty,
    v_total,
    v_unit_cost,
    nullif(payload->>'notes', '')
  )
  returning id into v_purchase_id;

  update public.supply_items
  set
    current_stock = coalesce(current_stock, 0) + v_qty,
    latest_unit_cost = v_unit_cost
  where id = v_item_id
    and lodge_id = v_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    raise exception 'Supply item not found';
  end if;

  insert into public.room_supply_movements (
    lodge_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    v_lodge_id,
    v_item_id,
    'purchase',
    v_qty,
    v_unit_cost,
    v_total,
    nullif(payload->>'notes', '')
  );

  return jsonb_build_object(
    'success', true,
    'id', v_purchase_id,
    'unit_cost', v_unit_cost,
    'new_stock', v_new_stock
  );
end;
$$;


--
-- Name: adjust_inventory_stock(uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_inventory_stock(p_item_id uuid, p_lodge_id uuid, p_delta numeric, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_new_stock numeric;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  update public.inventory_items
     set current_stock = greatest(0, coalesce(current_stock, 0) + coalesce(p_delta, 0))
   where id = p_item_id
     and lodge_id = p_lodge_id
  returning current_stock into v_new_stock;

  if v_new_stock is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'new_stock', v_new_stock);
end;
$$;


--
-- Name: adjust_supply_stock(uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_supply_stock(p_item_id uuid, p_lodge_id uuid, p_delta numeric, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_new_stock numeric;
  v_unit_cost numeric;
begin
  update public.supply_items
  set current_stock = greatest(0, coalesce(current_stock, 0) + coalesce(p_delta, 0))
  where id = p_item_id
    and lodge_id = p_lodge_id
  returning current_stock, latest_unit_cost into v_new_stock, v_unit_cost;

  if v_new_stock is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  insert into public.room_supply_movements (
    lodge_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    p_lodge_id,
    p_item_id,
    'adjustment',
    coalesce(p_delta, 0),
    coalesce(v_unit_cost, 0),
    coalesce(p_delta, 0) * coalesce(v_unit_cost, 0),
    nullif(p_notes, '')
  );

  return jsonb_build_object('success', true, 'new_stock', v_new_stock);
end;
$$;


--
-- Name: app_authenticated_email(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_authenticated_email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select lower(btrim(coalesce(auth.jwt()->>'email', '')));
$$;


--
-- Name: app_authenticated_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_authenticated_user_id() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select auth.uid();
$$;


--
-- Name: app_check_room_maintenance(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_check_room_maintenance(p_lodge_id uuid, p_room_id uuid) RETURNS void
    LANGUAGE plpgsql STABLE
    AS $$
begin
  if p_room_id is not null and exists (
    select 1 
    from public.maintenance_tickets 
    where room_id::text = p_room_id::text 
      and lodge_id::text = p_lodge_id::text 
      and status != 'resolved'
  ) then
    raise exception 'Room is currently under maintenance and cannot be booked.'
      using errcode = 'P0001';
  end if;
end;
$$;


--
-- Name: app_current_lodge_id(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_lodge_id(p_token text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (public.app_current_session_row(p_token)).lodge_id;
$$;


--
-- Name: app_current_role(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_role(p_token text DEFAULT NULL::text) RETURNS text
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (public.app_current_session_row(p_token)).role;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_sessions (
    id uuid DEFAULT extensions.gen_random_uuid() NOT NULL,
    token_hash text NOT NULL,
    session_type text NOT NULL,
    user_id uuid NOT NULL,
    lodge_id uuid NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT app_sessions_session_type_check CHECK ((session_type = ANY (ARRAY['desktop'::text, 'pwa'::text])))
);


--
-- Name: app_current_session_row(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_session_row(p_token text DEFAULT NULL::text) RETURNS public.app_sessions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_token text := public.app_request_session_token(p_token);
  v_session public.app_sessions;
begin
  if v_token is null then
    return null;
  end if;

  select s.*
    into v_session
    from public.app_sessions s
    join public.users u
      on u.id = s.user_id
     and u.lodge_id = s.lodge_id
    left join lateral (
      select public.get_lodge_entitlement(s.lodge_id) as entitlement
    ) ent on true
   where s.token_hash = public.app_hash_token(v_token)
     and s.revoked_at is null
     and s.expires_at > now()
     and (
       s.session_type <> 'pwa'
       or (
         public._is_pwa_role_eligible(u.role)
         and coalesce(u.pwa_enabled, false) = true
         and coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) = true
       )
     )
   limit 1;

  if v_session.id is not null then
    begin
      update public.app_sessions
         set last_seen_at = now()
       where id = v_session.id
         and last_seen_at < now() - interval '5 minutes';
    exception
      when read_only_sql_transaction then
        null;
    end;
  end if;

  return v_session;
end;
$$;


--
-- Name: app_current_user_id(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_current_user_id(p_token text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select (public.app_current_session_row(p_token)).user_id;
$$;


--
-- Name: app_hash_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_hash_token(p_token text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when nullif(btrim(coalesce(p_token, '')), '') is null then null
    else encode(extensions.digest(convert_to(btrim(p_token), 'UTF8'), 'sha256'), 'hex')
  end;
$$;


--
-- Name: app_is_service_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_is_service_role() RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  select public.app_request_role() in ('service_role', 'supabase_admin', 'postgres');
$$;


--
-- Name: app_lodge_access(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_lodge_access(p_lodge_id uuid, p_token text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.app_is_service_role()
      or (
        p_lodge_id is not null
        and public.app_current_lodge_id(p_token) = p_lodge_id
      );
$$;


--
-- Name: app_reject_pwa_financial_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_reject_pwa_financial_mutation() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.app_sessions%rowtype;
begin
  select * into v_session from public.app_current_session_row();
  if v_session.id is not null and v_session.session_type = 'pwa' then
    raise exception 'This action is only available in the Front Desk system.'
      using errcode = '42501';
  end if;
end;
$$;


--
-- Name: app_request_headers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_request_headers() RETURNS jsonb
    LANGUAGE plpgsql STABLE
    AS $$
declare
  v_headers text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null or btrim(v_headers) = '' then
    return '{}'::jsonb;
  end if;
  return v_headers::jsonb;
exception
  when others then
    return '{}'::jsonb;
end;
$$;


--
-- Name: app_request_ip(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_request_ip() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select nullif(
    btrim(
      coalesce(
        nullif(split_part(coalesce(public.app_request_headers()->>'cf-connecting-ip', ''), ',', 1), ''),
        nullif(split_part(coalesce(public.app_request_headers()->>'x-forwarded-for', ''), ',', 1), ''),
        nullif(split_part(coalesce(public.app_request_headers()->>'x-real-ip', ''), ',', 1), ''),
        nullif(split_part(coalesce(public.app_request_headers()->>'x-client-ip', ''), ',', 1), ''),
        ''
      )
    ),
    ''
  );
$$;


--
-- Name: app_request_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_request_role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select lower(
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('role', true), ''),
      ''
    )
  );
$$;


--
-- Name: app_request_session_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_request_session_token(p_token text DEFAULT NULL::text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select nullif(
    btrim(
      coalesce(
        nullif(btrim(coalesce(p_token, '')), ''),
        nullif(current_setting('app.session_token', true), ''),
        nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session', '')),       ''),
        nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session-token', '')), ''),
        nullif(btrim(coalesce(public.app_request_headers()->>'x_boroko_session', '')),        ''),
        ''
      )
    ),
    ''
  );
$$;


--
-- Name: app_require_lodge_role(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_require_lodge_role(p_lodge_id uuid, p_allowed_roles text[] DEFAULT ARRAY['admin'::text]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role text := lower(coalesce(public.app_current_role(), ''));
begin
  if public.app_is_service_role() then
    return;
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied for this lodge.'
      using errcode = '42501';
  end if;

  if coalesce(array_length(p_allowed_roles, 1), 0) = 0 then
    return;
  end if;

  if not (v_role = any(select lower(value) from unnest(p_allowed_roles) as value)) then
    raise exception 'This session is not allowed to perform that action.'
      using errcode = '42501';
  end if;
end;
$$;


--
-- Name: app_require_pos_outlet_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_require_pos_outlet_access(p_lodge_id uuid, p_outlet_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.app_sessions%rowtype;
  v_role text;
  v_allowed_outlet_ids uuid[];
begin
  if public.app_is_service_role() then
    return;
  end if;

  v_session := public.app_current_session_row();

  if v_session.id is null then
    raise exception 'A valid app session is required.'
      using errcode = '42501';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied for this lodge.'
      using errcode = '42501';
  end if;

  v_role := lower(coalesce(v_session.role, ''));

  if v_role in ('manager', 'admin', 'super_admin') then
    return;
  end if;

  if v_role not in ('cashier', 'supervisor') then
    raise exception 'This session is not allowed to access POS outlets.'
      using errcode = '42501';
  end if;

  if p_outlet_id is null then
    raise exception 'This action requires an outlet context.'
      using errcode = '42501';
  end if;

  select coalesce(u.allowed_outlet_ids, '{}'::uuid[])
    into v_allowed_outlet_ids
    from public.users u
   where u.id = v_session.user_id
     and u.lodge_id = p_lodge_id;

  if not coalesce(p_outlet_id = any(v_allowed_outlet_ids), false) then
    raise exception 'This session is not allowed to access that outlet.'
      using errcode = '42501';
  end if;
end;
$$;


--
-- Name: app_session_ttl(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_session_ttl(p_session_type text) RETURNS interval
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when lower(coalesce(btrim(p_session_type), '')) = 'pwa' then interval '12 hours'
    else interval '7 days'
  end;
$$;


--
-- Name: apply_booking_vat_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.apply_booking_vat_snapshot() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_vat_enabled boolean := false;
  v_vat_rate numeric := 0;
begin
  if new.vat_enabled is not null and new.vat_rate is not null then
    return new;
  end if;

  select
    coalesce(s.vat_enabled, false),
    greatest(coalesce(s.vat_rate, 0), 0)
    into v_vat_enabled, v_vat_rate
  from public.settings s
  where s.lodge_id = new.lodge_id
  limit 1;

  new.vat_enabled := coalesce(new.vat_enabled, v_vat_enabled, false);
  new.vat_rate := round(coalesce(new.vat_rate, v_vat_rate, 0)::numeric, 4);
  return new;
end;
$$;


--
-- Name: approve_booking_refund(uuid, uuid, numeric, text, text, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_booking_refund(p_booking_id uuid, p_lodge_id uuid, p_retained_percent numeric DEFAULT 0, p_method text DEFAULT 'refund'::text, p_notes text DEFAULT ''::text, p_requested_by uuid DEFAULT NULL::uuid, p_approved_by uuid DEFAULT NULL::uuid, p_proof_reference text DEFAULT ''::text, p_approval_note text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking public.bookings%rowtype;
  v_approver_role text;
  v_refund jsonb;
  v_should_cancel boolean := false;
  v_effective_status text;
  v_retained_amount numeric := 0;
  v_settled_total numeric := 0;
  v_final_payment_status text := 'unpaid';
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if p_approved_by is null then
    return jsonb_build_object('success', false, 'error', 'Refund approval is required');
  end if;

  select role
    into v_approver_role
    from public.users
   where id = p_approved_by
     and lodge_id = p_lodge_id
   limit 1;

  if coalesce(v_approver_role, '') not in ('manager', 'admin', 'super_admin') then
    return jsonb_build_object('success', false, 'error', 'Approver does not have refund approval rights');
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if coalesce(v_booking.status, '') in ('checked_in', 'checked_out') then
    return jsonb_build_object(
      'success', false,
      'error', 'Refunds are only allowed before check-in or on already-cancelled bookings. Checked-in and checked-out bookings must use a manual finance adjustment workflow.'
    );
  end if;

  v_should_cancel := coalesce(v_booking.status, '') in ('pending', 'confirmed');

  v_refund := public.record_booking_refund(
    p_booking_id,
    p_lodge_id,
    p_retained_percent,
    p_method,
    trim(both from concat(
      coalesce(nullif(p_notes, ''), ''),
      case
        when coalesce(nullif(p_proof_reference, ''), '') <> '' then ' | Proof: ' || p_proof_reference
        else ''
      end,
      case
        when coalesce(nullif(p_approval_note, ''), '') <> '' then ' | Approval: ' || p_approval_note
        else ''
      end
    )),
    p_requested_by,
    'refund-approval:' || p_booking_id::text || ':' || md5(
      coalesce(p_approved_by::text, '') || ':' ||
      coalesce(p_retained_percent::text, '') || ':' ||
      coalesce(p_method, '') || ':' ||
      coalesce(p_notes, '') || ':' ||
      coalesce(p_proof_reference, '')
    )
  );

  if coalesce((v_refund->>'success')::boolean, false) = false then
    return v_refund;
  end if;

  v_retained_amount := coalesce((v_refund->>'retained_amount')::numeric, 0);
  v_effective_status := case
    when v_should_cancel or coalesce(v_booking.status, '') = 'cancelled' then 'cancelled'
    else v_booking.status
  end;

  if v_effective_status = 'cancelled' then
    v_settled_total := round(greatest(v_retained_amount, 0)::numeric, 2);
    v_final_payment_status := case
      when v_settled_total > 0 then 'paid'
      else 'unpaid'
    end;

    update public.bookings
       set status = 'cancelled',
           total_amount = v_settled_total,
           amount_paid = v_settled_total,
           payment_status = v_final_payment_status,
           updated_at = now()
     where id = p_booking_id
       and lodge_id = p_lodge_id;

    insert into public.financial_audit_log (
      lodge_id,
      booking_id,
      action,
      actor_id,
      amount_delta,
      before_snapshot,
      after_snapshot
    ) values (
      p_lodge_id,
      p_booking_id,
      'booking_total_edited',
      p_approved_by,
      null,
      jsonb_build_object(
        'status', v_booking.status,
        'total_amount', v_booking.total_amount,
        'amount_paid', v_booking.amount_paid,
        'payment_status', v_booking.payment_status
      ),
      jsonb_build_object(
        'status', 'cancelled',
        'total_amount', v_settled_total,
        'amount_paid', v_settled_total,
        'payment_status', v_final_payment_status,
        'reason', 'refund_retained_settlement'
      )
    );
  end if;

  insert into public.refund_approval_log (
    lodge_id,
    booking_id,
    approved_by,
    requested_by,
    refund_amount,
    retained_amount,
    retained_percent,
    method,
    notes,
    proof_reference,
    approval_note
  ) values (
    p_lodge_id,
    p_booking_id,
    p_approved_by,
    p_requested_by,
    coalesce((v_refund->>'refund_amount')::numeric, 0),
    v_retained_amount,
    coalesce((v_refund->>'retained_percent')::numeric, 0),
    coalesce(nullif(p_method, ''), 'refund'),
    nullif(p_notes, ''),
    nullif(p_proof_reference, ''),
    nullif(p_approval_note, '')
  );

  return v_refund || jsonb_build_object(
    'approved_by', p_approved_by,
    'booking_status', v_effective_status,
    'settled_total_amount', v_settled_total,
    'final_payment_status', v_final_payment_status
  );
end;
$$;


--
-- Name: approve_pos_void_with_pin(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_pos_void_with_pin(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id uuid := (payload->>'order_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_requested_by uuid := nullif(payload->>'requested_by', '')::uuid;
  v_approved_by uuid := nullif(payload->>'approved_by', '')::uuid;
  v_reason text := nullif(payload->>'reason', '');
  v_payload_outlet uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_override_log_id uuid := nullif(payload->>'override_log_id', '')::uuid;
  v_created_at timestamptz := coalesce(nullif(payload->>'created_at', '')::timestamptz, now());
  v_order_outlet_id uuid;
  v_folio_charge_id uuid;
  v_status text;
  v_restored jsonb := '[]'::jsonb;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);

  select status, outlet_id, folio_charge_id
    into v_status, v_order_outlet_id, v_folio_charge_id
    from public.pos_orders
   where id = v_order_id
     and lodge_id = v_lodge_id
   for update;

  if v_override_log_id is not null
     and exists (
       select 1
         from public.pos_override_log pol
        where pol.id = v_override_log_id
          and pol.lodge_id = v_lodge_id
          and pol.order_id = v_order_id
          and pol.action = 'void'
     ) then
    return jsonb_build_object(
      'success', true,
      'id', v_order_id,
      'override_log_id', v_override_log_id,
      'already_applied', true,
      'restored_stock', v_restored
    );
  end if;

  if v_status is null then
    return jsonb_build_object('success', false, 'error', 'Order not found');
  end if;

  perform public.app_require_pos_outlet_access(v_lodge_id, coalesce(v_order_outlet_id, v_payload_outlet));

  if not exists (
    select 1
      from public.users u
     where u.id = v_approved_by
       and u.lodge_id = v_lodge_id
       and lower(coalesce(u.role, '')) in ('supervisor', 'manager', 'admin', 'super_admin')
  ) then
    return jsonb_build_object('success', false, 'error', 'Invalid approver');
  end if;

  if v_status = 'voided' then
    return jsonb_build_object('success', false, 'error', 'Order is already voided');
  end if;

  if v_status = 'settled' then
    return jsonb_build_object('success', false, 'error', 'Cannot void a settled order');
  end if;

  v_restored := public._restore_pos_order_stock(v_order_id, v_lodge_id);

  if v_folio_charge_id is not null then
    perform public.delete_booking_charge(v_folio_charge_id, v_lodge_id, 'Voided with POS order');
  end if;

  update public.pos_orders
     set status = 'voided'
   where id = v_order_id
     and lodge_id = v_lodge_id;

  insert into public.pos_override_log (
    id,
    lodge_id,
    order_id,
    action,
    requested_by,
    approved_by,
    reason,
    outlet_id,
    created_at
  ) values (
    coalesce(v_override_log_id, gen_random_uuid()),
    v_lodge_id,
    v_order_id,
    'void',
    v_requested_by,
    v_approved_by,
    v_reason,
    coalesce(v_order_outlet_id, v_payload_outlet),
    v_created_at
  )
  on conflict (id) do nothing;

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'override_log_id', v_override_log_id,
    'restored_stock', v_restored
  );
end;
$$;


--
-- Name: authenticate_manager(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.authenticate_manager(p_email text, p_password text DEFAULT NULL::text, p_lodge_id uuid DEFAULT NULL::uuid) RETURNS TABLE(contract_version integer, authenticated boolean, id uuid, name text, email text, role text, lodge_id uuid, lodge_display_name text, pwa_enabled boolean, pwa_password_set_at timestamp with time zone, pwa_disabled_reason text, pwa_feature_enabled boolean, pwa_plan text, session_token text, session_expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_match_count integer := 0;
begin
  if nullif(coalesce(p_password, ''), '') is null then
    return;
  end if;

  with candidates as (
    select
      u.id,
      u.name,
      lower(btrim(u.email)) as email,
      lower(btrim(u.role)) as role,
      u.lodge_id,
      coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
      coalesce(u.pwa_enabled, false) as pwa_enabled,
      u.pwa_password_set_at,
      u.pwa_disabled_reason,
      coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
      case
        when nullif(coalesce(u.pwa_password_hash, ''), '') is null then false
        else extensions.crypt(p_password, u.pwa_password_hash) = u.pwa_password_hash
      end as password_ok
    from public.users u
    left join lateral (
      select settings.lodge_name, settings.company_name
      from public.settings settings
      where settings.lodge_id = u.lodge_id
        and coalesce(settings.deleted, false) = false
      order by settings.updated_at desc nulls last, settings.created_at desc nulls last
      limit 1
    ) s on true
    left join lateral (
      select public.get_lodge_entitlement(u.lodge_id) as entitlement
    ) ent on true
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select count(*)
    into v_match_count
  from candidates
  where password_ok;

  if v_match_count = 0 then
    return;
  end if;

  return query
  with candidates as (
    select
      u.id,
      u.name,
      lower(btrim(u.email)) as email,
      lower(btrim(u.role)) as role,
      u.lodge_id,
      coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
      coalesce(u.pwa_enabled, false) as pwa_enabled,
      u.pwa_password_set_at,
      u.pwa_disabled_reason,
      coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
      case
        when nullif(coalesce(u.pwa_password_hash, ''), '') is null then false
        else extensions.crypt(p_password, u.pwa_password_hash) = u.pwa_password_hash
      end as password_ok
    from public.users u
    left join lateral (
      select settings.lodge_name, settings.company_name
      from public.settings settings
      where settings.lodge_id = u.lodge_id
        and coalesce(settings.deleted, false) = false
      order by settings.updated_at desc nulls last, settings.created_at desc nulls last
      limit 1
    ) s on true
    left join lateral (
      select public.get_lodge_entitlement(u.lodge_id) as entitlement
    ) ent on true
    where lower(btrim(u.email)) = lower(btrim(p_email))
      and public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
  )
  select
    2 as contract_version,
    issued.session_token is not null as authenticated,
    c.id,
    c.name,
    c.email,
    c.role,
    c.lodge_id,
    c.lodge_display_name,
    c.pwa_enabled,
    c.pwa_password_set_at,
    c.pwa_disabled_reason,
    c.pwa_feature_enabled,
    c.pwa_plan,
    issued.session_token,
    issued.session_expires_at
  from candidates c
  left join lateral (
    select
      issued_row.session_token,
      issued_row.session_expires_at
    from public.issue_app_session(
      c.id,
      c.lodge_id,
      c.role,
      'pwa',
      jsonb_build_object('email', c.email)
    ) as issued_row(session_token, session_expires_at)
    where c.password_ok
      and c.pwa_enabled = true
      and c.pwa_feature_enabled = true
      and (v_match_count = 1 or p_lodge_id is not null)
  ) issued on true
  where c.password_ok
  order by c.lodge_display_name;
end;
$$;


--
-- Name: authenticate_manager_from_supabase(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.authenticate_manager_from_supabase(p_lodge_id uuid DEFAULT NULL::uuid) RETURNS TABLE(contract_version integer, authenticated boolean, id uuid, name text, email text, role text, lodge_id uuid, lodge_display_name text, pwa_enabled boolean, pwa_password_set_at timestamp with time zone, pwa_disabled_reason text, pwa_feature_enabled boolean, pwa_plan text, session_token text, session_expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
  v_match_count integer := 0;
begin
  if v_auth_user_id is null then
    return;
  end if;

  with candidates as (
    select u.id
    from public.users u
    where public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
      and (
        u.auth_user_id = v_auth_user_id
        or (
          u.auth_user_id is null
          and lower(btrim(u.email)) = v_email
        )
      )
  )
  select count(*) into v_match_count from candidates;

  update public.users u
     set auth_user_id = v_auth_user_id
   where u.auth_user_id is null
     and lower(btrim(u.email)) = v_email
     and public._is_pwa_role_eligible(u.role)
     and (p_lodge_id is null or u.lodge_id = p_lodge_id);

  return query
  with candidates as (
    select
      u.id,
      u.name,
      lower(btrim(u.email)) as email,
      lower(btrim(u.role)) as role,
      u.lodge_id,
      coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
      coalesce(u.pwa_enabled, false) as pwa_enabled,
      u.pwa_password_set_at,
      u.pwa_disabled_reason,
      coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
      coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan
    from public.users u
    left join lateral (
      select settings.lodge_name, settings.company_name
      from public.settings settings
      where settings.lodge_id = u.lodge_id
        and coalesce(settings.deleted, false) = false
      order by settings.updated_at desc nulls last, settings.created_at desc nulls last
      limit 1
    ) s on true
    left join lateral (
      select public.get_lodge_entitlement(u.lodge_id) as entitlement
    ) ent on true
    where public._is_pwa_role_eligible(u.role)
      and (p_lodge_id is null or u.lodge_id = p_lodge_id)
      and (
        u.auth_user_id = v_auth_user_id
        or (
          u.auth_user_id is null
          and lower(btrim(u.email)) = v_email
        )
      )
  )
  select
    2,
    issued.session_token is not null,
    c.id,
    c.name,
    c.email,
    c.role,
    c.lodge_id,
    c.lodge_display_name,
    c.pwa_enabled,
    c.pwa_password_set_at,
    c.pwa_disabled_reason,
    c.pwa_feature_enabled,
    c.pwa_plan,
    issued.session_token,
    issued.session_expires_at
  from candidates c
  left join lateral (
    select issued_row.session_token, issued_row.session_expires_at
    from public.issue_app_session(
      c.id,
      c.lodge_id,
      c.role,
      'pwa',
      jsonb_build_object('email', c.email, 'auth_user_id', v_auth_user_id)
    ) as issued_row(session_token, session_expires_at)
    where c.pwa_enabled = true
      and c.pwa_feature_enabled = true
      and (v_match_count = 1 or p_lodge_id is not null)
  ) issued on true
  order by c.lodge_display_name;
end;
$$;


--
-- Name: authenticate_user(text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.authenticate_user(p_email text, p_lodge_id uuid, p_password text DEFAULT NULL::text, p_session_type text DEFAULT 'desktop'::text) RETURNS TABLE(contract_version integer, found boolean, authenticated boolean, id uuid, name text, email text, role text, lodge_id uuid, created_at timestamp with time zone, session_token text, session_expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user public.users%rowtype;
  v_password text := nullif(coalesce(p_password, ''), '');
  v_session_token text := null;
  v_session_expires_at timestamptz := null;
begin
  select *
  into v_user
  from public.users u
  where lower(btrim(u.email)) = lower(btrim(p_email))
    and u.lodge_id = p_lodge_id
  limit 1;

  if v_user.id is null then
    return query
    select
      2 as contract_version,
      false as found,
      false as authenticated,
      null::uuid,
      ''::text,
      lower(btrim(p_email)) as email,
      null::text,
      p_lodge_id,
      null::timestamptz,
      null::text,
      null::timestamptz;
    return;
  end if;

  if v_password is not null
     and nullif(coalesce(v_user.password_hash, ''), '') is not null
     and extensions.crypt(v_password, v_user.password_hash) = v_user.password_hash then
    select s.session_token, s.session_expires_at
    into v_session_token, v_session_expires_at
    from public.issue_app_session(
      v_user.id,
      v_user.lodge_id,
      v_user.role,
      p_session_type,
      jsonb_build_object('email', lower(btrim(v_user.email)))
    ) as s;
  end if;

  return query
  select
    2 as contract_version,
    true as found,
    v_session_token is not null as authenticated,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)) as email,
    v_user.role,
    v_user.lodge_id,
    v_user.created_at,
    v_session_token,
    v_session_expires_at;
end;
$$;


--
-- Name: authenticate_user_from_supabase(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.authenticate_user_from_supabase(p_lodge_id uuid, p_session_type text DEFAULT 'desktop'::text) RETURNS TABLE(contract_version integer, found boolean, authenticated boolean, id uuid, name text, email text, role text, lodge_id uuid, created_at timestamp with time zone, session_token text, session_expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_auth_user_id uuid := public.app_authenticated_user_id();
  v_email text := public.app_authenticated_email();
  v_user public.users;
begin
  if v_auth_user_id is null then
    return query
    select
      2,
      false,
      false,
      null::uuid,
      ''::text,
      v_email,
      null::text,
      p_lodge_id,
      null::timestamptz,
      null::text,
      null::timestamptz;
    return;
  end if;

  select u.*
    into v_user
  from public.users u
  where u.lodge_id = p_lodge_id
    and (
      u.auth_user_id = v_auth_user_id
      or (
        u.auth_user_id is null
        and lower(btrim(u.email)) = v_email
      )
    )
  order by case when u.auth_user_id = v_auth_user_id then 0 else 1 end
  limit 1;

  if v_user.id is null then
    return query
    select
      2,
      false,
      false,
      null::uuid,
      ''::text,
      v_email,
      null::text,
      p_lodge_id,
      null::timestamptz,
      null::text,
      null::timestamptz;
    return;
  end if;

  if v_user.auth_user_id is null then
    update public.users
       set auth_user_id = v_auth_user_id
     where public.users.id = v_user.id
       and public.users.lodge_id = v_user.lodge_id
       and public.users.auth_user_id is null;
  end if;

  return query
  select
    2,
    true,
    issued.session_token is not null,
    v_user.id,
    v_user.name,
    lower(btrim(v_user.email)),
    lower(btrim(v_user.role)),
    v_user.lodge_id,
    v_user.created_at,
    issued.session_token,
    issued.session_expires_at
  from public.issue_app_session(
    v_user.id,
    v_user.lodge_id,
    v_user.role,
    coalesce(nullif(lower(btrim(p_session_type)), ''), 'desktop'),
    jsonb_build_object('email', lower(btrim(v_user.email)), 'auth_user_id', v_auth_user_id)
  ) as issued(session_token, session_expires_at);
end;
$$;


--
-- Name: cancel_expired_pending_online_bookings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_expired_pending_online_bookings() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_expired_count int;
begin
  with expired as (
    select id
      from public.bookings
     where status      = 'pending'
       and source      = 'online'
       and created_at  < (now() - interval '24 hours')
  )
  update public.bookings b
     set status        = 'cancelled',
         cancel_reason = 'expired_online_booking',
         cancelled_at  = now(),
         notes         = coalesce(b.notes, '')
                         || case when coalesce(b.notes, '') = '' then '' else e'\n' end
                         || '[SYSTEM] Automatically cancelled due to 24h expiration threshold for pending online requests.',
         updated_at    = now()
    from expired e
   where b.id = e.id;

  get diagnostics v_expired_count = row_count;

  if v_expired_count > 0 then
    raise log 'System: Expired % pending online bookings that exceeded 24h TTL.', v_expired_count;
  end if;

  return v_expired_count;
end;
$$;


--
-- Name: check_import_duplicates(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_import_duplicates(p_lodge_id uuid, p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row        jsonb;
  v_idx        int := 0;
  v_duplicates jsonb := '[]'::jsonb;
  v_room       record;
  v_conflict   uuid;
begin
  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_idx := v_idx + 1;

    -- Look up room
    select id into v_room
      from public.rooms
     where lodge_id = p_lodge_id
       and lower(trim(room_number::text)) = lower(trim(v_row->>'room_number'))
     limit 1;

    if not found then continue; end if;

    -- Check for overlapping non-cancelled booking on same room
    select b.id into v_conflict
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.room_id = v_room.id
       and b.status <> 'cancelled'
       and not (b.check_out <= (v_row->>'check_in')::date or b.check_in >= (v_row->>'check_out')::date)
     limit 1;

    if v_conflict is not null then
      v_duplicates := v_duplicates || jsonb_build_object(
        'row', v_idx,
        'room_number', v_row->>'room_number',
        'check_in', v_row->>'check_in',
        'check_out', v_row->>'check_out',
        'guest_name', v_row->>'guest_name'
      );
    end if;
  end loop;

  return jsonb_build_object('duplicates', v_duplicates);
end;
$$;


--
-- Name: check_online_booking_rate_limit(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_online_booking_rate_limit(p_lodge_id uuid, p_email text, p_phone text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_ip text := public.app_request_ip();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
begin
  if not public.consume_online_booking_limit(p_lodge_id, 'ip_15m', v_ip, 8, interval '15 minutes', interval '30 minutes') then
    return 'Too many booking attempts were sent from this connection. Please wait 30 minutes and try again.';
  end if;

  if not public.consume_online_booking_limit(p_lodge_id, 'ip_24h', v_ip, 24, interval '24 hours', interval '6 hours') then
    return 'Booking attempts from this connection have been temporarily paused. Please contact the lodge if you need immediate help.';
  end if;

  if not public.consume_online_booking_limit(p_lodge_id, 'email_30m', v_email, 4, interval '30 minutes', interval '30 minutes') then
    return 'Too many booking attempts were sent for this email address. Please wait 30 minutes before trying again.';
  end if;

  if not public.consume_online_booking_limit(p_lodge_id, 'phone_30m', v_phone, 4, interval '30 minutes', interval '30 minutes') then
    return 'Too many booking attempts were sent for this phone number. Please wait 30 minutes before trying again.';
  end if;

  return null;
end;
$$;


--
-- Name: clear_subscription_feature_override(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clear_subscription_feature_override(p_lodge_id uuid, p_feature_name text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  delete from public.lodge_features
  where lodge_id = p_lodge_id
    and feature_name = p_feature_name;

  perform public._record_subscription_event(
    p_lodge_id, p_lodge_id::text, null, null,
    'feature_override_cleared', 'completed', null, null,
    jsonb_build_object('feature_name', p_feature_name)
  );

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: compute_conference_payment_status(numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_conference_payment_status(p_deposit_paid numeric, p_total_amount numeric) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when coalesce(p_total_amount, 0) <= 0 then 'pending'
    when coalesce(p_deposit_paid, 0) >= coalesce(p_total_amount, 0) then 'paid'
    when coalesce(p_deposit_paid, 0) > 0 then 'deposit_paid'
    else 'pending'
  end;
$$;


--
-- Name: compute_payment_status(numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_payment_status(p_amount_paid numeric, p_total_amount numeric, p_charges_total numeric) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when coalesce(p_amount_paid, 0) >= (coalesce(p_total_amount, 0) + coalesce(p_charges_total, 0)) then 'paid'
    when coalesce(p_amount_paid, 0) > 0 then 'partial'
    else 'unpaid'
  end;
$$;


--
-- Name: consume_online_booking_limit(uuid, text, text, integer, interval, interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_online_booking_limit(p_lodge_id uuid, p_bucket_type text, p_bucket_value text, p_max_hits integer, p_window interval, p_block_for interval) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_now timestamptz := now();
  v_bucket_value text := nullif(btrim(coalesce(p_bucket_value, '')), '');
  v_bucket_key text;
  v_hit_count integer;
  v_blocked_until timestamptz;
begin
  if p_lodge_id is null or v_bucket_value is null or coalesce(p_max_hits, 0) <= 0 then
    return true;
  end if;

  v_bucket_key := md5(
    lower(coalesce(p_bucket_type, 'unknown')) || '::' ||
    lower(p_lodge_id::text) || '::' ||
    lower(v_bucket_value)
  );

  insert into public.online_booking_rate_limits (
    bucket_key,
    lodge_id,
    bucket_type,
    window_started_at,
    hit_count,
    last_request_at,
    blocked_until
  ) values (
    v_bucket_key,
    p_lodge_id,
    lower(coalesce(p_bucket_type, 'unknown')),
    v_now,
    1,
    v_now,
    null
  )
  on conflict (bucket_key)
  do update set
    hit_count = case
      when public.online_booking_rate_limits.blocked_until is not null
        and public.online_booking_rate_limits.blocked_until > v_now
        then public.online_booking_rate_limits.hit_count
      when public.online_booking_rate_limits.window_started_at <= (v_now - p_window)
        then 1
      else public.online_booking_rate_limits.hit_count + 1
    end,
    window_started_at = case
      when public.online_booking_rate_limits.blocked_until is not null
        and public.online_booking_rate_limits.blocked_until > v_now
        then public.online_booking_rate_limits.window_started_at
      when public.online_booking_rate_limits.window_started_at <= (v_now - p_window)
        then v_now
      else public.online_booking_rate_limits.window_started_at
    end,
    last_request_at = v_now,
    blocked_until = case
      when public.online_booking_rate_limits.blocked_until is not null
        and public.online_booking_rate_limits.blocked_until > v_now
        then public.online_booking_rate_limits.blocked_until
      when public.online_booking_rate_limits.window_started_at <= (v_now - p_window)
        then null
      when public.online_booking_rate_limits.hit_count + 1 > p_max_hits
        then v_now + p_block_for
      else null
    end
  returning hit_count, blocked_until
    into v_hit_count, v_blocked_until;

  if v_blocked_until is not null and v_blocked_until > v_now then
    return false;
  end if;

  return coalesce(v_hit_count, 0) <= p_max_hits;
end;
$$;


--
-- Name: convert_quotation_to_booking(uuid, uuid, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.convert_quotation_to_booking(p_quotation_id uuid, p_lodge_id uuid, p_deposit_amount numeric DEFAULT 0, p_payment_method text DEFAULT 'cash'::text, p_created_by uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_q          quotations%rowtype;
  v_booking_id uuid;
  v_inv_number text;
  v_dep_result jsonb;
begin
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_q
    from quotations
   where id::text = p_quotation_id::text 
     and lodge_id::text = p_lodge_id::text 
   for update;

  if not found then
    raise exception 'Quotation not found';
  end if;

  -- NEW: Maintenance Check
  perform public.app_check_room_maintenance(p_lodge_id, v_q.room_id);

  if p_deposit_amount > 0 and p_payment_method is null then
    raise exception 'Payment method is required when deposit amount is provided';
  end if;

  if v_q.room_id is not null and (v_q.adults + v_q.children) > (select r.max_occupancy from public.rooms r where r.id = v_q.room_id and r.lodge_id = p_lodge_id) then
    raise exception 'Number of guests (%) exceeds room maximum occupancy (%)', v_q.adults + v_q.children, (select r.max_occupancy from public.rooms r where r.id = v_q.room_id and r.lodge_id = p_lodge_id);
  end if;

  if v_q.status in ('converted', 'cancelled') then
    raise exception 'Quotation is already % and cannot be converted', v_q.status;
  end if;

  if v_q.status not in ('sent', 'accepted') then
    raise exception 'Quotation must be sent or accepted before conversion';
  end if;

  if v_q.room_id is not null and exists (
    select 1
      from bookings
     where room_id::text = v_q.room_id::text 
       and lodge_id::text = p_lodge_id::text 
       and status not in ('cancelled', 'checked_out')
       and check_in < v_q.check_out
       and check_out > v_q.check_in
  ) then
    raise exception 'Room is not available for the requested dates';
  end if;

  v_inv_number := public.get_next_invoice_number(p_lodge_id);
  v_booking_id := gen_random_uuid();

  insert into bookings (
    id, lodge_id, room_id, customer_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status, payment_method,
    status, invoice_number, quotation_id, created_by, created_at, updated_at
  ) values (
    v_booking_id, p_lodge_id, v_q.room_id, v_q.customer_id,
    v_q.check_in, v_q.check_out, v_q.adults, v_q.children,
    v_q.total_amount, 0, 'unpaid', p_payment_method,
    'confirmed', v_inv_number, p_quotation_id, p_created_by, now(), now()
  );

  insert into invoices (
    booking_id, lodge_id, invoice_number, issued_at
  ) values (
    v_booking_id, p_lodge_id, v_inv_number, now()
  )
  on conflict do nothing;

  update quotations
     set status = 'converted',
         converted_booking_id = v_booking_id,
         updated_at = now()
   where id::text = p_quotation_id::text
     and lodge_id::text = p_lodge_id::text;

  if p_deposit_amount > 0 then
    select public.update_booking_payment(
      v_booking_id, p_lodge_id, p_deposit_amount, p_payment_method,
      'deposit', 'payment:deposit:' || v_booking_id, p_created_by
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      raise exception using
        message = 'Deposit failed',
        detail = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('success', true, 'id', v_booking_id, 'invoice_number', v_inv_number);
end;
$$;


--
-- Name: create_booking(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_booking(p_lodge_id uuid, p_customer_id uuid, p_room_id uuid, p_check_in date, p_check_out date, p_adults integer, p_children integer, p_total_amount numeric, p_invoice_number text DEFAULT NULL::text, p_notes text DEFAULT ''::text, p_created_by uuid DEFAULT NULL::uuid, p_deposit_amount numeric DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_conflict INT;
  v_id       UUID := gen_random_uuid();
BEGIN
  -- Check for room conflict
  SELECT COUNT(*) INTO v_conflict
  FROM bookings
  WHERE room_id = p_room_id
    AND lodge_id = p_lodge_id
    AND status != 'cancelled'
    AND NOT (check_out <= p_check_in OR check_in >= p_check_out);

  IF v_conflict > 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  END IF;

  INSERT INTO bookings (
    id, lodge_id, customer_id, room_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status,
    status, invoice_number, notes, created_by,
    deposit_amount, payment_method,
    created_at, updated_at
  ) VALUES (
    v_id, p_lodge_id, p_customer_id, p_room_id,
    p_check_in, p_check_out, p_adults, p_children,
    p_total_amount, 0, 'unpaid',
    'confirmed', p_invoice_number, p_notes, p_created_by,
    p_deposit_amount, NULL,
    NOW(), NOW()
  );

  RETURN jsonb_build_object('success', true, 'booking_id', v_id);
END;
$$;


--
-- Name: create_booking(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_booking(p_lodge_id uuid, p_customer_id uuid, p_room_id uuid, p_check_in date, p_check_out date, p_adults integer, p_children integer, p_total_amount numeric, p_invoice_number text DEFAULT NULL::text, p_notes text DEFAULT ''::text, p_created_by uuid DEFAULT NULL::uuid, p_deposit_amount numeric DEFAULT 0, p_booking_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_conflict    int;
  v_existing_id uuid;
  v_id          uuid := coalesce(p_booking_id, gen_random_uuid());
begin
  if p_idempotency_key is not null then
    select b.id
      into v_existing_id
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.create_idempotency_key = p_idempotency_key
    limit 1;

    if found then
      return jsonb_build_object(
        'success', true,
        'booking_id', v_existing_id,
        'idempotent', true
      );
    end if;
  end if;

  select b.id
    into v_existing_id
  from public.bookings b
  where b.lodge_id = p_lodge_id
    and b.id = v_id
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'booking_id', v_existing_id,
      'idempotent', true
    );
  end if;

  select count(*)
    into v_conflict
  from public.bookings
  where room_id = p_room_id
    and lodge_id = p_lodge_id
    and status != 'cancelled'
    and not (check_out <= p_check_in or check_in >= p_check_out);

  if v_conflict > 0 then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  end if;

  insert into public.bookings (
    id, lodge_id, customer_id, room_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status,
    status, invoice_number, notes, created_by,
    deposit_amount, payment_method,
    created_at, updated_at, create_idempotency_key
  ) values (
    v_id, p_lodge_id, p_customer_id, p_room_id,
    p_check_in, p_check_out, p_adults, p_children,
    p_total_amount, 0, 'unpaid',
    'confirmed', p_invoice_number, p_notes, p_created_by,
    p_deposit_amount, null,
    now(), now(), p_idempotency_key
  );

  insert into public.invoices (
    booking_id, lodge_id, invoice_number, issued_at
  ) values (
    v_id, p_lodge_id, p_invoice_number, now()
  )
  on conflict do nothing;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$$;


--
-- Name: create_booking(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_booking(p_lodge_id uuid, p_customer_id uuid, p_room_id uuid, p_check_in date, p_check_out date, p_adults integer, p_children integer, p_total_amount numeric, p_invoice_number text DEFAULT NULL::text, p_notes text DEFAULT ''::text, p_created_by uuid DEFAULT NULL::uuid, p_deposit_amount numeric DEFAULT 0, p_booking_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_deposit_method text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_existing_id uuid;
  v_id uuid := coalesce(p_booking_id, gen_random_uuid());
  v_is_existing boolean := false;
  v_dep_result jsonb;
  v_expected_total numeric;
  v_total_amount numeric := round(coalesce(p_total_amount, 0)::numeric, 2);
  v_invoice_number text := nullif(btrim(coalesce(p_invoice_number, '')), '');
  v_deposit_key text;
begin
  perform public.app_reject_pwa_financial_mutation();

  if p_deposit_amount > 0 and p_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  if v_total_amount < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  v_expected_total := public.room_booking_expected_total(p_lodge_id, p_room_id, p_check_in, p_check_out);
  if v_expected_total is null then
    return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
  end if;

  if abs(v_total_amount - v_expected_total) > 0.01 then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Booking total must match the room rate for this stay. Expected %s, received %s.',
        v_expected_total,
        v_total_amount
      )
    );
  end if;

  if p_idempotency_key is not null then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.create_idempotency_key = p_idempotency_key
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.id = v_id
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    begin
      insert into public.bookings (
        id, lodge_id, customer_id, room_id,
        check_in, check_out, adults, children,
        total_amount, amount_paid, payment_status,
        status, invoice_number, notes, created_by,
        deposit_amount, payment_method,
        created_at, updated_at, create_idempotency_key
      ) values (
        v_id, p_lodge_id, p_customer_id, p_room_id,
        p_check_in, p_check_out, p_adults, p_children,
        v_total_amount, 0, 'unpaid',
        'confirmed', null, p_notes, p_created_by,
        p_deposit_amount, null,
        now(), now(), p_idempotency_key
      );
    exception
      when exclusion_violation then
        return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
    end;

    if v_invoice_number is null then
      v_invoice_number := public.get_next_invoice_number(p_lodge_id);
    end if;

    update public.bookings
       set invoice_number = v_invoice_number,
           updated_at = now()
     where id = v_id
       and lodge_id = p_lodge_id;

    insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
    values (v_id, p_lodge_id, v_invoice_number, now())
    on conflict do nothing;
  end if;

  if p_deposit_amount > 0 and p_deposit_method is not null then
    v_deposit_key := 'payment:deposit:' || v_id;
    if not exists (
      select 1
        from public.payments
       where idempotency_key = v_deposit_key
    ) then
      select public.update_booking_payment(
        v_id, p_lodge_id, p_deposit_amount, p_deposit_method,
        'deposit', v_deposit_key, p_created_by
      ) into v_dep_result;

      if not coalesce((v_dep_result->>'success')::boolean, false) then
        if v_is_existing then
          return jsonb_build_object(
            'success', false,
            'booking_id', v_id,
            'error', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
          );
        end if;

        raise exception using
          message = 'Deposit failed',
          detail = coalesce(v_dep_result->>'error', 'unknown'),
          errcode = 'P0001';
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$$;


--
-- Name: create_booking(uuid, uuid, uuid, date, date, integer, integer, numeric, text, text, uuid, numeric, uuid, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_booking(p_lodge_id uuid, p_customer_id uuid, p_room_id uuid, p_check_in date, p_check_out date, p_adults integer, p_children integer, p_total_amount numeric, p_invoice_number text DEFAULT NULL::text, p_notes text DEFAULT ''::text, p_created_by uuid DEFAULT NULL::uuid, p_deposit_amount numeric DEFAULT 0, p_booking_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_deposit_method text DEFAULT NULL::text, p_allow_total_override boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_conflict int;
  v_existing_id uuid;
  v_id uuid := coalesce(p_booking_id, gen_random_uuid());
  v_is_existing boolean := false;
  v_dep_result jsonb;
  v_expected_total numeric;
  v_total_amount numeric := round(coalesce(p_total_amount, 0)::numeric, 2);
begin
  perform public.app_reject_pwa_financial_mutation();

  if p_deposit_amount > 0 and p_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  if v_total_amount < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  v_expected_total := public.room_booking_expected_total(p_lodge_id, p_room_id, p_check_in, p_check_out);
  if v_expected_total is null then
    return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
  end if;

  if abs(v_total_amount - v_expected_total) > 0.01 then
    if p_allow_total_override then
      perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
    else
      return jsonb_build_object(
        'success', false,
        'error', format(
          'Booking total must match the room rate for this stay. Expected %s, received %s.',
          v_expected_total,
          v_total_amount
        )
      );
    end if;
  end if;

  if p_idempotency_key is not null then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.create_idempotency_key = p_idempotency_key
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id = p_lodge_id
       and b.id = v_id
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if p_invoice_number is null and not v_is_existing then
    p_invoice_number := get_next_invoice_number(p_lodge_id);
  end if;

  if not v_is_existing then
    select count(*)
      into v_conflict
      from public.bookings
     where room_id = p_room_id
       and lodge_id = p_lodge_id
       and status != 'cancelled'
       and not (check_out <= p_check_in or check_in >= p_check_out);

    if v_conflict > 0 then
      return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
    end if;

    insert into public.bookings (
      id, lodge_id, customer_id, room_id,
      check_in, check_out, adults, children,
      total_amount, amount_paid, payment_status,
      status, invoice_number, notes, created_by,
      deposit_amount, payment_method,
      created_at, updated_at, create_idempotency_key
    ) values (
      v_id, p_lodge_id, p_customer_id, p_room_id,
      p_check_in, p_check_out, p_adults, p_children,
      v_total_amount, 0, 'unpaid',
      'confirmed', p_invoice_number, p_notes, p_created_by,
      p_deposit_amount, null,
      now(), now(), p_idempotency_key
    );

    insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
    values (v_id, p_lodge_id, p_invoice_number, now())
    on conflict do nothing;
  end if;

  if p_deposit_amount > 0 and p_deposit_method is not null then
    select public.update_booking_payment(
      v_id, p_lodge_id, p_deposit_amount, p_deposit_method,
      'deposit', 'payment:deposit:' || v_id, p_created_by
    ) into v_dep_result;

    if not coalesce((v_dep_result->>'success')::boolean, false) then
      if v_is_existing then
        return jsonb_build_object(
          'success', true,
          'booking_id', v_id,
          'depositWarning', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
        );
      end if;

      raise exception using
        message = 'Deposit failed',
        detail = coalesce(v_dep_result->>'error', 'unknown'),
        errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$$;


--
-- Name: create_booking_record(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_booking_record(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid := coalesce((payload->>'id')::uuid, gen_random_uuid());
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_check_in date := (payload->>'check_in')::date;
  v_check_out date := (payload->>'check_out')::date;
  v_status text := coalesce(payload->>'status', 'confirmed');
  v_existing_id uuid;
  v_invoice_number text := nullif(payload->>'invoice_number', '');
  v_room_status text;
  v_is_existing boolean := false;
  v_deposit_amount numeric := round(coalesce((payload->>'deposit_amount')::numeric, 0)::numeric, 2);
  v_deposit_method text := nullif(payload->>'deposit_method', '');
  v_dep_result jsonb;
  v_is_exclusive_event boolean := coalesce((payload->>'is_exclusive_event')::boolean, false);
  v_allow_total_override boolean := coalesce((payload->>'allow_total_override')::boolean, false);
  v_total_amount numeric := round(coalesce((payload->>'total_amount')::numeric, 0)::numeric, 2);
  v_expected_total numeric;
  v_create_key text := nullif(payload->>'create_idempotency_key', '');
  v_created_by uuid := nullif(payload->>'created_by', '')::uuid;
  v_deposit_key text;
begin
  perform public.app_reject_pwa_financial_mutation();

  -- NEW: Maintenance Check
  perform public.app_check_room_maintenance(v_lodge_id, v_room_id);

  if v_deposit_amount > 0 and v_deposit_method is null then
    return jsonb_build_object('success', false, 'error', 'Deposit method is required when deposit amount is provided');
  end if;

  if v_total_amount < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  if not v_is_exclusive_event and (coalesce((payload->>'adults')::int, 1) + coalesce((payload->>'children')::int, 0)) > (select r.max_occupancy from public.rooms r where r.id = v_room_id and r.lodge_id = v_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Number of guests exceeds room maximum occupancy');
  end if;

  if not v_is_exclusive_event then
    v_expected_total := public.room_booking_expected_total(v_lodge_id, v_room_id, v_check_in, v_check_out);
    if v_expected_total is null then
      return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
    end if;

    if abs(v_total_amount - v_expected_total) > 0.01 then
      if v_allow_total_override then
        perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);
      else
        return jsonb_build_object(
          'success', false,
          'error', format(
            'Booking total must match the room rate for this stay. Expected %s, received %s.',
            v_expected_total,
            v_total_amount
          )
        );
      end if;
    end if;
  end if;

  if v_create_key is not null then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id::text = v_lodge_id::text
       and b.create_idempotency_key = payload->>'create_idempotency_key'
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    select b.id
      into v_existing_id
      from public.bookings b
     where b.lodge_id::text = v_lodge_id::text
       and b.id::text = v_id::text
     limit 1;
    if found then
      v_id := v_existing_id;
      v_is_existing := true;
    end if;
  end if;

  if not v_is_existing then
    begin
      insert into public.bookings (
        id, lodge_id, customer_id, room_id,
        check_in, check_out, adults, children,
        total_amount, amount_paid, payment_status,
        status, invoice_number, notes, created_by,
        deposit_amount, payment_method,
        is_exclusive_event, event_daily_rate,
        created_at, updated_at, create_idempotency_key
      ) values (
        v_id, v_lodge_id, (payload->>'customer_id')::uuid, v_room_id,
        v_check_in, v_check_out,
        coalesce((payload->>'adults')::int, 1),
        coalesce((payload->>'children')::int, 0),
        v_total_amount,
        0, 'unpaid',
        v_status, null,
        coalesce(payload->>'notes', ''),
        v_created_by,
        v_deposit_amount, null,
        v_is_exclusive_event,
        coalesce((payload->>'event_daily_rate')::numeric, 0),
        now(), now(),
        v_create_key
      );
    exception
      when exclusion_violation then
        return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
    end;

    if v_invoice_number is null then
      v_invoice_number := get_next_invoice_number(v_lodge_id);
    end if;

    update public.bookings
       set invoice_number = v_invoice_number,
           updated_at = now()
     where id::text = v_id::text
       and lodge_id::text = v_lodge_id::text;

    if v_invoice_number is not null then
      insert into public.invoices (booking_id, lodge_id, invoice_number, issued_at)
       values (v_id, v_lodge_id, v_invoice_number, now())
      on conflict do nothing;
    end if;

    v_room_status := case
      when v_status = 'checked_in' then 'occupied'
      when v_status in ('checked_out', 'cancelled') then 'available'
      else null
    end;

    if v_room_status is not null then
      update public.rooms
         set status = v_room_status
        where id::text = v_room_id::text
          and lodge_id::text = v_lodge_id::text;
    end if;
  end if;

  if v_deposit_amount > 0 and v_deposit_method is not null then
    v_deposit_key := 'payment:deposit:' || v_id::text;

    if not exists (
      select 1
        from public.payments
       where booking_id::text = v_id::text
         and lodge_id::text = v_lodge_id::text
         and idempotency_key = v_deposit_key
    ) then
      select public.update_booking_payment(
        v_id, v_lodge_id, v_deposit_amount, v_deposit_method,
        'deposit', v_deposit_key,
        v_created_by
      ) into v_dep_result;

      if not coalesce((v_dep_result->>'success')::boolean, false) then
        if not v_is_existing then
          delete from public.bookings
           where id::text = v_id::text
             and lodge_id::text = v_lodge_id::text;
        end if;

        return jsonb_build_object(
          'success', false,
          'booking_id', v_id,
          'error', coalesce(v_dep_result->>'error', 'Deposit could not be recorded')
        );
      end if;
    end if;
  end if;

  return jsonb_build_object('success', true, 'booking_id', v_id);
end;
$$;


--
-- Name: create_broadcast(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_broadcast(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  insert into public.broadcasts (
    title,
    message,
    expires_at,
    is_active
  ) values (
    payload->>'title',
    payload->>'message',
    nullif(payload->>'expires_at', '')::timestamptz,
    coalesce((payload->>'is_active')::boolean, true)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_conference_booking(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_conference_booking(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id            uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_total_amount  numeric;
  v_deposit_paid  numeric;
  v_pay_status    text;
begin
  perform public.app_reject_pwa_financial_mutation();

  if exists (
    select 1 from public.conference_bookings
    where id = v_id
      and lodge_id = (payload->>'lodge_id')::uuid
  ) then
    return jsonb_build_object('success', true, 'id', v_id, 'idempotent', true);
  end if;

  v_total_amount := coalesce((payload->>'total_amount')::numeric, 0);
  v_deposit_paid := coalesce((payload->>'deposit_paid')::numeric, 0);

  if v_deposit_paid < 0 then
    return jsonb_build_object('success', false, 'error', 'Deposit paid cannot be negative.');
  end if;

  if v_total_amount > 0 and v_deposit_paid > v_total_amount then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Deposit paid (%s) cannot exceed total amount (%s).',
        round(v_deposit_paid::numeric, 2),
        round(v_total_amount::numeric, 2)
      )
    );
  end if;

  v_pay_status := public.compute_conference_payment_status(v_deposit_paid, v_total_amount);

  insert into public.conference_bookings (
    id, lodge_id, booking_date, start_time, end_time,
    client_name, company, attendees, setup_type, room_name,
    includes_catering, catering_notes,
    total_amount, deposit_paid, payment_status, payment_method, notes
  ) values (
    v_id,
    (payload->>'lodge_id')::uuid,
    (payload->>'booking_date')::date,
    (payload->>'start_time')::time,
    (payload->>'end_time')::time,
    payload->>'client_name',
    nullif(payload->>'company', ''),
    coalesce((payload->>'attendees')::integer, 0),
    coalesce(payload->>'setup_type', 'Theatre'),
    coalesce(payload->>'room_name', 'Conference Room'),
    coalesce((payload->>'includes_catering')::boolean, false),
    nullif(payload->>'catering_notes', ''),
    v_total_amount,
    v_deposit_paid,
    v_pay_status,
    nullif(payload->>'payment_method', ''),
    nullif(payload->>'notes', '')
  );

  return jsonb_build_object('success', true, 'id', v_id, 'payment_status', v_pay_status);
end;
$$;


--
-- Name: create_customer(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_customer(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  -- Idempotency: replay after ACK loss returns existing row rather than inserting duplicate
  if exists (select 1 from public.customers where id = (payload->>'id')::uuid and lodge_id = (payload->>'lodge_id')::uuid) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  insert into public.customers (
    id,
    lodge_id,
    name,
    email,
    phone,
    id_number,
    nationality
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'email', ''),
    coalesce(payload->>'phone', ''),
    coalesce(payload->>'id_number', ''),
    coalesce(payload->>'nationality', '')
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_expense(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_expense(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_amount numeric := coalesce((payload->>'amount')::numeric, 0);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if v_amount <= 0 or v_amount > 999999.99 then
    raise exception 'Expense amount must be between P0.01 and P999,999.99';
  end if;

  insert into public.expenses (
    lodge_id,
    date,
    category,
    description,
    amount,
    outlet_id
  ) values (
    v_lodge_id,
    (payload->>'date')::date,
    payload->>'category',
    payload->>'description',
    v_amount,
    nullif(payload->>'outlet_id', '')::uuid
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_inventory_item(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_inventory_item(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_outlet_type text;
  v_selling_price numeric := coalesce((payload->>'selling_price')::numeric, 0);
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_outlet_id is not null then
    select type
      into v_outlet_type
      from public.outlets
     where id = v_outlet_id
       and lodge_id = v_lodge_id
     limit 1;

    if v_outlet_type is null then
      return jsonb_build_object('success', false, 'error', 'Selected outlet was not found.');
    end if;
  end if;

  if coalesce(v_outlet_type, '') = 'beverage'
     and v_selling_price <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a POS selling price greater than zero for Bar inventory items.');
  end if;

  insert into public.inventory_items (
    lodge_id,
    name,
    category,
    unit,
    current_stock,
    reorder_level,
    latest_unit_cost,
    selling_price,
    outlet_id
  ) values (
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Bar'),
    coalesce(payload->>'unit', 'unit'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0),
    v_selling_price,
    v_outlet_id
  )
  returning id into v_id;

  perform public.sync_inventory_item_to_pos(v_id, v_lodge_id);

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_inventory_stocktake_session(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_inventory_stocktake_session(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_stocktake_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_title text := nullif(payload->>'title', '');
  v_notes text := nullif(payload->>'notes', '');
  v_created_by uuid := nullif(payload->>'created_by', '')::uuid;
  v_line_count integer := 0;
begin
  insert into public.inventory_stocktakes (
    lodge_id,
    outlet_id,
    title,
    notes,
    created_by
  ) values (
    v_lodge_id,
    v_outlet_id,
    v_title,
    v_notes,
    v_created_by
  )
  returning id into v_stocktake_id;

  insert into public.inventory_stocktake_lines (
    stocktake_id,
    lodge_id,
    item_id,
    expected_qty,
    counted_qty,
    variance_qty,
    unit_cost,
    variance_cost
  )
  select
    v_stocktake_id,
    ii.lodge_id,
    ii.id,
    coalesce(ii.current_stock, 0),
    null,
    null,
    coalesce(ii.latest_unit_cost, last_purchase.unit_cost, 0),
    null
  from public.inventory_items ii
  left join lateral (
    select ip.unit_cost
    from public.inventory_purchases ip
    where ip.item_id = ii.id
      and ip.lodge_id = ii.lodge_id
      and coalesce(ip.unit_cost, 0) > 0
    order by ip.date desc, ip.created_at desc nulls last
    limit 1
  ) last_purchase on true
  where ii.lodge_id = v_lodge_id
    and (v_outlet_id is null or ii.outlet_id = v_outlet_id);

  get diagnostics v_line_count = row_count;

  return jsonb_build_object(
    'success', true,
    'id', v_stocktake_id,
    'line_count', v_line_count
  );
end;
$$;


--
-- Name: create_maintenance_ticket(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_maintenance_ticket(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  has_title boolean;
  has_issue boolean;
  has_description boolean;
  has_notes boolean;
  has_status boolean;
  has_priority boolean;
  has_reported_date boolean;
  has_labour_cost boolean;
  has_parts_cost boolean;
  has_total_cost boolean;
  has_vendor_name boolean;
  has_cost_notes boolean;
  cols text[] := array[]::text[];
  vals text[] := array[]::text[];
  v_id text;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'title') into has_title;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'issue') into has_issue;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'description') into has_description;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'notes') into has_notes;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'status') into has_status;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'priority') into has_priority;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'reported_date') into has_reported_date;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'labour_cost') into has_labour_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'parts_cost') into has_parts_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'total_cost') into has_total_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'vendor_name') into has_vendor_name;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'cost_notes') into has_cost_notes;

  cols := array_append(cols, 'lodge_id');
  vals := array_append(vals, format('%L', payload->>'lodge_id'));

  if coalesce(payload->>'room_id', '') <> '' then
    cols := array_append(cols, 'room_id');
    vals := array_append(vals, format('%L', payload->>'room_id'));
  end if;

  if has_title then
    cols := array_append(cols, 'title');
    vals := array_append(vals, format('%L', coalesce(payload->>'title', payload->>'issue', '')));
  end if;
  if has_issue then
    cols := array_append(cols, 'issue');
    vals := array_append(vals, format('%L', coalesce(payload->>'issue', payload->>'title', '')));
  end if;
  if has_description then
    cols := array_append(cols, 'description');
    vals := array_append(vals, format('%L', coalesce(payload->>'description', '')));
  end if;
  if has_notes then
    cols := array_append(cols, 'notes');
    vals := array_append(vals, format('%L', coalesce(payload->>'notes', payload->>'description', '')));
  end if;
  if has_status then
    cols := array_append(cols, 'status');
    vals := array_append(vals, format('%L', coalesce(payload->>'status', 'open')));
  end if;
  if has_priority then
    cols := array_append(cols, 'priority');
    vals := array_append(vals, format('%L', coalesce(payload->>'priority', 'medium')));
  end if;
  if has_reported_date and coalesce(payload->>'reported_date', '') <> '' then
    cols := array_append(cols, 'reported_date');
    vals := array_append(vals, format('%L', payload->>'reported_date'));
  end if;
  if has_labour_cost then
    cols := array_append(cols, 'labour_cost');
    vals := array_append(vals, coalesce(nullif(payload->>'labour_cost', ''), '0'));
  end if;
  if has_parts_cost then
    cols := array_append(cols, 'parts_cost');
    vals := array_append(vals, coalesce(nullif(payload->>'parts_cost', ''), '0'));
  end if;
  if has_total_cost then
    cols := array_append(cols, 'total_cost');
    vals := array_append(vals, coalesce(nullif(payload->>'total_cost', ''), '0'));
  end if;
  if has_vendor_name and coalesce(payload->>'vendor_name', '') <> '' then
    cols := array_append(cols, 'vendor_name');
    vals := array_append(vals, format('%L', payload->>'vendor_name'));
  end if;
  if has_cost_notes and coalesce(payload->>'cost_notes', '') <> '' then
    cols := array_append(cols, 'cost_notes');
    vals := array_append(vals, format('%L', payload->>'cost_notes'));
  end if;

  execute format(
    'insert into public.maintenance_tickets (%s) values (%s) returning id::text',
    array_to_string(cols, ', '),
    array_to_string(vals, ', ')
  )
  into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_online_booking(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_online_booking(p_slug text, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_lodge_name text;
  v_currency text;
  v_room_id uuid;
  v_check_in date;
  v_check_out date;
  v_first_name text;
  v_last_name text;
  v_email text;
  v_phone text;
  v_adults int;
  v_children int;
  v_notes text;
  v_features jsonb;
  v_enabled boolean;
  v_customer_id uuid;
  v_room public.rooms%rowtype;
  v_nights int;
  v_total numeric;
  v_idem_key text;
  v_booking_id uuid;
  v_reference text;
  v_confirmation_token text;
  v_conflict uuid;
  v_invoice_number text;
  v_rate_limit_error text;
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Invalid lodge');
  end if;

  select s.lodge_id, coalesce(s.lodge_name, s.company_name), coalesce(s.currency, 'P')
    into v_lodge_id, v_lodge_name, v_currency
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking is not available for this property');
  end if;

  v_room_id := nullif(payload->>'room_id', '')::uuid;
  v_check_in := nullif(payload->>'check_in', '')::date;
  v_check_out := nullif(payload->>'check_out', '')::date;
  v_first_name := btrim(coalesce(payload->>'guest_first_name', ''));
  v_last_name := btrim(coalesce(payload->>'guest_last_name', ''));
  v_email := lower(btrim(coalesce(payload->>'guest_email', '')));
  v_phone := btrim(coalesce(payload->>'guest_phone', ''));
  v_adults := coalesce((payload->>'adults')::int, 1);
  v_children := coalesce((payload->>'children')::int, 0);
  v_notes := btrim(coalesce(payload->>'notes', ''));

  if v_room_id is null then return jsonb_build_object('success', false, 'error', 'Room is required'); end if;
  if v_check_in is null or v_check_out is null then return jsonb_build_object('success', false, 'error', 'Check-in and check-out dates are required'); end if;
  if v_check_out <= v_check_in then return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in'); end if;
  if v_check_in < current_date then return jsonb_build_object('success', false, 'error', 'Check-in date cannot be in the past'); end if;
  if v_first_name = '' or v_last_name = '' then return jsonb_build_object('success', false, 'error', 'Guest name is required'); end if;
  if v_email = '' or v_email not like '%@%' then return jsonb_build_object('success', false, 'error', 'A valid email address is required'); end if;

  v_rate_limit_error := public.check_online_booking_rate_limit(v_lodge_id, v_email, v_phone);
  if v_rate_limit_error is not null then
    return jsonb_build_object('success', false, 'error', v_rate_limit_error);
  end if;

  perform public.app_check_room_maintenance(v_lodge_id, v_room_id);

  select *
    into v_room
  from public.rooms r
  where r.id::text = v_room_id::text
    and r.lodge_id::text = v_lodge_id::text
    and r.status not in ('maintenance')
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found or currently unavailable');
  end if;

  select b.id
    into v_conflict
  from public.bookings b
  where b.lodge_id::text = v_lodge_id::text
    and b.room_id::text = v_room_id::text
    and b.status not in ('cancelled', 'checked_out')
    and not (b.check_out <= v_check_in or b.check_in >= v_check_out)
  limit 1;

  if v_conflict is not null then
    return jsonb_build_object('success', false, 'error', 'This room is not available for the selected dates');
  end if;

  v_nights := v_check_out - v_check_in;
  v_total := v_room.rate_per_night * v_nights;
  v_idem_key := coalesce(
    nullif(btrim(payload->>'idempotency_key'), ''),
    md5(v_email || '::' || v_room_id::text || '::' || v_check_in::text || '::' || v_check_out::text)
  );

  select b.id, b.online_confirmation_token
    into v_booking_id, v_confirmation_token
  from public.bookings b
  where b.lodge_id::text = v_lodge_id::text
    and b.create_idempotency_key = v_idem_key
  limit 1;

  if found then
    v_reference := 'ONL-' || upper(substring(v_booking_id::text, 1, 8));
    return jsonb_build_object(
      'success', true,
      'reference', v_reference,
      'booking_id', v_booking_id,
      'confirmation_token', v_confirmation_token,
      'idempotent', true,
      'lodge_name', v_lodge_name,
      'currency', v_currency,
      'room_number', v_room.room_number,
      'room_type', v_room.room_type,
      'check_in', v_check_in,
      'check_out', v_check_out,
      'nights', v_nights,
      'total_amount', v_total,
      'guest_name', v_first_name || ' ' || v_last_name,
      'guest_email', v_email
    );
  end if;

  select id
    into v_customer_id
  from public.customers
  where lodge_id::text = v_lodge_id::text
    and lower(btrim(coalesce(email, ''))) = v_email
  limit 1;

  if not found then
    insert into public.customers (id, lodge_id, name, email, phone)
    values (gen_random_uuid(), v_lodge_id, v_first_name || ' ' || v_last_name, v_email, nullif(v_phone, ''))
    returning id into v_customer_id;
  end if;

  v_booking_id := gen_random_uuid();
  v_reference := 'ONL-' || upper(substring(v_booking_id::text, 1, 8));
  v_confirmation_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_invoice_number := public.get_next_invoice_number(v_lodge_id);

  insert into public.bookings (
    id, lodge_id, customer_id, room_id,
    check_in, check_out, adults, children,
    total_amount, amount_paid, payment_status, status,
    source, invoice_number, notes, deposit_amount,
    is_exclusive_event, event_daily_rate,
    created_at, updated_at, create_idempotency_key, online_confirmation_token
  ) values (
    v_booking_id, v_lodge_id, v_customer_id, v_room_id,
    v_check_in, v_check_out, v_adults, v_children,
    v_total, 0, 'unpaid', 'pending',
    'online', v_invoice_number,
    case when v_notes = '' then 'Online booking request' else 'Online booking request: ' || v_notes end,
    0, false, 0, now(), now(), v_idem_key, v_confirmation_token
  );

  insert into invoices (booking_id, lodge_id, invoice_number, issued_at, due_date)
  values (v_booking_id, v_lodge_id, v_invoice_number, now(), v_check_in)
  on conflict do nothing;

  return jsonb_build_object(
    'success', true,
    'reference', v_reference,
    'booking_id', v_booking_id,
    'confirmation_token', v_confirmation_token,
    'invoice_number', v_invoice_number,
    'lodge_name', v_lodge_name,
    'currency', v_currency,
    'room_number', v_room.room_number,
    'room_type', v_room.room_type,
    'check_in', v_check_in,
    'check_out', v_check_out,
    'nights', v_nights,
    'total_amount', v_total,
    'guest_name', v_first_name || ' ' || v_last_name,
    'guest_email', v_email
  );
end;
$$;


--
-- Name: create_pos_menu_item(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_pos_menu_item(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_outlet_type text;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_outlet_id is not null then
    select type
      into v_outlet_type
      from public.outlets
     where id = v_outlet_id
       and lodge_id = v_lodge_id
     limit 1;
  end if;

  if coalesce(v_outlet_type, '') = 'beverage' then
    return jsonb_build_object('success', false, 'error', 'Bar POS items must come from Bar inventory products.');
  end if;

  insert into public.pos_menu_items (
    lodge_id,
    name,
    category,
    price,
    is_available,
    barcode,
    inventory_item_id,
    depletion_qty,
    outlet_id,
    template_kind,
    template_pack_size
  ) values (
    v_lodge_id,
    payload->>'name',
    coalesce(payload->>'category', 'Other'),
    coalesce((payload->>'price')::numeric, 0),
    coalesce((payload->>'is_available')::boolean, true),
    nullif(payload->>'barcode', ''),
    nullif(payload->>'inventory_item_id', '')::uuid,
    case
      when nullif(payload->>'inventory_item_id', '') is null then null
      else coalesce((payload->>'depletion_qty')::numeric, 1)
    end,
    v_outlet_id,
    'standard',
    null
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_pos_order(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_pos_order(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_order_id                uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_lodge_id                uuid := (payload->>'lodge_id')::uuid;
  v_outlet_id               uuid := nullif(payload->>'outlet_id', '')::uuid;
  v_room_id                 uuid := nullif(payload->>'room_id', '')::uuid;
  v_booking_id              uuid := nullif(payload->>'booking_id', '')::uuid;
  v_walk_in_name            text := nullif(payload->>'walk_in_name', '');
  v_notes                   text := nullif(payload->>'notes', '');
  v_payment_method          text := coalesce(nullif(payload->>'payment_method', ''), 'cash');
  v_create_idempotency_key  text := nullif(payload->>'create_idempotency_key', '');
  v_created_at_client       timestamptz := nullif(payload->>'created_at_client', '')::timestamptz;
  v_is_replay               boolean := v_create_idempotency_key is not null or payload ? 'created_at_client';
  v_existing_id             uuid;
  v_existing_total          numeric;
  v_existing_charge_id      uuid;
  v_item                    jsonb;
  v_menu_item_id            uuid;
  v_inv_item_id             uuid;
  v_depletion_qty           numeric;
  v_quantity                numeric;
  v_db_price                numeric;
  v_unit_price              numeric;
  v_item_name               text;
  v_computed_total          numeric := 0;
  v_is_available            boolean;
  v_required_stock          numeric;
  v_new_stock               numeric;
  v_folio_charge_id         uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['cashier', 'supervisor', 'manager', 'admin', 'super_admin']);
  perform public.app_require_pos_outlet_access(v_lodge_id, v_outlet_id);

  if v_payment_method = 'folio' and v_booking_id is null and v_room_id is not null then
    select b.id
      into v_booking_id
      from public.bookings b
     where b.lodge_id = v_lodge_id
       and b.room_id = v_room_id
       and b.status in ('confirmed', 'checked_in')
       and b.check_in <= current_date
       and b.check_out > current_date
     order by b.check_in desc, b.created_at desc
     limit 1;
  end if;

  if v_payment_method = 'folio' then
    if v_booking_id is null then
      return jsonb_build_object('success', false, 'error', 'Room folio charge requires an active booking');
    end if;

    if not exists (
      select 1
        from public.bookings b
       where b.id = v_booking_id
         and b.lodge_id = v_lodge_id
         and b.status in ('confirmed', 'checked_in')
    ) then
      return jsonb_build_object('success', false, 'error', 'Active booking not found for folio charge');
    end if;
  end if;

  if v_create_idempotency_key is not null then
    select id, total, folio_charge_id
      into v_existing_id, v_existing_total, v_existing_charge_id
      from public.pos_orders
     where lodge_id = v_lodge_id
       and create_idempotency_key = v_create_idempotency_key
     for update;

    if found then
      if coalesce(v_existing_total, 0) <= 0 then
        return jsonb_build_object('success', false, 'error', 'Existing POS order is incomplete and needs review before replay');
      end if;

      if v_payment_method = 'folio' and v_existing_charge_id is null then
        return jsonb_build_object('success', false, 'error', 'Existing folio POS order is missing its booking charge and needs review');
      end if;

      return jsonb_build_object(
        'success', true,
        'id', v_existing_id,
        'total', coalesce(v_existing_total, 0),
        'idempotent', true,
        'replayed', true
      );
    end if;
  end if;

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1),
             coalesce(is_available, true)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty,
             v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;

        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
        v_depletion_qty := coalesce(nullif(v_item->>'depletion_qty', '')::numeric, 1);
        if v_inv_item_id is null then
          select case when count(*) = 1 then max(id) else null end
            into v_inv_item_id
            from public.inventory_items
           where lodge_id = v_lodge_id
             and name = v_item_name
             and (v_outlet_id is null or outlet_id = v_outlet_id);
        end if;
      else
        raise exception 'POS menu item % not found for lodge % — order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
      v_depletion_qty := coalesce(nullif(v_item->>'depletion_qty', '')::numeric, 1);
      if v_inv_item_id is null then
        select case when count(*) = 1 then max(id) else null end
          into v_inv_item_id
          from public.inventory_items
         where lodge_id = v_lodge_id
           and name = v_item_name
           and (v_outlet_id is null or outlet_id = v_outlet_id);
      end if;
    end if;

    v_computed_total := v_computed_total + (v_quantity * v_unit_price);
  end loop;

  insert into public.pos_orders (
    id,
    lodge_id,
    room_id,
    booking_id,
    walk_in_name,
    total,
    notes,
    payment_method,
    outlet_id,
    status,
    created_at,
    create_idempotency_key,
    folio_charge_id
  ) values (
    v_order_id,
    v_lodge_id,
    v_room_id,
    v_booking_id,
    v_walk_in_name,
    v_computed_total,
    v_notes,
    v_payment_method,
    v_outlet_id,
    'completed',
    coalesce(v_created_at_client, now()),
    v_create_idempotency_key,
    null
  );

  for v_item in
    select * from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity := coalesce((v_item->>'quantity')::numeric, 1);
    v_item_name := coalesce(nullif(v_item->>'item_name', ''), 'POS Item');

    if v_menu_item_id is not null then
      select price,
             inventory_item_id,
             coalesce(depletion_qty, 1),
             coalesce(is_available, true)
        into v_db_price,
             v_inv_item_id,
             v_depletion_qty,
             v_is_available
        from public.pos_menu_items
       where id = v_menu_item_id
         and lodge_id = v_lodge_id;

      if found then
        if not v_is_available then
          raise exception '% is not currently available for sale.', v_item_name;
        end if;

        v_unit_price := case
          when v_is_replay then coalesce((v_item->>'unit_price')::numeric, 0)
          else v_db_price
        end;
      elsif v_is_replay then
        v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
        v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
        v_depletion_qty := coalesce(nullif(v_item->>'depletion_qty', '')::numeric, 1);
        if v_inv_item_id is null then
          select case when count(*) = 1 then max(id) else null end
            into v_inv_item_id
            from public.inventory_items
           where lodge_id = v_lodge_id
             and name = v_item_name
             and (v_outlet_id is null or outlet_id = v_outlet_id);
        end if;
      else
        raise exception 'POS menu item % not found for lodge % — order rejected', v_menu_item_id, v_lodge_id;
      end if;
    else
      v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
      v_inv_item_id := nullif(v_item->>'inventory_item_id', '')::uuid;
      v_depletion_qty := coalesce(nullif(v_item->>'depletion_qty', '')::numeric, 1);
      if v_inv_item_id is null then
        select case when count(*) = 1 then max(id) else null end
          into v_inv_item_id
          from public.inventory_items
         where lodge_id = v_lodge_id
           and name = v_item_name
           and (v_outlet_id is null or outlet_id = v_outlet_id);
      end if;
    end if;

    insert into public.pos_order_items (
      id, order_id, lodge_id, menu_item_id,
      item_name, quantity, unit_price, subtotal
    ) values (
      gen_random_uuid(),
      v_order_id,
      v_lodge_id,
      v_menu_item_id,
      v_item_name,
      v_quantity,
      v_unit_price,
      v_quantity * v_unit_price
    );

    if v_inv_item_id is not null then
      v_required_stock := coalesce(v_depletion_qty, 1) * v_quantity;

      update public.inventory_items
         set current_stock = coalesce(current_stock, 0) - v_required_stock
       where id = v_inv_item_id
         and lodge_id = v_lodge_id
         and coalesce(current_stock, 0) >= v_required_stock
      returning current_stock into v_new_stock;

      if not found then
        raise exception 'Not enough stock left for %. Refresh the POS and try again.', v_item_name;
      end if;
    end if;
  end loop;

  if v_payment_method = 'folio' then
    insert into public.booking_charges (
      booking_id,
      lodge_id,
      description,
      category,
      quantity,
      amount,
      outlet_id
    ) values (
      v_booking_id,
      v_lodge_id,
      'POS folio charge · order ' || left(v_order_id::text, 8),
      'pos',
      1,
      v_computed_total,
      v_outlet_id
    )
    returning id into v_folio_charge_id;

    update public.pos_orders
       set folio_charge_id = v_folio_charge_id
     where id = v_order_id
       and lodge_id = v_lodge_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'id', v_order_id,
    'total', v_computed_total,
    'booking_id', v_booking_id,
    'folio_charge_id', v_folio_charge_id
  );
end;
$$;


--
-- Name: create_quotation(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_quotation(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid := (payload->>'id')::uuid;
  v_existing uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  select id
    into v_existing
    from public.quotations
   where id = v_id
     and lodge_id = (payload->>'lodge_id')::uuid
   limit 1;

  if found then
    return jsonb_build_object(
      'success', true,
      'id', v_existing,
      'quotation_number', payload->>'quotation_number',
      'idempotent', true
    );
  end if;

  insert into public.quotations (
    id, quotation_number, lodge_id, customer_id, customer_name, customer_phone,
    room_id, room_name, check_in, check_out, adults, children,
    subtotal, tax_amount, total_amount, currency, notes, status,
    valid_until, parent_quotation_id, created_by, created_at, updated_at
  ) values (
    v_id,
    payload->>'quotation_number',
    (payload->>'lodge_id')::uuid,
    nullif(payload->>'customer_id', '')::uuid,
    coalesce(payload->>'customer_name', ''),
    coalesce(payload->>'customer_phone', ''),
    nullif(payload->>'room_id', '')::uuid,
    coalesce(payload->>'room_name', ''),
    nullif(payload->>'check_in', '')::date,
    nullif(payload->>'check_out', '')::date,
    coalesce((payload->>'adults')::integer, 1),
    coalesce((payload->>'children')::integer, 0),
    coalesce((payload->>'subtotal')::numeric, 0),
    coalesce((payload->>'tax_amount')::numeric, 0),
    coalesce((payload->>'total_amount')::numeric, 0),
    coalesce(payload->>'currency', 'BWP'),
    coalesce(payload->>'notes', ''),
    coalesce(payload->>'status', 'draft'),
    nullif(payload->>'valid_until', '')::date,
    nullif(payload->>'parent_quotation_id', '')::uuid,
    nullif(payload->>'created_by', '')::uuid,
    coalesce((payload->>'created_at')::timestamptz, now()),
    coalesce((payload->>'updated_at')::timestamptz, now())
  );

  return jsonb_build_object(
    'success', true,
    'id', v_id,
    'quotation_number', payload->>'quotation_number'
  );
end;
$$;


--
-- Name: create_room(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_room(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  if exists (select 1 from public.rooms where id = (payload->>'id')::uuid and lodge_id = (payload->>'lodge_id')::uuid) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  insert into public.rooms (
    id, lodge_id, room_number, room_type, rate_per_night, max_occupancy,
    status, description, photo, photos, amenities, updated_at
  ) values (
    (payload->>'id')::uuid,
    (payload->>'lodge_id')::uuid,
    payload->>'room_number',
    payload->>'room_type',
    coalesce((payload->>'rate_per_night')::numeric, 0),
    coalesce((payload->>'max_occupancy')::integer, 2),
    coalesce(payload->>'status', 'available'),
    coalesce(payload->>'description', ''),
    coalesce(payload->>'photo', ''),
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
      case when payload->>'photo' is not null and payload->>'photo' <> ''
        then array[payload->>'photo'] else '{}'::text[] end
    ),
    coalesce(
      (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
      '{}'::text[]
    ),
    now()
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_room_rate_override(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_room_rate_override(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  insert into public.room_rate_overrides (
    lodge_id,
    room_id,
    name,
    start_date,
    end_date,
    rate_per_night
  ) values (
    (payload->>'lodge_id')::uuid,
    nullif(payload->>'room_id', '')::uuid,
    payload->>'name',
    (payload->>'start_date')::date,
    (payload->>'end_date')::date,
    coalesce((payload->>'rate_per_night')::numeric, 0)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_room_supply_stocktake_line(uuid, uuid, uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_room_supply_stocktake_line(p_stocktake_id uuid, p_lodge_id uuid, p_room_id uuid, p_supply_item_id uuid, p_counted_qty numeric DEFAULT 0, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.room_supply_stocktakes%rowtype;
  v_room_stock_id uuid;
  v_unit_cost numeric := 0;
begin
  select *
    into v_session
    from public.room_supply_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room stock take session not found');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Only open room stock takes can be updated');
  end if;

  select coalesce(si.latest_unit_cost, last_purchase.unit_cost, 0)
    into v_unit_cost
    from public.supply_items si
    left join lateral (
      select sp.unit_cost
      from public.supply_purchases sp
      where sp.item_id = si.id
        and sp.lodge_id = si.lodge_id
        and coalesce(sp.unit_cost, 0) > 0
      order by sp.date desc, sp.created_at desc nulls last
      limit 1
    ) last_purchase on true
   where si.id = p_supply_item_id
     and si.lodge_id = p_lodge_id;

  if v_unit_cost is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  insert into public.room_supply_room_stock (
    lodge_id,
    room_id,
    supply_item_id,
    quantity_on_hand,
    reorder_level,
    last_moved_at,
    updated_at
  ) values (
    p_lodge_id,
    p_room_id,
    p_supply_item_id,
    0,
    0,
    now(),
    now()
  )
  on conflict (lodge_id, room_id, supply_item_id)
  do update set updated_at = now()
  returning id into v_room_stock_id;

  insert into public.room_supply_stocktake_lines (
    stocktake_id,
    lodge_id,
    room_stock_id,
    room_id,
    supply_item_id,
    expected_qty,
    counted_qty,
    variance_qty,
    unit_cost,
    variance_cost,
    notes
  ) values (
    p_stocktake_id,
    p_lodge_id,
    v_room_stock_id,
    p_room_id,
    p_supply_item_id,
    0,
    greatest(coalesce(p_counted_qty, 0), 0),
    greatest(coalesce(p_counted_qty, 0), 0),
    coalesce(v_unit_cost, 0),
    greatest(coalesce(p_counted_qty, 0), 0) * coalesce(v_unit_cost, 0),
    nullif(p_notes, '')
  )
  on conflict (stocktake_id, room_stock_id)
  do update set
    counted_qty = greatest(coalesce(excluded.counted_qty, 0), 0),
    variance_qty = greatest(coalesce(excluded.counted_qty, 0), 0) - public.room_supply_stocktake_lines.expected_qty,
    variance_cost = (greatest(coalesce(excluded.counted_qty, 0), 0) - public.room_supply_stocktake_lines.expected_qty) * coalesce(public.room_supply_stocktake_lines.unit_cost, excluded.unit_cost, 0),
    notes = coalesce(excluded.notes, public.room_supply_stocktake_lines.notes),
    updated_at = now();

  update public.room_supply_stocktakes
     set counted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true, 'room_stock_id', v_room_stock_id);
end;
$$;


--
-- Name: create_room_supply_stocktake_session(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_room_supply_stocktake_session(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_stocktake_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_title text := nullif(payload->>'title', '');
  v_notes text := nullif(payload->>'notes', '');
  v_created_by uuid := nullif(payload->>'created_by', '')::uuid;
  v_line_count integer := 0;
begin
  insert into public.room_supply_stocktakes (
    lodge_id,
    title,
    notes,
    created_by
  ) values (
    v_lodge_id,
    v_title,
    v_notes,
    v_created_by
  )
  returning id into v_stocktake_id;

  insert into public.room_supply_stocktake_lines (
    stocktake_id,
    lodge_id,
    room_stock_id,
    room_id,
    supply_item_id,
    expected_qty,
    counted_qty,
    variance_qty,
    unit_cost,
    variance_cost
  )
  select
    v_stocktake_id,
    rs.lodge_id,
    rs.id,
    rs.room_id,
    rs.supply_item_id,
    coalesce(rs.quantity_on_hand, 0),
    null,
    null,
    coalesce(si.latest_unit_cost, last_purchase.unit_cost, 0),
    null
  from public.room_supply_room_stock rs
  join public.supply_items si
    on si.id = rs.supply_item_id
   and si.lodge_id = rs.lodge_id
  left join lateral (
    select sp.unit_cost
    from public.supply_purchases sp
    where sp.item_id = rs.supply_item_id
      and sp.lodge_id = rs.lodge_id
      and coalesce(sp.unit_cost, 0) > 0
    order by sp.date desc, sp.created_at desc nulls last
    limit 1
  ) last_purchase on true
  where rs.lodge_id = v_lodge_id;

  get diagnostics v_line_count = row_count;

  return jsonb_build_object(
    'success', true,
    'id', v_stocktake_id,
    'line_count', v_line_count
  );
end;
$$;


--
-- Name: create_supply_item(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_supply_item(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  insert into public.supply_items (
    lodge_id,
    name,
    category,
    unit,
    current_stock,
    reorder_level,
    latest_unit_cost
  ) values (
    (payload->>'lodge_id')::uuid,
    payload->>'name',
    coalesce(payload->>'category', 'Bathroom'),
    coalesce(payload->>'unit', 'piece'),
    coalesce((payload->>'current_stock')::numeric, 0),
    coalesce((payload->>'reorder_level')::numeric, 0),
    coalesce((payload->>'latest_unit_cost')::numeric, 0)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_supply_stocktake_session(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_supply_stocktake_session(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_stocktake_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_title text := nullif(payload->>'title', '');
  v_notes text := nullif(payload->>'notes', '');
  v_created_by uuid := nullif(payload->>'created_by', '')::uuid;
  v_line_count integer := 0;
begin
  insert into public.supply_stocktakes (
    lodge_id,
    title,
    notes,
    created_by
  ) values (
    v_lodge_id,
    v_title,
    v_notes,
    v_created_by
  )
  returning id into v_stocktake_id;

  insert into public.supply_stocktake_lines (
    stocktake_id,
    lodge_id,
    item_id,
    expected_qty,
    counted_qty,
    variance_qty,
    unit_cost,
    variance_cost
  )
  select
    v_stocktake_id,
    si.lodge_id,
    si.id,
    coalesce(si.current_stock, 0),
    null,
    null,
    coalesce(si.latest_unit_cost, last_purchase.unit_cost, 0),
    null
  from public.supply_items si
  left join lateral (
    select sp.unit_cost
    from public.supply_purchases sp
    where sp.item_id = si.id
      and sp.lodge_id = si.lodge_id
      and coalesce(sp.unit_cost, 0) > 0
    order by sp.date desc, sp.created_at desc nulls last
    limit 1
  ) last_purchase on true
  where si.lodge_id = v_lodge_id;

  get diagnostics v_line_count = row_count;

  return jsonb_build_object(
    'success', true,
    'id', v_stocktake_id,
    'line_count', v_line_count
  );
end;
$$;


--
-- Name: create_support_ticket(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_support_ticket(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  insert into public.support_tickets (
    lodge_id,
    lodge_name,
    title,
    description,
    category,
    priority,
    status
  ) values (
    v_lodge_id,
    nullif(payload->>'lodge_name', ''),
    nullif(payload->>'title', ''),
    nullif(payload->>'description', ''),
    coalesce(nullif(payload->>'category', ''), 'General'),
    coalesce(nullif(payload->>'priority', ''), 'Normal'),
    'open'
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: create_user(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_user(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_email text;
  v_outlet_ids uuid[];
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_role text := lower(coalesce(payload->>'role', 'receptionist'));
  v_auth_user_id uuid := nullif(payload->>'auth_user_id', '')::uuid;
  v_pwa_enabled boolean := coalesce((payload->>'pwa_enabled')::boolean, false);
  v_pwa_password_hash text := nullif(payload->>'pwa_password_hash', '');
  v_pwa_disabled_reason text := nullif(payload->>'pwa_disabled_reason', '');
  v_pwa_password_reset_by uuid := nullif(payload->>'pwa_password_reset_by', '')::uuid;
begin
  if exists (
    select 1
      from public.users
     where id = (payload->>'id')::uuid
       and lodge_id = v_lodge_id
  ) then
    return jsonb_build_object('success', true, 'id', (payload->>'id')::uuid, 'idempotent', true);
  end if;

  if exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
  ) then
    perform public.app_require_lodge_role(v_lodge_id, array['admin', 'manager', 'super_admin']);
  end if;

  v_email := lower(btrim(coalesce(payload->>'email', '')));

  if exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
       and lower(btrim(email)) = v_email
  ) then
    return jsonb_build_object(
      'success', false,
      'error', format('A user with the email "%s" already exists in this lodge.', v_email)
    );
  end if;

  if v_auth_user_id is not null and exists (
    select 1
      from public.users
     where lodge_id = v_lodge_id
       and auth_user_id = v_auth_user_id
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'That Supabase Auth account is already linked to a user in this lodge.'
    );
  end if;

  select coalesce(array_agg(elem::uuid), '{}'::uuid[])
    into v_outlet_ids
    from jsonb_array_elements_text(coalesce(payload->'allowed_outlet_ids', '[]'::jsonb)) as elem;

  if v_role in ('cashier', 'supervisor') and cardinality(v_outlet_ids) = 0 then
    return jsonb_build_object(
      'success', false,
      'error', 'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  if v_pwa_enabled and not public._is_pwa_role_eligible(v_role) then
    return jsonb_build_object(
      'success', false,
      'error', 'Only Manager and Admin roles can receive Manager PWA access.'
    );
  end if;

  insert into public.users (
    id,
    auth_user_id,
    lodge_id,
    name,
    email,
    password_hash,
    role,
    allowed_outlet_ids,
    pin_hash,
    pwa_enabled,
    pwa_password_hash,
    pwa_password_set_at,
    pwa_password_reset_by,
    pwa_disabled_reason
  ) values (
    (payload->>'id')::uuid,
    v_auth_user_id,
    v_lodge_id,
    payload->>'name',
    v_email,
    payload->>'password_hash',
    v_role,
    v_outlet_ids,
    nullif(payload->>'pin_hash', ''),
    v_pwa_enabled,
    v_pwa_password_hash,
    case when v_pwa_password_hash is not null then now() else null end,
    case when v_pwa_password_hash is not null then v_pwa_password_reset_by else null end,
    case
      when v_pwa_enabled then null
      else coalesce(v_pwa_disabled_reason, 'Manager PWA access has been turned off.')
    end
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'auth_user_id', v_auth_user_id);
end;
$$;


--
-- Name: delete_booking_charge(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_booking_charge(p_charge_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  delete from public.booking_charges
   where id = p_charge_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Charge not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_booking_charge(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_booking_charge(p_charge_id uuid, p_lodge_id uuid, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return public.delete_booking_charge(p_charge_id, p_lodge_id, p_reason, null);
end;
$$;


--
-- Name: delete_booking_charge(uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_booking_charge(p_charge_id uuid, p_lodge_id uuid, p_reason text DEFAULT NULL::text, p_expected_booking_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_actor_raw text;
  v_actor uuid;
  v_charge public.booking_charges%rowtype;
  v_booking public.bookings%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_effective_quantity numeric;
  v_effective_unit_price numeric;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['manager', 'admin', 'super_admin']
  );

  select *
    into v_charge
    from public.booking_charges
   where id = p_charge_id
     and lodge_id = p_lodge_id
   for update;

  if v_charge.id is null then
    return jsonb_build_object('success', false, 'error', 'Charge not found');
  end if;

  if v_charge.voided_at is not null then
    return jsonb_build_object('success', true, 'id', v_charge.id, 'already_voided', true);
  end if;

  select *
    into v_booking
    from public.bookings
   where id = v_charge.booking_id
     and lodge_id = p_lodge_id
   for update;

  if v_booking.id is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_expected_booking_updated_at is not null and v_booking.updated_at is distinct from p_expected_booking_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  v_actor_raw := nullif(btrim(coalesce(current_setting('app.actor_id', true), '')), '');
  v_actor := case when v_actor_raw ~ '^[0-9a-f\\-]{36}$' then v_actor_raw::uuid else null end;
  v_effective_quantity := coalesce(v_charge.quantity, 1);
  v_effective_unit_price := case
    when nullif(v_effective_quantity, 0) is null then null
    else round(coalesce(v_charge.amount, 0) / nullif(v_effective_quantity, 0), 2)
  end;

  update public.booking_charges
     set voided_at = now(),
         voided_by = v_actor,
         void_reason = coalesce(v_reason, 'Voided by staff')
   where id = v_charge.id;

  insert into public.financial_audit_log (
    lodge_id,
    booking_id,
    action,
    actor_id,
    amount_delta,
    before_snapshot,
    after_snapshot
  ) values (
    v_charge.lodge_id,
    v_charge.booking_id,
    'charge_deleted',
    v_actor,
    -1 * coalesce(v_charge.amount, 0),
    jsonb_build_object(
      'charge_id', v_charge.id,
      'description', v_charge.description,
      'category', v_charge.category,
      'quantity', v_effective_quantity,
      'unit_price', v_effective_unit_price,
      'amount', v_charge.amount,
      'outlet_id', v_charge.outlet_id
    ),
    jsonb_build_object(
      'voided_at', now(),
      'voided_by', v_actor,
      'void_reason', coalesce(v_reason, 'Voided by staff')
    )
  );

  return jsonb_build_object(
    'success', true,
    'id', v_charge.id,
    'voided', true
  );
end;
$_$;


--
-- Name: delete_broadcast(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_broadcast(p_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  delete from public.broadcasts
  where id = p_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Broadcast not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_conference_booking(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_conference_booking(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  delete from public.conference_bookings
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_expense(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_expense(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  delete from public.expenses
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Expense not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_inventory_item(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_inventory_item(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  delete from public.inventory_purchases
   where item_id = p_id
     and lodge_id = p_lodge_id;

  delete from public.pos_menu_items
   where inventory_item_id = p_id
     and lodge_id = p_lodge_id
     and auto_from_inventory = true;

  delete from public.inventory_items
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_pool_day_use(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_pool_day_use(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  delete from public.pool_day_use
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Pool day-use entry not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_pos_menu_item(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_pos_menu_item(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
  v_template_kind text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select template_kind
    into v_template_kind
    from public.pos_menu_items
   where id = p_id
     and lodge_id = p_lodge_id
   limit 1;

  if v_template_kind is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  if v_template_kind <> 'standard' then
    return jsonb_build_object('success', false, 'error', 'Inventory-managed Bar items cannot be deleted from the manual menu list.');
  end if;

  delete from public.pos_menu_items
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_room(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_room(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  delete from public.rooms
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_room_rate_override(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_room_rate_override(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  delete from public.room_rate_overrides
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Rate override not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_supply_item(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_supply_item(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  delete from public.room_supply_allocations
  where supply_item_id = p_id
    and lodge_id = p_lodge_id;

  delete from public.supply_purchases
  where item_id = p_id
    and lodge_id = p_lodge_id;

  delete from public.supply_items
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_deleted;

  if v_deleted is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: delete_user(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_user(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_deleted uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager']);
  delete from public.users where id = p_id and lodge_id = p_lodge_id returning id into v_deleted;
  if v_deleted is null then return jsonb_build_object('success', false, 'error', 'User not found'); end if;
  return jsonb_build_object('success', true, 'id', v_deleted);
end;
$$;


--
-- Name: enforce_usage_limits_on_insert(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_usage_limits_on_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_plan text := public.get_lodge_usage_plan(new.lodge_id);
  v_booking_limit integer;
  v_booking_grace integer;
  v_room_limit integer;
  v_user_limit integer;
  v_upgrade_plan text;
  v_used integer;
  v_target_month_start date;
  v_target_month_end date;
  v_creation_month_start timestamptz;
  v_creation_month_end timestamptz;
  v_effective_booking_limit integer;
  v_target_month_used integer;
  v_creation_month_used integer;
begin
  if v_plan = 'Pro' then
    return new;
  end if;

  if v_plan = 'Standard' then
    v_booking_limit := 200;
    v_booking_grace := 5;
    v_room_limit := 20;
    v_user_limit := 5;
    v_upgrade_plan := 'Pro';
  else
    v_booking_limit := 50;
    v_booking_grace := 2;
    v_room_limit := 6;
    v_user_limit := 2;
    v_upgrade_plan := 'Standard';
  end if;

  v_effective_booking_limit := v_booking_limit + v_booking_grace;

  if tg_table_name = 'bookings' then
    new.created_at := now();

    if lower(coalesce(new.status, '')) not in ('confirmed', 'checked_in', 'checked_out') then
      return new;
    end if;
    if coalesce(new.is_exclusive_event, false) = true then
      return new;
    end if;
    if new.check_in is null then
      return new;
    end if;

    v_target_month_start := date_trunc('month', new.check_in::timestamp)::date;
    v_target_month_end := (v_target_month_start + interval '1 month')::date;
    v_creation_month_start := date_trunc('month', new.created_at);
    v_creation_month_end := v_creation_month_start + interval '1 month';

    select count(*)
      into v_target_month_used
      from public.bookings b
     where b.lodge_id = new.lodge_id
       and lower(coalesce(b.status, '')) in ('confirmed', 'checked_in', 'checked_out')
       and coalesce(b.is_exclusive_event, false) = false
       and b.check_in >= v_target_month_start
       and b.check_in < v_target_month_end;

    if v_target_month_used >= v_effective_booking_limit then
      raise exception 'Booking limit reached for the selected check-in month on % plan. Upgrade to % to create more bookings.',
        v_plan, v_upgrade_plan;
    end if;

    select count(*)
      into v_creation_month_used
      from public.bookings b
     where b.lodge_id = new.lodge_id
       and lower(coalesce(b.status, '')) in ('confirmed', 'checked_in', 'checked_out')
       and coalesce(b.is_exclusive_event, false) = false
       and b.created_at >= v_creation_month_start
       and b.created_at < v_creation_month_end;

    if v_creation_month_used >= v_effective_booking_limit then
      raise exception 'Monthly booking creation limit reached for % plan. Upgrade to % to create more bookings.',
        v_plan, v_upgrade_plan;
    end if;
    return new;
  end if;

  if tg_table_name = 'rooms' then
    select count(*)
      into v_used
      from public.rooms r
     where r.lodge_id = new.lodge_id;

    if v_used >= v_room_limit then
      raise exception 'Room limit reached: % allows up to % rooms. Upgrade to % for more rooms.',
        v_plan, v_room_limit, v_upgrade_plan;
    end if;
    return new;
  end if;

  if tg_table_name = 'users' then
    select count(*)
      into v_used
      from public.users u
     where u.lodge_id = new.lodge_id;

    if v_used >= v_user_limit then
      raise exception 'User limit reached: % allows up to % staff accounts. Upgrade to % for more users.',
        v_plan, v_user_limit, v_upgrade_plan;
    end if;
    return new;
  end if;

  return new;
end;
$$;


--
-- Name: extract_booking_event_group(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.extract_booking_event_group(p_notes text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select nullif(substring(coalesce(p_notes, '') from '\[GROUP:([^\]]+)\]'), '');
$$;


--
-- Name: get_available_rooms(text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_available_rooms(p_slug text, p_check_in date, p_check_out date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_features jsonb;
  v_enabled boolean;
  v_rooms jsonb;
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Slug is required');
  end if;

  if p_check_in is null or p_check_out is null then
    return jsonb_build_object('success', false, 'error', 'Check-in and check-out dates are required');
  end if;

  if p_check_out <= p_check_in then
    return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in');
  end if;

  select lodge_id
  into v_lodge_id
  from public.settings
  where lower(btrim(coalesce(slug, ''))) = v_slug
    and coalesce(deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking not available');
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', r.id,
      'room_number', r.room_number,
      'room_type', r.room_type,
      'rate_per_night', r.rate_per_night,
      'max_occupancy', r.max_occupancy,
      'description', r.description,
      'photos', coalesce(r.photos, case when r.photo is not null and r.photo <> '' then array[r.photo] else '{}'::text[] end),
      'amenities', coalesce(r.amenities, '{}'::text[]),
      'nights', (p_check_out - p_check_in),
      'total_price', r.rate_per_night * (p_check_out - p_check_in)
    ) order by r.room_number
  ), '[]'::jsonb)
  into v_rooms
  from public.rooms r
  where r.lodge_id = v_lodge_id
    and r.status not in ('maintenance')
    and not exists (
      select 1
      from public.bookings b
      where b.lodge_id = v_lodge_id
        and b.room_id = r.id
        and b.status not in ('cancelled', 'checked_out')
        and not (b.check_out <= p_check_in or b.check_in >= p_check_out)
    );

  return jsonb_build_object(
    'success', true,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'nights', (p_check_out - p_check_in),
    'rooms', v_rooms
  );
end;
$$;


--
-- Name: get_available_rooms_summary(text, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_available_rooms_summary(p_slug text, p_check_in date, p_check_out date) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_features jsonb;
  v_enabled boolean;
  v_rooms jsonb;
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Slug is required');
  end if;

  if p_check_in is null or p_check_out is null then
    return jsonb_build_object('success', false, 'error', 'Check-in and check-out dates are required');
  end if;

  if p_check_out <= p_check_in then
    return jsonb_build_object('success', false, 'error', 'Check-out must be after check-in');
  end if;

  select lodge_id
    into v_lodge_id
    from public.settings
   where lower(btrim(coalesce(slug, ''))) = v_slug
     and coalesce(deleted, false) = false
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking not available');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'room_number', r.room_number,
        'room_type', r.room_type,
        'rate_per_night', r.rate_per_night,
        'max_occupancy', r.max_occupancy,
        'description', r.description,
        'photo', coalesce(
          nullif(
            (
              coalesce(
                r.photos,
                case
                  when r.photo is not null and r.photo <> '' then array[r.photo]
                  else '{}'::text[]
                end
              )
            )[1],
            ''
          ),
          ''
        ),
        'photo_count', coalesce(
          array_length(
            coalesce(
              r.photos,
              case
                when r.photo is not null and r.photo <> '' then array[r.photo]
                else '{}'::text[]
              end
            ),
            1
          ),
          0
        ),
        'amenities', coalesce(r.amenities, '{}'::text[]),
        'nights', (p_check_out - p_check_in),
        'total_price', r.rate_per_night * (p_check_out - p_check_in)
      )
      order by r.room_number
    ),
    '[]'::jsonb
  )
    into v_rooms
    from public.rooms r
   where r.lodge_id = v_lodge_id
     and r.status not in ('maintenance')
     and not exists (
       select 1
         from public.bookings b
        where b.lodge_id = v_lodge_id
          and b.room_id = r.id
          and b.status not in ('cancelled', 'checked_out')
          and not (b.check_out <= p_check_in or b.check_in >= p_check_out)
     );

  return jsonb_build_object(
    'success', true,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'nights', (p_check_out - p_check_in),
    'rooms', v_rooms
  );
end;
$$;


--
-- Name: get_booking_email_delivery_history(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_booking_email_delivery_history(p_lodge_id uuid, p_booking_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, lodge_id uuid, booking_id uuid, reference text, delivery_type text, delivery_status text, recipient text, error_message text, metadata jsonb, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager', 'super_admin']);

  return query
  select
    l.id,
    l.lodge_id,
    l.booking_id,
    l.reference,
    l.delivery_type,
    l.delivery_status,
    l.recipient,
    l.error_message,
    l.metadata,
    l.created_at
  from public.booking_email_delivery_log l
  where l.lodge_id = p_lodge_id
    and (p_booking_id is null or l.booking_id = p_booking_id)
  order by l.created_at desc, l.id desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
end;
$$;


--
-- Name: get_booking_payments(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_booking_payments(p_booking_id uuid, p_lodge_id uuid) RETURNS TABLE(id uuid, booking_id uuid, lodge_id uuid, amount numeric, method text, type text, paid_at timestamp with time zone, recorded_by uuid, notes text, created_at timestamp with time zone, refund_base_amount numeric, refund_retained_percent numeric, refund_retained_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if not exists (
    select 1
      from public.bookings b
     where b.id = p_booking_id
       and b.lodge_id = p_lodge_id
  ) then
    return;
  end if;

  return query
  select
    p.id,
    p.booking_id,
    p.lodge_id,
    p.amount,
    p.method,
    p.type,
    p.paid_at,
    p.recorded_by,
    coalesce(p.notes, '') as notes,
    p.created_at,
    null::numeric as refund_base_amount,
    null::numeric as refund_retained_percent,
    null::numeric as refund_retained_amount
  from public.payments p
  where p.booking_id = p_booking_id
    and p.lodge_id = p_lodge_id
  order by p.paid_at desc, p.created_at desc;
end;
$$;


--
-- Name: get_device_health_rollup(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_device_health_rollup(p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rows jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'device_id', device_id,
      'client_type', client_type,
      'reported_at', reported_at,
      'pending_queue_count', pending_queue_count,
      'failed_queue_count', failed_queue_count,
      'unresolved_local_count', unresolved_local_count,
      'replay_auth_ready', replay_auth_ready,
      'last_successful_sync_at', last_successful_sync_at,
      'reconciliation_state', reconciliation_state,
      'top_fault_types', top_fault_types,
      'stale', (now() - reported_at) > interval '10 minutes'
    )
  ) into v_rows
  from device_health_reports
  where lodge_id = p_lodge_id;
  return coalesce(v_rows, '[]'::jsonb);
end;
$$;


--
-- Name: get_financial_audit_log(uuid, uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_financial_audit_log(p_lodge_id uuid, p_booking_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, lodge_id uuid, booking_id uuid, action text, actor_id uuid, amount_delta numeric, before_snapshot jsonb, after_snapshot jsonb, idempotency_key text, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.app_lodge_access(p_lodge_id) then raise exception 'Access denied' using errcode = '42501'; end if;
  return query
  select l.id, l.lodge_id, l.booking_id, l.action, l.actor_id, l.amount_delta, l.before_snapshot, l.after_snapshot, l.idempotency_key, l.created_at
  from public.financial_audit_log l
  where l.lodge_id = p_lodge_id and (p_booking_id is null or l.booking_id = p_booking_id)
  order by l.created_at desc
  limit least(coalesce(p_limit, 100), 500) offset coalesce(p_offset, 0);
end;
$$;


--
-- Name: get_financial_validation_alerts(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_financial_validation_alerts(p_lodge_id uuid, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, lodge_id uuid, alert_type text, issue_count integer, summary jsonb, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.lodge_id,
    a.alert_type,
    a.issue_count,
    a.summary,
    a.created_at
  from public.financial_validation_alerts a
  where a.lodge_id = p_lodge_id
  order by a.created_at desc, a.id desc
  limit greatest(coalesce(p_limit, 50), 1);
end;
$$;


--
-- Name: get_financial_validation_runs(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_financial_validation_runs(p_lodge_id uuid, p_limit integer DEFAULT 30) RETURNS TABLE(id uuid, lodge_id uuid, triggered_by uuid, triggered_by_name text, trigger_source text, summary jsonb, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    v.id,
    v.lodge_id,
    v.triggered_by,
    u.name as triggered_by_name,
    v.trigger_source,
    v.summary,
    v.created_at
  from public.financial_validation_runs v
  left join public.users u on u.id = v.triggered_by
  where v.lodge_id = p_lodge_id
  order by v.created_at desc
  limit greatest(coalesce(p_limit, 30), 1);
$$;


--
-- Name: get_inventory_spend_summary(uuid, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_inventory_spend_summary(p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_selector text DEFAULT 'all'::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_total numeric := 0;
  v_by_category jsonb := '{}'::jsonb;
  v_purchases jsonb := '[]'::jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with filtered as (
    select
      ip.id,
      ip.date,
      ip.date::timestamptz as purchased_at,
      ip.item_id,
      ip.quantity_purchased,
      ip.unit_cost,
      ip.total_cost,
      ip.notes,
      ii.name as item_name,
      ii.category,
      ii.outlet_id
    from public.inventory_purchases ip
    left join public.inventory_items ii
      on ii.id = ip.item_id
    where ip.lodge_id = p_lodge_id
      and ip.date >= p_start_date
      and ip.date <= p_end_date
      and (
        coalesce(p_outlet_selector, 'all') = 'all'
        or (p_outlet_selector = 'unassigned' and ii.outlet_id is null)
        or ii.outlet_id::text = p_outlet_selector
      )
  ),
  category_rows as (
    select
      coalesce(nullif(trim(category), ''), 'Uncategorised') as category,
      sum(total_cost) as total
    from filtered
    group by coalesce(nullif(trim(category), ''), 'Uncategorised')
  )
  select
    coalesce(sum(total_cost), 0),
    coalesce((select jsonb_object_agg(category, total) from category_rows), '{}'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'date', date,
      'purchased_at', purchased_at,
      'item_id', item_id,
      'quantity_purchased', quantity_purchased,
      'unit_cost', unit_cost,
      'total_cost', total_cost,
      'notes', notes,
      'inventory_items', jsonb_build_object(
        'name', item_name,
        'category', category,
        'outlet_id', outlet_id
      )
    ) order by date desc, purchased_at desc, id desc), '[]'::jsonb)
    into v_total, v_by_category, v_purchases
  from filtered;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'by_category', coalesce(v_by_category, '{}'::jsonb),
    'purchases', coalesce(v_purchases, '[]'::jsonb)
  );
end;
$$;


--
-- Name: get_invoice_delivery_history(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_invoice_delivery_history(p_lodge_id uuid, p_booking_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, lodge_id uuid, booking_id uuid, invoice_number text, delivery_type text, delivery_status text, recipient text, file_path text, render_version text, initiated_by uuid, initiated_by_name text, metadata jsonb, previous_hash text, entry_hash text, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    l.id,
    l.lodge_id,
    l.booking_id,
    l.invoice_number,
    l.delivery_type,
    l.delivery_status,
    l.recipient,
    l.file_path,
    l.render_version,
    l.initiated_by,
    u.name as initiated_by_name,
    l.metadata,
    l.previous_hash,
    l.entry_hash,
    l.created_at
  from public.invoice_delivery_log l
  left join public.users u on u.id = l.initiated_by
  where l.lodge_id = p_lodge_id
    and (p_booking_id is null or l.booking_id = p_booking_id)
  order by l.created_at desc, l.id desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;


--
-- Name: get_invoice_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_invoice_summary(p_lodge_id uuid) RETURNS TABLE(booking_id uuid, total_amount numeric, charges_total numeric, amount_paid numeric, balance_due numeric, payment_status text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  return query
  select
    b.id,
    b.total_amount,
    b.charges_total,
    b.amount_paid,
    (b.total_amount + b.charges_total - b.amount_paid),
    b.payment_status
  from public.bookings b
  where b.lodge_id = p_lodge_id;
end;
$$;


--
-- Name: get_invoice_summary(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_invoice_summary(p_lodge_id uuid, p_booking_id uuid DEFAULT NULL::uuid) RETURNS TABLE(invoice_id uuid, invoice_number text, booking_id uuid, lodge_id uuid, issued_at timestamp with time zone, due_date date, notes text, guest_name text, customer_email text, check_in date, check_out date, total_amount numeric, charges_total numeric, amount_paid numeric, balance_due numeric, payment_status text, booking_status text, payment_count bigint, last_payment_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
  select
    i.id, i.invoice_number, b.id, b.lodge_id, i.issued_at, i.due_date, i.notes,
    coalesce(c.name, b.guest_name, 'Guest'), coalesce(c.email, ''),
    b.check_in, b.check_out,
    coalesce(b.total_amount, 0), coalesce(b.charges_total, 0), coalesce(b.amount_paid, 0),
    greatest(0, coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0)),
    coalesce(b.payment_status, 'unpaid'), coalesce(b.status, 'confirmed'),
    coalesce(pay_agg.payment_count, 0), pay_agg.last_payment_at
  from public.invoices i
  join public.bookings b on b.id = i.booking_id and b.lodge_id = p_lodge_id
  left join public.customers c on c.id = b.customer_id
  left join lateral (
    select count(*) as payment_count, max(p.paid_at) as last_payment_at
    from public.payments p where p.booking_id = b.id and p.lodge_id = p_lodge_id
  ) pay_agg on true
  where i.lodge_id = p_lodge_id and (p_booking_id is null or b.id = p_booking_id)
  order by i.issued_at desc;
end;
$$;


--
-- Name: get_lodge_auth_context(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lodge_auth_context(p_lodge_id uuid) RETURNS TABLE(contract_version integer, lodge_id uuid, lodge_display_name text, deleted boolean, pwa_feature_enabled boolean, pwa_plan text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  select
    2 as contract_version,
    p_lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    coalesce(s.deleted, false) as deleted,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan
  from lateral (
    select settings.lodge_name, settings.company_name, settings.deleted
    from public.settings settings
    where settings.lodge_id = p_lodge_id
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s
  left join lateral (
    select public.get_lodge_entitlement(p_lodge_id) as entitlement
  ) ent on true;
end;
$$;


--
-- Name: get_lodge_entitlement(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lodge_entitlement(p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_settings public.settings%rowtype;
  v_license public.licenses%rowtype;
  v_overrides jsonb := '{}'::jsonb;
  v_trial_end timestamptz;
  v_days_left int;
  v_expired boolean;
  v_plan text;
  v_payment_status text;
  v_subscription_state text;
  v_access_allowed boolean;
  v_grace_days integer;
  v_lease_days integer;
  v_grace_ends_at timestamptz;
  v_offline_valid_until timestamptz;
begin
  select *
  into v_settings
  from public.settings s
  where s.lodge_id = p_lodge_id
    and coalesce(s.deleted, false) = false
  order by s.updated_at desc nulls last, s.created_at desc nulls last
  limit 1;

  select coalesce(jsonb_object_agg(lf.feature_name, lf.enabled), '{}'::jsonb)
  into v_overrides
  from public.lodge_features lf
  where lf.lodge_id = p_lodge_id
    and (lf.expires_at is null or lf.expires_at > now());

  select *
  into v_license
  from public.licenses l
  where l.lodge_id = p_lodge_id
    and coalesce(l.is_active, true) = true
  order by
    case public._subscription_state(l.payment_status, l.next_due_date, l.expires_at, l.is_active, l.grace_period_days)
      when 'active' then 0
      when 'grace_period' then 1
      when 'suspended' then 2
      when 'expired' then 3
      when 'cancelled' then 4
      else 5
    end,
    l.expires_at desc nulls last,
    l.issued_at desc nulls last
  limit 1;

  if found then
    v_plan := public._normalize_subscription_plan(v_license.subscription_plan);
    v_payment_status := lower(coalesce(v_license.payment_status, 'active'));
    v_grace_days := greatest(coalesce(v_license.grace_period_days, 7), 0);
    v_lease_days := greatest(least(coalesce(v_license.offline_lease_days, 7), 30), 1);
    v_subscription_state := public._subscription_state(v_payment_status, v_license.next_due_date, v_license.expires_at, v_license.is_active, v_grace_days);
    v_access_allowed := public._subscription_access_allowed(v_subscription_state);
    v_grace_ends_at := case when v_license.next_due_date is null then null else (v_license.next_due_date + v_grace_days)::timestamptz + interval '1 day' end;
    v_offline_valid_until := public._offline_valid_until(v_subscription_state, v_license.expires_at, v_license.next_due_date, v_grace_days, v_lease_days);

    update public.licenses
    set subscription_state = v_subscription_state,
        last_entitlement_sync_at = now()
    where id = v_license.id
      and (
        subscription_state is distinct from v_subscription_state
        or last_entitlement_sync_at is null
        or last_entitlement_sync_at < now() - interval '1 hour'
      );

    return jsonb_build_object(
      'lodge_id', p_lodge_id,
      'status', case when v_access_allowed then 'licensed' else 'expired' end,
      'daysLeft', null,
      'expired', not v_access_allowed,
      'plan', v_plan,
      'plan_version_code', coalesce(v_license.plan_version_code, '2026.04'),
      'payment_status', v_payment_status,
      'subscription_state', v_subscription_state,
      'monthly_fee', coalesce(v_license.monthly_fee, 0),
      'currency', v_license.currency,
      'next_due_date', v_license.next_due_date,
      'expires_at', v_license.expires_at,
      'grace_period_days', v_grace_days,
      'grace_period_ends_at', v_grace_ends_at,
      'offline_lease_days', v_lease_days,
      'offline_valid_until', v_offline_valid_until,
      'source_license_id', v_license.id,
      'lodge_name', coalesce(v_license.lodge_name, v_settings.lodge_name, v_settings.company_name),
      'effective_features', case when v_access_allowed then public._license_plan_features(v_plan, false, false) || coalesce(v_overrides, '{}'::jsonb) else public._license_plan_features(v_plan, false, true) end
    );
  end if;

  v_trial_end := coalesce(v_settings.trial_started_at, now()) + interval '30 days';
  if v_settings.trial_started_at is null then
    v_days_left := 30;
    v_expired := false;
  else
    v_days_left := greatest(0, ceil(extract(epoch from (v_trial_end - now())) / 86400.0))::int;
    v_expired := v_days_left <= 0;
  end if;

  return jsonb_build_object(
    'lodge_id', p_lodge_id,
    'status', case when v_expired then 'expired' else 'trial' end,
    'daysLeft', v_days_left,
    'expired', v_expired,
    'plan', case when v_expired then null else 'Trial' end,
    'plan_version_code', 'trial',
    'payment_status', case when v_expired then 'expired' else 'trial' end,
    'monthly_fee', 0,
    'currency', null,
    'next_due_date', null,
    'expires_at', case when v_expired then v_trial_end else null end,
    'grace_period_days', 0,
    'grace_period_ends_at', null,
    'offline_lease_days', 30,
    'offline_valid_until', least(v_trial_end, now() + interval '30 days'),
    'source_license_id', null,
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'effective_features', public._license_plan_features('Pro', true, v_expired)
  );
end;
$$;


--
-- Name: get_lodge_public_media(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lodge_public_media(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_settings public.settings%rowtype;
  v_features jsonb;
  v_enabled boolean;
begin
  if v_slug = '' then
    return jsonb_build_object('found', false, 'error', 'Slug is required');
  end if;

  select *
    into v_settings
    from public.settings s
   where lower(btrim(coalesce(s.slug, ''))) = v_slug
     and coalesce(s.deleted, false) = false
   limit 1;

  if not found then
    return jsonb_build_object('found', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_settings.lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('found', false, 'error', 'Online booking not available for this property');
  end if;

  return jsonb_build_object(
    'found', true,
    'lodge_id', v_settings.lodge_id,
    'logo', coalesce(v_settings.logo, ''),
    'hero_image', coalesce(v_settings.hero_image, '')
  );
end;
$$;


--
-- Name: get_lodge_public_profile(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lodge_public_profile(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_settings public.settings%rowtype;
  v_features jsonb;
  v_enabled boolean;
begin
  if v_slug = '' then
    return jsonb_build_object('found', false, 'error', 'Slug is required');
  end if;

  select *
  into v_settings
  from public.settings s
  where lower(btrim(coalesce(s.slug, ''))) = v_slug
    and coalesce(s.deleted, false) = false
  limit 1;

  if not found then
    return jsonb_build_object('found', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_settings.lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('found', false, 'error', 'Online booking not available for this property');
  end if;

  return jsonb_build_object(
    'found', true,
    'lodge_id', v_settings.lodge_id,
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'logo', v_settings.logo,
    'currency', coalesce(v_settings.currency, 'P'),
    'city', v_settings.city,
    'country', v_settings.country,
    'phone', v_settings.phone,
    'email', v_settings.email,
    'website', v_settings.website,
    'address', v_settings.address,
    'booking_tagline', coalesce(nullif(v_settings.booking_tagline, ''), 'Direct booking, straight with the property'),
    'booking_description', coalesce(v_settings.booking_description, ''),
    'hero_image', coalesce(v_settings.hero_image, ''),
    'whatsapp_number', coalesce(v_settings.whatsapp_number, ''),
    'booking_check_in_from', coalesce(v_settings.booking_check_in_from, ''),
    'booking_check_out_until', coalesce(v_settings.booking_check_out_until, ''),
    'booking_cancellation_policy', coalesce(v_settings.booking_cancellation_policy, ''),
    'booking_payment_terms', coalesce(v_settings.booking_payment_terms, ''),
    'booking_house_rules', coalesce(v_settings.booking_house_rules, ''),
    'booking_faq', coalesce(v_settings.booking_faq, '[]'::jsonb)
  );
end;
$$;


--
-- Name: get_lodge_public_profile_shell(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lodge_public_profile_shell(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_settings public.settings%rowtype;
  v_features jsonb;
  v_enabled boolean;
begin
  if v_slug = '' then
    return jsonb_build_object('found', false, 'error', 'Slug is required');
  end if;

  select *
    into v_settings
    from public.settings s
   where lower(btrim(coalesce(s.slug, ''))) = v_slug
     and coalesce(s.deleted, false) = false
   limit 1;

  if not found then
    return jsonb_build_object('found', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_settings.lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('found', false, 'error', 'Online booking not available for this property');
  end if;

  return jsonb_build_object(
    'found', true,
    'lodge_id', v_settings.lodge_id,
    'lodge_name', coalesce(v_settings.lodge_name, v_settings.company_name),
    'currency', coalesce(v_settings.currency, 'P'),
    'city', v_settings.city,
    'country', v_settings.country,
    'phone', v_settings.phone,
    'email', v_settings.email,
    'website', v_settings.website,
    'address', v_settings.address,
    'whatsapp_number', coalesce(v_settings.whatsapp_number, ''),
    'booking_tagline', coalesce(nullif(v_settings.booking_tagline, ''), 'Reserve your stay'),
    'booking_description', coalesce(v_settings.booking_description, ''),
    'booking_check_in_from', coalesce(v_settings.booking_check_in_from, ''),
    'booking_check_out_until', coalesce(v_settings.booking_check_out_until, ''),
    'booking_cancellation_policy', coalesce(v_settings.booking_cancellation_policy, ''),
    'booking_payment_terms', coalesce(v_settings.booking_payment_terms, ''),
    'booking_house_rules', coalesce(v_settings.booking_house_rules, ''),
    'booking_faq', coalesce(v_settings.booking_faq, '[]'::jsonb),
    'has_logo', coalesce(v_settings.logo, '') <> '',
    'has_hero_image', coalesce(v_settings.hero_image, '') <> ''
  );
end;
$$;


--
-- Name: get_lodge_support_tickets(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lodge_support_tickets(p_lodge_id uuid, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, lodge_id uuid, lodge_name text, title text, description text, category text, priority text, status text, admin_notes text, created_at timestamp with time zone, updated_at timestamp with time zone, resolved_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    s.id,
    s.lodge_id,
    s.lodge_name,
    s.title,
    s.description,
    s.category,
    s.priority,
    s.status,
    coalesce(s.admin_notes, '') as admin_notes,
    s.created_at,
    s.updated_at,
    s.resolved_at
  from public.support_tickets s
  where s.lodge_id = p_lodge_id
    and public.app_lodge_access(p_lodge_id)
  order by coalesce(s.updated_at, s.created_at) desc, s.id desc
  limit greatest(coalesce(p_limit, 50), 1);
$$;


--
-- Name: get_lodge_usage_plan(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_lodge_usage_plan(p_lodge_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_plan text;
begin
  select lower(coalesce(l.subscription_plan, ''))
    into v_plan
    from public.licenses l
   where l.lodge_id::text = p_lodge_id::text   -- works whether lodge_id is text OR uuid
     and l.is_active = true
   order by l.issued_at desc nulls last
   limit 1;

  if v_plan in ('starter', 'standard', 'pro') then
    return initcap(v_plan);
  end if;

  begin
    select lower(coalesce(s.pwa_plan, s.plan, ''))
      into v_plan
      from public.settings s
     where s.lodge_id = p_lodge_id
     limit 1;
  exception
    when undefined_column then
      v_plan := '';
  end;

  if v_plan in ('starter', 'standard', 'pro') then
    return initcap(v_plan);
  end if;

  return 'Starter';
end;
$$;


--
-- Name: get_manager_dashboard_snapshot(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_manager_dashboard_snapshot(p_lodge_id uuid, p_today date DEFAULT CURRENT_DATE) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_today date := coalesce(p_today, current_date);
  v_month_start date := date_trunc('month', coalesce(p_today, current_date)::timestamp)::date;
  v_month_end_exclusive date := (date_trunc('month', coalesce(p_today, current_date)::timestamp) + interval '1 month')::date;
  v_next_week date := coalesce(p_today, current_date) + 7;
  v_previous_start date := coalesce(p_today, current_date) - 6;
  v_room_count_total integer := 0;
  v_occupied integer := 0;
  v_open_maintenance integer := 0;
  v_urgent_maintenance integer := 0;
  v_low_stock_count integer := 0;
  v_unpaid_count integer := 0;
  v_outstanding_total numeric := 0;
  v_month_expenses numeric := 0;
  v_month_gross_collected numeric := 0;
  v_month_refunds numeric := 0;
  v_month_revenue numeric := 0;
  v_quotations_open_count integer := 0;
  v_day_use_revenue numeric := 0;
  v_low_stock jsonb := '[]'::jsonb;
  v_upcoming_arrivals jsonb := '[]'::jsonb;
  v_conference_upcoming jsonb := '[]'::jsonb;
  v_pool_upcoming jsonb := '[]'::jsonb;
  v_revenue_trend jsonb := '[]'::jsonb;
  v_occupancy_trend jsonb := '[]'::jsonb;
  v_top_balances jsonb := '[]'::jsonb;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select count(*) into v_room_count_total
  from public.rooms
  where lodge_id = p_lodge_id;

  select count(*) into v_occupied
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in';

  select
    count(*) filter (where status = 'open'),
    count(*) filter (where status = 'open' and priority = 'urgent')
    into v_open_maintenance, v_urgent_maintenance
  from public.maintenance_tickets
  where lodge_id = p_lodge_id;

  select count(*)
    into v_low_stock_count
  from public.inventory_items
  where lodge_id = p_lodge_id
    and reorder_level is not null
    and current_stock <= reorder_level;

  select
    count(*) filter (where coalesce(payment_status, 'unpaid') in ('unpaid', 'partial')),
    coalesce(sum(greatest(coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0), 0)), 0)
    into v_unpaid_count, v_outstanding_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status in ('confirmed', 'checked_in');

  select coalesce(sum(amount), 0)
    into v_month_expenses
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select
    coalesce(sum(case when type = 'refund' then amount else 0 end), 0),
    coalesce(sum(case when type <> 'refund' then amount else 0 end), 0)
    into v_month_refunds, v_month_gross_collected
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz;

  select
    coalesce(sum(total_amount + coalesce(charges_total, 0)), 0),
    count(*) filter (where status not in ('accepted', 'expired', 'cancelled'))
    into v_month_revenue, v_quotations_open_count
  from public.quotations
  where lodge_id = p_lodge_id
    and created_at >= v_month_start::timestamptz
    and created_at < v_month_end_exclusive::timestamptz;

  select coalesce(sum(total_amount), 0)
    into v_day_use_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'name', i.name,
      'category', i.category,
      'current_stock', i.current_stock,
      'reorder_level', i.reorder_level
    ) order by i.current_stock asc, i.name asc), '[]'::jsonb)
    into v_low_stock
  from public.inventory_items i
  where i.lodge_id = p_lodge_id
    and i.reorder_level is not null
    and i.current_stock <= i.reorder_level;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.check_in asc, t.room_number asc nulls last), '[]'::jsonb)
    into v_upcoming_arrivals
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as guest_name,
      coalesce(c.name, 'Guest') as customer_name,
      b.check_in,
      b.check_out,
      b.room_number,
      b.source,
      b.status,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      case
        when b.source = 'online' and b.status = 'pending' then 'awaiting_front_desk_confirmation'
        else b.status
      end as manager_arrival_status,
      case
        when b.source = 'online' and b.status = 'pending' then 'Online request waiting for front desk confirmation.'
        when b.status = 'confirmed' then 'Confirmed and ready for front desk preparation.'
        when b.status = 'checked_in' then 'Guest is already checked in.'
        when b.status = 'checked_out' then 'Guest has already checked out.'
        else 'Active booking.'
      end as manager_arrival_note
    from public.bookings b
    left join public.customers c on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.check_in >= v_today
      and b.check_in <= v_next_week
      and b.status in ('pending', 'confirmed', 'checked_in', 'checked_out')
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.booking_date asc, t.created_at asc), '[]'::jsonb)
    into v_conference_upcoming
  from (
    select
      cb.id,
      cb.client_name as customer_name,
      cb.booking_date,
      cb.start_time,
      cb.end_time,
      cb.room_name,
      cb.attendees,
      cb.total_amount,
      cb.deposit_paid,
      cb.payment_status,
      cb.payment_method,
      cb.created_at,
      'conference' as booking_type
    from public.conference_bookings cb
    where cb.lodge_id = p_lodge_id
      and cb.booking_date >= v_today
      and cb.booking_date <= v_next_week
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.date asc, t.created_at asc), '[]'::jsonb)
    into v_pool_upcoming
  from (
    select
      pdu.id,
      pdu.guest_name as customer_name,
      pdu.date,
      pdu.adults,
      pdu.children,
      pdu.total as total_amount,
      pdu.payment_method,
      pdu.created_at,
      'pool' as booking_type
    from public.pool_day_use pdu
    where pdu.lodge_id = p_lodge_id
      and pdu.date >= v_today
      and pdu.date <= v_next_week
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('date', d.day_key, 'total', d.total) order by d.day_key asc), '[]'::jsonb)
    into v_revenue_trend
  from (
    select
      to_char(p.paid_at::date, 'YYYY-MM-DD') as day_key,
      sum(case when p.type = 'refund' then -abs(coalesce(p.amount, 0)) else coalesce(p.amount, 0) end) as total
    from public.payments p
    where p.lodge_id = p_lodge_id
      and p.paid_at >= v_previous_start::timestamptz
      and p.paid_at < (v_today + 1)::timestamptz
    group by p.paid_at::date
  ) d;

  select coalesce(jsonb_agg(jsonb_build_object('date', o.day_key, 'occupied', o.occupied) order by o.day_key asc), '[]'::jsonb)
    into v_occupancy_trend
  from (
    select
      to_char(day_value::date, 'YYYY-MM-DD') as day_key,
      count(*) filter (
        where b.check_in <= day_value::date
          and b.check_out > day_value::date
          and b.status in ('confirmed', 'checked_in')
      ) as occupied
    from generate_series(v_previous_start::timestamp, v_today::timestamp, interval '1 day') day_value
    left join public.bookings b
      on b.lodge_id = p_lodge_id
    group by day_value::date
  ) o;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.balance_due desc, t.check_in asc), '[]'::jsonb)
    into v_top_balances
  from (
    select
      b.id,
      coalesce(c.name, 'Guest') as customer_name,
      b.check_in,
      b.check_out,
      greatest(coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0), 0) as balance_due
    from public.bookings b
    left join public.customers c on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.status in ('confirmed', 'checked_in')
      and greatest(coalesce(b.total_amount, 0) + coalesce(b.charges_total, 0) - coalesce(b.amount_paid, 0), 0) > 0
    order by balance_due desc, check_in asc
    limit 10
  ) t;

  return jsonb_build_object(
    'totalRooms', coalesce(v_room_count_total, 0),
    'occupied', coalesce(v_occupied, 0),
    'occupancyPercent', case when v_room_count_total > 0 then round((v_occupied::numeric / v_room_count_total::numeric) * 100) else 0 end,
    'openMaintenance', coalesce(v_open_maintenance, 0),
    'urgentMaintenance', coalesce(v_urgent_maintenance, 0),
    'lowStockCount', coalesce(v_low_stock_count, 0),
    'unpaidCount', coalesce(v_unpaid_count, 0),
    'outstandingTotal', coalesce(v_outstanding_total, 0),
    'monthExpenses', coalesce(v_month_expenses, 0),
    'monthGrossCollected', coalesce(v_month_gross_collected, 0),
    'monthRefunds', coalesce(v_month_refunds, 0),
    'monthRevenue', coalesce(v_month_revenue, 0) + coalesce(v_day_use_revenue, 0),
    'openQuotations', coalesce(v_quotations_open_count, 0),
    'lowStock', coalesce(v_low_stock, '[]'::jsonb),
    'upcomingArrivals', coalesce(v_upcoming_arrivals, '[]'::jsonb),
    'conferenceUpcoming', coalesce(v_conference_upcoming, '[]'::jsonb),
    'poolUpcoming', coalesce(v_pool_upcoming, '[]'::jsonb),
    'revenueTrend', coalesce(v_revenue_trend, '[]'::jsonb),
    'occupancyTrend', coalesce(v_occupancy_trend, '[]'::jsonb),
    'topBalances', coalesce(v_top_balances, '[]'::jsonb)
  );
end;
$$;


--
-- Name: get_manager_pwa_profile(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_manager_pwa_profile(p_id uuid, p_lodge_id uuid) RETURNS TABLE(contract_version integer, id uuid, name text, email text, role text, lodge_id uuid, lodge_display_name text, pwa_enabled boolean, pwa_password_set_at timestamp with time zone, pwa_disabled_reason text, pwa_feature_enabled boolean, pwa_plan text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.app_current_user_id() is distinct from p_id
     or public.app_current_lodge_id() is distinct from p_lodge_id then
    return;
  end if;

  return query
  select
    2 as contract_version,
    u.id,
    u.name,
    lower(btrim(u.email)) as email,
    lower(btrim(u.role)) as role,
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    coalesce(u.pwa_enabled, false) as pwa_enabled,
    u.pwa_password_set_at,
    u.pwa_disabled_reason,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan
  from public.users u
  left join lateral (
    select settings.lodge_name, settings.company_name
    from public.settings settings
    where settings.lodge_id = u.lodge_id
      and coalesce(settings.deleted, false) = false
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s on true
  left join lateral (
    select public.get_lodge_entitlement(u.lodge_id) as entitlement
  ) ent on true
  where u.id = p_id
    and u.lodge_id = p_lodge_id
    and public._is_pwa_role_eligible(u.role)
  limit 1;
end;
$$;


--
-- Name: get_next_invoice_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_invoice_number(p_lodge_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_year int := extract(year from now())::int;
  v_next int;
  v_invoice_number text;
begin
  loop
    insert into public.invoice_sequences (lodge_id, year, last_number)
    values (p_lodge_id, v_year, 1)
    on conflict (lodge_id, year)
    do update
      set last_number = public.invoice_sequences.last_number + 1
    returning last_number into v_next;

    v_invoice_number := 'INV-' || v_year || '-' || lpad(v_next::text, 4, '0');

    exit when not exists (
      select 1
        from public.invoices i
       where i.lodge_id::uuid = p_lodge_id 
         and i.invoice_number = v_invoice_number 
      union all 
      select 1 
        from public.bookings b 
       where b.lodge_id::uuid = p_lodge_id 
         and b.invoice_number = v_invoice_number 
    );
  end loop;

  return v_invoice_number;
end;
$$;


--
-- Name: get_next_receipt_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_receipt_number(p_lodge_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_year   integer := extract(year from now())::integer;
  v_next   integer;
begin
  insert into public.pos_receipt_sequences (lodge_id, year, last_number)
  values (p_lodge_id, v_year, 1)
  on conflict (lodge_id, year)
  do update set last_number = pos_receipt_sequences.last_number + 1
  returning last_number into v_next;

  return 'REC-' || v_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;


--
-- Name: get_night_audit_summary(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_night_audit_summary(p_lodge_id uuid, p_audit_date date DEFAULT CURRENT_DATE) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_audit_date date := coalesce(p_audit_date, current_date);
  v_day_start timestamptz := coalesce(p_audit_date, current_date)::timestamptz;
  v_day_end timestamptz := (coalesce(p_audit_date, current_date) + 1)::timestamptz;
  v_check_ins jsonb := '[]'::jsonb;
  v_check_outs jsonb := '[]'::jsonb;
  v_new_bookings jsonb := '[]'::jsonb;
  v_outstanding jsonb := '[]'::jsonb;
  v_pos_orders jsonb := '[]'::jsonb;
  v_pos_revenue numeric := 0;
  v_gross_collected numeric := 0;
  v_refunds_issued numeric := 0;
  v_expenses_total numeric := 0;
  v_outstanding_total numeric := 0;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.room_number asc nulls last), '[]'::jsonb)
    into v_check_ins
  from (
    select
      b.id,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      b.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.check_in = v_audit_date
      and b.status <> 'cancelled'
    order by b.room_number asc nulls last, b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.room_number asc nulls last), '[]'::jsonb)
    into v_check_outs
  from (
    select
      b.id,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      b.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.check_out = v_audit_date
      and b.status <> 'cancelled'
    order by b.room_number asc nulls last, b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
    into v_new_bookings
  from (
    select
      b.id,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      b.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status,
      b.created_at
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.created_at >= v_day_start
      and b.created_at < v_day_end
    order by b.created_at desc
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.check_in asc), '[]'::jsonb)
    into v_outstanding
  from (
    select
      b.id,
      coalesce(c.name, b.guest_name, 'Guest') as customer_name,
      coalesce(b.guest_name, c.name, 'Guest') as guest_name,
      b.room_number,
      b.check_in,
      b.check_out,
      coalesce(b.total_amount, 0) as total_amount,
      coalesce(b.charges_total, 0) as charges_total,
      coalesce(b.amount_paid, 0) as amount_paid,
      coalesce(b.payment_status, 'unpaid') as payment_status,
      b.status
    from public.bookings b
    left join public.customers c
      on c.id = b.customer_id
    where b.lodge_id = p_lodge_id
      and b.status in ('confirmed', 'checked_in')
      and coalesce(b.payment_status, 'unpaid') <> 'paid'
    order by b.check_in asc, b.room_number asc nulls last
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb),
         coalesce(sum(t.total), 0)
    into v_pos_orders, v_pos_revenue
  from (
    select
      po.id,
      po.created_at,
      po.total,
      po.payment_method,
      po.booking_id,
      po.outlet_id
    from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and po.status = 'completed'
      and po.created_at >= v_day_start
      and po.created_at < v_day_end
    order by po.created_at desc
  ) t;

  select coalesce(sum(amount), 0)
    into v_gross_collected
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_day_start
    and paid_at < v_day_end
    and amount > 0;

  select coalesce(sum(abs(amount)), 0)
    into v_refunds_issued
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_day_start
    and paid_at < v_day_end
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  select coalesce(sum(amount), 0)
    into v_expenses_total
  from public.expenses
  where lodge_id = p_lodge_id
    and date = v_audit_date;

  select coalesce(sum(greatest(0, coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0))), 0)
    into v_outstanding_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status in ('confirmed', 'checked_in')
    and coalesce(payment_status, 'unpaid') <> 'paid';

  return jsonb_build_object(
    'date', to_char(v_audit_date, 'YYYY-MM-DD'),
    'check_ins', v_check_ins,
    'check_outs', v_check_outs,
    'new_bookings', v_new_bookings,
    'outstanding', v_outstanding,
    'pos_orders', v_pos_orders,
    'pos_revenue', coalesce(v_pos_revenue, 0),
    'gross_collected', coalesce(v_gross_collected, 0),
    'refunds_issued', coalesce(v_refunds_issued, 0),
    'net_collected', coalesce(v_gross_collected, 0) - coalesce(v_refunds_issued, 0),
    'expenses_total', coalesce(v_expenses_total, 0),
    'outstanding_total', coalesce(v_outstanding_total, 0)
  );
end;
$$;


--
-- Name: get_outlet_profit_loss_summary(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_outlet_profit_loss_summary(p_lodge_id uuid, p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking_summary jsonb := '{}'::jsonb;
  v_booking_revenue numeric := 0;
  v_folio_pos_revenue numeric := 0;
  v_conference_revenue numeric := 0;
  v_pool_revenue numeric := 0;
  v_supply_cost numeric := 0;
  v_outlets jsonb := '[]'::jsonb;
  v_combined jsonb := '{}'::jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  v_booking_summary := public.get_revenue_report(p_lodge_id, p_start_date, p_end_date);
  v_booking_revenue := coalesce((v_booking_summary ->> 'total_revenue')::numeric, 0);

  select coalesce(sum(po.total), 0)
    into v_folio_pos_revenue
  from public.pos_orders po
  where po.lodge_id = p_lodge_id
    and po.status = 'completed'
    and coalesce(po.payment_method, '') = 'folio'
    and po.created_at >= p_start_date::timestamptz
    and po.created_at < (p_end_date + 1)::timestamptz;

  select coalesce(sum(cb.total_amount), 0)
    into v_conference_revenue
  from public.conference_bookings cb
  where cb.lodge_id = p_lodge_id
    and cb.booking_date >= p_start_date
    and cb.booking_date <= p_end_date
    and lower(coalesce(cb.payment_status, '')) <> 'cancelled';

  select coalesce(sum(pdu.total), 0)
    into v_pool_revenue
  from public.pool_day_use pdu
  where pdu.lodge_id = p_lodge_id
    and pdu.date >= p_start_date
    and pdu.date <= p_end_date;

  select coalesce(sum(sp.total_cost), 0)
    into v_supply_cost
  from public.supply_purchases sp
  where sp.lodge_id = p_lodge_id
    and sp.date >= p_start_date
    and sp.date <= p_end_date;

  with bucket_seed as (
    select *
    from (
      values
        ('kitchen'::text, 'Kitchen'::text),
        ('bar'::text, 'Bar'::text),
        ('front_desk'::text, 'Front Desk'::text),
        ('unassigned'::text, 'Unassigned'::text)
    ) as s(bucket_key, bucket_name)
  ),
  outlet_map as (
    select
      o.id,
      case
        when lower(coalesce(o.type, '')) = 'food' then 'kitchen'
        when lower(coalesce(o.type, '')) = 'beverage' then 'bar'
        when lower(coalesce(o.type, '')) in ('front_desk', 'accommodation') then 'front_desk'
        else 'unassigned'
      end as bucket_key
    from public.outlets o
    where o.lodge_id = p_lodge_id
  ),
  pos_by_bucket as (
    select
      coalesce(om.bucket_key, 'unassigned') as bucket_key,
      coalesce(sum(po.total), 0) as pos_revenue
    from public.pos_orders po
    left join outlet_map om
      on om.id = po.outlet_id
    where po.lodge_id = p_lodge_id
      and po.status = 'completed'
      and po.created_at >= p_start_date::timestamptz
      and po.created_at < (p_end_date + 1)::timestamptz
    group by coalesce(om.bucket_key, 'unassigned')
  ),
  inventory_by_bucket as (
    select
      coalesce(om.bucket_key, 'unassigned') as bucket_key,
      coalesce(sum(ip.total_cost), 0) as inventory_cost
    from public.inventory_purchases ip
    left join public.inventory_items ii
      on ii.id = ip.item_id
    left join outlet_map om
      on om.id = ii.outlet_id
    where ip.lodge_id = p_lodge_id
      and ip.date >= p_start_date
      and ip.date <= p_end_date
    group by coalesce(om.bucket_key, 'unassigned')
  ),
  expenses_by_bucket as (
    select
      coalesce(om.bucket_key, 'unassigned') as bucket_key,
      coalesce(sum(e.amount), 0) as expenses
    from public.expenses e
    left join outlet_map om
      on om.id = e.outlet_id
    where e.lodge_id = p_lodge_id
      and e.date >= p_start_date
      and e.date <= p_end_date
    group by coalesce(om.bucket_key, 'unassigned')
  ),
  rows as (
    select
      s.bucket_key as key,
      s.bucket_name as name,
      coalesce(pb.pos_revenue, 0) as pos_revenue,
      case
        when s.bucket_key = 'front_desk'
          then greatest(0, v_booking_revenue - v_folio_pos_revenue) + v_conference_revenue + v_pool_revenue
        else 0
      end as booking_revenue,
      coalesce(ib.inventory_cost, 0) as inventory_cost,
      case when s.bucket_key = 'front_desk' then v_supply_cost else 0 end as supply_cost,
      coalesce(eb.expenses, 0) as expenses
    from bucket_seed s
    left join pos_by_bucket pb
      on pb.bucket_key = s.bucket_key
    left join inventory_by_bucket ib
      on ib.bucket_key = s.bucket_key
    left join expenses_by_bucket eb
      on eb.bucket_key = s.bucket_key
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'key', key,
      'name', name,
      'posRevenue', pos_revenue,
      'bookingRevenue', booking_revenue,
      'revenue', pos_revenue + booking_revenue,
      'inventoryCost', inventory_cost,
      'supplyCost', supply_cost,
      'expenses', expenses,
      'profit', (pos_revenue + booking_revenue) - inventory_cost - supply_cost - expenses
    ) order by case key when 'kitchen' then 1 when 'bar' then 2 when 'front_desk' then 3 else 4 end), '[]'::jsonb),
    jsonb_build_object(
      'posRevenue', coalesce(sum(pos_revenue), 0),
      'bookingRevenue', coalesce(sum(booking_revenue), 0),
      'revenue', coalesce(sum(pos_revenue + booking_revenue), 0),
      'inventoryCost', coalesce(sum(inventory_cost), 0),
      'supplyCost', coalesce(sum(supply_cost), 0),
      'expenses', coalesce(sum(expenses), 0),
      'profit', coalesce(sum((pos_revenue + booking_revenue) - inventory_cost - supply_cost - expenses), 0)
    )
    into v_outlets, v_combined
  from rows;

  return jsonb_build_object(
    'outlets', coalesce(v_outlets, '[]'::jsonb),
    'combined', coalesce(v_combined, '{}'::jsonb)
  );
end;
$$;


--
-- Name: get_pos_sales_summary(uuid, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pos_sales_summary(p_lodge_id uuid, p_start_date date, p_end_date date, p_outlet_selector text DEFAULT 'all'::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_total_revenue numeric := 0;
  v_folio_revenue numeric := 0;
  v_total_orders integer := 0;
  v_avg_order numeric := 0;
  v_by_payment jsonb := '{}'::jsonb;
  v_top_items jsonb := '[]'::jsonb;
  v_daily jsonb := '[]'::jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with filtered_orders as (
    select po.*
    from public.pos_orders po
    where po.lodge_id = p_lodge_id
      and po.status = 'completed'
      and po.created_at >= p_start_date::timestamptz
      and po.created_at < (p_end_date + 1)::timestamptz
      and (
        coalesce(p_outlet_selector, 'all') = 'all'
        or (p_outlet_selector = 'unassigned' and po.outlet_id is null)
        or po.outlet_id::text = p_outlet_selector
      )
  ),
  payment_rows as (
    select
      coalesce(nullif(trim(payment_method), ''), 'cash') as method,
      sum(total) as total
    from filtered_orders
    group by coalesce(nullif(trim(payment_method), ''), 'cash')
  ),
  daily_rows as (
    select
      to_char(created_at::date, 'YYYY-MM-DD') as date,
      sum(total) as total
    from filtered_orders
    group by created_at::date
    order by created_at::date
  ),
  item_rows as (
    select
      coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item') as item_name,
      sum(coalesce(poi.quantity, 0) * coalesce(pmi.template_pack_size, pmi.depletion_qty, 1, 1)) as qty,
      sum(coalesce(poi.subtotal, 0)) as revenue
    from filtered_orders fo
    join public.pos_order_items poi
      on poi.order_id = fo.id
    left join public.pos_menu_items pmi
      on pmi.id = poi.menu_item_id
    left join public.inventory_items ii
      on ii.id = pmi.inventory_item_id
    group by coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item')
    order by sum(coalesce(poi.subtotal, 0)) desc, coalesce(ii.name, pmi.name, poi.item_name, 'Unknown item') asc
    limit 15
  )
  select
    coalesce(sum(total), 0),
    coalesce(sum(case when coalesce(payment_method, '') = 'folio' then total else 0 end), 0),
    count(*),
    coalesce((select jsonb_object_agg(method, total) from payment_rows), '{}'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('name', item_name, 'qty', qty, 'revenue', revenue) order by revenue desc, item_name asc) from item_rows), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('date', date, 'total', total) order by date asc) from daily_rows), '[]'::jsonb)
    into v_total_revenue,
         v_folio_revenue,
         v_total_orders,
         v_by_payment,
         v_top_items,
         v_daily
  from filtered_orders;

  if v_total_orders > 0 then
    v_avg_order := v_total_revenue / v_total_orders;
  end if;

  return jsonb_build_object(
    'total_revenue', coalesce(v_total_revenue, 0),
    'folio_revenue', coalesce(v_folio_revenue, 0),
    'direct_revenue', coalesce(v_total_revenue, 0) - coalesce(v_folio_revenue, 0),
    'total_orders', coalesce(v_total_orders, 0),
    'avg_order', coalesce(v_avg_order, 0),
    'by_payment', coalesce(v_by_payment, '{}'::jsonb),
    'top_items', coalesce(v_top_items, '[]'::jsonb),
    'daily', coalesce(v_daily, '[]'::jsonb)
  );
end;
$$;


--
-- Name: get_profit_loss_summary(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_profit_loss_summary(p_lodge_id uuid, p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_revenue jsonb := '{}'::jsonb;
  v_booking_revenue numeric := 0;
  v_pos_revenue numeric := 0;
  v_conference_revenue numeric := 0;
  v_pool_revenue numeric := 0;
  v_total_revenue numeric := 0;
  v_total_expenses numeric := 0;
  v_inv_costs numeric := 0;
  v_sup_costs numeric := 0;
  v_maintenance_costs numeric := 0;
  v_total_costs numeric := 0;
  v_gross_profit numeric := 0;
  v_exp_by_category jsonb := '{}'::jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  v_revenue := public.get_revenue_report(p_lodge_id, p_start_date, p_end_date);
  v_booking_revenue := coalesce((v_revenue ->> 'total_revenue')::numeric, 0);

  select coalesce(sum(total), 0)
    into v_pos_revenue
  from public.pos_orders
  where lodge_id = p_lodge_id
    and status = 'completed'
    and coalesce(payment_method, '') <> 'folio'
    and created_at >= p_start_date::timestamptz
    and created_at < (p_end_date + 1)::timestamptz;

  select coalesce(sum(total_amount), 0)
    into v_conference_revenue
  from public.conference_bookings
  where lodge_id = p_lodge_id
    and booking_date >= p_start_date
    and booking_date <= p_end_date
    and coalesce(payment_status, '') <> 'cancelled';

  select coalesce(sum(total), 0)
    into v_pool_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= p_start_date
    and date <= p_end_date;

  with exp as (
    select
      coalesce(nullif(trim(category), ''), 'Uncategorised') as category,
      sum(amount) as total
    from public.expenses
    where lodge_id = p_lodge_id
      and date >= p_start_date
      and date <= p_end_date
    group by coalesce(nullif(trim(category), ''), 'Uncategorised')
  )
  select
    coalesce(sum(total), 0),
    coalesce(jsonb_object_agg(category, total), '{}'::jsonb)
    into v_total_expenses, v_exp_by_category
  from exp;

  select coalesce(sum(total_cost), 0)
    into v_inv_costs
  from public.inventory_purchases
  where lodge_id = p_lodge_id
    and date >= p_start_date
    and date <= p_end_date;

  select coalesce(sum(total_cost), 0)
    into v_sup_costs
  from public.supply_purchases
  where lodge_id = p_lodge_id
    and date >= p_start_date
    and date <= p_end_date;

  select coalesce(sum(total_cost), 0)
    into v_maintenance_costs
  from public.maintenance_tickets
  where lodge_id = p_lodge_id
    and reported_date >= p_start_date
    and reported_date <= p_end_date;

  v_total_revenue := coalesce(v_booking_revenue, 0) + coalesce(v_pos_revenue, 0) + coalesce(v_conference_revenue, 0) + coalesce(v_pool_revenue, 0);
  v_total_costs := coalesce(v_inv_costs, 0) + coalesce(v_sup_costs, 0) + coalesce(v_maintenance_costs, 0);
  v_gross_profit := v_total_revenue - coalesce(v_total_expenses, 0) - v_total_costs;

  return jsonb_build_object(
    'bookingRevenue', coalesce(v_booking_revenue, 0),
    'posRevenue', coalesce(v_pos_revenue, 0),
    'conferenceRevenue', coalesce(v_conference_revenue, 0),
    'poolRevenue', coalesce(v_pool_revenue, 0),
    'totalRevenue', coalesce(v_total_revenue, 0),
    'totalExpenses', coalesce(v_total_expenses, 0),
    'expByCategory', coalesce(v_exp_by_category, '{}'::jsonb),
    'invCosts', coalesce(v_inv_costs, 0),
    'supCosts', coalesce(v_sup_costs, 0),
    'maintenanceCosts', coalesce(v_maintenance_costs, 0),
    'totalCosts', coalesce(v_total_costs, 0),
    'grossProfit', coalesce(v_gross_profit, 0),
    'vatAmount', coalesce((v_revenue ->> 'vat_amount')::numeric, 0),
    'vatEnabled', coalesce((v_revenue ->> 'vat_enabled')::boolean, false),
    'vatRate', (v_revenue ->> 'vat_rate')::numeric,
    'vatMixed', coalesce((v_revenue ->> 'vat_mixed')::boolean, false),
    'netRevenue', coalesce((v_revenue ->> 'net_revenue')::numeric, 0)
  );
end;
$$;


--
-- Name: get_public_room_media(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_room_media(p_slug text, p_room_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_lodge_id uuid;
  v_features jsonb;
  v_enabled boolean;
  v_photos text[];
begin
  if v_slug = '' then
    return jsonb_build_object('success', false, 'error', 'Slug is required');
  end if;

  if p_room_id is null then
    return jsonb_build_object('success', false, 'error', 'Room is required');
  end if;

  select lodge_id
    into v_lodge_id
    from public.settings
   where lower(btrim(coalesce(slug, ''))) = v_slug
     and coalesce(deleted, false) = false
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Lodge not found');
  end if;

  v_features := public.get_lodge_entitlement(v_lodge_id);
  v_enabled := coalesce((v_features->'effective_features'->>'online_booking')::boolean, false);

  if not v_enabled then
    return jsonb_build_object('success', false, 'error', 'Online booking not available');
  end if;

  select coalesce(
           r.photos,
           case
             when r.photo is not null and r.photo <> '' then array[r.photo]
             else '{}'::text[]
           end
         )
    into v_photos
    from public.rooms r
   where r.id = p_room_id
     and r.lodge_id = v_lodge_id
     and r.status not in ('maintenance')
   limit 1;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object(
    'success', true,
    'room_id', p_room_id,
    'photos', coalesce(v_photos, '{}'::text[])
  );
end;
$$;


--
-- Name: get_refund_approval_log(uuid, uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_refund_approval_log(p_lodge_id uuid, p_booking_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50) RETURNS TABLE(id uuid, lodge_id uuid, booking_id uuid, invoice_number text, approved_by uuid, approved_by_name text, requested_by uuid, requested_by_name text, refund_amount numeric, retained_amount numeric, retained_percent numeric, method text, notes text, proof_reference text, approval_note text, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    r.id,
    r.lodge_id,
    r.booking_id,
    b.invoice_number,
    r.approved_by,
    approver.name as approved_by_name,
    r.requested_by,
    requester.name as requested_by_name,
    r.refund_amount,
    r.retained_amount,
    r.retained_percent,
    r.method,
    r.notes,
    r.proof_reference,
    r.approval_note,
    r.created_at
  from public.refund_approval_log r
  left join public.bookings b on b.id = r.booking_id
  left join public.users approver on approver.id = r.approved_by
  left join public.users requester on requester.id = r.requested_by
  where r.lodge_id = p_lodge_id
    and (p_booking_id is null or r.booking_id = p_booking_id)
  order by r.created_at desc
  limit greatest(coalesce(p_limit, 50), 1);
$$;


--
-- Name: get_reports_snapshot(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_reports_snapshot(p_lodge_id uuid, p_today date DEFAULT CURRENT_DATE) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_today date := coalesce(p_today, current_date);
  v_week_start date := date_trunc('week', coalesce(p_today, current_date)::timestamp)::date;
  v_month_start date := date_trunc('month', coalesce(p_today, current_date)::timestamp)::date;
  v_month_end date := ((date_trunc('month', coalesce(p_today, current_date)::timestamp) + interval '1 month')::date - 1);
  v_month_end_exclusive date := (date_trunc('month', coalesce(p_today, current_date)::timestamp) + interval '1 month')::date;
  v_last_month_start date := (date_trunc('month', coalesce(p_today, current_date)::timestamp) - interval '1 month')::date;
  v_last_month_end date := (date_trunc('month', coalesce(p_today, current_date)::timestamp)::date - 1);
  v_total_rooms integer := 0;
  v_current_occ integer := 0;
  v_unpaid_count integer := 0;
  v_unpaid_total numeric := 0;
  v_month_expenses numeric := 0;
  v_pos_revenue numeric := 0;
  v_conference_revenue numeric := 0;
  v_pool_revenue numeric := 0;
  v_today_rev numeric := 0;
  v_week_rev numeric := 0;
  v_month_rev numeric := 0;
  v_last_month_rev numeric := 0;
  v_month_refunds numeric := 0;
  v_last_month_refunds numeric := 0;
  v_month_occ integer := 0;
  v_last_month_occ integer := 0;
  v_month_room_nights numeric := 0;
  v_last_month_room_nights numeric := 0;
begin
  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  select count(*) into v_total_rooms
  from public.rooms
  where lodge_id = p_lodge_id;

  select count(*) into v_current_occ
  from public.bookings
  where lodge_id = p_lodge_id
    and status = 'checked_in';

  select
    count(*),
    coalesce(sum(greatest(0, coalesce(total_amount, 0) + coalesce(charges_total, 0) - coalesce(amount_paid, 0))), 0)
    into v_unpaid_count, v_unpaid_total
  from public.bookings
  where lodge_id = p_lodge_id
    and status <> 'cancelled'
    and coalesce(payment_status, 'unpaid') in ('unpaid', 'partial');

  select coalesce(sum(amount), 0) into v_today_rev
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_today::timestamptz
    and paid_at < (v_today + 1)::timestamptz;

  select coalesce(sum(amount), 0) into v_week_rev
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_week_start::timestamptz
    and paid_at < (v_today + 1)::timestamptz;

  select coalesce(sum(amount), 0) into v_month_rev
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz;

  select coalesce(sum(amount), 0) into v_last_month_rev
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_last_month_start::timestamptz
    and paid_at < v_month_start::timestamptz;

  select coalesce(sum(abs(amount)), 0) into v_month_refunds
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_month_start::timestamptz
    and paid_at < v_month_end_exclusive::timestamptz
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  select coalesce(sum(abs(amount)), 0) into v_last_month_refunds
  from public.payments
  where lodge_id = p_lodge_id
    and paid_at >= v_last_month_start::timestamptz
    and paid_at < v_month_start::timestamptz
    and (amount < 0 or lower(coalesce(type, '')) = 'refund');

  select coalesce(sum(amount), 0) into v_month_expenses
  from public.expenses
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select coalesce(sum(total), 0) into v_pos_revenue
  from public.pos_orders
  where lodge_id = p_lodge_id
    and status <> 'voided'
    and created_at >= v_month_start::timestamptz
    and created_at < v_month_end_exclusive::timestamptz;

  select coalesce(sum(total_amount), 0) into v_conference_revenue
  from public.conference_bookings
  where lodge_id = p_lodge_id
    and booking_date >= v_month_start
    and booking_date < v_month_end_exclusive
    and coalesce(payment_status, '') <> 'cancelled';

  select coalesce(sum(total), 0) into v_pool_revenue
  from public.pool_day_use
  where lodge_id = p_lodge_id
    and date >= v_month_start
    and date < v_month_end_exclusive;

  select coalesce(sum(greatest(
      0,
      least(b.check_out, v_month_end_exclusive) - greatest(b.check_in, v_month_start)
    )), 0)
    into v_month_room_nights
  from public.bookings b
  where b.lodge_id = p_lodge_id
    and b.status <> 'cancelled'
    and b.check_in < v_month_end_exclusive
    and b.check_out > v_month_start;

  select coalesce(sum(greatest(
      0,
      least(b.check_out, v_month_start) - greatest(b.check_in, v_last_month_start)
    )), 0)
    into v_last_month_room_nights
  from public.bookings b
  where b.lodge_id = p_lodge_id
    and b.status <> 'cancelled'
    and b.check_in < v_month_start
    and b.check_out > v_last_month_start;

  v_month_occ := case
    when v_total_rooms > 0 and (v_month_end - v_month_start + 1) > 0
      then round((v_month_room_nights / (v_total_rooms::numeric * (v_month_end - v_month_start + 1)::numeric)) * 100)
    else 0
  end;

  v_last_month_occ := case
    when v_total_rooms > 0 and (v_last_month_end - v_last_month_start + 1) > 0
      then round((v_last_month_room_nights / (v_total_rooms::numeric * (v_last_month_end - v_last_month_start + 1)::numeric)) * 100)
    else 0
  end;

  return jsonb_build_object(
    'todayRev', coalesce(v_today_rev, 0),
    'weekRev', coalesce(v_week_rev, 0),
    'monthRev', coalesce(v_month_rev, 0),
    'lastMonthRev', coalesce(v_last_month_rev, 0),
    'monthRefunds', coalesce(v_month_refunds, 0),
    'lastMonthRefunds', coalesce(v_last_month_refunds, 0),
    'monthOcc', v_month_occ,
    'lastMonthOcc', v_last_month_occ,
    'currentOcc', v_current_occ,
    'totalRooms', v_total_rooms,
    'unpaidTotal', coalesce(v_unpaid_total, 0),
    'unpaidCount', v_unpaid_count,
    'monthExpenses', coalesce(v_month_expenses, 0),
    'posRevenue', coalesce(v_pos_revenue, 0),
    'conferenceRevenue', coalesce(v_conference_revenue, 0),
    'poolRevenue', coalesce(v_pool_revenue, 0)
  );
end;
$$;


--
-- Name: get_revenue_report(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_revenue_report(p_lodge_id uuid, p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cancelled_count integer := 0;
  v_regular_revenue numeric := 0;
  v_event_revenue numeric := 0;
  v_total_revenue numeric := 0;
  v_total_paid_snapshot numeric := 0;
  v_total_bookings integer := 0;
  v_confirmed_count integer := 0;
  v_checked_in_count integer := 0;
  v_checked_out_count integer := 0;
  v_paid_count integer := 0;
  v_partial_count integer := 0;
  v_unpaid_count integer := 0;
  v_gross_collected numeric := 0;
  v_refunds_issued numeric := 0;
  v_net_cash_collected numeric := 0;
  v_retained_revenue numeric := 0;
  v_retained_count integer := 0;
  v_vat_amount numeric := 0;
  v_vat_rates_in_use integer := 0;
  v_vat_rate numeric := null;
  v_event_bookings jsonb := '[]'::jsonb;
  v_event_count integer := 0;
  v_booking_payment_by_method jsonb := '{}'::jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with bookings_in_range as (
    select
      b.id,
      b.total_amount,
      b.charges_total,
      b.amount_paid,
      b.status,
      b.payment_status,
      b.check_in,
      b.check_out,
      b.is_exclusive_event,
      b.notes,
      b.event_daily_rate,
      b.vat_enabled,
      b.vat_rate,
      b.created_at
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
  )
  select count(*)
    into v_cancelled_count
  from bookings_in_range
  where coalesce(status, '') = 'cancelled';

  with revenue_bookings as (
    select *
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
      and coalesce(b.status, '') <> 'cancelled'
  )
  select
    coalesce(sum(coalesce(total_amount, 0) + coalesce(charges_total, 0)), 0),
    coalesce(sum(coalesce(amount_paid, 0)), 0),
    count(*)
      filter (where not coalesce(is_exclusive_event, false)),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and status = 'confirmed'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and status = 'checked_in'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and status = 'checked_out'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and payment_status = 'paid'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and payment_status = 'partial'),
    count(*)
      filter (where not coalesce(is_exclusive_event, false) and coalesce(payment_status, 'unpaid') = 'unpaid'),
    coalesce(sum(
      case
        when not coalesce(is_exclusive_event, false) and coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0
          then ((coalesce(total_amount, 0) + coalesce(charges_total, 0)) * coalesce(vat_rate, 0)) / (100 + coalesce(vat_rate, 0))
        else 0
      end
    ), 0),
    count(distinct case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end),
    min(case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end)
    into v_regular_revenue,
         v_total_paid_snapshot,
         v_total_bookings,
         v_confirmed_count,
         v_checked_in_count,
         v_checked_out_count,
         v_paid_count,
         v_partial_count,
         v_unpaid_count,
         v_vat_amount,
         v_vat_rates_in_use,
         v_vat_rate
  from revenue_bookings;

  with event_rows as (
    select
      coalesce((regexp_match(coalesce(b.notes, ''), '\[GROUP:([^\]]+)\]'))[1], to_char(b.check_in, 'YYYY-MM-DD')) as group_id,
      b.check_in,
      b.check_out,
      b.event_daily_rate,
      b.charges_total,
      b.amount_paid,
      b.status,
      b.payment_status,
      b.vat_enabled,
      b.vat_rate,
      b.created_at
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
      and coalesce(b.status, '') <> 'cancelled'
      and coalesce(b.is_exclusive_event, false)
  ),
  grouped_events as (
    select
      group_id,
      min(check_in) as check_in,
      max(check_out) as check_out,
      greatest(1, max(check_out - check_in)) as nights,
      coalesce((array_agg(coalesce(event_daily_rate, 0) order by created_at asc))[1], 0) as daily_rate,
      coalesce(sum(coalesce(charges_total, 0)), 0) as charges_total,
      count(*) as room_count,
      coalesce((array_agg(coalesce(status, 'confirmed') order by created_at asc))[1], 'confirmed') as status,
      coalesce((array_agg(coalesce(payment_status, 'unpaid') order by created_at asc))[1], 'unpaid') as payment_status,
      coalesce(sum(coalesce(amount_paid, 0)), 0) as amount_paid,
      coalesce((array_agg(coalesce(vat_enabled, false) order by created_at asc))[1], false) as vat_enabled,
      coalesce((array_agg(coalesce(vat_rate, 0) order by created_at asc))[1], 0) as vat_rate
    from event_rows
    group by group_id
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'group_id', group_id,
      'check_in', check_in,
      'check_out', check_out,
      'nights', nights,
      'daily_rate', daily_rate,
      'total', (daily_rate * nights),
      'charges_total', charges_total,
      'room_count', room_count,
      'status', status,
      'payment_status', payment_status,
      'amount_paid', amount_paid
    ) order by check_in asc, group_id asc), '[]'::jsonb),
    coalesce(sum((daily_rate * nights) + charges_total), 0),
    count(*),
    coalesce(sum(amount_paid), 0),
    count(*) filter (where status = 'confirmed'),
    count(*) filter (where status = 'checked_in'),
    count(*) filter (where status = 'checked_out'),
    count(*) filter (where payment_status = 'paid'),
    count(*) filter (where payment_status = 'partial'),
    count(*) filter (where coalesce(payment_status, 'unpaid') = 'unpaid'),
    coalesce(sum(
      case
        when vat_enabled and coalesce(vat_rate, 0) > 0
          then (((daily_rate * nights) + charges_total) * vat_rate) / (100 + vat_rate)
        else 0
      end
    ), 0),
    count(distinct case when vat_enabled and coalesce(vat_rate, 0) > 0 then vat_rate end),
    min(case when vat_enabled and coalesce(vat_rate, 0) > 0 then vat_rate end)
    into v_event_bookings,
         v_event_revenue,
         v_event_count,
         v_total_paid_snapshot,
         v_confirmed_count,
         v_checked_in_count,
         v_checked_out_count,
         v_paid_count,
         v_partial_count,
         v_unpaid_count,
         v_vat_amount,
         v_vat_rates_in_use,
         v_vat_rate
  from grouped_events;

  with revenue_bookings as (
    select *
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
      and coalesce(b.status, '') <> 'cancelled'
  ),
  grouped_events as (
    select
      coalesce((regexp_match(coalesce(b.notes, ''), '\[GROUP:([^\]]+)\]'))[1], to_char(b.check_in, 'YYYY-MM-DD')) as group_id,
      min(b.check_in) as check_in,
      max(b.check_out) as check_out,
      greatest(1, max(b.check_out - b.check_in)) as nights,
      coalesce((array_agg(coalesce(b.event_daily_rate, 0) order by b.created_at asc))[1], 0) as daily_rate,
      coalesce(sum(coalesce(b.charges_total, 0)), 0) as charges_total,
      coalesce(sum(coalesce(b.amount_paid, 0)), 0) as amount_paid,
      coalesce((array_agg(coalesce(b.status, 'confirmed') order by b.created_at asc))[1], 'confirmed') as status,
      coalesce((array_agg(coalesce(b.payment_status, 'unpaid') order by b.created_at asc))[1], 'unpaid') as payment_status,
      coalesce((array_agg(coalesce(b.vat_enabled, false) order by b.created_at asc))[1], false) as vat_enabled,
      coalesce((array_agg(coalesce(b.vat_rate, 0) order by b.created_at asc))[1], 0) as vat_rate
    from revenue_bookings b
    where coalesce(b.is_exclusive_event, false)
    group by coalesce((regexp_match(coalesce(b.notes, ''), '\[GROUP:([^\]]+)\]'))[1], to_char(b.check_in, 'YYYY-MM-DD'))
  ),
  booking_summary as (
    select
      coalesce(sum(case when not coalesce(is_exclusive_event, false) then coalesce(total_amount, 0) + coalesce(charges_total, 0) else 0 end), 0) as regular_revenue,
      coalesce(sum(case when not coalesce(is_exclusive_event, false) then coalesce(amount_paid, 0) else 0 end), 0) as regular_paid,
      count(*) filter (where not coalesce(is_exclusive_event, false)) as regular_units,
      count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'confirmed') as regular_confirmed,
      count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'checked_in') as regular_checked_in,
      count(*) filter (where not coalesce(is_exclusive_event, false) and status = 'checked_out') as regular_checked_out,
      count(*) filter (where not coalesce(is_exclusive_event, false) and payment_status = 'paid') as regular_paid_count,
      count(*) filter (where not coalesce(is_exclusive_event, false) and payment_status = 'partial') as regular_partial_count,
      count(*) filter (where not coalesce(is_exclusive_event, false) and coalesce(payment_status, 'unpaid') = 'unpaid') as regular_unpaid_count,
      coalesce(sum(
        case
          when not coalesce(is_exclusive_event, false) and coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0
            then ((coalesce(total_amount, 0) + coalesce(charges_total, 0)) * coalesce(vat_rate, 0)) / (100 + coalesce(vat_rate, 0))
          else 0
        end
      ), 0) as regular_vat,
      count(distinct case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end) as vat_rates_in_use,
      min(case when coalesce(vat_enabled, false) and coalesce(vat_rate, 0) > 0 then vat_rate end) as vat_rate
    from revenue_bookings
  ),
  event_summary as (
    select
      coalesce(sum((daily_rate * nights) + charges_total), 0) as event_revenue,
      coalesce(sum(amount_paid), 0) as event_paid,
      count(*) as event_units,
      count(*) filter (where status = 'confirmed') as event_confirmed,
      count(*) filter (where status = 'checked_in') as event_checked_in,
      count(*) filter (where status = 'checked_out') as event_checked_out,
      count(*) filter (where payment_status = 'paid') as event_paid_count,
      count(*) filter (where payment_status = 'partial') as event_partial_count,
      count(*) filter (where coalesce(payment_status, 'unpaid') = 'unpaid') as event_unpaid_count,
      coalesce(sum(
        case
          when vat_enabled and coalesce(vat_rate, 0) > 0
            then (((daily_rate * nights) + charges_total) * vat_rate) / (100 + vat_rate)
          else 0
        end
      ), 0) as event_vat,
      count(distinct case when vat_enabled and coalesce(vat_rate, 0) > 0 then vat_rate end) as event_vat_rates_in_use,
      min(case when vat_enabled and coalesce(vat_rate, 0) > 0 then vat_rate end) as event_vat_rate
    from grouped_events
  )
  select
    bs.regular_revenue,
    es.event_revenue,
    (bs.regular_revenue + es.event_revenue),
    (bs.regular_paid + es.event_paid),
    (bs.regular_units + es.event_units),
    (bs.regular_confirmed + es.event_confirmed),
    (bs.regular_checked_in + es.event_checked_in),
    (bs.regular_checked_out + es.event_checked_out),
    (bs.regular_paid_count + es.event_paid_count),
    (bs.regular_partial_count + es.event_partial_count),
    (bs.regular_unpaid_count + es.event_unpaid_count),
    (bs.regular_vat + es.event_vat)
    into v_regular_revenue,
         v_event_revenue,
         v_total_revenue,
         v_total_paid_snapshot,
         v_total_bookings,
         v_confirmed_count,
         v_checked_in_count,
         v_checked_out_count,
         v_paid_count,
         v_partial_count,
         v_unpaid_count,
         v_vat_amount
  from booking_summary bs
  cross join event_summary es;

  with vat_rates as (
    select distinct coalesce(vat_rate, 0) as vat_rate
    from public.bookings
    where lodge_id = p_lodge_id
      and check_in >= p_start_date
      and check_in <= p_end_date
      and coalesce(status, '') <> 'cancelled'
      and coalesce(vat_enabled, false)
      and coalesce(vat_rate, 0) > 0
  )
  select count(*), min(vat_rate)
    into v_vat_rates_in_use, v_vat_rate
  from vat_rates;

  with payment_window as (
    select p.booking_id, p.amount, p.method, p.type, p.paid_at
    from public.payments p
    where p.lodge_id = p_lodge_id
      and p.paid_at >= p_start_date::timestamptz
      and p.paid_at < (p_end_date + 1)::timestamptz
  ),
  cancelled_bookings as (
    select b.id
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and b.check_in >= p_start_date
      and b.check_in <= p_end_date
      and coalesce(b.status, '') = 'cancelled'
  ),
  payment_methods as (
    select
      coalesce(nullif(trim(method), ''), 'unknown') as method,
      sum(amount) as total
    from payment_window
    where amount > 0
    group by coalesce(nullif(trim(method), ''), 'unknown')
  )
  select
    coalesce(sum(case when amount > 0 then amount else 0 end), 0),
    coalesce(sum(case when amount < 0 or lower(coalesce(type, '')) = 'refund' then abs(amount) else 0 end), 0),
    coalesce(sum(amount), 0),
    coalesce(sum(case when cb.id is not null and lower(coalesce(pw.type, '')) <> 'refund' and pw.amount > 0 then pw.amount else 0 end), 0),
    count(distinct case when cb.id is not null and lower(coalesce(pw.type, '')) <> 'refund' and pw.amount > 0 then pw.booking_id end),
    coalesce((select jsonb_object_agg(method, total) from payment_methods), '{}'::jsonb)
    into v_gross_collected,
         v_refunds_issued,
         v_net_cash_collected,
         v_retained_revenue,
         v_retained_count,
         v_booking_payment_by_method
  from payment_window pw
  left join cancelled_bookings cb
    on cb.id = pw.booking_id;

  return jsonb_build_object(
    'total_revenue', coalesce(v_total_revenue, 0),
    'regular_revenue', coalesce(v_regular_revenue, 0),
    'event_revenue', coalesce(v_event_revenue, 0),
    'event_count', coalesce(v_event_count, 0),
    'event_bookings', v_event_bookings,
    'total_bookings', coalesce(v_total_bookings, 0),
    'avg_booking_value', case when coalesce(v_total_bookings, 0) > 0 then coalesce(v_total_revenue, 0) / v_total_bookings else 0 end,
    'confirmed_count', coalesce(v_confirmed_count, 0),
    'checked_in_count', coalesce(v_checked_in_count, 0),
    'checked_out_count', coalesce(v_checked_out_count, 0),
    'cancelled_count', coalesce(v_cancelled_count, 0),
    'paid_count', coalesce(v_paid_count, 0),
    'partial_count', coalesce(v_partial_count, 0),
    'unpaid_count', coalesce(v_unpaid_count, 0),
    'paid_revenue', coalesce(v_net_cash_collected, 0),
    'cash_collected', coalesce(v_net_cash_collected, 0),
    'gross_collected', coalesce(v_gross_collected, 0),
    'refunds_issued', coalesce(v_refunds_issued, 0),
    'amount_paid_snapshot', coalesce(v_total_paid_snapshot, 0),
    'retained_revenue', coalesce(v_retained_revenue, 0),
    'retained_count', coalesce(v_retained_count, 0),
    'outstanding_amount', coalesce(v_total_revenue, 0) - coalesce(v_total_paid_snapshot, 0),
    'vat_enabled', coalesce(v_vat_rates_in_use, 0) > 0,
    'vat_rate', case when coalesce(v_vat_rates_in_use, 0) = 1 then v_vat_rate else null end,
    'vat_mixed', coalesce(v_vat_rates_in_use, 0) > 1,
    'vat_amount', round(coalesce(v_vat_amount, 0)::numeric, 2),
    'net_revenue', round((coalesce(v_total_revenue, 0) - coalesce(v_vat_amount, 0))::numeric, 2),
    'booking_payment_by_method', coalesce(v_booking_payment_by_method, '{}'::jsonb)
  );
end;
$$;


--
-- Name: get_room_profitability_summary(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_room_profitability_summary(p_lodge_id uuid, p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rows jsonb := '[]'::jsonb;
  v_total_days integer := greatest((p_end_date - p_start_date), 0);
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with room_list as (
    select
      r.id,
      r.room_number,
      r.room_type,
      coalesce(r.rate_per_night, 0) as rate_per_night
    from public.rooms r
    where r.lodge_id = p_lodge_id
  ),
  booking_metrics as (
    select
      b.room_id,
      coalesce(sum(greatest(0, least(b.check_out, p_end_date) - greatest(b.check_in, p_start_date))), 0) as occupied_nights,
      coalesce(sum(coalesce(b.total_amount, 0)), 0) as revenue
    from public.bookings b
    where b.lodge_id = p_lodge_id
      and coalesce(b.status, '') <> 'cancelled'
      and b.check_in <= p_end_date
      and b.check_out > p_start_date
    group by b.room_id
  ),
  supply_metrics as (
    select
      rsm.room_id,
      coalesce(sum(coalesce(rsm.total_cost, 0)), 0) as supply_cost,
      coalesce(sum(coalesce(rsm.quantity, 0)), 0) as supply_units_used
    from public.room_supply_movements rsm
    where rsm.lodge_id = p_lodge_id
      and rsm.movement_type = 'use'
      and rsm.created_at >= p_start_date::timestamptz
      and rsm.created_at < (p_end_date + 1)::timestamptz
    group by rsm.room_id
  ),
  maintenance_metrics as (
    select
      mt.room_id,
      count(*) as maintenance_count,
      count(*) filter (where coalesce(mt.status, '') <> 'resolved') as open_maintenance_count,
      coalesce(sum(coalesce(mt.total_cost, 0)), 0) as maintenance_cost
    from public.maintenance_tickets mt
    where mt.lodge_id = p_lodge_id
      and mt.reported_date >= p_start_date
      and mt.reported_date <= p_end_date
    group by mt.room_id
  ),
  rows as (
    select
      rl.id,
      rl.room_number,
      rl.room_type,
      rl.rate_per_night,
      coalesce(bm.occupied_nights, 0) as occupied_nights,
      case when v_total_days > 0 then round((coalesce(bm.occupied_nights, 0)::numeric / v_total_days::numeric) * 100) else 0 end as occupancy_rate,
      coalesce(bm.revenue, 0) as revenue,
      coalesce(sm.supply_cost, 0) as supply_cost,
      coalesce(sm.supply_units_used, 0) as supply_units_used,
      coalesce(mm.maintenance_cost, 0) as maintenance_cost,
      coalesce(mm.maintenance_count, 0) as maintenance_count,
      coalesce(mm.open_maintenance_count, 0) as open_maintenance_count
    from room_list rl
    left join booking_metrics bm
      on bm.room_id = rl.id
    left join supply_metrics sm
      on sm.room_id = rl.id
    left join maintenance_metrics mm
      on mm.room_id = rl.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'room_number', room_number,
    'room_type', room_type,
    'rate_per_night', rate_per_night,
    'occupied_nights', occupied_nights,
    'occupancy_rate', occupancy_rate,
    'revenue', revenue,
    'supply_cost', supply_cost,
    'supply_units_used', supply_units_used,
    'maintenance_cost', maintenance_cost,
    'running_cost', supply_cost + maintenance_cost,
    'maintenance_count', maintenance_count,
    'open_maintenance_count', open_maintenance_count,
    'contribution', revenue - supply_cost - maintenance_cost,
    'margin_pct', case when revenue > 0 then round(((revenue - supply_cost - maintenance_cost) / revenue) * 100) else 0 end
  ) order by (revenue - supply_cost - maintenance_cost) desc, room_number asc), '[]'::jsonb)
    into v_rows
  from rows;

  return coalesce(v_rows, '[]'::jsonb);
end;
$$;


--
-- Name: subscription_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid,
    lodge_key text,
    license_id uuid,
    invoice_id uuid,
    event_type text NOT NULL,
    event_status text DEFAULT 'completed'::text NOT NULL,
    plan_name text,
    plan_version_code text,
    actor_id uuid,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: get_subscription_events(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_subscription_events(p_lodge_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 100) RETURNS SETOF public.subscription_events
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select se.*
  from public.subscription_events se
  where p_lodge_id is null or se.lodge_id = p_lodge_id
  order by se.created_at desc
  limit greatest(coalesce(p_limit, 100), 1);
$$;


--
-- Name: get_supply_spend_summary(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_supply_spend_summary(p_lodge_id uuid, p_start_date date, p_end_date date) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_total numeric := 0;
  v_purchases jsonb := '[]'::jsonb;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Start date and end date are required';
  end if;

  if p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if not public.app_lodge_access(p_lodge_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  with filtered as (
    select
      sp.id,
      sp.date,
      sp.date::timestamptz as purchased_at,
      sp.item_id,
      sp.quantity_purchased,
      sp.unit_cost,
      sp.total_cost,
      sp.notes,
      si.name as item_name
    from public.supply_purchases sp
    left join public.supply_items si
      on si.id = sp.item_id
    where sp.lodge_id = p_lodge_id
      and sp.date >= p_start_date
      and sp.date <= p_end_date
  )
  select
    coalesce(sum(total_cost), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'date', date,
      'purchased_at', purchased_at,
      'item_id', item_id,
      'quantity_purchased', quantity_purchased,
      'unit_cost', unit_cost,
      'total_cost', total_cost,
      'notes', notes,
      'supply_items', jsonb_build_object('name', item_name)
    ) order by date desc, purchased_at desc, id desc), '[]'::jsonb)
    into v_total, v_purchases
  from filtered;

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'purchases', coalesce(v_purchases, '[]'::jsonb)
  );
end;
$$;


--
-- Name: get_test_data_reset_audit(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_test_data_reset_audit(p_lodge_id uuid, p_limit integer DEFAULT 20) RETURNS TABLE(id uuid, lodge_id uuid, triggered_by uuid, triggered_by_name text, reset_mode text, reason text, deleted_counts jsonb, created_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    a.id,
    a.lodge_id,
    a.triggered_by,
    u.name as triggered_by_name,
    a.reset_mode,
    a.reason,
    a.deleted_counts,
    a.created_at
  from public.test_data_reset_audit a
  left join public.users u on u.id = a.triggered_by
  where a.lodge_id = p_lodge_id
  order by a.created_at desc
  limit greatest(coalesce(p_limit, 20), 1);
$$;


--
-- Name: get_test_data_reset_preview(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_test_data_reset_preview(p_lodge_id uuid, p_mode text DEFAULT 'full_demo_reset'::text, p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_mode text := coalesce(nullif(p_mode, ''), 'full_demo_reset');
  v_preview jsonb := '{}'::jsonb;
  v_booking_ids uuid[] := '{}'::uuid[];
  v_customer_ids uuid[] := '{}'::uuid[];
  v_invoice_numbers text[] := '{}'::text[];
begin
  if not public.test_mode_enabled_for_lodge(p_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Test mode is not enabled for this lodge');
  end if;

  if v_mode not in ('recent_activity', 'tagged_test_data', 'full_demo_reset') then
    return jsonb_build_object('success', false, 'error', 'Unsupported reset mode');
  end if;

  if v_mode = 'recent_activity' then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id
       and coalesce(created_at, now()) >= v_cutoff;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id
       and coalesce(created_at, now()) >= v_cutoff;
  elsif v_mode = 'tagged_test_data' then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id
       and (
         lower(coalesce(source, '')) = 'test'
         or lower(coalesce(notes, '')) like '%[test]%'
         or lower(coalesce(notes, '')) like '%test booking%'
       );

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id
       and (
         lower(coalesce(email, '')) like '%+test@%'
         or lower(coalesce(name, '')) like '%test%'
       );
  else
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id;
  end if;

  select coalesce(array_agg(distinct nullif(btrim(invoice_number), '')), '{}'::text[])
    into v_invoice_numbers
    from public.bookings
   where lodge_id = p_lodge_id
     and id = any(v_booking_ids)
     and nullif(btrim(invoice_number), '') is not null;

  v_preview := jsonb_build_object(
    'success', true,
    'mode', v_mode,
    'cutoff', case when v_mode = 'recent_activity' then v_cutoff else null end,
    'counts', jsonb_build_object(
      'bookings', coalesce(array_length(v_booking_ids, 1), 0),
      'payments', (select count(*) from public.payments where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
      'booking_charges', (select count(*) from public.booking_charges where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
      'invoices', (
        select count(*)
          from public.invoices
         where lodge_id = p_lodge_id
           and (
             booking_id = any(v_booking_ids)
             or (array_length(v_invoice_numbers, 1) > 0 and invoice_number = any(v_invoice_numbers))
           )
      ),
      'customers', coalesce(array_length(v_customer_ids, 1), 0),
      'quotations', (select count(*) from public.quotations where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
      'expenses', (select count(*) from public.expenses where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff or coalesce(date::timestamptz, now()) >= v_cutoff)),
      'pos_orders', (select count(*) from public.pos_orders where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
      'maintenance_tickets', (select count(*) from public.maintenance_tickets where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
      'conference_bookings', (select count(*) from public.conference_bookings where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
      'pool_day_use', (select count(*) from public.pool_day_use where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff))
    )
  );

  return v_preview;
end;
$$;


--
-- Name: get_user_outlet_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_outlet_access(p_user_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'allowed_outlet_ids',
    coalesce(
      (select allowed_outlet_ids
         from public.users
        where id = p_user_id
          and lodge_id = p_lodge_id),
      '{}'::uuid[]
    )
  );
$$;


--
-- Name: guard_single_active_event_booking(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.guard_single_active_event_booking() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
  v_group text;
  v_existing uuid;
begin
  if not coalesce(new.is_exclusive_event, false) then
    return new;
  end if;

  if coalesce(new.status, '') = 'cancelled' then
    return new;
  end if;

  v_group := public.extract_booking_event_group(new.notes);
  if v_group is null then
    raise exception 'Exclusive event bookings must include a [GROUP:...] marker';
  end if;

  select id
    into v_existing
    from public.bookings
   where lodge_id = new.lodge_id
     and coalesce(is_exclusive_event, false)
     and coalesce(status, '') <> 'cancelled'
     and public.extract_booking_event_group(notes) = v_group
     and id <> new.id
   limit 1;

  if v_existing is not null then
    raise exception 'An active exclusive event booking already exists for group %. Existing booking: %', v_group, v_existing;
  end if;

  return new;
end;
$$;


--
-- Name: FUNCTION guard_single_active_event_booking(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.guard_single_active_event_booking() IS 'Prevents one lodge/event booking from becoming multiple active booking/invoice rows for the same event group.';


--
-- Name: handle_pgrst_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_pgrst_request() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_token   text;
  v_actor   text;
begin
  v_token := coalesce(
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session',        '')), ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x-boroko-session-token',  '')), ''),
    nullif(btrim(coalesce(public.app_request_headers()->>'x_boroko_session',        '')), ''),
    ''
  );
  perform set_config('app.session_token', v_token, true);

  v_actor := '';
  if v_token <> '' then
    select s.user_id::text into v_actor
    from public.app_sessions s
    where s.token_hash = public.app_hash_token(v_token)
      and s.expires_at > now()
      and s.revoked_at is null
    limit 1;
    v_actor := coalesce(v_actor, '');
  end if;
  perform set_config('app.actor_id', v_actor, true);
end;
$$;


--
-- Name: issue_app_session(uuid, uuid, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issue_app_session(p_user_id uuid, p_lodge_id uuid, p_role text, p_session_type text DEFAULT 'desktop'::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(session_token text, session_expires_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_token text;
  v_session_type text := lower(coalesce(nullif(btrim(p_session_type), ''), 'desktop'));
  v_expires_at timestamptz := now() + public.app_session_ttl(v_session_type);
begin
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.app_sessions (
    token_hash,
    session_type,
    user_id,
    lodge_id,
    role,
    expires_at,
    metadata
  ) values (
    public.app_hash_token(v_token),
    v_session_type,
    p_user_id,
    p_lodge_id,
    lower(coalesce(btrim(p_role), 'receptionist')),
    v_expires_at,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return query
  select
    v_token as session_token,
    v_expires_at as session_expires_at;
end;
$$;


--
-- Name: issue_subscription_contract(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.issue_subscription_contract(p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_lodge_key text := nullif(btrim(coalesce(p_payload->>'lodge_id', '')), '');
  v_lodge_id uuid := case when coalesce(p_payload->>'lodge_id', '') ~ '^[0-9a-fA-F-]{36}$' then (p_payload->>'lodge_id')::uuid else null end;
  v_plan text := public._normalize_subscription_plan(p_payload->>'subscription_plan');
  v_plan_version_code text := coalesce(nullif(btrim(coalesce(p_payload->>'plan_version_code', '')), ''), '2026.04');
  v_payment_status text := lower(coalesce(nullif(btrim(coalesce(p_payload->>'payment_status', '')), ''), 'active'));
  v_grace_days integer := greatest(coalesce(nullif(p_payload->>'grace_period_days', '')::integer, 7), 0);
  v_offline_lease_days integer := greatest(least(coalesce(nullif(p_payload->>'offline_lease_days', '')::integer, 7), 30), 1);
  v_attempt integer := 0;
  v_license public.licenses%rowtype;
  v_invoice public.invoices%rowtype;
  v_invoice_number text;
  v_invoice_status text;
  v_create_invoice boolean := coalesce((p_payload->>'create_invoice')::boolean, false) or jsonb_typeof(p_payload->'invoice') = 'object';
  v_amount numeric := coalesce(nullif(p_payload->>'monthly_fee', '')::numeric, 0);
  v_invoice_amount numeric;
begin
  if not public.app_is_service_role() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if v_lodge_key is null then
    return jsonb_build_object('success', false, 'error', 'A lodge must be selected before issuing a subscription.');
  end if;

  update public.licenses
  set is_active = false,
      subscription_state = 'superseded',
      notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded by a newer subscription contract]'))
  where lodge_id = v_lodge_id
    and coalesce(is_active, true) = true;

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.licenses (
        lodge_id, license_key, lodge_name, business_type, expires_at, notes,
        subscription_plan, payment_status, monthly_fee, currency, next_due_date,
        last_payment_date, is_active, plan_version_code, grace_period_days,
        offline_lease_days, activated_at, subscription_state
      ) values (
        v_lodge_id,
        public._generate_license_key(),
        coalesce(p_payload->>'lodge_name', ''),
        coalesce(nullif(p_payload->>'business_type', ''), 'lodge'),
        nullif(p_payload->>'expires_at', '')::timestamptz,
        nullif(p_payload->>'notes', ''),
        v_plan,
        v_payment_status,
        v_amount,
        coalesce(nullif(p_payload->>'currency', ''), 'BWP'),
        nullif(p_payload->>'next_due_date', '')::date,
        nullif(p_payload->>'last_payment_date', '')::date,
        true,
        v_plan_version_code,
        v_grace_days,
        v_offline_lease_days,
        now(),
        public._subscription_state(v_payment_status, nullif(p_payload->>'next_due_date', '')::date, nullif(p_payload->>'expires_at', '')::timestamptz, true, v_grace_days)
      )
      returning * into v_license;
      exit;
    exception
      when unique_violation then
        if v_attempt >= 8 then
          raise;
        end if;
    end;
  end loop;

  if v_create_invoice then
    if v_lodge_id is null then
      raise exception 'Subscription invoices require a valid lodge UUID.';
    end if;

    v_invoice_amount := coalesce(nullif(p_payload #>> '{invoice,amount}', '')::numeric, v_amount, 0);
    v_invoice_status := coalesce(nullif(lower(p_payload #>> '{invoice,status}'), ''), case when v_payment_status in ('trial', 'free') then 'draft' else 'paid' end);
    v_invoice_number := nullif(p_payload #>> '{invoice,invoice_number}', '');
    if v_invoice_number is null then
      v_invoice_number := public.get_next_invoice_number(v_lodge_id);
    end if;

    insert into public.invoices (
      lodge_id, invoice_number, total_amount, status, issued_at, due_date, notes
    ) values (
      v_lodge_id,
      v_invoice_number,
      v_invoice_amount,
      v_invoice_status,
      now(),
      coalesce(nullif(p_payload #>> '{invoice,due_date}', '')::date, now()::date + 30),
      coalesce(nullif(p_payload #>> '{invoice,notes}', ''), 'Subscription invoice')
    )
    returning * into v_invoice;

    perform public._record_subscription_event(
      v_lodge_id, v_lodge_id::text, v_license.id, v_invoice.id,
      'subscription_contract_issued', 'completed',
      public._normalize_subscription_plan(v_license.subscription_plan),
      coalesce(v_license.plan_version_code, '2026.04'),
      jsonb_build_object('invoice_number', v_invoice.invoice_number, 'amount', v_invoice_amount, 'status', v_invoice_status)
    );
  end if;

  return jsonb_build_object('success', true, 'license_id', v_license.id, 'license_key', v_license.license_key);
end;
$_$;


--
-- Name: load_supply_to_room(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.load_supply_to_room(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_reorder_level numeric := coalesce((payload->>'reorder_level')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_current_store numeric;
  v_unit_cost numeric;
  v_new_store numeric;
  v_new_room numeric;
begin
  if v_qty <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  end if;

  select current_stock, latest_unit_cost
    into v_current_store, v_unit_cost
    from public.supply_items
   where id = v_item_id
     and lodge_id = v_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  if coalesce(v_current_store, 0) < v_qty then
    return jsonb_build_object('success', false, 'error', 'Not enough store stock available for this load');
  end if;

  update public.supply_items
     set current_stock = coalesce(current_stock, 0) - v_qty
   where id = v_item_id
     and lodge_id = v_lodge_id
  returning current_stock into v_new_store;

  insert into public.room_supply_room_stock (
    lodge_id,
    room_id,
    supply_item_id,
    quantity_on_hand,
    reorder_level,
    last_moved_at,
    updated_at
  ) values (
    v_lodge_id,
    v_room_id,
    v_item_id,
    v_qty,
    v_reorder_level,
    now(),
    now()
  )
  on conflict (lodge_id, room_id, supply_item_id)
  do update set
    quantity_on_hand = coalesce(public.room_supply_room_stock.quantity_on_hand, 0) + excluded.quantity_on_hand,
    reorder_level = case
      when excluded.reorder_level > 0 then excluded.reorder_level
      else public.room_supply_room_stock.reorder_level
    end,
    last_moved_at = now(),
    updated_at = now()
  returning quantity_on_hand into v_new_room;

  insert into public.room_supply_movements (
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    v_lodge_id,
    v_room_id,
    v_item_id,
    'load',
    v_qty,
    coalesce(v_unit_cost, 0),
    v_qty * coalesce(v_unit_cost, 0),
    v_notes
  );

  return jsonb_build_object(
    'success', true,
    'new_store_stock', v_new_store,
    'new_room_stock', v_new_room
  );
end;
$$;


--
-- Name: mark_quotation_sent(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_quotation_sent(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  update public.quotations
     set status = 'sent',
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id
     and status = 'draft'
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', true, 'id', p_id, 'noop', true);
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: populate_pos_order_item_inventory_link(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.populate_pos_order_item_inventory_link() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_outlet_id uuid;
  v_inventory_item_id uuid;
  v_depletion_qty numeric;
begin
  if new.inventory_item_id is not null then
    new.depletion_qty := greatest(1, coalesce(new.depletion_qty, 1));
    return new;
  end if;

  if new.menu_item_id is not null then
    select pmi.inventory_item_id,
           coalesce(pmi.depletion_qty, 1)
      into v_inventory_item_id,
           v_depletion_qty
      from public.pos_menu_items pmi
     where pmi.id = new.menu_item_id
       and pmi.lodge_id = new.lodge_id;
  end if;

  if v_inventory_item_id is null and nullif(btrim(coalesce(new.item_name, '')), '') is not null then
    select po.outlet_id
      into v_outlet_id
      from public.pos_orders po
     where po.id = new.order_id
       and po.lodge_id = new.lodge_id;

    select ii.id
      into v_inventory_item_id
      from public.inventory_items ii
     where ii.lodge_id = new.lodge_id
       and lower(ii.name) = lower(new.item_name)
       and (v_outlet_id is null or ii.outlet_id = v_outlet_id or ii.outlet_id is null)
     order by case when ii.outlet_id = v_outlet_id then 0 else 1 end,
              ii.name
     limit 1;

    v_depletion_qty := 1;
  end if;

  if v_inventory_item_id is not null then
    new.inventory_item_id := v_inventory_item_id;
    new.depletion_qty := greatest(1, coalesce(v_depletion_qty, new.depletion_qty, 1));
  else
    new.depletion_qty := greatest(1, coalesce(new.depletion_qty, 1));
  end if;

  return new;
end;
$$;


--
-- Name: post_inventory_stocktake_session(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_inventory_stocktake_session(p_stocktake_id uuid, p_lodge_id uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.inventory_stocktakes%rowtype;
  v_variance_count integer := 0;
begin
  select *
    into v_session
    from public.inventory_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Stock take session not found');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'This stock take has already been posted');
  end if;

  update public.inventory_stocktake_lines
     set counted_qty = coalesce(counted_qty, expected_qty),
         variance_qty = coalesce(counted_qty, expected_qty) - expected_qty,
         variance_cost = (coalesce(counted_qty, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
         updated_at = now()
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id;

  update public.inventory_items ii
     set current_stock = coalesce(lines.counted_qty, lines.expected_qty)
    from public.inventory_stocktake_lines lines
   where lines.stocktake_id = p_stocktake_id
     and lines.lodge_id = p_lodge_id
     and ii.id = lines.item_id
     and ii.lodge_id = p_lodge_id;

  select count(*)
    into v_variance_count
    from public.inventory_stocktake_lines
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id
     and coalesce(variance_qty, 0) <> 0;

  update public.inventory_stocktakes
     set status = 'posted',
         notes = coalesce(nullif(p_notes, ''), notes),
         counted_at = coalesce(counted_at, now()),
         posted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object(
    'success', true,
    'variance_count', v_variance_count
  );
end;
$$;


--
-- Name: post_room_supply_stocktake_session(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_room_supply_stocktake_session(p_stocktake_id uuid, p_lodge_id uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.room_supply_stocktakes%rowtype;
  v_variance_count integer := 0;
begin
  select *
    into v_session
    from public.room_supply_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room stock take session not found');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'This room stock take has already been posted');
  end if;

  update public.room_supply_stocktake_lines
     set counted_qty = coalesce(counted_qty, expected_qty),
         variance_qty = coalesce(counted_qty, expected_qty) - expected_qty,
         variance_cost = (coalesce(counted_qty, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
         updated_at = now()
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id;

  update public.room_supply_room_stock rs
     set quantity_on_hand = coalesce(lines.counted_qty, lines.expected_qty),
         last_moved_at = now(),
         updated_at = now()
    from public.room_supply_stocktake_lines lines
   where lines.stocktake_id = p_stocktake_id
     and lines.lodge_id = p_lodge_id
     and rs.id = lines.room_stock_id
     and rs.lodge_id = p_lodge_id;

  insert into public.room_supply_movements (
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  )
  select
    p_lodge_id,
    lines.room_id,
    lines.supply_item_id,
    'adjustment',
    lines.variance_qty,
    coalesce(lines.unit_cost, 0),
    coalesce(lines.variance_qty, 0) * coalesce(lines.unit_cost, 0),
    trim(both ' ' from concat(
      'Room stock take adjustment',
      case when nullif(lines.notes, '') is not null then ': ' || lines.notes else '' end,
      case when nullif(p_notes, '') is not null then ' | ' || p_notes else '' end
    ))
  from public.room_supply_stocktake_lines lines
  where lines.stocktake_id = p_stocktake_id
    and lines.lodge_id = p_lodge_id
    and coalesce(lines.variance_qty, 0) <> 0;

  select count(*)
    into v_variance_count
    from public.room_supply_stocktake_lines
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id
     and coalesce(variance_qty, 0) <> 0;

  update public.room_supply_stocktakes
     set status = 'posted',
         notes = coalesce(nullif(p_notes, ''), notes),
         counted_at = coalesce(counted_at, now()),
         posted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object(
    'success', true,
    'variance_count', v_variance_count
  );
end;
$$;


--
-- Name: post_supply_stocktake_session(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_supply_stocktake_session(p_stocktake_id uuid, p_lodge_id uuid, p_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.supply_stocktakes%rowtype;
  v_variance_count integer := 0;
begin
  select *
    into v_session
    from public.supply_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Stock take session not found');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'This stock take has already been posted');
  end if;

  update public.supply_stocktake_lines
     set counted_qty = coalesce(counted_qty, expected_qty),
         variance_qty = coalesce(counted_qty, expected_qty) - expected_qty,
         variance_cost = (coalesce(counted_qty, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
         updated_at = now()
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id;

  update public.supply_items si
     set current_stock = coalesce(lines.counted_qty, lines.expected_qty)
    from public.supply_stocktake_lines lines
   where lines.stocktake_id = p_stocktake_id
     and lines.lodge_id = p_lodge_id
     and si.id = lines.item_id
     and si.lodge_id = p_lodge_id;

  select count(*)
    into v_variance_count
    from public.supply_stocktake_lines
   where stocktake_id = p_stocktake_id
     and lodge_id = p_lodge_id
     and coalesce(variance_qty, 0) <> 0;

  update public.supply_stocktakes
     set status = 'posted',
         notes = coalesce(nullif(p_notes, ''), notes),
         counted_at = coalesce(counted_at, now()),
         posted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object(
    'success', true,
    'variance_count', v_variance_count
  );
end;
$$;


--
-- Name: record_booking_email_delivery(uuid, uuid, text, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_booking_email_delivery(p_lodge_id uuid, p_booking_id uuid, p_reference text, p_delivery_status text, p_recipient text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
begin
  if not public.app_is_service_role() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  insert into public.booking_email_delivery_log (
    lodge_id,
    booking_id,
    reference,
    delivery_status,
    recipient,
    error_message,
    metadata
  ) values (
    p_lodge_id,
    p_booking_id,
    nullif(btrim(coalesce(p_reference, '')), ''),
    p_delivery_status,
    nullif(btrim(coalesce(p_recipient, '')), ''),
    nullif(btrim(coalesce(p_error_message, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: booking_number_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.booking_number_seq
    START WITH 269
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    room_id uuid,
    customer_id uuid,
    check_in date NOT NULL,
    check_out date NOT NULL,
    adults integer DEFAULT 1,
    children integer DEFAULT 0,
    total_amount numeric DEFAULT 0,
    amount_paid numeric DEFAULT 0,
    deposit_amount numeric DEFAULT 0,
    payment_status text DEFAULT 'unpaid'::text,
    payment_method text,
    status text DEFAULT 'confirmed'::text,
    notes text,
    created_by uuid,
    updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    booking_number integer DEFAULT nextval('public.booking_number_seq'::regclass),
    invoice_number text,
    is_exclusive_event boolean DEFAULT false,
    event_daily_rate numeric(10,2),
    quotation_id uuid,
    create_idempotency_key text,
    charges_total numeric DEFAULT 0 NOT NULL,
    import_batch_id uuid,
    source text DEFAULT 'desktop'::text NOT NULL,
    vat_enabled boolean DEFAULT false NOT NULL,
    vat_rate numeric(8,4) DEFAULT 0 NOT NULL,
    cancel_reason text,
    cancelled_at timestamp with time zone,
    online_confirmation_token text,
    CONSTRAINT bookings_check_dates_valid CHECK ((check_out > check_in)),
    CONSTRAINT bookings_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'checked_in'::text, 'checked_out'::text, 'cancelled'::text]))),
    CONSTRAINT chk_bookings_vat_rate_non_negative CHECK ((vat_rate >= (0)::numeric))
);


--
-- Name: record_booking_payment(uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_booking_payment(p_booking_id uuid, p_lodge_id uuid, p_amount_paid numeric, p_payment_method text DEFAULT NULL::text) RETURNS public.bookings
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking bookings%rowtype;
  v_payment_status text;
begin
  -- Lock booking
  select *
  into v_booking
  from bookings
  where id = p_booking_id
    and lodge_id = p_lodge_id
  for update;

  if not found then
    raise exception 'Booking % was not found for lodge %', p_booking_id, p_lodge_id;
  end if;

  if coalesce(p_amount_paid, 0) < 0 then
    raise exception 'amount_paid cannot be negative';
  end if;

  -- Compute payment status
  v_payment_status := case
    when coalesce(p_amount_paid, 0) >= coalesce(v_booking.total_amount, 0)
         and coalesce(v_booking.total_amount, 0) > 0 then 'paid'
    when coalesce(p_amount_paid, 0) > 0 then 'partial'
    else 'unpaid'
  end;

  -- Update booking
  update bookings
  set amount_paid = coalesce(p_amount_paid, 0),
      payment_status = v_payment_status,
      payment_method = coalesce(p_payment_method, payment_method, 'cash'),
      updated_at = now()
  where id = p_booking_id
    and lodge_id = p_lodge_id
  returning * into v_booking;

  return v_booking;
end;
$$;


--
-- Name: record_booking_refund(uuid, uuid, numeric, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_booking_refund(p_booking_id uuid, p_lodge_id uuid, p_retained_percent numeric DEFAULT 0, p_method text DEFAULT 'refund'::text, p_notes text DEFAULT ''::text, p_recorded_by uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking public.bookings%rowtype;
  v_paid numeric;
  v_retained_percent numeric;
  v_refund_amount numeric;
  v_retained_amount numeric;
  v_new_paid numeric;
  v_status text;
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record a refund.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Refund idempotency key is required');
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if coalesce(v_booking.status, '') in ('checked_in', 'checked_out') then
    return jsonb_build_object(
      'success', false,
      'error', 'Refunds are only allowed before check-in or on already-cancelled bookings.'
    );
  end if;

  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'booking_id', p_booking_id,
      'amount_paid', coalesce(v_booking.amount_paid, 0),
      'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
      'idempotent', true
    );
  end if;

  v_paid := greatest(coalesce(v_booking.amount_paid, 0), 0);
  if v_paid <= 0 then
    return jsonb_build_object('success', false, 'error', 'There is no paid balance available to refund');
  end if;

  v_retained_percent := greatest(0, least(100, coalesce(p_retained_percent, 0)));
  v_refund_amount := round((v_paid * ((100 - v_retained_percent) / 100.0))::numeric, 2);
  v_retained_amount := round((v_paid - v_refund_amount)::numeric, 2);

  if v_refund_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'Retained percentage leaves nothing to refund');
  end if;

  v_new_paid := round(greatest(v_paid - v_refund_amount, 0)::numeric, 2);
  v_status := public.compute_payment_status(
    v_new_paid,
    v_booking.total_amount,
    v_booking.charges_total
  );

  update public.bookings
     set amount_paid = v_new_paid,
         payment_status = v_status,
         payment_method = coalesce(nullif(p_method, ''), payment_method),
         updated_at = now()
   where id = p_booking_id
     and lodge_id = p_lodge_id;

  begin
    insert into public.payments (
      booking_id, lodge_id, amount, method, type,
      paid_at, recorded_by, notes, idempotency_key
    ) values (
      p_booking_id,
      p_lodge_id,
      -v_refund_amount,
      coalesce(nullif(p_method, ''), 'refund'),
      'refund',
      now(),
      v_actor,
      concat(
        'Refunded ', v_refund_amount,
        ' | Retained ', v_retained_amount,
        ' (', v_retained_percent, '%)',
        case when coalesce(p_notes, '') <> '' then ' | ' || p_notes else '' end
      ),
      p_idempotency_key
    );
  exception
    when unique_violation then
      return jsonb_build_object(
        'success', true,
        'booking_id', p_booking_id,
        'amount_paid', coalesce(v_booking.amount_paid, 0),
        'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
        'idempotent', true
      );
  end;

  return jsonb_build_object(
    'success', true,
    'booking_id', p_booking_id,
    'refund_amount', v_refund_amount,
    'retained_amount', v_retained_amount,
    'retained_percent', v_retained_percent,
    'amount_paid', v_new_paid,
    'payment_status', v_status
  );
end;
$$;


--
-- Name: record_financial_validation_run(uuid, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_financial_validation_run(p_lodge_id uuid, p_trigger_source text DEFAULT 'manual'::text, p_triggered_by uuid DEFAULT NULL::uuid, p_summary jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_actor uuid := coalesce(public.app_current_user_id(), p_triggered_by);
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['finance', 'manager', 'admin', 'super_admin']
  );

  insert into public.financial_validation_runs (
    lodge_id,
    triggered_by,
    trigger_source,
    summary
  ) values (
    p_lodge_id,
    v_actor,
    case
      when p_trigger_source in ('manual', 'scheduled', 'startup') then p_trigger_source
      else 'manual'
    end,
    coalesce(p_summary, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: record_invoice_delivery(uuid, uuid, text, text, text, text, text, text, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_invoice_delivery(p_lodge_id uuid, p_booking_id uuid DEFAULT NULL::uuid, p_invoice_number text DEFAULT NULL::text, p_delivery_type text DEFAULT 'invoice_email'::text, p_delivery_status text DEFAULT 'completed'::text, p_recipient text DEFAULT NULL::text, p_file_path text DEFAULT NULL::text, p_render_version text DEFAULT NULL::text, p_initiated_by uuid DEFAULT NULL::uuid, p_metadata jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_id uuid;
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'finance', 'manager', 'admin', 'super_admin']
  );

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record invoice delivery.');
  end if;

  insert into public.invoice_delivery_log (
    lodge_id,
    booking_id,
    invoice_number,
    delivery_type,
    delivery_status,
    recipient,
    file_path,
    render_version,
    initiated_by,
    metadata
  ) values (
    p_lodge_id,
    p_booking_id,
    nullif(p_invoice_number, ''),
    p_delivery_type,
    p_delivery_status,
    nullif(p_recipient, ''),
    nullif(p_file_path, ''),
    nullif(p_render_version, ''),
    v_actor,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;


--
-- Name: repair_duplicate_event_bookings(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repair_duplicate_event_bookings(p_lodge_id uuid DEFAULT NULL::uuid) RETURNS TABLE(lodge_id uuid, event_group text, kept_booking_id uuid, removed_booking_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_group record;
  v_keep_id uuid;
  v_remove_ids uuid[];
  v_total_amount numeric;
  v_amount_paid numeric;
  v_charges_total numeric;
  v_payment_status text;
begin
  for v_group in
    select
      b.lodge_id,
      public.extract_booking_event_group(b.notes) as event_group,
      array_agg(b.id order by b.created_at asc, b.id asc) as booking_ids,
      count(*)::integer as booking_count,
      coalesce(sum(coalesce(b.total_amount, 0)), 0) as total_amount,
      coalesce(sum(coalesce(b.amount_paid, 0)), 0) as amount_paid,
      coalesce(sum(coalesce(b.charges_total, 0)), 0) as charges_total
    from public.bookings b
    where coalesce(b.is_exclusive_event, false)
      and coalesce(b.status, '') <> 'cancelled'
      and public.extract_booking_event_group(b.notes) is not null
      and (p_lodge_id is null or b.lodge_id = p_lodge_id)
    group by b.lodge_id, public.extract_booking_event_group(b.notes)
    having count(*) > 1
  loop
    v_keep_id := v_group.booking_ids[1];
    v_remove_ids := v_group.booking_ids[2:array_length(v_group.booking_ids, 1)];
    v_total_amount := round(coalesce(v_group.total_amount, 0)::numeric, 2);
    v_amount_paid := round(coalesce(v_group.amount_paid, 0)::numeric, 2);
    v_charges_total := round(coalesce(v_group.charges_total, 0)::numeric, 2);
    v_payment_status := case
      when v_amount_paid >= v_total_amount + v_charges_total and v_total_amount + v_charges_total > 0 then 'paid'
      when v_amount_paid > 0 then 'partial'
      else 'unpaid'
    end;

    update public.payments p
       set booking_id = v_keep_id
     where p.lodge_id = v_group.lodge_id
       and p.booking_id = any(v_remove_ids);

    update public.booking_charges bc
       set booking_id = v_keep_id
     where bc.lodge_id = v_group.lodge_id
       and bc.booking_id = any(v_remove_ids);

    update public.pos_orders po
       set booking_id = v_keep_id
     where po.lodge_id = v_group.lodge_id
       and po.booking_id = any(v_remove_ids);

    delete from public.invoices i
     where i.lodge_id = v_group.lodge_id
       and i.booking_id = any(v_remove_ids);

    delete from public.bookings b
     where b.lodge_id = v_group.lodge_id
       and b.id = any(v_remove_ids);

    update public.bookings b
       set total_amount = v_total_amount,
           amount_paid = v_amount_paid,
           charges_total = v_charges_total,
           payment_status = v_payment_status,
           updated_at = now()
     where b.lodge_id = v_group.lodge_id
       and b.id = v_keep_id;

    lodge_id := v_group.lodge_id;
    event_group := v_group.event_group;
    kept_booking_id := v_keep_id;
    removed_booking_count := coalesce(array_length(v_remove_ids, 1), 0);
    return next;
  end loop;
end;
$$;


--
-- Name: FUNCTION repair_duplicate_event_bookings(p_lodge_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.repair_duplicate_event_bookings(p_lodge_id uuid) IS 'Merges legacy multi-row exclusive event bookings into one booking/invoice row per event group.';


--
-- Name: reset_test_data(uuid, text, integer, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_test_data(p_lodge_id uuid, p_mode text DEFAULT 'full_demo_reset'::text, p_days integer DEFAULT 30, p_confirmation text DEFAULT ''::text, p_reason text DEFAULT ''::text, p_triggered_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_mode text := coalesce(nullif(p_mode, ''), 'full_demo_reset');
  v_booking_ids uuid[] := '{}'::uuid[];
  v_customer_ids uuid[] := '{}'::uuid[];
  v_invoice_numbers text[] := '{}'::text[];
  v_counts jsonb;
begin
  if not public.test_mode_enabled_for_lodge(p_lodge_id) then
    return jsonb_build_object('success', false, 'error', 'Test mode is not enabled for this lodge');
  end if;

  if p_confirmation <> 'RESET TEST DATA' then
    return jsonb_build_object('success', false, 'error', 'Confirmation phrase did not match');
  end if;

  if v_mode not in ('recent_activity', 'tagged_test_data', 'full_demo_reset') then
    return jsonb_build_object('success', false, 'error', 'Unsupported reset mode');
  end if;

  if v_mode = 'recent_activity' then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id
       and coalesce(created_at, now()) >= v_cutoff;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id
       and coalesce(created_at, now()) >= v_cutoff;
  elsif v_mode = 'tagged_test_data' then
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id
       and (
         lower(coalesce(source, '')) = 'test'
         or lower(coalesce(notes, '')) like '%[test]%'
         or lower(coalesce(notes, '')) like '%test booking%'
       );

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id
       and (
         lower(coalesce(email, '')) like '%+test@%'
         or lower(coalesce(name, '')) like '%test%'
       );
  else
    select coalesce(array_agg(id), '{}'::uuid[])
      into v_booking_ids
      from public.bookings
     where lodge_id = p_lodge_id;

    select coalesce(array_agg(id), '{}'::uuid[])
      into v_customer_ids
      from public.customers
     where lodge_id = p_lodge_id;
  end if;

  select coalesce(array_agg(distinct nullif(btrim(invoice_number), '')), '{}'::text[])
    into v_invoice_numbers
    from public.bookings
   where lodge_id = p_lodge_id
     and id = any(v_booking_ids)
     and nullif(btrim(invoice_number), '') is not null;

  v_counts := jsonb_build_object(
    'bookings', coalesce(array_length(v_booking_ids, 1), 0),
    'payments', (select count(*) from public.payments where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
    'booking_charges', (select count(*) from public.booking_charges where lodge_id = p_lodge_id and booking_id = any(v_booking_ids)),
    'invoices', (
      select count(*)
        from public.invoices
       where lodge_id = p_lodge_id
         and (
           booking_id = any(v_booking_ids)
           or (array_length(v_invoice_numbers, 1) > 0 and invoice_number = any(v_invoice_numbers))
         )
    ),
    'customers', coalesce(array_length(v_customer_ids, 1), 0),
    'quotations', (select count(*) from public.quotations where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
    'expenses', (select count(*) from public.expenses where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff or coalesce(date::timestamptz, now()) >= v_cutoff)),
    'pos_orders', (select count(*) from public.pos_orders where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
    'maintenance_tickets', (select count(*) from public.maintenance_tickets where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
    'conference_bookings', (select count(*) from public.conference_bookings where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff)),
    'pool_day_use', (select count(*) from public.pool_day_use where lodge_id = p_lodge_id and (v_mode = 'full_demo_reset' or coalesce(created_at, now()) >= v_cutoff))
  );

  delete from public.booking_charges where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.payments where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.invoice_delivery_log
   where lodge_id = p_lodge_id
     and (
       booking_id = any(v_booking_ids)
       or (array_length(v_invoice_numbers, 1) > 0 and invoice_number = any(v_invoice_numbers))
     );
  delete from public.invoices
   where lodge_id = p_lodge_id
     and (
       booking_id = any(v_booking_ids)
       or (array_length(v_invoice_numbers, 1) > 0 and invoice_number = any(v_invoice_numbers))
     );
  delete from public.refund_approval_log where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.financial_audit_log where lodge_id = p_lodge_id and booking_id = any(v_booking_ids);
  delete from public.bookings where lodge_id = p_lodge_id and id = any(v_booking_ids);

  if v_mode = 'full_demo_reset' then
    delete from public.quotations where lodge_id = p_lodge_id;
    delete from public.expenses where lodge_id = p_lodge_id;
    delete from public.pos_orders where lodge_id = p_lodge_id;
    delete from public.maintenance_tickets where lodge_id = p_lodge_id;
    delete from public.conference_bookings where lodge_id = p_lodge_id;
    delete from public.pool_day_use where lodge_id = p_lodge_id;
  else
    delete from public.quotations where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
    delete from public.expenses where lodge_id = p_lodge_id and (coalesce(created_at, now()) >= v_cutoff or coalesce(date::timestamptz, now()) >= v_cutoff);
    delete from public.pos_orders where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
    delete from public.maintenance_tickets where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
    delete from public.conference_bookings where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
    delete from public.pool_day_use where lodge_id = p_lodge_id and coalesce(created_at, now()) >= v_cutoff;
  end if;

  delete from public.customers
   where lodge_id = p_lodge_id
     and id = any(v_customer_ids)
     and not exists (
       select 1 from public.bookings b
        where b.lodge_id = p_lodge_id
          and b.customer_id = public.customers.id
     );

  insert into public.test_data_reset_audit (
    lodge_id,
    triggered_by,
    reset_mode,
    reason,
    deleted_counts
  ) values (
    p_lodge_id,
    p_triggered_by,
    v_mode,
    nullif(p_reason, ''),
    v_counts
  );

  return jsonb_build_object(
    'success', true,
    'mode', v_mode,
    'deleted_counts', v_counts
  );
end;
$$;


--
-- Name: resolve_maintenance_ticket(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resolve_maintenance_ticket(p_id text, p_lodge_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  has_status boolean;
  has_resolved_at boolean;
  assignments text[] := array[]::text[];
  v_updated text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'status'
  ) into has_status;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'resolved_at'
  ) into has_resolved_at;

  if has_status then
    assignments := array_append(assignments, 'status = ''resolved''');
  end if;

  if has_resolved_at then
    assignments := array_append(assignments, format('resolved_at = %L', now()));
  end if;

  if coalesce(array_length(assignments, 1), 0) = 0 then
    return jsonb_build_object('success', false, 'error', 'No maintenance resolution columns available');
  end if;

  execute format(
    'update public.maintenance_tickets set %s where id::text = %L and lodge_id::text = %L returning id::text',
    array_to_string(assignments, ', '),
    p_id,
    p_lodge_id
  )
  into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Maintenance ticket not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: return_room_supply_to_store(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.return_room_supply_to_store(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_unit_cost numeric := 0;
  v_new_room numeric;
  v_new_store numeric;
begin
  if v_qty <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  end if;

  select latest_unit_cost
    into v_unit_cost
    from public.supply_items
   where id = v_item_id
     and lodge_id = v_lodge_id;

  update public.room_supply_room_stock
     set quantity_on_hand = greatest(0, coalesce(quantity_on_hand, 0) - v_qty),
         last_moved_at = now(),
         updated_at = now()
   where lodge_id = v_lodge_id
     and room_id = v_room_id
     and supply_item_id = v_item_id
     and coalesce(quantity_on_hand, 0) >= v_qty
  returning quantity_on_hand into v_new_room;

  if v_new_room is null then
    return jsonb_build_object('success', false, 'error', 'Not enough stock is loaded in this room');
  end if;

  update public.supply_items
     set current_stock = coalesce(current_stock, 0) + v_qty
   where id = v_item_id
     and lodge_id = v_lodge_id
  returning current_stock into v_new_store;

  if v_new_store is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  insert into public.room_supply_movements (
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    v_lodge_id,
    v_room_id,
    v_item_id,
    'return',
    v_qty,
    coalesce(v_unit_cost, 0),
    v_qty * coalesce(v_unit_cost, 0),
    v_notes
  );

  return jsonb_build_object(
    'success', true,
    'new_room_stock', v_new_room,
    'new_store_stock', v_new_store
  );
end;
$$;


--
-- Name: revoke_app_session(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.revoke_app_session(p_session_token text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_hash text := public.app_hash_token(public.app_request_session_token(p_session_token));
begin
  if v_hash is null then
    return jsonb_build_object('success', true, 'revoked', false);
  end if;

  update public.app_sessions
  set revoked_at = now()
  where token_hash = v_hash
    and revoked_at is null;

  return jsonb_build_object('success', true, 'revoked', found);
end;
$$;


--
-- Name: room_booking_expected_total(uuid, uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.room_booking_expected_total(p_lodge_id uuid, p_room_id uuid, p_check_in date, p_check_out date) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_rate numeric;
begin
  if p_room_id is null or p_check_in is null or p_check_out is null or p_check_out <= p_check_in then
    return null;
  end if;

  select rate_per_night
    into v_rate
    from public.rooms
   where id = p_room_id
     and lodge_id = p_lodge_id
   limit 1;

  if not found then
    return null;
  end if;

  return round((coalesce(v_rate, 0) * (p_check_out - p_check_in))::numeric, 2);
end;
$$;


--
-- Name: run_financial_reconciliation_snapshot(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_financial_reconciliation_snapshot(p_lodge_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_inserted integer := 0;
begin
  with scoped_lodges as (
    select s.lodge_id
      from public.settings s
     where coalesce(s.deleted, false) = false
       and (p_lodge_id is null or s.lodge_id = p_lodge_id)
  ),
  payment_totals as (
    select b.lodge_id, b.id as booking_id, round(coalesce(sum(p.amount), 0)::numeric, 2) as ledger_amount
      from public.bookings b
      left join public.payments p
        on p.booking_id = b.id
       and p.lodge_id = b.lodge_id
     where b.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(b.status, '')) <> 'cancelled'
     group by b.lodge_id, b.id
  ),
  charge_totals as (
    select b.lodge_id, b.id as booking_id, round(coalesce(sum(case when c.voided_at is null then c.amount else 0 end), 0)::numeric, 2) as ledger_amount
      from public.bookings b
      left join public.booking_charges c
        on c.booking_id = b.id
       and c.lodge_id = b.lodge_id
     where b.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(b.status, '')) <> 'cancelled'
     group by b.lodge_id, b.id
  ),
  invoice_gaps as (
    select b.lodge_id, count(*)::int as issue_count
      from public.bookings b
      left join public.invoices i
        on i.booking_id = b.id
       and i.lodge_id = b.lodge_id
     where b.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(b.status, '')) <> 'cancelled'
       and (
         nullif(btrim(coalesce(b.invoice_number, '')), '') is null
         or i.id is null
       )
     group by b.lodge_id
  ),
  orphan_invoices as (
    select i.lodge_id, count(*)::int as issue_count
      from public.invoices i
      left join public.bookings b
        on b.id = i.booking_id
       and b.lodge_id = i.lodge_id
     where i.lodge_id in (select lodge_id from scoped_lodges)
       and (i.booking_id is null or b.id is null)
     group by i.lodge_id
  ),
  folio_pos_mismatches as (
    select o.lodge_id, count(*)::int as issue_count
      from public.pos_orders o
      left join public.booking_charges c
        on c.id = o.folio_charge_id
       and c.lodge_id = o.lodge_id
       and c.voided_at is null
     where o.lodge_id in (select lodge_id from scoped_lodges)
       and lower(coalesce(o.payment_method, '')) = 'folio'
       and lower(coalesce(o.status, '')) <> 'voided'
       and (
         o.booking_id is null
         or o.folio_charge_id is null
         or c.id is null
         or round(coalesce(o.total, 0)::numeric, 2) <> round(coalesce(c.amount, 0)::numeric, 2)
       )
     group by o.lodge_id
  ),
  summary_rows as (
    select
      l.lodge_id,
      coalesce(pm.issue_count, 0) as payment_mismatches,
      coalesce(cm.issue_count, 0) as charge_mismatches,
      coalesce(ig.issue_count, 0) as invoice_gaps,
      coalesce(oi.issue_count, 0) as orphan_invoices,
      coalesce(fp.issue_count, 0) as folio_pos_mismatches
    from scoped_lodges l
    left join (
      select p.lodge_id, count(*)::int as issue_count
        from payment_totals p
        join public.bookings b
          on b.id = p.booking_id
         and b.lodge_id = p.lodge_id
       where round(coalesce(b.amount_paid, 0)::numeric, 2) <> p.ledger_amount
       group by p.lodge_id
    ) pm on pm.lodge_id = l.lodge_id
    left join (
      select c.lodge_id, count(*)::int as issue_count
        from charge_totals c
        join public.bookings b
          on b.id = c.booking_id
         and b.lodge_id = c.lodge_id
       where round(coalesce(b.charges_total, 0)::numeric, 2) <> c.ledger_amount
       group by c.lodge_id
    ) cm on cm.lodge_id = l.lodge_id
    left join invoice_gaps ig on ig.lodge_id = l.lodge_id
    left join orphan_invoices oi on oi.lodge_id = l.lodge_id
    left join folio_pos_mismatches fp on fp.lodge_id = l.lodge_id
  )
  insert into public.financial_validation_alerts (
    lodge_id,
    alert_type,
    issue_count,
    summary
  )
  select
    lodge_id,
    'nightly_reconciliation',
    payment_mismatches + charge_mismatches + invoice_gaps + orphan_invoices + folio_pos_mismatches,
    jsonb_build_object(
      'payment_mismatches', payment_mismatches,
      'charge_mismatches', charge_mismatches,
      'invoice_gaps', invoice_gaps,
      'orphan_invoices', orphan_invoices,
      'folio_pos_mismatches', folio_pos_mismatches
    )
  from summary_rows
  where (payment_mismatches + charge_mismatches + invoice_gaps + orphan_invoices + folio_pos_mismatches) > 0;

  get diagnostics v_inserted = row_count;

  return jsonb_build_object('success', true, 'alerts_created', v_inserted);
end;
$$;


--
-- Name: save_inventory_stocktake_counts(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_inventory_stocktake_counts(p_stocktake_id uuid, p_lodge_id uuid, p_lines jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.inventory_stocktakes%rowtype;
  v_line jsonb;
begin
  select *
    into v_session
    from public.inventory_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Stock take session not found');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Only open stock takes can be updated');
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    update public.inventory_stocktake_lines
       set counted_qty = coalesce((v_line->>'counted_qty')::numeric, expected_qty),
           variance_qty = coalesce((v_line->>'counted_qty')::numeric, expected_qty) - expected_qty,
           variance_cost = (coalesce((v_line->>'counted_qty')::numeric, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
           notes = nullif(v_line->>'notes', ''),
           updated_at = now()
     where stocktake_id = p_stocktake_id
       and lodge_id = p_lodge_id
       and item_id = (v_line->>'item_id')::uuid;
  end loop;

  update public.inventory_stocktakes
     set counted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: save_room_supply_allocations(uuid, date, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_room_supply_allocations(p_lodge_id uuid, p_week_start date, p_allocations jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_row jsonb;
begin
  delete from public.room_supply_allocations
  where lodge_id = p_lodge_id
    and week_start = p_week_start;

  if p_allocations is not null and jsonb_typeof(p_allocations) = 'array' then
    for v_row in select * from jsonb_array_elements(p_allocations)
    loop
      insert into public.room_supply_allocations (
        lodge_id,
        supply_item_id,
        room_id,
        week_start,
        units_used,
        unit_cost,
        total_cost
      ) values (
        p_lodge_id,
        (v_row->>'supply_item_id')::uuid,
        (v_row->>'room_id')::uuid,
        p_week_start,
        coalesce((v_row->>'units_used')::numeric, 0),
        coalesce((v_row->>'unit_cost')::numeric, 0),
        coalesce((v_row->>'total_cost')::numeric, 0)
      );
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: save_room_supply_stocktake_counts(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_room_supply_stocktake_counts(p_stocktake_id uuid, p_lodge_id uuid, p_lines jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.room_supply_stocktakes%rowtype;
  v_line jsonb;
begin
  select *
    into v_session
    from public.room_supply_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Room stock take session not found');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Only open room stock takes can be updated');
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    update public.room_supply_stocktake_lines
       set counted_qty = coalesce((v_line->>'counted_qty')::numeric, expected_qty),
           variance_qty = coalesce((v_line->>'counted_qty')::numeric, expected_qty) - expected_qty,
           variance_cost = (coalesce((v_line->>'counted_qty')::numeric, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
           notes = nullif(v_line->>'notes', ''),
           updated_at = now()
     where stocktake_id = p_stocktake_id
       and lodge_id = p_lodge_id
       and room_stock_id = (v_line->>'room_stock_id')::uuid;
  end loop;

  update public.room_supply_stocktakes
     set counted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: save_supply_stocktake_counts(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.save_supply_stocktake_counts(p_stocktake_id uuid, p_lodge_id uuid, p_lines jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.supply_stocktakes%rowtype;
  v_line jsonb;
begin
  select *
    into v_session
    from public.supply_stocktakes
   where id = p_stocktake_id
     and lodge_id = p_lodge_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Stock take session not found');
  end if;

  if v_session.status <> 'open' then
    return jsonb_build_object('success', false, 'error', 'Only open stock takes can be updated');
  end if;

  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    update public.supply_stocktake_lines
       set counted_qty = coalesce((v_line->>'counted_qty')::numeric, expected_qty),
           variance_qty = coalesce((v_line->>'counted_qty')::numeric, expected_qty) - expected_qty,
           variance_cost = (coalesce((v_line->>'counted_qty')::numeric, expected_qty) - expected_qty) * coalesce(unit_cost, 0),
           notes = nullif(v_line->>'notes', ''),
           updated_at = now()
     where stocktake_id = p_stocktake_id
       and lodge_id = p_lodge_id
       and item_id = (v_line->>'item_id')::uuid;
  end loop;

  update public.supply_stocktakes
     set counted_at = now(),
         updated_at = now()
   where id = p_stocktake_id
     and lodge_id = p_lodge_id;

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: set_bar_pos_pack_template(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_bar_pos_pack_template(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_inventory_item_id uuid := nullif(payload->>'inventory_item_id', '')::uuid;
  v_pack_size integer := coalesce((payload->>'pack_size')::integer, 0);
  v_enabled boolean := coalesce((payload->>'enabled')::boolean, false);
  v_item record;
  v_existing uuid;
begin
  perform public.app_require_lodge_role(v_lodge_id, array['manager', 'admin', 'super_admin']);

  if v_pack_size not in (6, 12, 24) then
    return jsonb_build_object('success', false, 'error', 'Only 6-pack, 12-pack, and case-24 templates are supported.');
  end if;

  select
    ii.id,
    ii.name,
    ii.selling_price,
    ii.outlet_id,
    o.type as outlet_type
  into v_item
  from public.inventory_items ii
  left join public.outlets o
    on o.id = ii.outlet_id
  where ii.id = v_inventory_item_id
    and ii.lodge_id = v_lodge_id
  limit 1;

  if v_item.id is null then
    return jsonb_build_object('success', false, 'error', 'Bar inventory product not found.');
  end if;

  if coalesce(v_item.outlet_type, '') <> 'beverage' then
    return jsonb_build_object('success', false, 'error', 'Pack templates are only available for Bar inventory products.');
  end if;

  if coalesce(v_item.selling_price, 0) <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a bottle selling price before enabling pack templates.');
  end if;

  if not exists (
    select 1
      from public.pos_menu_items
     where lodge_id = v_lodge_id
       and inventory_item_id = v_inventory_item_id
       and template_kind = 'bar_single'
  ) then
    perform public.sync_inventory_item_to_pos(v_inventory_item_id, v_lodge_id);
  end if;

  select id
    into v_existing
    from public.pos_menu_items
   where lodge_id = v_lodge_id
     and inventory_item_id = v_inventory_item_id
     and template_kind = 'bar_pack'
     and template_pack_size = v_pack_size
   limit 1;

  if v_enabled then
    if v_existing is null then
      insert into public.pos_menu_items (
        lodge_id,
        name,
        category,
        price,
        is_available,
        inventory_item_id,
        depletion_qty,
        outlet_id,
        auto_from_inventory,
        template_kind,
        template_pack_size
      ) values (
        v_lodge_id,
        case v_pack_size
          when 6 then v_item.name || ' 6 Pack'
          when 12 then v_item.name || ' 12 Pack'
          else v_item.name || ' Case (24)'
        end,
        'Drinks',
        coalesce(v_item.selling_price, 0) * v_pack_size,
        true,
        v_inventory_item_id,
        v_pack_size,
        v_item.outlet_id,
        true,
        'bar_pack',
        v_pack_size
      );
    else
      update public.pos_menu_items
         set name = case v_pack_size
                      when 6 then v_item.name || ' 6 Pack'
                      when 12 then v_item.name || ' 12 Pack'
                      else v_item.name || ' Case (24)'
                    end,
             category = 'Drinks',
             price = coalesce(v_item.selling_price, 0) * v_pack_size,
             is_available = true,
             inventory_item_id = v_inventory_item_id,
             depletion_qty = v_pack_size,
             outlet_id = v_item.outlet_id,
             auto_from_inventory = true
       where id = v_existing;
    end if;
  else
    delete from public.pos_menu_items
     where lodge_id = v_lodge_id
       and inventory_item_id = v_inventory_item_id
       and template_kind = 'bar_pack'
       and template_pack_size = v_pack_size;
  end if;

  perform public.sync_inventory_item_to_pos(v_inventory_item_id, v_lodge_id);

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: set_booking_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_booking_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.booking_number is null then
    new.booking_number = 'BK-' || lpad(nextval('booking_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;


--
-- Name: set_room_status(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_room_status(p_id uuid, p_lodge_id uuid, p_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.rooms
  set status = p_status
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: set_subscription_feature_override(uuid, text, boolean, text, timestamp with time zone, timestamp with time zone, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_subscription_feature_override(p_lodge_id uuid, p_feature_name text, p_enabled boolean, p_reason text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_review_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_granted_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_existing public.lodge_features%rowtype;
begin
  select * into v_existing
  from public.lodge_features
  where lodge_id = p_lodge_id
    and feature_name = p_feature_name
  limit 1;

  insert into public.lodge_features (
    lodge_id, feature_name, enabled, updated_at, reason,
    expires_at, review_at, granted_by, granted_at
  ) values (
    p_lodge_id, p_feature_name, coalesce(p_enabled, true), now(),
    nullif(btrim(coalesce(p_reason, '')), ''), p_expires_at, p_review_at,
    p_granted_by, coalesce(v_existing.granted_at, now())
  )
  on conflict (lodge_id, feature_name)
  do update set
    enabled = excluded.enabled,
    updated_at = now(),
    reason = excluded.reason,
    expires_at = excluded.expires_at,
    review_at = excluded.review_at,
    granted_by = excluded.granted_by,
    granted_at = coalesce(public.lodge_features.granted_at, excluded.granted_at);

  perform public._record_subscription_event(
    p_lodge_id, p_lodge_id::text, null, null,
    'feature_override_set', 'completed', null, null,
    jsonb_build_object('feature_name', p_feature_name, 'enabled', coalesce(p_enabled, true), 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'expires_at', p_expires_at, 'review_at', p_review_at)
  );

  return jsonb_build_object('success', true);
end;
$$;


--
-- Name: set_user_password(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_password(p_id uuid, p_lodge_id uuid, p_password_hash text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager']);
  update public.users set password_hash = p_password_hash where id = p_id and lodge_id = p_lodge_id returning id into v_updated;
  if v_updated is null then return jsonb_build_object('success', false, 'error', 'User not found'); end if;
  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: set_user_pwa_access(uuid, uuid, boolean, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_user_pwa_access(p_id uuid, p_lodge_id uuid, p_enabled boolean, p_password_hash text DEFAULT NULL::text, p_disabled_reason text DEFAULT NULL::text, p_reset_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_user public.users%rowtype;
  v_password_hash text := nullif(btrim(coalesce(p_password_hash, '')), '');
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager']);
  select * into v_user from public.users where id = p_id and lodge_id = p_lodge_id limit 1 for update;
  if v_user.id is null then return jsonb_build_object('success', false, 'error', 'User not found'); end if;
  if not public._is_pwa_role_eligible(v_user.role) then return jsonb_build_object('success', false, 'error', 'Only manager and admin roles can receive Manager PWA access.'); end if;
  if p_enabled and coalesce(v_password_hash, nullif(btrim(coalesce(v_user.pwa_password_hash, '')), '')) is null then return jsonb_build_object('success', false, 'error', 'Set a separate Manager PWA password before enabling mobile access.'); end if;
  update public.users
  set
    pwa_enabled = p_enabled,
    pwa_password_hash = case when v_password_hash is not null then v_password_hash else pwa_password_hash end,
    pwa_password_set_at = case when v_password_hash is not null then now() else pwa_password_set_at end,
    pwa_password_reset_by = case when v_password_hash is not null then p_reset_by else pwa_password_reset_by end,
    pwa_disabled_reason = case when p_enabled then null else coalesce(nullif(btrim(coalesce(p_disabled_reason, '')), ''), 'Manager PWA access disabled.') end
  where id = p_id and lodge_id = p_lodge_id;
  return jsonb_build_object('success', true, 'id', p_id, 'pwa_enabled', p_enabled);
end;
$$;


--
-- Name: sync_booking_charges_total(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_booking_charges_total() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking_id uuid;
  v_new_charges numeric;
begin
  v_booking_id := case
    when tg_op = 'DELETE' then old.booking_id
    else new.booking_id
  end;

  select greatest(0, coalesce(sum(amount), 0))
    into v_new_charges
  from public.booking_charges
  where booking_id = v_booking_id
    and voided_at is null;

  update public.bookings
     set charges_total = v_new_charges,
         payment_status = public.compute_payment_status(
           coalesce(amount_paid, 0),
           coalesce(total_amount, 0),
           v_new_charges
         ),
         updated_at = now()
   where id = v_booking_id;

  return coalesce(new, old);
end;
$$;


--
-- Name: sync_inventory_item_to_pos(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_inventory_item_to_pos(p_inventory_id uuid, p_lodge_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item record;
  v_rows_updated integer := 0;
begin
  select
    ii.id,
    ii.lodge_id,
    ii.name,
    ii.selling_price,
    ii.outlet_id,
    o.type as outlet_type
  into v_item
  from public.inventory_items ii
  left join public.outlets o
    on o.id = ii.outlet_id
  where ii.id = p_inventory_id
    and ii.lodge_id = p_lodge_id
  limit 1;

  if v_item.id is null
     or v_item.outlet_id is null
     or coalesce(v_item.outlet_type, '') <> 'beverage'
     or coalesce(v_item.selling_price, 0) <= 0 then
    delete from public.pos_menu_items
     where lodge_id = p_lodge_id
       and inventory_item_id = p_inventory_id
       and auto_from_inventory = true;
    return;
  end if;

  update public.pos_menu_items
     set name = v_item.name,
         category = 'Drinks',
         price = coalesce(v_item.selling_price, 0),
         is_available = true,
         inventory_item_id = p_inventory_id,
         depletion_qty = 1,
         outlet_id = v_item.outlet_id,
         template_kind = 'bar_single',
         template_pack_size = null
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and template_kind = 'bar_single'
     and auto_from_inventory = true;

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    insert into public.pos_menu_items (
      lodge_id,
      name,
      category,
      price,
      is_available,
      inventory_item_id,
      depletion_qty,
      outlet_id,
      auto_from_inventory,
      template_kind,
      template_pack_size
    ) values (
      p_lodge_id,
      v_item.name,
      'Drinks',
      coalesce(v_item.selling_price, 0),
      true,
      p_inventory_id,
      1,
      v_item.outlet_id,
      true,
      'bar_single',
      null
    );
  end if;

  update public.pos_menu_items
     set name = case template_pack_size
                  when 6 then v_item.name || ' 6 Pack'
                  when 12 then v_item.name || ' 12 Pack'
                  when 24 then v_item.name || ' Case (24)'
                  else v_item.name
                end,
         category = 'Drinks',
         price = coalesce(v_item.selling_price, 0) * coalesce(template_pack_size, 1),
         is_available = true,
         inventory_item_id = p_inventory_id,
         depletion_qty = coalesce(template_pack_size, 1),
         outlet_id = v_item.outlet_id,
         auto_from_inventory = true
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and template_kind = 'bar_pack';

  delete from public.pos_menu_items
   where lodge_id = p_lodge_id
     and inventory_item_id = p_inventory_id
     and template_kind = 'standard'
     and auto_from_inventory = true;
end;
$$;


--
-- Name: sync_room_maintenance_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_room_maintenance_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
begin
  -- If a room is linked to this ticket...
  if coalesce(new.room_id, old.room_id) is not null then
    -- If there are ANY open tickets for this room, set status to maintenance
    if exists (
      select 1 
      from public.maintenance_tickets 
      where room_id = coalesce(new.room_id, old.room_id)
        and lodge_id = coalesce(new.lodge_id, old.lodge_id)
        and status != 'resolved'
    ) then
      update public.rooms 
         set status = 'maintenance' 
       where id::text = coalesce(new.room_id, old.room_id)::text 
         and lodge_id::text = coalesce(new.lodge_id, old.lodge_id)::text;
    else
      -- If no open tickets remain, set it to available (or it will be updated by bookings)
      update public.rooms 
         set status = 'available' 
       where id::text = coalesce(new.room_id, old.room_id)::text 
         and lodge_id::text = coalesce(new.lodge_id, old.lodge_id)::text 
         and status = 'maintenance';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;


--
-- Name: test_mode_enabled_for_lodge(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.test_mode_enabled_for_lodge(p_lodge_id uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
      from public.lodge_features lf
     where lf.lodge_id = p_lodge_id
       and lf.feature_name = 'test_mode_enabled'
       and lf.enabled = true
       and coalesce(lf.expires_at, now() + interval '100 years') > now()
  );
$$;


--
-- Name: transition_booking_status(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.transition_booking_status(p_booking_id uuid, p_lodge_id uuid, p_status text) RETURNS TABLE(booking_id uuid, room_id uuid, booking_status text, room_status text, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking bookings%rowtype;
  v_room_status text;
  v_now timestamptz := now();
begin
  -- Validate allowed statuses
  if p_status not in ('confirmed', 'checked_in', 'checked_out', 'cancelled') then
    raise exception 'Unsupported booking status: %', p_status;
  end if;

  -- Lock booking row
  select *
  into v_booking
  from bookings
  where id = p_booking_id
    and lodge_id = p_lodge_id
  for update;

  if not found then
    raise exception 'Booking % was not found for lodge %', p_booking_id, p_lodge_id;
  end if;

  -- Decide room state
  v_room_status := case
    when p_status = 'checked_in' then 'occupied'
    when p_status in ('checked_out', 'cancelled') then 'available'
    else null
  end;

  -- Update booking
  update bookings
  set status = p_status,
      updated_at = v_now
  where id = p_booking_id
    and lodge_id = p_lodge_id
  returning * into v_booking;

  -- Update room if needed
  if v_room_status is not null and v_booking.room_id is not null then
    update rooms
    set status = v_room_status
    where id = v_booking.room_id
      and lodge_id = p_lodge_id;
  end if;

  -- Return result safely
  return query
  select
    v_booking.id,
    v_booking.room_id,
    v_booking.status,
    case 
      when v_booking.room_id is not null then
        coalesce(v_room_status, (
          select r.status 
          from rooms r 
          where r.id = v_booking.room_id 
            and r.lodge_id = p_lodge_id
        ))
      else null
    end,
    v_now;

end;
$$;


--
-- Name: undo_import_batch(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.undo_import_batch(p_batch_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_batch record;
  v_deleted_bookings int;
  v_deleted_customers int;
begin
  select *
    into v_batch
    from public.import_batches
   where id = p_batch_id
     and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Import batch not found');
  end if;

  if exists (
    select 1
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where b.import_batch_id = p_batch_id
       and b.lodge_id = p_lodge_id
  ) then
    return jsonb_build_object(
      'success', false,
      'error', 'This import batch includes bookings with recorded payments and cannot be undone automatically.'
    );
  end if;

  delete from public.invoices i
   using public.bookings b
   where i.booking_id = b.id
     and b.import_batch_id = p_batch_id
     and b.lodge_id = p_lodge_id;

  delete from public.bookings
   where import_batch_id = p_batch_id
     and lodge_id = p_lodge_id;
  get diagnostics v_deleted_bookings = row_count;

  delete from public.customers c
   where c.import_batch_id = p_batch_id
     and c.lodge_id = p_lodge_id
     and not exists (
       select 1
         from public.bookings b
        where b.customer_id = c.id
     );
  get diagnostics v_deleted_customers = row_count;

  delete from public.import_batches
   where id = p_batch_id;

  return jsonb_build_object(
    'success', true,
    'deleted_bookings', v_deleted_bookings,
    'deleted_customers', v_deleted_customers
  );
end;
$$;


--
-- Name: update_booking(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_booking(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_current public.bookings%rowtype;
  v_room_id uuid;
  v_check_in date;
  v_check_out date;
  v_new_total numeric;
  v_new_status text;
  v_conflict uuid;
  v_total_owed numeric;
  v_allow_total_override boolean := coalesce((payload->>'allow_total_override')::boolean, false);
  v_expected_total numeric;
  v_total_relevant_changed boolean := (payload ? 'total_amount') or (payload ? 'room_id') or (payload ? 'check_in') or (payload ? 'check_out');
  v_expected_updated_at timestamptz := nullif(payload->>'expected_updated_at', '')::timestamptz;
  v_next_updated_at timestamptz := coalesce(nullif(payload->>'updated_at', '')::timestamptz, now());
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_current
    from public.bookings
   where id::text = p_id::text
     and lodge_id::text = p_lodge_id::text
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if v_expected_updated_at is not null and v_current.updated_at is distinct from v_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was modified on another device. Refresh and try again.',
      'code', 'BOOKING_CONFLICT',
      'current_updated_at', v_current.updated_at
    );
  end if;

  v_room_id := coalesce((payload->>'room_id')::uuid, v_current.room_id);
  v_check_in := coalesce((payload->>'check_in')::date, v_current.check_in);
  v_check_out := coalesce((payload->>'check_out')::date, v_current.check_out);

  -- NEW: Maintenance Check (if changing room or extending stay in a broken room)
  if v_room_id is distinct from v_current.room_id then
    perform public.app_check_room_maintenance(p_lodge_id, v_room_id);
  end if;

  v_new_total := round((
    case
      when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0)
      else v_current.total_amount
    end
  )::numeric, 2);

  if v_new_total < 0 then
    return jsonb_build_object('success', false, 'error', 'Booking total cannot be negative');
  end if;

  if (payload ? 'adults') or (payload ? 'children') or (payload ? 'room_id') then
    declare
      v_new_adults int := case when payload ? 'adults' then coalesce((payload->>'adults')::int, 1) else v_current.adults end;
      v_new_children int := case when payload ? 'children' then coalesce((payload->>'children')::int, 0) else v_current.children end;
      v_max_occ int;
    begin
      select r.max_occupancy into v_max_occ
        from public.rooms r
       where r.id = v_room_id
         and r.lodge_id = p_lodge_id;
      if v_max_occ is not null and (v_new_adults + v_new_children) > v_max_occ then
        return jsonb_build_object('success', false, 'error', 'Number of guests exceeds room maximum occupancy');
      end if;
    end;
  end if;

  if v_total_relevant_changed and not coalesce(v_current.is_exclusive_event, false) then
    v_expected_total := public.room_booking_expected_total(p_lodge_id, v_room_id, v_check_in, v_check_out);
    if v_expected_total is null then
      return jsonb_build_object('success', false, 'error', 'Invalid room or stay dates');
    end if;

    if abs(v_new_total - v_expected_total) > 0.01 then
      if v_allow_total_override then
        perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);
      else
        return jsonb_build_object(
          'success', false,
          'error', format(
            'Booking total must match the room rate for this stay. Expected %s, received %s.',
            v_expected_total,
            v_new_total
          )
        );
      end if;
    end if;
  end if;

  v_total_owed := v_new_total + coalesce(v_current.charges_total, 0);
  if v_total_owed < coalesce(v_current.amount_paid, 0) then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Cannot reduce booking total to %s: guest has already paid %s. Record a refund first, then adjust the total.',
        round(v_new_total::numeric, 2),
        round(coalesce(v_current.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  select b.id
    into v_conflict
    from public.bookings b
    where b.lodge_id::text = p_lodge_id::text
      and b.room_id::text = v_room_id::text
     and b.id <> p_id
     and b.status <> 'cancelled'
     and not (b.check_out <= v_check_in or b.check_in >= v_check_out)
   limit 1;

  if v_conflict is not null then
    return jsonb_build_object('success', false, 'error', 'Room is already booked for these dates');
  end if;

  v_new_status := public.compute_payment_status(
    coalesce(v_current.amount_paid, 0),
    v_new_total,
    coalesce(v_current.charges_total, 0)
  );

  update public.bookings
     set customer_id = coalesce((payload->>'customer_id')::uuid, customer_id),
         room_id = v_room_id,
         check_in = v_check_in,
         check_out = v_check_out,
         adults = case when payload ? 'adults' then coalesce((payload->>'adults')::int, 1) else adults end,
         children = case when payload ? 'children' then coalesce((payload->>'children')::int, 0) else children end,
         total_amount = v_new_total,
         payment_status = v_new_status,
         notes = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         updated_at = v_next_updated_at
   where id::text = p_id::text
     and lodge_id::text = p_lodge_id::text;

  return jsonb_build_object('success', true, 'id', p_id, 'payment_status', v_new_status);
end;
$$;


--
-- Name: update_booking(uuid, uuid, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_booking(p_id uuid, p_lodge_id uuid, payload jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return public.update_booking(
    p_id,
    p_lodge_id,
    case
      when p_expected_updated_at is null then coalesce(payload, '{}'::jsonb)
      else coalesce(payload, '{}'::jsonb) || jsonb_build_object('expected_updated_at', p_expected_updated_at)
    end
  );
end;
$$;


--
-- Name: update_booking_payment(uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_booking_payment(p_booking_id uuid, p_lodge_id uuid, p_amount numeric, p_method text) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_booking bookings%ROWTYPE;
  v_new_paid NUMERIC;
  v_status TEXT;
BEGIN
  -- Row-level lock for atomic concurrent updates
  SELECT * INTO v_booking FROM bookings
    WHERE id = p_booking_id AND lodge_id = p_lodge_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- Add the new payment amount (delta)
  v_new_paid := COALESCE(v_booking.amount_paid, 0) + p_amount;
  
  -- Calculate new payment_status
  v_status := CASE
    WHEN v_new_paid >= v_booking.total_amount THEN 'paid'
    WHEN v_new_paid > 0 THEN 'partial'
    ELSE 'unpaid'
  END;

  -- Update atomic row
  UPDATE bookings SET
    amount_paid = v_new_paid,
    payment_status = v_status,
    payment_method = COALESCE(p_method, payment_method),
    updated_at = NOW()
  WHERE id = p_booking_id AND lodge_id = p_lodge_id;

  RETURN jsonb_build_object(
    'success', true, 
    'amount_paid', v_new_paid, 
    'payment_status', v_status
  );
END;
$$;


--
-- Name: update_booking_payment(uuid, uuid, numeric, text, text, text, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_booking_payment(p_booking_id uuid, p_lodge_id uuid, p_amount numeric, p_method text, p_type text DEFAULT 'payment'::text, p_idempotency_key text DEFAULT NULL::text, p_recorded_by uuid DEFAULT NULL::uuid, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking public.bookings%rowtype;
  v_new_paid numeric;
  v_total_owed numeric;
  v_status text;
  v_actor uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['receptionist', 'finance', 'manager', 'admin', 'super_admin']);

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record a payment.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Payment idempotency key is required');
  end if;

  select *
    into v_booking
    from public.bookings
   where id = p_booking_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_expected_updated_at is not null and v_booking.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'amount_paid', coalesce(v_booking.amount_paid, 0),
      'payment_status', coalesce(v_booking.payment_status, 'unpaid'),
      'idempotent', true
    );
  end if;

  v_new_paid := round((coalesce(v_booking.amount_paid, 0) + p_amount)::numeric, 2);
  v_total_owed := round((coalesce(v_booking.total_amount, 0) + coalesce(v_booking.charges_total, 0))::numeric, 2);

  if v_new_paid < 0 then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Adjustment of %s would reduce amount paid below zero (current: %s). Use the refund flow to reduce a guest''s paid balance.',
        round(p_amount::numeric, 2),
        round(coalesce(v_booking.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  if p_amount > 0 and v_total_owed > 0 and v_new_paid > v_total_owed then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Payment of %s would overpay this booking. Total owed: %s, already paid: %s. Adjust the booking total first if a larger payment is intended.',
        round(p_amount::numeric, 2),
        v_total_owed,
        round(coalesce(v_booking.amount_paid, 0)::numeric, 2)
      )
    );
  end if;

  v_status := public.compute_payment_status(v_new_paid, v_booking.total_amount, v_booking.charges_total);

  update public.bookings
     set amount_paid = v_new_paid,
         payment_status = v_status,
         payment_method = coalesce(p_method, payment_method),
         updated_at = now()
   where id = p_booking_id
     and lodge_id = p_lodge_id;

  begin
    insert into public.payments (
      booking_id, lodge_id, amount, method, type,
      paid_at, recorded_by, idempotency_key
    ) values (
      p_booking_id, p_lodge_id, p_amount, p_method, p_type,
      now(), v_actor, p_idempotency_key
    );
  exception
    when unique_violation then
      select amount_paid, payment_status
        into v_new_paid, v_status
        from public.bookings
       where id = p_booking_id
         and lodge_id = p_lodge_id;
      return jsonb_build_object(
        'success', true,
        'amount_paid', coalesce(v_new_paid, 0),
        'payment_status', coalesce(v_status, 'unpaid'),
        'idempotent', true
      );
  end;

  return jsonb_build_object(
    'success', true,
    'amount_paid', v_new_paid,
    'payment_status', v_status
  );
end;
$$;


--
-- Name: update_booking_status(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_booking_status(p_id uuid, p_lodge_id uuid, p_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_current_status text;
  v_room_id uuid;
  v_allowed boolean := false;
  v_room_status text;
  v_total_amount numeric := 0;
  v_charges_total numeric := 0;
  v_amount_paid numeric := 0;
  v_outstanding numeric := 0;
begin
  perform public.app_reject_pwa_financial_mutation();

  select status, room_id, total_amount, coalesce(charges_total, 0), coalesce(amount_paid, 0)
    into v_current_status, v_room_id, v_total_amount, v_charges_total, v_amount_paid
    from public.bookings
   where id = p_id
     and lodge_id = p_lodge_id;

  if v_current_status is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  v_allowed :=
    p_status = v_current_status
    or (v_current_status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_current_status = 'confirmed' and p_status in ('checked_in', 'cancelled'))
    or (v_current_status = 'checked_in' and p_status in ('checked_out'));

  if not v_allowed then
    return jsonb_build_object('success', false, 'error', format('Cannot transition booking from %s to %s', v_current_status, p_status));
  end if;

  if p_status = 'checked_out' then
    v_outstanding := greatest(0, coalesce(v_total_amount, 0) + coalesce(v_charges_total, 0) - coalesce(v_amount_paid, 0));
    if v_outstanding > 0 then
      return jsonb_build_object(
        'success', false,
        'error', format('Cannot check out this guest until the full balance is paid. Outstanding balance: %s', round(v_outstanding::numeric, 2))
      );
    end if;
  end if;

  update public.bookings
     set status = p_status,
         updated_at = now()
   where id = p_id
     and lodge_id = p_lodge_id;

  v_room_status := case
    when p_status = 'checked_in' then 'occupied'
    when p_status in ('checked_out', 'cancelled') then 'available'
    else null
  end;

  if v_room_status is not null and v_room_id is not null then
    update public.rooms
       set status = v_room_status
     where id = v_room_id
       and lodge_id = p_lodge_id;
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'status', p_status);
end;
$$;


--
-- Name: update_booking_status(uuid, uuid, text, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_booking_status(p_id uuid, p_lodge_id uuid, p_status text, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_booking public.bookings%rowtype;
  v_allowed boolean := false;
  v_room_status text;
  v_outstanding numeric := 0;
begin
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_booking
    from public.bookings
    where id::text = p_id::text
      and lodge_id::text = p_lodge_id::text
   for update;

  if v_booking.id is null then
    return jsonb_build_object('success', false, 'error', 'Booking not found');
  end if;

  if p_expected_updated_at is not null and v_booking.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'This booking was updated on another device. Refresh the booking and try again.',
      'stale', true,
      'current_updated_at', v_booking.updated_at
    );
  end if;

  v_allowed :=
    p_status = v_booking.status
    or (v_booking.status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_booking.status = 'confirmed' and p_status in ('checked_in', 'cancelled'))
    or (v_booking.status = 'checked_in' and p_status in ('checked_out'));

  if not v_allowed then
    return jsonb_build_object(
      'success', false,
      'error', format('Cannot transition booking from %s to %s', v_booking.status, p_status)
    );
  end if;

  -- NEW: Maintenance Check for check-in
  if p_status = 'checked_in' then
    if v_booking.check_in > current_date then
      return jsonb_build_object(
        'success', false,
        'error', format('Cannot check in before the check-in date (%s).', v_booking.check_in)
      );
    end if;
    perform public.app_check_room_maintenance(p_lodge_id, v_booking.room_id);
  end if;

  if p_status = 'checked_out' then
    v_outstanding := greatest(
      0,
      coalesce(v_booking.total_amount, 0) + coalesce(v_booking.charges_total, 0) - coalesce(v_booking.amount_paid, 0)
    );
    if v_outstanding > 0 then
      return jsonb_build_object(
        'success', false,
        'error', format('Cannot check out this guest until the full balance is paid. Outstanding balance: %s', round(v_outstanding::numeric, 2))
      );
    end if;
  end if;

  update public.bookings
     set status = p_status,
         updated_at = now()
   where id::text = p_id::text
     and lodge_id::text = p_lodge_id::text;

  v_room_status := case
    when p_status = 'checked_in' then 'occupied'
    when p_status in ('checked_out', 'cancelled') then 'available'
    else null
  end;

  if v_room_status is not null and v_booking.room_id is not null then
    update public.rooms
       set status = v_room_status
     where id::text = v_booking.room_id::text
       and lodge_id::text = p_lodge_id::text;
  end if;

  return jsonb_build_object('success', true, 'id', p_id, 'status', p_status);
end;
$$;


--
-- Name: update_broadcast(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_broadcast(p_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.broadcasts
  set
    title = case when payload ? 'title' then payload->>'title' else title end,
    message = case when payload ? 'message' then payload->>'message' else message end,
    expires_at = case when payload ? 'expires_at' then nullif(payload->>'expires_at', '')::timestamptz else expires_at end,
    is_active = case when payload ? 'is_active' then coalesce((payload->>'is_active')::boolean, false) else is_active end
  where id = p_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Broadcast not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_conference_booking(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_conference_booking(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_current           public.conference_bookings%rowtype;
  v_updated           uuid;
  v_total_amount      numeric;
  v_deposit_paid      numeric;
  v_pay_status        text;
  v_financial_changed boolean;
begin
  perform public.app_reject_pwa_financial_mutation();

  select *
    into v_current
    from public.conference_bookings
   where id = p_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  v_total_amount := case
    when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0)
    else coalesce(v_current.total_amount, 0)
  end;
  v_deposit_paid := case
    when payload ? 'deposit_paid' then coalesce((payload->>'deposit_paid')::numeric, 0)
    else coalesce(v_current.deposit_paid, 0)
  end;

  if v_deposit_paid < 0 then
    return jsonb_build_object('success', false, 'error', 'Deposit paid cannot be negative.');
  end if;

  if v_total_amount > 0 and v_deposit_paid > v_total_amount then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Deposit paid (%s) cannot exceed total amount (%s).',
        round(v_deposit_paid::numeric, 2),
        round(v_total_amount::numeric, 2)
      )
    );
  end if;

  v_financial_changed := (payload ? 'total_amount') or (payload ? 'deposit_paid');
  v_pay_status := case
    when v_financial_changed
      then public.compute_conference_payment_status(v_deposit_paid, v_total_amount)
    else v_current.payment_status
  end;

  update public.conference_bookings
     set booking_date      = case when payload ? 'booking_date' then (payload->>'booking_date')::date else booking_date end,
         start_time        = case when payload ? 'start_time' then (payload->>'start_time')::time else start_time end,
         end_time          = case when payload ? 'end_time'   then (payload->>'end_time')::time   else end_time   end,
         client_name       = case when payload ? 'client_name' then payload->>'client_name' else client_name end,
         company           = case when payload ? 'company' then nullif(payload->>'company', '') else company end,
         attendees         = case when payload ? 'attendees' then coalesce((payload->>'attendees')::integer, 0) else attendees end,
         setup_type        = case when payload ? 'setup_type' then coalesce(payload->>'setup_type', 'Theatre') else setup_type end,
         room_name         = case when payload ? 'room_name' then coalesce(payload->>'room_name', 'Conference Room') else room_name end,
         includes_catering = case when payload ? 'includes_catering' then coalesce((payload->>'includes_catering')::boolean, false) else includes_catering end,
         catering_notes    = case when payload ? 'catering_notes' then nullif(payload->>'catering_notes', '') else catering_notes end,
         total_amount      = v_total_amount,
         deposit_paid      = v_deposit_paid,
         payment_status    = v_pay_status,
         payment_method    = case when payload ? 'payment_method' then nullif(payload->>'payment_method', '') else payment_method end,
         notes             = case when payload ? 'notes' then nullif(payload->>'notes', '') else notes end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated, 'payment_status', v_pay_status);
end;
$$;


--
-- Name: update_conference_booking_payment(uuid, uuid, numeric, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_conference_booking_payment(p_id uuid, p_lodge_id uuid, p_amount numeric, p_method text, p_type text DEFAULT 'payment'::text, p_idempotency_key text DEFAULT NULL::text, p_recorded_by uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_current    public.conference_bookings%rowtype;
  v_new_deposit numeric;
  v_new_status  text;
  v_actor       uuid := public.app_current_user_id();
begin
  perform public.app_reject_pwa_financial_mutation();

  if v_actor is null then
    return jsonb_build_object('success', false, 'error', 'An authenticated session is required to record a payment.');
  end if;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Payment idempotency key is required');
  end if;

  select *
    into v_current
    from public.conference_bookings
   where id = p_id
     and lodge_id = p_lodge_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Conference booking not found');
  end if;

  if exists (select 1 from public.payments where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'success', true,
      'deposit_paid', coalesce(v_current.deposit_paid, 0),
      'payment_status', coalesce(v_current.payment_status, 'pending'),
      'idempotent', true
    );
  end if;

  v_new_deposit := round((coalesce(v_current.deposit_paid, 0) + p_amount)::numeric, 2);

  if v_new_deposit < 0 then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Adjustment of %s would reduce deposit paid below zero (current: %s).',
        round(p_amount::numeric, 2),
        round(coalesce(v_current.deposit_paid, 0)::numeric, 2)
      )
    );
  end if;

  if v_new_deposit > coalesce(v_current.total_amount, 0) then
    return jsonb_build_object(
      'success', false,
      'error', format(
        'Payment of %s would overpay this conference booking. Total: %s, already deposited: %s.',
        round(p_amount::numeric, 2),
        coalesce(v_current.total_amount, 0),
        round(coalesce(v_current.deposit_paid, 0)::numeric, 2)
      )
    );
  end if;

  v_new_status := public.compute_conference_payment_status(v_new_deposit, v_current.total_amount);

  update public.conference_bookings
     set deposit_paid = v_new_deposit,
         payment_status = v_new_status,
         payment_method = coalesce(p_method, payment_method)
   where id = p_id
     and lodge_id = p_lodge_id;

  begin
    insert into public.payments (
      conference_booking_id, lodge_id, amount, method, type,
      paid_at, recorded_by, idempotency_key
    ) values (
      p_id, p_lodge_id, p_amount, p_method, p_type,
      now(), v_actor, p_idempotency_key
    );
  exception
    when unique_violation then
      select deposit_paid, payment_status
        into v_new_deposit, v_new_status
        from public.conference_bookings
       where id = p_id
         and lodge_id = p_lodge_id;
      return jsonb_build_object(
        'success', true,
        'deposit_paid', coalesce(v_new_deposit, 0),
        'payment_status', coalesce(v_new_status, 'pending'),
        'idempotent', true
      );
  end;

  return jsonb_build_object(
    'success', true,
    'deposit_paid', v_new_deposit,
    'payment_status', v_new_status
  );
end;
$$;


--
-- Name: update_customer(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customer(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.customers
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    email = case when payload ? 'email' then coalesce(payload->>'email', '') else email end,
    phone = case when payload ? 'phone' then coalesce(payload->>'phone', '') else phone end,
    id_number = case when payload ? 'id_number' then coalesce(payload->>'id_number', '') else id_number end,
    nationality = case when payload ? 'nationality' then coalesce(payload->>'nationality', '') else nationality end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_customer(uuid, uuid, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customer(p_id uuid, p_lodge_id uuid, payload jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.customers
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    email = case when payload ? 'email' then coalesce(payload->>'email', '') else email end,
    phone = case when payload ? 'phone' then coalesce(payload->>'phone', '') else phone end,
    id_number = case when payload ? 'id_number' then coalesce(payload->>'id_number', '') else id_number end,
    nationality = case when payload ? 'nationality' then coalesce(payload->>'nationality', '') else nationality end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_customer_blacklist(uuid, uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customer_blacklist(p_id uuid, p_lodge_id uuid, p_is_blacklisted boolean, p_reason text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.customers
  set
    is_blacklisted = coalesce(p_is_blacklisted, false),
    blacklist_reason = case when coalesce(p_is_blacklisted, false) then coalesce(p_reason, '') else '' end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_customer_id_photo(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_customer_id_photo(p_id uuid, p_lodge_id uuid, p_photo text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.customers
  set id_photo = p_photo
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Customer not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_expense(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_expense(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
  v_amount numeric;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if payload ? 'amount' then
    v_amount := coalesce((payload->>'amount')::numeric, 0);
    if v_amount <= 0 or v_amount > 999999.99 then
      raise exception 'Expense amount must be between P0.01 and P999,999.99';
    end if;
  end if;

  update public.expenses
  set
    date        = case when payload ? 'date'        then (payload->>'date')::date                    else date        end,
    category    = case when payload ? 'category'    then payload->>'category'                        else category    end,
    description = case when payload ? 'description' then payload->>'description'                     else description end,
    amount      = case when payload ? 'amount'      then v_amount                                     else amount      end,
    outlet_id   = case when payload ? 'outlet_id'   then nullif(payload->>'outlet_id', '')::uuid    else outlet_id   end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Expense not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_inventory_item(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_inventory_item(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
  v_current_outlet_id uuid;
  v_effective_outlet_id uuid;
  v_effective_selling_price numeric;
  v_outlet_type text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select outlet_id, selling_price
    into v_current_outlet_id, v_effective_selling_price
    from public.inventory_items
   where id = p_id
     and lodge_id = p_lodge_id
   limit 1;

  if v_effective_selling_price is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  v_effective_outlet_id := case
    when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid
    else v_current_outlet_id
  end;

  v_effective_selling_price := case
    when payload ? 'selling_price' then coalesce((payload->>'selling_price')::numeric, 0)
    else v_effective_selling_price
  end;

  if v_effective_outlet_id is not null then
    select type
      into v_outlet_type
      from public.outlets
     where id = v_effective_outlet_id
       and lodge_id = p_lodge_id
     limit 1;

    if v_outlet_type is null then
      return jsonb_build_object('success', false, 'error', 'Selected outlet was not found.');
    end if;
  end if;

  if coalesce(v_outlet_type, '') = 'beverage'
     and v_effective_selling_price <= 0 then
    return jsonb_build_object('success', false, 'error', 'Set a POS selling price greater than zero for Bar inventory items.');
  end if;

  update public.inventory_items
  set
    name          = case when payload ? 'name' then payload->>'name' else name end,
    category      = case when payload ? 'category' then payload->>'category' else category end,
    unit          = case when payload ? 'unit' then payload->>'unit' else unit end,
    reorder_level = case when payload ? 'reorder_level' then coalesce((payload->>'reorder_level')::numeric, 0) else reorder_level end,
    selling_price = case when payload ? 'selling_price' then coalesce((payload->>'selling_price')::numeric, 0) else selling_price end,
    outlet_id     = case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else outlet_id end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Inventory item not found');
  end if;

  perform public.sync_inventory_item_to_pos(p_id, p_lodge_id);

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_lodge_support_ticket(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_lodge_support_ticket(p_ticket_id uuid, p_lodge_id uuid, p_status text DEFAULT NULL::text, p_admin_notes text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_note text := nullif(btrim(coalesce(p_admin_notes, '')), '');
begin
  perform public.app_require_lodge_role(
    p_lodge_id,
    array['receptionist', 'manager', 'admin', 'super_admin']
  );

  if v_status not in ('', 'open', 'acknowledged', 'in_progress', 'resolved') then
    return jsonb_build_object('success', false, 'error', 'Invalid request status');
  end if;

  update public.support_tickets
     set status = case when v_status = '' then status else v_status end,
         admin_notes = case when p_admin_notes is null then admin_notes else v_note end,
         updated_at = now(),
         resolved_at = case
           when v_status = 'resolved' then now()
           when v_status in ('open', 'acknowledged', 'in_progress') then null
           else resolved_at
         end
   where id = p_ticket_id
     and lodge_id = p_lodge_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Request not found');
  end if;

  return jsonb_build_object('success', true, 'id', p_ticket_id);
end;
$$;


--
-- Name: update_maintenance_ticket(text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_maintenance_ticket(p_id text, p_lodge_id text, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  has_title boolean;
  has_issue boolean;
  has_description boolean;
  has_notes boolean;
  has_status boolean;
  has_priority boolean;
  has_reported_date boolean;
  has_resolved_at boolean;
  has_labour_cost boolean;
  has_parts_cost boolean;
  has_total_cost boolean;
  has_vendor_name boolean;
  has_cost_notes boolean;
  assignments text[] := array[]::text[];
  v_updated text;
begin
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'title') into has_title;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'issue') into has_issue;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'description') into has_description;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'notes') into has_notes;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'status') into has_status;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'priority') into has_priority;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'reported_date') into has_reported_date;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'resolved_at') into has_resolved_at;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'labour_cost') into has_labour_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'parts_cost') into has_parts_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'total_cost') into has_total_cost;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'vendor_name') into has_vendor_name;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'maintenance_tickets' and column_name = 'cost_notes') into has_cost_notes;

  if has_title and payload ? 'title' then assignments := array_append(assignments, format('title = %L', payload->>'title')); end if;
  if has_issue and payload ? 'issue' then assignments := array_append(assignments, format('issue = %L', payload->>'issue')); end if;
  if has_description and payload ? 'description' then assignments := array_append(assignments, format('description = %L', payload->>'description')); end if;
  if has_notes and payload ? 'notes' then assignments := array_append(assignments, format('notes = %L', payload->>'notes')); end if;
  if has_status and payload ? 'status' then assignments := array_append(assignments, format('status = %L', payload->>'status')); end if;
  if has_priority and payload ? 'priority' then assignments := array_append(assignments, format('priority = %L', payload->>'priority')); end if;
  if has_reported_date and payload ? 'reported_date' and coalesce(payload->>'reported_date', '') <> '' then assignments := array_append(assignments, format('reported_date = %L', payload->>'reported_date')); end if;
  if has_resolved_at and payload ? 'resolved_at' then assignments := array_append(assignments, format('resolved_at = %L', payload->>'resolved_at')); end if;
  if has_labour_cost and payload ? 'labour_cost' then assignments := array_append(assignments, format('labour_cost = %s', coalesce(nullif(payload->>'labour_cost', ''), '0'))); end if;
  if has_parts_cost and payload ? 'parts_cost' then assignments := array_append(assignments, format('parts_cost = %s', coalesce(nullif(payload->>'parts_cost', ''), '0'))); end if;
  if has_total_cost and payload ? 'total_cost' then assignments := array_append(assignments, format('total_cost = %s', coalesce(nullif(payload->>'total_cost', ''), '0'))); end if;
  if has_vendor_name and payload ? 'vendor_name' then assignments := array_append(assignments, format('vendor_name = %L', nullif(payload->>'vendor_name', ''))); end if;
  if has_cost_notes and payload ? 'cost_notes' then assignments := array_append(assignments, format('cost_notes = %L', nullif(payload->>'cost_notes', ''))); end if;

  if coalesce(array_length(assignments, 1), 0) = 0 then
    return jsonb_build_object('success', true, 'id', p_id);
  end if;

  execute format(
    'update public.maintenance_tickets set %s where id::text = %L and lodge_id::text = %L returning id::text',
    array_to_string(assignments, ', '),
    p_id,
    p_lodge_id
  )
  into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Maintenance ticket not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_pos_menu_item(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_pos_menu_item(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
  v_template_kind text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['manager', 'admin', 'super_admin']);

  select template_kind
    into v_template_kind
    from public.pos_menu_items
   where id = p_id
     and lodge_id = p_lodge_id
   limit 1;

  if v_template_kind is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  if v_template_kind = 'bar_pack' then
    return jsonb_build_object('success', false, 'error', 'Bar pack templates are managed from the Bar template controls.');
  end if;

  if v_template_kind = 'bar_single' then
    if jsonb_object_length(payload - 'barcode') > 0 then
      return jsonb_build_object('success', false, 'error', 'Bar bottle details are managed from inventory. Only barcode updates are allowed here.');
    end if;

    update public.pos_menu_items
       set barcode = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end
     where id = p_id
       and lodge_id = p_lodge_id
    returning id into v_updated;
  else
    update public.pos_menu_items
    set
      name              = case when payload ? 'name' then payload->>'name' else name end,
      category          = case when payload ? 'category' then coalesce(payload->>'category', 'Other') else category end,
      price             = case when payload ? 'price' then coalesce((payload->>'price')::numeric, 0) else price end,
      is_available      = case when payload ? 'is_available' then coalesce((payload->>'is_available')::boolean, true) else is_available end,
      barcode           = case when payload ? 'barcode' then nullif(payload->>'barcode', '') else barcode end,
      inventory_item_id = case when payload ? 'inventory_item_id' then nullif(payload->>'inventory_item_id', '')::uuid else inventory_item_id end,
      depletion_qty     = case
                            when payload ? 'inventory_item_id' then
                              case
                                when nullif(payload->>'inventory_item_id', '') is null then null
                                else coalesce((payload->>'depletion_qty')::numeric, 1)
                              end
                            when payload ? 'depletion_qty' then coalesce((payload->>'depletion_qty')::numeric, 1)
                            else depletion_qty
                          end,
      outlet_id         = case when payload ? 'outlet_id' then nullif(payload->>'outlet_id', '')::uuid else outlet_id end
    where id = p_id
      and lodge_id = p_lodge_id
    returning id into v_updated;
  end if;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'POS menu item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_quotation(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_quotation(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  perform public.app_reject_pwa_financial_mutation();

  update public.quotations
     set customer_id = case when payload ? 'customer_id' then nullif(payload->>'customer_id', '')::uuid else customer_id end,
         customer_name = case when payload ? 'customer_name' then coalesce(payload->>'customer_name', '') else customer_name end,
         customer_phone = case when payload ? 'customer_phone' then coalesce(payload->>'customer_phone', '') else customer_phone end,
         room_id = case when payload ? 'room_id' then nullif(payload->>'room_id', '')::uuid else room_id end,
         room_name = case when payload ? 'room_name' then coalesce(payload->>'room_name', '') else room_name end,
         check_in = case when payload ? 'check_in' then nullif(payload->>'check_in', '')::date else check_in end,
         check_out = case when payload ? 'check_out' then nullif(payload->>'check_out', '')::date else check_out end,
         adults = case when payload ? 'adults' then coalesce((payload->>'adults')::integer, 1) else adults end,
         children = case when payload ? 'children' then coalesce((payload->>'children')::integer, 0) else children end,
         subtotal = case when payload ? 'subtotal' then coalesce((payload->>'subtotal')::numeric, 0) else subtotal end,
         tax_amount = case when payload ? 'tax_amount' then coalesce((payload->>'tax_amount')::numeric, 0) else tax_amount end,
         total_amount = case when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0) else total_amount end,
         currency = case when payload ? 'currency' then coalesce(payload->>'currency', 'BWP') else currency end,
         notes = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
         status = case when payload ? 'status' then payload->>'status' else status end,
         valid_until = case when payload ? 'valid_until' then nullif(payload->>'valid_until', '')::date else valid_until end,
         updated_at = case when payload ? 'updated_at' then coalesce((payload->>'updated_at')::timestamptz, now()) else now() end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Quotation not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_quotation(uuid, uuid, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_quotation(p_id uuid, p_lodge_id uuid, payload jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_record public.quotations%rowtype;
  v_updated uuid;
begin
  select * into v_record
    from public.quotations
   where id = p_id
     and lodge_id = p_lodge_id
   for update;

  if v_record.id is null then
    return jsonb_build_object('success', false, 'error', 'Quotation not found');
  end if;

  -- Optimistic concurrency guard
  if p_expected_updated_at is not null and v_record.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    );
  end if;

  update public.quotations
  set
    customer_id = case when payload ? 'customer_id' then nullif(payload->>'customer_id', '')::uuid else customer_id end,
    customer_name = case when payload ? 'customer_name' then coalesce(payload->>'customer_name', '') else customer_name end,
    customer_phone = case when payload ? 'customer_phone' then coalesce(payload->>'customer_phone', '') else customer_phone end,
    room_id = case when payload ? 'room_id' then nullif(payload->>'room_id', '')::uuid else room_id end,
    room_name = case when payload ? 'room_name' then coalesce(payload->>'room_name', '') else room_name end,
    check_in = case when payload ? 'check_in' then nullif(payload->>'check_in', '')::date else check_in end,
    check_out = case when payload ? 'check_out' then nullif(payload->>'check_out', '')::date else check_out end,
    adults = case when payload ? 'adults' then coalesce((payload->>'adults')::integer, 1) else adults end,
    children = case when payload ? 'children' then coalesce((payload->>'children')::integer, 0) else children end,
    subtotal = case when payload ? 'subtotal' then coalesce((payload->>'subtotal')::numeric, 0) else subtotal end,
    tax_amount = case when payload ? 'tax_amount' then coalesce((payload->>'tax_amount')::numeric, 0) else tax_amount end,
    total_amount = case when payload ? 'total_amount' then coalesce((payload->>'total_amount')::numeric, 0) else total_amount end,
    currency = case when payload ? 'currency' then coalesce(payload->>'currency', 'BWP') else currency end,
    notes = case when payload ? 'notes' then coalesce(payload->>'notes', '') else notes end,
    status = case when payload ? 'status' then payload->>'status' else status end,
    valid_until = case when payload ? 'valid_until' then nullif(payload->>'valid_until', '')::date else valid_until end,
    updated_at = case when payload ? 'updated_at' then coalesce((payload->>'updated_at')::timestamptz, now()) else now() end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Quotation not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_room(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_room(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.rooms
  set
    room_number = case when payload ? 'room_number' then payload->>'room_number' else room_number end,
    room_type = case when payload ? 'room_type' then payload->>'room_type' else room_type end,
    rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0) else rate_per_night end,
    max_occupancy = case when payload ? 'max_occupancy' then coalesce((payload->>'max_occupancy')::integer, 2) else max_occupancy end,
    status = case when payload ? 'status' then coalesce(payload->>'status', 'available') else status end,
    description = case when payload ? 'description' then coalesce(payload->>'description', '') else description end,
    photo = case when payload ? 'photo' then coalesce(payload->>'photo', '') else photo end,
    photos = case
      when payload ? 'photos' then
        coalesce(
          (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
          '{}'::text[]
        )
      else photos
    end,
    amenities = case
      when payload ? 'amenities' then
        coalesce(
          (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
          '{}'::text[]
        )
      else amenities
    end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_room(uuid, uuid, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_room(p_id uuid, p_lodge_id uuid, payload jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
with target as (
  select id, updated_at
    from public.rooms
   where id = p_id
     and lodge_id = p_lodge_id
   for update
), updated as (
  update public.rooms
  set
    room_number = case when payload ? 'room_number' then payload->>'room_number' else room_number end,
    room_type = case when payload ? 'room_type' then payload->>'room_type' else room_type end,
    rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0) else rate_per_night end,
    max_occupancy = case when payload ? 'max_occupancy' then coalesce((payload->>'max_occupancy')::integer, 2) else max_occupancy end,
    status = case when payload ? 'status' then coalesce(payload->>'status', 'available') else status end,
    description = case when payload ? 'description' then coalesce(payload->>'description', '') else description end,
    photo = case when payload ? 'photo' then coalesce(payload->>'photo', '') else photo end,
    photos = case
      when payload ? 'photos' then
        coalesce(
          (select array_agg(x) from jsonb_array_elements_text(payload->'photos') x),
          '{}'::text[]
        )
      else photos
    end,
    amenities = case
      when payload ? 'amenities' then
        coalesce(
          (select array_agg(x) from jsonb_array_elements_text(payload->'amenities') x),
          '{}'::text[]
        )
      else amenities
    end,
    updated_at = now()
  where id = p_id
    and lodge_id = p_lodge_id
    and exists (select 1 from target)
    and (
      p_expected_updated_at is null
      or (select updated_at from target) is not distinct from p_expected_updated_at
    )
  returning id
)
select case
  when not exists (select 1 from target) then
    jsonb_build_object('success', false, 'error', 'Room not found')
  when p_expected_updated_at is not null
    and (select updated_at from target) is distinct from p_expected_updated_at then
    jsonb_build_object(
      'success', false,
      'error', 'conflict',
      'conflict', true,
      'message', 'This record was updated on another device. Refresh and reapply your change.'
    )
  else
    jsonb_build_object('success', true, 'id', (select id from updated limit 1))
end;
$$;


--
-- Name: update_room_housekeeping(uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_room_housekeeping(p_id uuid, p_lodge_id uuid, p_status text, p_notes text DEFAULT ''::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.rooms
  set
    housekeeping_status = coalesce(p_status, 'clean'),
    housekeeping_notes = coalesce(p_notes, '')
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Room not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_room_rate_override(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_room_rate_override(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.room_rate_overrides
  set
    room_id = case when payload ? 'room_id' then nullif(payload->>'room_id', '')::uuid else room_id end,
    name = case when payload ? 'name' then payload->>'name' else name end,
    start_date = case when payload ? 'start_date' then (payload->>'start_date')::date else start_date end,
    end_date = case when payload ? 'end_date' then (payload->>'end_date')::date else end_date end,
    rate_per_night = case when payload ? 'rate_per_night' then coalesce((payload->>'rate_per_night')::numeric, 0) else rate_per_night end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Rate override not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_subscription_contract(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_subscription_contract(p_license_id uuid, p_payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_before public.licenses%rowtype;
  v_lodge_key text;
  v_lodge_id uuid;
  v_plan text;
  v_payment_status text;
  v_event_type text := 'subscription_updated';
begin
  if not public.app_is_service_role() then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  select *
  into v_before
  from public.licenses
  where id = p_license_id
  limit 1
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Subscription record not found.');
  end if;

  v_lodge_key := coalesce(nullif(btrim(coalesce(p_payload->>'lodge_id', '')), ''), v_before.lodge_id::text);
  v_lodge_id := case when coalesce(v_lodge_key, '') ~ '^[0-9a-fA-F-]{36}$' then v_lodge_key::uuid else v_before.lodge_id end;
  v_plan := case when p_payload ? 'subscription_plan' then public._normalize_subscription_plan(p_payload->>'subscription_plan') else public._normalize_subscription_plan(v_before.subscription_plan) end;
  v_payment_status := lower(coalesce(nullif(btrim(coalesce(p_payload->>'payment_status', '')), ''), coalesce(v_before.payment_status, 'active')));

  if v_lodge_id is distinct from v_before.lodge_id then
    update public.licenses
    set is_active = false,
        subscription_state = 'superseded',
        notes = trim(both from concat(coalesce(notes, ''), case when coalesce(notes, '') = '' then '' else ' ' end, '[Superseded by subscription reassignment]'))
    where lodge_id = v_lodge_id
      and id <> p_license_id
      and coalesce(is_active, true) = true;
    v_event_type := 'subscription_reassigned';
  elsif v_plan <> public._normalize_subscription_plan(v_before.subscription_plan) then
    v_event_type := 'subscription_plan_changed';
  elsif (p_payload ? 'last_payment_date') or (p_payload ? 'next_due_date') then
    v_event_type := 'subscription_renewed';
  end if;

  update public.licenses
  set lodge_id = v_lodge_id,
      subscription_plan = v_plan,
      payment_status = v_payment_status,
      monthly_fee = case when p_payload ? 'monthly_fee' then coalesce(nullif(p_payload->>'monthly_fee', '')::numeric, monthly_fee) else monthly_fee end,
      expires_at = case when p_payload ? 'expires_at' then nullif(p_payload->>'expires_at', '')::timestamptz else expires_at end,
      next_due_date = case when p_payload ? 'next_due_date' then nullif(p_payload->>'next_due_date', '')::date else next_due_date end,
      last_payment_date = case when p_payload ? 'last_payment_date' then nullif(p_payload->>'last_payment_date', '')::date else last_payment_date end,
      notes = case when p_payload ? 'notes' then coalesce(nullif(p_payload->>'notes', ''), notes) else notes end
  where id = p_license_id;

  perform public._record_subscription_event(
    coalesce(v_lodge_id, v_before.lodge_id),
    coalesce(v_lodge_id, v_before.lodge_id)::text,
    p_license_id, null,
    v_event_type, 'completed',
    public._normalize_subscription_plan(v_plan),
    coalesce(v_before.plan_version_code, '2026.04'),
    jsonb_build_object('previous_plan', public._normalize_subscription_plan(v_before.subscription_plan), 'new_plan', public._normalize_subscription_plan(v_plan))
  );

  return jsonb_build_object('success', true, 'license_id', p_license_id);
end;
$_$;


--
-- Name: update_supply_item(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_supply_item(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated uuid;
begin
  update public.supply_items
  set
    name = case when payload ? 'name' then payload->>'name' else name end,
    category = case when payload ? 'category' then payload->>'category' else category end,
    unit = case when payload ? 'unit' then payload->>'unit' else unit end,
    reorder_level = case when payload ? 'reorder_level' then coalesce((payload->>'reorder_level')::numeric, 0) else reorder_level end
  where id = p_id
    and lodge_id = p_lodge_id
  returning id into v_updated;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'Supply item not found');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: update_user_profile(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_profile(p_id uuid, p_lodge_id uuid, payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_updated         uuid;
  v_email           text;
  v_outlet_ids      uuid[];
  v_current_role    text;
  v_current_outlets uuid[];
  v_pin_hash        text;
begin
  perform public.app_require_lodge_role(p_lodge_id, array['admin', 'manager', 'super_admin']);

  if payload ? 'email' then
    v_email := lower(btrim(coalesce(payload->>'email', '')));
    if exists (
      select 1 from public.users
       where lodge_id = p_lodge_id
         and lower(btrim(email)) = v_email
         and id <> p_id
    ) then
      return jsonb_build_object(
        'success', false,
        'error',   format('A user with the email "%s" already exists.', v_email)
      );
    end if;
  end if;

  if payload ? 'allowed_outlet_ids' then
    select coalesce(array_agg(elem::uuid), '{}'::uuid[])
      into v_outlet_ids
      from jsonb_array_elements_text(payload->'allowed_outlet_ids') as elem;
  end if;

  select role, allowed_outlet_ids
    into v_current_role, v_current_outlets
    from public.users
   where id = p_id and lodge_id = p_lodge_id;

  if lower(coalesce(nullif(payload->>'role', ''), v_current_role, '')) in ('cashier', 'supervisor')
     and cardinality(coalesce(
           case when payload ? 'allowed_outlet_ids' then v_outlet_ids
                else v_current_outlets
           end,
           '{}'::uuid[]
         )) = 0 then
    return jsonb_build_object(
      'success', false,
      'error',   'Cashier and supervisor roles require at least one outlet assignment.'
    );
  end if;

  if payload ? 'pin_hash' then
    v_pin_hash := nullif(payload->>'pin_hash', '');
  end if;

  update public.users
     set name = coalesce(nullif(payload->>'name', ''), name),
         email = coalesce(v_email, email),
         role = coalesce(nullif(payload->>'role', ''), role),
         pin_hash = case when payload ? 'pin_hash' then v_pin_hash else pin_hash end
   where id = p_id
     and lodge_id = p_lodge_id
  returning id into v_updated;

  if payload ? 'allowed_outlet_ids' then
    update public.users
       set allowed_outlet_ids = v_outlet_ids
     where id = p_id
       and lodge_id = p_lodge_id;
  end if;

  if v_updated is null then
    return jsonb_build_object('success', false, 'error', 'User not found.');
  end if;

  return jsonb_build_object('success', true, 'id', v_updated);
end;
$$;


--
-- Name: upsert_device_health(uuid, text, text, integer, integer, integer, boolean, timestamp with time zone, text, text[], jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_device_health(p_lodge_id uuid, p_device_id text, p_client_type text, p_pending_queue_count integer, p_failed_queue_count integer, p_unresolved_local_count integer, p_replay_auth_ready boolean, p_last_successful_sync_at timestamp with time zone, p_reconciliation_state text, p_top_fault_types text[], p_raw_summary jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  insert into device_health_reports (
    lodge_id, device_id, client_type, reported_at,
    pending_queue_count, failed_queue_count, unresolved_local_count,
    replay_auth_ready, last_successful_sync_at, reconciliation_state,
    top_fault_types, raw_summary
  ) values (
    p_lodge_id, p_device_id, p_client_type, now(),
    p_pending_queue_count, p_failed_queue_count, p_unresolved_local_count,
    p_replay_auth_ready, p_last_successful_sync_at, p_reconciliation_state,
    p_top_fault_types, p_raw_summary
  )
  on conflict (lodge_id, device_id) do update set
    client_type = excluded.client_type,
    reported_at = now(),
    pending_queue_count = excluded.pending_queue_count,
    failed_queue_count = excluded.failed_queue_count,
    unresolved_local_count = excluded.unresolved_local_count,
    replay_auth_ready = excluded.replay_auth_ready,
    last_successful_sync_at = excluded.last_successful_sync_at,
    reconciliation_state = excluded.reconciliation_state,
    top_fault_types = excluded.top_fault_types,
    raw_summary = excluded.raw_summary;
  return jsonb_build_object('success', true);
exception when others then
  return jsonb_build_object('success', false, 'error', sqlerrm);
end;
$$;


--
-- Name: use_room_supply_stock(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.use_room_supply_stock(payload jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_item_id uuid := (payload->>'item_id')::uuid;
  v_room_id uuid := (payload->>'room_id')::uuid;
  v_lodge_id uuid := (payload->>'lodge_id')::uuid;
  v_qty numeric := coalesce((payload->>'quantity')::numeric, 0);
  v_notes text := nullif(payload->>'notes', '');
  v_unit_cost numeric := 0;
  v_new_room numeric;
begin
  if v_qty <= 0 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be greater than zero');
  end if;

  select latest_unit_cost
    into v_unit_cost
    from public.supply_items
   where id = v_item_id
     and lodge_id = v_lodge_id;

  update public.room_supply_room_stock
     set quantity_on_hand = greatest(0, coalesce(quantity_on_hand, 0) - v_qty),
         last_moved_at = now(),
         updated_at = now()
   where lodge_id = v_lodge_id
     and room_id = v_room_id
     and supply_item_id = v_item_id
     and coalesce(quantity_on_hand, 0) >= v_qty
  returning quantity_on_hand into v_new_room;

  if v_new_room is null then
    return jsonb_build_object('success', false, 'error', 'Not enough stock is loaded in this room');
  end if;

  insert into public.room_supply_movements (
    lodge_id,
    room_id,
    supply_item_id,
    movement_type,
    quantity,
    unit_cost,
    total_cost,
    notes
  ) values (
    v_lodge_id,
    v_room_id,
    v_item_id,
    'use',
    v_qty,
    coalesce(v_unit_cost, 0),
    v_qty * coalesce(v_unit_cost, 0),
    v_notes
  );

  return jsonb_build_object('success', true, 'new_room_stock', v_new_room);
end;
$$;


--
-- Name: validate_app_session(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_app_session(p_session_token text DEFAULT NULL::text) RETURNS TABLE(contract_version integer, session_type text, id uuid, name text, email text, role text, lodge_id uuid, lodge_display_name text, pwa_enabled boolean, pwa_password_set_at timestamp with time zone, pwa_disabled_reason text, pwa_feature_enabled boolean, pwa_plan text, session_expires_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_session public.app_sessions;
begin
  v_session := public.app_current_session_row(p_session_token);
  if v_session.id is null then
    return;
  end if;

  return query
  select
    2 as contract_version,
    v_session.session_type,
    u.id,
    u.name,
    lower(btrim(u.email)) as email,
    lower(btrim(u.role)) as role,
    u.lodge_id,
    coalesce(s.lodge_name, s.company_name, 'Your Lodge') as lodge_display_name,
    coalesce(u.pwa_enabled, false) as pwa_enabled,
    u.pwa_password_set_at,
    u.pwa_disabled_reason,
    coalesce((ent.entitlement->'effective_features'->>'pwa')::boolean, false) as pwa_feature_enabled,
    coalesce(ent.entitlement->>'plan', 'Starter') as pwa_plan,
    v_session.expires_at
  from public.users u
  left join lateral (
    select settings.lodge_name, settings.company_name
    from public.settings settings
    where settings.lodge_id = u.lodge_id
      and coalesce(settings.deleted, false) = false
    order by settings.updated_at desc nulls last, settings.created_at desc nulls last
    limit 1
  ) s on true
  left join lateral (
    select public.get_lodge_entitlement(u.lodge_id) as entitlement
  ) ent on true
  where u.id = v_session.user_id
    and u.lodge_id = v_session.lodge_id
  limit 1;
end;
$$;


--
-- Name: verify_refund_approver_pin(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_refund_approver_pin(p_lodge_id uuid, p_pin text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_approver record;
begin
  perform public.app_reject_pwa_financial_mutation();
  perform public.app_require_lodge_role(p_lodge_id, array['finance', 'manager', 'admin', 'super_admin']);

  if nullif(btrim(coalesce(p_pin, '')), '') is null then
    return jsonb_build_object('success', false, 'error', 'Approval PIN is required');
  end if;

  select u.id, u.name, u.role
    into v_approver
    from public.users u
   where u.lodge_id = p_lodge_id
     and lower(coalesce(u.role, '')) in ('manager', 'admin', 'super_admin')
     and u.pin_hash is not null
     and extensions.crypt(p_pin, u.pin_hash) = u.pin_hash
   order by u.created_at asc
   limit 1;

  if v_approver.id is null then
    return jsonb_build_object('success', false, 'error', 'Invalid approval PIN or unauthorized approver');
  end if;

  return jsonb_build_object(
    'success', true,
    'approved_by', v_approver.id,
    'approved_by_name', v_approver.name,
    'approved_by_role', v_approver.role
  );
end;
$$;


--
-- Name: void_pos_order(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_pos_order(p_id uuid, p_lodge_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return jsonb_build_object(
    'success', false,
    'error', 'POS voids require supervisor, manager, or admin PIN approval.'
  );
end;
$$;


--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_
        -- Filter by action early - only get subscriptions interested in this action
        -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
        and (subs.action_filter = '*' or subs.action_filter = action::text);

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$$;


--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $$;


--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $_$;


--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL AND ppt.tablename NOT LIKE '% %'),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  -- Count raw slot entries before apply_rls/subscription filter
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  -- Apply RLS and filter as before
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  -- Real rows with slot count attached
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  -- Sentinel row: always returned when no real rows exist so Elixir can
  -- always read slot_changes_count. Identified by wal IS NULL.
  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $$;


--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $$;


--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: activity_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.activity_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id text NOT NULL,
    lodge_name text,
    action text NOT NULL,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: booking_charges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    description text NOT NULL,
    amount numeric(10,2) DEFAULT 0 NOT NULL,
    category text,
    quantity integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    outlet_id uuid,
    voided_at timestamp with time zone,
    voided_by uuid,
    void_reason text
);


--
-- Name: booking_email_delivery_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_email_delivery_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid,
    booking_id uuid,
    reference text,
    delivery_type text DEFAULT 'booking_confirmation_email'::text NOT NULL,
    delivery_status text NOT NULL,
    recipient text,
    error_message text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booking_email_delivery_log_status_check CHECK ((delivery_status = ANY (ARRAY['sent'::text, 'failed'::text, 'smtp_missing'::text, 'token_invalid'::text, 'guest_mismatch'::text, 'booking_not_found'::text]))),
    CONSTRAINT booking_email_delivery_log_type_check CHECK ((delivery_type = 'booking_confirmation_email'::text))
);


--
-- Name: broadcasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.broadcasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    is_active boolean DEFAULT true,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: conference_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conference_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    booking_date date NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    client_name text NOT NULL,
    company text,
    attendees integer DEFAULT 0,
    setup_type text DEFAULT 'Theatre'::text,
    room_name text DEFAULT 'Conference Room'::text,
    includes_catering boolean DEFAULT false,
    catering_notes text,
    total_amount numeric DEFAULT 0,
    deposit_paid numeric DEFAULT 0,
    payment_status text DEFAULT 'pending'::text,
    payment_method text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    id_number text,
    address text,
    nationality text,
    notes text,
    is_blacklisted boolean DEFAULT false,
    blacklist_reason text,
    created_at timestamp with time zone DEFAULT now(),
    id_photo text,
    import_batch_id uuid
);


--
-- Name: device_health_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_health_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    device_id text NOT NULL,
    client_type text NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    pending_queue_count integer DEFAULT 0 NOT NULL,
    failed_queue_count integer DEFAULT 0 NOT NULL,
    unresolved_local_count integer DEFAULT 0 NOT NULL,
    replay_auth_ready boolean DEFAULT true NOT NULL,
    last_successful_sync_at timestamp with time zone,
    reconciliation_state text DEFAULT 'unknown'::text NOT NULL,
    top_fault_types text[] DEFAULT '{}'::text[],
    raw_summary jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT device_health_reports_client_type_check CHECK ((client_type = ANY (ARRAY['desktop'::text, 'pwa'::text]))),
    CONSTRAINT device_health_reports_reconciliation_state_check CHECK ((reconciliation_state = ANY (ARRAY['unknown'::text, 'unverifiable'::text, 'clear'::text, 'mismatch'::text])))
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    date date NOT NULL,
    description text NOT NULL,
    category text,
    amount numeric(10,2) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    outlet_id uuid
);


--
-- Name: financial_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_audit_log (
    id uuid DEFAULT extensions.gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    booking_id uuid,
    action text NOT NULL,
    actor_id uuid,
    amount_delta numeric,
    before_snapshot jsonb,
    after_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now(),
    idempotency_key text,
    CONSTRAINT financial_audit_log_action_check CHECK ((action = ANY (ARRAY['payment_recorded'::text, 'refund_recorded'::text, 'charge_added'::text, 'charge_deleted'::text, 'booking_total_edited'::text, 'booking_status_changed'::text])))
);


--
-- Name: financial_validation_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_validation_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    alert_type text NOT NULL,
    issue_count integer DEFAULT 0 NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: financial_validation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.financial_validation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    triggered_by uuid,
    trigger_source text DEFAULT 'manual'::text NOT NULL,
    summary jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT financial_validation_runs_trigger_check CHECK ((trigger_source = ANY (ARRAY['manual'::text, 'scheduled'::text, 'startup'::text])))
);


--
-- Name: import_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.import_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    imported_by uuid,
    filename text,
    entity_type text DEFAULT 'bookings'::text NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    error_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'Bar'::text NOT NULL,
    unit text DEFAULT 'unit'::text NOT NULL,
    current_stock numeric DEFAULT 0 NOT NULL,
    reorder_level numeric DEFAULT 0 NOT NULL,
    latest_unit_cost numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    outlet_id uuid,
    selling_price numeric DEFAULT 0 NOT NULL
);


--
-- Name: inventory_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    item_id uuid NOT NULL,
    date date NOT NULL,
    quantity_purchased numeric NOT NULL,
    total_cost numeric NOT NULL,
    unit_cost numeric NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_stocktake_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_stocktake_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stocktake_id uuid NOT NULL,
    lodge_id uuid NOT NULL,
    item_id uuid NOT NULL,
    expected_qty numeric DEFAULT 0 NOT NULL,
    counted_qty numeric,
    variance_qty numeric,
    unit_cost numeric DEFAULT 0 NOT NULL,
    variance_cost numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inventory_stocktakes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_stocktakes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    title text,
    notes text,
    status text DEFAULT 'open'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    counted_at timestamp with time zone,
    posted_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    outlet_id uuid,
    CONSTRAINT inventory_stocktakes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'posted'::text, 'cancelled'::text])))
);


--
-- Name: invoice_delivery_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_delivery_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    booking_id uuid,
    invoice_number text,
    delivery_type text NOT NULL,
    delivery_status text DEFAULT 'completed'::text NOT NULL,
    recipient text,
    file_path text,
    render_version text,
    initiated_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    previous_hash text,
    entry_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_delivery_log_status_check CHECK ((delivery_status = ANY (ARRAY['completed'::text, 'failed'::text]))),
    CONSTRAINT invoice_delivery_log_type_check CHECK ((delivery_type = ANY (ARRAY['invoice_email'::text, 'receipt_pdf'::text, 'receipt_print'::text])))
);


--
-- Name: invoice_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoice_sequences (
    lodge_id uuid NOT NULL,
    year integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_number text,
    booking_id uuid NOT NULL,
    lodge_id uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    due_date date,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: licenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid,
    license_key text NOT NULL,
    lodge_name text,
    business_type text,
    issued_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    is_active boolean DEFAULT true,
    notes text,
    subscription_plan text DEFAULT 'Starter'::text,
    monthly_fee numeric DEFAULT 0,
    payment_status text DEFAULT 'active'::text,
    last_payment_date date,
    next_due_date date,
    currency text DEFAULT 'USD'::text,
    plan_version_code text,
    subscription_state text,
    grace_period_days integer DEFAULT 7 NOT NULL,
    offline_lease_days integer DEFAULT 7 NOT NULL,
    activated_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    suspended_at timestamp with time zone,
    last_entitlement_sync_at timestamp with time zone
);


--
-- Name: lodge_features; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lodge_features (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    feature_name text NOT NULL,
    enabled boolean DEFAULT true,
    updated_at timestamp with time zone DEFAULT now(),
    reason text,
    expires_at timestamp with time zone,
    review_at timestamp with time zone,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: maintenance_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    room_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    priority text DEFAULT 'medium'::text,
    status text DEFAULT 'open'::text,
    reported_date date NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    labour_cost numeric DEFAULT 0 NOT NULL,
    parts_cost numeric DEFAULT 0 NOT NULL,
    total_cost numeric DEFAULT 0 NOT NULL,
    vendor_name text,
    cost_notes text
);


--
-- Name: master_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.master_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now(),
    role text DEFAULT 'superadmin'::text,
    is_active boolean DEFAULT true
);


--
-- Name: online_booking_rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.online_booking_rate_limits (
    bucket_key text NOT NULL,
    lodge_id uuid NOT NULL,
    bucket_type text NOT NULL,
    window_started_at timestamp with time zone DEFAULT now() NOT NULL,
    hit_count integer DEFAULT 0 NOT NULL,
    last_request_at timestamp with time zone DEFAULT now() NOT NULL,
    blocked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outlets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outlets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outlets_type_check CHECK ((type = ANY (ARRAY['food'::text, 'beverage'::text, 'accommodation'::text])))
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    booking_id uuid,
    lodge_id uuid NOT NULL,
    amount numeric NOT NULL,
    method text DEFAULT 'cash'::text NOT NULL,
    type text DEFAULT 'payment'::text NOT NULL,
    paid_at timestamp with time zone DEFAULT now() NOT NULL,
    recorded_by uuid,
    notes text DEFAULT ''::text,
    idempotency_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    conference_booking_id uuid,
    CONSTRAINT payments_amount_check CHECK ((amount <> (0)::numeric)),
    CONSTRAINT payments_idempotency_key_format_chk CHECK (((idempotency_key IS NULL) OR (((length(idempotency_key) >= 8) AND (length(idempotency_key) <= 128)) AND (idempotency_key ~ '^[A-Za-z0-9:_-]+$'::text)))),
    CONSTRAINT payments_type_check CHECK ((type = ANY (ARRAY['deposit'::text, 'payment'::text, 'refund'::text, 'retention_fee'::text])))
);


--
-- Name: pool_day_use; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pool_day_use (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    date date NOT NULL,
    guest_name text NOT NULL,
    phone text,
    adults integer DEFAULT 1,
    children integer DEFAULT 0,
    fee_per_adult numeric DEFAULT 0,
    fee_per_child numeric DEFAULT 0,
    total numeric DEFAULT 0,
    payment_method text DEFAULT 'cash'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: pos_menu_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_menu_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'Other'::text NOT NULL,
    price numeric DEFAULT 0 NOT NULL,
    is_available boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    barcode text,
    inventory_item_id uuid,
    depletion_qty numeric DEFAULT 1,
    outlet_id uuid,
    auto_from_inventory boolean DEFAULT false NOT NULL,
    template_kind text DEFAULT 'standard'::text NOT NULL,
    template_pack_size integer
);


--
-- Name: pos_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    order_id uuid NOT NULL,
    menu_item_id uuid,
    item_name text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    subtotal numeric DEFAULT 0 NOT NULL,
    inventory_item_id uuid,
    depletion_qty numeric DEFAULT 1 NOT NULL
);


--
-- Name: pos_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    room_id uuid,
    booking_id uuid,
    walk_in_name text,
    status text DEFAULT 'open'::text,
    total numeric DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    payment_method text DEFAULT 'cash'::text,
    outlet_id uuid,
    create_idempotency_key text,
    folio_charge_id uuid,
    receipt_number text
);


--
-- Name: pos_override_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_override_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    order_id uuid,
    action text DEFAULT 'void'::text NOT NULL,
    requested_by uuid,
    approved_by uuid,
    reason text,
    outlet_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pos_receipt_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pos_receipt_sequences (
    lodge_id uuid NOT NULL,
    year integer NOT NULL,
    last_number integer DEFAULT 0 NOT NULL
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id text NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    quotation_number text NOT NULL,
    lodge_id uuid NOT NULL,
    customer_id uuid,
    customer_name text NOT NULL,
    room_id uuid,
    room_name text DEFAULT ''::text,
    check_in date,
    check_out date,
    adults integer DEFAULT 1 NOT NULL,
    children integer DEFAULT 0 NOT NULL,
    total_amount numeric NOT NULL,
    currency text DEFAULT 'BWP'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    valid_until date,
    converted_booking_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    customer_phone text,
    subtotal numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    parent_quotation_id uuid,
    CONSTRAINT quotations_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'accepted'::text, 'converted'::text, 'expired'::text, 'cancelled'::text, 'declined'::text]))),
    CONSTRAINT quotations_total_amount_check CHECK ((total_amount >= (0)::numeric))
);


--
-- Name: refund_approval_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_approval_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    approved_by uuid NOT NULL,
    requested_by uuid,
    refund_amount numeric NOT NULL,
    retained_amount numeric NOT NULL,
    retained_percent numeric NOT NULL,
    method text NOT NULL,
    notes text,
    proof_reference text,
    approval_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rejected_online_bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rejected_online_bookings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    room_id uuid,
    rejection_reason text NOT NULL,
    guest_email text,
    guest_name text,
    check_in date,
    check_out date,
    attempted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: room_rate_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_rate_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    room_id uuid NOT NULL,
    name text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    rate_per_night numeric(10,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: room_supply_allocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_supply_allocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    supply_item_id uuid NOT NULL,
    room_id uuid NOT NULL,
    week_start date NOT NULL,
    units_used numeric DEFAULT 0 NOT NULL,
    unit_cost numeric DEFAULT 0 NOT NULL,
    total_cost numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: room_supply_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_supply_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    room_id uuid,
    supply_item_id uuid NOT NULL,
    movement_type text NOT NULL,
    quantity numeric NOT NULL,
    unit_cost numeric DEFAULT 0 NOT NULL,
    total_cost numeric DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_supply_movements_type_check CHECK ((movement_type = ANY (ARRAY['purchase'::text, 'load'::text, 'use'::text, 'return'::text, 'adjustment'::text])))
);


--
-- Name: room_supply_room_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_supply_room_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    room_id uuid NOT NULL,
    supply_item_id uuid NOT NULL,
    quantity_on_hand numeric DEFAULT 0 NOT NULL,
    reorder_level numeric DEFAULT 0 NOT NULL,
    last_moved_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: room_supply_stocktake_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_supply_stocktake_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stocktake_id uuid NOT NULL,
    lodge_id uuid NOT NULL,
    room_stock_id uuid NOT NULL,
    room_id uuid NOT NULL,
    supply_item_id uuid NOT NULL,
    expected_qty numeric DEFAULT 0 NOT NULL,
    counted_qty numeric,
    variance_qty numeric,
    unit_cost numeric DEFAULT 0 NOT NULL,
    variance_cost numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: room_supply_stocktakes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.room_supply_stocktakes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    title text,
    notes text,
    status text DEFAULT 'open'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    counted_at timestamp with time zone,
    posted_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT room_supply_stocktakes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'posted'::text, 'cancelled'::text])))
);


--
-- Name: rooms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rooms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    room_number text NOT NULL,
    room_type text NOT NULL,
    rate_per_night numeric DEFAULT 0 NOT NULL,
    max_occupancy integer DEFAULT 2 NOT NULL,
    status text DEFAULT 'available'::text NOT NULL,
    housekeeping_status text DEFAULT 'clean'::text,
    housekeeping_notes text,
    description text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    photo text,
    photos text[] DEFAULT '{}'::text[],
    amenities text[] DEFAULT '{}'::text[],
    updated_at timestamp with time zone
);


--
-- Name: settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    lodge_name text,
    company_name text,
    address text,
    city text,
    country text,
    phone text,
    email text,
    website text,
    vat_number text,
    currency text DEFAULT 'P'::text,
    logo text,
    setup_complete boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    business_type text DEFAULT 'lodge'::text,
    trial_started_at timestamp with time zone,
    vat_enabled boolean DEFAULT false,
    vat_rate numeric DEFAULT 0,
    deleted boolean DEFAULT false,
    slug text,
    booking_tagline text,
    booking_description text,
    hero_image text,
    whatsapp_number text,
    booking_check_in_from text,
    booking_check_out_until text,
    booking_cancellation_policy text,
    booking_payment_terms text,
    booking_house_rules text,
    booking_faq jsonb DEFAULT '[]'::jsonb,
    lodge_mesh_secret text,
    assistant_enabled boolean DEFAULT false NOT NULL
);


--
-- Name: subscription_plan_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_plan_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_name text NOT NULL,
    version_code text NOT NULL,
    headline text,
    modules jsonb DEFAULT '[]'::jsonb NOT NULL,
    feature_flags jsonb DEFAULT '{}'::jsonb NOT NULL,
    pricing_meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supply_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supply_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    name text NOT NULL,
    category text DEFAULT 'Bathroom'::text NOT NULL,
    unit text DEFAULT 'piece'::text NOT NULL,
    latest_unit_cost numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    current_stock numeric DEFAULT 0 NOT NULL,
    reorder_level numeric DEFAULT 0 NOT NULL
);


--
-- Name: supply_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supply_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    item_id uuid NOT NULL,
    date date NOT NULL,
    quantity_purchased numeric NOT NULL,
    total_cost numeric NOT NULL,
    unit_cost numeric NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: supply_stocktake_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supply_stocktake_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    stocktake_id uuid NOT NULL,
    lodge_id uuid NOT NULL,
    item_id uuid NOT NULL,
    expected_qty numeric DEFAULT 0 NOT NULL,
    counted_qty numeric,
    variance_qty numeric,
    unit_cost numeric DEFAULT 0 NOT NULL,
    variance_cost numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: supply_stocktakes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supply_stocktakes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    title text,
    notes text,
    status text DEFAULT 'open'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    counted_at timestamp with time zone,
    posted_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT supply_stocktakes_status_check CHECK ((status = ANY (ARRAY['open'::text, 'posted'::text, 'cancelled'::text])))
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    lodge_name text,
    title text NOT NULL,
    description text NOT NULL,
    category text DEFAULT 'General'::text,
    priority text DEFAULT 'Normal'::text,
    status text DEFAULT 'open'::text,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    resolved_at timestamp with time zone
);


--
-- Name: test_data_reset_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_data_reset_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    triggered_by uuid,
    reset_mode text NOT NULL,
    reason text,
    deleted_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT test_data_reset_audit_mode_check CHECK ((reset_mode = ANY (ARRAY['recent_activity'::text, 'tagged_test_data'::text, 'full_demo_reset'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lodge_id uuid NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'staff'::text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    pwa_enabled boolean DEFAULT false NOT NULL,
    pwa_password_hash text,
    pwa_password_set_at timestamp with time zone,
    pwa_password_reset_by uuid,
    pwa_disabled_reason text,
    pin_hash text,
    allowed_outlet_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    auth_user_id uuid,
    last_sign_in_at timestamp with time zone,
    status text DEFAULT 'active'::text,
    last_desktop_sign_in_at timestamp with time zone,
    last_pwa_sign_in_at timestamp with time zone,
    last_activity_at timestamp with time zone,
    invite_sent_at timestamp with time zone,
    password_updated_at timestamp with time zone,
    capability_overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'archived'::text])))
);


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
)
PARTITION BY RANGE (inserted_at);


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: activity_logs activity_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.activity_logs
    ADD CONSTRAINT activity_logs_pkey PRIMARY KEY (id);


--
-- Name: app_sessions app_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_pkey PRIMARY KEY (id);


--
-- Name: app_sessions app_sessions_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_token_hash_key UNIQUE (token_hash);


--
-- Name: booking_charges booking_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_charges
    ADD CONSTRAINT booking_charges_pkey PRIMARY KEY (id);


--
-- Name: booking_email_delivery_log booking_email_delivery_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_email_delivery_log
    ADD CONSTRAINT booking_email_delivery_log_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_lodge_id_booking_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_lodge_id_booking_number_key UNIQUE (lodge_id, booking_number);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: broadcasts broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.broadcasts
    ADD CONSTRAINT broadcasts_pkey PRIMARY KEY (id);


--
-- Name: bookings chk_bookings_amount_paid_non_negative; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_amount_paid_non_negative CHECK ((amount_paid >= (0)::numeric)) NOT VALID;


--
-- Name: bookings chk_bookings_charges_total_non_negative; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_charges_total_non_negative CHECK ((charges_total >= (0)::numeric)) NOT VALID;


--
-- Name: bookings chk_bookings_total_amount_non_negative; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.bookings
    ADD CONSTRAINT chk_bookings_total_amount_non_negative CHECK ((total_amount >= (0)::numeric)) NOT VALID;


--
-- Name: conference_bookings conference_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conference_bookings
    ADD CONSTRAINT conference_bookings_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: device_health_reports device_health_reports_lodge_id_device_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_health_reports
    ADD CONSTRAINT device_health_reports_lodge_id_device_id_key UNIQUE (lodge_id, device_id);


--
-- Name: device_health_reports device_health_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_health_reports
    ADD CONSTRAINT device_health_reports_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: financial_audit_log financial_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_audit_log
    ADD CONSTRAINT financial_audit_log_pkey PRIMARY KEY (id);


--
-- Name: financial_validation_alerts financial_validation_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_validation_alerts
    ADD CONSTRAINT financial_validation_alerts_pkey PRIMARY KEY (id);


--
-- Name: financial_validation_runs financial_validation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_validation_runs
    ADD CONSTRAINT financial_validation_runs_pkey PRIMARY KEY (id);


--
-- Name: import_batches import_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.import_batches
    ADD CONSTRAINT import_batches_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: inventory_purchases inventory_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_purchases
    ADD CONSTRAINT inventory_purchases_pkey PRIMARY KEY (id);


--
-- Name: inventory_stocktake_lines inventory_stocktake_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stocktake_lines
    ADD CONSTRAINT inventory_stocktake_lines_pkey PRIMARY KEY (id);


--
-- Name: inventory_stocktake_lines inventory_stocktake_lines_stocktake_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stocktake_lines
    ADD CONSTRAINT inventory_stocktake_lines_stocktake_id_item_id_key UNIQUE (stocktake_id, item_id);


--
-- Name: inventory_stocktakes inventory_stocktakes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stocktakes
    ADD CONSTRAINT inventory_stocktakes_pkey PRIMARY KEY (id);


--
-- Name: invoice_delivery_log invoice_delivery_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_delivery_log
    ADD CONSTRAINT invoice_delivery_log_pkey PRIMARY KEY (id);


--
-- Name: invoice_sequences invoice_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_sequences
    ADD CONSTRAINT invoice_sequences_pkey PRIMARY KEY (lodge_id, year);


--
-- Name: invoices invoices_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_booking_id_key UNIQUE (booking_id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: licenses licenses_license_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licenses
    ADD CONSTRAINT licenses_license_key_key UNIQUE (license_key);


--
-- Name: licenses licenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.licenses
    ADD CONSTRAINT licenses_pkey PRIMARY KEY (id);


--
-- Name: lodge_features lodge_features_lodge_id_feature_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lodge_features
    ADD CONSTRAINT lodge_features_lodge_id_feature_name_key UNIQUE (lodge_id, feature_name);


--
-- Name: lodge_features lodge_features_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lodge_features
    ADD CONSTRAINT lodge_features_pkey PRIMARY KEY (id);


--
-- Name: maintenance_tickets maintenance_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_pkey PRIMARY KEY (id);


--
-- Name: master_admins master_admins_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_admins
    ADD CONSTRAINT master_admins_email_key UNIQUE (email);


--
-- Name: master_admins master_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.master_admins
    ADD CONSTRAINT master_admins_pkey PRIMARY KEY (id);


--
-- Name: bookings no_overlapping_bookings; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT no_overlapping_bookings EXCLUDE USING gist (room_id WITH =, lodge_id WITH =, daterange(check_in, check_out, '[)'::text) WITH &&) WHERE ((status <> 'cancelled'::text));


--
-- Name: online_booking_rate_limits online_booking_rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.online_booking_rate_limits
    ADD CONSTRAINT online_booking_rate_limits_pkey PRIMARY KEY (bucket_key);


--
-- Name: outlets outlets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outlets
    ADD CONSTRAINT outlets_pkey PRIMARY KEY (id);


--
-- Name: payments payments_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_idempotency_key_key UNIQUE (idempotency_key);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: pool_day_use pool_day_use_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pool_day_use
    ADD CONSTRAINT pool_day_use_pkey PRIMARY KEY (id);


--
-- Name: pos_menu_items pos_menu_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_menu_items
    ADD CONSTRAINT pos_menu_items_pkey PRIMARY KEY (id);


--
-- Name: pos_order_items pos_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_order_items
    ADD CONSTRAINT pos_order_items_pkey PRIMARY KEY (id);


--
-- Name: pos_orders pos_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_orders
    ADD CONSTRAINT pos_orders_pkey PRIMARY KEY (id);


--
-- Name: pos_override_log pos_override_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_override_log
    ADD CONSTRAINT pos_override_log_pkey PRIMARY KEY (id);


--
-- Name: pos_receipt_sequences pos_receipt_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_receipt_sequences
    ADD CONSTRAINT pos_receipt_sequences_pkey PRIMARY KEY (lodge_id, year);


--
-- Name: push_subscriptions push_subscriptions_lodge_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_lodge_id_endpoint_key UNIQUE (lodge_id, endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_converted_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_converted_booking_id_key UNIQUE (converted_booking_id);


--
-- Name: quotations quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);


--
-- Name: refund_approval_log refund_approval_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_approval_log
    ADD CONSTRAINT refund_approval_log_pkey PRIMARY KEY (id);


--
-- Name: rejected_online_bookings rejected_online_bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rejected_online_bookings
    ADD CONSTRAINT rejected_online_bookings_pkey PRIMARY KEY (id);


--
-- Name: room_rate_overrides room_rate_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_rate_overrides
    ADD CONSTRAINT room_rate_overrides_pkey PRIMARY KEY (id);


--
-- Name: room_supply_allocations room_supply_allocations_lodge_id_supply_item_id_room_id_wee_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_allocations
    ADD CONSTRAINT room_supply_allocations_lodge_id_supply_item_id_room_id_wee_key UNIQUE (lodge_id, supply_item_id, room_id, week_start);


--
-- Name: room_supply_allocations room_supply_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_allocations
    ADD CONSTRAINT room_supply_allocations_pkey PRIMARY KEY (id);


--
-- Name: room_supply_movements room_supply_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_movements
    ADD CONSTRAINT room_supply_movements_pkey PRIMARY KEY (id);


--
-- Name: room_supply_room_stock room_supply_room_stock_lodge_id_room_id_supply_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_room_stock
    ADD CONSTRAINT room_supply_room_stock_lodge_id_room_id_supply_item_id_key UNIQUE (lodge_id, room_id, supply_item_id);


--
-- Name: room_supply_room_stock room_supply_room_stock_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_room_stock
    ADD CONSTRAINT room_supply_room_stock_pkey PRIMARY KEY (id);


--
-- Name: room_supply_stocktake_lines room_supply_stocktake_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_stocktake_lines
    ADD CONSTRAINT room_supply_stocktake_lines_pkey PRIMARY KEY (id);


--
-- Name: room_supply_stocktake_lines room_supply_stocktake_lines_stocktake_id_room_stock_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_stocktake_lines
    ADD CONSTRAINT room_supply_stocktake_lines_stocktake_id_room_stock_id_key UNIQUE (stocktake_id, room_stock_id);


--
-- Name: room_supply_stocktakes room_supply_stocktakes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_stocktakes
    ADD CONSTRAINT room_supply_stocktakes_pkey PRIMARY KEY (id);


--
-- Name: rooms rooms_lodge_id_room_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_lodge_id_room_number_key UNIQUE (lodge_id, room_number);


--
-- Name: rooms rooms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rooms
    ADD CONSTRAINT rooms_pkey PRIMARY KEY (id);


--
-- Name: settings settings_lodge_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_lodge_id_key UNIQUE (lodge_id);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: subscription_events subscription_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_events
    ADD CONSTRAINT subscription_events_pkey PRIMARY KEY (id);


--
-- Name: subscription_plan_versions subscription_plan_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plan_versions
    ADD CONSTRAINT subscription_plan_versions_pkey PRIMARY KEY (id);


--
-- Name: subscription_plan_versions subscription_plan_versions_plan_name_version_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_plan_versions
    ADD CONSTRAINT subscription_plan_versions_plan_name_version_code_key UNIQUE (plan_name, version_code);


--
-- Name: supply_items supply_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supply_items
    ADD CONSTRAINT supply_items_pkey PRIMARY KEY (id);


--
-- Name: supply_purchases supply_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supply_purchases
    ADD CONSTRAINT supply_purchases_pkey PRIMARY KEY (id);


--
-- Name: supply_stocktake_lines supply_stocktake_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supply_stocktake_lines
    ADD CONSTRAINT supply_stocktake_lines_pkey PRIMARY KEY (id);


--
-- Name: supply_stocktake_lines supply_stocktake_lines_stocktake_id_item_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supply_stocktake_lines
    ADD CONSTRAINT supply_stocktake_lines_stocktake_id_item_id_key UNIQUE (stocktake_id, item_id);


--
-- Name: supply_stocktakes supply_stocktakes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supply_stocktakes
    ADD CONSTRAINT supply_stocktakes_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: test_data_reset_audit test_data_reset_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_data_reset_audit
    ADD CONSTRAINT test_data_reset_audit_pkey PRIMARY KEY (id);


--
-- Name: users users_email_lodge_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_lodge_unique UNIQUE (email, lodge_id);


--
-- Name: users users_lodge_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_lodge_id_email_key UNIQUE (lodge_id, email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: app_sessions_lodge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_sessions_lodge_idx ON public.app_sessions USING btree (lodge_id, session_type) WHERE (revoked_at IS NULL);


--
-- Name: app_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_sessions_user_idx ON public.app_sessions USING btree (user_id, lodge_id, session_type) WHERE (revoked_at IS NULL);


--
-- Name: booking_charges_active_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_charges_active_booking_idx ON public.booking_charges USING btree (booking_id, created_at) WHERE (voided_at IS NULL);


--
-- Name: booking_charges_booking_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_charges_booking_id_idx ON public.booking_charges USING btree (booking_id);


--
-- Name: booking_charges_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_charges_lodge_id_idx ON public.booking_charges USING btree (lodge_id);


--
-- Name: booking_email_delivery_log_booking_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_email_delivery_log_booking_created_idx ON public.booking_email_delivery_log USING btree (booking_id, created_at DESC);


--
-- Name: booking_email_delivery_log_lodge_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_email_delivery_log_lodge_created_idx ON public.booking_email_delivery_log USING btree (lodge_id, created_at DESC);


--
-- Name: booking_email_delivery_log_status_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX booking_email_delivery_log_status_created_idx ON public.booking_email_delivery_log USING btree (delivery_status, created_at DESC);


--
-- Name: bookings_cancel_reason_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_cancel_reason_idx ON public.bookings USING btree (lodge_id, cancel_reason) WHERE (cancel_reason IS NOT NULL);


--
-- Name: bookings_create_idempotency_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bookings_create_idempotency_key_uidx ON public.bookings USING btree (create_idempotency_key) WHERE (create_idempotency_key IS NOT NULL);


--
-- Name: bookings_import_batch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_import_batch_idx ON public.bookings USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);


--
-- Name: bookings_invoice_number_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX bookings_invoice_number_idx ON public.bookings USING btree (lodge_id, invoice_number);


--
-- Name: bookings_online_confirmation_token_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX bookings_online_confirmation_token_uidx ON public.bookings USING btree (online_confirmation_token) WHERE (online_confirmation_token IS NOT NULL);


--
-- Name: expenses_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX expenses_lodge_id_idx ON public.expenses USING btree (lodge_id);


--
-- Name: financial_audit_log_booking_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_audit_log_booking_id_idx ON public.financial_audit_log USING btree (booking_id);


--
-- Name: financial_audit_log_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_audit_log_created_at_idx ON public.financial_audit_log USING btree (created_at DESC);


--
-- Name: financial_audit_log_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_audit_log_lodge_id_idx ON public.financial_audit_log USING btree (lodge_id);


--
-- Name: financial_validation_alerts_lodge_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_validation_alerts_lodge_created_idx ON public.financial_validation_alerts USING btree (lodge_id, created_at DESC);


--
-- Name: financial_validation_runs_lodge_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX financial_validation_runs_lodge_created_idx ON public.financial_validation_runs USING btree (lodge_id, created_at DESC);


--
-- Name: idx_bookings_lodge_checkin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_lodge_checkin ON public.bookings USING btree (lodge_id, check_in);


--
-- Name: idx_bookings_lodge_checkout; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_lodge_checkout ON public.bookings USING btree (lodge_id, check_out);


--
-- Name: idx_bookings_lodge_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_lodge_status ON public.bookings USING btree (lodge_id, status);


--
-- Name: idx_inventory_stocktake_lines_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_stocktake_lines_item ON public.inventory_stocktake_lines USING btree (item_id);


--
-- Name: idx_inventory_stocktake_lines_stocktake; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_stocktake_lines_stocktake ON public.inventory_stocktake_lines USING btree (stocktake_id);


--
-- Name: idx_inventory_stocktakes_lodge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_stocktakes_lodge ON public.inventory_stocktakes USING btree (lodge_id, created_at DESC);


--
-- Name: idx_inventory_stocktakes_outlet; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_stocktakes_outlet ON public.inventory_stocktakes USING btree (outlet_id, created_at DESC);


--
-- Name: idx_pos_menu_items_barcode; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pos_menu_items_barcode ON public.pos_menu_items USING btree (lodge_id, barcode);


--
-- Name: idx_room_supply_movements_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_movements_item ON public.room_supply_movements USING btree (supply_item_id, created_at DESC);


--
-- Name: idx_room_supply_movements_lodge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_movements_lodge ON public.room_supply_movements USING btree (lodge_id, created_at DESC);


--
-- Name: idx_room_supply_movements_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_movements_room ON public.room_supply_movements USING btree (room_id, created_at DESC);


--
-- Name: idx_room_supply_room_stock_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_room_stock_item ON public.room_supply_room_stock USING btree (supply_item_id);


--
-- Name: idx_room_supply_room_stock_lodge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_room_stock_lodge ON public.room_supply_room_stock USING btree (lodge_id);


--
-- Name: idx_room_supply_room_stock_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_room_stock_room ON public.room_supply_room_stock USING btree (room_id);


--
-- Name: idx_room_supply_stocktake_lines_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_stocktake_lines_item ON public.room_supply_stocktake_lines USING btree (supply_item_id);


--
-- Name: idx_room_supply_stocktake_lines_room; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_stocktake_lines_room ON public.room_supply_stocktake_lines USING btree (room_id);


--
-- Name: idx_room_supply_stocktake_lines_room_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_stocktake_lines_room_stock ON public.room_supply_stocktake_lines USING btree (room_stock_id);


--
-- Name: idx_room_supply_stocktake_lines_stocktake; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_stocktake_lines_stocktake ON public.room_supply_stocktake_lines USING btree (stocktake_id);


--
-- Name: idx_room_supply_stocktakes_lodge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_room_supply_stocktakes_lodge ON public.room_supply_stocktakes USING btree (lodge_id, created_at DESC);


--
-- Name: idx_supply_stocktake_lines_item; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supply_stocktake_lines_item ON public.supply_stocktake_lines USING btree (item_id);


--
-- Name: idx_supply_stocktake_lines_stocktake; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supply_stocktake_lines_stocktake ON public.supply_stocktake_lines USING btree (stocktake_id);


--
-- Name: idx_supply_stocktakes_lodge; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supply_stocktakes_lodge ON public.supply_stocktakes USING btree (lodge_id, created_at DESC);


--
-- Name: invoice_delivery_log_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_delivery_log_booking_idx ON public.invoice_delivery_log USING btree (booking_id, created_at DESC);


--
-- Name: invoice_delivery_log_entry_hash_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoice_delivery_log_entry_hash_uidx ON public.invoice_delivery_log USING btree (entry_hash) WHERE (entry_hash IS NOT NULL);


--
-- Name: invoice_delivery_log_lodge_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoice_delivery_log_lodge_created_idx ON public.invoice_delivery_log USING btree (lodge_id, created_at DESC);


--
-- Name: invoices_booking_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_booking_id_idx ON public.invoices USING btree (booking_id);


--
-- Name: invoices_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX invoices_lodge_id_idx ON public.invoices USING btree (lodge_id);


--
-- Name: invoices_lodge_id_invoice_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX invoices_lodge_id_invoice_number_key ON public.invoices USING btree (lodge_id, invoice_number);


--
-- Name: licenses_one_active_assignment_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX licenses_one_active_assignment_idx ON public.licenses USING btree (lower(btrim((lodge_id)::text))) WHERE ((COALESCE(is_active, true) = true) AND (NULLIF(btrim((lodge_id)::text), ''::text) IS NOT NULL));


--
-- Name: licenses_subscription_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX licenses_subscription_state_idx ON public.licenses USING btree (subscription_state, next_due_date, expires_at);


--
-- Name: lodge_features_active_override_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX lodge_features_active_override_idx ON public.lodge_features USING btree (lodge_id, feature_name, expires_at);


--
-- Name: maintenance_tickets_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX maintenance_tickets_lodge_id_idx ON public.maintenance_tickets USING btree (lodge_id);


--
-- Name: online_booking_rate_limits_lodge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX online_booking_rate_limits_lodge_idx ON public.online_booking_rate_limits USING btree (lodge_id, bucket_type);


--
-- Name: outlets_lodge_name_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX outlets_lodge_name_uidx ON public.outlets USING btree (lodge_id, name);


--
-- Name: payments_booking_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_booking_id_idx ON public.payments USING btree (booking_id);


--
-- Name: payments_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_lodge_id_idx ON public.payments USING btree (lodge_id);


--
-- Name: pos_orders_lodge_idempotency_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pos_orders_lodge_idempotency_uidx ON public.pos_orders USING btree (lodge_id, create_idempotency_key) WHERE (create_idempotency_key IS NOT NULL);


--
-- Name: quotations_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotations_customer_id_idx ON public.quotations USING btree (customer_id);


--
-- Name: quotations_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotations_lodge_id_idx ON public.quotations USING btree (lodge_id);


--
-- Name: quotations_lodge_id_quotation_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotations_lodge_id_quotation_number_key ON public.quotations USING btree (lodge_id, quotation_number);


--
-- Name: quotations_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX quotations_status_idx ON public.quotations USING btree (status);


--
-- Name: refund_approval_log_booking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refund_approval_log_booking_idx ON public.refund_approval_log USING btree (booking_id, created_at DESC);


--
-- Name: refund_approval_log_lodge_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refund_approval_log_lodge_created_idx ON public.refund_approval_log USING btree (lodge_id, created_at DESC);


--
-- Name: rejected_online_bookings_lodge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rejected_online_bookings_lodge_idx ON public.rejected_online_bookings USING btree (lodge_id, attempted_at DESC);


--
-- Name: rejected_online_bookings_room_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rejected_online_bookings_room_idx ON public.rejected_online_bookings USING btree (lodge_id, room_id, attempted_at DESC);


--
-- Name: room_rate_overrides_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX room_rate_overrides_lodge_id_idx ON public.room_rate_overrides USING btree (lodge_id);


--
-- Name: settings_slug_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX settings_slug_unique ON public.settings USING btree (lower(btrim(slug))) WHERE ((slug IS NOT NULL) AND (btrim(slug) <> ''::text));


--
-- Name: subscription_events_event_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_events_event_type_idx ON public.subscription_events USING btree (event_type, created_at DESC);


--
-- Name: subscription_events_license_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_events_license_id_idx ON public.subscription_events USING btree (license_id, created_at DESC);


--
-- Name: subscription_events_lodge_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_events_lodge_id_idx ON public.subscription_events USING btree (lodge_id, created_at DESC);


--
-- Name: test_data_reset_audit_lodge_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX test_data_reset_audit_lodge_created_idx ON public.test_data_reset_audit USING btree (lodge_id, created_at DESC);


--
-- Name: users_admin_email_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_admin_email_unique ON public.users USING btree (email) WHERE (role = ANY (ARRAY['admin'::text, 'super_admin'::text]));


--
-- Name: users_auth_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_auth_user_id_idx ON public.users USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);


--
-- Name: users_lodge_auth_user_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_lodge_auth_user_uidx ON public.users USING btree (lodge_id, auth_user_id) WHERE (auth_user_id IS NOT NULL);


--
-- Name: users_lodge_email_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_lodge_email_lookup_idx ON public.users USING btree (lodge_id, lower(btrim(email)));


--
-- Name: users_pwa_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_pwa_lookup_idx ON public.users USING btree (lower(btrim(email)), lodge_id, role);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_key; Type: INDEX; Schema: realtime; Owner: -
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_key ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: maintenance_tickets maintenance_room_status_sync; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER maintenance_room_status_sync AFTER INSERT OR DELETE OR UPDATE OF status, room_id ON public.maintenance_tickets FOR EACH ROW EXECUTE FUNCTION public.sync_room_maintenance_status();


--
-- Name: bookings trg_apply_booking_vat_snapshot; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_apply_booking_vat_snapshot BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.apply_booking_vat_snapshot();


--
-- Name: bookings trg_enforce_booking_usage_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_booking_usage_limit BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.enforce_usage_limits_on_insert();


--
-- Name: rooms trg_enforce_room_usage_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_room_usage_limit BEFORE INSERT ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.enforce_usage_limits_on_insert();


--
-- Name: users trg_enforce_user_usage_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_user_usage_limit BEFORE INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.enforce_usage_limits_on_insert();


--
-- Name: invoice_delivery_log trg_invoice_delivery_log_hash; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_invoice_delivery_log_hash BEFORE INSERT ON public.invoice_delivery_log FOR EACH ROW EXECUTE FUNCTION public._invoice_delivery_log_hash();


--
-- Name: pos_order_items trg_populate_pos_order_item_inventory_link; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_populate_pos_order_item_inventory_link BEFORE INSERT OR UPDATE OF menu_item_id, item_name, inventory_item_id, depletion_qty ON public.pos_order_items FOR EACH ROW EXECUTE FUNCTION public.populate_pos_order_item_inventory_link();


--
-- Name: bookings trg_set_booking_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_booking_number BEFORE INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_booking_number();


--
-- Name: bookings trg_single_active_event_booking; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_single_active_event_booking BEFORE INSERT OR UPDATE OF lodge_id, is_exclusive_event, status, notes ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.guard_single_active_event_booking();


--
-- Name: booking_charges trg_sync_charges_total; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_charges_total AFTER INSERT OR DELETE OR UPDATE ON public.booking_charges FOR EACH ROW EXECUTE FUNCTION public.sync_booking_charges_total();


--
-- Name: booking_charges trig_audit_charge_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_audit_charge_change AFTER INSERT OR DELETE ON public.booking_charges FOR EACH ROW EXECUTE FUNCTION public._audit_booking_charge();


--
-- Name: payments trig_audit_payment_insert; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_audit_payment_insert AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION public._audit_payment_insert();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: app_sessions app_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: booking_charges booking_charges_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_charges
    ADD CONSTRAINT booking_charges_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_charges booking_charges_outlet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_charges
    ADD CONSTRAINT booking_charges_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES public.outlets(id);


--
-- Name: booking_email_delivery_log booking_email_delivery_log_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_email_delivery_log
    ADD CONSTRAINT booking_email_delivery_log_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: bookings bookings_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;


--
-- Name: bookings bookings_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id);


--
-- Name: bookings bookings_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id);


--
-- Name: customers customers_import_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES public.import_batches(id) ON DELETE SET NULL;


--
-- Name: device_health_reports device_health_reports_lodge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_health_reports
    ADD CONSTRAINT device_health_reports_lodge_id_fkey FOREIGN KEY (lodge_id) REFERENCES public.settings(lodge_id) ON DELETE CASCADE;


--
-- Name: expenses expenses_outlet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES public.outlets(id);


--
-- Name: financial_validation_alerts financial_validation_alerts_lodge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_validation_alerts
    ADD CONSTRAINT financial_validation_alerts_lodge_id_fkey FOREIGN KEY (lodge_id) REFERENCES public.settings(lodge_id) ON DELETE CASCADE;


--
-- Name: financial_validation_runs financial_validation_runs_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.financial_validation_runs
    ADD CONSTRAINT financial_validation_runs_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.users(id);


--
-- Name: inventory_items inventory_items_outlet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES public.outlets(id);


--
-- Name: inventory_purchases inventory_purchases_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_purchases
    ADD CONSTRAINT inventory_purchases_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: inventory_stocktake_lines inventory_stocktake_lines_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stocktake_lines
    ADD CONSTRAINT inventory_stocktake_lines_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.inventory_items(id) ON DELETE CASCADE;


--
-- Name: inventory_stocktake_lines inventory_stocktake_lines_stocktake_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stocktake_lines
    ADD CONSTRAINT inventory_stocktake_lines_stocktake_id_fkey FOREIGN KEY (stocktake_id) REFERENCES public.inventory_stocktakes(id) ON DELETE CASCADE;


--
-- Name: inventory_stocktakes inventory_stocktakes_outlet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_stocktakes
    ADD CONSTRAINT inventory_stocktakes_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES public.outlets(id) ON DELETE SET NULL;


--
-- Name: invoice_delivery_log invoice_delivery_log_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_delivery_log
    ADD CONSTRAINT invoice_delivery_log_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: invoice_delivery_log invoice_delivery_log_initiated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoice_delivery_log
    ADD CONSTRAINT invoice_delivery_log_initiated_by_fkey FOREIGN KEY (initiated_by) REFERENCES public.users(id);


--
-- Name: invoices invoices_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: maintenance_tickets maintenance_tickets_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_tickets
    ADD CONSTRAINT maintenance_tickets_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE RESTRICT;


--
-- Name: payments payments_conference_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_conference_booking_id_fkey FOREIGN KEY (conference_booking_id) REFERENCES public.conference_bookings(id) ON DELETE CASCADE;


--
-- Name: pos_menu_items pos_menu_items_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_menu_items
    ADD CONSTRAINT pos_menu_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id) ON DELETE SET NULL;


--
-- Name: pos_menu_items pos_menu_items_outlet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_menu_items
    ADD CONSTRAINT pos_menu_items_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES public.outlets(id);


--
-- Name: pos_order_items pos_order_items_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_order_items
    ADD CONSTRAINT pos_order_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory_items(id);


--
-- Name: pos_order_items pos_order_items_menu_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_order_items
    ADD CONSTRAINT pos_order_items_menu_item_id_fkey FOREIGN KEY (menu_item_id) REFERENCES public.pos_menu_items(id) ON DELETE SET NULL;


--
-- Name: pos_order_items pos_order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_order_items
    ADD CONSTRAINT pos_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.pos_orders(id) ON DELETE CASCADE;


--
-- Name: pos_orders pos_orders_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_orders
    ADD CONSTRAINT pos_orders_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: pos_orders pos_orders_folio_charge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_orders
    ADD CONSTRAINT pos_orders_folio_charge_id_fkey FOREIGN KEY (folio_charge_id) REFERENCES public.booking_charges(id) ON DELETE SET NULL;


--
-- Name: pos_orders pos_orders_outlet_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_orders
    ADD CONSTRAINT pos_orders_outlet_id_fkey FOREIGN KEY (outlet_id) REFERENCES public.outlets(id);


--
-- Name: pos_orders pos_orders_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pos_orders
    ADD CONSTRAINT pos_orders_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_converted_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_converted_booking_id_fkey FOREIGN KEY (converted_booking_id) REFERENCES public.bookings(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_parent_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_parent_quotation_id_fkey FOREIGN KEY (parent_quotation_id) REFERENCES public.quotations(id);


--
-- Name: quotations quotations_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;


--
-- Name: refund_approval_log refund_approval_log_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_approval_log
    ADD CONSTRAINT refund_approval_log_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: refund_approval_log refund_approval_log_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_approval_log
    ADD CONSTRAINT refund_approval_log_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: refund_approval_log refund_approval_log_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_approval_log
    ADD CONSTRAINT refund_approval_log_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: room_rate_overrides room_rate_overrides_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_rate_overrides
    ADD CONSTRAINT room_rate_overrides_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_supply_allocations room_supply_allocations_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_allocations
    ADD CONSTRAINT room_supply_allocations_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_supply_allocations room_supply_allocations_supply_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_allocations
    ADD CONSTRAINT room_supply_allocations_supply_item_id_fkey FOREIGN KEY (supply_item_id) REFERENCES public.supply_items(id) ON DELETE CASCADE;


--
-- Name: room_supply_movements room_supply_movements_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_movements
    ADD CONSTRAINT room_supply_movements_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE SET NULL;


--
-- Name: room_supply_movements room_supply_movements_supply_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_movements
    ADD CONSTRAINT room_supply_movements_supply_item_id_fkey FOREIGN KEY (supply_item_id) REFERENCES public.supply_items(id) ON DELETE CASCADE;


--
-- Name: room_supply_room_stock room_supply_room_stock_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_room_stock
    ADD CONSTRAINT room_supply_room_stock_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_supply_room_stock room_supply_room_stock_supply_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_room_stock
    ADD CONSTRAINT room_supply_room_stock_supply_item_id_fkey FOREIGN KEY (supply_item_id) REFERENCES public.supply_items(id) ON DELETE CASCADE;


--
-- Name: room_supply_stocktake_lines room_supply_stocktake_lines_room_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_stocktake_lines
    ADD CONSTRAINT room_supply_stocktake_lines_room_id_fkey FOREIGN KEY (room_id) REFERENCES public.rooms(id) ON DELETE CASCADE;


--
-- Name: room_supply_stocktake_lines room_supply_stocktake_lines_stocktake_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_stocktake_lines
    ADD CONSTRAINT room_supply_stocktake_lines_stocktake_id_fkey FOREIGN KEY (stocktake_id) REFERENCES public.room_supply_stocktakes(id) ON DELETE CASCADE;


--
-- Name: room_supply_stocktake_lines room_supply_stocktake_lines_supply_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.room_supply_stocktake_lines
    ADD CONSTRAINT room_supply_stocktake_lines_supply_item_id_fkey FOREIGN KEY (supply_item_id) REFERENCES public.supply_items(id) ON DELETE CASCADE;


--
-- Name: supply_purchases supply_purchases_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supply_purchases
    ADD CONSTRAINT supply_purchases_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.supply_items(id) ON DELETE CASCADE;


--
-- Name: supply_stocktake_lines supply_stocktake_lines_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supply_stocktake_lines
    ADD CONSTRAINT supply_stocktake_lines_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.supply_items(id) ON DELETE CASCADE;


--
-- Name: supply_stocktake_lines supply_stocktake_lines_stocktake_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supply_stocktake_lines
    ADD CONSTRAINT supply_stocktake_lines_stocktake_id_fkey FOREIGN KEY (stocktake_id) REFERENCES public.supply_stocktakes(id) ON DELETE CASCADE;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings Allow all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all" ON public.bookings USING (true) WITH CHECK (true);


--
-- Name: customers Allow all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all" ON public.customers USING (true) WITH CHECK (true);


--
-- Name: rooms Allow all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all" ON public.rooms USING (true) WITH CHECK (true);


--
-- Name: settings Allow all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all" ON public.settings USING (true) WITH CHECK (true);


--
-- Name: users Allow all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all" ON public.users USING (true) WITH CHECK (true);


--
-- Name: activity_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: app_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_audit_log audit_log_select_own_lodge; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_log_select_own_lodge ON public.financial_audit_log FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: booking_charges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_charges ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_charges booking_charges_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_charges_lodge_scope_select ON public.booking_charges FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: booking_email_delivery_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.booking_email_delivery_log ENABLE ROW LEVEL SECURITY;

--
-- Name: booking_email_delivery_log booking_email_delivery_log_select_own_lodge; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY booking_email_delivery_log_select_own_lodge ON public.booking_email_delivery_log FOR SELECT USING (((lodge_id IS NOT NULL) AND public.app_lodge_access(lodge_id)));


--
-- Name: bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: bookings bookings_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bookings_lodge_scope_select ON public.bookings FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: broadcasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.broadcasts ENABLE ROW LEVEL SECURITY;

--
-- Name: conference_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conference_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: conference_bookings conference_bookings_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conference_bookings_lodge_scope_select ON public.conference_bookings FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- Name: customers customers_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_lodge_scope_select ON public.customers FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: device_health_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_health_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: expenses expenses_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_lodge_scope_select ON public.expenses FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: financial_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_validation_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_validation_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_validation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.financial_validation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: financial_validation_runs financial_validation_runs_select_own_lodge; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY financial_validation_runs_select_own_lodge ON public.financial_validation_runs FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: import_batches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

--
-- Name: import_batches import_batches_lodge_access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY import_batches_lodge_access ON public.import_batches USING (public.app_lodge_access(lodge_id));


--
-- Name: inventory_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_items inventory_items_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_items_lodge_scope_select ON public.inventory_items FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: inventory_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_stocktake_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_stocktake_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: inventory_stocktakes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_stocktakes ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_delivery_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_delivery_log ENABLE ROW LEVEL SECURITY;

--
-- Name: invoice_delivery_log invoice_delivery_log_select_own_lodge; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoice_delivery_log_select_own_lodge ON public.invoice_delivery_log FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: invoice_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices invoices_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_lodge_scope_select ON public.invoices FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: licenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

--
-- Name: device_health_reports lodge members can manage device health; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "lodge members can manage device health" ON public.device_health_reports USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: lodge_features; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.lodge_features ENABLE ROW LEVEL SECURITY;

--
-- Name: lodge_features lodge_features_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lodge_features_lodge_scope_select ON public.lodge_features FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: rejected_online_bookings lodge_read_rejected_bookings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY lodge_read_rejected_bookings ON public.rejected_online_bookings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (u.lodge_id = rejected_online_bookings.lodge_id)))));


--
-- Name: maintenance_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.maintenance_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: maintenance_tickets maintenance_tickets_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY maintenance_tickets_lodge_scope_select ON public.maintenance_tickets FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: master_admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.master_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: online_booking_rate_limits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.online_booking_rate_limits ENABLE ROW LEVEL SECURITY;

--
-- Name: outlets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outlets ENABLE ROW LEVEL SECURITY;

--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_lodge_scope_select ON public.payments FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: pool_day_use; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pool_day_use ENABLE ROW LEVEL SECURITY;

--
-- Name: pool_day_use pool_day_use_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pool_day_use_lodge_scope_select ON public.pool_day_use FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: pos_menu_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_menu_items ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_menu_items pos_menu_items_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pos_menu_items_lodge_scope_select ON public.pos_menu_items FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: pos_order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_order_items ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_order_items pos_order_items_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pos_order_items_lodge_scope_select ON public.pos_order_items FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: pos_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_orders pos_orders_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pos_orders_lodge_scope_select ON public.pos_orders FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: pos_override_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_override_log ENABLE ROW LEVEL SECURITY;

--
-- Name: pos_receipt_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pos_receipt_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_lodge_scope_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_lodge_scope_delete ON public.push_subscriptions FOR DELETE USING (public.app_lodge_access((lodge_id)::uuid));


--
-- Name: push_subscriptions push_subscriptions_lodge_scope_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_lodge_scope_insert ON public.push_subscriptions FOR INSERT WITH CHECK (public.app_lodge_access((lodge_id)::uuid));


--
-- Name: push_subscriptions push_subscriptions_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_lodge_scope_select ON public.push_subscriptions FOR SELECT USING (public.app_lodge_access((lodge_id)::uuid));


--
-- Name: push_subscriptions push_subscriptions_lodge_scope_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_lodge_scope_update ON public.push_subscriptions FOR UPDATE USING (public.app_lodge_access((lodge_id)::uuid)) WITH CHECK (public.app_lodge_access((lodge_id)::uuid));


--
-- Name: quotations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

--
-- Name: quotations quotations_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_lodge_scope_select ON public.quotations FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: refund_approval_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refund_approval_log ENABLE ROW LEVEL SECURITY;

--
-- Name: refund_approval_log refund_approval_log_select_own_lodge; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refund_approval_log_select_own_lodge ON public.refund_approval_log FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: rejected_online_bookings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rejected_online_bookings ENABLE ROW LEVEL SECURITY;

--
-- Name: room_rate_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_rate_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: room_supply_allocations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_supply_allocations ENABLE ROW LEVEL SECURITY;

--
-- Name: room_supply_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_supply_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: room_supply_room_stock; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_supply_room_stock ENABLE ROW LEVEL SECURITY;

--
-- Name: room_supply_stocktake_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_supply_stocktake_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: room_supply_stocktakes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.room_supply_stocktakes ENABLE ROW LEVEL SECURITY;

--
-- Name: rooms; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

--
-- Name: rooms rooms_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY rooms_lodge_scope_select ON public.rooms FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

--
-- Name: settings settings_lodge_scope_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_lodge_scope_insert ON public.settings FOR INSERT WITH CHECK (public.app_lodge_access(lodge_id));


--
-- Name: settings settings_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_lodge_scope_select ON public.settings FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: settings settings_lodge_scope_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_lodge_scope_update ON public.settings FOR UPDATE USING (public.app_lodge_access(lodge_id)) WITH CHECK (public.app_lodge_access(lodge_id));


--
-- Name: subscription_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_plan_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_plan_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: supply_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supply_items ENABLE ROW LEVEL SECURITY;

--
-- Name: supply_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supply_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: supply_stocktake_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supply_stocktake_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: supply_stocktakes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.supply_stocktakes ENABLE ROW LEVEL SECURITY;

--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: test_data_reset_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.test_data_reset_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: test_data_reset_audit test_data_reset_audit_select_own_lodge; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY test_data_reset_audit_select_own_lodge ON public.test_data_reset_audit FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_lodge_scope_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_lodge_scope_select ON public.users FOR SELECT USING (public.app_lodge_access(lodge_id));


--
-- Name: users users_no_hash_via_anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_no_hash_via_anon ON public.users FOR SELECT USING (true);


--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict 1IsXc1BpiF4mZd94uUpOXs1rvfdzeHMCdsTq8erhSJnhISCAFw6Au5NPIwtrYB4


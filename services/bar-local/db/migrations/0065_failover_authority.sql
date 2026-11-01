-- Witness-gated automatic failover fencing.
--
-- The local database records whether this authority copy is allowed to write
-- and the epoch at which it was last promoted. Promotion is a one-way,
-- epoch-monotonic transition. There is deliberately no "resume" or "unfence"
-- function: a fenced or stale host can only return to service by being
-- re-enrolled as a standby from the current primary. That keeps a partitioned
-- old primary from silently re-joining after a failover.
--
-- Scope: local Bar database only. Never apply this file to hosted Supabase.

CREATE TABLE IF NOT EXISTS bar_local.failover_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  fenced boolean NOT NULL DEFAULT false,
  fence_epoch bigint NOT NULL DEFAULT 0 CHECK (fence_epoch >= 0),
  fence_reason text,
  fenced_at timestamptz,
  promoted_epoch bigint,
  promoted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bar_local.failover_state (singleton) VALUES (true) ON CONFLICT DO NOTHING;
REVOKE ALL ON TABLE bar_local.failover_state FROM PUBLIC;
REVOKE ALL ON TABLE bar_local.failover_state FROM bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.authority_fenced()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, bar_local
AS $$
  SELECT COALESCE((SELECT fenced FROM bar_local.failover_state WHERE singleton), false);
$$;
REVOKE ALL ON FUNCTION bar_local.authority_fenced() FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.authority_fenced() FROM bar_local_runtime;

-- Replace the trusted session with a fence-aware version. The fence check is
-- placed before the session lookup so every session-scoped command fails
-- closed, including a command presented by an otherwise valid operator.
CREATE OR REPLACE FUNCTION bar_local.current_session(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_business_id uuid,
  p_outlet_id uuid
) RETURNS bar_local.session_context LANGUAGE plpgsql AS $$
DECLARE
  v_authority bar_local.authority%ROWTYPE;
  v_session bar_local.sessions%ROWTYPE;
  v_staff bar_local.staff%ROWTYPE;
  v_device bar_local.devices%ROWTYPE;
BEGIN
  SELECT * INTO v_authority FROM bar_local.authority WHERE singleton;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local Bar authority has not been commissioned.');
  END IF;
  IF v_authority.authority_id <> p_authority_id THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY', 'This operation targets a different local authority.');
  END IF;
  IF v_authority.authority_epoch <> p_authority_epoch THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY_EPOCH', 'This operation targets an expired local authority epoch.');
  END IF;
  IF bar_local.authority_fenced() THEN
    PERFORM bar_local.raise_business('AUTHORITY_FENCED', 'This local authority copy is fenced after a failover event. Trading stays stopped until the verified recovery procedure is complete.');
  END IF;
  SELECT * INTO v_session FROM bar_local.sessions
   WHERE token_hash = p_token_hash FOR SHARE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTH_INVALID', 'The local session credential is not valid.');
  END IF;
  IF v_session.revoked_at IS NOT NULL THEN
    PERFORM bar_local.raise_business('SESSION_REVOKED', 'This local session has been revoked.');
  END IF;
  IF v_session.expires_at <= now() THEN
    PERFORM bar_local.raise_business('SESSION_EXPIRED', 'This local session has expired.');
  END IF;
  IF v_session.authority_epoch <> p_authority_epoch THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY_EPOCH', 'This local session belongs to an older authority epoch.');
  END IF;
  IF v_session.device_id <> p_device_id OR v_session.business_id <> p_business_id OR v_session.outlet_id <> p_outlet_id THEN
    PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The operation scope does not match the authenticated session.');
  END IF;
  SELECT * INTO v_device FROM bar_local.devices WHERE id = v_session.device_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('DEVICE_UNKNOWN', 'The paired device could not be found.');
  END IF;
  IF v_device.status = 'revoked' THEN
    PERFORM bar_local.raise_business('DEVICE_REVOKED', 'This device has been revoked.');
  END IF;
  IF v_device.business_id <> p_business_id OR v_device.outlet_id <> p_outlet_id THEN
    PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The paired device is not scoped to this business and outlet.');
  END IF;
  SELECT * INTO v_staff FROM bar_local.staff WHERE id = v_session.staff_id;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTH_INVALID', 'The authenticated staff identity no longer exists.');
  END IF;
  IF v_staff.status <> 'active' THEN
    PERFORM bar_local.raise_business('SESSION_REVOKED', 'This staff identity is suspended.');
  END IF;
  IF v_staff.business_id <> p_business_id THEN
    PERFORM bar_local.raise_business('TENANT_SCOPE_MISMATCH', 'The staff identity belongs to another business.');
  END IF;
  RETURN (v_session.id, v_staff.id, v_staff.business_id, v_session.outlet_id,
          v_staff.role, v_staff.capabilities, v_staff.display_name, v_session.device_id);
END;
$$;

-- Defence in depth: a sequence allocation is the narrow gateway every
-- committed financial event passes through. Refuse it while fenced even if a
-- caller somehow reached the command body without current_session.
CREATE OR REPLACE FUNCTION bar_local.allocate_sequence(p_allocate_receipt boolean DEFAULT false)
RETURNS TABLE (commit_sequence bigint, receipt_sequence bigint) LANGUAGE plpgsql AS $$
#variable_conflict use_column
BEGIN
  IF pg_is_in_recovery() OR current_setting('transaction_read_only') = 'on'
     OR current_setting('fsync') <> 'on' OR current_setting('full_page_writes') <> 'on' THEN
    PERFORM bar_local.raise_business('SERVICE_UNAVAILABLE', 'Durable local writes are unavailable. Keep the original operation and contact the owner.');
  END IF;
  IF bar_local.authority_fenced() THEN
    PERFORM bar_local.raise_business('AUTHORITY_FENCED', 'This local authority copy is fenced after a failover event. Trading stays stopped until the verified recovery procedure is complete.');
  END IF;
  PERFORM set_config('synchronous_commit', 'on', true);
  UPDATE bar_local.authority_counter
     SET commit_sequence = commit_sequence + 1,
         receipt_sequence = receipt_sequence + CASE WHEN p_allocate_receipt THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE singleton
  RETURNING authority_counter.commit_sequence, authority_counter.receipt_sequence
       INTO commit_sequence, receipt_sequence;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local authority counter is missing.');
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION bar_local.allocate_sequence(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.allocate_sequence(boolean) FROM bar_local_runtime;

-- Read-only projection for the service and the administration panel.
CREATE OR REPLACE FUNCTION bar_local.service_failover_status()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, bar_local
AS $$
  SELECT jsonb_build_object(
    'fenced', fs.fenced,
    'fence_epoch', fs.fence_epoch,
    'fence_reason', fs.fence_reason,
    'fenced_at', fs.fenced_at,
    'promoted_epoch', fs.promoted_epoch,
    'promoted_at', fs.promoted_at,
    'authority_id', a.authority_id,
    'authority_epoch', a.authority_epoch,
    'business_id', a.business_id,
    'in_recovery', pg_is_in_recovery()
  )
  FROM bar_local.failover_state fs
  CROSS JOIN bar_local.authority a
  WHERE fs.singleton AND a.singleton;
$$;

-- Fence this authority copy. This is the only failover function available to a
-- host that may be stale or partitioned. It can stop writes; it can never
-- grant them. Backend termination is best effort: the migrator role does not
-- have pg_signal_backend unless the operator granted it, and the fence flag is
-- the authoritative mechanism either way.
CREATE OR REPLACE FUNCTION bar_local.service_failover_fence(p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, bar_local
AS $$
DECLARE
  v_epoch bigint;
BEGIN
  IF p_reason IS NULL OR p_reason !~ '^[A-Z][A-Z0-9_]{2,80}$' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A stable upper-case fence reason code is required.');
  END IF;
  UPDATE bar_local.failover_state
     SET fenced = true,
         fence_epoch = GREATEST(fence_epoch, COALESCE((SELECT authority_epoch FROM bar_local.authority WHERE singleton), 0)),
         fence_reason = p_reason,
         fenced_at = now(),
         updated_at = now()
   WHERE singleton
   RETURNING fence_epoch INTO v_epoch;
  IF v_epoch IS NULL THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local failover state is missing.');
  END IF;

  BEGIN
    PERFORM pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE datname = current_database()
        AND usename = 'bar_local_runtime'
        AND pid <> pg_backend_pid();
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  RETURN bar_local.service_failover_status();
END;
$$;

-- Promote this copy to the authority for p_epoch. Promotion must move exactly
-- one epoch forward, so a host that skipped an epoch cannot be legitimised by
-- this function. The authority update, session revocation and fence clear are
-- one transaction.
CREATE OR REPLACE FUNCTION bar_local.service_failover_promote(
  p_epoch bigint,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, bar_local
AS $$
DECLARE
  v_authority bar_local.authority%ROWTYPE;
  v_state bar_local.failover_state%ROWTYPE;
  v_outlet uuid;
  v_new bigint;
BEGIN
  IF p_epoch IS NULL OR p_epoch <= 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A positive promotion epoch is required.');
  END IF;
  -- The promoted host has no standby yet, so a synchronous commit would wait
  -- for a WAL sender that cannot exist until the old host is re-enrolled. This
  -- session-local setting applies only to this promotion transaction; trading
  -- connections keep their own durability setting.
  PERFORM set_config('synchronous_commit', 'local', true);
  SELECT * INTO v_authority FROM bar_local.authority WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local Bar authority has not been commissioned.');
  END IF;
  SELECT * INTO v_state FROM bar_local.failover_state WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('AUTHORITY_NOT_COMMISSIONED', 'The local failover state is missing.');
  END IF;
  IF p_epoch <> v_authority.authority_epoch + 1 THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY_EPOCH', 'Promotion must advance the authority epoch by exactly one.');
  END IF;
  IF p_epoch <= v_state.fence_epoch THEN
    PERFORM bar_local.raise_business('WRONG_AUTHORITY_EPOCH', 'The promotion epoch is not newer than the recorded fence epoch.');
  END IF;

  UPDATE bar_local.authority
     SET authority_epoch = p_epoch
   WHERE singleton
  RETURNING authority_epoch INTO v_new;
  UPDATE bar_local.failover_state
     SET fenced = false,
         fence_epoch = p_epoch,
         fence_reason = NULL,
         fenced_at = NULL,
         promoted_epoch = p_epoch,
         promoted_at = now(),
         updated_at = now()
   WHERE singleton;
  UPDATE bar_local.sessions SET revoked_at = now() WHERE revoked_at IS NULL;

  SELECT id INTO v_outlet FROM bar_local.outlets
   WHERE business_id = v_authority.business_id
   ORDER BY created_at
   LIMIT 1;
  INSERT INTO bar_local.audit_log (business_id, outlet_id, action, after)
  VALUES (
    v_authority.business_id,
    COALESCE(v_outlet, v_authority.business_id),
    'failover.promoted',
    jsonb_build_object('authority_epoch', v_new, 'evidence', COALESCE(p_evidence, '{}'::jsonb))
  );

  RETURN jsonb_build_object(
    'promoted', true,
    'authority_epoch', v_new,
    'promoted_at', (SELECT promoted_at FROM bar_local.failover_state WHERE singleton)
  );
END;
$$;

-- Readiness must say "fenced" explicitly rather than only "read only".
ALTER FUNCTION bar_local.service_readiness(text, uuid) RENAME TO service_readiness_before_failover;
REVOKE ALL ON FUNCTION bar_local.service_readiness_before_failover(text, uuid) FROM PUBLIC, bar_local_runtime;
CREATE OR REPLACE FUNCTION bar_local.service_readiness(p_token_hash text, p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, bar_local
AS $$
DECLARE
  v_result jsonb;
  v_blockers jsonb;
BEGIN
  v_result := bar_local.service_readiness_before_failover(p_token_hash, p_device_id);
  v_blockers := v_result->'blockers';
  IF bar_local.authority_fenced() THEN
    v_blockers := v_blockers || '["authority_fenced"]'::jsonb;
  END IF;
  RETURN v_result || jsonb_build_object(
    'blockers', v_blockers,
    'ready', jsonb_array_length(v_blockers) = 0,
    'fenced', bar_local.authority_fenced()
  );
END;
$$;
REVOKE ALL ON FUNCTION bar_local.service_readiness(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.service_readiness(text, uuid) TO bar_local_runtime;

-- Narrow runtime surface. Each function is explicitly definer-owned and
-- schema-pinned; the runtime still has no direct table access.
DO $failover_grants$
DECLARE
  v_fn regprocedure;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'bar_local'
       AND p.proname IN ('service_failover_status', 'service_failover_fence', 'service_failover_promote')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', v_fn);
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, bar_local', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM bar_local_runtime', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO bar_local_runtime', v_fn);
  END LOOP;
END;
$failover_grants$;

INSERT INTO bar_local.runtime_function_allowlist (function_name)
VALUES ('service_failover_status'), ('service_failover_fence'), ('service_failover_promote')
ON CONFLICT (function_name) DO NOTHING;

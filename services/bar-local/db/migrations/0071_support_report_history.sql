-- Add an authenticated local history read for redacted support reports.
-- Access is settings-managed and restricted to the actor's current outlet.
CREATE OR REPLACE FUNCTION bar_local.support_reports_list(
  p_token_hash text,
  p_device_id uuid,
  p_authority_id uuid,
  p_authority_epoch bigint,
  p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_outlet uuid;
  v_limit integer;
  v_cursor text;
  v_cursor_created timestamptz;
  v_cursor_id uuid;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
BEGIN
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'settings.manage');
  v_outlet := bar_local.query_outlet(v_ctx, v_filters);
  v_limit := LEAST(100, GREATEST(1, COALESCE(NULLIF(v_filters->>'limit', '')::integer, 25)));
  v_cursor := NULLIF(v_filters->>'cursor', '');
  IF v_cursor IS NOT NULL THEN
    IF v_cursor !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z\|[0-9a-f-]{36}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The support report cursor is invalid. Refresh the report list.');
    END IF;
    v_cursor_created := split_part(v_cursor, '|', 1)::timestamptz;
    v_cursor_id := split_part(v_cursor, '|', 2)::uuid;
  END IF;

  WITH page AS (
    SELECT r.id, r.category, r.severity, r.subject, r.message, r.diagnostics, r.metadata,
           r.redaction_applied, r.checksum, r.status, r.delivery_status,
           r.submitted_by, s.display_name AS submitted_by_name,
           to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           to_char(r.acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acknowledged_at
      FROM bar_local.support_reports r
      JOIN bar_local.staff s ON s.id = r.submitted_by AND s.business_id = r.business_id
     WHERE r.business_id = v_ctx.business_id AND r.outlet_id = v_outlet
       AND (v_cursor IS NULL OR (r.created_at, r.id) < (v_cursor_created, v_cursor_id))
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT v_limit + 1
  )
  SELECT count(*) > v_limit INTO v_has_more FROM page;

  WITH page AS (
    SELECT r.id, r.category, r.severity, r.subject, r.message, r.diagnostics, r.metadata,
           r.redaction_applied, r.checksum, r.status, r.delivery_status,
           r.submitted_by, s.display_name AS submitted_by_name,
           to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
           to_char(r.acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acknowledged_at
      FROM bar_local.support_reports r
      JOIN bar_local.staff s ON s.id = r.submitted_by AND s.business_id = r.business_id
     WHERE r.business_id = v_ctx.business_id AND r.outlet_id = v_outlet
       AND (v_cursor IS NULL OR (r.created_at, r.id) < (v_cursor_created, v_cursor_id))
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.id DESC), '[]'::jsonb)
    INTO v_data FROM page;

  IF v_has_more AND jsonb_array_length(v_data) > 0 THEN
    v_next := (v_data->(jsonb_array_length(v_data) - 1)->>'created_at') || '|' ||
      (v_data->(jsonb_array_length(v_data) - 1)->>'id');
  END IF;
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  RETURN jsonb_build_object(
    'data', v_data,
    'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
    'snapshot_watermark', v_watermark,
    'scope', jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_outlet,
      'device_id', v_ctx.device_id, 'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role),
    'as_of', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'complete', true, 'unavailable', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION bar_local.support_reports_list(text, uuid, uuid, bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.support_reports_list(text, uuid, uuid, bigint, jsonb) FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_before_support_reports;
CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, bar_local AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_query = 'support.reports.list' THEN
    RETURN bar_local.support_reports_list(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_filters);
  END IF;
  v_result := bar_local.query_dispatch_before_support_reports(
    p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters
  );
  IF p_query = 'accounting.trial_balance' THEN
    v_result := jsonb_set(v_result, '{data}', COALESCE((
      SELECT jsonb_agg(
        jsonb_set(jsonb_set(jsonb_set(row_value, '{debit}', to_jsonb((row_value->>'debit')::numeric::text)),
          '{credit}', to_jsonb((row_value->>'credit')::numeric::text)),
          '{balance}', to_jsonb((row_value->>'balance')::numeric::text))
        ORDER BY row_value->>'account_code'
      ) FROM jsonb_array_elements(COALESCE(v_result->'data', '[]'::jsonb)) AS elements(row_value)
    ), '[]'::jsonb));
  END IF;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION bar_local.query_dispatch_before_support_reports(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;

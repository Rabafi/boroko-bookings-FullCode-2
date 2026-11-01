-- Workforce roster and attendance are operational records. They do not
-- touch sales, cash, stock or accounting truth.

CREATE TABLE IF NOT EXISTS bar_local.workforce_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  work_date date NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 720),
  role_label text,
  notes text,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  scheduled_by uuid NOT NULL REFERENCES bar_local.staff(id),
  cancelled_by uuid REFERENCES bar_local.staff(id),
  cancellation_reason text,
  operation_id uuid NOT NULL UNIQUE,
  cancelled_operation_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at <> ends_at),
  CHECK (
    ((extract(epoch FROM (ends_at - starts_at)) + CASE WHEN ends_at < starts_at THEN 86400 ELSE 0 END) / 60)
    - break_minutes > 0
  ),
  CHECK (
    (status = 'scheduled' AND cancelled_by IS NULL AND cancellation_reason IS NULL AND cancelled_operation_id IS NULL)
    OR (status = 'cancelled' AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND cancelled_operation_id IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS workforce_shifts_scope_idx
  ON bar_local.workforce_shifts (business_id, outlet_id, work_date, starts_at, id);

CREATE TABLE IF NOT EXISTS bar_local.workforce_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  outlet_id uuid NOT NULL REFERENCES bar_local.outlets(id),
  staff_id uuid NOT NULL REFERENCES bar_local.staff(id),
  workforce_shift_id uuid REFERENCES bar_local.workforce_shifts(id),
  trading_shift_id uuid REFERENCES bar_local.shifts(id),
  work_date date NOT NULL,
  clocked_in_at timestamptz NOT NULL DEFAULT now(),
  clocked_out_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  note text,
  clock_out_note text,
  clock_in_operation_id uuid NOT NULL UNIQUE,
  clock_out_operation_id uuid UNIQUE,
  CHECK (
    (status = 'open' AND clocked_out_at IS NULL AND clock_out_operation_id IS NULL)
    OR (status = 'closed' AND clocked_out_at IS NOT NULL AND clock_out_operation_id IS NOT NULL)
  ),
  CHECK (clocked_out_at IS NULL OR clocked_out_at >= clocked_in_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS workforce_attendance_one_open_per_staff
  ON bar_local.workforce_attendance (business_id, staff_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS workforce_attendance_scope_idx
  ON bar_local.workforce_attendance (business_id, outlet_id, work_date, clocked_in_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bar_local.workforce_shift_json(p_shift_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'shift_id', s.id, 'work_date', s.work_date,
    'starts_at', to_char(s.starts_at, 'HH24:MI'),
    'ends_at', to_char(s.ends_at, 'HH24:MI'),
    'scheduled_minutes', (
      ((extract(epoch FROM (s.ends_at - s.starts_at)) + CASE WHEN s.ends_at < s.starts_at THEN 86400 ELSE 0 END) / 60)
      - s.break_minutes
    )::integer,
    'break_minutes', s.break_minutes, 'role_label', s.role_label, 'notes', s.notes,
    'status', s.status, 'version', s.version,
    'staff_id', s.staff_id, 'display_name', st.display_name, 'staff_role', st.role, 'staff_status', st.status,
    'scheduled_by', s.scheduled_by, 'cancelled_by', s.cancelled_by,
    'cancellation_reason', s.cancellation_reason,
    'created_at', s.created_at, 'updated_at', s.updated_at,
    'attendance', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'attendance_id', a.id, 'status', a.status,
        'clocked_in_at', a.clocked_in_at, 'clocked_out_at', a.clocked_out_at,
        'minutes_worked', round(extract(epoch FROM (COALESCE(a.clocked_out_at, now()) - a.clocked_in_at)) / 60)::integer,
        'note', a.note, 'clock_out_note', a.clock_out_note
      ) ORDER BY a.clocked_in_at, a.id)
      FROM bar_local.workforce_attendance a
      WHERE a.workforce_shift_id = s.id
    ), '[]'::jsonb)
  )
  FROM bar_local.workforce_shifts s
  JOIN bar_local.staff st ON st.id = s.staff_id
  WHERE s.id = p_shift_id;
$$;

CREATE OR REPLACE FUNCTION bar_local.workforce_attendance_json(p_attendance_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'attendance_id', a.id, 'work_date', a.work_date, 'status', a.status,
    'clocked_in_at', a.clocked_in_at, 'clocked_out_at', a.clocked_out_at,
    'minutes_worked', round(extract(epoch FROM (COALESCE(a.clocked_out_at, now()) - a.clocked_in_at)) / 60)::integer,
    'note', a.note, 'clock_out_note', a.clock_out_note,
    'staff_id', a.staff_id, 'display_name', st.display_name, 'staff_role', st.role, 'staff_status', st.status,
    'workforce_shift_id', a.workforce_shift_id,
    'shift_work_date', ws.work_date,
    'shift_starts_at', to_char(ws.starts_at, 'HH24:MI'),
    'shift_ends_at', to_char(ws.ends_at, 'HH24:MI'),
    'trading_shift_id', a.trading_shift_id
  )
  FROM bar_local.workforce_attendance a
  JOIN bar_local.staff st ON st.id = a.staff_id
  LEFT JOIN bar_local.workforce_shifts ws ON ws.id = a.workforce_shift_id
  WHERE a.id = p_attendance_id;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_workforce_shift_schedule(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.workforce_shifts%ROWTYPE;
  v_staff bar_local.staff%ROWTYPE;
  v_shift_id uuid := NULLIF(v_payload->>'shift_id', '')::uuid;
  v_staff_id uuid := (v_payload->>'staff_id')::uuid;
  v_before jsonb;
  v_data jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_staff FROM bar_local.staff
     WHERE id = v_staff_id AND business_id = v_ctx.business_id;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('STAFF_NOT_FOUND', 'The selected staff member does not belong to this business.');
    END IF;
    IF v_staff.status <> 'active' THEN
      PERFORM bar_local.raise_business('STAFF_INACTIVE', 'Suspended staff cannot be scheduled.');
    END IF;
    IF v_shift_id IS NULL THEN
      INSERT INTO bar_local.workforce_shifts
        (business_id, outlet_id, staff_id, work_date, starts_at, ends_at, break_minutes,
         role_label, notes, scheduled_by, operation_id)
      VALUES
        (v_ctx.business_id, v_ctx.outlet_id, v_staff_id, (v_payload->>'work_date')::date,
         (v_payload->>'starts_at')::time, (v_payload->>'ends_at')::time,
         COALESCE((v_payload->>'break_minutes')::integer, 0),
         COALESCE(NULLIF(trim(v_payload->>'role_label'), ''), v_staff.role),
         NULLIF(trim(v_payload->>'notes'), ''), v_ctx.staff_id, (p_envelope->>'operation_id')::uuid)
      RETURNING * INTO v_shift;
    ELSE
      SELECT * INTO v_shift FROM bar_local.workforce_shifts
       WHERE id = v_shift_id AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
       FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('WORKFORCE_SHIFT_NOT_FOUND', 'The roster shift could not be found in this outlet.');
      END IF;
      IF v_shift.version <> (v_payload->>'expected_version')::integer THEN
        PERFORM bar_local.raise_business('WORKFORCE_SHIFT_VERSION_CONFLICT', 'The roster shift changed since it was loaded. Refresh and try again.');
      END IF;
      IF v_shift.status <> 'scheduled' THEN
        PERFORM bar_local.raise_business('WORKFORCE_SHIFT_STATE_CONFLICT', 'A cancelled roster shift cannot be edited.');
      END IF;
      v_before := bar_local.workforce_shift_json(v_shift.id);
      UPDATE bar_local.workforce_shifts
         SET staff_id = v_staff_id,
             work_date = (v_payload->>'work_date')::date,
             starts_at = (v_payload->>'starts_at')::time,
             ends_at = (v_payload->>'ends_at')::time,
             break_minutes = COALESCE((v_payload->>'break_minutes')::integer, 0),
             role_label = COALESCE(NULLIF(trim(v_payload->>'role_label'), ''), v_staff.role),
             notes = NULLIF(trim(v_payload->>'notes'), ''),
             scheduled_by = v_ctx.staff_id,
             version = version + 1,
             updated_at = now()
       WHERE id = v_shift.id
       RETURNING * INTO v_shift;
    END IF;
    v_data := bar_local.workforce_shift_json(v_shift.id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'workforce.shift.scheduled', (p_envelope->>'operation_id')::uuid, v_before, v_data);
    v_data := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_data, v_data, jsonb_build_array(jsonb_build_object('event_type','workforce.shift.scheduled','payload',v_data)),
      (v_data->>'work_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_data, 'result', v_data);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_workforce_shift_cancel(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.workforce_shifts%ROWTYPE;
  v_before jsonb;
  v_data jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_shift FROM bar_local.workforce_shifts
     WHERE id = (v_payload->>'shift_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('WORKFORCE_SHIFT_NOT_FOUND', 'The roster shift could not be found in this outlet.');
    END IF;
    IF v_shift.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('WORKFORCE_SHIFT_VERSION_CONFLICT', 'The roster shift changed since it was loaded. Refresh and try again.');
    END IF;
    IF v_shift.status <> 'scheduled' THEN
      PERFORM bar_local.raise_business('WORKFORCE_SHIFT_STATE_CONFLICT', 'The roster shift is already cancelled.');
    END IF;
    v_before := bar_local.workforce_shift_json(v_shift.id);
    UPDATE bar_local.workforce_shifts
       SET status = 'cancelled', cancelled_by = v_ctx.staff_id, cancellation_reason = trim(v_payload->>'reason'),
           cancelled_operation_id = (p_envelope->>'operation_id')::uuid, version = version + 1, updated_at = now()
     WHERE id = v_shift.id
     RETURNING * INTO v_shift;
    v_data := bar_local.workforce_shift_json(v_shift.id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'workforce.shift.cancelled', (p_envelope->>'operation_id')::uuid, v_before, v_data);
    v_data := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_data, v_data, jsonb_build_array(jsonb_build_object('event_type','workforce.shift.cancelled','payload',v_data)),
      (v_data->>'work_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_data, 'result', v_data);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_workforce_clock_in(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_staff_id uuid := COALESCE(NULLIF(v_payload->>'staff_id', '')::uuid, NULL);
  v_staff bar_local.staff%ROWTYPE;
  v_roster bar_local.workforce_shifts%ROWTYPE;
  v_attendance bar_local.workforce_attendance%ROWTYPE;
  v_today date := bar_local.current_business_date();
  v_data jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_staff_id := COALESCE(v_staff_id, v_ctx.staff_id);
    SELECT * INTO v_staff FROM bar_local.staff
     WHERE id = v_staff_id AND business_id = v_ctx.business_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('STAFF_NOT_FOUND', 'The selected staff member does not belong to this business.');
    END IF;
    IF v_staff.status <> 'active' THEN
      PERFORM bar_local.raise_business('STAFF_INACTIVE', 'Suspended staff cannot clock in.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM bar_local.workforce_attendance
       WHERE business_id = v_ctx.business_id AND staff_id = v_staff_id AND status = 'open'
    ) THEN
      PERFORM bar_local.raise_business('ATTENDANCE_ALREADY_OPEN', 'This staff member already has an open attendance record.');
    END IF;
    IF NULLIF(v_payload->>'workforce_shift_id', '') IS NOT NULL THEN
      SELECT * INTO v_roster FROM bar_local.workforce_shifts
       WHERE id = (v_payload->>'workforce_shift_id')::uuid
         AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
       FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('WORKFORCE_SHIFT_NOT_FOUND', 'The roster shift could not be found in this outlet.');
      END IF;
      IF v_roster.status <> 'scheduled' THEN
        PERFORM bar_local.raise_business('WORKFORCE_SHIFT_STATE_CONFLICT', 'A cancelled roster shift cannot be used to clock in.');
      END IF;
      IF v_roster.staff_id <> v_staff_id THEN
        PERFORM bar_local.raise_business('WORKFORCE_SHIFT_NOT_FOUND', 'The roster shift is assigned to another staff member.');
      END IF;
      IF v_roster.work_date <> v_today
         AND NOT (v_roster.work_date = v_today - 1 AND v_roster.ends_at < v_roster.starts_at) THEN
        PERFORM bar_local.raise_business('WORKFORCE_SHIFT_STATE_CONFLICT', 'The roster shift is not current for this business date.');
      END IF;
    END IF;
    IF NULLIF(v_payload->>'trading_shift_id', '') IS NOT NULL THEN
      PERFORM 1 FROM bar_local.shifts
       WHERE id = (v_payload->>'trading_shift_id')::uuid
         AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('SHIFT_SCOPE_MISMATCH', 'The trading shift does not belong to this outlet.');
      END IF;
    END IF;
    INSERT INTO bar_local.workforce_attendance
      (business_id, outlet_id, staff_id, workforce_shift_id, trading_shift_id, work_date,
       note, clock_in_operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_staff_id,
       NULLIF(v_payload->>'workforce_shift_id', '')::uuid,
       NULLIF(v_payload->>'trading_shift_id', '')::uuid,
       v_today, NULLIF(trim(v_payload->>'note'), ''), (p_envelope->>'operation_id')::uuid)
    RETURNING * INTO v_attendance;
    v_data := bar_local.workforce_attendance_json(v_attendance.id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'workforce.attendance.clocked_in', (p_envelope->>'operation_id')::uuid, NULL, v_data);
    v_data := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_data, v_data, jsonb_build_array(jsonb_build_object('event_type','workforce.attendance.clocked_in','payload',v_data)),
      v_today);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_data, 'result', v_data);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_workforce_clock_out(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_attendance bar_local.workforce_attendance%ROWTYPE;
  v_before jsonb;
  v_data jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_attendance FROM bar_local.workforce_attendance
     WHERE id = (v_payload->>'attendance_id')::uuid
       AND business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('ATTENDANCE_NOT_FOUND', 'The attendance record could not be found in this outlet.');
    END IF;
    IF v_attendance.status <> 'open' THEN
      PERFORM bar_local.raise_business('ATTENDANCE_STATE_CONFLICT', 'The attendance record is already closed.');
    END IF;
    v_before := bar_local.workforce_attendance_json(v_attendance.id);
    UPDATE bar_local.workforce_attendance
       SET status = 'closed', clocked_out_at = now(), clock_out_note = NULLIF(trim(v_payload->>'note'), ''),
           clock_out_operation_id = (p_envelope->>'operation_id')::uuid
     WHERE id = v_attendance.id
     RETURNING * INTO v_attendance;
    v_data := bar_local.workforce_attendance_json(v_attendance.id);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'workforce.attendance.clocked_out', (p_envelope->>'operation_id')::uuid, v_before, v_data);
    v_data := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_data, v_data, jsonb_build_array(jsonb_build_object('event_type','workforce.attendance.clocked_out','payload',v_data)),
      (v_data->>'work_date')::date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_data, 'result', v_data);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) RENAME TO query_dispatch_control;

CREATE OR REPLACE FUNCTION bar_local.query_dispatch(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_filters jsonb;
  v_limit integer;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_from date;
  v_to date;
  v_cursor_date date;
  v_cursor_time time;
  v_cursor_ts timestamptz;
  v_cursor_id uuid;
BEGIN
  IF p_query IS NULL OR p_query NOT IN ('workforce.roster', 'workforce.attendance.list', 'workforce.attendance.current') THEN
    RETURN bar_local.query_dispatch_control(p_token_hash, p_device_id, p_authority_id, p_authority_epoch, p_query, p_filters);
  END IF;
  v_ctx := bar_local.query_session(p_token_hash, p_device_id, p_authority_id, p_authority_epoch);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'staff.manage');
  PERFORM bar_local.assert_feature('bar_accounting_workforce');
  v_filters := COALESCE(p_filters, '{}'::jsonb);
  v_limit := bar_local.query_limit(v_filters);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id', v_ctx.business_id, 'outlet_id', v_ctx.outlet_id,
    'actor_staff_id', v_ctx.staff_id, 'role', v_ctx.role, 'device_id', v_ctx.device_id);

  IF p_query = 'workforce.attendance.current' THEN
    SELECT COALESCE(jsonb_agg(bar_local.workforce_attendance_json(a.id) ORDER BY a.clocked_in_at, a.id), '[]'::jsonb)
      INTO v_data
      FROM bar_local.workforce_attendance a
     WHERE a.business_id = v_ctx.business_id AND a.outlet_id = v_ctx.outlet_id AND a.status = 'open'
       AND (v_filters->>'staff_id' IS NULL OR a.staff_id = (v_filters->>'staff_id')::uuid);
  ELSIF p_query = 'workforce.attendance.list' THEN
    v_from := COALESCE(NULLIF(v_filters->>'from', '')::date, bar_local.current_business_date());
    v_to := COALESCE(NULLIF(v_filters->>'to', '')::date, v_from);
    IF v_to < v_from THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The report end date cannot be before its start date.');
    END IF;
    IF NULLIF(v_filters->>'cursor', '') IS NOT NULL THEN
      v_cursor_ts := split_part(v_filters->>'cursor', '|', 1)::timestamptz;
      v_cursor_id := split_part(v_filters->>'cursor', '|', 2)::uuid;
    END IF;
    SELECT COALESCE(jsonb_agg(bar_local.workforce_attendance_json(x.id) ORDER BY x.clocked_in_at DESC, x.id DESC), '[]'::jsonb)
      INTO v_data
      FROM (
        SELECT a.id, a.clocked_in_at FROM bar_local.workforce_attendance a
         WHERE a.business_id = v_ctx.business_id AND a.outlet_id = v_ctx.outlet_id
           AND a.work_date BETWEEN v_from AND v_to
           AND (v_filters->>'status' IS NULL OR a.status = v_filters->>'status')
           AND (v_filters->>'staff_id' IS NULL OR a.staff_id = (v_filters->>'staff_id')::uuid)
           AND (v_cursor_ts IS NULL OR (a.clocked_in_at, a.id) < (v_cursor_ts, v_cursor_id))
         ORDER BY a.clocked_in_at DESC, a.id DESC
         LIMIT v_limit + 1
      ) x;
  ELSE
    v_from := COALESCE(NULLIF(v_filters->>'from', '')::date, bar_local.current_business_date());
    v_to := COALESCE(NULLIF(v_filters->>'to', '')::date, v_from);
    IF v_to < v_from THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'The report end date cannot be before its start date.');
    END IF;
    IF NULLIF(v_filters->>'cursor', '') IS NOT NULL THEN
      v_cursor_date := split_part(v_filters->>'cursor', '|', 1)::date;
      v_cursor_time := split_part(v_filters->>'cursor', '|', 2)::time;
      v_cursor_id := split_part(v_filters->>'cursor', '|', 3)::uuid;
    END IF;
    SELECT COALESCE(jsonb_agg(bar_local.workforce_shift_json(x.id) ORDER BY x.work_date, x.starts_at, x.id), '[]'::jsonb)
      INTO v_data
      FROM (
        SELECT s.id, s.work_date, s.starts_at FROM bar_local.workforce_shifts s
         WHERE s.business_id = v_ctx.business_id AND s.outlet_id = v_ctx.outlet_id
           AND s.work_date BETWEEN v_from AND v_to
           AND (v_filters->>'status' IS NULL OR s.status = v_filters->>'status')
           AND (v_filters->>'staff_id' IS NULL OR s.staff_id = (v_filters->>'staff_id')::uuid)
           AND (v_cursor_date IS NULL OR (s.work_date, s.starts_at, s.id) > (v_cursor_date, v_cursor_time, v_cursor_id))
         ORDER BY s.work_date, s.starts_at, s.id
         LIMIT v_limit + 1
      ) x;
  END IF;

  IF p_query IN ('workforce.roster', 'workforce.attendance.list') AND jsonb_array_length(v_data) > v_limit THEN
    SELECT COALESCE(jsonb_agg(value ORDER BY ordinality), '[]'::jsonb) INTO v_data
      FROM jsonb_array_elements(v_data) WITH ORDINALITY AS item(value, ordinality)
     WHERE ordinality <= v_limit;
    v_has_more := true;
    IF p_query = 'workforce.roster' THEN
      v_next := (v_data->-1->>'work_date') || '|' || (v_data->-1->>'starts_at') || ':00|' || (v_data->-1->>'shift_id');
    ELSE
      v_next := (v_data->-1->>'clocked_in_at') || '|' || (v_data->-1->>'attendance_id');
    END IF;
  END IF;

  RETURN jsonb_build_object('data', v_data, 'pagination', jsonb_build_object('next_cursor', v_next, 'has_more', v_has_more),
    'snapshot_watermark', v_watermark, 'scope', v_scope, 'as_of', v_as_of, 'complete', true, 'unavailable', '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION bar_local.workforce_shift_json(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.workforce_shift_json(uuid) FROM bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.workforce_attendance_json(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.workforce_attendance_json(uuid) FROM bar_local_runtime;

REVOKE ALL ON bar_local.workforce_shifts FROM PUBLIC;
REVOKE ALL ON bar_local.workforce_attendance FROM PUBLIC;
REVOKE ALL ON bar_local.workforce_shifts FROM bar_local_runtime;
REVOKE ALL ON bar_local.workforce_attendance FROM bar_local_runtime;

ALTER FUNCTION bar_local.cmd_workforce_shift_schedule(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_shift_schedule(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_workforce_shift_cancel(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_shift_cancel(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_workforce_clock_in(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_clock_in(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_workforce_clock_out(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_workforce_clock_out(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;

REVOKE ALL ON FUNCTION bar_local.cmd_workforce_shift_schedule(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_shift_cancel(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_clock_in(text, uuid, jsonb, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.cmd_workforce_clock_out(text, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_shift_schedule(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_shift_cancel(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_clock_in(text, uuid, jsonb, text, text) TO bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_workforce_clock_out(text, uuid, jsonb, text, text) TO bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch_control(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_control(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_control(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_control(text, uuid, uuid, bigint, text, jsonb) FROM bar_local_runtime;

ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) SET search_path = pg_catalog, bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bar_local.query_dispatch(text, uuid, uuid, bigint, text, jsonb) TO bar_local_runtime;

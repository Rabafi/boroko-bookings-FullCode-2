-- 20260705120000_checkin_checkout_workflow.sql
-- Check-in and check-out workflow checklist tables and RPCs

CREATE TABLE IF NOT EXISTS checkin_config (
  lodge_id BIGINT NOT NULL,
  required_steps jsonb DEFAULT '[]'::jsonb,
  optional_steps jsonb DEFAULT '[]'::jsonb,
  require_id_capture boolean DEFAULT true,
  require_registration_card boolean DEFAULT true,
  require_deposit_check boolean DEFAULT true,
  require_room_assignment boolean DEFAULT true,
  require_signature boolean DEFAULT false,
  require_key_handoff boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkin_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id BIGINT NOT NULL,
  booking_id uuid NOT NULL,
  step_key text NOT NULL,
  step_label text NOT NULL,
  completed boolean DEFAULT false,
  completed_by uuid,
  completed_at timestamptz,
  data jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkout_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id BIGINT NOT NULL,
  booking_id uuid NOT NULL,
  step_key text NOT NULL,
  step_label text NOT NULL,
  completed boolean DEFAULT false,
  completed_by uuid,
  completed_at timestamptz,
  data jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE checkin_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkout_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY checkin_config_lodge_policy ON checkin_config
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

CREATE POLICY checkin_checklist_lodge_policy ON checkin_checklist_items
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

CREATE POLICY checkout_checklist_lodge_policy ON checkout_checklist_items
  FOR ALL
  USING (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint)
  WITH CHECK (lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::bigint);

CREATE INDEX IF NOT EXISTS idx_checkin_checklist_booking ON checkin_checklist_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_checkout_checklist_booking ON checkout_checklist_items(booking_id);

CREATE OR REPLACE FUNCTION get_checkin_checklist(
  p_booking_id uuid,
  p_lodge_id BIGINT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_items jsonb;
  v_config jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  SELECT COALESCE(jsonb_agg(row_to_json(ci.*)::jsonb ORDER BY ci.created_at), '[]'::jsonb)
  INTO v_items
  FROM checkin_checklist_items ci
  WHERE ci.booking_id = p_booking_id AND ci.lodge_id = p_lodge_id;

  SELECT row_to_json(cc.*)::jsonb INTO v_config FROM checkin_config cc WHERE cc.lodge_id = p_lodge_id;

  RETURN jsonb_build_object('items', v_items, 'config', v_config);
END;
$$;

CREATE OR REPLACE FUNCTION complete_checkin_step(
  p_step_id uuid,
  p_lodge_id BIGINT,
  p_completed_by uuid,
  p_data jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  UPDATE checkin_checklist_items SET
    completed = true,
    completed_by = p_completed_by,
    completed_at = now(),
    data = COALESCE(p_data, data)
  WHERE id = p_step_id AND lodge_id = p_lodge_id
  RETURNING booking_id INTO v_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Step not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'step_id', p_step_id, 'booking_id', v_booking_id);
END;
$$;

CREATE OR REPLACE FUNCTION reset_checkin_step(
  p_step_id uuid,
  p_lodge_id BIGINT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  UPDATE checkin_checklist_items SET completed = false, completed_by = NULL, completed_at = NULL
  WHERE id = p_step_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Step not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'step_id', p_step_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_checkin_config(
  p_lodge_id BIGINT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_config jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  SELECT row_to_json(cc.*)::jsonb INTO v_config FROM checkin_config cc WHERE cc.lodge_id = p_lodge_id;

  RETURN jsonb_build_object('config', v_config);
END;
$$;

CREATE OR REPLACE FUNCTION update_checkin_config(
  p_lodge_id BIGINT,
  p_config jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  INSERT INTO checkin_config (lodge_id, required_steps, optional_steps, require_id_capture, require_registration_card, require_deposit_check, require_room_assignment, require_signature, require_key_handoff, updated_at)
  VALUES (
    p_lodge_id,
    COALESCE(p_config->>'required_steps', '[]')::jsonb,
    COALESCE(p_config->>'optional_steps', '[]')::jsonb,
    COALESCE((p_config->>'require_id_capture')::boolean, true),
    COALESCE((p_config->>'require_registration_card')::boolean, true),
    COALESCE((p_config->>'require_deposit_check')::boolean, true),
    COALESCE((p_config->>'require_room_assignment')::boolean, true),
    COALESCE((p_config->>'require_signature')::boolean, false),
    COALESCE((p_config->>'require_key_handoff')::boolean, false),
    now()
  )
  ON CONFLICT (lodge_id) DO UPDATE SET
    required_steps = COALESCE((p_config->>'required_steps')::jsonb, checkin_config.required_steps),
    optional_steps = COALESCE((p_config->>'optional_steps')::jsonb, checkin_config.optional_steps),
    require_id_capture = COALESCE((p_config->>'require_id_capture')::boolean, checkin_config.require_id_capture),
    require_registration_card = COALESCE((p_config->>'require_registration_card')::boolean, checkin_config.require_registration_card),
    require_deposit_check = COALESCE((p_config->>'require_deposit_check')::boolean, checkin_config.require_deposit_check),
    require_room_assignment = COALESCE((p_config->>'require_room_assignment')::boolean, checkin_config.require_room_assignment),
    require_signature = COALESCE((p_config->>'require_signature')::boolean, checkin_config.require_signature),
    require_key_handoff = COALESCE((p_config->>'require_key_handoff')::boolean, checkin_config.require_key_handoff),
    updated_at = now();

  RETURN jsonb_build_object('success', true, 'lodge_id', p_lodge_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_checkout_checklist(
  p_booking_id uuid,
  p_lodge_id BIGINT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_items jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  SELECT COALESCE(jsonb_agg(row_to_json(ci.*)::jsonb ORDER BY ci.created_at), '[]'::jsonb)
  INTO v_items
  FROM checkout_checklist_items ci
  WHERE ci.booking_id = p_booking_id AND ci.lodge_id = p_lodge_id;

  RETURN jsonb_build_object('items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION complete_checkout_step(
  p_step_id uuid,
  p_lodge_id BIGINT,
  p_completed_by uuid,
  p_data jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  UPDATE checkout_checklist_items SET
    completed = true,
    completed_by = p_completed_by,
    completed_at = now(),
    data = COALESCE(p_data, data)
  WHERE id = p_step_id AND lodge_id = p_lodge_id
  RETURNING booking_id INTO v_booking_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Step not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'step_id', p_step_id, 'booking_id', v_booking_id);
END;
$$;

CREATE OR REPLACE FUNCTION reset_checkout_step(
  p_step_id uuid,
  p_lodge_id BIGINT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  UPDATE checkout_checklist_items SET completed = false, completed_by = NULL, completed_at = NULL
  WHERE id = p_step_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Step not found');
  END IF;

  RETURN jsonb_build_object('success', true, 'step_id', p_step_id);
END;
$$;

GRANT EXECUTE ON FUNCTION get_checkin_checklist(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_checkin_step(uuid, bigint, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reset_checkin_step(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_checkin_config(bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_checkin_config(bigint, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_checkout_checklist(uuid, bigint) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION complete_checkout_step(uuid, bigint, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reset_checkout_step(uuid, bigint) TO authenticated, service_role;

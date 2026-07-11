-- 20260705135000_multi_property_foundation.sql
-- Multi-property management: property groups, members, settings, consolidated reporting

CREATE TABLE IF NOT EXISTS property_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  central_office_address text DEFAULT '',
  central_office_contact text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES property_groups(id) ON DELETE CASCADE,
  lodge_id uuid NOT NULL,
  role_in_group text NOT NULL DEFAULT 'member' CHECK (role_in_group IN ('member', 'head_office')),
  is_central_office boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(group_id, lodge_id)
);

ALTER TABLE property_group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY property_group_members_select_policy ON property_group_members
  FOR SELECT
  USING (
    lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    OR group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    )
  );

CREATE POLICY property_group_members_manage_policy ON property_group_members
  FOR ALL
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  );

CREATE INDEX IF NOT EXISTS idx_prop_group_members_group ON property_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_prop_group_members_lodge ON property_group_members(lodge_id);

ALTER TABLE property_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY property_groups_select_policy ON property_groups
  FOR SELECT
  USING (
    id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    )
  );

CREATE POLICY property_groups_manage_policy ON property_groups
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM property_group_members
      WHERE group_id = id
        AND lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM property_group_members
      WHERE group_id = id
        AND lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  );

CREATE INDEX IF NOT EXISTS idx_property_groups_name ON property_groups(name);

CREATE TABLE IF NOT EXISTS property_group_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES property_groups(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_value text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(group_id, setting_key)
);

ALTER TABLE property_group_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY property_group_settings_select_policy ON property_group_settings
  FOR SELECT
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    )
  );

CREATE POLICY property_group_settings_manage_policy ON property_group_settings
  FOR ALL
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  )
  WITH CHECK (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  );

CREATE INDEX IF NOT EXISTS idx_prop_group_settings_group ON property_group_settings(group_id);

-- Create property group
CREATE OR REPLACE FUNCTION create_property_group(
  p_name text,
  p_description text DEFAULT '',
  p_central_office_address text DEFAULT '',
  p_central_office_contact text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_id uuid;
  v_lodge_id uuid;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lodge ID is required');
  END IF;

  PERFORM app_require_lodge_role(v_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  v_group_id := gen_random_uuid();

  INSERT INTO property_groups (id, name, description, central_office_address, central_office_contact)
  VALUES (v_group_id, p_name, p_description, p_central_office_address, p_central_office_contact);

  INSERT INTO property_group_members (group_id, lodge_id, role_in_group, is_central_office)
  VALUES (v_group_id, v_lodge_id, 'head_office', true);

  RETURN jsonb_build_object('success', true, 'group_id', v_group_id, 'name', p_name);
END;
$$;

GRANT EXECUTE ON FUNCTION create_property_group(text, text, text, text) TO authenticated;

-- Update property group
CREATE OR REPLACE FUNCTION update_property_group(
  p_group_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_central_office_address text DEFAULT NULL,
  p_central_office_contact text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;
  PERFORM app_require_lodge_role(v_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to update this group');
  END IF;

  UPDATE property_groups SET
    name = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    central_office_address = COALESCE(p_central_office_address, central_office_address),
    central_office_contact = COALESCE(p_central_office_contact, central_office_contact),
    updated_at = now()
  WHERE id = p_group_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_property_group(uuid, text, text, text, text) TO authenticated;

-- Delete property group
CREATE OR REPLACE FUNCTION delete_property_group(
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;
  PERFORM app_require_lodge_role(v_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to delete this group');
  END IF;

  DELETE FROM property_groups WHERE id = p_group_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_property_group(uuid) TO authenticated;

-- Add property to group
CREATE OR REPLACE FUNCTION add_property_to_group(
  p_group_id uuid,
  p_lodge_id uuid,
  p_role text DEFAULT 'member'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_lodge_id uuid;
BEGIN
  v_actor_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;
  PERFORM app_require_lodge_role(v_actor_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_actor_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to add properties to this group');
  END IF;

  INSERT INTO property_group_members (group_id, lodge_id, role_in_group)
  VALUES (p_group_id, p_lodge_id, p_role)
  ON CONFLICT (group_id, lodge_id) DO UPDATE SET role_in_group = p_role;

  RETURN jsonb_build_object('success', true, 'lodge_id', p_lodge_id);
END;
$$;

GRANT EXECUTE ON FUNCTION add_property_to_group(uuid, uuid, text) TO authenticated;

-- Remove property from group
CREATE OR REPLACE FUNCTION remove_property_from_group(
  p_group_id uuid,
  p_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_lodge_id uuid;
BEGIN
  v_actor_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;
  PERFORM app_require_lodge_role(v_actor_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_actor_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to remove properties from this group');
  END IF;

  DELETE FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION remove_property_from_group(uuid, uuid) TO authenticated;

-- Get group properties
CREATE OR REPLACE FUNCTION get_group_properties(
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
  v_result jsonb;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'lodge_id', pgm.lodge_id,
    'role_in_group', pgm.role_in_group,
    'is_central_office', pgm.is_central_office,
    'created_at', pgm.created_at
  )) INTO v_result
  FROM property_group_members pgm
  WHERE pgm.group_id = p_group_id;

  RETURN jsonb_build_object('success', true, 'properties', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION get_group_properties(uuid) TO authenticated;

-- Get group settings
CREATE OR REPLACE FUNCTION get_group_settings(
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
  v_result jsonb;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  SELECT jsonb_object_agg(pgs.setting_key, pgs.setting_value) INTO v_result
  FROM property_group_settings pgs
  WHERE pgs.group_id = p_group_id;

  RETURN jsonb_build_object('success', true, 'settings', COALESCE(v_result, '{}'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION get_group_settings(uuid) TO authenticated;

-- Update group setting
CREATE OR REPLACE FUNCTION update_group_setting(
  p_group_id uuid,
  p_key text,
  p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;
  PERFORM app_require_lodge_role(v_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to update group settings');
  END IF;

  INSERT INTO property_group_settings (group_id, setting_key, setting_value)
  VALUES (p_group_id, p_key, p_value)
  ON CONFLICT (group_id, setting_key) DO UPDATE SET setting_value = p_value, updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_group_setting(uuid, text, text) TO authenticated;

-- Get consolidated dashboard
CREATE OR REPLACE FUNCTION get_consolidated_dashboard(
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
  v_total_bookings integer;
  v_total_revenue numeric(12,2);
  v_total_rooms integer;
  v_occupied_rooms integer;
  v_occupancy numeric(5,2);
  v_adr numeric(10,2);
  v_revpar numeric(10,2);
  v_property_count integer;
  v_properties jsonb;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  SELECT count(*) INTO v_property_count FROM property_group_members WHERE group_id = p_group_id;

  SELECT
    count(*)::integer,
    COALESCE(sum(b.total_amount), 0)
  INTO v_total_bookings, v_total_revenue
  FROM public.bookings b
  WHERE b.lodge_id IN (SELECT pgm2.lodge_id FROM property_group_members pgm2 WHERE pgm2.group_id = p_group_id)
    AND b.status IN ('confirmed', 'checked_in', 'checked_out');

  SELECT count(*) INTO v_total_rooms
  FROM public.rooms r
  WHERE r.lodge_id IN (SELECT pgm3.lodge_id FROM property_group_members pgm3 WHERE pgm3.group_id = p_group_id);

  SELECT count(*) INTO v_occupied_rooms
  FROM public.bookings b2
  WHERE b2.lodge_id IN (SELECT pgm4.lodge_id FROM property_group_members pgm4 WHERE pgm4.group_id = p_group_id)
    AND b2.status = 'checked_in';

  v_occupancy := CASE WHEN v_total_rooms > 0 THEN round((v_occupied_rooms::numeric / v_total_rooms) * 100, 2) ELSE 0 END;
  v_adr := CASE WHEN v_total_bookings > 0 THEN round(v_total_revenue / v_total_bookings, 2) ELSE 0 END;
  v_revpar := CASE WHEN v_total_rooms > 0 THEN round(v_total_revenue / v_total_rooms, 2) ELSE 0 END;

  SELECT jsonb_agg(jsonb_build_object(
    'lodge_id', pgm5.lodge_id,
    'role_in_group', pgm5.role_in_group,
    'is_central_office', pgm5.is_central_office
  )) INTO v_properties
  FROM property_group_members pgm5
  WHERE pgm5.group_id = p_group_id;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_group_id,
    'property_count', v_property_count,
    'total_bookings', v_total_bookings,
    'total_revenue', v_total_revenue,
    'total_rooms', v_total_rooms,
    'occupied_rooms', v_occupied_rooms,
    'occupancy_pct', v_occupancy,
    'adr', v_adr,
    'revpar', v_revpar,
    'properties', COALESCE(v_properties, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_consolidated_dashboard(uuid) TO authenticated;

-- Get consolidated occupancy report
CREATE OR REPLACE FUNCTION get_consolidated_occupancy_report(
  p_group_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
  v_report jsonb;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'lodge_id', stats.lodge_id,
    'total_rooms', stats.total_rooms,
    'booked_rooms', stats.booked_rooms,
    'occupancy_pct', CASE WHEN stats.total_rooms > 0 THEN round((stats.booked_rooms::numeric / stats.total_rooms) * 100, 2) ELSE 0 END
  )) INTO v_report
  FROM (
    SELECT
      b.lodge_id,
      count(DISTINCT b.room_id) as booked_rooms,
      (SELECT count(*) FROM public.rooms r WHERE r.lodge_id = b.lodge_id) as total_rooms
    FROM public.bookings b
    WHERE b.lodge_id IN (SELECT pgm.lodge_id FROM property_group_members pgm WHERE pgm.group_id = p_group_id)
      AND b.check_in >= p_start_date AND b.check_out <= p_end_date
      AND b.status IN ('confirmed', 'checked_in', 'checked_out')
    GROUP BY b.lodge_id
  ) stats;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_group_id,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'properties', COALESCE(v_report, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_consolidated_occupancy_report(uuid, date, date) TO authenticated;

-- Get consolidated financial summary
CREATE OR REPLACE FUNCTION get_consolidated_financial_summary(
  p_group_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
  v_report jsonb;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = v_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'lodge_id', fin.lodge_id,
    'total_revenue', fin.total_revenue,
    'total_expenses', COALESCE(fin.total_expenses, 0),
    'net_profit', fin.total_revenue - COALESCE(fin.total_expenses, 0)
  )) INTO v_report
  FROM (
    SELECT
      b.lodge_id,
      COALESCE(sum(b.total_amount), 0) as total_revenue,
      (SELECT COALESCE(sum(e.amount), 0) FROM public.expenses e WHERE e.lodge_id = b.lodge_id AND e.date >= p_start_date AND e.date <= p_end_date) as total_expenses
    FROM public.bookings b
    WHERE b.lodge_id IN (SELECT pgm.lodge_id FROM property_group_members pgm WHERE pgm.group_id = p_group_id)
      AND b.check_in >= p_start_date AND b.check_out <= p_end_date
      AND b.status IN ('confirmed', 'checked_in', 'checked_out')
    GROUP BY b.lodge_id
  ) fin;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_group_id,
    'start_date', p_start_date,
    'end_date', p_end_date,
    'properties', COALESCE(v_report, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_consolidated_financial_summary(uuid, date, date) TO authenticated;

-- Switch active property (client-side helper function)
CREATE OR REPLACE FUNCTION switch_active_property(
  p_lodge_id uuid,
  p_new_lodge_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  v_user_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not authenticated');
  END IF;

  -- Verify user has access to the new lodge
  IF NOT EXISTS (SELECT 1 FROM public.user_lodges ul WHERE ul.lodge_id = p_new_lodge_id AND ul.user_id = v_user_id) THEN
    -- Fallback: check staff table
    IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.lodge_id = p_new_lodge_id AND s.email = (SELECT email FROM auth.users WHERE id = v_user_id)) THEN
      RETURN jsonb_build_object('success', false, 'error', 'User does not have access to the target property');
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'lodge_id', p_new_lodge_id);
END;
$$;

GRANT EXECUTE ON FUNCTION switch_active_property(uuid, uuid) TO authenticated;

-- Get all property groups for current user's lodges
CREATE OR REPLACE FUNCTION get_all_property_groups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lodge_id uuid;
  v_result jsonb;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;

  SELECT jsonb_agg(jsonb_build_object(
    'id', pg.id,
    'name', pg.name,
    'description', pg.description,
    'central_office_address', pg.central_office_address,
    'central_office_contact', pg.central_office_contact,
    'member_count', (SELECT count(*) FROM property_group_members pgm WHERE pgm.group_id = pg.id),
    'created_at', pg.created_at
  ) ORDER BY pg.name) INTO v_result
  FROM property_groups pg
  WHERE pg.id IN (
    SELECT pgm2.group_id FROM property_group_members pgm2 WHERE pgm2.lodge_id = v_lodge_id
  );

  RETURN jsonb_build_object('success', true, 'groups', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION get_all_property_groups() TO authenticated;

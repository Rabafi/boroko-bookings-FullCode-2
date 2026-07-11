-- 20260705205000_multi_property_shared_profiles.sql
-- Shared guest profiles, blacklist, and corporate accounts across property groups

-- Shared guest profiles: link a guest (customer) to a group
CREATE TABLE IF NOT EXISTS shared_guest_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  group_id uuid NOT NULL REFERENCES property_groups(id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  shared_notes text DEFAULT '',
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(group_id, guest_id)
);

ALTER TABLE shared_guest_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_guest_profiles_select_policy ON shared_guest_profiles
  FOR SELECT
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    )
  );

CREATE POLICY shared_guest_profiles_insert_policy ON shared_guest_profiles
  FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  );

CREATE POLICY shared_guest_profiles_delete_policy ON shared_guest_profiles
  FOR DELETE
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  );

CREATE INDEX IF NOT EXISTS idx_shared_guest_profiles_group ON shared_guest_profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_shared_guest_profiles_guest ON shared_guest_profiles(guest_id);

-- Shared blacklist: group-wide blacklist entries
CREATE TABLE IF NOT EXISTS shared_blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES property_groups(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  guest_email text,
  guest_phone text,
  reason text NOT NULL DEFAULT '',
  blacklisted_by uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  auto_sync boolean DEFAULT true,
  CONSTRAINT at_least_one_identifier CHECK (
    guest_id IS NOT NULL OR guest_email IS NOT NULL OR guest_phone IS NOT NULL
  )
);

ALTER TABLE shared_blacklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_blacklist_select_policy ON shared_blacklist
  FOR SELECT
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    )
  );

CREATE POLICY shared_blacklist_insert_policy ON shared_blacklist
  FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    )
  );

CREATE POLICY shared_blacklist_delete_policy ON shared_blacklist
  FOR DELETE
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    )
  );

CREATE INDEX IF NOT EXISTS idx_shared_blacklist_group ON shared_blacklist(group_id);
CREATE INDEX IF NOT EXISTS idx_shared_blacklist_guest ON shared_blacklist(guest_id);

-- Shared corporate accounts: corporate accounts visible across a group
CREATE TABLE IF NOT EXISTS shared_corporate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES property_groups(id) ON DELETE CASCADE,
  corporate_account_id uuid NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  share_level text NOT NULL DEFAULT 'read' CHECK (share_level IN ('read', 'write', 'full')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(group_id, corporate_account_id)
);

ALTER TABLE shared_corporate_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY shared_corporate_accounts_select_policy ON shared_corporate_accounts
  FOR SELECT
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
    )
  );

CREATE POLICY shared_corporate_accounts_insert_policy ON shared_corporate_accounts
  FOR INSERT
  WITH CHECK (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  );

CREATE POLICY shared_corporate_accounts_delete_policy ON shared_corporate_accounts
  FOR DELETE
  USING (
    group_id IN (
      SELECT group_id FROM property_group_members
      WHERE lodge_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid
        AND role_in_group = 'head_office'
    )
  );

CREATE INDEX IF NOT EXISTS idx_shared_corp_accounts_group ON shared_corporate_accounts(group_id);
CREATE INDEX IF NOT EXISTS idx_shared_corp_accounts_corp ON shared_corporate_accounts(corporate_account_id);

-- RPC: get shared guest profiles for a group
CREATE OR REPLACE FUNCTION get_shared_guest_profiles(
  p_lodge_id uuid,
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', sgp.id,
    'guest_id', sgp.guest_id,
    'guest_name', c.name,
    'guest_email', c.email,
    'guest_phone', c.phone,
    'shared_notes', sgp.shared_notes,
    'tags', sgp.tags,
    'shared_by_lodge_id', sgp.lodge_id,
    'created_at', sgp.created_at,
    'updated_at', sgp.updated_at
  ) ORDER BY c.name) INTO v_result
  FROM shared_guest_profiles sgp
  JOIN customers c ON c.id = sgp.guest_id
  WHERE sgp.group_id = p_group_id;

  RETURN jsonb_build_object('success', true, 'profiles', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION get_shared_guest_profiles(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_shared_guest_profiles(uuid, uuid) TO service_role;

-- RPC: share a guest profile across the group
CREATE OR REPLACE FUNCTION share_guest_profile(
  p_lodge_id uuid,
  p_group_id uuid,
  p_guest_id uuid,
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to share profiles in this group');
  END IF;

  INSERT INTO shared_guest_profiles (lodge_id, group_id, guest_id, shared_notes)
  VALUES (p_lodge_id, p_group_id, p_guest_id, p_notes)
  ON CONFLICT (group_id, guest_id) DO UPDATE SET
    shared_notes = EXCLUDED.shared_notes,
    updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION share_guest_profile(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION share_guest_profile(uuid, uuid, uuid, text) TO service_role;

-- RPC: unshare a guest profile from the group
CREATE OR REPLACE FUNCTION unshare_guest_profile(
  p_lodge_id uuid,
  p_group_id uuid,
  p_guest_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to unshare profiles in this group');
  END IF;

  DELETE FROM shared_guest_profiles WHERE group_id = p_group_id AND guest_id = p_guest_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION unshare_guest_profile(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION unshare_guest_profile(uuid, uuid, uuid) TO service_role;

-- RPC: get shared blacklist entries for a group (includes group blacklist + member lodge blacklisted guests)
CREATE OR REPLACE FUNCTION get_shared_blacklist(
  p_lodge_id uuid,
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shared jsonb;
  v_lodge_blacklists jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  -- Shared blacklist table entries
  SELECT jsonb_agg(jsonb_build_object(
    'id', sb.id,
    'group_id', sb.group_id,
    'guest_id', sb.guest_id,
    'guest_name', c.name,
    'guest_email', COALESCE(sb.guest_email, c.email),
    'guest_phone', COALESCE(sb.guest_phone, c.phone),
    'reason', sb.reason,
    'blacklisted_by', sb.blacklisted_by,
    'auto_sync', sb.auto_sync,
    'source', 'shared',
    'created_at', sb.created_at
  ) ORDER BY sb.created_at DESC) INTO v_shared
  FROM shared_blacklist sb
  LEFT JOIN customers c ON c.id = sb.guest_id
  WHERE sb.group_id = p_group_id;

  -- Per-lodge blacklisted customers from all member lodges
  SELECT jsonb_agg(jsonb_build_object(
    'guest_id', c.id,
    'guest_name', c.name,
    'guest_email', c.email,
    'guest_phone', c.phone,
    'reason', c.blacklist_reason,
    'source_lodge_id', c.lodge_id,
    'source', 'lodge_blacklist',
    'created_at', c.created_at
  ) ORDER BY c.created_at DESC) INTO v_lodge_blacklists
  FROM customers c
  WHERE c.lodge_id IN (
    SELECT pgm.lodge_id FROM property_group_members pgm WHERE pgm.group_id = p_group_id
  )
  AND c.is_blacklisted = true
  AND NOT EXISTS (
    SELECT 1 FROM shared_blacklist sb2 WHERE sb2.guest_id = c.id AND sb2.group_id = p_group_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'entries', COALESCE(v_shared, '[]'::jsonb) || COALESCE(v_lodge_blacklists, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_shared_blacklist(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_shared_blacklist(uuid, uuid) TO service_role;

-- RPC: add blacklist entry at group level, optionally syncing to all member lodges
CREATE OR REPLACE FUNCTION add_blacklist_entry(
  p_lodge_id uuid,
  p_group_id uuid,
  p_guest_id uuid DEFAULT NULL,
  p_guest_email text DEFAULT NULL,
  p_guest_phone text DEFAULT NULL,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry_id uuid;
  v_auto_sync boolean := true;
  v_member record;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  IF p_guest_id IS NULL AND p_guest_email IS NULL AND p_guest_phone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'At least one identifier (guest_id, email, or phone) is required');
  END IF;

  INSERT INTO shared_blacklist (group_id, guest_id, guest_email, guest_phone, reason, blacklisted_by, auto_sync)
  VALUES (p_group_id, p_guest_id, p_guest_email, p_guest_phone, p_reason, p_lodge_id, v_auto_sync)
  RETURNING id INTO v_entry_id;

  -- Auto-sync: update customers.is_blacklisted across all member lodges if guest_id is known
  IF v_auto_sync AND p_guest_id IS NOT NULL THEN
    FOR v_member IN
      SELECT lodge_id FROM property_group_members WHERE group_id = p_group_id
    LOOP
      UPDATE customers
      SET is_blacklisted = true,
          blacklist_reason = p_reason
      WHERE id = p_guest_id AND lodge_id = v_member.lodge_id;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id);
END;
$$;

GRANT EXECUTE ON FUNCTION add_blacklist_entry(uuid, uuid, uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION add_blacklist_entry(uuid, uuid, uuid, text, text, text) TO service_role;

-- RPC: remove blacklist entry
CREATE OR REPLACE FUNCTION remove_blacklist_entry(
  p_lodge_id uuid,
  p_group_id uuid,
  p_entry_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry shared_blacklist%ROWTYPE;
  v_member record;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  SELECT * INTO v_entry FROM shared_blacklist WHERE id = p_entry_id AND group_id = p_group_id;
  IF v_entry.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Entry not found');
  END IF;

  DELETE FROM shared_blacklist WHERE id = p_entry_id;

  -- If auto-synced, unset blacklist across member lodges
  IF v_entry.auto_sync AND v_entry.guest_id IS NOT NULL THEN
    FOR v_member IN
      SELECT lodge_id FROM property_group_members WHERE group_id = p_group_id
    LOOP
      UPDATE customers
      SET is_blacklisted = false,
          blacklist_reason = NULL
      WHERE id = v_entry.guest_id AND lodge_id = v_member.lodge_id;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION remove_blacklist_entry(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_blacklist_entry(uuid, uuid, uuid) TO service_role;

-- RPC: get shared corporate accounts at group level
CREATE OR REPLACE FUNCTION get_shared_corporate_accounts(
  p_lodge_id uuid,
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a member of this group');
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', sca.id,
    'corporate_account_id', sca.corporate_account_id,
    'company_name', ca.company_name,
    'contact_name', ca.contact_name,
    'contact_email', ca.contact_email,
    'contact_phone', ca.contact_phone,
    'credit_limit', ca.credit_limit,
    'share_level', sca.share_level,
    'owner_lodge_id', ca.lodge_id,
    'created_at', sca.created_at
  ) ORDER BY ca.company_name) INTO v_result
  FROM shared_corporate_accounts sca
  JOIN corporate_accounts ca ON ca.id = sca.corporate_account_id
  WHERE sca.group_id = p_group_id;

  RETURN jsonb_build_object('success', true, 'accounts', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION get_shared_corporate_accounts(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_shared_corporate_accounts(uuid, uuid) TO service_role;

-- RPC: share a corporate account across the group
CREATE OR REPLACE FUNCTION share_corporate_account(
  p_lodge_id uuid,
  p_group_id uuid,
  p_corporate_account_id uuid,
  p_share_level text DEFAULT 'read'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to share accounts in this group');
  END IF;

  IF p_share_level NOT IN ('read', 'write', 'full') THEN
    RETURN jsonb_build_object('success', false, 'error', 'share_level must be read, write, or full');
  END IF;

  INSERT INTO shared_corporate_accounts (group_id, corporate_account_id, share_level)
  VALUES (p_group_id, p_corporate_account_id, p_share_level)
  ON CONFLICT (group_id, corporate_account_id) DO UPDATE SET
    share_level = EXCLUDED.share_level;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION share_corporate_account(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION share_corporate_account(uuid, uuid, uuid, text) TO service_role;

-- RPC: unshare a corporate account from the group
CREATE OR REPLACE FUNCTION unshare_corporate_account(
  p_lodge_id uuid,
  p_group_id uuid,
  p_corporate_account_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id AND role_in_group = 'head_office') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to unshare accounts in this group');
  END IF;

  DELETE FROM shared_corporate_accounts WHERE group_id = p_group_id AND corporate_account_id = p_corporate_account_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION unshare_corporate_account(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION unshare_corporate_account(uuid, uuid, uuid) TO service_role;

-- RPC: get member lodges for a group
CREATE OR REPLACE FUNCTION get_group_member_lodges(
  p_lodge_id uuid,
  p_group_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, ARRAY['owner', 'admin', 'manager', 'super_admin', 'receptionist']);

  IF NOT EXISTS (SELECT 1 FROM property_group_members WHERE group_id = p_group_id AND lodge_id = p_lodge_id) THEN
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

  RETURN jsonb_build_object('success', true, 'lodges', COALESCE(v_result, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION get_group_member_lodges(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_group_member_lodges(uuid, uuid) TO service_role;

-- ── Room Attributes ─────────────────────────────────────────────────────────
-- Phase 4 Hotel Core: view type, bed type, amenities, accessibility features
-- Each lodge defines its own attribute catalog per room type

CREATE TABLE IF NOT EXISTS room_attributes (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  lodge_id      BIGINT NOT NULL,
  room_type_id  uuid,
  attribute_key TEXT NOT NULL CHECK (char_length(attribute_key) BETWEEN 1 AND 100),
  attribute_type TEXT NOT NULL DEFAULT 'text'
    CHECK (attribute_type IN ('text','boolean','number','select','multiselect')),
  label         TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 255),
  options       JSONB DEFAULT '[]'::jsonb,
  active        BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lodge_id, room_type_id, attribute_key)
);

CREATE INDEX IF NOT EXISTS idx_room_attributes_lodge ON room_attributes(lodge_id);
CREATE INDEX IF NOT EXISTS idx_room_attributes_room_type ON room_attributes(room_type_id);
CREATE INDEX IF NOT EXISTS idx_room_attributes_active ON room_attributes(active) WHERE active;

ALTER TABLE room_attributes ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "room_attributes_select_own" ON room_attributes
  FOR SELECT USING (
    lodge_id = NULLIF(current_setting('app.lodge_id', true), '')::BIGINT
    OR current_setting('app.lodge_id', true) IS NULL
  );

CREATE POLICY "room_attributes_manage_own" ON room_attributes
  FOR ALL USING (
    lodge_id = NULLIF(current_setting('app.lodge_id', true), '')::BIGINT
  );

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_room_attributes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_room_attributes_updated ON room_attributes;
CREATE TRIGGER trg_room_attributes_updated
  BEFORE UPDATE ON room_attributes
  FOR EACH ROW EXECUTE FUNCTION update_room_attributes_timestamp();

-- ── RPCs ──────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_room_attributes(p_lodge_id BIGINT DEFAULT NULL)
RETURNS SETOF room_attributes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lid BIGINT;
BEGIN
  lid := COALESCE(p_lodge_id, NULLIF(current_setting('app.lodge_id', true), '')::BIGINT);
  IF lid IS NULL THEN
    RAISE EXCEPTION 'lodge_id is required';
  END IF;
  PERFORM app_require_lodge_role(lid, 'room_attributes.view');
  RETURN QUERY SELECT * FROM room_attributes WHERE lodge_id = lid AND active = true ORDER BY sort_order, label;
END;
$$;

CREATE OR REPLACE FUNCTION create_room_attribute(
  p_lodge_id BIGINT,
  p_attribute_key TEXT,
  p_label TEXT,
  p_room_type_id uuid DEFAULT NULL,
  p_attribute_type TEXT DEFAULT 'text',
  p_options JSONB DEFAULT '[]'::jsonb,
  p_sort_order INT DEFAULT 0
)
RETURNS room_attributes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result room_attributes;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, 'room_attributes.manage');
  INSERT INTO room_attributes (lodge_id, room_type_id, attribute_key, attribute_type, label, options, sort_order)
  VALUES (p_lodge_id, p_room_type_id, p_attribute_key, p_attribute_type, p_label, p_options, p_sort_order)
  RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION update_room_attribute(
  p_id BIGINT,
  p_lodge_id BIGINT,
  p_room_type_id uuid DEFAULT NULL,
  p_attribute_key TEXT DEFAULT NULL,
  p_attribute_type TEXT DEFAULT NULL,
  p_label TEXT DEFAULT NULL,
  p_options JSONB DEFAULT NULL,
  p_active BOOLEAN DEFAULT NULL,
  p_sort_order INT DEFAULT NULL
)
RETURNS room_attributes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result room_attributes;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, 'room_attributes.manage');
  UPDATE room_attributes SET
    room_type_id   = COALESCE(p_room_type_id, room_type_id),
    attribute_key  = COALESCE(p_attribute_key, attribute_key),
    attribute_type = COALESCE(p_attribute_type, attribute_type),
    label          = COALESCE(p_label, label),
    options        = COALESCE(p_options, options),
    active         = COALESCE(p_active, active),
    sort_order     = COALESCE(p_sort_order, sort_order)
  WHERE id = p_id AND lodge_id = p_lodge_id
  RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION delete_room_attribute(p_id BIGINT, p_lodge_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attr_count INT;
BEGIN
  PERFORM app_require_lodge_role(p_lodge_id, 'room_attributes.manage');
  UPDATE room_attributes SET active = false WHERE id = p_id AND lodge_id = p_lodge_id;
  GET DIAGNOSTICS attr_count = ROW_COUNT;
  RETURN attr_count > 0;
END;
$$;

-- Grants
GRANT SELECT ON room_attributes TO authenticated;
GRANT INSERT, UPDATE, DELETE ON room_attributes TO authenticated;
GRANT USAGE ON SEQUENCE room_attributes_id_seq TO authenticated;
GRANT EXECUTE ON FUNCTION get_room_attributes TO authenticated;
GRANT EXECUTE ON FUNCTION create_room_attribute TO authenticated;
GRANT EXECUTE ON FUNCTION update_room_attribute TO authenticated;
GRANT EXECUTE ON FUNCTION delete_room_attribute TO authenticated;

GRANT ALL ON room_attributes TO service_role;
GRANT ALL ON FUNCTION get_room_attributes TO service_role;
GRANT ALL ON FUNCTION create_room_attribute TO service_role;
GRANT ALL ON FUNCTION update_room_attribute TO service_role;
GRANT ALL ON FUNCTION delete_room_attribute TO service_role;

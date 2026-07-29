-- 20260703180000_corporate_accounts_foundation.sql
-- Corporate accounts table for company billing and group blocks

CREATE TABLE IF NOT EXISTS corporate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lodge_id uuid NOT NULL,
  company_name text NOT NULL,
  contact_name text DEFAULT '',
  contact_email text DEFAULT '',
  contact_phone text DEFAULT '',
  billing_address text DEFAULT '',
  credit_limit numeric DEFAULT 0,
  payment_terms_days integer DEFAULT 30,
  tax_number text DEFAULT '',
  notes text DEFAULT '',
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE corporate_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY corporate_accounts_lodge_policy ON corporate_accounts
  FOR ALL
  USING (public.app_lodge_access(lodge_id))
  WITH CHECK (public.app_lodge_access(lodge_id));

CREATE INDEX IF NOT EXISTS idx_corporate_accounts_lodge ON corporate_accounts(lodge_id);

CREATE OR REPLACE FUNCTION create_corporate_account(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_lodge_id uuid;
  v_id uuid;
  v_result jsonb;
BEGIN
  v_lodge_id := (current_setting('request.jwt.claims', true)::jsonb ->> 'lodge_id')::uuid;
  IF v_lodge_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Lodge ID is required');
  END IF;

  PERFORM public.app_require_feature(v_lodge_id, 'corporate_accounts', ARRAY['manager', 'admin']);

  v_id := gen_random_uuid();
  INSERT INTO corporate_accounts (id, lodge_id, company_name, contact_name, contact_email, contact_phone, billing_address, credit_limit, payment_terms_days, tax_number, notes, status)
  VALUES (
    v_id,
    v_lodge_id,
    payload ->> 'company_name',
    COALESCE(payload ->> 'contact_name', ''),
    COALESCE(payload ->> 'contact_email', ''),
    COALESCE(payload ->> 'contact_phone', ''),
    COALESCE(payload ->> 'billing_address', ''),
    COALESCE((payload ->> 'credit_limit')::numeric, 0),
    COALESCE((payload ->> 'payment_terms_days')::integer, 30),
    COALESCE(payload ->> 'tax_number', ''),
    COALESCE(payload ->> 'notes', ''),
    COALESCE(payload ->> 'status', 'active')
  );

  v_result := jsonb_build_object('success', true, 'id', v_id);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION update_corporate_account(p_id uuid, p_lodge_id uuid, payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'corporate_accounts', ARRAY['manager', 'admin']);

  UPDATE corporate_accounts SET
    company_name = COALESCE(payload ->> 'company_name', company_name),
    contact_name = COALESCE(payload ->> 'contact_name', contact_name),
    contact_email = COALESCE(payload ->> 'contact_email', contact_email),
    contact_phone = COALESCE(payload ->> 'contact_phone', contact_phone),
    billing_address = COALESCE(payload ->> 'billing_address', billing_address),
    credit_limit = COALESCE((payload ->> 'credit_limit')::numeric, credit_limit),
    payment_terms_days = COALESCE((payload ->> 'payment_terms_days')::integer, payment_terms_days),
    tax_number = COALESCE(payload ->> 'tax_number', tax_number),
    notes = COALESCE(payload ->> 'notes', notes),
    status = COALESCE(payload ->> 'status', status),
    updated_at = now()
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Corporate account not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_corporate_account(p_id uuid, p_lodge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  PERFORM public.app_require_feature(p_lodge_id, 'corporate_accounts', ARRAY['manager', 'admin']);

  DELETE FROM corporate_accounts WHERE id = p_id AND lodge_id = p_lodge_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Corporate account not found');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION create_corporate_account(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION update_corporate_account(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION delete_corporate_account(uuid, uuid) TO authenticated, service_role;

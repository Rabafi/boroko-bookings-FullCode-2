-- Run with psql on an empty disposable PostgreSQL database.
\set ON_ERROR_STOP on
BEGIN;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT current_setting('request.jwt.claims', true)::jsonb $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
\ir ../supabase/migrations/20260610000000_marketing_site_leads.sql
\ir ../supabase/migrations/20260610100000_marketing_leads_admin.sql
GRANT ALL ON public.marketing_leads TO anon, authenticated, service_role;
\ir ../supabase/migrations/20261125120000_restrict_marketing_lead_access.sql

SET ROLE anon;
INSERT INTO public.marketing_leads (lodge_name, contact_name, email)
VALUES ('Synthetic property', 'Synthetic contact', 'test@example.invalid');
DO $$ BEGIN
  IF has_table_privilege(current_user, 'public.marketing_leads', 'SELECT')
     OR has_column_privilege(current_user, 'public.marketing_leads', 'status', 'INSERT')
  THEN RAISE EXCEPTION 'Visitor has excessive permissions'; END IF;
END $$;
RESET ROLE;

SET ROLE authenticated;
SET LOCAL request.jwt.claims = '{"user_metadata":{"marketing_crm_admin":true}}';
DO $$ DECLARE changed integer; BEGIN
  IF EXISTS (SELECT FROM public.marketing_leads) THEN
    RAISE EXCEPTION 'Untrusted profile metadata exposed leads';
  END IF;
  UPDATE public.marketing_leads SET status = 'contacted';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 0 OR has_function_privilege(current_user, 'public.update_lead_status(uuid,text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'Ordinary account can update leads'; END IF;
END $$;
SET LOCAL request.jwt.claims = '{"app_metadata":{"marketing_crm_admin":true}}';
DO $$ DECLARE changed integer; BEGIN
  IF (SELECT count(*) FROM public.marketing_leads) <> 1 THEN
    RAISE EXCEPTION 'Approved CRM staff cannot read leads';
  END IF;
  UPDATE public.marketing_leads SET status = 'contacted';
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'Approved CRM staff cannot change status'; END IF;
END $$;
RESET ROLE;

SET ROLE service_role;
UPDATE public.marketing_leads SET status = 'converted';
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.marketing_leads WHERE status = 'converted') THEN
    RAISE EXCEPTION 'Desktop service access did not survive';
  END IF;
END $$;
RESET ROLE;
ROLLBACK;

-- Visitors submit leads without receiving access to the CRM.
ALTER TABLE public.marketing_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Only authenticated users can view leads" ON public.marketing_leads;
DROP POLICY IF EXISTS "Authenticated users can update leads" ON public.marketing_leads;

REVOKE ALL ON TABLE public.marketing_leads FROM PUBLIC, anon, authenticated;
GRANT INSERT (lodge_name, contact_name, email, phone, interest, notes, source)
  ON public.marketing_leads TO anon;
GRANT SELECT ON public.marketing_leads TO authenticated;
GRANT UPDATE (status) ON public.marketing_leads TO authenticated;

-- app_metadata is managed by Supabase administrators. The legacy login
-- function's user_metadata must never confer CRM permissions.
CREATE POLICY "CRM staff can view marketing leads"
  ON public.marketing_leads FOR SELECT TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'marketing_crm_admin') = 'true');

CREATE POLICY "CRM staff can update marketing lead status"
  ON public.marketing_leads FOR UPDATE TO authenticated
  USING ((SELECT auth.jwt() -> 'app_metadata' ->> 'marketing_crm_admin') = 'true')
  WITH CHECK ((SELECT auth.jwt() -> 'app_metadata' ->> 'marketing_crm_admin') = 'true');

-- Command Central uses its existing server-side service-role client.
REVOKE EXECUTE ON FUNCTION public.update_lead_status(uuid, text)
  FROM PUBLIC, anon, authenticated;

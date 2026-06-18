-- ══════════════════════════════════════════════════════════════════════════════
-- Sales CRM: upgrade marketing_leads with pipeline stages, follow-up, value
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Add CRM columns to marketing_leads
ALTER TABLE public.marketing_leads
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS follow_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS sales_notes text,
  ADD COLUMN IF NOT EXISTS estimated_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS probability int DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  ADD COLUMN IF NOT EXISTS lost_reason text,
  ADD COLUMN IF NOT EXISTS converted_lodge_id uuid;

-- 2. Migrate existing status → stage (if status values map to old stages)
UPDATE public.marketing_leads SET stage = status WHERE stage = 'new' AND status IN ('contacted', 'converted', 'dropped');

-- 3. Index for pipeline queries
CREATE INDEX IF NOT EXISTS idx_marketing_leads_stage ON public.marketing_leads (stage);
CREATE INDEX IF NOT EXISTS idx_marketing_leads_follow_up ON public.marketing_leads (follow_up_at) WHERE follow_up_at IS NOT NULL;

-- 4. RPC: update lead with full CRM fields (replaces simple status update)
CREATE OR REPLACE FUNCTION public.update_lead_crm(
  p_lead_id uuid,
  p_stage text DEFAULT NULL,
  p_follow_up_at timestamptz DEFAULT NULL,
  p_sales_notes text DEFAULT NULL,
  p_estimated_value numeric DEFAULT NULL,
  p_probability int DEFAULT NULL,
  p_lost_reason text DEFAULT NULL,
  p_converted_lodge_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  UPDATE public.marketing_leads
  SET stage = COALESCE(p_stage, stage),
      status = COALESCE(p_stage, status),
      follow_up_at = p_follow_up_at,
      sales_notes = p_sales_notes,
      estimated_value = COALESCE(p_estimated_value, estimated_value),
      probability = COALESCE(p_probability, probability),
      lost_reason = p_lost_reason,
      converted_lodge_id = p_converted_lodge_id
  WHERE id = p_lead_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_lead_crm(uuid,text,timestamptz,text,numeric,int,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_lead_crm(uuid,text,timestamptz,text,numeric,int,text,uuid) TO authenticated, service_role;

-- 5. RPC: get pipeline summary stats
CREATE OR REPLACE FUNCTION public.get_sales_pipeline_summary()
RETURNS TABLE (
  stage text,
  count bigint,
  total_value numeric,
  weighted_value numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.app_is_service_role() OR public.app_current_role() = 'super_admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  RETURN QUERY
  SELECT
    ml.stage,
    COUNT(*) AS count,
    COALESCE(SUM(ml.estimated_value), 0) AS total_value,
    COALESCE(SUM(ml.estimated_value * ml.probability / 100.0), 0) AS weighted_value
  FROM public.marketing_leads ml
  GROUP BY ml.stage
  ORDER BY
    CASE ml.stage
      WHEN 'new' THEN 1
      WHEN 'contacted' THEN 2
      WHEN 'demo_scheduled' THEN 3
      WHEN 'proposal_sent' THEN 4
      WHEN 'won' THEN 5
      WHEN 'lost' THEN 6
      ELSE 7
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_pipeline_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_sales_pipeline_summary() TO authenticated, service_role;

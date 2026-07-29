-- Restaurant operations are scoped by a company's lodge_id.  settings.id is
-- an independent settings-row identifier, so using it here rejects valid
-- restaurant companies whose settings row has a generated primary key.
CREATE OR REPLACE FUNCTION public.app_require_restaurant_lodge(
  p_lodge_id uuid,
  p_roles text[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_property_type text;
BEGIN
  IF public.app_is_service_role() THEN
    RETURN;
  END IF;

  IF p_roles IS NOT NULL THEN
    PERFORM public.app_require_lodge_role(p_lodge_id, p_roles);
  ELSE
    PERFORM public.app_require_lodge_role(p_lodge_id);
  END IF;

  SELECT property_type INTO v_property_type
  FROM public.settings
  WHERE lodge_id = p_lodge_id;

  IF v_property_type IS NULL THEN
    RAISE EXCEPTION 'Lodge settings not found for restaurant guard.' USING ERRCODE = '28000';
  END IF;

  IF v_property_type NOT IN ('restaurant', 'pos_only') THEN
    RAISE EXCEPTION 'This feature is restaurant-only. Lodge property type is %', v_property_type
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.app_require_restaurant_lodge(uuid, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_require_restaurant_lodge(uuid, text[]) TO authenticated, service_role;

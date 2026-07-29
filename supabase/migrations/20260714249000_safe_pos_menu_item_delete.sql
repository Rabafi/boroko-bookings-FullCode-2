-- Preserve completed-sales history while allowing genuinely unused menu setup
-- mistakes to be removed entirely.
CREATE OR REPLACE FUNCTION public.delete_pos_menu_item(p_id uuid, p_lodge_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id uuid;
  v_has_sale_history boolean;
BEGIN
  PERFORM public.app_require_lodge_role(p_lodge_id, ARRAY['manager', 'admin', 'super_admin']);

  SELECT id INTO v_item_id
  FROM public.pos_menu_items
  WHERE id = p_id AND lodge_id = p_lodge_id;

  IF v_item_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'POS menu item not found');
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.pos_order_items WHERE menu_item_id = p_id
  ) INTO v_has_sale_history;

  IF v_has_sale_history THEN
    UPDATE public.pos_menu_items
       SET is_available = false, updated_at = now()
     WHERE id = p_id AND lodge_id = p_lodge_id;
    RETURN jsonb_build_object(
      'success', true,
      'id', p_id,
      'soft_deleted', true,
      'message', 'Item has sale history and was archived instead of deleted.'
    );
  END IF;

  DELETE FROM public.pos_menu_items
  WHERE id = p_id AND lodge_id = p_lodge_id;

  RETURN jsonb_build_object('success', true, 'id', p_id, 'hard_deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_pos_menu_item(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_pos_menu_item(uuid, uuid) TO anon, authenticated, service_role;

-- Atomic local equivalent of saveBarProductWithStock/saveBarProductWithPacks.
-- Product edits never reapply opening stock; packs share the base stock through
-- ordinary recipe depletion, so they cannot create phantom inventory.

ALTER TABLE bar_local.products
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS reorder_level numeric(18,6) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  ADD COLUMN IF NOT EXISTS unit_cost numeric(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  ADD COLUMN IF NOT EXISTS selling_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
  ADD COLUMN IF NOT EXISTS sellable boolean NOT NULL DEFAULT true;

DROP INDEX IF EXISTS bar_local.products_business_barcode_unique;
CREATE UNIQUE INDEX IF NOT EXISTS products_business_menu_barcode_unique
  ON bar_local.products (business_id, lower(barcode)) WHERE sellable AND barcode IS NOT NULL AND btrim(barcode) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS products_business_stock_barcode_unique
  ON bar_local.products (business_id, lower(barcode)) WHERE track_stock AND NOT sellable AND barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE TABLE IF NOT EXISTS bar_local.bar_product_stock_links (
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  menu_product_id uuid NOT NULL REFERENCES bar_local.products(id),
  stock_product_id uuid NOT NULL REFERENCES bar_local.products(id),
  depletion_qty numeric(18,6) NOT NULL CHECK (depletion_qty > 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  operation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, menu_product_id)
);

CREATE TABLE IF NOT EXISTS bar_local.bar_product_packs (
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  menu_product_id uuid NOT NULL REFERENCES bar_local.products(id),
  pack_size integer NOT NULL CHECK (pack_size IN (6, 12, 24)),
  pack_product_id uuid NOT NULL UNIQUE REFERENCES bar_local.products(id),
  barcode text,
  active boolean NOT NULL DEFAULT true,
  operation_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, menu_product_id, pack_size)
);

-- A direct stock link is an authoritative depletion recipe. Protect it in the
-- database so a generic recipe command cannot bypass the product wizard's UI.
CREATE OR REPLACE FUNCTION bar_local.guard_bar_product_linked_recipe_line()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_recipe_id uuid;
  v_product_id uuid;
  v_expected_stock_id uuid;
  v_expected_quantity numeric(18,6);
BEGIN
  IF TG_OP='UPDATE' AND OLD.recipe_id IS DISTINCT FROM NEW.recipe_id THEN
    SELECT r.product_id INTO v_product_id FROM bar_local.product_recipes r WHERE r.id=OLD.recipe_id;
    IF FOUND THEN
      SELECT l.stock_product_id INTO v_expected_stock_id FROM bar_local.bar_product_stock_links l
       WHERE l.business_id=(SELECT business_id FROM bar_local.product_recipes WHERE id=OLD.recipe_id) AND l.menu_product_id=v_product_id;
      IF NOT FOUND THEN
        SELECT l.stock_product_id INTO v_expected_stock_id FROM bar_local.bar_product_packs p
          JOIN bar_local.bar_product_stock_links l ON l.business_id=p.business_id AND l.menu_product_id=p.menu_product_id
         WHERE p.pack_product_id=v_product_id;
      END IF;
      IF v_expected_stock_id IS NOT NULL THEN
        PERFORM bar_local.raise_business('STOCK_LINK_RECIPE_LOCKED', 'This product recipe is controlled by its direct stock link. Edit stock depletion in the Bar product wizard.');
      END IF;
    END IF;
  END IF;
  v_recipe_id := CASE WHEN TG_OP='DELETE' THEN OLD.recipe_id ELSE NEW.recipe_id END;
  SELECT r.product_id INTO v_product_id FROM bar_local.product_recipes r WHERE r.id=v_recipe_id;
  IF NOT FOUND THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  SELECT l.stock_product_id, l.depletion_qty INTO v_expected_stock_id, v_expected_quantity
    FROM bar_local.bar_product_stock_links l WHERE l.business_id=(SELECT business_id FROM bar_local.product_recipes WHERE id=v_recipe_id)
      AND l.menu_product_id=v_product_id;
  IF NOT FOUND THEN
    SELECT l.stock_product_id, l.depletion_qty*p.pack_size INTO v_expected_stock_id, v_expected_quantity
      FROM bar_local.bar_product_packs p JOIN bar_local.bar_product_stock_links l
        ON l.business_id=p.business_id AND l.menu_product_id=p.menu_product_id
     WHERE p.pack_product_id=v_product_id;
  END IF;
  IF v_expected_stock_id IS NULL THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN
    PERFORM bar_local.raise_business('STOCK_LINK_RECIPE_LOCKED', 'This product recipe is controlled by its direct stock link. Edit stock depletion in the Bar product wizard.');
  END IF;
  IF NEW.line_number<>1 OR NEW.ingredient_product_id<>v_expected_stock_id OR NEW.quantity<>v_expected_quantity THEN
    PERFORM bar_local.raise_business('STOCK_LINK_RECIPE_LOCKED', 'This product recipe is controlled by its direct stock link. Edit stock depletion in the Bar product wizard.');
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION bar_local.guard_bar_product_linked_recipe_line() OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.guard_bar_product_linked_recipe_line() SECURITY DEFINER;
ALTER FUNCTION bar_local.guard_bar_product_linked_recipe_line() SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.guard_bar_product_linked_recipe_line() FROM PUBLIC,bar_local_runtime;
DROP TRIGGER IF EXISTS bar_product_linked_recipe_line_guard ON bar_local.product_recipe_lines;
CREATE TRIGGER bar_product_linked_recipe_line_guard
BEFORE INSERT OR UPDATE OR DELETE ON bar_local.product_recipe_lines
FOR EACH ROW EXECUTE FUNCTION bar_local.guard_bar_product_linked_recipe_line();

-- Keep the existing versioned menu query as the native Hpos compatibility
-- read. The added fields come from the same outlet/snapshot as price and
-- availability; pack rows point back to their shared stock product.
CREATE OR REPLACE FUNCTION bar_local.query_dispatch_menu(
  p_token_hash text, p_device_id uuid, p_authority_id uuid, p_authority_epoch bigint,
  p_query text, p_filters jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_outlet uuid;
  v_limit integer;
  v_data jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_next text;
  v_watermark bigint;
  v_as_of text;
  v_scope jsonb;
  v_filters jsonb;
BEGIN
  IF p_query NOT IN ('menu.availability','stock.list') THEN
    RETURN bar_local.query_dispatch_purchasing(p_token_hash,p_device_id,p_authority_id,p_authority_epoch,p_query,p_filters);
  END IF;
  v_ctx := bar_local.query_session(p_token_hash,p_device_id,p_authority_id,p_authority_epoch);
  IF p_query='stock.list' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities,'inventory.view');
  ELSE
    PERFORM bar_local.assert_capability(v_ctx.capabilities,'pos.view');
  END IF;
  v_outlet := bar_local.query_outlet(v_ctx,COALESCE(p_filters,'{}'::jsonb));
  v_filters := COALESCE(p_filters,'{}'::jsonb);
  v_limit := bar_local.query_limit(v_filters);
  SELECT commit_sequence INTO v_watermark FROM bar_local.authority_counter WHERE singleton;
  v_as_of := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_scope := jsonb_build_object('business_id',v_ctx.business_id,'outlet_id',v_ctx.outlet_id,
    'actor_staff_id',v_ctx.staff_id,'role',v_ctx.role,'device_id',v_ctx.device_id);

  IF p_query='stock.list' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name,x.product_id),'[]'::jsonb) INTO v_data
      FROM (SELECT p.id AS product_id,p.sku,p.name,p.category,p.track_stock,p.active,p.barcode,p.unit,
                   p.reorder_level,p.unit_cost,p.selling_price,p.version AS product_version,
                   COALESCE(sb.quantity,0) AS quantity,COALESCE(sb.version,0) AS version,sb.updated_at
              FROM bar_local.products p
              LEFT JOIN bar_local.stock_balances sb ON sb.business_id=p.business_id AND sb.outlet_id=v_outlet AND sb.product_id=p.id
             WHERE p.business_id=v_ctx.business_id AND p.track_stock
               AND (NOT COALESCE((v_filters->>'low_only')::boolean,false) OR COALESCE(sb.quantity,0)<=p.reorder_level)
               AND (v_filters->>'cursor' IS NULL OR p.id::text>v_filters->>'cursor')
             ORDER BY p.id LIMIT v_limit+1) x;
    IF jsonb_array_length(v_data)>v_limit THEN
      v_data:=v_data-v_limit; v_has_more:=true; v_next:=v_data->-1->>'product_id';
    END IF;
    RETURN jsonb_build_object('data',v_data,'pagination',jsonb_build_object('next_cursor',v_next,'has_more',v_has_more),
      'snapshot_watermark',v_watermark,'scope',v_scope,'as_of',v_as_of,'complete',true,'unavailable','[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(CASE WHEN x.modifier_groups IS NULL THEN to_jsonb(x)-'modifier_groups' ELSE to_jsonb(x) END
           ORDER BY x.sku,x.product_id),'[]'::jsonb) INTO v_data
    FROM (
      SELECT p.id AS product_id,p.sku,p.name,p.category,p.price,p.tax_rate,p.track_stock,p.active AS product_active,
             EXISTS (SELECT 1 FROM bar_local.product_recipes pr JOIN bar_local.product_recipe_lines pl ON pl.recipe_id=pr.id
               WHERE pr.business_id=p.business_id AND pr.product_id=p.id) AS has_recipe,
             p.barcode,p.version AS product_version,p.unit,p.reorder_level,p.unit_cost,p.selling_price,
             CASE WHEN link.stock_product_id IS NOT NULL THEN link.stock_product_id
                  WHEN parent_link.stock_product_id IS NOT NULL THEN parent_link.stock_product_id
                  WHEN p.track_stock THEN p.id ELSE NULL END AS inventory_item_id,
             COALESCE(link.depletion_qty,1) AS depletion_qty,
             (p.active AND COALESCE(pa.available,true)) AS available,pa.available AS override_available,
             COALESCE(pa.version,0) AS availability_version,COALESCE(sb.quantity,0) AS stock_quantity,
             COALESCE(sb.version,0) AS stock_version,
             pa.updated_at AS availability_updated_at,
             CASE WHEN pack.pack_product_id IS NULL THEN NULL ELSE 'bar_pack' END AS template_kind,
             pack.pack_size AS template_pack_size,pack.menu_product_id AS template_parent_product_id,pack.barcode AS pack_barcode,
             mods.modifier_groups
        FROM bar_local.products p
        LEFT JOIN bar_local.bar_product_stock_links link ON link.business_id=p.business_id AND link.menu_product_id=p.id
        LEFT JOIN bar_local.bar_product_packs pack ON pack.business_id=p.business_id AND pack.pack_product_id=p.id
        LEFT JOIN bar_local.bar_product_stock_links parent_link ON parent_link.business_id=p.business_id AND parent_link.menu_product_id=pack.menu_product_id
        LEFT JOIN bar_local.product_availability pa ON pa.business_id=p.business_id AND pa.outlet_id=v_outlet AND pa.product_id=p.id
        LEFT JOIN bar_local.stock_balances sb ON sb.business_id=p.business_id AND sb.outlet_id=v_outlet
             AND sb.product_id=COALESCE(link.stock_product_id,parent_link.stock_product_id,p.id)
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('modifier_group_id',mg.id,'group_id',mg.id,'code',mg.code,'name',mg.name,
                   'required',mg.required,'min_selections',mg.min_selections,'max_selections',mg.max_selections,
                   'active',mg.active,'version',mg.version,'sort_order',pml.sort_order,'options',COALESCE((
                     SELECT jsonb_agg(jsonb_build_object('modifier_option_id',mo.id,'option_id',mo.id,'modifier_group_id',mo.group_id,
                       'group_id',mo.group_id,'code',mo.code,'name',mo.name,'price_delta',mo.price_delta,
                       'sort_order',mo.sort_order,'active',mo.active,'version',mo.version) ORDER BY mo.sort_order,mo.code,mo.id)
                       FROM bar_local.modifier_options mo WHERE mo.business_id=v_ctx.business_id AND mo.group_id=mg.id AND mo.active
                   ),'[]'::jsonb)) ORDER BY pml.sort_order,mg.code,mg.id) AS modifier_groups
            FROM bar_local.product_modifier_links pml JOIN bar_local.modifier_groups mg
              ON mg.id=pml.group_id AND mg.business_id=pml.business_id
           WHERE pml.business_id=v_ctx.business_id AND pml.product_id=p.id AND pml.active AND mg.active
        ) mods ON true
       WHERE p.business_id=v_ctx.business_id AND p.sellable
         AND (COALESCE((v_filters->>'include_inactive')::boolean,false) OR p.active)
         AND (NOT COALESCE((v_filters->>'available_only')::boolean,false) OR (p.active AND COALESCE(pa.available,true)))
         AND (v_filters->>'cursor' IS NULL OR p.sku>v_filters->>'cursor')
       ORDER BY p.sku,p.id LIMIT v_limit+1
    ) x;
  IF jsonb_array_length(v_data)>v_limit THEN
    v_data:=v_data-v_limit; v_has_more:=true; v_next:=v_data->-1->>'sku';
  END IF;
  RETURN jsonb_build_object('data',v_data,'pagination',jsonb_build_object('next_cursor',v_next,'has_more',v_has_more),
    'snapshot_watermark',v_watermark,'scope',v_scope,'as_of',v_as_of,'complete',true,'unavailable','[]'::jsonb);
END;
$$;
ALTER FUNCTION bar_local.query_dispatch_menu(text,uuid,uuid,bigint,text,jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.query_dispatch_menu(text,uuid,uuid,bigint,text,jsonb) SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.query_dispatch_menu(text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,bar_local_runtime;

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_bar_product_save(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_menu_id uuid := NULLIF(v_payload->>'menu_item_id','')::uuid;
  v_stock_id uuid := NULLIF(v_payload->>'inventory_item_id','')::uuid;
  v_expected integer := NULLIF(v_payload->>'expected_menu_version','')::integer;
  v_expected_stock integer := NULLIF(v_payload->>'expected_stock_version','')::integer;
  v_stock_version integer;
  v_balance_missing boolean := false;
  v_mode text := v_payload->>'stock_mode';
  v_outlet uuid;
  v_product bar_local.products%ROWTYPE;
  v_stock bar_local.products%ROWTYPE;
  v_link bar_local.bar_product_stock_links%ROWTYPE;
  v_had_link boolean := false;
  v_before jsonb;
  v_pack jsonb;
  v_pack_id uuid;
  v_pack_sku text;
  v_pack_barcode text;
  v_pack_size integer;
  v_opening numeric(18,6) := COALESCE(NULLIF(v_payload->>'opening_stock','')::numeric,0);
  v_sequence bigint;
  v_catalogue bigint;
  v_result jsonb; v_receipt jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  IF v_mode = 'create' AND (v_opening > 0 OR COALESCE((v_payload->>'track_stock')::boolean,true)) THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.manage');
  END IF;
  IF v_mode = 'link' THEN
    PERFORM bar_local.assert_capability(v_ctx.capabilities, 'inventory.manage');
  END IF;
  v_outlet := v_ctx.outlet_id;
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF NULLIF(v_payload->>'outlet_id','') IS NOT NULL AND (v_payload->>'outlet_id')::uuid <> v_outlet THEN
      PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The stock outlet must match the authenticated Bar outlet.');
    END IF;
    IF v_mode NOT IN ('create','link') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Choose whether this product creates or links its stock item.');
    END IF;
    IF v_mode = 'link' THEN
      SELECT * INTO v_stock FROM bar_local.products WHERE id = v_stock_id AND business_id = v_ctx.business_id FOR UPDATE;
      IF NOT FOUND OR NOT v_stock.track_stock OR NOT v_stock.active THEN
        PERFORM bar_local.raise_business('STOCK_ITEM_NOT_FOUND', 'The selected stock item is not active in this Bar. Refresh Stock and choose an active item.');
      END IF;
      SELECT version INTO v_stock_version FROM bar_local.stock_balances
       WHERE business_id=v_ctx.business_id AND outlet_id=v_outlet AND product_id=v_stock_id;
      v_balance_missing := NOT FOUND;
      IF v_expected_stock IS NULL OR COALESCE(v_stock_version,0) <> v_expected_stock THEN
        PERFORM bar_local.raise_business('STOCK_VERSION_CONFLICT', 'The selected stock item changed. Refresh Stock and review it before saving.');
      END IF;
      INSERT INTO bar_local.stock_balances (business_id,outlet_id,product_id,quantity)
      VALUES (v_ctx.business_id,v_outlet,v_stock_id,0) ON CONFLICT (business_id,outlet_id,product_id) DO NOTHING;
      SELECT version INTO v_stock_version FROM bar_local.stock_balances
       WHERE business_id=v_ctx.business_id AND outlet_id=v_outlet AND product_id=v_stock_id FOR UPDATE;
      IF v_balance_missing AND v_stock_version <> 1 THEN
        PERFORM bar_local.raise_business('STOCK_VERSION_CONFLICT', 'The selected stock item changed while this product was being saved. Refresh Stock and try again.');
      ELSIF NOT v_balance_missing AND v_stock_version <> v_expected_stock THEN
        PERFORM bar_local.raise_business('STOCK_VERSION_CONFLICT', 'The selected stock item changed while this product was being saved. Refresh Stock and try again.');
      END IF;
      IF EXISTS (SELECT 1 FROM bar_local.stock_balances WHERE business_id=v_ctx.business_id AND product_id=v_stock_id AND outlet_id<>v_outlet)
         AND NOT EXISTS (SELECT 1 FROM bar_local.stock_balances WHERE business_id=v_ctx.business_id AND product_id=v_stock_id AND outlet_id=v_outlet) THEN
        PERFORM bar_local.raise_business('OUTLET_SCOPE_MISMATCH', 'The selected stock item belongs to a different outlet.');
      END IF;
    END IF;

    IF v_menu_id IS NOT NULL THEN
      SELECT * INTO v_product FROM bar_local.products WHERE id = v_menu_id AND business_id = v_ctx.business_id FOR UPDATE;
      IF NOT FOUND OR v_expected IS NULL OR v_product.version <> v_expected THEN
        PERFORM bar_local.raise_business('PRODUCT_VERSION_CONFLICT', 'The product changed or is no longer available. Refresh Menu before saving.');
      END IF;
      SELECT * INTO v_link FROM bar_local.bar_product_stock_links
       WHERE business_id = v_ctx.business_id AND menu_product_id = v_menu_id FOR UPDATE;
      v_had_link := FOUND;
      IF FOUND AND (v_link.stock_product_id <> CASE WHEN v_mode = 'create' THEN v_menu_id ELSE v_stock_id END) THEN
        PERFORM bar_local.raise_business('STOCK_LINK_CHANGE_UNSUPPORTED', 'This product has an established stock identity. Keep that stock link and edit the product, or archive it and create a new product.');
      END IF;
      IF v_mode='create' AND v_had_link AND v_link.stock_product_id<>v_menu_id THEN
        PERFORM bar_local.raise_business('STOCK_LINK_CHANGE_UNSUPPORTED', 'This product already uses a separate stock item. Keep that link and edit the product, or archive it and create a new product.');
      END IF;
      IF v_had_link AND NOT COALESCE((v_payload->>'track_stock')::boolean,true) THEN
        PERFORM bar_local.raise_business('STOCK_LINK_CHANGE_UNSUPPORTED', 'This product has stock history. Keep stock tracking enabled; stock identity cannot be removed during an edit.');
      END IF;
        IF v_mode = 'create' AND v_menu_id <> COALESCE(v_stock_id, v_menu_id) THEN
        PERFORM bar_local.raise_business('STOCK_LINK_CHANGE_UNSUPPORTED', 'A created stock identity cannot be replaced during an edit.');
      END IF;
      v_before := jsonb_build_object('product_id',v_product.id,'sku',v_product.sku,'name',v_product.name,
        'category',v_product.category,'price',v_product.price,'active',v_product.active,'version',v_product.version,
        'stock_product_id',CASE WHEN v_had_link THEN v_link.stock_product_id ELSE v_product.id END);
      UPDATE bar_local.products SET name=v_payload->>'name', category=v_payload->>'category',
        price=(v_payload->>'price')::numeric, barcode=NULLIF(v_payload->>'barcode',''),
        version=version+1, active=true, sellable=true, updated_at=now()
       WHERE id=v_menu_id AND business_id=v_ctx.business_id RETURNING * INTO v_product;
      IF COALESCE((v_payload->>'track_stock')::boolean,true) AND v_mode='link' THEN
        -- The linked stock row was version-checked and locked above. Preserve
        -- that exact identity when editing an existing sellable product.
        v_stock_id := CASE WHEN v_had_link THEN v_link.stock_product_id ELSE v_stock_id END;
        SELECT * INTO v_stock FROM bar_local.products WHERE id=v_stock_id AND business_id=v_ctx.business_id FOR UPDATE;
      ELSIF v_mode='create' AND COALESCE((v_payload->>'track_stock')::boolean,true) THEN
        IF v_had_link THEN
          v_stock_id := v_link.stock_product_id;
          SELECT * INTO v_stock FROM bar_local.products WHERE id=v_stock_id AND business_id=v_ctx.business_id FOR UPDATE;
        ELSIF v_product.track_stock THEN
          -- Older local catalogue rows may already be the stock identity.
          v_stock_id := v_menu_id;
          v_stock := v_product;
        ELSE
          v_stock_id := gen_random_uuid();
          INSERT INTO bar_local.products (id,business_id,sku,name,category,price,tax_rate,track_stock,active,barcode,unit,reorder_level,unit_cost,selling_price,sellable)
          VALUES (v_stock_id,v_ctx.business_id,'STK-'||replace(v_stock_id::text,'-',''),v_payload->>'stock_name',v_payload->>'stock_category',
            0,0,true,true,NULLIF(v_payload->>'stock_barcode',''),v_payload->>'stock_unit',(v_payload->>'reorder_level')::numeric,
            (v_payload->>'unit_cost')::numeric,(v_payload->>'selling_price')::numeric,false)
          RETURNING * INTO v_stock;
        END IF;
      ELSE
        v_stock_id := NULL;
      END IF;
    ELSE
      IF v_mode = 'create' THEN
        v_menu_id := gen_random_uuid();
        IF COALESCE((v_payload->>'track_stock')::boolean,true) THEN
          v_stock_id := gen_random_uuid();
          INSERT INTO bar_local.products (id,business_id,sku,name,category,price,tax_rate,track_stock,active,barcode,unit,reorder_level,unit_cost,selling_price,sellable)
          VALUES (v_stock_id,v_ctx.business_id,'STK-'||replace(v_stock_id::text,'-',''),v_payload->>'stock_name',v_payload->>'stock_category',
            0,0,true,true,NULLIF(v_payload->>'stock_barcode',''),v_payload->>'stock_unit',(v_payload->>'reorder_level')::numeric,
            (v_payload->>'unit_cost')::numeric,(v_payload->>'selling_price')::numeric,false)
          RETURNING * INTO v_stock;
        ELSE
          v_stock_id := NULL;
        END IF;
        INSERT INTO bar_local.products (id,business_id,sku,name,category,price,tax_rate,track_stock,active,barcode,selling_price,sellable)
        VALUES (v_menu_id,v_ctx.business_id,'BAR-'||replace(v_menu_id::text,'-',''),v_payload->>'name',v_payload->>'category',
          (v_payload->>'price')::numeric,0,false,true,NULLIF(v_payload->>'barcode',''),(v_payload->>'selling_price')::numeric,true)
        RETURNING * INTO v_product;
      ELSE
        v_menu_id := gen_random_uuid();
        INSERT INTO bar_local.products (id,business_id,sku,name,category,price,tax_rate,track_stock,active,barcode,selling_price,sellable)
        VALUES (v_menu_id,v_ctx.business_id,'BAR-'||replace(v_menu_id::text,'-',''),v_payload->>'name',v_payload->>'category',
          (v_payload->>'price')::numeric,0,false,true,NULLIF(v_payload->>'barcode',''),(v_payload->>'selling_price')::numeric,true)
        RETURNING * INTO v_product;
      END IF;
    END IF;

    IF COALESCE((v_payload->>'track_stock')::boolean,true) AND v_stock_id IS NOT NULL THEN
      INSERT INTO bar_local.bar_product_stock_links (business_id,menu_product_id,stock_product_id,depletion_qty,operation_id)
      VALUES (v_ctx.business_id,v_menu_id,v_stock_id,(v_payload->>'depletion_qty')::numeric,(p_envelope->>'operation_id')::uuid)
      ON CONFLICT (business_id,menu_product_id) DO UPDATE SET depletion_qty=EXCLUDED.depletion_qty,
        version=bar_local.bar_product_stock_links.version+1,operation_id=EXCLUDED.operation_id,updated_at=now();
      IF v_stock_id<>v_menu_id THEN
        INSERT INTO bar_local.product_recipes (business_id,product_id,created_by,updated_by,created_operation_id,updated_operation_id)
        VALUES (v_ctx.business_id,v_menu_id,v_ctx.staff_id,v_ctx.staff_id,(p_envelope->>'operation_id')::uuid,(p_envelope->>'operation_id')::uuid)
        ON CONFLICT (business_id,product_id) DO UPDATE SET version=bar_local.product_recipes.version+1,
          updated_by=EXCLUDED.updated_by,updated_operation_id=EXCLUDED.updated_operation_id,updated_at=now();
        IF EXISTS (SELECT 1 FROM bar_local.product_recipe_lines WHERE recipe_id=(SELECT id FROM bar_local.product_recipes WHERE business_id=v_ctx.business_id AND product_id=v_menu_id)) THEN
          UPDATE bar_local.product_recipe_lines SET line_number=1,ingredient_product_id=v_stock_id,
            quantity=(v_payload->>'depletion_qty')::numeric,unit_cost=v_stock.unit_cost
           WHERE recipe_id=(SELECT id FROM bar_local.product_recipes WHERE business_id=v_ctx.business_id AND product_id=v_menu_id);
        ELSE
          INSERT INTO bar_local.product_recipe_lines (recipe_id,line_number,ingredient_product_id,quantity,unit_cost)
          SELECT id,1,v_stock_id,(v_payload->>'depletion_qty')::numeric,v_stock.unit_cost
            FROM bar_local.product_recipes WHERE business_id=v_ctx.business_id AND product_id=v_menu_id;
        END IF;
      END IF;
    ELSE
      v_stock_id := NULL;
    END IF;

    INSERT INTO bar_local.product_availability
      (business_id,outlet_id,product_id,available,created_by,updated_by,created_operation_id,updated_operation_id)
    VALUES (v_ctx.business_id,v_outlet,v_menu_id,COALESCE((v_payload->>'is_available')::boolean,true),
      v_ctx.staff_id,v_ctx.staff_id,(p_envelope->>'operation_id')::uuid,(p_envelope->>'operation_id')::uuid)
    ON CONFLICT (business_id,outlet_id,product_id) DO UPDATE SET
      available=EXCLUDED.available,version=bar_local.product_availability.version+1,
      updated_by=EXCLUDED.updated_by,updated_operation_id=EXCLUDED.updated_operation_id,updated_at=now();

    IF v_mode = 'create' AND v_stock_id IS NOT NULL AND v_opening > 0 AND v_expected IS NULL THEN
      INSERT INTO bar_local.stock_balances (business_id,outlet_id,product_id,quantity)
      VALUES (v_ctx.business_id,v_outlet,v_stock_id,v_opening);
      INSERT INTO bar_local.stock_movements (business_id,outlet_id,product_id,delta,reason,operation_id,business_date,unit_cost,reference)
      VALUES (v_ctx.business_id,v_outlet,v_stock_id,v_opening,'opening_stock',(p_envelope->>'operation_id')::uuid,
        bar_local.current_business_date(),(v_payload->>'unit_cost')::numeric,'Initial stock on Bar product creation');
    END IF;

    FOR v_pack IN SELECT value FROM jsonb_array_elements(COALESCE(v_payload->'packs','[]'::jsonb)) LOOP
      v_pack_size := (v_pack->>'pack_size')::integer;
      v_pack_barcode := NULLIF(v_pack->>'barcode','');
      SELECT pack_product_id INTO v_pack_id FROM bar_local.bar_product_packs
       WHERE business_id=v_ctx.business_id AND menu_product_id=v_menu_id AND pack_size=v_pack_size FOR UPDATE;
      IF COALESCE((v_pack->>'enabled')::boolean,false) THEN
        IF v_pack_id IS NULL THEN v_pack_id := gen_random_uuid(); END IF;
        v_pack_sku := 'BAR-'||replace(v_menu_id::text,'-','')||'-P'||v_pack_size::text;
        INSERT INTO bar_local.products (id,business_id,sku,name,category,price,tax_rate,track_stock,active,barcode,selling_price)
        VALUES (v_pack_id,v_ctx.business_id,v_pack_sku,
          CASE WHEN v_pack_size=24 THEN v_payload->>'name'||' Case (24)' ELSE v_payload->>'name'||' '||v_pack_size::text||' Pack' END,
          'Drinks',(v_payload->>'selling_price')::numeric*v_pack_size,0,false,true,v_pack_barcode,(v_payload->>'selling_price')::numeric*v_pack_size)
        ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,price=EXCLUDED.price,active=true,track_stock=false,barcode=EXCLUDED.barcode,
          selling_price=EXCLUDED.selling_price,version=bar_local.products.version+1,updated_at=now();
        INSERT INTO bar_local.bar_product_packs (business_id,menu_product_id,pack_size,pack_product_id,barcode,active,operation_id)
        VALUES (v_ctx.business_id,v_menu_id,v_pack_size,v_pack_id,v_pack_barcode,true,(p_envelope->>'operation_id')::uuid)
        ON CONFLICT (business_id,menu_product_id,pack_size) DO UPDATE SET pack_product_id=EXCLUDED.pack_product_id,
          barcode=EXCLUDED.barcode,active=true,operation_id=EXCLUDED.operation_id,updated_at=now();
        INSERT INTO bar_local.product_availability
          (business_id,outlet_id,product_id,available,created_by,updated_by,created_operation_id,updated_operation_id)
        VALUES (v_ctx.business_id,v_outlet,v_pack_id,COALESCE((v_payload->>'is_available')::boolean,true),
          v_ctx.staff_id,v_ctx.staff_id,(p_envelope->>'operation_id')::uuid,(p_envelope->>'operation_id')::uuid)
        ON CONFLICT (business_id,outlet_id,product_id) DO UPDATE SET
          available=EXCLUDED.available,version=bar_local.product_availability.version+1,
          updated_by=EXCLUDED.updated_by,updated_operation_id=EXCLUDED.updated_operation_id,updated_at=now();
        INSERT INTO bar_local.product_recipes (business_id,product_id,created_by,updated_by,created_operation_id,updated_operation_id)
        VALUES (v_ctx.business_id,v_pack_id,v_ctx.staff_id,v_ctx.staff_id,(p_envelope->>'operation_id')::uuid,(p_envelope->>'operation_id')::uuid)
        ON CONFLICT (business_id,product_id) DO UPDATE SET version=bar_local.product_recipes.version+1,
          updated_by=EXCLUDED.updated_by,updated_operation_id=EXCLUDED.updated_operation_id,updated_at=now();
        IF EXISTS (SELECT 1 FROM bar_local.product_recipe_lines WHERE recipe_id=(SELECT id FROM bar_local.product_recipes WHERE business_id=v_ctx.business_id AND product_id=v_pack_id)) THEN
          UPDATE bar_local.product_recipe_lines SET line_number=1,ingredient_product_id=v_stock_id,
            quantity=(v_payload->>'depletion_qty')::numeric*v_pack_size,
            unit_cost=COALESCE(v_stock.unit_cost,(v_payload->>'unit_cost')::numeric)
           WHERE recipe_id=(SELECT id FROM bar_local.product_recipes WHERE business_id=v_ctx.business_id AND product_id=v_pack_id);
        ELSE
          INSERT INTO bar_local.product_recipe_lines (recipe_id,line_number,ingredient_product_id,quantity,unit_cost)
          SELECT id,1,v_stock_id,(v_payload->>'depletion_qty')::numeric*v_pack_size,COALESCE(v_stock.unit_cost,(v_payload->>'unit_cost')::numeric)
            FROM bar_local.product_recipes WHERE business_id=v_ctx.business_id AND product_id=v_pack_id;
        END IF;
      ELSE
        UPDATE bar_local.bar_product_packs SET active=false,operation_id=(p_envelope->>'operation_id')::uuid,updated_at=now()
         WHERE business_id=v_ctx.business_id AND menu_product_id=v_menu_id AND pack_size=v_pack_size;
        UPDATE bar_local.products SET active=false,version=version+1,updated_at=now()
         WHERE id=v_pack_id AND business_id=v_ctx.business_id;
      END IF;
    END LOOP;

    UPDATE bar_local.authority SET catalogue_version=catalogue_version+1 WHERE singleton RETURNING catalogue_version INTO v_catalogue;
    SELECT commit_sequence INTO v_sequence FROM bar_local.authority_counter WHERE singleton;
    v_result := jsonb_build_object('menu_item_id',v_menu_id,'inventory_item_id',CASE WHEN COALESCE((v_payload->>'track_stock')::boolean,true) THEN v_stock_id ELSE NULL END,'version',v_product.version,
      'catalogue_version',v_catalogue,'outlet_id',v_outlet,'opening_stock_recorded',CASE WHEN v_expected IS NULL THEN v_opening ELSE 0 END);
    PERFORM bar_local.audit_row(v_ctx.business_id,v_outlet,v_ctx.staff_id,v_ctx.device_id,
      'catalogue.bar_product.save',(p_envelope->>'operation_id')::uuid,v_before,v_result);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid,v_seq.commit_sequence,v_result,v_result,
      jsonb_build_array(jsonb_build_object('event_type','catalogue.bar_product.save','payload',v_result)),bar_local.current_business_date());
    RETURN jsonb_build_object('ok',true,'outcome','committed_local','receipt',v_receipt,'result',v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code=PG_EXCEPTION_DETAIL,v_message=MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid,v_code,v_message);
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  WHEN unique_violation THEN
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid,'BAR_PRODUCT_CONFLICT','A product or barcode already uses one of these values in this Bar. Refresh Menu and choose a unique barcode.');
    RETURN jsonb_build_object('ok',false,'outcome','refused','error',v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.cmd_catalogue_bar_product_save(text,uuid,jsonb,text,text) OWNER TO bar_local_migrator;
ALTER FUNCTION bar_local.cmd_catalogue_bar_product_save(text,uuid,jsonb,text,text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_catalogue_bar_product_save(text,uuid,jsonb,text,text) SET search_path=pg_catalog,bar_local;
REVOKE ALL ON FUNCTION bar_local.cmd_catalogue_bar_product_save(text,uuid,jsonb,text,text) FROM PUBLIC,bar_local_runtime;
GRANT EXECUTE ON FUNCTION bar_local.cmd_catalogue_bar_product_save(text,uuid,jsonb,text,text) TO bar_local_runtime;
INSERT INTO bar_local.runtime_function_allowlist(function_name) VALUES ('cmd_catalogue_bar_product_save') ON CONFLICT DO NOTHING;

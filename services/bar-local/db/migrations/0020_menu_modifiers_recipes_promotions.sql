-- Menu modifiers, recipes and code promotions for the local Bar authority.
-- Configuration is outlet-independent; consumption is outlet-scoped through
-- the existing stock ledger. All financial effects stay inside the command
-- transaction and use the same operation receipt, audit and outbox contract.

CREATE TABLE bar_local.modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,32}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  required boolean NOT NULL DEFAULT false,
  min_selections integer NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections integer NOT NULL DEFAULT 1 CHECK (max_selections >= 1),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_operation_id uuid NOT NULL,
  updated_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code),
  CHECK (min_selections <= max_selections),
  CHECK (required = (min_selections > 0))
);
CREATE INDEX modifier_groups_business_idx ON bar_local.modifier_groups (business_id, active, code);

CREATE TABLE bar_local.modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  group_id uuid NOT NULL REFERENCES bar_local.modifier_groups(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,32}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  price_delta numeric(14,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_operation_id uuid NOT NULL,
  updated_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, code)
);
CREATE INDEX modifier_options_business_idx ON bar_local.modifier_options (business_id, group_id, active, sort_order);

CREATE TABLE bar_local.product_modifier_sets (
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_operation_id uuid NOT NULL,
  updated_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, product_id)
);

CREATE TABLE bar_local.product_modifier_links (
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  group_id uuid NOT NULL REFERENCES bar_local.modifier_groups(id),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_operation_id uuid NOT NULL,
  updated_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, group_id)
);
CREATE INDEX product_modifier_links_business_idx ON bar_local.product_modifier_links (business_id, group_id, active);

CREATE TABLE bar_local.product_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  product_id uuid NOT NULL REFERENCES bar_local.products(id),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_operation_id uuid NOT NULL,
  updated_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, product_id)
);

CREATE TABLE bar_local.product_recipe_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES bar_local.product_recipes(id) ON DELETE CASCADE,
  line_number integer NOT NULL CHECK (line_number > 0),
  ingredient_product_id uuid NOT NULL REFERENCES bar_local.products(id),
  quantity numeric(18,6) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,2) NOT NULL CHECK (unit_cost >= 0),
  UNIQUE (recipe_id, line_number),
  UNIQUE (recipe_id, ingredient_product_id)
);

CREATE TABLE bar_local.promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,32}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'amount')),
  percent numeric(7,4) NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  minimum_subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_subtotal >= 0),
  scope text NOT NULL CHECK (scope IN ('all', 'product', 'category')),
  product_id uuid REFERENCES bar_local.products(id),
  category text,
  active boolean NOT NULL DEFAULT true,
  starts_on date,
  ends_on date,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES bar_local.staff(id),
  updated_by uuid NOT NULL REFERENCES bar_local.staff(id),
  created_operation_id uuid NOT NULL,
  updated_operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code),
  CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on),
  CHECK (
    (scope = 'all' AND product_id IS NULL AND category IS NULL)
    OR (scope = 'product' AND product_id IS NOT NULL AND category IS NULL)
    OR (scope = 'category' AND product_id IS NULL AND category IS NOT NULL)
  ),
  CHECK (
    (discount_type = 'percent' AND amount = 0)
    OR (discount_type = 'amount' AND percent = 0 AND amount > 0)
  )
);
CREATE INDEX promotions_business_idx ON bar_local.promotions (business_id, active, starts_on, ends_on);

CREATE TABLE bar_local.promotion_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES bar_local.business(id),
  promotion_id uuid NOT NULL REFERENCES bar_local.promotions(id),
  sale_id uuid NOT NULL REFERENCES bar_local.sales(id),
  code_snapshot text NOT NULL,
  discount numeric(14,2) NOT NULL CHECK (discount >= 0),
  operation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sale_id)
);
CREATE INDEX promotion_redemptions_promotion_idx ON bar_local.promotion_redemptions (business_id, promotion_id, created_at);

ALTER TABLE bar_local.sale_lines
  ADD COLUMN IF NOT EXISTS modifier_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recipe_cost numeric(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recipe_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS promotion_code text,
  ADD COLUMN IF NOT EXISTS promotion_discount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_snapshot jsonb;
ALTER TABLE bar_local.sale_lines
  ADD CONSTRAINT sale_lines_recipe_cost_nonnegative CHECK (recipe_cost >= 0),
  ADD CONSTRAINT sale_lines_promotion_discount_nonnegative CHECK (promotion_discount >= 0);

ALTER TABLE bar_local.tab_lines
  ADD COLUMN IF NOT EXISTS modifier_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recipe_cost numeric(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recipe_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS promotion_code text,
  ADD COLUMN IF NOT EXISTS promotion_discount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_snapshot jsonb;
ALTER TABLE bar_local.tab_lines
  ADD CONSTRAINT tab_lines_recipe_cost_nonnegative CHECK (recipe_cost >= 0),
  ADD CONSTRAINT tab_lines_promotion_discount_nonnegative CHECK (promotion_discount >= 0);

ALTER TABLE bar_local.sales
  ADD COLUMN IF NOT EXISTS promotion_code text,
  ADD COLUMN IF NOT EXISTS promotion_discount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotion_snapshot jsonb;
ALTER TABLE bar_local.sales
  ADD CONSTRAINT sales_promotion_discount_nonnegative CHECK (promotion_discount >= 0);

-- Replace the pricing helper so it can return modifier and recipe evidence.
DROP FUNCTION IF EXISTS bar_local.price_and_deplete_items(uuid, uuid, jsonb, uuid, date, boolean);

CREATE FUNCTION bar_local.price_and_deplete_items(
  p_business_id uuid,
  p_outlet_id uuid,
  p_items jsonb,
  p_operation_id uuid,
  p_business_date date,
  p_deplete boolean
) RETURNS TABLE (
  product_id uuid, name text, sku text, quantity numeric, unit_price numeric,
  tax_rate numeric, line_subtotal numeric, line_tax numeric, line_total numeric, notes text,
  category text, modifier_snapshot jsonb, recipe_cost numeric, recipe_snapshot jsonb
) LANGUAGE plpgsql AS $$
#variable_conflict use_column
DECLARE
  v_item jsonb;
  v_product bar_local.products%ROWTYPE;
  v_qty numeric(18,6);
  v_on_hand numeric(18,6);
  v_allow_negative boolean := false;
  v_subtotal numeric(14,2);
  v_tax numeric(14,2);
  v_unit_price numeric(14,2);
  v_modifier_input jsonb;
  v_modifier jsonb;
  v_modifier_text text;
  v_modifier_id uuid;
  v_modifier_ids uuid[] := ARRAY[]::uuid[];
  v_modifier_snapshot jsonb := '[]'::jsonb;
  v_modifier_delta numeric(14,2) := 0;
  v_modifier_found integer := 0;
  v_group record;
  v_recipe bar_local.product_recipes%ROWTYPE;
  v_has_recipe boolean := false;
  v_recipe_line record;
  v_recipe_lines integer := 0;
  v_recipe_cost numeric(18,6) := 0;
  v_recipe_snapshot jsonb := '[]'::jsonb;
  v_required_qty numeric(18,6);
BEGIN
  SELECT COALESCE((value #>> '{}')::boolean, false) INTO v_allow_negative
    FROM bar_local.settings WHERE key = 'allow_negative_stock';
  v_allow_negative := COALESCE(v_allow_negative, false);

  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Sale items must be an array.');
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item->>'quantity')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Item quantity must be greater than zero.');
    END IF;
    SELECT * INTO v_product FROM bar_local.products
     WHERE id = (v_item->>'product_id')::uuid AND business_id = p_business_id AND active;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('PRODUCT_UNAVAILABLE', 'A selected product is not available in the local catalogue. Refresh the menu.');
    END IF;
    IF EXISTS (
      SELECT 1 FROM bar_local.product_availability pa
       WHERE pa.business_id = p_business_id
         AND pa.outlet_id = p_outlet_id
         AND pa.product_id = v_product.id
         AND NOT pa.available
    ) THEN
      PERFORM bar_local.raise_business('PRODUCT_UNAVAILABLE', v_product.name || ' is marked unavailable in this outlet.');
    END IF;

    v_modifier_input := COALESCE(v_item->'modifiers', '[]'::jsonb);
    IF jsonb_typeof(v_modifier_input) IS DISTINCT FROM 'array' THEN
      PERFORM bar_local.raise_business('MODIFIER_INVALID', 'Modifier selections must be an array of option identifiers.');
    END IF;
    v_modifier_ids := ARRAY[]::uuid[];
    FOR v_modifier IN SELECT value FROM jsonb_array_elements(v_modifier_input)
    LOOP
      IF jsonb_typeof(v_modifier) = 'string' THEN
        v_modifier_text := v_modifier #>> '{}';
      ELSE
        v_modifier_text := v_modifier->>'option_id';
      END IF;
      IF v_modifier_text IS NULL
         OR v_modifier_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        PERFORM bar_local.raise_business('MODIFIER_INVALID', 'A modifier selection is not a valid option identifier.');
      END IF;
      v_modifier_id := v_modifier_text::uuid;
      IF v_modifier_id = ANY(v_modifier_ids) THEN
        PERFORM bar_local.raise_business('MODIFIER_INVALID', 'A modifier option can only be selected once per item.');
      END IF;
      v_modifier_ids := v_modifier_ids || v_modifier_id;
    END LOOP;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'group_id', mg.id, 'group_code', mg.code, 'group_name', mg.name,
             'option_id', mo.id, 'option_code', mo.code, 'option_name', mo.name,
             'price_delta', mo.price_delta
           ) ORDER BY pml.sort_order, mg.code, mo.sort_order, mo.code, mo.id), '[]'::jsonb),
           COALESCE(sum(mo.price_delta), 0),
           count(*)
      INTO v_modifier_snapshot, v_modifier_delta, v_modifier_found
      FROM bar_local.modifier_options mo
      JOIN bar_local.modifier_groups mg ON mg.id = mo.group_id AND mg.business_id = p_business_id
      JOIN bar_local.product_modifier_links pml
        ON pml.group_id = mg.id AND pml.product_id = v_product.id AND pml.business_id = p_business_id
     WHERE mo.id = ANY(v_modifier_ids)
       AND mo.business_id = p_business_id AND mo.active
       AND mg.active
       AND pml.active;
    IF v_modifier_found <> COALESCE(cardinality(v_modifier_ids), 0) THEN
      PERFORM bar_local.raise_business('MODIFIER_INVALID', 'A selected modifier is not active for this product. Refresh the menu.');
    END IF;

    FOR v_group IN
      SELECT mg.id, mg.code, mg.name, mg.required, mg.min_selections, mg.max_selections,
             (SELECT count(*) FROM bar_local.modifier_options mo
               WHERE mo.group_id = mg.id AND mo.id = ANY(v_modifier_ids)) AS selected
        FROM bar_local.product_modifier_links pml
        JOIN bar_local.modifier_groups mg ON mg.id = pml.group_id AND mg.business_id = p_business_id
       WHERE pml.product_id = v_product.id AND pml.business_id = p_business_id AND pml.active
         AND mg.active
       ORDER BY pml.sort_order, mg.code, mg.id
    LOOP
      IF v_group.selected < v_group.min_selections OR (v_group.required AND v_group.selected = 0) THEN
        PERFORM bar_local.raise_business('MODIFIER_SELECTION_REQUIRED',
          'Select at least ' || v_group.min_selections || ' option(s) for ' || v_group.name || '.');
      END IF;
      IF v_group.selected > v_group.max_selections THEN
        PERFORM bar_local.raise_business('MODIFIER_SELECTION_EXCEEDED',
          'Select no more than ' || v_group.max_selections || ' option(s) for ' || v_group.name || '.');
      END IF;
    END LOOP;

    v_unit_price := round(v_product.price + v_modifier_delta, 2);
    IF v_unit_price < 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Modifier adjustments produce a negative unit price.');
    END IF;

    v_recipe_cost := 0;
    v_recipe_snapshot := '[]'::jsonb;
    v_recipe_lines := 0;
    SELECT * INTO v_recipe FROM bar_local.product_recipes
     WHERE business_id = p_business_id AND product_id = v_product.id;
    v_has_recipe := FOUND;
    IF v_has_recipe THEN
      FOR v_recipe_line IN
        SELECT rl.ingredient_product_id, rl.quantity, rl.unit_cost, rl.line_number,
               p.sku, p.name, p.track_stock, p.active, p.business_id
          FROM bar_local.product_recipe_lines rl
          JOIN bar_local.products p ON p.id = rl.ingredient_product_id
         WHERE rl.recipe_id = v_recipe.id
         ORDER BY rl.line_number
      LOOP
        v_recipe_lines := v_recipe_lines + 1;
        IF v_recipe_line.business_id <> p_business_id OR NOT v_recipe_line.active THEN
          PERFORM bar_local.raise_business('RECIPE_INGREDIENT_UNAVAILABLE',
            'A recipe ingredient is no longer available in this business.');
        END IF;
        v_required_qty := round(v_recipe_line.quantity * v_qty, 6);
        IF v_required_qty <= 0 THEN
          PERFORM bar_local.raise_business('RECIPE_INVALID', 'A recipe quantity rounds to zero for this sale.');
        END IF;
        IF v_recipe_line.track_stock THEN
          INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
          VALUES (p_business_id, p_outlet_id, v_recipe_line.ingredient_product_id, 0)
          ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
          SELECT quantity INTO v_on_hand FROM bar_local.stock_balances
           WHERE business_id = p_business_id AND outlet_id = p_outlet_id
             AND product_id = v_recipe_line.ingredient_product_id
           FOR UPDATE;
          IF v_on_hand < v_required_qty AND NOT v_allow_negative THEN
            PERFORM bar_local.raise_business('INSUFFICIENT_STOCK',
              'Not enough stock for recipe ingredient ' || v_recipe_line.name || '. Another till may have sold it.');
          END IF;
          IF p_deplete THEN
            UPDATE bar_local.stock_balances
               SET quantity = quantity - v_required_qty, version = version + 1, updated_at = now()
             WHERE business_id = p_business_id AND outlet_id = p_outlet_id
               AND product_id = v_recipe_line.ingredient_product_id;
            INSERT INTO bar_local.stock_movements
              (business_id, outlet_id, product_id, delta, reason, operation_id, business_date, unit_cost, reference)
            VALUES
              (p_business_id, p_outlet_id, v_recipe_line.ingredient_product_id, -v_required_qty,
               'sale.recipe.depletion', p_operation_id, p_business_date, v_recipe_line.unit_cost,
               v_product.id::text);
          END IF;
        END IF;
        v_recipe_cost := v_recipe_cost + round(v_required_qty * v_recipe_line.unit_cost, 6);
        v_recipe_snapshot := v_recipe_snapshot || jsonb_build_array(jsonb_build_object(
          'ingredient_product_id', v_recipe_line.ingredient_product_id,
          'sku', v_recipe_line.sku, 'name', v_recipe_line.name,
          'quantity_per_unit', v_recipe_line.quantity,
          'quantity_total', v_required_qty,
          'unit_cost', v_recipe_line.unit_cost,
          'line_cost', round(v_required_qty * v_recipe_line.unit_cost, 6)
        ));
      END LOOP;
      IF v_recipe_lines = 0 THEN
        PERFORM bar_local.raise_business('RECIPE_INVALID', 'The product recipe has no ingredient lines.');
      END IF;
    ELSIF v_product.track_stock THEN
      INSERT INTO bar_local.stock_balances (business_id, outlet_id, product_id, quantity)
      VALUES (p_business_id, p_outlet_id, v_product.id, 0)
      ON CONFLICT (business_id, outlet_id, product_id) DO NOTHING;
      SELECT quantity INTO v_on_hand FROM bar_local.stock_balances
       WHERE business_id = p_business_id AND outlet_id = p_outlet_id AND product_id = v_product.id
       FOR UPDATE;
      IF v_on_hand < v_qty AND NOT v_allow_negative THEN
        PERFORM bar_local.raise_business('INSUFFICIENT_STOCK', 'Not enough stock for ' || v_product.name || '. Another till may have sold it.');
      END IF;
      IF p_deplete THEN
        UPDATE bar_local.stock_balances
           SET quantity = quantity - v_qty, version = version + 1, updated_at = now()
         WHERE business_id = p_business_id AND outlet_id = p_outlet_id AND product_id = v_product.id;
        INSERT INTO bar_local.stock_movements
          (business_id, outlet_id, product_id, delta, reason, operation_id, business_date)
        VALUES (p_business_id, p_outlet_id, v_product.id, -v_qty, 'sale.depletion', p_operation_id, p_business_date);
      END IF;
    END IF;

    v_subtotal := round(v_unit_price * v_qty, 2);
    v_tax := round(v_subtotal * v_product.tax_rate, 2);
    product_id := v_product.id;
    name := v_product.name;
    sku := v_product.sku;
    quantity := v_qty;
    unit_price := v_unit_price;
    tax_rate := v_product.tax_rate;
    line_subtotal := v_subtotal;
    line_tax := v_tax;
    line_total := v_subtotal + v_tax;
    notes := v_item->>'notes';
    category := v_product.category;
    modifier_snapshot := v_modifier_snapshot;
    recipe_cost := v_recipe_cost;
    recipe_snapshot := v_recipe_snapshot;
    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.allocate_promotion_discount(
  p_code text,
  p_business_id uuid,
  p_business_date date,
  p_lines jsonb
) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_promo bar_local.promotions%ROWTYPE;
  v_code text := upper(btrim(COALESCE(p_code, '')));
  v_index integer;
  v_count integer := jsonb_array_length(p_lines);
  v_line jsonb;
  v_eligible boolean;
  v_eligible_subtotal numeric(14,2) := 0;
  v_eligible_count integer := 0;
  v_seen integer := 0;
  v_discount numeric(14,2);
  v_remaining numeric(14,2);
  v_alloc numeric(14,2);
  v_subtotal numeric(14,2);
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF v_code = '' THEN
    PERFORM bar_local.raise_business('PROMOTION_NOT_FOUND', 'Enter a valid promotion code.');
  END IF;
  SELECT * INTO v_promo FROM bar_local.promotions
   WHERE business_id = p_business_id AND code = v_code;
  IF NOT FOUND THEN
    PERFORM bar_local.raise_business('PROMOTION_NOT_FOUND', 'That promotion code is not valid for this business.');
  END IF;
  IF NOT v_promo.active THEN
    PERFORM bar_local.raise_business('PROMOTION_INACTIVE', 'That promotion is not active.');
  END IF;
  IF v_promo.starts_on IS NOT NULL AND p_business_date < v_promo.starts_on THEN
    PERFORM bar_local.raise_business('PROMOTION_NOT_STARTED', 'That promotion has not started yet.');
  END IF;
  IF v_promo.ends_on IS NOT NULL AND p_business_date > v_promo.ends_on THEN
    PERFORM bar_local.raise_business('PROMOTION_EXPIRED', 'That promotion has expired.');
  END IF;

  FOR v_index IN 0..v_count - 1 LOOP
    v_line := p_lines->v_index;
    v_subtotal := (v_line->>'line_subtotal')::numeric;
    v_eligible := v_promo.scope = 'all'
      OR (v_promo.scope = 'product' AND (v_line->>'product_id')::uuid = v_promo.product_id)
      OR (v_promo.scope = 'category' AND lower(COALESCE(v_line->>'category', '')) = lower(v_promo.category));
    IF v_eligible AND v_subtotal > 0 THEN
      v_eligible_subtotal := v_eligible_subtotal + v_subtotal;
      v_eligible_count := v_eligible_count + 1;
    END IF;
  END LOOP;

  IF v_eligible_count = 0 THEN
    PERFORM bar_local.raise_business('PROMOTION_NOT_APPLICABLE', 'That promotion does not apply to any item in this sale.');
  END IF;
  IF v_eligible_subtotal < v_promo.minimum_subtotal THEN
    PERFORM bar_local.raise_business('PROMOTION_MINIMUM_NOT_MET',
      'That promotion requires a minimum eligible subtotal of ' || v_promo.minimum_subtotal || '.');
  END IF;

  IF v_promo.discount_type = 'percent' THEN
    v_discount := round(v_eligible_subtotal * v_promo.percent / 100, 2);
  ELSE
    v_discount := v_promo.amount;
  END IF;
  v_discount := LEAST(v_discount, v_eligible_subtotal);
  v_remaining := v_discount;

  FOR v_index IN 0..v_count - 1 LOOP
    v_line := p_lines->v_index;
    v_subtotal := (v_line->>'line_subtotal')::numeric;
    v_eligible := v_promo.scope = 'all'
      OR (v_promo.scope = 'product' AND (v_line->>'product_id')::uuid = v_promo.product_id)
      OR (v_promo.scope = 'category' AND lower(COALESCE(v_line->>'category', '')) = lower(v_promo.category));
    IF v_eligible AND v_subtotal > 0 THEN
      v_seen := v_seen + 1;
      IF v_seen = v_eligible_count THEN
        v_alloc := v_remaining;
      ELSE
        v_alloc := round(v_discount * v_subtotal / v_eligible_subtotal, 2);
        IF v_alloc > v_remaining THEN v_alloc := v_remaining; END IF;
      END IF;
      v_remaining := v_remaining - v_alloc;
      v_result := v_result || jsonb_build_array(v_line || jsonb_build_object('promotion_discount', v_alloc));
    ELSE
      v_result := v_result || jsonb_build_array(v_line || jsonb_build_object('promotion_discount', 0));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'discount', v_discount,
    'promotion', jsonb_build_object(
      'promotion_id', v_promo.id, 'code', v_promo.code, 'name', v_promo.name,
      'discount_type', v_promo.discount_type, 'percent', v_promo.percent, 'amount', v_promo.amount,
      'minimum_subtotal', v_promo.minimum_subtotal, 'scope', v_promo.scope,
      'product_id', v_promo.product_id, 'category', v_promo.category,
      'starts_on', v_promo.starts_on, 'ends_on', v_promo.ends_on, 'version', v_promo.version
    ),
    'lines', v_result
  );
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.finalize_line_discounts(
  p_lines jsonb,
  p_manual_discount numeric
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_index integer;
  v_count integer := jsonb_array_length(p_lines);
  v_line jsonb;
  v_gross numeric(14,2);
  v_promo numeric(14,2);
  v_manual numeric(14,2);
  v_netlines jsonb := '[]'::jsonb;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_manual_discount IS NULL OR p_manual_discount < 0 THEN
    PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Manual discount cannot be negative.');
  END IF;
  FOR v_index IN 0..v_count - 1 LOOP
    v_line := p_lines->v_index;
    v_gross := (v_line->>'line_subtotal')::numeric;
    v_promo := COALESCE((v_line->>'promotion_discount')::numeric, 0);
    IF v_promo < 0 OR v_promo > v_gross THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Promotion allocation exceeds a line subtotal.');
    END IF;
    v_netlines := v_netlines || jsonb_build_array(v_line || jsonb_build_object(
      'gross_subtotal', v_gross,
      'line_subtotal', v_gross - v_promo
    ));
  END LOOP;
  v_netlines := bar_local.compute_allocated_discount(v_netlines, p_manual_discount);
  FOR v_index IN 0..jsonb_array_length(v_netlines) - 1 LOOP
    v_line := v_netlines->v_index;
    v_promo := COALESCE((v_line->>'promotion_discount')::numeric, 0);
    v_manual := (v_line->>'line_discount')::numeric;
    v_result := v_result || jsonb_build_array(v_line || jsonb_build_object(
      'line_subtotal', (v_line->>'gross_subtotal')::numeric,
      'line_discount', v_promo + v_manual,
      'line_manual_discount', v_manual
    ));
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.build_receipt(p_sale_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'sale_id', s.id, 'receipt_number', s.receipt_number, 'receipt_series', s.receipt_series,
    'business_date', s.business_date, 'status', s.status, 'subtotal', s.subtotal,
    'discount', s.discount, 'tax', s.tax, 'tip', s.tip, 'total', s.total,
    'promotion_code', s.promotion_code, 'promotion_discount', s.promotion_discount,
    'promotion_snapshot', s.promotion_snapshot,
    'created_at', s.created_at, 'original_sale_id', s.original_sale_id,
    'lines', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'sale_line_id', l.id, 'name', l.name_snapshot, 'sku', l.sku_snapshot,
        'quantity', l.quantity, 'unit_price', l.unit_price, 'line_subtotal', l.line_subtotal,
        'line_discount', l.line_discount,
        'line_tax', l.line_tax, 'line_total', l.line_total, 'notes', l.notes,
        'modifiers', l.modifier_snapshot, 'recipe_cost', l.recipe_cost,
        'recipe', l.recipe_snapshot, 'promotion_code', l.promotion_code,
        'promotion_discount', l.promotion_discount
      ) ORDER BY l.line_number) FROM bar_local.sale_lines l WHERE l.sale_id = s.id), '[]'::jsonb),
    'tenders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'method', t.method, 'amount', t.amount, 'tendered', t.tendered,
        'change', t.change_amount, 'reference', t.reference, 'provider_status', t.provider_status
      ) ORDER BY t.id) FROM bar_local.sale_tenders t WHERE t.sale_id = s.id), '[]'::jsonb)
  ) FROM bar_local.sales s WHERE s.id = p_sale_id;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_modifier_group_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_group bar_local.modifier_groups%ROWTYPE;
  v_id uuid;
  v_code text;
  v_required boolean;
  v_min integer;
  v_max integer;
  v_expected integer;
  v_catalogue bigint;
  v_result jsonb;
  v_code_error text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_id := NULLIF(v_payload->>'modifier_group_id', '')::uuid;
    v_code := upper(btrim(COALESCE(v_payload->>'code', '')));
    IF v_code !~ '^[A-Z0-9_-]{1,32}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Modifier group code must be 1-32 letters, digits, dashes or underscores.');
    END IF;
    IF length(btrim(COALESCE(v_payload->>'name', ''))) = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Modifier group name is required.');
    END IF;
    v_required := COALESCE((v_payload->>'required')::boolean, false);
    v_min := COALESCE((v_payload->>'min_selections')::integer, 0);
    v_max := COALESCE((v_payload->>'max_selections')::integer, 1);
    IF v_min < 0 OR v_max < 1 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Modifier selection limits are invalid.');
    END IF;
    IF v_required THEN
      IF v_min = 0 THEN v_min := 1; END IF;
    ELSE
      v_min := 0;
    END IF;
    IF v_min > v_max THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Minimum selections cannot exceed maximum selections.');
    END IF;

    IF v_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM bar_local.modifier_groups WHERE business_id = v_ctx.business_id AND code = v_code) THEN
        PERFORM bar_local.raise_business('DUPLICATE_MODIFIER_GROUP', 'A modifier group with that code already exists.');
      END IF;
      INSERT INTO bar_local.modifier_groups
        (business_id, code, name, required, min_selections, max_selections, active,
         created_by, updated_by, created_operation_id, updated_operation_id)
      VALUES
        (v_ctx.business_id, v_code, btrim(v_payload->>'name'), v_required, v_min, v_max,
         COALESCE((v_payload->>'active')::boolean, true), v_ctx.staff_id, v_ctx.staff_id,
         (p_envelope->>'operation_id')::uuid, (p_envelope->>'operation_id')::uuid)
      RETURNING * INTO v_group;
    ELSE
      SELECT * INTO v_group FROM bar_local.modifier_groups
       WHERE id = v_id AND business_id = v_ctx.business_id FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('MODIFIER_GROUP_NOT_FOUND', 'The modifier group was not found in this business.');
      END IF;
      v_expected := NULLIF(v_payload->>'expected_version', '')::integer;
      IF v_expected IS NULL OR v_expected <> v_group.version THEN
        PERFORM bar_local.raise_business('MODIFIER_GROUP_VERSION_CONFLICT', 'The modifier group changed on another device. Refresh before saving.');
      END IF;
      IF EXISTS (SELECT 1 FROM bar_local.modifier_groups
                  WHERE business_id = v_ctx.business_id AND code = v_code AND id <> v_id) THEN
        PERFORM bar_local.raise_business('DUPLICATE_MODIFIER_GROUP', 'A modifier group with that code already exists.');
      END IF;
      UPDATE bar_local.modifier_groups
         SET code = v_code, name = btrim(v_payload->>'name'), required = v_required,
             min_selections = v_min, max_selections = v_max,
             active = COALESCE((v_payload->>'active')::boolean, active),
             version = version + 1, updated_by = v_ctx.staff_id, updated_at = now(),
             updated_operation_id = (p_envelope->>'operation_id')::uuid
       WHERE id = v_id
      RETURNING * INTO v_group;
    END IF;

    UPDATE bar_local.authority SET catalogue_version = catalogue_version + 1
     WHERE singleton RETURNING catalogue_version INTO v_catalogue;
    v_result := jsonb_build_object(
      'modifier_group_id', v_group.id, 'code', v_group.code, 'name', v_group.name,
      'required', v_group.required, 'min_selections', v_group.min_selections,
      'max_selections', v_group.max_selections, 'active', v_group.active,
      'version', v_group.version, 'catalogue_version', v_catalogue
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'catalogue.modifier_group.upsert', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','catalogue.modifier_group.upsert','payload',v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code_error = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_modifier_option_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_option bar_local.modifier_options%ROWTYPE;
  v_id uuid;
  v_group_id uuid;
  v_code text;
  v_expected integer;
  v_catalogue bigint;
  v_result jsonb;
  v_code_error text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_id := NULLIF(v_payload->>'modifier_option_id', '')::uuid;
    v_group_id := NULLIF(v_payload->>'modifier_group_id', '')::uuid;
    v_code := upper(btrim(COALESCE(v_payload->>'code', '')));
    IF v_group_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM bar_local.modifier_groups WHERE id = v_group_id AND business_id = v_ctx.business_id
    ) THEN
      PERFORM bar_local.raise_business('MODIFIER_GROUP_NOT_FOUND', 'The modifier group was not found in this business.');
    END IF;
    IF v_code !~ '^[A-Z0-9_-]{1,32}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Modifier option code must be 1-32 letters, digits, dashes or underscores.');
    END IF;
    IF length(btrim(COALESCE(v_payload->>'name', ''))) = 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Modifier option name is required.');
    END IF;

    IF v_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM bar_local.modifier_options
                  WHERE business_id = v_ctx.business_id AND group_id = v_group_id AND code = v_code) THEN
        PERFORM bar_local.raise_business('DUPLICATE_MODIFIER_OPTION', 'A modifier option with that code already exists in the group.');
      END IF;
      INSERT INTO bar_local.modifier_options
        (business_id, group_id, code, name, price_delta, sort_order, active,
         created_by, updated_by, created_operation_id, updated_operation_id)
      VALUES
        (v_ctx.business_id, v_group_id, v_code, btrim(v_payload->>'name'),
         COALESCE((v_payload->>'price_delta')::numeric, 0), COALESCE((v_payload->>'sort_order')::integer, 0),
         COALESCE((v_payload->>'active')::boolean, true), v_ctx.staff_id, v_ctx.staff_id,
         (p_envelope->>'operation_id')::uuid, (p_envelope->>'operation_id')::uuid)
      RETURNING * INTO v_option;
    ELSE
      SELECT * INTO v_option FROM bar_local.modifier_options
       WHERE id = v_id AND business_id = v_ctx.business_id FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('MODIFIER_OPTION_NOT_FOUND', 'The modifier option was not found in this business.');
      END IF;
      v_expected := NULLIF(v_payload->>'expected_version', '')::integer;
      IF v_expected IS NULL OR v_expected <> v_option.version THEN
        PERFORM bar_local.raise_business('MODIFIER_OPTION_VERSION_CONFLICT', 'The modifier option changed on another device. Refresh before saving.');
      END IF;
      IF EXISTS (SELECT 1 FROM bar_local.modifier_options
                  WHERE business_id = v_ctx.business_id AND group_id = v_group_id AND code = v_code AND id <> v_id) THEN
        PERFORM bar_local.raise_business('DUPLICATE_MODIFIER_OPTION', 'A modifier option with that code already exists in the group.');
      END IF;
      UPDATE bar_local.modifier_options
         SET group_id = v_group_id, code = v_code, name = btrim(v_payload->>'name'),
             price_delta = COALESCE((v_payload->>'price_delta')::numeric, 0),
             sort_order = COALESCE((v_payload->>'sort_order')::integer, sort_order),
             active = COALESCE((v_payload->>'active')::boolean, active),
             version = version + 1, updated_by = v_ctx.staff_id, updated_at = now(),
             updated_operation_id = (p_envelope->>'operation_id')::uuid
       WHERE id = v_id
      RETURNING * INTO v_option;
    END IF;

    UPDATE bar_local.authority SET catalogue_version = catalogue_version + 1
     WHERE singleton RETURNING catalogue_version INTO v_catalogue;
    v_result := jsonb_build_object(
      'modifier_option_id', v_option.id, 'modifier_group_id', v_option.group_id,
      'code', v_option.code, 'name', v_option.name, 'price_delta', v_option.price_delta,
      'sort_order', v_option.sort_order, 'active', v_option.active,
      'version', v_option.version, 'catalogue_version', v_catalogue
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'catalogue.modifier_option.upsert', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','catalogue.modifier_option.upsert','payload',v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code_error = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_product_modifier_set(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_product_id uuid := NULLIF(v_payload->>'product_id', '')::uuid;
  v_set bar_local.product_modifier_sets%ROWTYPE;
  v_has_set boolean := false;
  v_expected integer;
  v_version integer;
  v_groups jsonb := COALESCE(v_payload->'groups', '[]'::jsonb);
  v_group jsonb;
  v_gid uuid;
  v_sort integer;
  v_ord integer := 0;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_catalogue bigint;
  v_result jsonb;
  v_code_error text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF v_product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM bar_local.products WHERE id = v_product_id AND business_id = v_ctx.business_id
    ) THEN
      PERFORM bar_local.raise_business('PRODUCT_NOT_FOUND', 'The product was not found in this business.');
    END IF;
    IF jsonb_typeof(v_groups) IS DISTINCT FROM 'array' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Product modifier groups must be an array.');
    END IF;
    FOR v_group IN SELECT value FROM jsonb_array_elements(v_groups)
    LOOP
      IF jsonb_typeof(v_group) = 'string' THEN
        v_gid := (v_group #>> '{}')::uuid;
        v_sort := v_ord;
      ELSE
        v_gid := COALESCE(NULLIF(v_group->>'modifier_group_id', '')::uuid, NULLIF(v_group->>'group_id', '')::uuid);
        v_sort := COALESCE((v_group->>'sort_order')::integer, v_ord);
      END IF;
      IF v_gid IS NULL OR NOT EXISTS (
        SELECT 1 FROM bar_local.modifier_groups WHERE id = v_gid AND business_id = v_ctx.business_id
      ) THEN
        PERFORM bar_local.raise_business('MODIFIER_GROUP_NOT_FOUND', 'A modifier group was not found in this business.');
      END IF;
      IF v_gid = ANY(v_seen) THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A modifier group can only be linked once per product.');
      END IF;
      v_seen := v_seen || v_gid;
      v_ord := v_ord + 1;
    END LOOP;

    SELECT * INTO v_set FROM bar_local.product_modifier_sets
     WHERE business_id = v_ctx.business_id AND product_id = v_product_id FOR UPDATE;
    v_has_set := FOUND;
    IF v_has_set THEN
      v_expected := NULLIF(v_payload->>'expected_version', '')::integer;
      IF v_expected IS NULL OR v_expected <> v_set.version THEN
        PERFORM bar_local.raise_business('PRODUCT_MODIFIER_VERSION_CONFLICT', 'The product modifier set changed on another device. Refresh before saving.');
      END IF;
      UPDATE bar_local.product_modifier_sets
         SET version = version + 1, updated_by = v_ctx.staff_id, updated_at = now(),
             updated_operation_id = (p_envelope->>'operation_id')::uuid
       WHERE business_id = v_ctx.business_id AND product_id = v_product_id
      RETURNING * INTO v_set;
    ELSE
      INSERT INTO bar_local.product_modifier_sets
        (business_id, product_id, created_by, updated_by, created_operation_id, updated_operation_id)
      VALUES
        (v_ctx.business_id, v_product_id, v_ctx.staff_id, v_ctx.staff_id,
         (p_envelope->>'operation_id')::uuid, (p_envelope->>'operation_id')::uuid)
      RETURNING * INTO v_set;
    END IF;
    v_version := v_set.version;

    DELETE FROM bar_local.product_modifier_links
     WHERE business_id = v_ctx.business_id AND product_id = v_product_id;
    v_ord := 0;
    FOR v_group IN SELECT value FROM jsonb_array_elements(v_groups)
    LOOP
      IF jsonb_typeof(v_group) = 'string' THEN
        v_gid := (v_group #>> '{}')::uuid;
        v_sort := v_ord;
      ELSE
        v_gid := COALESCE(NULLIF(v_group->>'modifier_group_id', '')::uuid, NULLIF(v_group->>'group_id', '')::uuid);
        v_sort := COALESCE((v_group->>'sort_order')::integer, v_ord);
      END IF;
      INSERT INTO bar_local.product_modifier_links
        (business_id, product_id, group_id, sort_order, active, version,
         created_by, updated_by, created_operation_id, updated_operation_id)
      VALUES
        (v_ctx.business_id, v_product_id, v_gid, v_sort, true, v_version,
         v_ctx.staff_id, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid, (p_envelope->>'operation_id')::uuid);
      v_ord := v_ord + 1;
    END LOOP;

    UPDATE bar_local.authority SET catalogue_version = catalogue_version + 1
     WHERE singleton RETURNING catalogue_version INTO v_catalogue;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'modifier_group_id', mg.id, 'code', mg.code, 'name', mg.name,
             'required', mg.required, 'min_selections', mg.min_selections,
             'max_selections', mg.max_selections, 'sort_order', pml.sort_order
           ) ORDER BY pml.sort_order, mg.code, mg.id), '[]'::jsonb)
      INTO v_groups
      FROM bar_local.product_modifier_links pml
      JOIN bar_local.modifier_groups mg ON mg.id = pml.group_id
     WHERE pml.business_id = v_ctx.business_id AND pml.product_id = v_product_id;
    v_result := jsonb_build_object(
      'product_id', v_product_id, 'version', v_version, 'groups', v_groups,
      'catalogue_version', v_catalogue
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'catalogue.product_modifier.set', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','catalogue.product_modifier.set','payload',v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code_error = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_catalogue_recipe_set(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_product_id uuid := NULLIF(v_payload->>'product_id', '')::uuid;
  v_recipe bar_local.product_recipes%ROWTYPE;
  v_has_recipe boolean := false;
  v_removed boolean := false;
  v_expected integer;
  v_lines jsonb := COALESCE(v_payload->'lines', '[]'::jsonb);
  v_line jsonb;
  v_ingredient uuid;
  v_quantity numeric(18,6);
  v_unit_cost numeric(14,2);
  v_seen uuid[] := ARRAY[]::uuid[];
  v_line_no integer := 0;
  v_catalogue bigint;
  v_result jsonb;
  v_result_lines jsonb;
  v_cost numeric(18,6);
  v_code_error text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    IF v_product_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM bar_local.products WHERE id = v_product_id AND business_id = v_ctx.business_id
    ) THEN
      PERFORM bar_local.raise_business('PRODUCT_NOT_FOUND', 'The product was not found in this business.');
    END IF;
    IF jsonb_typeof(v_lines) IS DISTINCT FROM 'array' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Recipe lines must be an array.');
    END IF;

    SELECT * INTO v_recipe FROM bar_local.product_recipes
     WHERE business_id = v_ctx.business_id AND product_id = v_product_id FOR UPDATE;
    v_has_recipe := FOUND;
    v_expected := NULLIF(v_payload->>'expected_version', '')::integer;
    IF v_has_recipe THEN
      IF v_expected IS NULL OR v_expected <> v_recipe.version THEN
        PERFORM bar_local.raise_business('RECIPE_VERSION_CONFLICT', 'The recipe changed on another device. Refresh before saving.');
      END IF;
    ELSIF v_expected IS NOT NULL AND v_expected <> 0 THEN
      PERFORM bar_local.raise_business('RECIPE_VERSION_CONFLICT', 'No recipe exists with that version. Refresh before saving.');
    END IF;

    IF jsonb_array_length(v_lines) = 0 THEN
      IF NOT v_has_recipe THEN
        PERFORM bar_local.raise_business('RECIPE_NOT_FOUND', 'No recipe exists for this product.');
      END IF;
      DELETE FROM bar_local.product_recipes WHERE id = v_recipe.id;
      v_removed := true;
      v_recipe.id := NULL;
      v_recipe.version := 0;
    ELSE
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
      LOOP
        v_ingredient := COALESCE(NULLIF(v_line->>'ingredient_product_id', '')::uuid, NULLIF(v_line->>'product_id', '')::uuid);
        v_quantity := (v_line->>'quantity')::numeric;
        v_unit_cost := COALESCE((v_line->>'unit_cost')::numeric, 0);
        IF v_ingredient IS NULL OR v_ingredient = v_product_id THEN
          PERFORM bar_local.raise_business('RECIPE_INVALID', 'A recipe ingredient must be a different product.');
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM bar_local.products
           WHERE id = v_ingredient AND business_id = v_ctx.business_id AND active
        ) THEN
          PERFORM bar_local.raise_business('RECIPE_INGREDIENT_UNAVAILABLE', 'A recipe ingredient is not active in this business.');
        END IF;
        IF v_quantity IS NULL OR v_quantity <= 0 THEN
          PERFORM bar_local.raise_business('RECIPE_INVALID', 'Recipe ingredient quantities must be greater than zero.');
        END IF;
        IF v_unit_cost < 0 THEN
          PERFORM bar_local.raise_business('RECIPE_INVALID', 'Recipe ingredient unit cost cannot be negative.');
        END IF;
        IF v_ingredient = ANY(v_seen) THEN
          PERFORM bar_local.raise_business('RECIPE_INVALID', 'A recipe can only contain one line per ingredient.');
        END IF;
        v_seen := v_seen || v_ingredient;
      END LOOP;

      IF v_has_recipe THEN
        UPDATE bar_local.product_recipes
           SET version = version + 1, updated_by = v_ctx.staff_id, updated_at = now(),
               updated_operation_id = (p_envelope->>'operation_id')::uuid
         WHERE id = v_recipe.id
        RETURNING * INTO v_recipe;
        DELETE FROM bar_local.product_recipe_lines WHERE recipe_id = v_recipe.id;
      ELSE
        INSERT INTO bar_local.product_recipes
          (business_id, product_id, created_by, updated_by, created_operation_id, updated_operation_id)
        VALUES
          (v_ctx.business_id, v_product_id, v_ctx.staff_id, v_ctx.staff_id,
           (p_envelope->>'operation_id')::uuid, (p_envelope->>'operation_id')::uuid)
        RETURNING * INTO v_recipe;
      END IF;

      v_line_no := 0;
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
      LOOP
        v_line_no := v_line_no + 1;
        v_ingredient := COALESCE(NULLIF(v_line->>'ingredient_product_id', '')::uuid, NULLIF(v_line->>'product_id', '')::uuid);
        INSERT INTO bar_local.product_recipe_lines
          (recipe_id, line_number, ingredient_product_id, quantity, unit_cost)
        VALUES
          (v_recipe.id, v_line_no, v_ingredient, (v_line->>'quantity')::numeric,
           COALESCE((v_line->>'unit_cost')::numeric, 0));
      END LOOP;
    END IF;

    UPDATE bar_local.authority SET catalogue_version = catalogue_version + 1
     WHERE singleton RETURNING catalogue_version INTO v_catalogue;
    IF v_removed THEN
      v_result_lines := '[]'::jsonb;
      v_cost := 0;
    ELSE
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'ingredient_product_id', rl.ingredient_product_id, 'name', p.name, 'sku', p.sku,
               'quantity', rl.quantity, 'unit_cost', rl.unit_cost,
               'line_cost', round(rl.quantity * rl.unit_cost, 6)
             ) ORDER BY rl.line_number), '[]'::jsonb),
             COALESCE(sum(rl.quantity * rl.unit_cost), 0)
        INTO v_result_lines, v_cost
        FROM bar_local.product_recipe_lines rl
        JOIN bar_local.products p ON p.id = rl.ingredient_product_id
       WHERE rl.recipe_id = v_recipe.id;
    END IF;
    v_result := jsonb_build_object(
      'product_id', v_product_id, 'recipe_id', v_recipe.id, 'version', v_recipe.version,
      'removed', v_removed, 'lines', v_result_lines, 'cost', v_cost,
      'catalogue_version', v_catalogue
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'catalogue.recipe.set', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','catalogue.recipe.set','payload',v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code_error = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_promotion_upsert(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_promo bar_local.promotions%ROWTYPE;
  v_id uuid;
  v_code text;
  v_name text;
  v_type text;
  v_percent numeric(7,4);
  v_amount numeric(14,2);
  v_minimum numeric(14,2);
  v_scope text;
  v_product_id uuid;
  v_category text;
  v_starts_on date;
  v_ends_on date;
  v_expected integer;
  v_catalogue bigint;
  v_result jsonb;
  v_code_error text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.menu_manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    v_id := NULLIF(v_payload->>'promotion_id', '')::uuid;
    v_code := upper(btrim(COALESCE(v_payload->>'code', '')));
    v_name := btrim(COALESCE(v_payload->>'name', ''));
    v_type := lower(btrim(COALESCE(v_payload->>'discount_type', '')));
    v_percent := COALESCE((v_payload->>'percent')::numeric, 0);
    v_amount := COALESCE((v_payload->>'amount')::numeric, 0);
    v_minimum := COALESCE((v_payload->>'minimum_subtotal')::numeric, 0);
    v_scope := lower(btrim(COALESCE(v_payload->>'scope', 'all')));
    v_product_id := NULLIF(v_payload->>'product_id', '')::uuid;
    v_category := NULLIF(btrim(COALESCE(v_payload->>'category', '')), '');
    v_starts_on := NULLIF(v_payload->>'starts_on', '')::date;
    v_ends_on := NULLIF(v_payload->>'ends_on', '')::date;

    IF v_code !~ '^[A-Z0-9_-]{1,32}$' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Promotion code must be 1-32 letters, digits, dashes or underscores.');
    END IF;
    IF v_name = '' THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Promotion name is required.');
    END IF;
    IF v_type NOT IN ('percent', 'amount') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Promotion discount type must be percent or amount.');
    END IF;
    IF v_type = 'percent' AND (v_percent <= 0 OR v_percent > 100 OR v_amount <> 0) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A percentage promotion requires a percent greater than zero and no fixed amount.');
    END IF;
    IF v_type = 'amount' AND (v_amount <= 0 OR v_percent <> 0) THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A fixed promotion requires an amount greater than zero and no percent.');
    END IF;
    IF v_minimum < 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Promotion minimum subtotal cannot be negative.');
    END IF;
    IF v_scope NOT IN ('all', 'product', 'category') THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Promotion scope must be all, product or category.');
    END IF;
    IF v_scope = 'product' THEN
      IF v_product_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM bar_local.products WHERE id = v_product_id AND business_id = v_ctx.business_id
      ) THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A product-scoped promotion requires a product from this business.');
      END IF;
      v_category := NULL;
    ELSIF v_scope = 'category' THEN
      IF v_category IS NULL THEN
        PERFORM bar_local.raise_business('VALIDATION_FAILED', 'A category-scoped promotion requires a category.');
      END IF;
      v_product_id := NULL;
    ELSE
      v_product_id := NULL;
      v_category := NULL;
    END IF;
    IF v_starts_on IS NOT NULL AND v_ends_on IS NOT NULL AND v_ends_on < v_starts_on THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Promotion end date cannot be before its start date.');
    END IF;

    IF v_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM bar_local.promotions WHERE business_id = v_ctx.business_id AND code = v_code) THEN
        PERFORM bar_local.raise_business('DUPLICATE_PROMOTION', 'A promotion with that code already exists.');
      END IF;
      INSERT INTO bar_local.promotions
        (business_id, code, name, discount_type, percent, amount, minimum_subtotal, scope,
         product_id, category, active, starts_on, ends_on,
         created_by, updated_by, created_operation_id, updated_operation_id)
      VALUES
        (v_ctx.business_id, v_code, v_name, v_type, v_percent, v_amount, v_minimum, v_scope,
         v_product_id, v_category, COALESCE((v_payload->>'active')::boolean, true), v_starts_on, v_ends_on,
         v_ctx.staff_id, v_ctx.staff_id, (p_envelope->>'operation_id')::uuid, (p_envelope->>'operation_id')::uuid)
      RETURNING * INTO v_promo;
    ELSE
      SELECT * INTO v_promo FROM bar_local.promotions
       WHERE id = v_id AND business_id = v_ctx.business_id FOR UPDATE;
      IF NOT FOUND THEN
        PERFORM bar_local.raise_business('PROMOTION_NOT_FOUND', 'The promotion was not found in this business.');
      END IF;
      v_expected := NULLIF(v_payload->>'expected_version', '')::integer;
      IF v_expected IS NULL OR v_expected <> v_promo.version THEN
        PERFORM bar_local.raise_business('PROMOTION_VERSION_CONFLICT', 'The promotion changed on another device. Refresh before saving.');
      END IF;
      IF EXISTS (SELECT 1 FROM bar_local.promotions
                  WHERE business_id = v_ctx.business_id AND code = v_code AND id <> v_id) THEN
        PERFORM bar_local.raise_business('DUPLICATE_PROMOTION', 'A promotion with that code already exists.');
      END IF;
      UPDATE bar_local.promotions
         SET code = v_code, name = v_name, discount_type = v_type, percent = v_percent,
             amount = v_amount, minimum_subtotal = v_minimum, scope = v_scope,
             product_id = v_product_id, category = v_category,
             active = COALESCE((v_payload->>'active')::boolean, active),
             starts_on = v_starts_on, ends_on = v_ends_on,
             version = version + 1, updated_by = v_ctx.staff_id, updated_at = now(),
             updated_operation_id = (p_envelope->>'operation_id')::uuid
       WHERE id = v_id
      RETURNING * INTO v_promo;
    END IF;

    UPDATE bar_local.authority SET catalogue_version = catalogue_version + 1
     WHERE singleton RETURNING catalogue_version INTO v_catalogue;
    v_result := jsonb_build_object(
      'promotion_id', v_promo.id, 'code', v_promo.code, 'name', v_promo.name,
      'discount_type', v_promo.discount_type, 'percent', v_promo.percent, 'amount', v_promo.amount,
      'minimum_subtotal', v_promo.minimum_subtotal, 'scope', v_promo.scope,
      'product_id', v_promo.product_id, 'category', v_promo.category,
      'active', v_promo.active, 'starts_on', v_promo.starts_on, 'ends_on', v_promo.ends_on,
      'version', v_promo.version, 'catalogue_version', v_catalogue
    );
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'promotion.upsert', (p_envelope->>'operation_id')::uuid, NULL, v_result);
    v_result := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_result, jsonb_build_array(jsonb_build_object('event_type','promotion.upsert','payload',v_result)),
      bar_local.current_business_date());
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_result, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code_error = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code_error, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_sale_commit(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_shift bar_local.shifts%ROWTYPE;
  v_tab bar_local.tabs%ROWTYPE;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_sale_id uuid;
  v_receipt jsonb;
  v_result jsonb;
  v_series text;
  v_subtotal numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_discount numeric(14,2) := 0;
  v_tip numeric(14,2) := 0;
  v_total numeric(14,2) := 0;
  v_change numeric(14,2) := 0;
  v_customer uuid;
  v_line_no integer := 0;
  v_tab_id uuid := NULLIF(v_payload->>'tab_id', '')::uuid;
  v_events jsonb;
  v_promotion_code text := NULLIF(btrim(COALESCE(v_payload->>'promotion_code', '')), '');
  v_promotion_result jsonb;
  v_promotion jsonb;
  v_promotion_discount numeric(14,2) := 0;
  v_line_promo numeric(14,2);
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence(true);
  BEGIN
    v_shift := bar_local.require_open_shift(v_ctx.business_id, v_ctx.outlet_id, (v_payload->>'shift_id')::uuid, v_ctx.staff_id, true);
    v_customer := NULLIF(v_payload->>'customer_id', '')::uuid;
    v_discount := COALESCE((v_payload->>'discount_amount')::numeric, 0);
    v_tip := COALESCE((v_payload->>'tip_amount')::numeric, 0);
    IF v_discount < 0 OR v_tip < 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Discount and tip cannot be negative.');
    END IF;

    IF v_tab_id IS NOT NULL THEN
      SELECT * INTO v_tab FROM bar_local.tabs WHERE id = v_tab_id FOR UPDATE;
      IF NOT FOUND OR v_tab.business_id <> v_ctx.business_id OR v_tab.outlet_id <> v_ctx.outlet_id THEN
        PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The tab could not be found in this outlet.');
      END IF;
      IF v_tab.status <> 'open' THEN
        PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab is already settled or voided.');
      END IF;
      IF v_tab.version <> (v_payload->>'expected_tab_version')::integer THEN
        PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'The tab changed on another till. Refresh before settling.');
      END IF;
      IF v_tab.owner_staff_id <> v_ctx.staff_id AND v_ctx.role NOT IN ('owner', 'manager') THEN
        PERFORM bar_local.raise_business('TAB_NOT_OWNED', 'This tab belongs to another operator.');
      END IF;
      IF jsonb_array_length(COALESCE(v_payload->'items', '[]'::jsonb)) > 0 THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_lines
          FROM bar_local.price_and_deplete_items(v_ctx.business_id, v_ctx.outlet_id, v_payload->'items',
               (p_envelope->>'operation_id')::uuid, v_shift.business_date, true) p;
        SELECT COALESCE(MAX(line_number), 0) INTO v_line_no FROM bar_local.tab_lines WHERE tab_id = v_tab_id;
        FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
        LOOP
          v_line_no := v_line_no + 1;
          INSERT INTO bar_local.tab_lines
            (tab_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
             line_subtotal, line_tax, line_total, notes, modifier_snapshot, recipe_cost, recipe_snapshot, operation_id)
          VALUES (v_tab_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
                  (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
                  (v_line->>'line_subtotal')::numeric, (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
                  v_line->>'notes', COALESCE(v_line->'modifier_snapshot', '[]'::jsonb),
                  COALESCE((v_line->>'recipe_cost')::numeric, 0), COALESCE(v_line->'recipe_snapshot', '[]'::jsonb),
                  (p_envelope->>'operation_id')::uuid);
        END LOOP;
      END IF;
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tab_line_id', tl.id, 'line_number', tl.line_number, 'product_id', tl.product_id,
        'name', tl.name_snapshot, 'sku', tl.sku_snapshot, 'quantity', tl.quantity,
        'unit_price', tl.unit_price, 'tax_rate', tl.tax_rate, 'line_subtotal', tl.line_subtotal,
        'line_tax', tl.line_tax, 'line_total', tl.line_total, 'notes', tl.notes,
        'category', p.category, 'modifier_snapshot', tl.modifier_snapshot,
        'recipe_cost', tl.recipe_cost, 'recipe_snapshot', tl.recipe_snapshot,
        'promotion_code', tl.promotion_code, 'promotion_discount', 0
        ) ORDER BY tl.line_number), '[]'::jsonb) INTO v_lines
        FROM bar_local.tab_lines tl
        JOIN bar_local.products p ON p.id = tl.product_id
       WHERE tl.tab_id = v_tab_id AND tl.status = 'open';
      IF jsonb_array_length(v_lines) = 0 THEN
        PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab has no lines to settle.');
      END IF;
    ELSE
      SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_lines
        FROM bar_local.price_and_deplete_items(v_ctx.business_id, v_ctx.outlet_id, v_payload->'items',
             (p_envelope->>'operation_id')::uuid, v_shift.business_date, true) p;
    END IF;

    IF v_promotion_code IS NOT NULL THEN
      v_promotion_result := bar_local.allocate_promotion_discount(
        v_promotion_code, v_ctx.business_id, v_shift.business_date, v_lines);
      v_lines := v_promotion_result->'lines';
      v_promotion := v_promotion_result->'promotion';
      v_promotion_discount := (v_promotion_result->>'discount')::numeric;
    END IF;
    v_lines := bar_local.finalize_line_discounts(v_lines, v_discount);
    v_discount := v_discount + v_promotion_discount;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_subtotal := v_subtotal + ((v_line->>'line_subtotal')::numeric - (v_line->>'line_discount')::numeric);
      v_tax := v_tax + (v_line->>'line_tax')::numeric;
    END LOOP;
    v_total := v_subtotal + v_tax + v_tip;

    SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
    v_series := COALESCE(v_series, 'BAR');

    INSERT INTO bar_local.sales
      (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number,
       receipt_series, business_date, subtotal, discount, tax, tip, total, customer_id,
       walk_in_name, note, promotion_code, promotion_discount, promotion_snapshot, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, v_ctx.device_id, v_ctx.staff_id, v_tab_id,
       v_seq.receipt_sequence, v_series, v_shift.business_date, v_subtotal, v_discount, v_tax, v_tip, v_total,
       v_customer, v_payload->>'walk_in_name', v_payload->>'note',
       v_promotion_code, v_promotion_discount, v_promotion, (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_sale_id;

    v_line_no := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_no := v_line_no + 1;
      v_line_promo := COALESCE((v_line->>'promotion_discount')::numeric, 0);
      INSERT INTO bar_local.sale_lines
        (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
         line_subtotal, line_discount, line_tax, line_total, notes, modifier_snapshot, recipe_cost,
         recipe_snapshot, promotion_code, promotion_discount, promotion_snapshot, operation_id)
      VALUES
        (v_sale_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
         (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
         (v_line->>'line_subtotal')::numeric, (v_line->>'line_discount')::numeric,
         (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
         v_line->>'notes', COALESCE(v_line->'modifier_snapshot', '[]'::jsonb),
         COALESCE((v_line->>'recipe_cost')::numeric, 0), COALESCE(v_line->'recipe_snapshot', '[]'::jsonb),
         CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion_code END,
         v_line_promo,
         CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion END,
         (p_envelope->>'operation_id')::uuid);
    END LOOP;

    IF v_promotion_code IS NOT NULL THEN
      INSERT INTO bar_local.promotion_redemptions
        (business_id, promotion_id, sale_id, code_snapshot, discount, operation_id)
      VALUES
        (v_ctx.business_id, (v_promotion->>'promotion_id')::uuid, v_sale_id,
         v_promotion_code, v_promotion_discount, (p_envelope->>'operation_id')::uuid);
    END IF;

    v_change := bar_local.apply_tenders(v_ctx, v_sale_id, v_shift.id, v_shift.business_date,
      v_payload->'tenders', v_total, v_customer, (p_envelope->>'operation_id')::uuid);

    IF v_tab_id IS NOT NULL THEN
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
      LOOP
        v_line_promo := COALESCE((v_line->>'promotion_discount')::numeric, 0);
        UPDATE bar_local.tab_lines
           SET promotion_code = CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion_code END,
               promotion_discount = v_line_promo,
               promotion_snapshot = CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion END
         WHERE id = (v_line->>'tab_line_id')::uuid;
      END LOOP;
      UPDATE bar_local.tab_lines SET status = 'settled' WHERE tab_id = v_tab_id AND status = 'open';
      UPDATE bar_local.tabs
         SET status = 'settled', closed_at = now(), version = version + 1, settled_sale_id = v_sale_id
       WHERE id = v_tab_id;
    END IF;

    v_receipt := bar_local.build_receipt(v_sale_id) || jsonb_build_object('change', v_change, 'replayed', false);
    INSERT INTO bar_local.print_jobs (business_id, outlet_id, operation_id, sale_id, payload)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, (p_envelope->>'operation_id')::uuid, v_sale_id, v_receipt);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'sale.committed', (p_envelope->>'operation_id')::uuid, NULL, v_receipt);
    v_events := jsonb_build_array(jsonb_build_object(
      'event_type', 'sale.committed',
      'payload', jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt, 'shift_id', v_shift.id, 'tab_id', v_tab_id)
    ));
    v_result := jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt, 'change', v_change,
      'promotion_code', v_promotion_code, 'promotion_discount', v_promotion_discount);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_result, v_receipt, v_events, v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt, 'result', v_result);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_tab_add(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_tab bar_local.tabs%ROWTYPE;
  v_shift bar_local.shifts%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_line_no integer;
  v_added jsonb := '[]'::jsonb;
  v_receipt jsonb;
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence();
  BEGIN
    SELECT * INTO v_tab FROM bar_local.tabs WHERE id = (v_payload->>'tab_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_tab.business_id <> v_ctx.business_id OR v_tab.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The tab could not be found in this outlet.');
    END IF;
    IF v_tab.status <> 'open' THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab is already settled or voided.');
    END IF;
    IF v_tab.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'The tab changed on another till. Refresh before adding lines.');
    END IF;
    IF v_tab.owner_staff_id <> v_ctx.staff_id AND v_ctx.role NOT IN ('owner', 'manager') THEN
      PERFORM bar_local.raise_business('TAB_NOT_OWNED', 'This tab belongs to another operator.');
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND staff_id = v_ctx.staff_id AND status = 'open'
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift before adding tab lines.');
    END IF;
    SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_lines
      FROM bar_local.price_and_deplete_items(v_ctx.business_id, v_ctx.outlet_id, v_payload->'items',
           (p_envelope->>'operation_id')::uuid, v_shift.business_date, true) p;
    SELECT COALESCE(MAX(line_number), 0) INTO v_line_no FROM bar_local.tab_lines WHERE tab_id = v_tab.id;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_no := v_line_no + 1;
      INSERT INTO bar_local.tab_lines
        (tab_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
         line_subtotal, line_tax, line_total, notes, modifier_snapshot, recipe_cost, recipe_snapshot, operation_id)
      VALUES (v_tab.id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
              (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
              (v_line->>'line_subtotal')::numeric, (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
              v_line->>'notes', COALESCE(v_line->'modifier_snapshot', '[]'::jsonb),
              COALESCE((v_line->>'recipe_cost')::numeric, 0), COALESCE(v_line->'recipe_snapshot', '[]'::jsonb),
              (p_envelope->>'operation_id')::uuid);
    END LOOP;
    UPDATE bar_local.tabs SET version = version + 1 WHERE id = v_tab.id;
    v_added := jsonb_build_object('tab_id', v_tab.id, 'version', v_tab.version + 1, 'lines', v_lines);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.lines_added', (p_envelope->>'operation_id')::uuid, NULL, v_added);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      v_added, v_added, jsonb_build_array(jsonb_build_object('event_type','tab.lines_added','payload',v_added)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt, 'result', v_added);
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION bar_local.cmd_tab_settle(
  p_token_hash text, p_device_id uuid, p_envelope jsonb, p_payload_hash text, p_approval_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_ctx bar_local.session_context;
  v_claim record;
  v_seq record;
  v_payload jsonb := p_envelope->'payload';
  v_tab bar_local.tabs%ROWTYPE;
  v_shift bar_local.shifts%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_sale_id uuid;
  v_receipt jsonb;
  v_series text;
  v_subtotal numeric(14,2) := 0;
  v_tax numeric(14,2) := 0;
  v_discount numeric(14,2) := COALESCE((v_payload->>'discount_amount')::numeric, 0);
  v_tip numeric(14,2) := COALESCE((v_payload->>'tip_amount')::numeric, 0);
  v_total numeric(14,2) := 0;
  v_change numeric(14,2) := 0;
  v_customer uuid := NULLIF(v_payload->>'customer_id', '')::uuid;
  v_line_no integer := 0;
  v_promotion_code text := NULLIF(btrim(COALESCE(v_payload->>'promotion_code', '')), '');
  v_promotion_result jsonb;
  v_promotion jsonb;
  v_promotion_discount numeric(14,2) := 0;
  v_line_promo numeric(14,2);
  v_code text;
  v_message text;
  v_error jsonb;
BEGIN
  v_ctx := bar_local.current_session(p_token_hash, p_device_id, (p_envelope->>'authority_id')::uuid,
    (p_envelope->>'authority_epoch')::bigint, (p_envelope->>'business_id')::uuid, (p_envelope->>'outlet_id')::uuid);
  PERFORM bar_local.assert_capability(v_ctx.capabilities, 'pos.manage');
  SELECT * INTO v_claim FROM bar_local.claim_operation(v_ctx, p_envelope, p_payload_hash);
  IF v_claim.replayed THEN
    IF v_claim.operation_status = 'committed' THEN
      RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'replayed', true, 'receipt', v_claim.receipt, 'result', v_claim.result);
    END IF;
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'replayed', true, 'error', v_claim.error);
  END IF;
  SELECT * INTO v_seq FROM bar_local.allocate_sequence(true);
  BEGIN
    SELECT * INTO v_tab FROM bar_local.tabs WHERE id = (v_payload->>'tab_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_tab.business_id <> v_ctx.business_id OR v_tab.outlet_id <> v_ctx.outlet_id THEN
      PERFORM bar_local.raise_business('TAB_NOT_FOUND', 'The tab could not be found in this outlet.');
    END IF;
    IF v_tab.status <> 'open' THEN
      PERFORM bar_local.raise_business('DUPLICATE_SETTLEMENT', 'This tab has already been settled.');
    END IF;
    IF v_tab.version <> (v_payload->>'expected_version')::integer THEN
      PERFORM bar_local.raise_business('TAB_VERSION_CONFLICT', 'The tab changed on another till. Refresh before settling.');
    END IF;
    IF v_tab.owner_staff_id <> v_ctx.staff_id AND v_ctx.role NOT IN ('owner', 'manager') THEN
      PERFORM bar_local.raise_business('TAB_NOT_OWNED', 'This tab belongs to another operator.');
    END IF;
    SELECT * INTO v_shift FROM bar_local.shifts
     WHERE business_id = v_ctx.business_id AND outlet_id = v_ctx.outlet_id AND staff_id = v_ctx.staff_id AND status = 'open'
     FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM bar_local.raise_business('SHIFT_REQUIRED', 'Open a shift before settling tabs.');
    END IF;
    IF v_discount < 0 OR v_tip < 0 THEN
      PERFORM bar_local.raise_business('VALIDATION_FAILED', 'Discount and tip cannot be negative.');
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'tab_line_id', tl.id, 'line_number', tl.line_number, 'product_id', tl.product_id,
        'name', tl.name_snapshot, 'sku', tl.sku_snapshot, 'quantity', tl.quantity,
        'unit_price', tl.unit_price, 'tax_rate', tl.tax_rate, 'line_subtotal', tl.line_subtotal,
        'line_tax', tl.line_tax, 'line_total', tl.line_total, 'notes', tl.notes,
        'category', p.category, 'modifier_snapshot', tl.modifier_snapshot,
        'recipe_cost', tl.recipe_cost, 'recipe_snapshot', tl.recipe_snapshot,
        'promotion_code', tl.promotion_code, 'promotion_discount', 0
      ) ORDER BY tl.line_number), '[]'::jsonb) INTO v_lines
      FROM bar_local.tab_lines tl
      JOIN bar_local.products p ON p.id = tl.product_id
     WHERE tl.tab_id = v_tab.id AND tl.status = 'open';
    IF jsonb_array_length(v_lines) = 0 THEN
      PERFORM bar_local.raise_business('TAB_NOT_OPEN', 'This tab has no lines to settle.');
    END IF;

    IF v_promotion_code IS NOT NULL THEN
      v_promotion_result := bar_local.allocate_promotion_discount(
        v_promotion_code, v_ctx.business_id, v_shift.business_date, v_lines);
      v_lines := v_promotion_result->'lines';
      v_promotion := v_promotion_result->'promotion';
      v_promotion_discount := (v_promotion_result->>'discount')::numeric;
    END IF;
    v_lines := bar_local.finalize_line_discounts(v_lines, v_discount);
    v_discount := v_discount + v_promotion_discount;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_subtotal := v_subtotal + ((v_line->>'line_subtotal')::numeric - (v_line->>'line_discount')::numeric);
      v_tax := v_tax + (v_line->>'line_tax')::numeric;
    END LOOP;
    v_total := v_subtotal + v_tax + v_tip;

    SELECT COALESCE(value #>> '{}', 'BAR') INTO v_series FROM bar_local.settings WHERE key = 'receipt_series';
    INSERT INTO bar_local.sales
      (business_id, outlet_id, shift_id, device_id, actor_staff_id, tab_id, receipt_number,
       receipt_series, business_date, subtotal, discount, tax, tip, total, customer_id,
       promotion_code, promotion_discount, promotion_snapshot, operation_id)
    VALUES
      (v_ctx.business_id, v_ctx.outlet_id, v_shift.id, v_ctx.device_id, v_ctx.staff_id, v_tab.id,
       v_seq.receipt_sequence, COALESCE(v_series, 'BAR'), v_shift.business_date, v_subtotal, v_discount,
       v_tax, v_tip, v_total, v_customer, v_promotion_code, v_promotion_discount, v_promotion,
       (p_envelope->>'operation_id')::uuid)
    RETURNING id INTO v_sale_id;

    v_line_no := 0;
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      v_line_no := v_line_no + 1;
      v_line_promo := COALESCE((v_line->>'promotion_discount')::numeric, 0);
      INSERT INTO bar_local.sale_lines
        (sale_id, line_number, product_id, name_snapshot, sku_snapshot, quantity, unit_price, tax_rate,
         line_subtotal, line_discount, line_tax, line_total, notes, modifier_snapshot, recipe_cost,
         recipe_snapshot, promotion_code, promotion_discount, promotion_snapshot, operation_id)
      VALUES
        (v_sale_id, v_line_no, (v_line->>'product_id')::uuid, v_line->>'name', v_line->>'sku',
         (v_line->>'quantity')::numeric, (v_line->>'unit_price')::numeric, (v_line->>'tax_rate')::numeric,
         (v_line->>'line_subtotal')::numeric, (v_line->>'line_discount')::numeric,
         (v_line->>'line_tax')::numeric, (v_line->>'line_total')::numeric,
         v_line->>'notes', COALESCE(v_line->'modifier_snapshot', '[]'::jsonb),
         COALESCE((v_line->>'recipe_cost')::numeric, 0), COALESCE(v_line->'recipe_snapshot', '[]'::jsonb),
         CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion_code END,
         v_line_promo,
         CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion END,
         (p_envelope->>'operation_id')::uuid);
      UPDATE bar_local.tab_lines
         SET promotion_code = CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion_code END,
             promotion_discount = v_line_promo,
             promotion_snapshot = CASE WHEN v_promotion_code IS NOT NULL AND v_line_promo > 0 THEN v_promotion END
       WHERE id = (v_line->>'tab_line_id')::uuid;
    END LOOP;

    IF v_promotion_code IS NOT NULL THEN
      INSERT INTO bar_local.promotion_redemptions
        (business_id, promotion_id, sale_id, code_snapshot, discount, operation_id)
      VALUES
        (v_ctx.business_id, (v_promotion->>'promotion_id')::uuid, v_sale_id,
         v_promotion_code, v_promotion_discount, (p_envelope->>'operation_id')::uuid);
    END IF;

    v_change := bar_local.apply_tenders(v_ctx, v_sale_id, v_shift.id, v_shift.business_date,
      v_payload->'tenders', v_total, v_customer, (p_envelope->>'operation_id')::uuid);
    UPDATE bar_local.tab_lines SET status = 'settled' WHERE tab_id = v_tab.id AND status = 'open';
    UPDATE bar_local.tabs SET status = 'settled', closed_at = now(), version = version + 1, settled_sale_id = v_sale_id
     WHERE id = v_tab.id;
    v_receipt := bar_local.build_receipt(v_sale_id) || jsonb_build_object('change', v_change, 'replayed', false);
    INSERT INTO bar_local.print_jobs (business_id, outlet_id, operation_id, sale_id, payload)
    VALUES (v_ctx.business_id, v_ctx.outlet_id, (p_envelope->>'operation_id')::uuid, v_sale_id, v_receipt);
    PERFORM bar_local.audit_row(v_ctx.business_id, v_ctx.outlet_id, v_ctx.staff_id, v_ctx.device_id,
      'tab.settled', (p_envelope->>'operation_id')::uuid, NULL, v_receipt);
    v_receipt := bar_local.finish_committed((p_envelope->>'operation_id')::uuid, v_seq.commit_sequence,
      jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt,
        'promotion_code', v_promotion_code, 'promotion_discount', v_promotion_discount),
      v_receipt, jsonb_build_array(jsonb_build_object('event_type','sale.committed','payload',v_receipt)), v_shift.business_date);
    RETURN jsonb_build_object('ok', true, 'outcome', 'committed_local', 'receipt', v_receipt,
      'result', jsonb_build_object('sale_id', v_sale_id, 'receipt', v_receipt,
        'promotion_code', v_promotion_code, 'promotion_discount', v_promotion_discount));
  EXCEPTION WHEN SQLSTATE 'BL001' THEN
    GET STACKED DIAGNOSTICS v_code = PG_EXCEPTION_DETAIL, v_message = MESSAGE_TEXT;
    v_error := bar_local.record_refusal((p_envelope->>'operation_id')::uuid, v_code, v_message);
    RETURN jsonb_build_object('ok', false, 'outcome', 'refused', 'error', v_error);
  END;
END;
$$;

ALTER FUNCTION bar_local.price_and_deplete_items(uuid, uuid, jsonb, uuid, date, boolean) SECURITY DEFINER;
ALTER FUNCTION bar_local.price_and_deplete_items(uuid, uuid, jsonb, uuid, date, boolean) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.build_receipt(uuid) SECURITY DEFINER;
ALTER FUNCTION bar_local.build_receipt(uuid) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.allocate_promotion_discount(text, uuid, date, jsonb) SECURITY DEFINER;
ALTER FUNCTION bar_local.allocate_promotion_discount(text, uuid, date, jsonb) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.finalize_line_discounts(jsonb, numeric) SECURITY DEFINER;
ALTER FUNCTION bar_local.finalize_line_discounts(jsonb, numeric) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_sale_commit(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_sale_commit(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_tab_add(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_tab_add(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_tab_settle(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_tab_settle(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_catalogue_modifier_group_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_catalogue_modifier_group_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_catalogue_modifier_option_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_catalogue_modifier_option_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_catalogue_product_modifier_set(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_catalogue_product_modifier_set(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_catalogue_recipe_set(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_catalogue_recipe_set(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;
ALTER FUNCTION bar_local.cmd_promotion_upsert(text, uuid, jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION bar_local.cmd_promotion_upsert(text, uuid, jsonb, text, text) SET search_path = pg_catalog, bar_local;

REVOKE ALL ON bar_local.modifier_groups, bar_local.modifier_options,
  bar_local.product_modifier_sets, bar_local.product_modifier_links,
  bar_local.product_recipes, bar_local.product_recipe_lines,
  bar_local.promotions, bar_local.promotion_redemptions
  FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.allocate_promotion_discount(text, uuid, date, jsonb) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.finalize_line_discounts(jsonb, numeric) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.price_and_deplete_items(uuid, uuid, jsonb, uuid, date, boolean) FROM PUBLIC, bar_local_runtime;
REVOKE ALL ON FUNCTION bar_local.build_receipt(uuid) FROM PUBLIC, bar_local_runtime;

GRANT EXECUTE ON FUNCTION
  bar_local.cmd_catalogue_modifier_group_upsert(text, uuid, jsonb, text, text),
  bar_local.cmd_catalogue_modifier_option_upsert(text, uuid, jsonb, text, text),
  bar_local.cmd_catalogue_product_modifier_set(text, uuid, jsonb, text, text),
  bar_local.cmd_catalogue_recipe_set(text, uuid, jsonb, text, text),
  bar_local.cmd_promotion_upsert(text, uuid, jsonb, text, text),
  bar_local.cmd_sale_commit(text, uuid, jsonb, text, text),
  bar_local.cmd_tab_add(text, uuid, jsonb, text, text),
  bar_local.cmd_tab_settle(text, uuid, jsonb, text, text)
TO bar_local_runtime;



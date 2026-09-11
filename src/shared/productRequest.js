/**
 * Pure product-save request helpers (no window, no Electron): normalization,
 * canonical comparison, and missing-backend detection. The desktop domain
 * persists the normalized request once and replays it verbatim; these
 * helpers make that contract unit-testable.
 */

/** Deterministic JSON encoding (sorted object keys) for request comparison. */
export function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  return typeof encoded === "string" ? encoded : "null";
}

/**
 * Normalize a wizard save into the atomic-RPC payload plus stable entity
 * ids. IDs are taken from the caller when present, otherwise minted by the
 * caller of this helper exactly once per operation key (never regenerated
 * on retry: retries reuse the persisted request, not this function).
 */
export function normalizeProductSaveRequest(data = {}, lodgeId = null, minted = {}) {
  const operationKey = String(data.operation_key || minted.operationKey || "").trim();
  if (!operationKey) throw new Error("A stable operation key is required before a product save can be persisted.");
  const inventoryItemId = String(data.inventory_item_id || minted.inventoryItemId || "").trim();
  if (!inventoryItemId) throw new Error("A stable inventory item identity is required before a product save can be persisted.");
  const rawBarcode = data?.barcode == null ? "" : String(data.barcode).trim();
  if (rawBarcode.length > 128 || /[\u0000-\u001f\u007f]/.test(rawBarcode)) {
    throw new Error("Product barcode must be 128 characters or fewer and contain no control characters.");
  }
  const payload = {
    lodge_id: lodgeId,
    operation_key: operationKey,
    menu_item_id: data.menu_item_id ? String(data.menu_item_id) : null,
    inventory_item_id: inventoryItemId,
    expected_menu_version: data.expected_menu_version || null,
    expected_stock_version: data.expected_stock_version || null,
    product: {
      name: String(data.name || "").trim(),
      category: String(data.category || "Drinks"),
      price: Number(data.price) || 0,
      barcode: rawBarcode || null,
      depletion_qty: Number(data.depletion_qty) || 1,
      is_available: data.is_available !== false,
    },
    stock: {
      mode: data.stock_mode === "link" ? "link" : "create",
      name: String(data.stock_name || data.name || "").trim(),
      category: String(data.stock_category || data.category || "Bar"),
      unit: String(data.stock_unit || "unit"),
      barcode: data.stock_barcode ? String(data.stock_barcode).trim() || null : null,
      outlet_id: data.outlet_id || null,
      opening_stock: Number(data.opening_stock) || 0,
      reorder_level: Number(data.reorder_level) || 0,
      unit_cost: Number(data.unit_cost) || 0,
      selling_price: Number(data.selling_price ?? data.price) || 0,
    },
    packs: [6, 12, 24].map((packSize) => ({
      pack_size: packSize,
      enabled: data[`pack${packSize}`] === true,
      barcode: data[`pack${packSize}Barcode`] || null,
    })),
  };
  return {
    operationKey,
    payload,
    entityIds: { menu_item_id: payload.menu_item_id, inventory_item_id: inventoryItemId },
  };
}

/** True when two normalized payloads are byte-equivalent after canonicalization. */
export function isSameProductRequest(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

/** True when an RPC failure means the function does not exist server-side. */
export function isMissingRpcError(error) {
  const text = String(error?.message || error || "");
  return /does not exist|not found|404|PGRST202|schema cache/i.test(text);
}

/**
 * True when the server definitively refused this payload (business refusal:
 * SQLSTATE 22023 validation or 23505 conflict, e.g. duplicate product/stock
 * name, barcode conflict, stale edit version). Retrying identical bytes can
 * never succeed, so the stored request becomes terminal (rejected) instead of
 * retryable. Transport/permission/missing-RPC failures stay retryable.
 */
export function isDefinitiveProductRejection(error) {
  const code = String(error?.code ?? "").trim().toUpperCase();
  return code === "22023" || code === "23505";
}

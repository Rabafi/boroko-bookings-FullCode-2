// @ts-check
/**
 * Archived-only stock helper.
 *
 * A stock item is "archived-only" when it is linked to at least one POS
 * product AND every linked product carries `archived_at`. Standalone stock
 * (no linked product: recipe-only, legacy, manual stock) is never archived —
 * it stays visible so counts, deliveries and waste keep working.
 *
 * All linked rows count, including packs (`bar_pack`/`bar_single`), standard
 * rows and auto rows: if a single is archived but its pack is still active,
 * the stock is still in service and must stay visible.
 *
 * This is a display filter only. It never mutates `is_active`, never touches
 * movement history, and never changes the server delist contract in
 * `20260911000000_bar_product_delete_delists_stock.sql` (archived products
 * keep their stock listed server-side so they can be restored).
 */

/** @param {unknown} value @param {string} key @returns {unknown} */
function readOptionalField(value, key) {
  return value === null || value === undefined
    ? undefined
    : Reflect.get(Object(value), key, value)
}

/** @param {unknown} stockItemId @param {unknown} [menuItems] @returns {unknown[]} */
export function linkedMenuItemsForStock(stockItemId, menuItems = []) {
  const target = String(stockItemId || '');
  if (!target) return [];
  /** @type {unknown[]} */
  const rows = Array.isArray(menuItems) ? menuItems : [];
  return rows.filter(
    (candidate) => {
      const inventoryItemId = readOptionalField(candidate, 'inventory_item_id')
      return inventoryItemId != null && String(readOptionalField(candidate, 'inventory_item_id')) === target;
    },
  );
}

/** @param {unknown} stockItem @param {unknown} [menuItems] @returns {boolean} */
export function isArchivedOnlyStockItem(stockItem, menuItems = []) {
  if (!readOptionalField(stockItem, 'id')) return false;
  const linked = linkedMenuItemsForStock(readOptionalField(stockItem, 'id'), menuItems);
  if (linked.length === 0) return false;
  return linked.every((candidate) => {
    return Boolean(readOptionalField(candidate, 'archived_at'));
  });
}

/** @param {unknown} stockItems @param {unknown} [menuItems] @returns {{live: unknown[], archived: unknown[]}} */
export function partitionStockByArchive(stockItems = [], menuItems = []) {
  /** @type {unknown[]} */
  const live = [];
  /** @type {unknown[]} */
  const archived = [];
  /** @type {unknown[]} */
  const items = Array.isArray(stockItems) ? stockItems : [];
  for (const item of items) {
    if (isArchivedOnlyStockItem(item, menuItems)) archived.push(item);
    else live.push(item);
  }
  return { live, archived };
}

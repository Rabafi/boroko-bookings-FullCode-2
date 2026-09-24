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

export function linkedMenuItemsForStock(stockItemId, menuItems = []) {
  const target = String(stockItemId || '');
  if (!target) return [];
  return (Array.isArray(menuItems) ? menuItems : []).filter(
    (row) => row?.inventory_item_id != null && String(row.inventory_item_id) === target,
  );
}

export function isArchivedOnlyStockItem(stockItem, menuItems = []) {
  if (!stockItem?.id) return false;
  const linked = linkedMenuItemsForStock(stockItem.id, menuItems);
  if (linked.length === 0) return false;
  return linked.every((row) => Boolean(row?.archived_at));
}

export function partitionStockByArchive(stockItems = [], menuItems = []) {
  const live = [];
  const archived = [];
  for (const item of Array.isArray(stockItems) ? stockItems : []) {
    if (isArchivedOnlyStockItem(item, menuItems)) archived.push(item);
    else live.push(item);
  }
  return { live, archived };
}

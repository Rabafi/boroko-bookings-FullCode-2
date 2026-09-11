/**
 * Shared Bar waste aggregation (base package, quantities only).
 *
 * One implementation serves the Sales report card and the POS history
 * Excel/PDF exports so all three always agree. Only movements written by
 * the Stock Waste action count (notes prefixed `Waste ·`); every other
 * decrease (void restores, corrections) is excluded. Money never appears
 * here: costed waste, valuation and margin stay Stock & Purchasing Pro.
 */

export const WASTE_MOVEMENT_PREFIX = 'Waste ·';

function parseWasteReason(notes) {
  const parts = String(notes || '').split('·').map((segment) => segment.trim());
  return parts[2] || 'Waste';
}

/**
 * @param {Array} rows movement ledger rows (item_name/item_unit decorated)
 * @returns {{ items: Array<{label, unit, quantity, topReason, entries}>,
 *            detail: Array<{date, label, unit, quantity, reason, note}>,
 *            totalEntries: number }}
 */
export function summarizeWasteMovements(rows = []) {
  const byItem = new Map();
  const detail = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.movement_type !== 'adjustment_decrease') continue;
    const notes = String(row?.notes || '');
    if (!notes.startsWith(WASTE_MOVEMENT_PREFIX)) continue;
    const quantity = Math.abs(Number(row?.quantity || 0));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    const reason = parseWasteReason(notes);
    const label = String(row?.item_name || 'Inventory item');
    const unit = String(row?.item_unit || 'unit');
    const key = String(row?.item_id || label);
    const current = byItem.get(key) || { label, unit, quantity: 0, entries: 0, reasons: new Map() };
    current.quantity += quantity;
    current.entries += 1;
    current.reasons.set(reason, (current.reasons.get(reason) || 0) + quantity);
    byItem.set(key, current);
    detail.push({
      date: row?.created_at || null,
      label,
      unit,
      quantity,
      reason,
      note: notes,
    });
  }
  const items = [...byItem.values()]
    .map((entry) => ({
      label: entry.label,
      unit: entry.unit,
      quantity: entry.quantity,
      entries: entry.entries,
      topReason: [...entry.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Waste',
    }))
    .sort((a, b) => b.quantity - a.quantity);
  detail.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return { items, detail, totalEntries: detail.length };
}

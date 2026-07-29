/**
 * Parse the optional unit-cost field used by the Base Bar stock editor.
 *
 * An empty field means "leave the existing cost unchanged" when editing an
 * item. A zero cost is a valid explicit value (for example donated/opening
 * stock), so it must remain distinct from an empty field.
 */
export function parseOptionalNonNegativeCost(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return { ok: true, value: undefined }

  const numeric = Number(raw)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { ok: false, value: null }
  }
  return { ok: true, value: numeric }
}

/**
 * Build the optional cost portion of an inventory update payload. Omitting the
 * key is intentional: update_inventory_item preserves latest_unit_cost when
 * the operator leaves the cost field blank.
 */
export function buildOptionalUnitCostPatch(value) {
  const parsed = parseOptionalNonNegativeCost(value)
  if (!parsed.ok) return { ok: false, patch: null }
  return {
    ok: true,
    patch: parsed.value === undefined ? {} : { unit_cost: parsed.value },
  }
}

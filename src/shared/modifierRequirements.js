// @ts-check
/** @typedef {Record<string, unknown> | null | undefined} ModifierRecord */
/**
 * Shared modifier-requirement helpers: which groups apply to a sale line and
 * which required choices are unmet. Used by the Till (Hold/Pay validation),
 * the desktop domain (pre-dispatch check), and mirrored by the authoritative
 * server trigger. Applicability rule is identical everywhere: active groups
 * whose categories are empty, "all", or the line category (case-insensitive).
 */

/** @param {unknown} group @param {unknown} category @returns {boolean} */
export function isModifierGroupApplicable(group, category) {
  if (!group) return false;
  const groupFields = /** @type {Record<string, unknown>} */ (group)
  if (groupFields.active === false) return false;
  const categories = Array.isArray(groupFields.applies_to_categories)
    ? /** @type {unknown[]} */ (groupFields.applies_to_categories)
    : [];
  if (categories.length === 0) return true;
  const line = String(category || "").toLowerCase();
  return categories.some((entry) => {
    const text = String(entry || "").toLowerCase();
    return text === "all" || text === line;
  });
}

/** @param {ModifierRecord} group @returns {Set<string>} */
function groupOptionIds(group) {
  const groupFields = /** @type {Record<string, unknown> | null | undefined} */ (group)
  const options = Array.isArray(groupFields?.options) ? /** @type {unknown[]} */ (groupFields.options) : [];
  return new Set(options.map((option) => {
    const fields = /** @type {Record<string, unknown> | null | undefined} */ (option)
    return String(fields?.id ?? fields?.name ?? "")
  }));
}

/**
 * Selections attributed to a group: by explicit group_id when present,
 * otherwise by matching option ids. Returns the matching selections.
 */
/** @param {unknown} selections @param {unknown} group @returns {unknown[]} */
export function selectionsInModifierGroup(selections, group) {
  const selected = Array.isArray(selections) ? /** @type {unknown[]} */ (selections) : [];
  if (!group) return [];
  const groupFields = /** @type {Record<string, unknown>} */ (group)
  const optionIds = groupOptionIds(groupFields);
  return selected.filter((selection) => {
    if (!selection) return false;
    const selectionFields = /** @type {Record<string, unknown>} */ (selection)
    if (selectionFields.group_id != null && groupFields.id != null) {
      return String(selectionFields.group_id) === String(groupFields.id);
    }
    return optionIds.has(String(selectionFields.id ?? selectionFields.name ?? ""));
  });
}

/**
 * Required groups for a line with fewer selections than their minimum.
 * Returns [{ id, name, min, count }]. Empty means the line may proceed.
 */
/** @param {unknown} line @param {unknown} groups */
export function findUnmetModifierGroups(line, groups) {
  const lineFields = /** @type {Record<string, unknown> | null | undefined} */ (line)
  const selected = Array.isArray(lineFields?.modifiers) ? /** @type {unknown[]} */ (lineFields.modifiers) : [];
  const unmet = [];
  for (const group of Array.isArray(groups) ? /** @type {unknown[]} */ (groups) : []) {
    const groupFields = /** @type {Record<string, unknown> | null | undefined} */ (group)
    const min = Number(groupFields?.min_selections || 0);
    if (!(min > 0)) continue;
    if (!isModifierGroupApplicable(group, lineFields?.category)) continue;
    const count = selectionsInModifierGroup(selected, groupFields).length;
    if (count < min) {
      unmet.push({
        id: groupFields?.id || null,
        name: groupFields?.name || "Required choices",
        min,
        count,
      });
    }
  }
  return unmet;
}

/**
 * Validate every sale line. Returns { ok, unmet: [{ lineName, groups }] }.
 * Unknown applicability (groups not loaded) is NOT ok: callers must block
 * progression until requirements are verified, never guess.
 */
/** @param {unknown} lines @param {unknown} groups @param {unknown} groupsKnown */
export function validateSaleModifierRequirements(lines, groups, groupsKnown) {
  const items = Array.isArray(lines) ? /** @type {unknown[]} */ (lines) : [];
  if (groupsKnown !== true) {
    return {
      ok: false,
      known: false,
      unmet: [],
      error: "Modifier choices could not be verified. Refresh and retry.",
    };
  }
  const unmet = [];
  for (const line of items) {
    const missing = findUnmetModifierGroups(line, groups);
    if (missing.length > 0) {
      const lineFields = /** @type {Record<string, unknown> | null | undefined} */ (line)
      unmet.push({
        lineName: lineFields?.item_name || lineFields?.name || "Item",
        groups: missing,
      });
    }
  }
  if (unmet.length > 0) {
    const names = [...new Set(unmet.flatMap((entry) => entry.groups.map((group) => group.name)))];
    return {
      ok: false,
      known: true,
      unmet,
      error: `Complete required choices: ${names.join(", ")}`,
    };
  }
  return { ok: true, known: true, unmet: [] };
}

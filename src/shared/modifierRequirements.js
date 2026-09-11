/**
 * Shared modifier-requirement helpers: which groups apply to a sale line and
 * which required choices are unmet. Used by the Till (Hold/Pay validation),
 * the desktop domain (pre-dispatch check), and mirrored by the authoritative
 * server trigger. Applicability rule is identical everywhere: active groups
 * whose categories are empty, "all", or the line category (case-insensitive).
 */

export function isModifierGroupApplicable(group, category) {
  if (!group || group.active === false) return false;
  const categories = Array.isArray(group.applies_to_categories)
    ? group.applies_to_categories
    : [];
  if (categories.length === 0) return true;
  const line = String(category || "").toLowerCase();
  return categories.some((entry) => {
    const text = String(entry || "").toLowerCase();
    return text === "all" || text === line;
  });
}

function groupOptionIds(group) {
  const options = Array.isArray(group?.options) ? group.options : [];
  return new Set(options.map((option) => String(option?.id ?? option?.name ?? "")));
}

/**
 * Selections attributed to a group: by explicit group_id when present,
 * otherwise by matching option ids. Returns the matching selections.
 */
export function selectionsInModifierGroup(selections, group) {
  const selected = Array.isArray(selections) ? selections : [];
  if (!group) return [];
  const optionIds = groupOptionIds(group);
  return selected.filter((selection) => {
    if (!selection) return false;
    if (selection.group_id != null && group.id != null) {
      return String(selection.group_id) === String(group.id);
    }
    return optionIds.has(String(selection.id ?? selection.name ?? ""));
  });
}

/**
 * Required groups for a line with fewer selections than their minimum.
 * Returns [{ id, name, min, count }]. Empty means the line may proceed.
 */
export function findUnmetModifierGroups(line, groups) {
  const selected = Array.isArray(line?.modifiers) ? line.modifiers : [];
  const unmet = [];
  for (const group of Array.isArray(groups) ? groups : []) {
    const min = Number(group?.min_selections || 0);
    if (!(min > 0)) continue;
    if (!isModifierGroupApplicable(group, line?.category)) continue;
    const count = selectionsInModifierGroup(selected, group).length;
    if (count < min) {
      unmet.push({
        id: group?.id || null,
        name: group?.name || "Required choices",
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
export function validateSaleModifierRequirements(lines, groups, groupsKnown) {
  const items = Array.isArray(lines) ? lines : [];
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
      unmet.push({
        lineName: line?.item_name || line?.name || "Item",
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

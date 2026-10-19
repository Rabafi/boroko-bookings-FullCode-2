// @ts-check
/**
 * Pure Till basket-recovery helpers (no window, no React): cash-tender
 * validation, draft freshness, and catalogue revalidation. Imported by the
 * Bar Till and covered behaviorally; storage keys and rendering stay in the
 * component.
 */

export const BASKET_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export const QUICK_CASH_AMOUNTS = Object.freeze([20, 50, 100, 200]);

/** @typedef {{id?: unknown, tabId?: unknown, at?: unknown, lines?: unknown, savedAt?: unknown, on_hand?: unknown, menu_item_id?: unknown, stock_unit?: unknown, readiness?: unknown, success?: unknown, rows?: unknown, error?: unknown, code?: unknown, unit_price?: unknown, category?: unknown, item_name?: unknown, template_kind?: unknown, template_pack_size?: unknown, archived_at?: unknown, is_available?: unknown, available?: unknown, price?: unknown, name?: unknown}} BasketRecord */

/**
 * Scope an unsent basket/hold intent to tenant + outlet + operator + shift.
 * Anything outside the scope never restores.
 */
/** @param {unknown} lodgeId @param {unknown} outletId @param {unknown} operatorId @param {unknown} shiftId */
export function basketScopeKey(lodgeId, outletId, operatorId, shiftId) {
  return `${lodgeId || "nolid"}:${outletId || "nooutlet"}:${operatorId || "noop"}:${shiftId || "noshift"}`;
}

/**
 * Canonical storage keys. Exactly one function builds each key so writers
 * and readers can never diverge (a mismatched key silently orphans drafts).
 */
/** @param {unknown} lodgeId @param {unknown} outletId @param {unknown} operatorId @param {unknown} shiftId */
export function basketDraftKey(lodgeId, outletId, operatorId, shiftId) {
  return `hpos-basket-draft:${basketScopeKey(lodgeId, outletId, operatorId, shiftId)}`;
}

/** @param {unknown} lodgeId @param {unknown} outletId @param {unknown} operatorId */
export function holdIntentKey(lodgeId, outletId, operatorId) {
  // Intents outlive a single shift id on purpose: a crash between dispatch
  // and response must still reconcile after a shift reload.
  return `hpos-hold-intent:${basketScopeKey(lodgeId, outletId, operatorId, "any")}`;
}

/** @param {unknown} lodgeId @param {unknown} outletId */
export function lastReceiptKey(lodgeId, outletId) {
  return `hpos-last-receipt:${lodgeId || "nolid"}:${outletId || "nooutlet"}`;
}

/**
 * Reconcile a persisted hold intent against the authoritative tab list by
 * server operation identity (tab id), never by name/timestamp heuristics.
 * - confirmed: the tab exists under the held id.
 * - expired: the intent is older than the draft TTL.
 * - unknown: preserved — the save may still have committed.
 * - absent: no intent to reconcile.
 */
/** @param {unknown} intent @param {unknown} tabs @param {number} [now] */
export function reconcileHoldIntent(intent, tabs, now = Date.now()) {
  const held = /** @type {BasketRecord|null|undefined} */ (intent)
  if (!held?.tabId) return { outcome: "absent" };
  if (held.at != null && Number(now) - Number(held.at) > BASKET_DRAFT_TTL_MS) {
    return { outcome: "expired" };
  }
  const match = (Array.isArray(tabs) ? /** @type {unknown[]} */ (tabs) : []).find(
    (tab) => {
      const tabRecord = /** @type {BasketRecord|null|undefined} */ (tab)
      return tabRecord?.id != null && String(tabRecord.id) === String(held.tabId)
    },
  );
  if (match) return { outcome: "confirmed", tab: match };
  return { outcome: "unknown" };
}

/**
 * Round a tendering amount to currency minor units, half up, using decimal
 * string math instead of binary floats (roundCash(1.005) === 1.01, where
 * Math.round(1.005 * 100) / 100 === 1). Returns NaN for non-numeric input.
 */
/** @param {unknown} value */
export function roundCash(value) {
  const text = String(value ?? "").trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return NaN;
  const [, sign, intPart, fracPart = ""] = match;
  const frac = (fracPart + "000").slice(0, 3);
  let minor = Number(intPart) * 100 + Number(frac.slice(0, 2));
  if (!Number.isSafeInteger(minor)) return NaN;
  if (Number(frac[2] || "0") >= 5) minor += 1;
  const rounded = minor / 100;
  return sign === "-" ? -rounded : rounded;
}

/**
 * Validate an optional cash-received input against the amount due.
 * Received/change NEVER alter the sale allocation: the cash tender stays
 * exactly the amount due, excess is change (never revenue or tip).
 * Returns { ok, cashTender: { cash_received, change_due } | null, ... }.
 * A blank input is valid and means "no tendering aids recorded".
 */
/** @param {unknown} receivedInput @param {unknown} total */
export function computeCashTender(receivedInput, total) {
  const text = String(receivedInput ?? "").trim();
  if (text === "") return { ok: true, cashTender: null };
  const received = roundCash(Number(text));
  if (!Number.isFinite(received) || received < 0) {
    return {
      ok: false,
      cashTender: null,
      error: "Enter a valid cash amount received, or leave it blank.",
    };
  }
  const due = roundCash(Number(total) || 0);
  if (received + 1e-9 < due) {
    return {
      ok: false,
      cashTender: null,
      received,
      due,
      error: "Cash received is less than the amount due.",
    };
  }
  return {
    ok: true,
    cashTender: { cash_received: received, change_due: roundCash(received - due) },
  };
}

/** A stored draft restores only when non-empty and within TTL. */
/** @param {unknown} draft @param {number} [now] */
export function isDraftFresh(draft, now = Date.now()) {
  const value = /** @type {BasketRecord|null|undefined} */ (draft)
  if (!value || !Array.isArray(value.lines) || value.lines.length === 0) return false;
  return Number(now) - Number(value.savedAt || 0) <= BASKET_DRAFT_TTL_MS;
}

export const READINESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** @param {unknown} lodgeId */
export function readinessCacheKey(lodgeId) {
  return `hpos-readiness:${lodgeId || "nolid"}`;
}

/**
 * Resolve a readiness fetch into Till state. Success replaces the cache;
 * failure falls back to a fresh approved cache as "stale" (selling
 * continues on last verified data, explicitly labeled); with no cache the
 * state is failed and selling blocks until refresh. `counts` carries the
 * counted on-hand quantity per sellable for automatic sold-out (direct
 * rows only; absent on old servers and stays empty there).
 */
/** @param {unknown} fetchResult @param {unknown} cached @param {number} [now] */
export function resolveReadinessState(fetchResult, cached, now = Date.now()) {
  const fetched = /** @type {BasketRecord|null|undefined} */ (fetchResult)
  const cachedRecord = /** @type {BasketRecord|null|undefined} */ (cached)
  /** @param {unknown} rows */
  const countsOf = (rows) => {
    const counts = new Map();
    for (const row of Array.isArray(rows) ? /** @type {unknown[]} */ (rows) : []) {
      const stock = /** @type {BasketRecord|null|undefined} */ (row)
      // Null means "uncounted" (non-stock, recipe, unlinked): it must never
      // read as zero — Number(null) is 0, so null is skipped explicitly.
      if (stock?.on_hand === null || stock?.on_hand === undefined) continue;
      const qty = Number(stock.on_hand);
      if (!stock?.menu_item_id || !Number.isFinite(qty)) continue;
      counts.set(stock.menu_item_id, { qty, unit: String(stock?.stock_unit || 'each') });
    }
    return counts;
  };
  if (fetched?.success && Array.isArray(fetched.rows)) {
    const rows = /** @type {unknown[]} */ (fetched.rows)
    return {
      status: "ready",
      map: new Map(rows.map((row) => {
        const item = /** @type {BasketRecord|null|undefined} */ (row)
        return [item?.menu_item_id, item?.readiness]
      })),
      counts: countsOf(rows),
      cachedAt: null,
    };
  }
  const freshCache =
    cachedRecord && Array.isArray(cachedRecord.rows) && Number(now) - Number(cachedRecord.at || 0) <= READINESS_CACHE_TTL_MS
      ? cachedRecord
      : null;
  if (freshCache) {
    const rows = /** @type {unknown[]} */ (freshCache.rows)
    return {
      status: "stale",
      map: new Map(rows.map((row) => {
        const item = /** @type {BasketRecord|null|undefined} */ (row)
        return [item?.menu_item_id, item?.readiness]
      })),
      counts: countsOf(rows),
      cachedAt: freshCache.at,
    };
  }
  return { status: "failed", map: new Map(), counts: new Map(), cachedAt: null, error: fetched?.error || null, code: fetched?.code || null };
}

/**
 * Revalidate restored lines against the current catalogue: drop archived,
 * missing or unavailable products, refresh names/prices from the server
 * read. Reports counts so the UI can explain what changed.
 */
/** @param {unknown} lines @param {unknown} menuItems */
export function revalidateBasketLines(lines, menuItems) {
  const byId = new Map((Array.isArray(menuItems) ? /** @type {unknown[]} */ (menuItems) : []).map((item) => [/** @type {BasketRecord|null|undefined} */ (item)?.id, item]));
  let dropped = 0;
  let repriced = 0;
  const kept = [];
  for (const untrustedLine of Array.isArray(lines) ? /** @type {unknown[]} */ (lines) : []) {
    const line = /** @type {BasketRecord|null|undefined} */ (untrustedLine)
    const untrustedMenu = byId.get(line?.menu_item_id)
    const menu = /** @type {BasketRecord|null|undefined} */ (untrustedMenu)
    if (!menu || menu.archived_at || menu.is_available === false || menu.available === false) {
      dropped += 1;
      continue;
    }
    const lineFields = /** @type {BasketRecord} */ (line)
    const price = Number(menu.price || 0);
    if (price !== Number(lineFields.unit_price || 0)) repriced += 1;
    kept.push({
      ...lineFields,
      item_name: menu.name,
      unit_price: price,
      category: menu.category || lineFields.category || null,
      template_kind: menu.template_kind ?? lineFields.template_kind ?? null,
      template_pack_size: menu.template_pack_size ?? lineFields.template_pack_size ?? null,
    });
  }
  return { lines: kept, dropped, repriced };
}

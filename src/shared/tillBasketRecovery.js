/**
 * Pure Till basket-recovery helpers (no window, no React): cash-tender
 * validation, draft freshness, and catalogue revalidation. Imported by the
 * Bar Till and covered behaviorally; storage keys and rendering stay in the
 * component.
 */

export const BASKET_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export const QUICK_CASH_AMOUNTS = Object.freeze([50, 100, 200]);

/**
 * Scope an unsent basket/hold intent to tenant + outlet + operator + shift.
 * Anything outside the scope never restores.
 */
export function basketScopeKey(lodgeId, outletId, operatorId, shiftId) {
  return `${lodgeId || "nolid"}:${outletId || "nooutlet"}:${operatorId || "noop"}:${shiftId || "noshift"}`;
}

/**
 * Canonical storage keys. Exactly one function builds each key so writers
 * and readers can never diverge (a mismatched key silently orphans drafts).
 */
export function basketDraftKey(lodgeId, outletId, operatorId, shiftId) {
  return `hpos-basket-draft:${basketScopeKey(lodgeId, outletId, operatorId, shiftId)}`;
}

export function holdIntentKey(lodgeId, outletId, operatorId) {
  // Intents outlive a single shift id on purpose: a crash between dispatch
  // and response must still reconcile after a shift reload.
  return `hpos-hold-intent:${basketScopeKey(lodgeId, outletId, operatorId, "any")}`;
}

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
export function reconcileHoldIntent(intent, tabs, now = Date.now()) {
  if (!intent?.tabId) return { outcome: "absent" };
  if (intent.at != null && Number(now) - Number(intent.at) > BASKET_DRAFT_TTL_MS) {
    return { outcome: "expired" };
  }
  const match = (Array.isArray(tabs) ? tabs : []).find(
    (tab) => tab?.id != null && String(tab.id) === String(intent.tabId),
  );
  if (match) return { outcome: "confirmed", tab: match };
  return { outcome: "unknown" };
}

/**
 * Round a tendering amount to currency minor units, half up, using decimal
 * string math instead of binary floats (roundCash(1.005) === 1.01, where
 * Math.round(1.005 * 100) / 100 === 1). Returns NaN for non-numeric input.
 */
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
export function isDraftFresh(draft, now = Date.now()) {
  if (!draft || !Array.isArray(draft.lines) || draft.lines.length === 0) return false;
  return Number(now) - Number(draft.savedAt || 0) <= BASKET_DRAFT_TTL_MS;
}

export const READINESS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export function readinessCacheKey(lodgeId) {
  return `hpos-readiness:${lodgeId || "nolid"}`;
}

/**
 * Resolve a readiness fetch into Till state. Success replaces the cache;
 * failure falls back to a fresh approved cache as "stale" (selling
 * continues on last verified data, explicitly labeled); with no cache the
 * state is failed and selling blocks until refresh.
 */
export function resolveReadinessState(fetchResult, cached, now = Date.now()) {
  if (fetchResult?.success && Array.isArray(fetchResult.rows)) {
    return {
      status: "ready",
      map: new Map(fetchResult.rows.map((row) => [row?.menu_item_id, row?.readiness])),
      cachedAt: null,
    };
  }
  const freshCache =
    cached && Array.isArray(cached.rows) && Number(now) - Number(cached.at || 0) <= READINESS_CACHE_TTL_MS
      ? cached
      : null;
  if (freshCache) {
    return {
      status: "stale",
      map: new Map(freshCache.rows.map((row) => [row?.menu_item_id, row?.readiness])),
      cachedAt: freshCache.at,
    };
  }
  return { status: "failed", map: new Map(), cachedAt: null, error: fetchResult?.error || null, code: fetchResult?.code || null };
}

/**
 * Revalidate restored lines against the current catalogue: drop archived,
 * missing or unavailable products, refresh names/prices from the server
 * read. Reports counts so the UI can explain what changed.
 */
export function revalidateBasketLines(lines, menuItems) {
  const byId = new Map((Array.isArray(menuItems) ? menuItems : []).map((item) => [item?.id, item]));
  let dropped = 0;
  let repriced = 0;
  const kept = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const menu = byId.get(line?.menu_item_id);
    if (!menu || menu.archived_at || menu.is_available === false || menu.available === false) {
      dropped += 1;
      continue;
    }
    const price = Number(menu.price || 0);
    if (price !== Number(line.unit_price || 0)) repriced += 1;
    kept.push({
      ...line,
      item_name: menu.name,
      unit_price: price,
      category: menu.category || line.category || null,
      template_kind: menu.template_kind ?? line.template_kind ?? null,
      template_pack_size: menu.template_pack_size ?? line.template_pack_size ?? null,
    });
  }
  return { lines: kept, dropped, repriced };
}

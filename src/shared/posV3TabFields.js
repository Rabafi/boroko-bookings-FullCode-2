// @ts-check
/**
 * Optional tab-identity fields for create_pos_order_v3 envelopes.
 *
 * Retry byte-equivalence is load-bearing: the submit journal hashes the
 * exact envelope, so a rebuilt retry must hash identically to reach the
 * server replay contract. These fields are therefore forwarded ONLY when
 * the caller actually sent them. In particular, never backfill them from
 * mutable cache state: an enriched retry hashes differently and dies with
 * a local idempotency conflict instead of replaying the stored receipt.
 */
/** @param {unknown} value @returns {boolean} */
export function isPositiveTabVersion(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0;
}

/** @param {Record<string, unknown> | null | undefined} payload @param {Record<string, unknown> | null | undefined} data */
export function applyOptionalV3TabFields(payload, data) {
  const source = data && typeof data === 'object' ? data : {};
  const target = payload && typeof payload === 'object' ? payload : {};
  if ('expected_tab_version' in source) {
    target.expected_tab_version = source.expected_tab_version ?? null;
  }
  if ('resolve_tab' in source) {
    target.resolve_tab = source.resolve_tab === true;
  }
  return target;
}

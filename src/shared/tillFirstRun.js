// @ts-check

/**
 * Keep a successful catalogue read separate from failures in other services.
 * Only an actual array can establish an empty catalogue.
 * @param {PromiseSettledResult<unknown>[]} results
 */
export function resolveTillCoreReads(results) {
  const catalogue = results[0];
  if (!catalogue || catalogue.status === 'rejected') {
    throw catalogue?.status === 'rejected' ? catalogue.reason : new Error('The product catalogue could not be read.');
  }
  if (!Array.isArray(catalogue.value)) {
    const detail = catalogue.value && typeof catalogue.value === 'object' && '_error' in catalogue.value
      ? catalogue.value._error : null;
    throw new Error(String(detail || 'The product catalogue could not be verified. Retry loading products.'));
  }
  const serviceFailure = results.slice(1).find((result) => result.status === 'rejected');
  return {
    menu: catalogue.value,
    values: results.map((result) => result.status === 'fulfilled' ? result.value : null),
    serviceError: serviceFailure?.status === 'rejected' ? (serviceFailure.reason ?? new Error('A POS service could not be read.')) : null,
  };
}

/** @param {{lodge_id?: unknown}[]} entries @param {string|null} lodgeId @param {number} [limit] */
export function selectBusinessCrashHistory(entries, lodgeId, limit = 10) {
  if (!lodgeId) return [];
  // Untagged historical entries cannot safely be attributed to this company.
  return entries.filter((entry) => entry?.lodge_id === lodgeId)
    .slice(-Math.max(1, Number(limit) || 10)).reverse();
}

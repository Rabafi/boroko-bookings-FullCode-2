// A paged journal response is not a trial balance. Missing or malformed totals
// must stay unavailable rather than becoming an invented zero balance.
export function normalizeTrialBalanceResponse(response) {
  const source = response?.data ?? response;
  const unavailable = () => { throw new Error('Trial balance unavailable. Refresh to verify the server totals.'); };
  if (response?.success === false || source?.success === false || !Array.isArray(source?.trial_balance)) unavailable();
  return source.trial_balance.map((row) => {
    if (!row || typeof row !== 'object' || !row.account_id) unavailable();
    const amounts = {};
    for (const key of ['debit', 'credit', 'balance']) {
      const value = row[key];
      if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) unavailable();
      amounts[key] = Number(value);
    }
    if (amounts.debit < 0 || amounts.credit < 0) unavailable();
    return { ...row, ...amounts };
  });
}
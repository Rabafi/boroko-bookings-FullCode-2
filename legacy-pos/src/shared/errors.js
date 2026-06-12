export function sanitizePosError(raw) {
  if (!raw) return 'Operation failed to sync. Please retry from Sync screen.';
  const msg = String(raw);

  if (/fetch failed|network error|not reachable|failed to fetch/i.test(msg)) {
    return 'Could not reach the server. Please check your connection and retry from Sync.';
  }

  if (/session.*expired|authentication.*required|authenticated.*required/i.test(msg)) {
    return 'Your session has expired. Please sign out and sign in again before retrying.';
  }

  if (/unique.*violation|duplicate key/i.test(msg)) {
    return 'This order may have already synced. Refresh the POS and check history.';
  }

  const cleaned = msg
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '...')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > 160 ? `${cleaned.slice(0, 157)}...` : cleaned;
}

// Only resumable business details belong in renderer storage. Owner identity,
// credentials, pairing codes and secrets stay in protected setup submissions.
const SAFE_FIELDS = Object.freeze([
  'business_name', 'outlet_name', 'currency', 'timezone', 'device_name',
  'company_name', 'address', 'city', 'country', 'website'
])

export const BAR_LOCAL_SETUP_DRAFT_KEY = 'bar-local-setup-draft-v1'

/** @param {unknown} value @param {Record<string, unknown>} fallback */
export function sanitizeBarLocalSetupDraft(value, fallback = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {}
  const safe = { ...fallback }
  for (const field of SAFE_FIELDS) {
    const candidate = source[field]
    if (typeof candidate !== 'string') continue
    const limit = field === 'address' ? 240 : field === 'business_name' || field === 'company_name' ? 200 : 120
    safe[field] = candidate.trim().slice(0, limit)
  }
  // Sensitive values can never be restored from this draft, even if an older
  // or modified record contains them.
  for (const field of ['pin', 'owner_password', 'password', 'owner_name', 'owner_email', 'phone', 'email', 'vat_number']) {
    if (field in fallback) safe[field] = fallback[field]
  }
  return safe
}

/** @param {Pick<Storage, 'getItem'>} storage @param {Record<string, unknown>} fallback */
export function loadBarLocalSetupDraft(storage, fallback = {}) {
  try {
    const raw = storage.getItem(BAR_LOCAL_SETUP_DRAFT_KEY)
    if (!raw) return { ...fallback }
    return sanitizeBarLocalSetupDraft(JSON.parse(raw), fallback)
  } catch {
    return { ...fallback }
  }
}

/** @param {Pick<Storage, 'setItem'>} storage @param {unknown} draft */
export function saveBarLocalSetupDraft(storage, draft) {
  const safe = sanitizeBarLocalSetupDraft(draft)
  storage.setItem(BAR_LOCAL_SETUP_DRAFT_KEY, JSON.stringify(safe))
  return safe
}

/** @param {Pick<Storage, 'removeItem'>} storage */
export function clearBarLocalSetupDraft(storage) {
  storage.removeItem(BAR_LOCAL_SETUP_DRAFT_KEY)
}

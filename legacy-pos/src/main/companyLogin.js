// Legacy-compatible company selection. Memberships are supplied by the server,
// never by a renderer-provided profile or remembered company identifier.
export const MEMBERSHIP_PRODUCTS = ['lodge-camp', 'hotel', 'hospitality-pos'];

/** @param {unknown} value @param {string} lodgeId @param {string|null} legacyOwner */
export function scopeCompanyRows(value, lodgeId, legacyOwner) {
  return Array.isArray(value) ? value.filter((row) => row && (row.lodge_id === lodgeId || (!row.lodge_id && legacyOwner === lodgeId))) : [];
}

/** @param {unknown} previous @param {unknown[]} rows @param {string} lodgeId @param {string|null} legacyOwner */
export function mergeCompanyRows(previous, rows, lodgeId, legacyOwner) {
  const foreign = Array.isArray(previous) ? previous.filter((row) => row && (row.lodge_id || legacyOwner) !== lodgeId) : [];
  const own = rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid company cache row.');
    const record = /** @type {Record<string,unknown>} */ (row);
    if (record.lodge_id && record.lodge_id !== lodgeId) throw new Error('Cannot cache another company’s records.');
    return { ...record, lodge_id: lodgeId };
  });
  return [...foreign, ...own];
}

/** @typedef {{lodge_id:string,lodge_display_name:string,property_type?:string,product_family?:string,role?:string}} CompanyMembership */
/**
 * @param {{rpc:(name:string,args:{p_product_id:string})=>PromiseLike<{data:unknown,error?:unknown}>}} client
 * @param {(value:unknown)=>string|null} normalizeId
 * @returns {Promise<CompanyMembership[]>}
 */
export async function listLegacyCompanies(client, normalizeId) {
  /** @type {Map<string,CompanyMembership>} */
  const companies = new Map();
  for (const product of MEMBERSHIP_PRODUCTS) {
    const { data, error } = await client.rpc('list_desktop_product_memberships', { p_product_id: product });
    if (error) throw new Error('Company sign-in is unavailable. Check the connection or contact your administrator.');
    if (!Array.isArray(data)) throw new Error('The company membership response is invalid. Please try again.');
    for (const row of data) {
      const id = normalizeId(row?.lodge_id);
      if (!id) throw new Error('The company membership response contains an invalid company.');
      companies.set(id, {
        lodge_id: id,
        lodge_display_name: String(row.lodge_display_name || 'Unnamed company'),
        property_type: String(row.property_type || ''),
        product_family: String(row.product_family || product),
        role: String(row.role || '')
      });
    }
  }
  return [...companies.values()].sort((a, b) => a.lodge_display_name.localeCompare(b.lodge_display_name));
}

/**
 * @param {CompanyMembership[]} companies
 * @param {unknown} requestedId
 * @param {(value:unknown)=>string|null} normalizeId
 */
export function selectLegacyCompany(companies, requestedId, normalizeId) {
  const id = requestedId == null || requestedId === '' ? null : normalizeId(requestedId);
  if (requestedId && !id) throw new Error('Select a valid company.');
  if (id && !companies.some((company) => company.lodge_id === id)) {
    throw new Error('This account does not have access to the selected company. Sign in again.');
  }
  if (!companies.length) throw new Error('This account has no company memberships. Ask an administrator to link your staff profile.');
  if (!id && companies.length > 1) return { code: 'company_selection_required', memberships: companies };
  return { lodgeId: id || companies[0].lodge_id };
}

/** @typedef {{createdAt:string,email:string,lodge_id:string,lodge_name?:string,role?:string,offline_password_hash:string,[key:string]:unknown}} TrustedCompanySession */
/**
 * @param {TrustedCompanySession[]} sessions
 * @param {string} email
 * @param {string} password
 * @param {string|null} lodgeId
 * @param {(password:string,hash:string)=>boolean} verify
 * @param {number} [now]
 */
export function selectTrustedCompany(sessions, email, password, lodgeId, verify, now = Date.now()) {
  const matching = sessions.filter((session) => {
    const created = Date.parse(session.createdAt);
    return Number.isFinite(created) && created <= now && now - created <= 14 * 86400000
      && String(session.email || '').trim().toLowerCase() === String(email || '').trim().toLowerCase();
  });
  if (!matching.length) return { code: 'no_session', user: null };
  if (!password) return { code: 'password_required', user: null };
  const verified = matching.filter((session) => verify(password, session.offline_password_hash));
  if (!verified.length) return { code: 'wrong_password', user: null };
  const companies = [...new Map(verified.filter((s) => s.lodge_id).map((s) => [s.lodge_id, {
    lodge_id: s.lodge_id, lodge_display_name: s.lodge_name || 'Saved company', role: s.role
  }])).values()];
  if (lodgeId && !companies.some((company) => company.lodge_id === lodgeId)) {
    return { code: 'no_session', user: null };
  }
  if (!lodgeId && companies.length > 1) return { code: 'company_selection_required', memberships: companies, user: null };
  const session = verified.find((s) => s.lodge_id === (lodgeId || companies[0]?.lodge_id));
  return session ? { code: 'ok', session } : { code: 'no_session', user: null };
}

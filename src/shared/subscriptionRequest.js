// @ts-check
export const SUBSCRIPTION_REQUEST_STATUS = {
  draft: 'draft',
  submitted: 'submitted',
  quoted: 'quoted',
  invoice_sent: 'invoice_sent',
  payment_under_review: 'payment_under_review',
  approved: 'approved',
  activated: 'activated',
  rejected: 'rejected',
  expired: 'expired'
};

export const SUBSCRIPTION_REQUEST_TYPES = {
  new_subscription: 'new_subscription',
  plan_upgrade: 'plan_upgrade',
  addon_request: 'addon_request',
  capacity_pack: 'capacity_pack'
};

/** @type {Set<string>} */
const VALID_PLAN_NAMES = new Set(['Starter', 'Standard', 'Pro', 'Enterprise']);
/** @type {Set<string>} */
const VALID_REQUEST_TYPES = new Set(Object.values(SUBSCRIPTION_REQUEST_TYPES));
/** @type {Set<string>} */
const VALID_STATUSES = new Set(Object.values(SUBSCRIPTION_REQUEST_STATUS));
/** @type {Set<string>} */
const VALID_SOURCES = new Set(['desktop_app', 'public_website', 'admin', 'support']);
/** @type {Set<string>} */
const VALID_PROPERTY_TYPES = new Set(['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant']);

function createRequestId() {
  const cryptoApi = /** @type {{crypto?: {randomUUID?: () => string}}} */ (globalThis)?.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `req_${timestamp}`;
}

/** @param {unknown} plan */
export function normalizePlanName(plan) {
  const raw = String(plan || '').trim();
  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return VALID_PLAN_NAMES.has(capitalized) ? capitalized : 'Starter';
}

/** @param {unknown} type */
export function normalizeRequestType(type) {
  const raw = String(type || '').trim().toLowerCase();
  return VALID_REQUEST_TYPES.has(raw) ? raw : 'plan_upgrade';
}

/** @param {unknown} status */
export function normalizeRequestStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  return VALID_STATUSES.has(raw) ? raw : 'draft';
}

/** @param {unknown} source */
export function normalizeSource(source) {
  const raw = String(source || '').trim().toLowerCase();
  return VALID_SOURCES.has(raw) ? raw : 'desktop_app';
}

/** @param {unknown} pt */
export function normalizePropertyType(pt) {
  const raw = String(pt || '').trim().toLowerCase();
  return VALID_PROPERTY_TYPES.has(raw) ? raw : 'lodge';
}

/** @param {unknown} input */
export function validateSubscriptionRequest(input) {
  const errors = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Request must be an object'] };
  }
  // This is a field projection only; validation below remains the existing set of checks.
  const fields = /** @type {Record<string, unknown>} */ (input)

  const source = normalizeSource(fields.source);
  if (!VALID_SOURCES.has(source)) {
    errors.push(`Invalid source: ${fields.source}`);
  }

  const requestType = normalizeRequestType(fields.request_type);
  if (!VALID_REQUEST_TYPES.has(requestType)) {
    errors.push(`Invalid request_type: ${fields.request_type}`);
  }

  if (fields.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields.contact_email))) {
    errors.push('Invalid contact_email format');
  }

  if (fields.room_count !== null && fields.room_count !== undefined && fields.room_count !== '') {
    const n = Number(fields.room_count);
    if (!Number.isFinite(n) || n < 0) {
      errors.push('room_count must be a non-negative number');
    }
  }

  if (fields.user_count !== null && fields.user_count !== undefined && fields.user_count !== '') {
    const n = Number(fields.user_count);
    if (!Number.isFinite(n) || n < 0) {
      errors.push('user_count must be a non-negative number');
    }
  }

  if (fields.expected_monthly_bookings !== null && fields.expected_monthly_bookings !== undefined && fields.expected_monthly_bookings !== '') {
    const n = Number(fields.expected_monthly_bookings);
    if (!Number.isFinite(n) || n < 0) {
      errors.push('expected_monthly_bookings must be a non-negative number');
    }
  }

  const plan = normalizePlanName(fields.requested_plan);
  if (!VALID_PLAN_NAMES.has(plan)) {
    errors.push(`Invalid requested_plan: ${fields.requested_plan}`);
  }

  return { valid: errors.length === 0, errors };
}

/** @param {unknown} input */
export function normalizeSubscriptionRequest(input) {
  if (!input || typeof input !== 'object') return buildSubscriptionRequest();
  const fields = /** @type {Record<string, unknown>} */ (input)

  return {
    ...buildSubscriptionRequest(),
    ...fields,
    id: fields.id || createRequestId(),
    source: normalizeSource(fields.source),
    request_type: normalizeRequestType(fields.request_type),
    property_type: normalizePropertyType(fields.property_type),
    product_id: fields.product_id || null,
    requested_plan: normalizePlanName(fields.requested_plan),
    current_plan: fields.current_plan ? normalizePlanName(fields.current_plan) : null,
    requested_addons: Array.isArray(fields.requested_addons) ? fields.requested_addons : [],
    room_count: fields.room_count ? Number(fields.room_count) : null,
    user_count: fields.user_count ? Number(fields.user_count) : null,
    expected_monthly_bookings: fields.expected_monthly_bookings ? Number(fields.expected_monthly_bookings) : null,
    pricing_snapshot: fields.pricing_snapshot || null,
    quote_number: fields.quote_number || null,
    quote_pdf_path_or_url: fields.quote_pdf_path_or_url || null,
    notes: fields.notes || '',
    status: normalizeRequestStatus(fields.status),
    submitted_at: fields.submitted_at || new Date().toISOString()
  };
}

/** @param {Record<string, unknown>} [options] */
export function buildSubscriptionRequest({
  source = 'desktop_app',
  request_type = 'plan_upgrade',
  lodge_id = null,
  existing_license_id = null,
  company_name = '',
  property_name = '',
  contact_name = '',
  contact_email = '',
  contact_phone = '',
  country = '',
  property_type = 'lodge',
  operating_profile = null,
  product_id = null,
  commercial_package_key = null,
  current_plan = null,
  requested_plan = 'Starter',
  requested_addons = [],
  room_count = null,
  user_count = null,
  expected_monthly_bookings = null,
  pricing_snapshot = null,
  notes = ''
} = {}) {
  return {
    id: createRequestId(),
    source: normalizeSource(source),
    request_type: normalizeRequestType(request_type),
    lodge_id,
    existing_license_id,
    company_name: String(company_name || ''),
    property_name: String(property_name || ''),
    contact_name: String(contact_name || ''),
    contact_email: String(contact_email || ''),
    contact_phone: String(contact_phone || ''),
    country: String(country || ''),
    property_type: normalizePropertyType(property_type),
    operating_profile: operating_profile || null,
    product_id: product_id || null,
    commercial_package_key: commercial_package_key || null,
    current_plan: current_plan ? normalizePlanName(current_plan) : null,
    requested_plan: normalizePlanName(requested_plan),
    requested_addons: Array.isArray(requested_addons) ? requested_addons : [],
    room_count: room_count ? Number(room_count) : null,
    user_count: user_count ? Number(user_count) : null,
    expected_monthly_bookings: expected_monthly_bookings ? Number(expected_monthly_bookings) : null,
    pricing_snapshot: pricing_snapshot || null,
    quote_number: null,
    quote_pdf_path_or_url: null,
    notes: notes || '',
    status: SUBSCRIPTION_REQUEST_STATUS.draft,
    submitted_at: new Date().toISOString()
  };
}

/** @param {Record<string, unknown>} [options] */
export function buildActivationPayload({
  license_id,
  lodge_id,
  plan,
  enterprise_addons = [],
  effective_features = {},
  activated_by = 'admin',
  activation_reason = '',
  related_request_id = null,
  related_invoice_id = null
} = {}) {
  if (!license_id || !lodge_id || !plan) {
    throw new Error('license_id, lodge_id, and plan are required for activation');
  }
  return {
    license_id,
    lodge_id,
    plan: normalizePlanName(plan),
    enterprise_addons: Array.isArray(enterprise_addons) ? enterprise_addons : [],
    effective_features: effective_features || {},
    activated_by,
    activation_reason,
    related_request_id,
    related_invoice_id,
    activated_at: new Date().toISOString()
  };
}

/** @param {Date} [date] */
export function generateQuoteNumber(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const seq = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
    String(date.getSeconds()).padStart(2, '0'),
    String(date.getMilliseconds()).padStart(3, '0')
  ].join('');
  return `QT-${year}${month}${day}-${seq}`;
}

export { buildCommercialPricingSnapshot as buildPricingSnapshot } from './commercialPackages.js'

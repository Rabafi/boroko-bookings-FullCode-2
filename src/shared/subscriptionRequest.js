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

const VALID_PLAN_NAMES = new Set(['Starter', 'Standard', 'Pro', 'Enterprise']);
const VALID_REQUEST_TYPES = new Set(Object.values(SUBSCRIPTION_REQUEST_TYPES));
const VALID_STATUSES = new Set(Object.values(SUBSCRIPTION_REQUEST_STATUS));
const VALID_SOURCES = new Set(['desktop_app', 'public_website', 'admin', 'support']);
const VALID_PROPERTY_TYPES = new Set(['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort', 'restaurant']);

function createRequestId() {
  const cryptoApi = globalThis?.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `req_${timestamp}`;
}

export function normalizePlanName(plan) {
  const raw = String(plan || '').trim();
  const capitalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  return VALID_PLAN_NAMES.has(capitalized) ? capitalized : 'Starter';
}

export function normalizeRequestType(type) {
  const raw = String(type || '').trim().toLowerCase();
  return VALID_REQUEST_TYPES.has(raw) ? raw : 'plan_upgrade';
}

export function normalizeRequestStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  return VALID_STATUSES.has(raw) ? raw : 'draft';
}

export function normalizeSource(source) {
  const raw = String(source || '').trim().toLowerCase();
  return VALID_SOURCES.has(raw) ? raw : 'desktop_app';
}

export function normalizePropertyType(pt) {
  const raw = String(pt || '').trim().toLowerCase();
  return VALID_PROPERTY_TYPES.has(raw) ? raw : 'lodge';
}

export function validateSubscriptionRequest(input) {
  const errors = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: ['Request must be an object'] };
  }

  const source = normalizeSource(input.source);
  if (!VALID_SOURCES.has(source)) {
    errors.push(`Invalid source: ${input.source}`);
  }

  const requestType = normalizeRequestType(input.request_type);
  if (!VALID_REQUEST_TYPES.has(requestType)) {
    errors.push(`Invalid request_type: ${input.request_type}`);
  }

  if (input.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(input.contact_email))) {
    errors.push('Invalid contact_email format');
  }

  if (input.room_count !== null && input.room_count !== undefined && input.room_count !== '') {
    const n = Number(input.room_count);
    if (!Number.isFinite(n) || n < 0) {
      errors.push('room_count must be a non-negative number');
    }
  }

  if (input.user_count !== null && input.user_count !== undefined && input.user_count !== '') {
    const n = Number(input.user_count);
    if (!Number.isFinite(n) || n < 0) {
      errors.push('user_count must be a non-negative number');
    }
  }

  if (input.expected_monthly_bookings !== null && input.expected_monthly_bookings !== undefined && input.expected_monthly_bookings !== '') {
    const n = Number(input.expected_monthly_bookings);
    if (!Number.isFinite(n) || n < 0) {
      errors.push('expected_monthly_bookings must be a non-negative number');
    }
  }

  const plan = normalizePlanName(input.requested_plan);
  if (!VALID_PLAN_NAMES.has(plan)) {
    errors.push(`Invalid requested_plan: ${input.requested_plan}`);
  }

  return { valid: errors.length === 0, errors };
}

export function normalizeSubscriptionRequest(input) {
  if (!input || typeof input !== 'object') return buildSubscriptionRequest();

  return {
    ...buildSubscriptionRequest(),
    ...input,
    id: input.id || createRequestId(),
    source: normalizeSource(input.source),
    request_type: normalizeRequestType(input.request_type),
    property_type: normalizePropertyType(input.property_type),
    product_id: input.product_id || null,
    requested_plan: normalizePlanName(input.requested_plan),
    current_plan: input.current_plan ? normalizePlanName(input.current_plan) : null,
    requested_addons: Array.isArray(input.requested_addons) ? input.requested_addons : [],
    room_count: input.room_count ? Number(input.room_count) : null,
    user_count: input.user_count ? Number(input.user_count) : null,
    expected_monthly_bookings: input.expected_monthly_bookings ? Number(input.expected_monthly_bookings) : null,
    pricing_snapshot: input.pricing_snapshot || null,
    quote_number: input.quote_number || null,
    quote_pdf_path_or_url: input.quote_pdf_path_or_url || null,
    notes: input.notes || '',
    status: normalizeRequestStatus(input.status),
    submitted_at: input.submitted_at || new Date().toISOString()
  };
}

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

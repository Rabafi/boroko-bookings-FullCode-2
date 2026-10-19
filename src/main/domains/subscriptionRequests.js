// @ts-check
import { randomUUID } from 'crypto';
import { state } from '../state.js';
import { logActivity, dedupePromise, requireAdmin, refreshCache } from './infrastructure.js';
import { normalizePlanName } from './subscriptionState.js';
import { logAdminActivity } from './admin.js';
import { buildSubscriptionCommercialDocument } from '../../shared/commercialPackages.js';

const DOCUMENT_STATUS = {
  quote: 'quoted',
  invoice: 'invoice_sent'
};

/** @typedef {Record<string, unknown>} SubscriptionRequestView */

/** @param {unknown} row */
function normalizeRow(row) {
  if (!row) return null;
  // RPC data remains unvalidated; this view preserves the existing property reads and spread.
  const rowView = /** @type {SubscriptionRequestView} */ (row)
  return {
    ...rowView,
    requested_addons: Array.isArray(rowView.requested_addons) ? rowView.requested_addons : [],
    product_id: rowView.product_id || null,
    commercial_package_key: rowView.commercial_package_key || null,
    operating_profile: rowView.operating_profile || null,
    commercial_catalog_version: rowView.commercial_catalog_version || null,
    canonical_pricing_snapshot: rowView.canonical_pricing_snapshot || null,
    pricing_snapshot: rowView.pricing_snapshot || null,
    quote_payload: rowView.quote_payload || null,
    invoice_payload: rowView.invoice_payload || null,
    activation_payload: rowView.activation_payload || null
  };
}

/** @param {string} prefix */
function generateDocumentNumber(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${prefix}-${stamp}`;
}

/** @param {SubscriptionRequestView} request @param {unknown} type @param {SubscriptionRequestView} [input] */
function buildCommercialDocumentPayload(request, type, input = {}) {
  const documentType = type === 'invoice' ? 'invoice' : 'quote';
  return buildSubscriptionCommercialDocument(request, documentType, {
    ...input,
    document_number: input.document_number || generateDocumentNumber(documentType === 'invoice' ? 'PF' : 'QT')
  });
}

/** @param {unknown} request */
async function _submitSubscriptionRequest(request) {
  if (!state.supabase) throw new Error('Database not connected');
  const requestView = /** @type {SubscriptionRequestView} */ (request)

  if (requestView?.product_id && requestView?.commercial_package_key) {
    const customer = {
      company_name: requestView.company_name || '',
      property_name: requestView.property_name || '',
      contact_name: requestView.contact_name || '',
      contact_email: requestView.contact_email || '',
      contact_phone: requestView.contact_phone || '',
      country: requestView.country || '',
      notes: requestView.notes || ''
    };
    const selection = {
      product_id: requestView.product_id,
      commercial_package_key: requestView.commercial_package_key,
      selected_addon_keys: Array.isArray(requestView.requested_addons) ? requestView.requested_addons : [],
      operating_profile: requestView.operating_profile || null,
      property_type: requestView.property_type || null,
      lodge_id: requestView.lodge_id || null,
      current_plan: requestView.current_plan || null,
      customer
    };
    const { data, error } = await state.supabase.rpc('submit_authenticated_commercial_quote_request', {
      p_selection: selection,
    });
    if (error) throw new Error(error.message);
    if (data?.success === false) throw new Error(data.error || 'Failed to submit commercial quote');
    logActivity('subscription_request_submitted', `Commercial quote submitted: ${requestView.commercial_package_key}`);
    return data;
  }

  const { data, error } = await state.supabase.rpc('submit_subscription_request', {
    p_source: requestView.source || 'desktop_app',
    p_request_type: requestView.request_type || 'plan_upgrade',
    p_lodge_id: requestView.lodge_id || null,
    p_existing_license_id: requestView.existing_license_id || null,
    p_company_name: requestView.company_name || '',
    p_property_name: requestView.property_name || '',
    p_contact_name: requestView.contact_name || '',
    p_contact_email: requestView.contact_email || '',
    p_contact_phone: requestView.contact_phone || '',
    p_country: requestView.country || '',
    p_property_type: requestView.property_type || 'lodge',
    p_current_plan: requestView.current_plan || null,
    p_requested_plan: requestView.requested_plan || 'Starter',
    p_requested_addons: Array.isArray(requestView.requested_addons) ? requestView.requested_addons : [],
    p_room_count: requestView.room_count || null,
    p_user_count: requestView.user_count || null,
    p_expected_monthly_bookings: requestView.expected_monthly_bookings || null,
    p_pricing_snapshot: requestView.pricing_snapshot || null,
    p_quote_number: requestView.quote_number || null,
    p_notes: requestView.notes || ''
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Failed to submit request');

  logActivity('subscription_request_submitted', `Subscription request submitted: ${requestView.requested_plan}`);
  return data;
}

/** @param {unknown} [status] @param {number} [limit] @param {number} [offset] */
async function _getSubscriptionRequests(status = null, limit = 50, offset = 0) {
  const db = requireAdmin();

  const { data, error } = await db.rpc('get_subscription_requests', {
    p_status: status || null,
    p_limit: limit,
    p_offset: offset
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Failed to load requests');

  const rows = Array.isArray(data?.rows) ? data.rows.map(normalizeRow) : [];
  return { rows, total: data?.total || 0 };
}

/** @param {unknown} requestId */
async function _getSubscriptionRequestById(requestId) {
  const db = requireAdmin();

  const { data, error } = await db.rpc('get_subscription_request_by_id', {
    p_request_id: requestId
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Request not found');

  return normalizeRow(data?.request);
}

/** @param {unknown} requestId @param {unknown} status @param {unknown} [reviewedBy] @param {unknown} [rejectionReason] */
async function _updateSubscriptionRequestStatus(requestId, status, reviewedBy = null, rejectionReason = null) {
  const db = requireAdmin();

  const { data, error } = await db.rpc('update_subscription_request_status', {
    p_request_id: requestId,
    p_status: status,
    p_reviewed_by: reviewedBy || state.currentUser?.email || 'admin',
    p_rejection_reason: rejectionReason || null
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Failed to update status');

  logActivity('subscription_request_status_changed', `Request ${requestId} status changed to ${status}`);
  return data;
}

/** @param {unknown} requestId @param {unknown} [activatedBy] @param {unknown} [activationPayload] */
async function _activateSubscriptionRequest(requestId, activatedBy = 'admin', activationPayload = null) {
  const db = requireAdmin();
  const request = await _getSubscriptionRequestById(requestId);
  if (!request) throw new Error('Request not found');
  const requestView = /** @type {SubscriptionRequestView} */ (request)
  const activationView = /** @type {SubscriptionRequestView} */ (activationPayload)

  const licenseId = activationView?.license_id || requestView.existing_license_id || null;
  const lodgeId = activationView?.lodge_id || requestView.lodge_id || null;
  const plan = normalizePlanName(activationView?.plan || requestView.requested_plan || 'Starter');
  const addons = Array.isArray(activationView?.enterprise_addons)
    ? activationView.enterprise_addons
    : Array.isArray(requestView.requested_addons)
      ? requestView.requested_addons
      : [];
  if (!licenseId || !lodgeId) {
    throw new Error('Link this request to an existing license and lodge before activation.');
  }

  const finalActivationPayload = {
    ...(activationPayload || {}),
    operation_id: activationView?.operation_id || randomUUID(),
    request_id: requestId,
    license_id: licenseId,
    lodge_id: lodgeId,
    plan,
    enterprise_addons: addons,
    product_id: requestView.product_id || null,
    commercial_package_key: requestView.commercial_package_key || null,
    commercial_catalog_version: requestView.commercial_catalog_version || null,
    activation_reason: activationView?.activation_reason || `Governed activation of subscription request ${requestId}`,
    activated_by: activatedBy || state.currentUser?.email || 'admin',
    related_request_id: requestId,
    related_invoice_number: activationView?.related_invoice_number || (/** @type {SubscriptionRequestView | null | undefined} */ (requestView.invoice_payload))?.document_number || null,
    activated_at: new Date().toISOString()
  };

  const { data, error } = await db.rpc('admin_governed_activate_subscription_request', {
    p_payload: finalActivationPayload
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Failed to activate request');

  await logAdminActivity(lodgeId, requestView.property_name || requestView.company_name || null, 'subscription_request_activated', {
    entity_type: 'subscription_package_request',
    entity_id: requestId,
    license_id: licenseId,
    plan,
    enterprise_addons: addons
  });
  await refreshCache('settings').catch(() => null);
  logActivity('subscription_request_activated', `Request ${requestId} activated by ${activatedBy}`);
  return data;
}

/** @param {unknown} requestId @param {unknown} [type] @param {unknown} [documentInput] */
async function _createSubscriptionRequestDocument(requestId, type = 'quote', documentInput = {}) {
  const db = requireAdmin();
  const request = await _getSubscriptionRequestById(requestId);
  if (!request) throw new Error('Request not found');
  const requestView = /** @type {SubscriptionRequestView} */ (request)
  const inputView = /** @type {SubscriptionRequestView} */ (documentInput)

  const documentType = type === 'invoice' ? 'invoice' : 'quote';
  const status = DOCUMENT_STATUS[documentType];
  const payload = /** @type {SubscriptionRequestView} */ (buildCommercialDocumentPayload(requestView, documentType, inputView));
  const updatePatch = documentType === 'invoice'
    ? {
        status,
        invoice_payload: payload,
        reviewed_by: inputView.reviewed_by || state.currentUser?.email || 'admin'
      }
    : {
        status,
        quote_number: payload.document_number,
        quote_payload: payload,
        quote_pdf_path_or_url: inputView.quote_pdf_path_or_url || null,
        reviewed_by: inputView.reviewed_by || state.currentUser?.email || 'admin'
      };

  const { data, error } = await db.rpc('record_subscription_request_document', {
    p_request_id: requestId,
    p_document_type: documentType,
    p_document_payload: payload,
    p_quote_pdf_path_or_url: inputView.quote_pdf_path_or_url || null,
    p_reviewed_by: updatePatch.reviewed_by
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || `Failed to record ${documentType}`);

  logActivity('subscription_request_document_recorded', `${documentType} recorded for request ${requestId}`);
  return { ...data, document: payload };
}

/** @param {unknown} request */
async function _submitPublicSubscriptionRequest(request) {
  if (!state.supabase) throw new Error('Database not connected');
  const requestView = /** @type {SubscriptionRequestView} */ (request)

  if (requestView?.product_id && requestView?.commercial_package_key) {
    const { data, error } = await state.supabase.rpc('submit_public_commercial_quote_request', {
      p_selection: {
        product_id: requestView.product_id,
        commercial_package_key: requestView.commercial_package_key,
        selected_addon_keys: Array.isArray(requestView.requested_addons) ? requestView.requested_addons : [],
        operating_profile: requestView.operating_profile || null,
        property_type: requestView.property_type || null
      },
      p_customer: {
        company_name: requestView.company_name || '',
        property_name: requestView.property_name || '',
        contact_name: requestView.contact_name || '',
        contact_email: requestView.contact_email || '',
        contact_phone: requestView.contact_phone || '',
        country: requestView.country || '',
        notes: requestView.notes || ''
      }
    });
    if (error) throw new Error(error.message);
    if (data?.success === false) throw new Error(data.error || 'Failed to submit commercial quote');
    return data;
  }

  const { data, error } = await state.supabase.rpc('submit_public_subscription_request', {
    p_company_name: requestView.company_name || '',
    p_property_name: requestView.property_name || '',
    p_contact_name: requestView.contact_name || '',
    p_contact_email: requestView.contact_email || '',
    p_contact_phone: requestView.contact_phone || '',
    p_country: requestView.country || '',
    p_property_type: requestView.property_type || 'lodge',
    p_requested_plan: requestView.requested_plan || 'Starter',
    p_requested_addons: Array.isArray(requestView.requested_addons) ? requestView.requested_addons : [],
    p_room_count: requestView.room_count || null,
    p_user_count: requestView.user_count || null,
    p_expected_monthly_bookings: requestView.expected_monthly_bookings || null,
    p_notes: requestView.notes || '',
    p_pricing_snapshot: requestView.pricing_snapshot || null,
    p_quote_payload: requestView.quote_payload || null
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Failed to submit request');

  return data;
}

/** @param {unknown} request */
export function submitSubscriptionRequest(request) {
  const requestView = /** @type {SubscriptionRequestView} */ (request)
  return dedupePromise(`subReq:submit:${requestView?.id || 'new'}`, () => _submitSubscriptionRequest(request));
}

/** @param {unknown} status @param {number | undefined} limit @param {number | undefined} offset */
export function getSubscriptionRequests(status, limit, offset) {
  return dedupePromise(`subReq:list:${status || 'all'}:${limit}:${offset}`, () => _getSubscriptionRequests(status, limit, offset));
}

/** @param {unknown} requestId */
export function getSubscriptionRequestById(requestId) {
  return dedupePromise(`subReq:detail:${requestId}`, () => _getSubscriptionRequestById(requestId));
}

/** @param {unknown} requestId @param {unknown} status @param {unknown} reviewedBy @param {unknown} rejectionReason */
export function updateSubscriptionRequestStatus(requestId, status, reviewedBy, rejectionReason) {
  return dedupePromise(`subReq:update:${requestId}`, () => _updateSubscriptionRequestStatus(requestId, status, reviewedBy, rejectionReason));
}

/** @param {unknown} requestId @param {unknown} activatedBy @param {unknown} activationPayload */
export function activateSubscriptionRequest(requestId, activatedBy, activationPayload) {
  return dedupePromise(`subReq:activate:${requestId}`, () => _activateSubscriptionRequest(requestId, activatedBy, activationPayload));
}

/** @param {unknown} requestId @param {unknown} type @param {unknown} documentInput */
export function createSubscriptionRequestDocument(requestId, type, documentInput) {
  return dedupePromise(`subReq:document:${requestId}:${type}`, () => _createSubscriptionRequestDocument(requestId, type, documentInput));
}

/** @param {unknown} request */
export function submitPublicSubscriptionRequest(request) {
  const requestView = /** @type {SubscriptionRequestView} */ (request)
  return dedupePromise(`subReq:public:${requestView?.contact_email || 'anon'}`, () => _submitPublicSubscriptionRequest(request));
}

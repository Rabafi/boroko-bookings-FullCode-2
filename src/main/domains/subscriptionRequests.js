import { state } from '../state.js';
import { logActivity, dedupePromise, requireAdmin, refreshCache } from './infrastructure.js';
import { normalizePlanName } from './subscriptionState.js';
import { logAdminActivity } from './admin.js';
import { buildSubscriptionCommercialDocument } from '../../shared/commercialPackages.js';

const ADDON_FEATURE_MAP = {
  corporate_accounts: ['corporate_accounts'],
  rate_plans: ['rate_plans'],
  custom_website: ['custom_website'],
  payment_gateway: ['payment_gateway'],
  channel_manager: ['channel_manager'],
  advanced_housekeeping_mobile: ['advanced_housekeeping'],
  guest_portal: ['guest_portal'],
  multi_property: ['multi_property'],
  advanced_rates: ['advanced_rates'],
  linen_laundry: ['linen_laundry'],
  lost_found: ['lost_found'],
  incident_log: ['incident_log'],
  visitor_register: ['visitor_register'],
  emergency_list: ['emergency_list'],
  multi_outlet_pos: ['multi_outlet_pos']
};

const DOCUMENT_STATUS = {
  quote: 'quoted',
  invoice: 'invoice_sent'
};

function normalizeRow(row) {
  if (!row) return null;
  return {
    ...row,
    requested_addons: Array.isArray(row.requested_addons) ? row.requested_addons : [],
    pricing_snapshot: row.pricing_snapshot || null,
    quote_payload: row.quote_payload || null,
    invoice_payload: row.invoice_payload || null,
    activation_payload: row.activation_payload || null
  };
}

function generateDocumentNumber(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${prefix}-${stamp}`;
}

function buildCommercialDocumentPayload(request, type, input = {}) {
  const documentType = type === 'invoice' ? 'invoice' : 'quote';
  return buildSubscriptionCommercialDocument(request, documentType, {
    ...input,
    document_number: input.document_number || generateDocumentNumber(documentType === 'invoice' ? 'PF' : 'QT')
  });
}

async function _submitSubscriptionRequest(request) {
  if (!state.supabase) throw new Error('Database not connected');

  const { data, error } = await state.supabase.rpc('submit_subscription_request', {
    p_source: request.source || 'desktop_app',
    p_request_type: request.request_type || 'plan_upgrade',
    p_lodge_id: request.lodge_id || null,
    p_existing_license_id: request.existing_license_id || null,
    p_company_name: request.company_name || '',
    p_property_name: request.property_name || '',
    p_contact_name: request.contact_name || '',
    p_contact_email: request.contact_email || '',
    p_contact_phone: request.contact_phone || '',
    p_country: request.country || '',
    p_property_type: request.property_type || 'lodge',
    p_current_plan: request.current_plan || null,
    p_requested_plan: request.requested_plan || 'Starter',
    p_requested_addons: Array.isArray(request.requested_addons) ? request.requested_addons : [],
    p_room_count: request.room_count || null,
    p_user_count: request.user_count || null,
    p_expected_monthly_bookings: request.expected_monthly_bookings || null,
    p_pricing_snapshot: request.pricing_snapshot || null,
    p_quote_number: request.quote_number || null,
    p_notes: request.notes || ''
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Failed to submit request');

  logActivity('subscription_request_submitted', `Subscription request submitted: ${request.requested_plan}`);
  return data;
}

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

async function _getSubscriptionRequestById(requestId) {
  const db = requireAdmin();

  const { data, error } = await db.rpc('get_subscription_request_by_id', {
    p_request_id: requestId
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Request not found');

  return normalizeRow(data?.request);
}

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

async function _activateSubscriptionRequest(requestId, activatedBy = 'admin', activationPayload = null) {
  const db = requireAdmin();
  const request = await _getSubscriptionRequestById(requestId);
  if (!request) throw new Error('Request not found');

  const licenseId = activationPayload?.license_id || request.existing_license_id || null;
  const lodgeId = activationPayload?.lodge_id || request.lodge_id || null;
  const plan = normalizePlanName(activationPayload?.plan || request.requested_plan || 'Starter');
  const addons = Array.isArray(activationPayload?.enterprise_addons)
    ? activationPayload.enterprise_addons
    : Array.isArray(request.requested_addons)
      ? request.requested_addons
      : [];

  if (!licenseId || !lodgeId) {
    throw new Error('Link this request to an existing license and lodge before activation.');
  }

  const updatePayload = {
    subscription_plan: plan,
    payment_status: activationPayload?.payment_status || 'active',
    notes: [
      activationPayload?.notes || '',
      `Activated from subscription request ${requestId} by ${activatedBy || state.currentUser?.email || 'admin'}.`
    ].filter(Boolean).join('\n')
  };

  try {
    const { data: updateResult, error: updateError } = await db.rpc('update_subscription_contract', {
      p_license_id: licenseId,
      p_payload: updatePayload
    });
    if (updateError) throw updateError;
    if (updateResult?.success === false) throw new Error(updateResult.error || 'Could not update subscription contract');
  } catch (error) {
    const { error: fallbackError } = await db.from('licenses').update(updatePayload).eq('id', licenseId);
    if (fallbackError) throw new Error(fallbackError.message || error.message);
  }

  const enabledFeatures = new Set();
  for (const addon of addons) {
    for (const feature of ADDON_FEATURE_MAP[addon] || []) enabledFeatures.add(feature);
  }

  for (const feature of enabledFeatures) {
    const { error } = await db.from('lodge_features').upsert({
      lodge_id: lodgeId,
      feature_name: feature,
      enabled: true,
      reason: `Activated from subscription request ${requestId}`,
      granted_by: state.currentUser?.id || null,
      granted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'lodge_id,feature_name' });
    if (error) throw new Error(error.message);
  }

  const finalActivationPayload = {
    ...(activationPayload || {}),
    license_id: licenseId,
    lodge_id: lodgeId,
    plan,
    enterprise_addons: addons,
    effective_features: Object.fromEntries([...enabledFeatures].map((feature) => [feature, true])),
    activated_by: activatedBy || state.currentUser?.email || 'admin',
    related_request_id: requestId,
    related_invoice_number: activationPayload?.related_invoice_number || request.invoice_payload?.document_number || null,
    activated_at: new Date().toISOString()
  };

  const { data, error } = await db.rpc('activate_subscription_request', {
    p_request_id: requestId,
    p_activated_by: activatedBy || state.currentUser?.email || 'admin',
    p_activation_payload: finalActivationPayload
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Failed to activate request');

  await logAdminActivity(lodgeId, request.property_name || request.company_name || null, 'subscription_request_activated', {
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

async function _createSubscriptionRequestDocument(requestId, type = 'quote', documentInput = {}) {
  const db = requireAdmin();
  const request = await _getSubscriptionRequestById(requestId);
  if (!request) throw new Error('Request not found');

  const documentType = type === 'invoice' ? 'invoice' : 'quote';
  const status = DOCUMENT_STATUS[documentType];
  const payload = buildCommercialDocumentPayload(request, documentType, documentInput);
  const updatePatch = documentType === 'invoice'
    ? {
        status,
        invoice_payload: payload,
        reviewed_by: documentInput.reviewed_by || state.currentUser?.email || 'admin'
      }
    : {
        status,
        quote_number: payload.document_number,
        quote_payload: payload,
        quote_pdf_path_or_url: documentInput.quote_pdf_path_or_url || null,
        reviewed_by: documentInput.reviewed_by || state.currentUser?.email || 'admin'
      };

  const { data, error } = await db.rpc('record_subscription_request_document', {
    p_request_id: requestId,
    p_document_type: documentType,
    p_document_payload: payload,
    p_quote_pdf_path_or_url: documentInput.quote_pdf_path_or_url || null,
    p_reviewed_by: updatePatch.reviewed_by
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || `Failed to record ${documentType}`);

  logActivity('subscription_request_document_recorded', `${documentType} recorded for request ${requestId}`);
  return { ...data, document: payload };
}

async function _submitPublicSubscriptionRequest(request) {
  if (!state.supabase) throw new Error('Database not connected');

  const { data, error } = await state.supabase.rpc('submit_public_subscription_request', {
    p_company_name: request.company_name || '',
    p_property_name: request.property_name || '',
    p_contact_name: request.contact_name || '',
    p_contact_email: request.contact_email || '',
    p_contact_phone: request.contact_phone || '',
    p_country: request.country || '',
    p_property_type: request.property_type || 'lodge',
    p_requested_plan: request.requested_plan || 'Starter',
    p_requested_addons: Array.isArray(request.requested_addons) ? request.requested_addons : [],
    p_room_count: request.room_count || null,
    p_user_count: request.user_count || null,
    p_expected_monthly_bookings: request.expected_monthly_bookings || null,
    p_notes: request.notes || '',
    p_pricing_snapshot: request.pricing_snapshot || null,
    p_quote_payload: request.quote_payload || null
  });

  if (error) throw new Error(error.message);
  if (data?.success === false) throw new Error(data.error || 'Failed to submit request');

  return data;
}

export function submitSubscriptionRequest(request) {
  return dedupePromise(`subReq:submit:${request?.id || 'new'}`, () => _submitSubscriptionRequest(request));
}

export function getSubscriptionRequests(status, limit, offset) {
  return dedupePromise(`subReq:list:${status || 'all'}:${limit}:${offset}`, () => _getSubscriptionRequests(status, limit, offset));
}

export function getSubscriptionRequestById(requestId) {
  return dedupePromise(`subReq:detail:${requestId}`, () => _getSubscriptionRequestById(requestId));
}

export function updateSubscriptionRequestStatus(requestId, status, reviewedBy, rejectionReason) {
  return dedupePromise(`subReq:update:${requestId}`, () => _updateSubscriptionRequestStatus(requestId, status, reviewedBy, rejectionReason));
}

export function activateSubscriptionRequest(requestId, activatedBy, activationPayload) {
  return dedupePromise(`subReq:activate:${requestId}`, () => _activateSubscriptionRequest(requestId, activatedBy, activationPayload));
}

export function createSubscriptionRequestDocument(requestId, type, documentInput) {
  return dedupePromise(`subReq:document:${requestId}:${type}`, () => _createSubscriptionRequestDocument(requestId, type, documentInput));
}

export function submitPublicSubscriptionRequest(request) {
  return dedupePromise(`subReq:public:${request?.contact_email || 'anon'}`, () => _submitPublicSubscriptionRequest(request));
}

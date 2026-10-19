// @ts-check
/** @type {Readonly<Record<string, string>>} */
const ACTIVITY_LABELS = {
  pool: 'Pool access',
  facility: 'Facility chill',
  braai: 'Braai / barbecue',
  mixed: 'Mixed day use'
};
/** @type {Readonly<Record<string, string>>} */
const STATUS_LABELS = {
  reserved: 'Reserved',
  checked_in: 'Checked in',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

/** @param {unknown} [entry] */
export function getDayUseActivityLabel(entry = {}) {
  const fields = recordFields(entry)
  const explicitLabel = ACTIVITY_LABELS[String(fields.activity_type || '').trim().toLowerCase()];
  if (explicitLabel) return explicitLabel;
  return fields.includes_pool === false ? 'Day use' : 'Pool access';
}

/** @param {unknown} [entry] */
export function getDayUseAccessSummary(entry = {}) {
  const fields = recordFields(entry)
  const labels = [];
  if (fields.includes_pool !== false) labels.push('Pool');
  if (fields.includes_facility_access === true) labels.push('Facility');
  if (fields.includes_braai === true) labels.push('Braai');
  return labels.length > 0 ? labels.join(', ') : getDayUseActivityLabel(entry);
}

/** @param {unknown} [extras] */
export function summarizeDayUseExtras(extras = []) {
  const rows = (/** @type {unknown[]} */ (Array.isArray(extras) ? extras : []))
    .map((extra) => {
      const fields = recordFields(extra)
      const name = String(fields.name || '').trim();
      const quantity = Number(fields.quantity || 0);
      if (!name || quantity <= 0) return '';
      return `${name} x${quantity}`;
    })
    .filter(Boolean);
  return rows.join(', ');
}

/** @param {unknown} [value] */
export function formatDayUseStatus(value = '') {
  return STATUS_LABELS[String(value || '').trim().toLowerCase()] || 'Checked in';
}

/** @param {unknown} [entry] */
export function normalizeDayUseReportRow(entry = {}) {
  const fields = recordFields(entry)
  const guest = fields.guest_name || fields.customer_name || fields.walk_in_name || 'Walk-in';
  const extras = Array.isArray(fields.extras) ? fields.extras : [];
  return {
    date: fields.date || String(fields.created_at || '').slice(0, 10) || '',
    guest,
    activityType: String(fields.activity_type || 'pool'),
    activityLabel: getDayUseActivityLabel(entry),
    accessSummary: getDayUseAccessSummary(entry),
    adults: Number(fields.adults || 0),
    children: Number(fields.children || 0),
    templateName: fields.template_name || '',
    status: String(fields.status || 'checked_in'),
    statusLabel: formatDayUseStatus(fields.status),
    startTime: fields.start_time || '',
    endTime: fields.end_time || '',
    durationHours: Number(fields.duration_hours || 0),
    pricingMode: String(fields.pricing_mode || 'per_person'),
    packageName: fields.package_name || '',
    extrasSummary: summarizeDayUseExtras(extras),
    extrasTotal: Number(fields.extras_total || 0),
    depositAmount: Number(fields.deposit_amount || 0),
    balanceDue: Number(fields.balance_due || 0),
    resourceName: fields.resource_name || '',
    resourceType: fields.resource_type || '',
    serviceNotes: fields.service_notes || '',
    total: Number(fields.total || fields.total_amount || fields.amount || 0),
    paymentMethod: fields.payment_method || '',
    notes: fields.notes || ''
  };
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function recordFields(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? /** @type {Record<string, unknown>} */ (value)
    : {}
}

const ACTIVITY_LABELS = {
  pool: 'Pool access',
  facility: 'Facility chill',
  braai: 'Braai / barbecue',
  mixed: 'Mixed day use'
};
const STATUS_LABELS = {
  reserved: 'Reserved',
  checked_in: 'Checked in',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled'
};

export function getDayUseActivityLabel(entry = {}) {
  const explicitLabel = ACTIVITY_LABELS[String(entry?.activity_type || '').trim().toLowerCase()];
  if (explicitLabel) return explicitLabel;
  return entry?.includes_pool === false ? 'Day use' : 'Pool access';
}

export function getDayUseAccessSummary(entry = {}) {
  const labels = [];
  if (entry?.includes_pool !== false) labels.push('Pool');
  if (entry?.includes_facility_access === true) labels.push('Facility');
  if (entry?.includes_braai === true) labels.push('Braai');
  return labels.length > 0 ? labels.join(', ') : getDayUseActivityLabel(entry);
}

export function summarizeDayUseExtras(extras = []) {
  const rows = (Array.isArray(extras) ? extras : [])
    .map((extra) => {
      const name = String(extra?.name || '').trim();
      const quantity = Number(extra?.quantity || 0);
      if (!name || quantity <= 0) return '';
      return `${name} x${quantity}`;
    })
    .filter(Boolean);
  return rows.join(', ');
}

export function formatDayUseStatus(value = '') {
  return STATUS_LABELS[String(value || '').trim().toLowerCase()] || 'Checked in';
}

export function normalizeDayUseReportRow(entry = {}) {
  const guest = entry.guest_name || entry.customer_name || entry.walk_in_name || 'Walk-in';
  const extras = Array.isArray(entry.extras) ? entry.extras : [];
  return {
    date: entry.date || String(entry.created_at || '').slice(0, 10) || '',
    guest,
    activityType: String(entry.activity_type || 'pool'),
    activityLabel: getDayUseActivityLabel(entry),
    accessSummary: getDayUseAccessSummary(entry),
    adults: Number(entry.adults || 0),
    children: Number(entry.children || 0),
    templateName: entry.template_name || '',
    status: String(entry.status || 'checked_in'),
    statusLabel: formatDayUseStatus(entry.status),
    startTime: entry.start_time || '',
    endTime: entry.end_time || '',
    durationHours: Number(entry.duration_hours || 0),
    pricingMode: String(entry.pricing_mode || 'per_person'),
    packageName: entry.package_name || '',
    extrasSummary: summarizeDayUseExtras(extras),
    extrasTotal: Number(entry.extras_total || 0),
    depositAmount: Number(entry.deposit_amount || 0),
    balanceDue: Number(entry.balance_due || 0),
    resourceName: entry.resource_name || '',
    resourceType: entry.resource_type || '',
    serviceNotes: entry.service_notes || '',
    total: Number(entry.total || entry.total_amount || entry.amount || 0),
    paymentMethod: entry.payment_method || '',
    notes: entry.notes || ''
  };
}

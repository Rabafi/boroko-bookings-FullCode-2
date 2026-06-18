// ── Admin Constants ───────────────────────────────────────────────────────────
// Single source of truth for Command Central constants.

export const TRIAL_LENGTH_DAYS = 30
export const DEFAULT_TAX_RATE = 0

export const ALL_FEATURES = ['reports', 'expenses', 'staff', 'pwa', 'audit', 'conference', 'pool', 'import', 'pos', 'inventory', 'supplies']

export const FEAT_LABEL = {
  reports: 'Reports', expenses: 'Expenses', staff: 'Staff Management', pwa: 'Manager Mobile App',
  audit: 'Night Audit', import: 'Data Import',
  pos: 'POS / Bar', inventory: 'Inventory', supplies: 'Room Supplies',
  conference: 'Conference', pool: 'Day Use'
}

export const BIZ_EMOJI = { lodge: '🏕️', restaurant: '🍽️', retail: '🛒', service_provider: '🔧' }
export const BIZ_LABEL = { lodge: 'Lodge', restaurant: 'Restaurant', retail: 'Retail', service_provider: 'Service Provider' }

export const PRIORITY_COLOR = { Low: 'text-gray-400', Normal: 'text-blue-400', High: 'text-orange-400', Urgent: 'text-red-400' }
export const STATUS_COLORS = { open: 'bg-yellow-500/20 text-yellow-300', acknowledged: 'bg-amber-500/20 text-amber-300', in_progress: 'bg-blue-500/20 text-blue-300', resolved: 'bg-green-500/20 text-green-300', closed: 'bg-gray-500/20 text-gray-400' }
export const STATUS_COLOR = STATUS_COLORS

// Centralized Activity Icons — single source of truth for Dashboard + ActivityLog
export const ACTION_ICON = {
  user_login: '👤', booking_created: '📅', expense_added: '💸',
  maintenance_raised: '🔧', default: '📌',
  license_issued: '🔑', license_updated: '🔑', license_deleted: '🗑️',
  company_created: '🏢', company_archived: '📦', company_restored: '♻️', company_deleted: '🗑️',
  payment_received: '💰', invoice_created: '📄', invoice_sent: '📧',
  broadcast_created: '📣', broadcast_updated: '📣', broadcast_deleted: '🗑️',
  ticket_created: '🎫', ticket_updated: '🎫', ticket_message: '💬',
  staff_created: '👤', staff_updated: '👤', staff_deleted: '🗑️',
  feature_flag_updated: '⚙️', test_reset_run: '🔄', test_mode_toggled: '🧪',
  smtp_updated: '📧', lead_created: '📋', lead_updated: '📋',
  booking_cancelled: '❌', room_updated: '🛏️', rate_updated: '💲',
  expense_deleted: '🗑️', invoice_updated: '📄', invoice_deleted: '🗑️',
  pwa_access_updated: '📱', repair_events: '🔩',
  password_reset: '🔑', subscription_assigned: '🔑', subscription_updated: '🔑',
  subscription_deleted: '🗑️', expense_updated: '💸'
}

export const INVOICE_CURRENCIES = ['USD', 'BWP', 'ZAR', 'EUR', 'GBP', 'N$', 'ZK']

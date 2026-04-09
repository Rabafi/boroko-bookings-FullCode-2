export const DESKTOP_PAYMENT_METHODS = [
  { value: 'cash', label: '💵 Cash', plainLabel: 'Cash' },
  { value: 'card', label: '💳 Card', plainLabel: 'Card' },
  { value: 'bank_transfer', label: '🏛️ Bank Transfer (POP Required)', plainLabel: 'Bank Transfer (POP Required)' },
  { value: 'orange_money', label: '🟠 Orange Money', plainLabel: 'Orange Money' },
  { value: 'myzaka', label: '🔵 MyZaka', plainLabel: 'MyZaka' },
  { value: 'smega', label: '🟣 Smega', plainLabel: 'Smega' },
  { value: 'bank_ewallet_absa', label: '🏦 Bank eWallet — Absa', plainLabel: 'Bank eWallet — Absa' },
  { value: 'bank_ewallet_access', label: '🏦 Bank eWallet — Access Bank', plainLabel: 'Bank eWallet — Access Bank' },
  { value: 'bank_ewallet_bank_gaborone', label: '🏦 Bank eWallet — Bank Gaborone', plainLabel: 'Bank eWallet — Bank Gaborone' },
  { value: 'bank_ewallet_bank_of_baroda', label: '🏦 Bank eWallet — Bank of Baroda', plainLabel: 'Bank eWallet — Bank of Baroda' },
  { value: 'bank_ewallet_bbs', label: '🏦 Bank eWallet — BBS Bank', plainLabel: 'Bank eWallet — BBS Bank' },
  { value: 'bank_ewallet_first_capital', label: '🏦 Bank eWallet — First Capital Bank', plainLabel: 'Bank eWallet — First Capital Bank' },
  { value: 'bank_ewallet_fnbb_ewallet', label: '🏦 Bank eWallet — FNBB eWallet', plainLabel: 'Bank eWallet — FNBB eWallet' },
  { value: 'bank_ewallet_fnbb_paytocell', label: '📲 Bank eWallet — FNBB Pay to Cell', plainLabel: 'Bank eWallet — FNBB Pay to Cell' },
  { value: 'bank_ewallet_stanbic', label: '🏦 Bank eWallet — Stanbic Bank', plainLabel: 'Bank eWallet — Stanbic Bank' },
  { value: 'bank_ewallet_standard_chartered', label: '🏦 Bank eWallet — Standard Chartered', plainLabel: 'Bank eWallet — Standard Chartered' },
  { value: 'other', label: 'Other', plainLabel: 'Other' }
]

export const PAYMENT_METHOD_LABELS = Object.fromEntries(
  DESKTOP_PAYMENT_METHODS.map((method) => [method.value, method.label])
)

export const PAYMENT_METHOD_PLAIN_LABELS = Object.fromEntries(
  DESKTOP_PAYMENT_METHODS.map((method) => [method.value, method.plainLabel])
)

export const PAYMENT_METHOD_PLAIN_OPTIONS = DESKTOP_PAYMENT_METHODS.map((method) => method.plainLabel)

export function formatPaymentMethod(value, { plain = false } = {}) {
  if (!value) return plain ? '—' : '—'
  const labels = plain ? PAYMENT_METHOD_PLAIN_LABELS : PAYMENT_METHOD_LABELS
  return labels[value] || String(value).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

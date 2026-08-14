export function money(value, currency = 'P') {
  return `${currency} ${Number(value || 0).toLocaleString()}`
}

export function shortDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

export function shortDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function businessDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Gaborone' }).format(value)
}

export function bookingStatusClass(status) {
  return {
    confirmed: 'bg-blue-900/40 text-blue-300',
    checked_in: 'bg-green-900/40 text-green-300',
    checked_out: 'bg-gray-800 text-gray-300',
    cancelled: 'bg-red-900/30 text-red-300',
    partial: 'bg-yellow-900/40 text-yellow-300'
  }[status] || 'bg-gray-800 text-gray-300'
}

export function paymentStatusClass(status) {
  return {
    paid: 'bg-green-900/40 text-green-300',
    partial: 'bg-yellow-900/40 text-yellow-300',
    unpaid: 'bg-red-900/30 text-red-300'
  }[status] || 'bg-gray-800 text-gray-300'
}

export function titleCase(value = '') {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

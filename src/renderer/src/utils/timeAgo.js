import { formatLocalDate } from './localDate'

export function timeAgo(dt) {
  if (!dt) return ''
  const diff = Date.now() - new Date(dt).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return formatLocalDate(dt)
}

export function formatMoney(currency, amount) {
  const num = Number(amount || 0)
  const formatted = num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${formatted}` : formatted
}

export function fmtDate(dt) {
  if (!dt) return '\u2014'
  return new Date(dt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

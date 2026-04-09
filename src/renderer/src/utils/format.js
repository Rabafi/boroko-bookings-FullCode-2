/**
 * P3-13: Format helpers for consistent data presentation
 * Provides utilities for formatting currency, dates, numbers, etc.
 */

export const formatCurrency = (amount, currency = '₧') => {
  const num = Number(amount) || 0
  return `${currency} ${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export const formatNumber = (num) => {
  return Number(num || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export const formatDate = (date, format = 'short') => {
  if (!date) return ''
  const d = new Date(date)
  if (format === 'short') {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  if (format === 'long') {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }
  if (format === 'time') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toISOString().split('T')[0]
}

export const formatTime = (date) => {
  if (!date) return ''
  return new Date(date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export const formatRelativeTime = (date) => {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const seconds = Math.floor((now - d) / 1000)

  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
  return formatDate(d, 'short')
}

export const formatPercent = (value) => {
  const num = Number(value) || 0
  return `${num.toFixed(1)}%`
}

export const formatPhoneNumber = (phone) => {
  if (!phone) return ''
  const cleaned = String(phone).replace(/\D/g, '')
  if (cleaned.length === 10) {
    return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
  }
  return phone
}

export const truncateText = (text, length = 50) => {
  if (!text || text.length <= length) return text
  return `${text.slice(0, length)}...`
}

export const titleCase = (str) => {
  if (!str) return ''
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export const toTitleCase = (str) => {
  if (!str) return ''
  return str
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

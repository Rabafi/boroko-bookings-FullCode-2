export function formatLocalDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function localToday() {
  return formatLocalDate()
}

export function localDateStringFromOffset(days = 0) {
  const date = new Date()
  date.setDate(date.getDate() + Number(days || 0))
  return formatLocalDate(date)
}

export function parseLocalDateInput(value) {
  if (!value) return null
  const [year, month, day] = String(value).split('-').map((part) => Number.parseInt(part, 10))
  if (![year, month, day].every(Number.isFinite)) return null
  return new Date(year, month - 1, day)
}

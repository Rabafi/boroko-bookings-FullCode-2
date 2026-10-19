// @ts-check
/**
 * Local calendar-day helpers for the desktop renderer (browser scope).
 *
 * All formatting uses the LOCAL timezone via getFullYear/getMonth/getDate;
 * there is intentionally no UTC conversion here. Return values are plain
 * strings, not validated date brands: Invalid Date inputs produce NaN
 * components rather than throwing.
 */
/**
 * Format a Date (or Date-constructible string/number) as a local YYYY-MM-DD
 * string. Non-Date inputs pass through the Date constructor unchanged.
 *
 * @param {Date | string | number} [value]
 * @returns {string}
 */
export function formatLocalDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Today's local date as YYYY-MM-DD, using the local clock.
 *
 * @returns {string}
 */
export function localToday() {
  return formatLocalDate()
}

/**
 * Calendar-day offset from today as YYYY-MM-DD. The unknown input preserves
 * the existing `Number(days || 0)` coercion boundary (strings/booleans coerce;
 * uncoercible input yields NaN and an Invalid-Date string, while exotic input
 * such as Symbol() or a throwing conversion hook throws instead); this
 * annotation does not narrow accepted inputs or add validation. Arithmetic is
 * calendar days via local setDate, not UTC or fixed 24-hour steps.
 *
 * @param {unknown} [days]
 * @returns {string}
 */
export function localDateStringFromOffset(days = 0) {
  const date = new Date()
  date.setDate(date.getDate() + Number(days || 0))
  return formatLocalDate(date)
}

/**
 * Parse loosely hyphenated input into a Date or null. Falsy input and
 * nonfinite components return null. Otherwise construction is delegated to
 * `new Date(year, month - 1, day)` with its existing behaviour: partial
 * numeric components are accepted, out-of-range values roll over, and extreme
 * values may yield Invalid Date. `Date | null` therefore promises nothing
 * about calendar validity — narrow before use.
 *
 * @param {unknown} value
 * @returns {Date | null}
 */
export function parseLocalDateInput(value) {
  if (!value) return null
  const [year, month, day] = String(value).split('-').map((part) => Number.parseInt(part, 10))
  if (![year, month, day].every(Number.isFinite)) return null
  return new Date(year, month - 1, day)
}

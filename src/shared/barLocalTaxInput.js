const PERCENT = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/

/** Convert a customer-entered percentage to the service's 0–1 multiplier. */
export function barTaxPercentToRate(value) {
  if (typeof value !== 'string' || !PERCENT.test(value)) throw new Error('Enter a tax percentage from 0 to 100, with up to two decimal places.')
  const [whole, fraction = ''] = value.split('.')
  const hundredths = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (hundredths > 10000n) throw new Error('Tax percentage cannot be greater than 100%.')
  const rateUnits = hundredths
  return `${rateUnits / 10000n}.${String(rateUnits % 10000n).padStart(4, '0')}`
}

/** Convert the service's exact four-place 0–1 multiplier to a percentage. */
export function barTaxRateToPercent(value) {
  const text = String(value ?? '0')
  if (!/^\d+(?:\.\d{1,4})?$/.test(text)) throw new Error('The saved tax rate is invalid.')
  const [whole, fraction = ''] = text.split('.')
  const units = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))
  if (units > 10000n) throw new Error('The saved tax rate is outside the supported range.')
  return `${units / 100n}.${String(units % 100n).padStart(2, '0')}`
}

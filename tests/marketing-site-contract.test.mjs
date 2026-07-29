import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} should include ${expected}`)
}

const packagesHtml = read('marketing-site/packages.html')
const enterpriseHtml = read('marketing-site/enterprise.html')
const homeHtml = read('marketing-site/index.html')
const lodgeHtml = read('marketing-site/lodge-app.html')
const hotelHtml = read('marketing-site/hotel.html')
const restaurantHtml = read('marketing-site/restaurant-pos.html')
const barHtml = read('marketing-site/bar-pos.html')
const marketingScript = read('marketing-site/script.js')
const netlifyToml = read('marketing-site/netlify.toml')

for (const page of readdirSync(resolve(root, 'marketing-site')).filter((name) => name.endsWith('.html') && name !== 'admin.html')) {
  const html = read(`marketing-site/${page}`)
  assertIncludes(html, 'href="./lodge-app.html"', `${page} ecosystem Lodge navigation`)
  assertIncludes(html, 'href="./hotel.html"', `${page} ecosystem Hotel navigation`)
  assertIncludes(html, 'href="./restaurant-pos.html"', `${page} ecosystem Restaurant navigation`)
  assertIncludes(html, 'href="./bar-pos.html"', `${page} ecosystem Bar navigation`)
  const withoutLegacyInstallerFilename = html.replaceAll('Boroko-Bookings-1.3.16-x64.exe', '')
  assert.ok(!/\bBoroko\b/.test(withoutLegacyInstallerFilename), `${page} must not leak the retired public brand`)
}

assertIncludes(packagesHtml, 'Starter, Standard, and Pro', 'packages metadata')
assertIncludes(packagesHtml, '<h3>Tsa Bonno HotelOS</h3>', 'packages page Hotel product')
assertIncludes(packagesHtml, 'href="./hotel.html#trial"', 'packages page Hotel link')
assertIncludes(packagesHtml, 'id="lodge-packages"', 'separate Lodge package section')
assertIncludes(packagesHtml, 'id="hotel-packages"', 'separate Hotel package section')
assertIncludes(packagesHtml, 'id="restaurant-packages"', 'separate Restaurant package section')
assertIncludes(packagesHtml, 'id="bar-package"', 'separate Bar package section')
assertIncludes(packagesHtml, 'data-hotel-addon-builder', 'Hotel add-on builder')
assertIncludes(packagesHtml, 'Staff Operations &amp; Workforce', 'planned Hotel workforce add-on')
assertIncludes(packagesHtml, 'Maintenance &amp; Asset Management', 'planned Hotel asset add-on')
assertIncludes(packagesHtml, 'Events &amp; Venue Management', 'planned Hotel events add-on')
assert.ok(!packagesHtml.includes('<h3>Enterprise</h3>'), 'Lodge & Camp packages must not expose an Enterprise package')
assert.ok(!packagesHtml.includes('"name": "Enterprise"'), 'Lodge & Camp structured data must not expose an Enterprise package')
assert.ok(!packagesHtml.includes('"price": "37998"'), 'Lodge & Camp structured data must not expose the retired Enterprise price')

assertIncludes(netlifyToml, 'from = "/enterprise"', 'marketing Netlify redirects')
assertIncludes(netlifyToml, 'to = "/enterprise.html"', 'marketing Netlify redirects')
assertIncludes(netlifyToml, 'connect-src', 'marketing CSP')
assertIncludes(netlifyToml, 'https://oicgpknsmtvcsjacymum.supabase.co', 'marketing CSP Supabase allowlist')
assertIncludes(netlifyToml, 'from = "/lodge-app"', 'Lodge landing redirect')
assertIncludes(netlifyToml, 'from = "/hotel"', 'Hotel landing redirect')

for (const [name, html, product] of [
  ['Lodge', lodgeHtml, 'lodge-camp'],
  ['Hotel', hotelHtml, 'hotel'],
  ['Restaurant POS', restaurantHtml, 'hospitality-pos'],
  ['Bar POS', barHtml, 'hospitality-pos']
]) {
  assertIncludes(html, `data-product="${product}"`, `${name} product identity`)
  assertIncludes(html, 'data-action="download"', `${name} trial registration`)
  assertIncludes(html, 'id="fallback-download"', `${name} direct download link`)
}

assertIncludes(homeHtml, 'id="product-apps"', 'ecosystem application chooser')
assertIncludes(homeHtml, 'Three hospitality applications. One trusted Tsa Bonno foundation.', 'home ecosystem positioning')
assertIncludes(homeHtml, 'Tsa Bonno LodgingOS', 'home LodgingOS identity')
assertIncludes(homeHtml, 'Tsa Bonno HotelOS', 'home HotelOS identity')
assertIncludes(homeHtml, 'Tsa Bonno Restaurant &amp; Bar POS', 'home Restaurant and Bar POS identity')
assertIncludes(homeHtml, 'href="./lodge-app.html"', 'home Lodge landing link')
assertIncludes(homeHtml, 'href="./hotel.html"', 'home Hotel landing link')
assertIncludes(homeHtml, 'href="./restaurant-pos.html"', 'home Restaurant POS landing link')
assertIncludes(marketingScript, "BUSINESS_FIELD_LABEL", 'product-specific trial form labels')
assertIncludes(marketingScript, "window.location.href = './hotel.html'", 'Hotel CTA routing')
assertIncludes(marketingScript, "querySelector('[data-hotel-addon-builder]')", 'Hotel add-on calculator wiring')

for (const [name, html, prices] of [
  ['Lodge', lodgeHtml, ['P8,999/year', 'P12,999/year', 'P18,999/year']],
  ['Hotel', hotelHtml, ['P37,998']],
  ['Restaurant', restaurantHtml, ['P8,999/year', 'P12,999/year', 'P18,999/year']],
  ['Bar', barHtml, ['P4,500']]
]) {
  for (const price of prices) assertIncludes(html, price, `${name} individual pricing`)
}

assertIncludes(enterpriseHtml, 'id="enterprise-quote-form"', 'legacy Hotel quote form id')
assertIncludes(enterpriseHtml, 'data-product="hotel"', 'Hotel quotation product identity')
assertIncludes(enterpriseHtml, 'submit_public_subscription_request', 'Hotel public request RPC')
assertIncludes(enterpriseHtml, '<span>Hotel</span>', 'Hotel quotation summary')
assertIncludes(enterpriseHtml, 'Hotel: { annual: null', 'Hotel quote-confirmed pricing snapshot')
assertIncludes(enterpriseHtml, "payment_instructions: 'Manual payment only.", 'Hotel payment instructions')
assertIncludes(enterpriseHtml, 'activation happens only after Tsa Bonno approves payment proof', 'Hotel activation copy')
assert.ok(!enterpriseHtml.includes('<option value="Enterprise">'), 'Hotel quotation must not expose Enterprise as a selectable package')

// Premium-only add-ons (basic rates/corporate/housekeeping readiness are Hotel Core)
const expectedAddons = [
  'payment_gateway',
  'guest_portal',
  'multi_property',
  'advanced_rates',
  'multi_outlet_pos'
]

for (const addon of expectedAddons) {
  assertIncludes(enterpriseHtml, `value="${addon}"`, `Enterprise add-on ${addon}`)
  assertIncludes(enterpriseHtml, `${addon}: { annual:`, `Enterprise add-on pricing ${addon}`)
}

for (const coreNotAddon of ['rate_plans', 'corporate_accounts', 'advanced_housekeeping_mobile']) {
  assert.ok(
    !enterpriseHtml.includes(`value="${coreNotAddon}"`),
    `${coreNotAddon} must not be sold as a Hotel quotation add-on (included in Hotel Core or not advertised)`
  )
}

assert.ok(
  !/payment\s+(?:is|was)\s+(?:confirmed|processed|successful)/i.test(enterpriseHtml),
  'Enterprise marketing page must not claim online payment is confirmed or processed'
)

console.log('marketing-site-contract: ok')

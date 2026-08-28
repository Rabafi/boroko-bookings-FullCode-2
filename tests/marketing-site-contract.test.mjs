import assert from 'node:assert/strict'
import test from 'node:test'
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

function normalizeMarkup(source) {
  return source
    .replaceAll('&amp;', '&')
    .replaceAll('&ndash;', '–')
    .replaceAll('&mdash;', '—')
    .replace(/\s+/g, ' ')
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `${label} start marker should exist`)
  assert.ok(end > start, `${label} end marker should exist after its start`)
  return source.slice(start, end)
}

const packagesHtml = read('marketing-site/packages.html')
const enterpriseHtml = read('marketing-site/enterprise.html')
const homeHtml = read('marketing-site/index.html')
const lodgeHtml = read('marketing-site/lodge-app.html')
const hotelHtml = read('marketing-site/hotel.html')
const restaurantHtml = read('marketing-site/restaurant-pos.html')
const barHtml = read('marketing-site/bar-pos.html')
const downloadHtml = read('marketing-site/download.html')
const thankYouHtml = read('marketing-site/thank-you.html')
const managerAppHtml = read('marketing-site/manager-app.html')
const brochureHtml = read('marketing-site/brochure.html')
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
assertIncludes(packagesHtml, 'Bar POS Base', 'Bar Base package name')
assertIncludes(packagesHtml, 'Optional annual add-ons', 'Bar add-on disclosure')
for (const [name, price] of [
  ['Stock &amp; Purchasing Pro', 'P3,000'],
  ['Accounting &amp; Workforce', 'P6,000'],
  ['Growth &amp; Multi-Outlet', 'P5,000']
]) {
  assertIncludes(packagesHtml, name, `${name} marketing name`)
  assertIncludes(packagesHtml, price, `${name} annual price`)
}
assertIncludes(packagesHtml, 'Manager mobile oversight', 'Bar package includes Manager mobile oversight')
assertIncludes(packagesHtml, 'Basic Reports for today, 7-day, and 30-day views with print/PDF', 'Starter basic report boundary')
assertIncludes(packagesHtml, 'Full Staff Management, full reports and exports', 'Standard full report boundary')
assertIncludes(packagesHtml, 'Up to 120 bookings/month, 6 rooms, 2 users', 'Starter capacity disclosure')
assertIncludes(packagesHtml, 'Up to 400 bookings/month, 20 rooms, 5 users', 'Standard capacity disclosure')
assertIncludes(packagesHtml, 'Up to 600 bookings/month, 30 rooms, 10 users', 'Pro capacity disclosure')

const packageMarkup = normalizeMarkup(packagesHtml)
const lodgePackagesMarkup = sliceBetween(
  packageMarkup,
  '<section class="section pricing-section" id="lodge-packages">',
  '<section class="section" id="hotel-packages">',
  'Lodge package section'
)
const starterCard = sliceBetween(lodgePackagesMarkup, '<h3>Starter</h3>', '<h3>Standard</h3>', 'Starter package card')
const standardCard = sliceBetween(lodgePackagesMarkup, '<h3>Standard</h3>', '<h3>Pro</h3>', 'Standard package card')
const proCard = lodgePackagesMarkup.slice(lodgePackagesMarkup.indexOf('<h3>Pro</h3>'))
const hotelPackagesMarkup = sliceBetween(
  packageMarkup,
  '<section class="section" id="hotel-packages">',
  '<section class="section section-contrast" id="restaurant-packages">',
  'Hotel package section'
)

test('public Lodge package cards state the exact Starter, Standard, and Pro boundaries', () => {
  for (const phrase of [
    'Users & Access Lite',
    'Customer-owned backup',
    'support-led recovery',
    'immutable operational audit evidence',
    'Guest Deposits Lite'
  ]) {
    assert.ok(starterCard.toLowerCase().includes(phrase.toLowerCase()), `Starter should include ${phrase}`)
  }
  assert.match(starterCard, /Basic Reports[\s\S]{0,220}(?:print|PDF)/i)
  assert.doesNotMatch(starterCard, /CSV|Excel|full reports? and exports|Prepayments Management|Credit Control & Automation|Full Staff Management|Manager App/i)

  assert.match(standardCard, /Prepayments Management/i)
  assert.match(standardCard, /Full Staff Management|full staff/i)
  assert.match(standardCard, /Full reports(?: and exports)?/i)
  assert.doesNotMatch(standardCard, /Credit Control & Automation/i)
  assert.doesNotMatch(standardCard, /Manager App/i)

  assert.match(proCard, /Credit Control & Automation/i)
  assert.match(proCard, /(?:Manager App[\s\S]{0,180}read-only|read-only[\s\S]{0,180}Manager App)/i)
})

test('Hotel Core publicly carries the full accommodation deposit depth', () => {
  assert.match(hotelPackagesMarkup, /Hotel Core/i)
  for (const phrase of ['Guest Deposits Lite', 'Prepayments Management', 'Credit Control & Automation']) {
    assertIncludes(hotelPackagesMarkup, phrase, `Hotel Core ${phrase}`)
  }
})

const brochureMarkup = normalizeMarkup(brochureHtml)
const brochureStandardJourney = sliceBetween(
  brochureMarkup,
  '<section class="brochure-page" aria-label="Standard package journey">',
  '<section class="brochure-page" aria-label="Pro package journey">',
  'brochure Standard journey'
)
const brochureProJourney = sliceBetween(
  brochureMarkup,
  '<section class="brochure-page" aria-label="Pro package journey">',
  '<section class="brochure-page" aria-label="Product capabilities">',
  'brochure Pro journey'
)
const brochurePackageLadder = sliceBetween(
  brochureMarkup,
  '<section class="brochure-page" aria-label="Packages">',
  '<section class="brochure-page dark-panel" aria-label="Contact and next steps">',
  'brochure package ladder'
)
const brochureStandardCard = sliceBetween(
  brochurePackageLadder,
  '<span class="label">Standard</span>',
  '<span class="label">Pro</span>',
  'brochure Standard card'
)

test('brochure keeps Manager App read-only and out of the Standard package', () => {
  assert.doesNotMatch(brochureStandardJourney, /Manager App/i)
  assert.doesNotMatch(brochureStandardCard, /Manager App/i)
  assert.match(brochureProJourney, /(?:Manager App[\s\S]{0,180}read-only|read-only[\s\S]{0,180}Manager App)/i)
})

test('Manager App marketing does not claim mobile deposit mutations', () => {
  assertIncludes(managerAppHtml, 'Guest Deposit balances are read-only on mobile', 'Manager App Guest Deposit read-only boundary')
  const mobileCanList = sliceBetween(
    normalizeMarkup(managerAppHtml),
    'Managers CAN',
    'Front desk DOES on desktop',
    'Manager App mobile capability list'
  )
  assert.doesNotMatch(mobileCanList, /(?:receive|refund|reverse|allocate|reconcile|export|match|configure)[\s\S]{0,80}(?:deposit|prepayment|customer credit)/i)
})

assertIncludes(lodgeHtml, 'Basic Reports with print/PDF', 'Lodge Starter basic report positioning')
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

test('unsigned Windows installer guidance is clear, consistent, and source-aware', () => {
  for (const phrase of [
    'not yet digitally signed',
    'Windows protected your PC',
    'Unknown publisher',
    'More info',
    'Run anyway',
    'do not install it'
  ]) {
    assertIncludes(downloadHtml, phrase, `download guidance ${phrase}`)
  }
  assertIncludes(thankYouHtml, 'not yet digitally signed', 'post-download signing explanation')
  assertIncludes(thankYouHtml, 'More info', 'post-download Windows step')
  assertIncludes(thankYouHtml, 'ask us to confirm the installer', 'post-download safe recovery path')
  assert.ok(!thankYouHtml.includes('security prompt — click <strong>Run anyway</strong>'), 'post-download guidance must not tell users to bypass Windows without checking the source')
  assertIncludes(marketingScript, 'The next page shows the safe steps.', 'download modal signing heads-up')

  for (const [name, html] of [
    ['Lodge', lodgeHtml],
    ['Hotel', hotelHtml],
    ['Restaurant POS', restaurantHtml],
    ['Bar POS', barHtml]
  ]) {
    assertIncludes(html, 'Windows protected your PC', `${name} direct download Windows explanation`)
    assertIncludes(html, '<strong>More info</strong>', `${name} direct download More info step`)
    assertIncludes(html, '<strong>Run anyway</strong>', `${name} direct download checked continuation step`)
    assertIncludes(html, 'If anything looks unfamiliar, stop', `${name} direct download stop guidance`)
  }

  assertIncludes(marketingScript, "new URLSearchParams(window.location.search).get('product')", 'post-download product identity detection')
  assertIncludes(marketingScript, "'&product=' + encodeURIComponent(ACTIVE_PRODUCT_ID)", 'post-download product identity handoff')
})

for (const [name, html, prices] of [
  ['Lodge', lodgeHtml, ['P8,999/year', 'P12,999/year', 'P18,999/year']],
  ['Hotel', hotelHtml, ['P37,998']],
  ['Restaurant', restaurantHtml, ['P8,999/year', 'P12,999/year', 'P18,999/year']],
  ['Bar', barHtml, ['P4,500']]
]) {
  for (const price of prices) assertIncludes(html, price, `${name} individual pricing`)
}

assertIncludes(barHtml, 'Manager Mobile App', 'Bar page Manager App feature')
assertIncludes(barHtml, 'Manager oversight included', 'Bar page PWA inclusion')
assertIncludes(barHtml, 'Bar POS Base is P4,500', 'Bar page Base hero pricing')
assertIncludes(managerAppHtml, 'Lodge, Hotel, Restaurant, and Bar', 'Manager App product-family coverage')
assertIncludes(managerAppHtml, 'Bar POS Base includes read-only Manager oversight', 'Manager App Bar Base boundary')
assertIncludes(managerAppHtml, 'optional Growth &amp; Multi-Outlet bundle adds the advanced Owner View', 'Manager App Growth boundary')
assert.ok(!managerAppHtml.includes('included with the Pro package'), 'Manager App must not claim it is only included with Pro')

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

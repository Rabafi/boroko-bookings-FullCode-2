import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
const netlifyToml = read('marketing-site/netlify.toml')

assertIncludes(packagesHtml, 'Starter, Standard, Pro, Enterprise', 'packages metadata')
assertIncludes(packagesHtml, '<h3>Enterprise</h3>', 'packages page')
assertIncludes(packagesHtml, 'href="./enterprise.html"', 'packages page Enterprise links')
assertIncludes(packagesHtml, '"name": "Enterprise"', 'packages structured data')
assertIncludes(packagesHtml, '"price": "37998"', 'Enterprise structured data')

assertIncludes(netlifyToml, 'from = "/enterprise"', 'marketing Netlify redirects')
assertIncludes(netlifyToml, 'to = "/enterprise.html"', 'marketing Netlify redirects')
assertIncludes(netlifyToml, 'connect-src', 'marketing CSP')
assertIncludes(netlifyToml, 'https://oicgpknsmtvcsjacymum.supabase.co', 'marketing CSP Supabase allowlist')

assertIncludes(enterpriseHtml, 'id="enterprise-quote-form"', 'Enterprise quote form')
assertIncludes(enterpriseHtml, 'submit_public_subscription_request', 'Enterprise public request RPC')
assertIncludes(enterpriseHtml, "Enterprise: { annual: 37998 }", 'Enterprise pricing snapshot')
assertIncludes(enterpriseHtml, "payment_instructions: 'Manual payment only.", 'Enterprise payment instructions')
assertIncludes(enterpriseHtml, 'activation happens only after Boroko approves payment proof', 'Enterprise activation copy')

const expectedAddons = [
  'custom_website',
  'payment_gateway',
  'rate_plans',
  'channel_manager',
  'corporate_accounts',
  'advanced_housekeeping_mobile',
  'guest_portal',
  'multi_property',
  'advanced_rates',
  'multi_outlet_pos'
]

for (const addon of expectedAddons) {
  assertIncludes(enterpriseHtml, `value="${addon}"`, `Enterprise add-on ${addon}`)
  assertIncludes(enterpriseHtml, `${addon}: { annual:`, `Enterprise add-on pricing ${addon}`)
}

assert.ok(
  !/payment\s+(?:is|was)\s+(?:confirmed|processed|successful)/i.test(enterpriseHtml),
  'Enterprise marketing page must not claim online payment is confirmed or processed'
)

console.log('marketing-site-contract: ok')

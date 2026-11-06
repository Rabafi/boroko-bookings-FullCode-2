import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  MANAGER_PWA_ORIGIN,
  MANAGER_RESET_PASSWORD_URL,
  MARKETING_SITE_ORIGIN,
  MARKETING_SITE_WWW_ORIGIN,
  PUBLIC_BOOKING_ORIGIN,
  SUPPORT_EMAIL,
  buildLodgeBookingUrl,
  buildSupportMailto
} from '../src/shared/publicEndpoints.js'
import {
  buildPublicBookingUrl,
  normalizePublicBookingOrigin
} from '../booking-site/src/lib/publicSiteUrl.js'
import { SITES, HUB_MOVED } from '../marketing-site/src/sites.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

function readSources(directory) {
  const sources = []
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const relativePath = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      sources.push(...readSources(relativePath))
    } else if (entry.isFile() && /\.(?:js|jsx)$/.test(entry.name)) {
      sources.push({ relativePath, source: read(relativePath) })
    }
  }
  return sources
}

test('canonical public origins and mailboxes are exact', () => {
  assert.equal(MARKETING_SITE_ORIGIN, 'https://tsabonno.com')
  assert.equal(MARKETING_SITE_WWW_ORIGIN, 'https://www.tsabonno.com')
  assert.equal(PUBLIC_BOOKING_ORIGIN, 'https://book.tsabonno.com')
  assert.equal(MANAGER_PWA_ORIGIN, 'https://manager.tsabonno.com')
  assert.equal(SUPPORT_EMAIL, 'support@tsabonno.com')
  assert.equal(MANAGER_RESET_PASSWORD_URL, 'https://manager.tsabonno.com/reset-password')
})

test('multisite marketing subdomain origins are exact', () => {
  assert.equal(SITES.hub.origin, 'https://tsabonno.com')
  assert.equal(SITES.lodge.origin, 'https://lodge.tsabonno.com')
  assert.equal(SITES.restaurant.origin, 'https://restaurant.tsabonno.com')
  assert.equal(SITES.bar.origin, 'https://bar.tsabonno.com')
  assert.equal(SITES.hotel.origin, 'https://hotel.tsabonno.com')
  assert.equal(SITES.property.origin, 'https://property.tsabonno.com')
})

test('every URL that moved off the hub 301s to a subdomain, and new URLs do not', () => {
  // The build (scripts/build-marketing-sites.mjs) turns each HUB_MOVED entry
  // into a 301 from tsabonno.com/<page> to the owning subdomain. Each target
  // must be a real site whose origin is not the hub itself.
  for (const [page, targetSiteId] of Object.entries(HUB_MOVED)) {
    const target = SITES[targetSiteId]
    assert.ok(target, `${page} redirects to a known site`)
    assert.notEqual(targetSiteId, 'hub', `${page} must move off the hub`)
    assert.match(
      target.origin,
      /^https:\/\/[a-z-]+\.tsabonno\.com$/,
      `${page} must redirect to a subdomain origin`
    )
  }

  // /property is a new URL on property.tsabonno.com — it must never be
  // registered as a moved hub page (no legacy hub URL to preserve).
  assert.ok(!('property' in HUB_MOVED), 'property must not appear in the hub 301 map')
  assert.ok(!('index' in HUB_MOVED), 'the hub home must not redirect to itself')
})

test('lodge booking URLs preserve the existing slug and booking routes', () => {
  assert.equal(buildLodgeBookingUrl('tsa-bonno-lodge'), 'https://book.tsabonno.com/tsa-bonno-lodge')
  assert.equal(buildLodgeBookingUrl('tsa-bonno-lodge', '/book'), 'https://book.tsabonno.com/tsa-bonno-lodge/book')
  assert.equal(buildLodgeBookingUrl('tsa-bonno-lodge', '/success'), 'https://book.tsabonno.com/tsa-bonno-lodge/success')
  assert.equal(buildLodgeBookingUrl('Lodge-With-Caps'), 'https://book.tsabonno.com/Lodge-With-Caps')
  assert.equal(buildLodgeBookingUrl('  legacy-slug-01  '), 'https://book.tsabonno.com/legacy-slug-01')
  assert.equal(buildLodgeBookingUrl(''), 'https://book.tsabonno.com')
})

test('desktop booking and support actions use shared canonical endpoints', () => {
  const settings = read('src/renderer/src/components/Settings.jsx')
  assert.match(settings, /buildLodgeBookingUrl\(form\.slug\)/)
  assert.doesNotMatch(settings, /borokoonlinebookings\.netlify\.app/)

  for (const relativePath of [
    'src/renderer/src/components/AdminCentral.jsx',
    'src/renderer/src/components/shared/UsageUpgradePrompt.jsx'
  ]) {
    const source = read(relativePath)
    assert.match(source, /buildSupportMailto/)
    assert.doesNotMatch(source, /support@boroko\.io/)
  }

  const app = read('src/renderer/src/App.jsx')
  assert.match(app, /SUPPORT_EMAIL/)
  assert.doesNotMatch(app, /SALES_EMAIL|sales@tsabonno\.com/)

  assert.equal(
    buildSupportMailto('Upgrade request', 'Please review'),
    'mailto:support@tsabonno.com?subject=Upgrade%20request&body=Please%20review'
  )
})

test('password reset configuration targets the canonical manager domain', () => {
  for (const relativePath of ['.env.example', 'manager-pwa/.env.example']) {
    assert.match(
      read(relativePath),
      /VITE_AUTH_REDIRECT_URL=https:\/\/manager\.tsabonno\.com\/reset-password/
    )
  }
  assert.match(read('src/main/domains/authClients.js'), /MANAGER_RESET_PASSWORD_URL/)
  assert.match(read('manager-pwa/src/lib/supabase.js'), /MANAGER_RESET_PASSWORD_URL/)
})

test('booking canonical URLs use the canonical public origin', () => {
  assert.equal(normalizePublicBookingOrigin('https://book.tsabonno.com/some/path'), 'https://book.tsabonno.com')
  assert.equal(normalizePublicBookingOrigin('not a url'), 'https://book.tsabonno.com')
  assert.equal(buildPublicBookingUrl('/my-lodge', 'https://preview.example.com'), 'https://preview.example.com/my-lodge')
  assert.equal(buildPublicBookingUrl('/my-lodge/book'), 'https://book.tsabonno.com/my-lodge/book')

  const seoMeta = read('booking-site/src/components/SeoMeta.jsx')
  assert.match(seoMeta, /buildPublicBookingUrl/)
  assert.doesNotMatch(seoMeta, /window\.location\.origin/)
})

test('marketing pages publish the new domain and mailbox', () => {
  const pages = readdirSync(resolve(root, 'marketing-site')).filter((name) => name.endsWith('.html'))
  for (const page of pages) {
    const html = read(`marketing-site/${page}`)
    assert.doesNotMatch(html, /borokobookings\.com/, `${page} still references the retired domain`)
    assert.doesNotMatch(html, /hello@borokobookings\.com|support@boroko\.io/, `${page} still references a retired mailbox`)
  }

  assert.doesNotMatch(read('marketing-site/script.js'), /borokobookings\.com/)
  assert.doesNotMatch(read('marketing-site/sitemap.xml'), /borokobookings\.com/)
  assert.doesNotMatch(read('marketing-site/robots.txt'), /borokobookings\.com/)

  const netlify = read('marketing-site/netlify.toml')
  assert.match(netlify, /img-src[^;]*https:\/\/tsabonno\.com/)
})

test('unprovisioned sales mailbox is not published to customers', () => {
  for (const directory of ['src', 'manager-pwa/src', 'booking-site/src']) {
    for (const { relativePath, source } of readSources(directory)) {
      assert.doesNotMatch(
        source,
        /sales@tsabonno\.com/,
        `${relativePath} uses an unprovisioned mailbox`
      )
    }
  }

  const pages = readdirSync(resolve(root, 'marketing-site')).filter((name) => name.endsWith('.html'))
  for (const page of pages) {
    assert.doesNotMatch(
      read(`marketing-site/${page}`),
      /sales@tsabonno\.com/,
      `${page} uses an unprovisioned mailbox`
    )
  }
  assert.doesNotMatch(read('marketing-site/script.js'), /sales@tsabonno\.com/)
})

test('legacy marketing and booking hosts redirect with path preservation', () => {
  const marketing = read('marketing-site/netlify.toml')
  assert.match(marketing, /from = "https:\/\/borokobookings\.com\/\*"[\s\S]{0,120}to = "https:\/\/tsabonno\.com\/:splat"[\s\S]{0,80}status = 301/)
  assert.match(marketing, /from = "https:\/\/www\.borokobookings\.com\/\*"[\s\S]{0,120}to = "https:\/\/tsabonno\.com\/:splat"[\s\S]{0,80}status = 301/)
  assert.match(marketing, /from = "https:\/\/borokobookings\.netlify\.app\/\*"[\s\S]{0,120}to = "https:\/\/tsabonno\.com\/:splat"[\s\S]{0,80}status = 301/)

  const booking = read('booking-site/netlify.toml')
  assert.match(booking, /from\s+= "https:\/\/borokoonlinebookings\.netlify\.app\/\*"[\s\S]{0,120}to\s+= "https:\/\/book\.tsabonno\.com\/:splat"[\s\S]{0,80}status = 301/)

  const bookingRedirects = read('booking-site/public/_redirects')
  const domainRedirect = bookingRedirects.indexOf('https://borokoonlinebookings.netlify.app/* https://book.tsabonno.com/:splat 301!')
  const spaFallback = bookingRedirects.indexOf('/* /index.html 200')
  assert.ok(domainRedirect >= 0, 'booking legacy-host redirect must be present')
  assert.ok(spaFallback > domainRedirect, 'booking legacy-host redirect must run before the SPA fallback')
  assert.doesNotMatch(read('manager-pwa/vercel.json'), /tsabonno\.com/)
})

test('application and push code no longer emit legacy public endpoints', () => {
  const legacyEndpoint = /borokoonlinebookings\.netlify\.app|borokobookings\.com|support@boroko\.io|boroko-bookings\.vercel\.app/
  for (const directory of ['src', 'manager-pwa/src', 'booking-site/src']) {
    for (const { relativePath, source } of readSources(directory)) {
      assert.doesNotMatch(source, legacyEndpoint, `${relativePath} still emits a retired public endpoint`)
    }
  }

  const pushFunction = read('supabase/functions/send-push/index.ts')
  assert.match(pushFunction, /mailto:support@tsabonno\.com/)
  assert.doesNotMatch(pushFunction, /hello@borokobookings\.com/)
})

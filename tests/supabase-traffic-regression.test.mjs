import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

const read = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('manager PWA deduplicates identical in-flight reads', async () => {
  const runtime = await read('manager-pwa/src/lib/runtime.js')
  assert.match(runtime, /const inFlightQueries = new Map\(\)/)
  assert.match(runtime, /const existingRequest = inFlightQueries\.get\(requestKey\)/)
  assert.match(runtime, /if \(existingRequest\) return existingRequest/)
})

test('manager PWA entitlement uses a bounded cache instead of calling on every consumer', async () => {
  const api = await read('manager-pwa/src/lib/api.js')
  assert.match(api, /const ENTITLEMENT_CACHE_MAX_AGE_MS = 5 \* 60_000/)
  assert.match(api, /key: 'entitlement'/)
  assert.match(api, /maxAgeMs: ENTITLEMENT_CACHE_MAX_AGE_MS/)
  assert.match(api, /forceFresh: options\.forceFresh === true/)
})

test('desktop entitlement requests are cached and concurrent calls are coalesced', async () => {
  const entitlements = await read('src/main/domains/entitlements.js')
  assert.match(entitlements, /const _entitlementRequests = new Map\(\)/)
  assert.match(entitlements, /const ENTITLEMENT_CACHE_TTL_MS = 2 \* 60_000/)
  assert.match(entitlements, /if \(existingRequest\) return existingRequest/)
  assert.match(entitlements, /options\.forceFresh !== true/)
})

test('high-cost manager pages retain refresh behavior with gentler visible-only polling', async () => {
  const money = await read('manager-pwa/src/pages/Money.jsx')
  const pos = await read('manager-pwa/src/pages/PosSales.jsx')
  assert.match(money, /document\.visibilityState === 'visible'\) load\(true\)/)
  assert.match(money, /2 \* 60_000/)
  assert.match(pos, /document\.visibilityState === 'visible'\) load\(\{ silent: true \}\)/)
  assert.match(pos, /90_000/)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { PRODUCT_DEFINITIONS, getRuntimeProductId } from '../src/shared/productIdentity.js'

const root = process.cwd()
const compatibilityRelease = Object.freeze({
  appId: 'com.boroko.bookings',
  repo: 'boroko-bookings-releases'
})
const products = Object.freeze([
  ['lodge-camp', 'com.boroko.lodgecamp', 'boroko-lodge-camp-releases'],
  ['hotel', 'com.boroko.hotel', 'boroko-hotel-releases'],
  ['hospitality-pos', 'com.boroko.hospitalitypos', 'boroko-hospitality-pos-releases']
])

test('the live Boroko Bookings client retains its compatibility identity and update feed', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  assert.equal(packageJson.build.appId, compatibilityRelease.appId)
  assert.equal(packageJson.build.publish.repo, compatibilityRelease.repo)
  assert.equal(getRuntimeProductId(), 'boroko-bookings')
  assert.equal(PRODUCT_DEFINITIONS['boroko-bookings'].appId, compatibilityRelease.appId)
  assert.equal(PRODUCT_DEFINITIONS['boroko-bookings'].appDataName, 'boroko-bookings')
})

test('every standalone product has an isolated installer identity and GitHub update feed', () => {
  const appIds = new Set([compatibilityRelease.appId])
  const releaseRepos = new Set([compatibilityRelease.repo])

  for (const [id, expectedAppId, expectedRepo] of products) {
    const builderPath = path.join(root, 'apps', id, 'electron-builder.json')
    const builder = JSON.parse(fs.readFileSync(builderPath, 'utf8'))
    assert.equal(builder.appId, expectedAppId)
    assert.equal(builder.publish.provider, 'github')
    assert.equal(builder.publish.owner, 'Rabafi')
    assert.equal(builder.publish.repo, expectedRepo)
    assert.equal(appIds.has(builder.appId), false, `${id} reuses an application ID`)
    assert.equal(releaseRepos.has(builder.publish.repo), false, `${id} reuses an update feed`)
    appIds.add(builder.appId)
    releaseRepos.add(builder.publish.repo)
  }

  assert.equal(appIds.size, products.length + 1)
  assert.equal(releaseRepos.size, products.length + 1)
})

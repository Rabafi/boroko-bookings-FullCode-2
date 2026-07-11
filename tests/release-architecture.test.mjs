import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { PRODUCT_DEFINITIONS, getRuntimeProductId } from '../src/shared/productIdentity.js'

const root = process.cwd()
const lodgeCampRelease = Object.freeze({
  appId: 'com.boroko.bookings',
  repo: 'boroko-bookings-releases'
})
const products = Object.freeze([
  ['hotel', 'com.boroko.hotel', 'boroko-hotel-releases'],
  ['hospitality-pos', 'com.boroko.hospitalitypos', 'boroko-hospitality-pos-releases']
])

test('Lodge and Camp retains the live Boroko Bookings identity and update feed', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lodgeBuilder = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'lodge-camp', 'electron-builder.json'), 'utf8'))
  assert.equal(packageJson.build.appId, lodgeCampRelease.appId)
  assert.equal(packageJson.build.publish.repo, lodgeCampRelease.repo)
  assert.equal(lodgeBuilder.appId, lodgeCampRelease.appId)
  assert.equal(lodgeBuilder.publish.repo, lodgeCampRelease.repo)
  assert.equal(lodgeBuilder.extraMetadata.name, 'boroko-bookings')
  assert.equal(getRuntimeProductId(), 'lodge-camp')
  assert.equal(PRODUCT_DEFINITIONS['lodge-camp'].appId, lodgeCampRelease.appId)
  assert.equal(PRODUCT_DEFINITIONS['lodge-camp'].appDataName, 'boroko-bookings')
})

test('Hotel and Hospitality POS have isolated installer identities and GitHub update feeds', () => {
  const appIds = new Set([lodgeCampRelease.appId])
  const releaseRepos = new Set([lodgeCampRelease.repo])

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

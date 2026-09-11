import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { getCommercialPackageCatalog } = await import('../src/shared/commercialPackages.js')

test('LodgingOS exposes only Starter, Standard, and Pro commercial packages', () => {
  const packages = getCommercialPackageCatalog('lodge-camp')
  assert.deepEqual(packages.map((entry) => entry.displayName), ['Starter', 'Standard', 'Pro'])
  for (const entry of packages) {
    const visibleCopy = [entry.displayName, entry.headline, entry.summary, entry.upgradeNudge].join(' ')
    assert.doesNotMatch(visibleCopy, /upgrade to enterprise|enterprise hospitality|enterprise add-on/i)
  }
})

test('Hotel compatibility plan is presented as Hotel Core', () => {
  const [hotel] = getCommercialPackageCatalog('hotel')
  assert.equal(hotel.displayName, 'Hotel Core')
  assert.doesNotMatch([hotel.displayName, hotel.headline, hotel.summary, hotel.upgradeNudge].join(' '), /upgrade to enterprise|enterprise package/i)
})

test('POS packages never inherit the shared Pro-to-Enterprise upgrade copy', () => {
  for (const entry of getCommercialPackageCatalog('hospitality-pos')) {
    assert.doesNotMatch(entry.upgradeNudge, /enterprise/i)
  }
})

test('Command Central catalog and override comparison are product scoped', async () => {
  const source = await readFile(new URL('../src/renderer/src/components/LicensingWorkbench.jsx', import.meta.url), 'utf8')
  assert.match(source, /Product-specific packages and included workflows/)
  assert.match(source, /Package defaults to compare/)
  assert.match(source, /Comparing against \{referenceOffer\.displayName\} defaults/)
  assert.match(source, /getCommercialOffers\(selectedProduct\)\.forEach\(\(offer\) => \(offer\.includedFeatures \|\| \[\]\)\.forEach/)
  assert.doesNotMatch(source, /getCommercialOffers\(selectedProduct\)\.forEach\(\(offer\) => \[\.\.\.\(offer\.includedFeatures/)
})

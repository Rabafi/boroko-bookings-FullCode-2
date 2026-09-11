import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import {
  getUpgradeShowcaseCopy,
  UPGRADE_SHOWCASE_FEATURE_COPY,
  UPGRADE_SHOWCASE_ROUTE_COPY
} from '../src/shared/upgradeShowcaseContent.js'

const root = resolve(process.cwd())
const app = readFileSync(resolve(root, 'src/renderer/src/App.jsx'), 'utf8')
const presentation = readFileSync(resolve(root, 'src/renderer/src/components/shared/EntitlementPresentation.jsx'), 'utf8')

test('every literal UpgradeWall feature has dedicated customer-facing copy', () => {
  const upgradeWallFeatures = [...app.matchAll(/<UpgradeWall\s+feature="([^"]+)"/g)].map((match) => match[1])
  const addonRouteFeatures = [...app.matchAll(/<BarAddonFeatureRoute\s+feature="([^"]+)"/g)].map((match) => match[1])
  const features = [...new Set([...upgradeWallFeatures, ...addonRouteFeatures])]

  assert.ok(features.length > 20, 'expected the route map to expose the locked workspace set')
  for (const feature of features) {
    const copy = UPGRADE_SHOWCASE_FEATURE_COPY[feature]
    assert.ok(copy, `${feature} needs dedicated locked-page copy`)
    assert.ok(copy.description.length >= 60, `${feature} description should explain its operational value`)
    assert.equal(copy.benefits.length, 3, `${feature} should have three focused benefits`)
  }
})

test('feature descriptions are distinct and reject the old generic fallback language', () => {
  const descriptions = Object.values(UPGRADE_SHOWCASE_FEATURE_COPY).map((copy) => copy.description.trim())
  assert.equal(new Set(descriptions).size, descriptions.length)

  for (const description of descriptions) {
    assert.doesNotMatch(description, /in one connected hospitality workspace/i)
    assert.doesNotMatch(description, /^manage .+ management\.?$/i)
    assert.doesNotMatch(description, /^track .+ and item management\.?$/i)
  }

  assert.doesNotMatch(presentation, /const planBenefits/)
  assert.doesNotMatch(presentation, /Use \$\{FEATURE_LABELS\[feature\]/)
})

test('shared entitlement keys still produce page-specific POS and restaurant showcases', () => {
  const paths = [
    '/pos',
    '/food-beverage/kitchen',
    '/restaurant/floor-workspace',
    '/restaurant/finance-close',
    '/restaurant/reservations',
    '/restaurant/staff-performance',
    '/restaurant/kitchen-analytics',
    '/pos/customer-display',
    '/pos/kitchen-display',
    '/pos/bar-display'
  ]
  const featureForPath = {
    '/pos': 'pos',
    '/food-beverage/kitchen': 'pos',
    '/restaurant/floor-workspace': 'pos',
    '/restaurant/finance-close': 'reports',
    '/restaurant/reservations': 'pos',
    '/restaurant/staff-performance': 'performance',
    '/restaurant/kitchen-analytics': 'performance',
    '/pos/customer-display': 'pos',
    '/pos/kitchen-display': 'pos',
    '/pos/bar-display': 'pos'
  }
  const descriptions = paths.map((routePath) => getUpgradeShowcaseCopy({
    feature: featureForPath[routePath],
    routePath
  }).description)

  assert.equal(new Set(descriptions).size, descriptions.length)
  assert.match(getUpgradeShowcaseCopy({ feature: 'pos', routePath: '/food-beverage/kitchen' }).description, /menus, orders, kitchen work/i)
  assert.match(getUpgradeShowcaseCopy({ feature: 'performance', routePath: '/restaurant/staff-performance' }).description, /team is performing/i)
  assert.match(getUpgradeShowcaseCopy({ feature: 'performance', routePath: '/restaurant/kitchen-analytics' }).description, /kitchen bottlenecks/i)
})

test('UpgradeWall passes the active route into the showcase resolver', () => {
  assert.match(app, /const location = useLocation\(\)/)
  assert.match(app, /routePath=\{location\.pathname\}/)
  assert.match(presentation, /getUpgradeShowcaseCopy/)
  assert.match(presentation, /data-testid="upgrade-showcase-description"/)
  assert.ok(Object.keys(UPGRADE_SHOWCASE_ROUTE_COPY).length >= 15)
})

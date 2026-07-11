import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const { getModuleByKey, MODULE_CATALOG } = await import('../src/shared/moduleCatalog.js')

const desktopNavSource = readFileSync(resolve(__dirname, '../src/renderer/src/navigation/desktopNav.js'), 'utf8')

const KNOWN_GAPS_WITHOUT_NAV = ['/subscription-builder', '/linen-laundry', '/lost-found', '/visitors', '/emergency', '/incidents']
const NO_NAV_ENTRY_ROUTES = ['/subscription-builder', '/linen-laundry', '/lost-found', '/visitors', '/emergency', '/incidents', '/room-types', '/floors', '/room-attributes', '/hotel-reports', '/advanced-housekeeping', '/housekeeping-command-center', '/maintenance-enterprise']

const enterpriseModulesWithRoutes = MODULE_CATALOG
  .filter(m => m.requiredPlan === 'Enterprise')
  .filter(m => Array.isArray(m.routes) && m.routes.length > 0)
  .filter(m => m.visibility !== 'hidden')

test('all Enterprise modules with routes have matching nav entries', () => {
  const navTos = [...desktopNavSource.matchAll(/to:\s*'([^']+)'/g)].map(m => m[1])

  for (const mod of enterpriseModulesWithRoutes) {
    for (const route of mod.routes) {
      if (NO_NAV_ENTRY_ROUTES.includes(route)) continue
      assert.ok(
        navTos.includes(route),
        `Module "${mod.key}" route "${route}" should have a matching nav to: entry in desktopNav.js`
      )
    }
  }
})

test('known gap routes without nav entries are documented', () => {
  const navTos = [...desktopNavSource.matchAll(/to:\s*'([^']+)'/g)].map(m => m[1])
  for (const route of NO_NAV_ENTRY_ROUTES) {
    const hasEntry = navTos.includes(route)
    assert.equal(hasEntry, false, `Gap route "${route}" should NOT have a nav entry (internal-only)`)
  }
})

test('each nav entry feature flag matches the module key', () => {
  const navFeatureMatches = [...desktopNavSource.matchAll(/moduleKey:\s*'([^']+)'[^}]*feature:\s*'([^']+)'/gs)]
  const navModuleKeyMatches = [...desktopNavSource.matchAll(/moduleKey:\s*'([^']+)'/g)].map(m => m[1])

  const modulesByKey = {}
  for (const m of MODULE_CATALOG) {
    modulesByKey[m.key] = m
  }

  for (const moduleKey of navModuleKeyMatches) {
    if (moduleKey === 'null') continue
    const mod = modulesByKey[moduleKey]
    if (!mod) continue
    const modRoutes = mod.routes || []
    const navEntryBlock = desktopNavSource.slice(
      desktopNavSource.indexOf(`moduleKey: '${moduleKey}'`),
      desktopNavSource.indexOf('},', desktopNavSource.indexOf(`moduleKey: '${moduleKey}'`)) + 2
    )
    for (const route of modRoutes) {
      const navToMatch = `to: '${route}'`
      if (navEntryBlock.includes(navToMatch)) {
        const featureMatch = navEntryBlock.match(/feature:\s*'([^']+)'/)
        if (featureMatch) {
          assert.equal(
            featureMatch[1],
            moduleKey,
            `Nav entry for module "${moduleKey}" route "${route}" should have feature="${moduleKey}", got "${featureMatch[1]}"`
          )
        }
      }
    }
  }
})

test('Enterprise nav entries do not bypass module catalog gating', () => {
  const entries = [...desktopNavSource.matchAll(/\{[\s\S]*?to:\s*'([^']+)'[\s\S]*?tier:\s*'Enterprise'[\s\S]*?\}/g)]
  assert.ok(entries.length > 0, 'Expected Enterprise navigation entries')

  for (const entry of entries) {
    const block = entry[0]
    const route = entry[1]
    if (NO_NAV_ENTRY_ROUTES.includes(route)) continue
    const moduleKeyMatch = block.match(/moduleKey:\s*'([^']+)'/)
    assert.ok(moduleKeyMatch, `Enterprise nav route "${route}" must set moduleKey for catalog gating`)
    const mod = getModuleByKey(moduleKeyMatch[1])
    assert.ok(mod, `Enterprise nav route "${route}" moduleKey "${moduleKeyMatch[1]}" must exist in moduleCatalog`)
    assert.ok(mod.routes?.includes(route), `Enterprise nav route "${route}" must be listed in moduleCatalog routes for "${moduleKeyMatch[1]}"`)
  }
})

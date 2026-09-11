import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildCapabilitySnapshot, canAccessCapability } from '../src/shared/accessControl.js'

const main = readFileSync('src/main/index.js', 'utf8')
const preload = readFileSync('src/preload/index.js', 'utf8')
const app = readFileSync('src/renderer/src/App.jsx', 'utf8')
const hposLayout = readFileSync('src/renderer/src/components/hospitality-pos/HposLayout.jsx', 'utf8')

function handlerBlock(source, channel) {
  const start = source.indexOf(`'${channel}'`)
  assert.ok(start !== -1, `main must register ${channel}`)
  const end = source.indexOf('ipcMain.handle(', start + channel.length + 2)
  return source.slice(start, end === -1 ? undefined : end)
}

test('outlet-scoped roles lack settings.view, so boot needs a public context', () => {
  for (const role of ['cashier', 'supervisor']) {
    const access = buildCapabilitySnapshot({ role, features: { pos: true } })
    assert.equal(canAccessCapability(access, 'pos.view'), true, `${role} keeps till access`)
    assert.equal(canAccessCapability(access, 'settings.view'), false, `${role} must not gain full settings`)
  }
})

test('settings:getOutletContext is auth-gated with an explicit routing-only allowlist', () => {
  const block = handlerBlock(main, 'settings:getOutletContext')
  assert.doesNotMatch(block, /requireCapability/, 'outlet context must not require a capability')
  assert.doesNotMatch(block, /settings\.view/, 'outlet context must not depend on settings.view')
  assert.match(block, /getCurrentUserOrRestore\(\)/, 'outlet context requires an authenticated session')
  for (const key of ['lodge_id', 'property_type', 'business_type', 'hospitality_mode', 'operating_profile', 'currency', 'lodge_name', 'company_name']) {
    assert.ok(block.includes(key), `outlet context allowlist includes ${key}`)
  }
  assert.doesNotMatch(block, /vat_number|password|secret|api_key|token/, 'outlet context must not leak sensitive settings fields')
})

test('preload and boot fall back to the outlet context when full settings are denied', () => {
  assert.match(preload, /getOutletContext:\s*\(\)\s*=>\s*invoke\('settings:getOutletContext'\)/)
  assert.match(app, /window\.api\.settings\.get\(\)/, 'boot still tries full settings first')
  assert.match(app, /getOutletContext\(\)/, 'boot falls back to the outlet context for denied roles')
})

test('route guards still fail closed when the context genuinely says lodge', () => {
  assert.match(app, /!isRestaurantOnly\(propertyType\)/, 'RestaurantOnlyRoute keeps bouncing non-restaurant settings')
  assert.match(hposLayout, /isRoot \? <Navigate to="\/hpos\/pos" replace \/>/, 'HposLayout keeps landing root on the sell terminal')
})

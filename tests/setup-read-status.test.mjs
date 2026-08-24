import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

test('setup progress keeps the legacy array contract and exposes an authoritative online envelope', () => {
  const domain = read('src/main/domains/pos.js')
  const database = read('src/main/database.js')
  const main = read('src/main/index.js')
  const preload = read('src/preload/index.js')

  assert.match(domain, /export async function getRestaurantSetupProgress\(\)/)
  assert.match(domain, /return Array\.isArray\(data\) \? data : \[\];/)
  assert.match(domain, /export async function getRestaurantSetupProgressWithReadStatus\(\)/)
  assert.match(domain, /source: 'server', complete: true, online: true, rows: data, error: null/)
  assert.match(database, /getRestaurantSetupProgressWithReadStatus/)
  assert.match(main, /pos:getSetupProgressWithReadStatus/)
  assert.match(preload, /getSetupProgressWithReadStatus: \(\) => invoke\('pos:getSetupProgressWithReadStatus'\)/)
})

test('offline and failed setup reads are unavailable and cannot be treated as not configured', () => {
  const domain = read('src/main/domains/pos.js')
  const screen = read('src/renderer/src/components/hospitality-pos/HposSetupReadiness.jsx')
  const hub = read('src/renderer/src/components/hospitality-pos/HposManageHub.jsx')

  assert.match(domain, /source: 'unavailable'/)
  assert.match(domain, /complete: false/)
  assert.match(domain, /Setup evidence is unavailable while offline/)
  assert.match(screen, /readStatus\?\.complete === true/)
  assert.match(screen, /Setup evidence is not verified/)
  assert.match(screen, /Completion is blocked until authoritative server evidence is available/)
  assert.match(screen, /Not verified/)
  assert.match(hub, /Setup readiness unavailable/)
  assert.match(hub, /Reconnect and refresh before relying on readiness/)
})

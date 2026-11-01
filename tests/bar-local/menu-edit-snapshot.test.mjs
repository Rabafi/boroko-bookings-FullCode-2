import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const files = [
  'src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx',
  'legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx'
]
const scope = { business_id: 'business', outlet_id: 'outlet', device_id: 'device', actor_staff_id: 'actor' }
function page(data, watermark = 1, more = false, cursor = null, overrides = {}) {
  return { data, complete: true, unavailable: [], snapshot_watermark: watermark, scope, pagination: { has_more: more, next_cursor: cursor }, ...overrides }
}
function loader(file) {
  const source = readFileSync(file, 'utf8')
  const match = source.match(/\/\/ MENU_EDIT_SNAPSHOT_BEGIN([\s\S]*?)\/\/ MENU_EDIT_SNAPSHOT_END/)
  assert.ok(match)
  return { source, load: runInNewContext(`(${match[1].trim()})`) }
}
for (const file of files) {
  test(`${file}: verifies matching pages and allows an empty catalogue`, async () => {
    const { load } = loader(file)
    const result = await load(async (name) => page(name === 'menu.list'
      ? [{ product_id: 'a', sku: 'A', version: 2 }]
      : [{ product_id: 'a', sku: 'A' }]))
    assert.equal(result.versions.a, 2)
    assert.equal(result.rows.length, 1)
    const empty = await load(async () => page([]))
    assert.equal(empty.rows.length, 0)
  })
  test(`${file}: retries snapshot drift and rejects persistent drift`, async () => {
    const { load } = loader(file)
    let calls = 0
    const result = await load(async (name) => {
      calls++
      return page(name === 'menu.list' ? [{ product_id: 'a', sku: 'A', version: 2 }] : [{ product_id: 'a', sku: 'A' }],
        calls <= 2 && name === 'menu.list' ? 2 : 1)
    })
    assert.equal(result.versions.a, 2)
    assert.equal(calls, 4)
    await assert.rejects(load(async (name) => page([], name === 'menu.list' ? 2 : 1)), /changed while loading/)
  })
  test(`${file}: rejects scope, product and pagination inconsistencies`, async () => {
    const { load, source } = loader(file)
    await assert.rejects(load(async (name) => page([], 1, false, null,
      name === 'menu.list' ? { scope: { ...scope, outlet_id: 'other' } } : {})), /scope changed/)
    await assert.rejects(load(async (name) => page(name === 'menu.list'
      ? [{ product_id: 'b', sku: 'B', version: 1 }] : [{ product_id: 'a', sku: 'A' }])), /products do not match/)
    await assert.rejects(load(async (name) => page([], 1, name === 'menu.list', null)), /pages do not match/)
    assert.match(source, /setMenuRows\(\[\]\)[\s\S]*setMenuProductVersions\(\{\}\)[\s\S]*expectedVersion: ''/)
  })
  test(`${file}: rejects changes and duplicates across page boundaries`, async () => {
    const { load } = loader(file)
    await assert.rejects(load(async (name, filters) => {
      const second = Boolean(filters.cursor)
      const row = name === 'menu.list' ? { product_id: 'a', sku: 'A', version: 1 } : { product_id: 'a', sku: 'A' }
      return page([row], second ? 2 : 1, !second, second ? null : 'A')
    }), /changed while loading/)
    await assert.rejects(load(async (name, filters) => {
      const second = Boolean(filters.cursor)
      const row = name === 'menu.list' ? { product_id: 'a', sku: 'A', version: 1 } : { product_id: 'a', sku: 'A' }
      return page([row], 1, !second, second ? null : 'A')
    }), /products do not match/)
  })
}

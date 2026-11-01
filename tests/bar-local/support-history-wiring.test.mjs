import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const modern = readFileSync(new URL('../../src/renderer/src/components/hospitality-pos/BarLocalWorkspace.jsx', import.meta.url), 'utf8')
const legacy = readFileSync(new URL('../../legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx', import.meta.url), 'utf8')
const contracts = readFileSync(new URL('../../packages/bar-contracts/src/registry.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../services/bar-local/db/migrations/0071_support_report_history.sql', import.meta.url), 'utf8')

test('Modern and Legacy support panels read paged local history through the scoped contract', () => {
  assert.match(contracts, /'support\.reports\.list':\s*\{\s*version:\s*1,\s*capability:\s*CAPABILITIES\.SETTINGS_MANAGE/)
  assert.match(migration, /r\.business_id = v_ctx\.business_id AND r\.outlet_id = v_outlet/)
  assert.match(migration, /PERFORM bar_local\.assert_capability\(v_ctx\.capabilities, 'settings\.manage'\)/)
  assert.match(migration, /'support\.reports\.list'/)
  for (const source of [modern, legacy]) {
    assert.match(source, /'support\.reports\.list'/)
    assert.match(source, /Local report history/)
    assert.match(source, /loadCompleteBarList/)
    assert.match(source, /delivery_status/)
  }
})

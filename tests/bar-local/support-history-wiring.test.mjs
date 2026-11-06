import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const legacy = readFileSync(new URL('../../legacy-pos/src/renderer/src/screens/BarLocalWorkspace.jsx', import.meta.url), 'utf8')
const contracts = readFileSync(new URL('../../packages/bar-contracts/src/registry.ts', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../services/bar-local/db/migrations/0071_support_report_history.sql', import.meta.url), 'utf8')

test('Legacy support panel reads paged local history through the scoped contract', () => {
  assert.match(contracts, /'support\.reports\.list':\s*\{\s*version:\s*1,\s*capability:\s*CAPABILITIES\.SETTINGS_MANAGE/)
  assert.match(migration, /r\.business_id = v_ctx\.business_id AND r\.outlet_id = v_outlet/)
  assert.match(migration, /PERFORM bar_local\.assert_capability\(v_ctx\.capabilities, 'settings\.manage'\)/)
  assert.match(migration, /'support\.reports\.list'/)
  assert.match(legacy, /'support\.reports\.list'/)
  assert.match(legacy, /Local report history/)
  assert.match(legacy, /loadCompleteBarList/)
  assert.match(legacy, /delivery_status/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { importDomain } from './helpers/domain-test-setup.mjs'
import { buildCapabilitySnapshot } from '../src/shared/accessControl.js'
const { coerceEntitlementResponseForTenant: coerce } = await importDomain('entitlements.js')
const lodge = 'aaaaaaaa-aaaa-4aaa-8aaa-111111111111'
const fixture = (extra = {}) => ({ lodge_id: lodge, product_id: 'hospitality-pos', commercial_package_key: 'bar_pos', plan: 'Pro', status: 'licensed', subscription_state: 'active', expired: false, effective_features: { pos: true }, commercial_pricing_snapshot: { selection: { selected_addon_keys: ['bar_accounting_workforce', 'bar_growth_multi_outlet'] } }, ...extra })
const snapshot = entitlement => buildCapabilitySnapshot({role:'admin',features:entitlement.effective_features,productId:entitlement.product_id,commercialPackageKey:entitlement.commercial_package_key,commercialAddonKeys:entitlement.enterprise_addons,commercialEntitlement:entitlement,commercialLodgeId:lodge})
test('approved addons survive base-only RPC features and legacy Pro defaults', () => {
 const ent = coerce(fixture(), lodge)
 for (const feature of ['restaurant_accounting','workforce_management','advanced_reports','payroll']) assert.equal(ent.effective_features[feature], true, feature)
 assert.equal(snapshot(ent).capabilities['accounting.read'], true)
 assert.equal(snapshot(ent).capabilities['advanced_reports.view'], true)
})
test('explicit server denial and scoped force-off still block approved addons', () => {
 const denied=coerce(fixture({effective_features:{restaurant_accounting:false}}),lodge)
 assert.equal(snapshot(denied).capabilities['accounting.read'],false)
 const override=coerce(fixture({commercial_overrides:{features:{restaurant_accounting:false}}}),lodge)
 assert.equal(snapshot(override).capabilities['accounting.read'],false)
})
test('base package, expired licence and foreign tenant cannot gain addon capabilities', () => {
 for(const extra of [{commercial_pricing_snapshot:{selection:{selected_addon_keys:[]}}},{expired:true,status:'expired',subscription_state:'expired'}]) {
  assert.equal(snapshot(coerce(fixture(extra),lodge)).capabilities['accounting.read'],false)
 }
 assert.equal(coerce(fixture({lodge_id:'bbbbbbbb-bbbb-4bbb-8bbb-222222222222'}),lodge),null)
})
test('addon activation does not grant cashier accounting permissions', () => {
 const ent=coerce(fixture(),lodge)
 assert.equal(buildCapabilitySnapshot({role:'cashier',features:ent.effective_features,productId:ent.product_id,commercialPackageKey:ent.commercial_package_key,commercialAddonKeys:ent.enterprise_addons,commercialEntitlement:ent,commercialLodgeId:lodge}).capabilities['accounting.read'],false)
})
test('Manage refresh forces the shared access refresh and displays recovery on failure', async () => {
 const source=fs.readFileSync('src/renderer/src/components/hospitality-pos/HposManageHub.jsx','utf8')
 const body=source.split('const refreshAccess = useCallback(async () => {')[1].split('}, [refreshEntitlement])')[0]
 const run=new Function('refreshEntitlement','setAccessRefreshing','setAccessRefreshError',`return (async () => {${body}})()`)
 let requested, error, busy
 await run(async options=>{requested=options;return fixture()},v=>busy=v,v=>error=v)
 assert.deepEqual(requested,{forceFresh:true});assert.equal(error,'');assert.equal(busy,false)
 await run(async()=>null,v=>busy=v,v=>error=v)
 assert.match(error,/Reconnect/);assert.equal(busy,false)
 assert.match(source,/useEffect\(\(\) => \{ refreshAccess\(\); \}, \[refreshAccess\]\)/)
})
